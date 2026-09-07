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
 */
import { handleReport } from "./handle.js";
/** One header value: Node gives arrays for the repeatable ones. */
function headerValue(value) {
    if (Array.isArray(value))
        return value.join(", ");
    return value;
}
/** Reads the raw request stream, for a route mounted without a body parser. */
async function rawBody(req) {
    if (typeof req[Symbol.asyncIterator] !== "function")
        return undefined;
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    }
    return chunks.join("");
}
/**
 * The body as text: already-parsed JSON is re-serialised, a string or a
 * `Buffer` is taken as it is, and an unparsed request is read from the stream.
 */
async function bodyText(req) {
    const body = req.body;
    if (body === undefined || body === null)
        return await rawBody(req);
    if (typeof body === "string")
        return body;
    if (body instanceof Uint8Array)
        return new TextDecoder().decode(body);
    // An empty object is what `express.json()` leaves when there was no body,
    // and re-serialising that would look like a report with nothing in it.
    if (typeof body === "object" && Object.keys(body).length === 0) {
        return (await rawBody(req)) ?? "{}";
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
                body = await bodyText(req);
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