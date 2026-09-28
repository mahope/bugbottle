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
import { type HandleReportOptions } from "./handle.ts";
/** As much of a Fastify request as the adapter reads. */
export type FastifyRequestLike = {
    method?: string;
    /** Fastify keeps the raw Node request here. */
    raw?: {
        url?: string;
        headers?: Record<string, string | string[] | undefined>;
        socket?: {
            remoteAddress?: string | undefined;
        } | undefined;
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
/**
 * Turns `handleReport` into a Fastify route handler.
 *
 * ```ts
 * fastify.post("/api/bug-report", fastifyHandler({ store, sinks: [toWebhook({…})] }));
 * ```
 */
export declare function fastifyHandler(options?: HandleReportOptions): (req: FastifyRequestLike, reply: FastifyReplyLike) => void;
//# sourceMappingURL=fastify.d.ts.map