/**
 * The Fastify adapter for `handleReport`.
 *
 * Fastify predates the web `Request` like Express does, so the work here is
 * translation too: build a `Request` from what Fastify parsed, hand it to
 * `handleReport`, and write the `Response` back through `reply`. Node 18+ has
 * `Request`, `Response` and `Headers` as globals, so this needs no dependency
 * either.
 *
 * The types are structural rather than imported from `fastify`, for the same
 * reason the Express ones are: this package has no dependencies and is not
 * about to grow one for four field names.
 *
 * Two things about Fastify are worth knowing before mounting this, and both
 * are read out of `fastify@5`'s own build rather than its documentation.
 *
 * **The default body limit is smaller than a report with a screenshot.**
 * `bodyLimit` defaults to 1 048 576 bytes (`config-validator.js`, and again in
 * `defaultInitOptions`), and the JSON parser refuses anything over it with
 * `FST_ERR_CTP_BODY_TOO_LARGE` *before* the route handler is entered. So a
 * 2 MB report is a 413 from Fastify itself, carrying Fastify's own error
 * shape, and this adapter never runs. `handleReport` would have accepted the
 * same body: its own ceiling is `DEFAULT_MAX_BODY_BYTES`, four times as large.
 * Raise `bodyLimit` on the instance, or this route silently serves a subset of
 * the reports the client is willing to send.
 *
 * **A signed route cannot work behind the default parser.** The signature
 * covers the exact text the browser sent, and Fastify parses `application/json`
 * by default (`content-type-parser.js` registers it in the constructor), so
 * what reaches the handler is an object. Re-serialising it gives different
 * bytes and a different HMAC — the same trap as `express.json()`, but with no
 * way to route around it by not mounting a parser, because the parser is the
 * framework's own and always runs. The way out is a content-type parser that
 * keeps the text, which this adapter accepts unchanged:
 *
 * ```ts
 * fastify.addContentTypeParser("application/json", { parseAs: "string" },
 *   (_req, body, done) => done(null, body));
 * ```
 *
 * Like the Express adapter, that answers 401 and explains itself once through
 * `onError`, because a mounting mistake and a forged signature look identical
 * on the wire and should not look identical in the log.
 */

import {
  handleReport,
  BAD_SIGNATURE_ERROR,
  DEFAULT_MAX_BODY_BYTES,
  TOO_LARGE_ERROR,
  type HandleReportOptions,
} from "./handle.ts";
import { DEFAULT_SIGNATURE_HEADER } from "../sign.ts";

/** As much of a Fastify request as the adapter reads. */
export type FastifyRequestLike = {
  method?: string;
  /** Fastify keeps the raw Node request here. */
  raw?: {
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    socket?: { remoteAddress?: string | undefined } | undefined;
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
    destroy?: (error?: Error) => unknown;
  };
  headers?: Record<string, string | string[] | undefined>;
  /**
   * Whatever the content-type parser left. An object under the default JSON
   * parser, a string under the `parseAs: "string"` one above, a `Buffer` under
   * a buffer parser, and `undefined` when the route took no body at all.
   */
  body?: unknown;
  /**
   * Fastify's own answer, which honours the instance's `trustProxy`. It is the
   * fallback, never the first choice, for the same reason as in the Express
   * adapter: two settings deciding the same thing is how one of them ends up
   * wrong, and `trustProxy` is the one this package documents. Note that
   * Fastify only defines this getter when `trustProxy` is set, so it is
   * usually `undefined` here — which is the honest answer.
   */
  ip?: string | undefined;
};

/** As much of a Fastify reply as the adapter writes. */
export type FastifyReplyLike = {
  status(code: number): unknown;
  code?(code: number): unknown;
  header(name: string, value: string): unknown;
  setHeader?(name: string, value: string): unknown;
  send(body?: unknown): unknown;
};

/** One header value: Node gives arrays for the repeatable ones. */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/** Thrown by `rawBody` when the stream is over the ceiling. */
class RawBodyTooLargeError extends Error {}

/**
 * Reads the raw request stream, for a route whose body nothing parsed.
 *
 * Counted as it arrives, because a route that parsed nothing has no other
 * ceiling and buffering the whole thing first is exactly the attack. Decoded
 * through one streaming `TextDecoder` rather than one per chunk, because a
 * chunk boundary falls wherever the network put it and a two-byte character
 * split across it decodes to two replacement characters.
 */
async function rawBody(
  req: FastifyRequestLike,
  maxBytes: number,
): Promise<string | undefined> {
  const raw = req.raw;
  if (!raw || typeof raw[Symbol.asyncIterator] !== "function") return undefined;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  for await (const chunk of raw as AsyncIterable<unknown>) {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : (chunk as Uint8Array);
    total += bytes.byteLength;
    if (total > maxBytes) {
      raw.destroy?.();
      throw new RawBodyTooLargeError();
    }
    parts.push(decoder.decode(bytes, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/**
 * The body as text: a string or a `Buffer` is taken as it is, already-parsed
 * JSON is re-serialised, and a request that parsed nothing is read from the
 * stream.
 */
async function bodyText(
  req: FastifyRequestLike,
  maxBytes: number,
): Promise<string | undefined> {
  const body = req.body;
  if (body === undefined || body === null) return await rawBody(req, maxBytes);
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return JSON.stringify(body);
}

/** Writes one JSON answer this adapter built itself, CORS header and all. */
function writeJson(
  reply: FastifyReplyLike,
  status: number,
  body: unknown,
  cors: string | boolean | undefined,
): void {
  if (reply.status) reply.status(status);
  else reply.code?.(status);
  if (cors) {
    const origin = cors === true ? "*" : cors;
    reply.header("Access-Control-Allow-Origin", origin);
  }
  reply.header("Content-Type", "application/json");
  reply.send(JSON.stringify(body));
}

/**
 * True when the content-type parser has already turned this request into an
 * object, so a signature over the text it arrived as could never be checked.
 *
 * A string and a `Buffer` are not that — the `parseAs: "string"` parser above
 * is the way out of this trap and both of its results verify.
 */
function alreadyParsed(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  if (body instanceof Uint8Array) return false;
  return Object.keys(body as object).length > 0;
}

/**
 * Turns `handleReport` into a Fastify route handler.
 *
 * ```ts
 * fastify.post("/api/bug-report", fastifyHandler({ store, sinks: [toWebhook({…})] }));
 * ```
 */
export function fastifyHandler(
  options: HandleReportOptions = {},
): (req: FastifyRequestLike, reply: FastifyReplyLike) => void {
  // One diagnostic per handler, latched here rather than in the closure below.
  let warnedAboutParsedBody = false;
  return (req, reply) => {
    void (async () => {
      const method = (req.method ?? "POST").toUpperCase();
      // Fastify's own `request.headers` is the parsed, lowercased view of the
      // raw ones; either is the same map, and `raw` is the fallback for a
      // structural type that only carries that half.
      const source = req.headers ?? req.raw?.headers ?? {};
      const host = headerValue(source.host) ?? "localhost";
      const proto = headerValue(source["x-forwarded-proto"]) ?? "http";
      const path = req.raw?.url ?? "/";
      const url = `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;

      const headers = new Headers();
      for (const [name, value] of Object.entries(source)) {
        const single = headerValue(value);
        // The length of what the parser produced is not the length of what we
        // re-serialise, and a wrong content-length would trip the body cap.
        if (single === undefined) continue;
        if (name === "content-length" || name === "transfer-encoding") continue;
        headers.set(name, single);
      }

      const signature = options.signature;
      if (
        signature &&
        method !== "GET" &&
        method !== "HEAD" &&
        method !== "OPTIONS" &&
        alreadyParsed(req.body)
      ) {
        // A request carrying no signature at all is the one case `require:
        // false` lets through, and it is the documented way to roll signing
        // out, so it is left to `handleReport` and is not a misconfiguration
        // worth a line. Everything else is about to be refused for a reason
        // that has nothing to do with the sender.
        const name = (signature.header ?? DEFAULT_SIGNATURE_HEADER).toLowerCase();
        const signed = headerValue(source[name]) !== undefined;
        if (signed || signature.require !== false) {
          if (!warnedAboutParsedBody) {
            warnedAboutParsedBody = true;
            options.onError?.(
              new Error(
                "bugbottle: fastifyHandler cannot verify a signature on a body Fastify's " +
                  "JSON content-type parser already turned into an object — re-serialising " +
                  "it gives different bytes and a different HMAC. Add a parser that keeps " +
                  'the text: fastify.addContentTypeParser("application/json", ' +
                  '{ parseAs: "string" }, (_req, body, done) => done(null, body)). ' +
                  "Every signed report is answered 401 until then.",
              ),
            );
          }
          // The same 401 as a forged signature, on purpose: the reply says no
          // more than it did before, and the explanation goes to the log.
          writeJson(reply, 401, { error: BAD_SIGNATURE_ERROR }, options.cors);
          return;
        }
      }

      let body: string | undefined;
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        try {
          body = await bodyText(req, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
        } catch (err) {
          if (!(err instanceof RawBodyTooLargeError)) throw err;
          // `handleReport` never sees this body, so the 413 is written here.
          writeJson(reply, 413, { error: TOO_LARGE_ERROR }, options.cors);
          return;
        }
        if (body !== undefined) {
          headers.set("content-length", String(new TextEncoder().encode(body).byteLength));
        }
      }

      // The socket first and `request.ip` only after it: `request.ip` is already
      // a forwarded address when the instance set `trustProxy`, and reading it
      // here would trust a setting this package was never asked about. An
      // explicit `remoteAddress` in the options wins over both, because a
      // caller who passes one knows something this adapter does not.
      const remoteAddress = options.remoteAddress ?? req.raw?.socket?.remoteAddress ?? req.ip;
      const response = await handleReport(new Request(url, { method, headers, body }), {
        ...options,
        ...(remoteAddress === undefined ? {} : { remoteAddress }),
      });

      if (reply.status) reply.status(response.status);
      else reply.code?.(response.status);
      response.headers.forEach((value, name) => {
        if (reply.setHeader) reply.setHeader(name, value);
        else reply.header(name, value);
      });
      const text = await response.text();
      reply.send(text);
    })().catch((err: unknown) => {
      // Only the translation can fail here — handleReport answers 500 itself —
      // but a rejected promise in a route is a crashed process in Node.
      options.onError?.(err);
      try {
        if (reply.status) reply.status(500);
        else reply.code?.(500);
        reply.send(JSON.stringify({ error: "Could not store the report" }));
      } catch {
        // The response was already gone; there is nothing left to say.
      }
    });
  };
}
