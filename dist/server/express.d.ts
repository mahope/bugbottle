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
import { type HandleReportOptions } from "./handle.ts";
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
    socket?: {
        remoteAddress?: string | undefined;
    } | undefined;
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
/**
 * Turns `handleReport` into an Express handler.
 *
 * ```ts
 * app.post("/api/bug-report", express.json({ limit: "5mb" }),
 *   expressHandler({ sinks: [toResend({ apiKey, from, to })] }));
 * ```
 */
export declare function expressHandler(options?: HandleReportOptions): (req: ExpressRequestLike, res: ExpressResponseLike) => void;
//# sourceMappingURL=express.d.ts.map