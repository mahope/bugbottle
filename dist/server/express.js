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
 */
import { handleReport, DEFAULT_MAX_BODY_BYTES, TOO_LARGE_ERROR, } from "./handle.js";
/** One header value: Node gives arrays for the repeatable ones. */
function headerValue(value) {
    if (Array.isArray(value))
        return value.join(", ");
    return value;
}
/** Thrown by `rawBody` when the stream is over the ceiling. */
class RawBodyTooLargeError extends Error {
}
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
async function rawBody(req, maxBytes) {
    if (typeof req[Symbol.asyncIterator] !== "function")
        return undefined;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const parts = [];
    let total = 0;
    for await (const chunk of req) {
        const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
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
async function bodyText(req, maxBytes) {
    const body = req.body;
    if (body === undefined || body === null)
        return await rawBody(req, maxBytes);
    if (typeof body === "string")
        return body;
    if (body instanceof Uint8Array)
        return new TextDecoder().decode(body);
    // An empty object is what `express.json()` leaves when there was no body,
    // and re-serialising that would look like a report with nothing in it. The
    // stream it already drained iterates zero chunks and yields "", which is not
    // JSON either, so an empty read means the same as no read at all.
    if (typeof body === "object" && Object.keys(body).length === 0) {
        const raw = await rawBody(req, maxBytes);
        return raw ? raw : "{}";
    }
    return JSON.stringify(body);
}
/**
 * Turns `handleReport` into an Express handler.
 *
 * ```ts
 * app.post("/api/bug-report", express.json({ limit: "5mb" }),
 *   expressHandler({ sinks: [toResend({ apiKey, from, to })] }));
 * ```
 */
export function expressHandler(options = {}) {
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
                if (single === undefined)
                    continue;
                if (name === "content-length" || name === "transfer-encoding")
                    continue;
                headers.set(name, single);
            }
            let body;
            if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
                try {
                    body = await bodyText(req, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
                }
                catch (err) {
                    if (!(err instanceof RawBodyTooLargeError))
                        throw err;
                    // `handleReport` never sees this body, so the 413 is written here.
                    res.status(413);
                    if (options.cors) {
                        const origin = options.cors === true ? "*" : options.cors;
                        if (res.setHeader)
                            res.setHeader("Access-Control-Allow-Origin", origin);
                        else
                            res.set?.("Access-Control-Allow-Origin", origin);
                    }
                    if (res.setHeader)
                        res.setHeader("Content-Type", "application/json");
                    else
                        res.set?.("Content-Type", "application/json");
                    res.send(JSON.stringify({ error: TOO_LARGE_ERROR }));
                    return;
                }
                if (body !== undefined) {
                    headers.set("content-length", String(new TextEncoder().encode(body).byteLength));
                }
            }
            const response = await handleReport(new Request(url, { method, headers, body }), options);
            res.status(response.status);
            response.headers.forEach((value, name) => {
                if (res.setHeader)
                    res.setHeader(name, value);
                else
                    res.set?.(name, value);
            });
            const text = await response.text();
            res.send(text);
        })().catch((err) => {
            // Only the translation can fail here — handleReport answers 500 itself —
            // but a rejected promise in a route is a crashed process in Node.
            options.onError?.(err);
            try {
                res.status(500);
                res.send(JSON.stringify({ error: "Could not store the report" }));
            }
            catch {
                // The response was already gone; there is nothing left to say.
            }
        });
    };
}
//# sourceMappingURL=express.js.map