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
    /** The raw stream, read when nothing parsed the body. */
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
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