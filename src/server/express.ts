/**
 * The Express adapter for `handleReport`.
 *
 * Express predates the web `Request` by a decade, so the only work here is
 * translation: build a `Request` from what Express parsed (or from the raw
 * stream when nothing parsed it), hand it to `handleReport`, and write the
 * `Response` back onto `res`. Node 18+ has `Request`, `Response` and `Headers`
 * as globals, so this needs no dependency either.
 *
 * The types are structural rather than imported from `@types/express`: this
 * package has no dependencies and is not about to grow one for two field
 * names. Anything shaped like an Express request and response fits.
 *
 * One caveat matters when `signature` is on. The signature covers the exact
 * text the browser sent, and this adapter only has that text when nothing
 * parsed the body first: `express.json()` hands back an object, which is
 * re-serialised below with whatever key order and spacing `JSON.stringify`
 * chooses, and that is a different string with a different HMAC. Mount the
 * signed route without a body parser — `app.post(path, expressHandler(...))`
 * — and the raw stream is read here and verified as it arrived.
 *
 * That caveat used to be documented and otherwise silent: every report turned
 * into the same 401 the wire gives a forged signature, with nothing in the log
 * to tell the two apart. It now says so once, through `onError`, the first
 * time such a request arrives. Once per handler rather than once per request,
 * because it is a mounting mistake and not an event: the second copy of the
 * line tells nobody anything the first did not.
 */

import {
  handleReport,
  BAD_SIGNATURE_ERROR,
  DEFAULT_MAX_BODY_BYTES,
  TOO_LARGE_ERROR,
  type HandleReportOptions,
} from "./handle.ts";
import { DEFAULT_SIGNATURE_HEADER } from "../sign.ts";

/** As much of an Express request as the adapter reads. */
export type ExpressRequestLike = {
  method?: string;
  /** Express keeps the mounted path here; `url` is the fallback. */
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Whatever a body parser left, if one ran. */
  body?: unknown;
  /**
   * The connection, whose `remoteAddress` is the one address on an Express
   * request nobody could have written from outside. It is handed to
   * `handleReport` as `remoteAddress`, where `trustProxy` decides whether a
   * forwarding header is allowed to name somebody else instead.
   */
  socket?: { remoteAddress?: string | undefined } | undefined;
  /**
   * Express's own answer, which already honours `app.set("trust proxy")`. It
   * is the fallback, never the first choice: two settings deciding the same
   * thing is how one of them ends up wrong, and `trustProxy` is the one this
   * package documents.
   */
  ip?: string | undefined;
  /** The raw stream, read when nothing parsed the body. */
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  /** Node closes the socket with this; called when the body is over the cap. */
  destroy?: (error?: Error) => unknown;
};

/** As much of an Express response as the adapter writes. */
export type ExpressResponseLike = {
  status(code: number): unknown;
  setHeader?(name: string, value: string): unknown;
  set?(name: string, value: string): unknown;
  send(body?: unknown): unknown;
  end?(body?: unknown): unknown;
};

/** One header value: Node gives arrays for the repeatable ones. */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

/** Thrown by `rawBody` when the stream is over the ceiling. */
class RawBodyTooLargeError extends Error {}

/**
 * Reads the raw request stream, for a route mounted without a body parser.
 *
 * Two things matter here and neither is obvious. The stream is counted as it
 * arrives, because a route mounted without `express.json({ limit })` has no
 * other ceiling and buffering the whole thing first is exactly the attack.
 * And the bytes are decoded through one streaming `TextDecoder` rather than
 * one per chunk: a chunk boundary falls wherever the network put it, and a
 * two-byte character split across it decodes to two replacement characters if
 * every chunk is decoded on its own.
 */
async function rawBody(req: ExpressRequestLike, maxBytes: number): Promise<string | undefined> {
  if (typeof req[Symbol.asyncIterator] !== "function") return undefined;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<unknown>) {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : (chunk as Uint8Array);
    total += bytes.byteLength;
    if (total > maxBytes) {
      // Hang up rather than read the rest of a body we have already refused.
      req.destroy?.();
      throw new RawBodyTooLargeError();
    }
    parts.push(decoder.decode(bytes, { stream: true }));
  }
  // The flush emits whatever the last chunk left half-decoded.
  parts.push(decoder.decode());
  return parts.join("");
}

/**
 * The body as text: already-parsed JSON is re-serialised, a string or a
 * `Buffer` is taken as it is, and an unparsed request is read from the stream.
 */
async function bodyText(req: ExpressRequestLike, maxBytes: number): Promise<string | undefined> {
  const body = req.body;
  if (body === undefined || body === null) return await rawBody(req, maxBytes);
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  // An empty object is what `express.json()` leaves when there was no body,
  // and re-serialising that would look like a report with nothing in it. The
  // stream it already drained iterates zero chunks and yields "", which is not
  // JSON either, so an empty read means the same as no read at all.
  if (typeof body === "object" && Object.keys(body as object).length === 0) {
    const raw = await rawBody(req, maxBytes);
    return raw ? raw : "{}";
  }
  return JSON.stringify(body);
}

/** Writes one JSON answer this adapter built itself, CORS header and all. */
function writeJson(
  res: ExpressResponseLike,
  status: number,
  body: unknown,
  cors: string | boolean | undefined,
): void {
  res.status(status);
  if (cors) {
    const origin = cors === true ? "*" : cors;
    if (res.setHeader) res.setHeader("Access-Control-Allow-Origin", origin);
    else res.set?.("Access-Control-Allow-Origin", origin);
  }
  if (res.setHeader) res.setHeader("Content-Type", "application/json");
  else res.set?.("Content-Type", "application/json");
  res.send(JSON.stringify(body));
}

/**
 * True when a body parser has already turned this request into an object, and
 * a signature over the text it arrived as could therefore never be checked.
 *
 * A `Buffer` is not that — `express.raw()` keeps the bytes, which verify — and
 * neither is the empty object `express.json()` leaves behind when there was no
 * body at all, which the reader below falls back to the stream for.
 */
function alreadyParsed(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  if (body instanceof Uint8Array) return false;
  return Object.keys(body as object).length > 0;
}

/**
 * Turns `handleReport` into an Express handler.
 *
 * ```ts
 * app.post("/api/bug-report", express.json({ limit: "5mb" }),
 *   expressHandler({ sinks: [toResend({ apiKey, from, to })] }));
 * ```
 */
export function expressHandler(
  options: HandleReportOptions = {},
): (req: ExpressRequestLike, res: ExpressResponseLike) => void {
  // One diagnostic per handler, latched here rather than in the closure below.
  let warnedAboutParsedBody = false;
  return (req, res) => {
    void (async () => {
      const method = (req.method ?? "POST").toUpperCase();
      const host = headerValue(req.headers.host) ?? "localhost";
      const proto = headerValue(req.headers["x-forwarded-proto"]) ?? "http";
      const path = req.originalUrl ?? req.url ?? "/";
      const url = `${proto}://${host}${path.startsWith("/") ? path : `/${path}`}`;

      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        const single = headerValue(value);
        // The length of what Express handed us is not the length of what we
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
        const signed = headerValue(req.headers[name]) !== undefined;
        if (signed || signature.require !== false) {
          if (!warnedAboutParsedBody) {
            warnedAboutParsedBody = true;
            options.onError?.(
              new Error(
                "bugbottle: expressHandler cannot verify a signature on a body that " +
                  "express.json() (or another parser) already turned into an object — " +
                  "re-serialising it gives different bytes and a different HMAC. Mount " +
                  "the signed route without a body parser: " +
                  "app.post(path, expressHandler(...)). Every signed report is answered " +
                  "401 until then.",
              ),
            );
          }
          // The same 401 as a forged signature, on purpose: the reply says no
          // more than it did before, and the explanation goes to the log.
          writeJson(res, 401, { error: BAD_SIGNATURE_ERROR }, options.cors);
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
          writeJson(res, 413, { error: TOO_LARGE_ERROR }, options.cors);
          return;
        }
        if (body !== undefined) {
          headers.set("content-length", String(new TextEncoder().encode(body).byteLength));
        }
      }

      // The socket first and `req.ip` only after it: `req.ip` is already a
      // forwarded address when the application set `trust proxy`, and reading
      // it here would trust a header `trustProxy` was never asked about. An
      // explicit `remoteAddress` in the options wins over both, because a
      // caller who passes one knows something this adapter does not.
      const remoteAddress = options.remoteAddress ?? req.socket?.remoteAddress ?? req.ip;
      const response = await handleReport(new Request(url, { method, headers, body }), {
        ...options,
        ...(remoteAddress === undefined ? {} : { remoteAddress }),
      });

      res.status(response.status);
      response.headers.forEach((value, name) => {
        if (res.setHeader) res.setHeader(name, value);
        else res.set?.(name, value);
      });
      const text = await response.text();
      res.send(text);
    })().catch((err: unknown) => {
      // Only the translation can fail here — handleReport answers 500 itself —
      // but a rejected promise in a route is a crashed process in Node.
      options.onError?.(err);
      try {
        res.status(500);
        res.send(JSON.stringify({ error: "Could not store the report" }));
      } catch {
        // The response was already gone; there is nothing left to say.
      }
    });
  };
}
