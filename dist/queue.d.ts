/**
 * The reports filed during the outage they describe.
 *
 * A form that says "could not be sent" when the network is down loses exactly
 * the report that mattered most: the one written while the application was
 * broken. This is a small durable queue in front of the endpoint — the report
 * is kept in `localStorage`, the reporter is thanked, and the queue drains
 * when the browser is online and the tab is visible again.
 *
 *     import { createQueue } from "bugbottle/queue";
 *     const queue = createQueue({ endpoint: "/api/feedback" });
 *     useBugReport({ endpoint: "/api/feedback", queue });
 *
 * It is its own entry point, and it does not import `send.ts`: that module
 * reaches for the console buffer and the page context, which a queue that only
 * re-POSTs a finished body has no use for. The one `fetch` below is the whole
 * of the delivery.
 *
 * ## What two tabs do to each other
 *
 * `localStorage` is shared by every tab on the origin and offers no way to
 * change it atomically, so a queue that reads the array once and writes it back
 * whole loses whatever the other tab wrote in between. Every write here instead
 * re-reads the stored array and merges by item identity: each report is given a
 * random `id` when it is queued, and a write only ever adds, updates or removes
 * the ids it means to touch. Before a report is delivered it is *claimed* — a
 * `claimedAt` timestamp written into storage — and a claim younger than 30
 * seconds tells the other tabs to leave that item alone. A failed delivery
 * releases the claim; a successful one removes the item by id from a freshly
 * read array.
 *
 * That is a lease, not a lock, and it is worth being honest about the window it
 * leaves: two tabs that read, decide and write in the same few milliseconds can
 * both claim the same report and deliver it twice. The window is the length of
 * one read-modify-write, the outcome is a duplicate rather than a loss, and the
 * server can fall back on the report fingerprint if duplicates matter to it. A
 * tab that is closed mid-delivery leaves its claim behind; the next tab picks
 * the report up 30 seconds later.
 */
import type { BugReport } from "./report-core.ts";
/** A report as it was assembled, plus when it was queued. */
export type QueuedReport = {
    /**
     * A random identity, assigned at enqueue. It is what lets two tabs merge one
     * queue: every write names the ids it touches instead of replacing the array.
     */
    id: string;
    /** Milliseconds since the epoch, for `maxAgeMs`. */
    at: number;
    body: BugReport & Record<string, unknown>;
    /**
     * When some tab took this report to deliver it. Others skip it until the
     * claim expires, so the same report is not POSTed from two tabs at once.
     */
    claimedAt?: number;
};
export type QueueOptions = {
    /** Endpoint that receives the queued reports. The same one you send to. */
    endpoint: string;
    /** `localStorage` key. Default `"bugbottle:queue"`. */
    storageKey?: string;
    /** How many reports to keep. The oldest is evicted first. Default 5. */
    maxItems?: number;
    /** How long a report may wait before it is dropped. Default 7 days. */
    maxAgeMs?: number;
    /** Extra request headers — an auth token, a CSRF header. */
    headers?: Record<string, string>;
    /** Passed to `fetch`. Set to `"include"` for a cross-origin endpoint that needs cookies. */
    credentials?: RequestCredentials;
    /** Replace the global `fetch`, mostly for tests. */
    fetch?: typeof globalThis.fetch;
};
export type Queue = {
    /** Keeps a report for later. Nothing is sent; call `flush` for that. */
    enqueue(report: BugReport & Record<string, unknown>): void;
    /** Tries to deliver everything, oldest first. Resolves with how many left. */
    flush(): Promise<number>;
    /** How many reports are waiting. */
    size(): number;
    /** Throws the queue away, in storage as well as in memory. */
    clear(): void;
    /** Removes the listeners and the pending retry. The reports stay in storage. */
    destroy(): void;
};
/**
 * A queue in front of `endpoint`. Reads whatever an earlier visit left behind,
 * then tries to deliver it — on load, when the browser comes online, and when
 * the tab becomes visible.
 */
export declare function createQueue(options: QueueOptions): Queue;
//# sourceMappingURL=queue.d.ts.map