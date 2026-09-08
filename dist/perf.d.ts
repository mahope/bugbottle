/**
 * Was it slow, and what state was the browser in?
 *
 * Two questions a bug report almost never answers and almost always needs to.
 * "The page hung" is a different report when it arrives with an LCP of 8.4
 * seconds and four long tasks, and "I was logged out" is a different report
 * when it arrives with no `authToken` in `localStorage`.
 *
 * `initPerf` reads the Web Vitals the browser has already measured — LCP, CLS
 * and INP through `PerformanceObserver`, TTFB and the load milestones from the
 * navigation entry, long tasks by count and total, and the JS heap where
 * Chromium exposes it — without bundling `web-vitals`. The observers are
 * created with `buffered: true` so entries from before this ran are delivered
 * anyway, but call it as early as your app can manage: `buffered` covers the
 * browser's own buffer, and that buffer is finite.
 *
 * The storage snapshot is taken when the report is built, not when this runs,
 * because what matters is what was stored when the reporter hit send. It lists
 * key names and value lengths, and cookie names. Never values — except the
 * keys the integrator named in `allowValues`, which is opt-in per key and
 * clipped to 200 characters. Cookie values are never included at all, on any
 * setting: a cookie is where the session lives.
 *
 * This is a separate entry point (`bugbottle/perf`) so an application that
 * does not import it does not carry it, and it stays under 1.3 kB gzipped.
 */
import { type PerfSnapshot, type StorageKeyRef, type StorageSnapshot } from "./report-core.ts";
export type { PerfSnapshot, StorageKeyRef, StorageSnapshot };
export type PerfOptions = {
    /** Measure the Web Vitals and the load milestones. Default true. */
    vitals?: boolean;
    /** Take the storage snapshot when a report is built. Default true. */
    storage?: boolean;
    /**
     * Keys whose values may travel with the report, by exact name, looked up in
     * `localStorage` first and then `sessionStorage`. Nothing is included
     * without being named here, and a cookie value is never included at all.
     */
    allowValues?: string[];
    /** How many keys of each store to list. Default 50. */
    maxKeys?: number;
};
/**
 * Starts measuring. Call it as early as your app can manage — ideally in the
 * same module that mounts the panel, before anything else runs.
 *
 * Safe to call more than once; only the first call observes anything. Nothing
 * here throws in a server-rendered pass: without `PerformanceObserver` and
 * without `performance` there is simply nothing to measure, and the storage
 * snapshot is registered anyway so it can still be taken in the browser.
 *
 * Returns the `stop()` that undoes it.
 */
export declare function initPerf(options?: PerfOptions): () => void;
/**
 * What has been measured so far, or null when nothing has. Called by
 * `buildReport` through the registry, at the moment a report is written.
 */
export declare function getPerf(): PerfSnapshot | null;
/**
 * The stores as they are right now: names and lengths, plus the values of the
 * allow-listed keys and nothing else. Cookie *names* only — a cookie value is
 * never included, whatever the allow-list says, because that is where sessions
 * live and a bug report is not a place to put one.
 */
export declare function getStorageSnapshot(): StorageSnapshot | null;
/** Whether `initPerf` has run and not been reset since. */
export declare function isPerfActive(): boolean;
/**
 * Disconnects the observers, forgets the measurements and unregisters both
 * sources, so a later report carries neither block. This is what `initPerf`
 * returns.
 */
export declare function resetPerf(): void;
//# sourceMappingURL=perf.d.ts.map