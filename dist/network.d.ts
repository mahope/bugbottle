/**
 * The requests that failed or dragged, kept next to the console buffer.
 *
 * "The save button does nothing" is a different report when it arrives with
 * the 500 from `POST /api/orders` that caused it. The console buffer only sees
 * what the application chose to log; a failed request is often logged nowhere
 * at all, and a slow one never is.
 *
 * By default only the interesting ones are kept: a status of 400 or more, a
 * request that failed before it got a status, and anything slower than
 * `slowMs`. A successful, fast request is noise — it would evict the entry
 * that explains the report. `all: true` records everything for the sessions
 * where that is what you want.
 *
 * Recorded: method, URL, status, duration. Never recorded: request or response
 * bodies, and never headers — that is where tokens and personal data live, and
 * a bug report is not the place for either. The URL keeps its path and query,
 * with sensitive query values redacted by `scrubUrl`; a cross-origin URL keeps
 * its origin, because which host failed is half the answer.
 *
 * This is a separate entry point (`bugbottle/network`) so an application that
 * does not import it does not carry it, and it stays under 1.2 kB gzipped.
 */
import { type NetworkEntry } from "./report-core.ts";
export type { NetworkEntry };
export type NetworkOptions = {
    /** How many requests to keep. Oldest are dropped first. Default 30. */
    maxEntries?: number;
    /** A request slower than this is kept even when it succeeded. Default 2000 ms. */
    slowMs?: number;
    /** Record every request, not only the failed and the slow ones. Default false. */
    all?: boolean;
    /**
     * Where the reports go. Requests to it are never recorded — a report that
     * describes its own delivery is a mirror, not evidence.
     */
    endpoint?: string;
    /** Skip a request entirely, by URL. Replaces the endpoint check when given. */
    ignore?: (url: string) => boolean;
    /**
     * Inspect, change or drop each entry before it is recorded. Return null to
     * drop it. This runs before anything is stored, so it is the right place to
     * redact a path or refuse a whole host.
     */
    beforeRequest?: (entry: NetworkEntry) => NetworkEntry | null;
};
/**
 * Starts recording. Call it as early as your app can manage — a request that
 * finished before this is not in the buffer.
 *
 * Safe to call more than once; only the first call patches anything. Nothing
 * here throws in a server-rendered pass: without `fetch` or `XMLHttpRequest`
 * there is simply nothing to patch. `maxEntries: 0` records nothing and
 * patches nothing at all, since a buffer that throws every entry away is pure
 * cost.
 */
export declare function initNetwork(options?: NetworkOptions): void;
/** A copy of what has been recorded so far, oldest first. */
export declare function getNetwork(): NetworkEntry[];
/** Whether `initNetwork` has run and not been reset since. */
export declare function isNetworkActive(): boolean;
/** Empties the buffer and puts `fetch` and `XMLHttpRequest` back as they were. */
export declare function resetNetwork(): void;
//# sourceMappingURL=network.d.ts.map