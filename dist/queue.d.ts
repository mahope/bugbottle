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
 * ## Where the reports are kept
 *
 * `localStorage` is the default and is a few megabytes for the whole origin,
 * shared with whatever else the application keeps there. A screenshot is by
 * far the largest field in a report, so a write is refused sooner than anyone
 * expects — and a refused write used to mean the report never reached storage
 * at all, which is a report lost on the next reload. It now costs the picture
 * instead: the queue writes the reports again without their screenshots and
 * leaves a note on each one saying a picture existed, so the receiver can tell
 * "none was taken" from "one was taken and would not fit".
 *
 * `storage` replaces `localStorage` with anything that can read an array and
 * change it — `createIdbStorage()` from `bugbottle/queue-idb` is the one that
 * ships, and IndexedDB has room for the pictures.
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
/** A value that may already be here, or may arrive. */
export type MaybePromise<T> = T | Promise<T>;
/**
 * Where a queue keeps its reports. `localStorage` unless told otherwise; hand
 * in `createIdbStorage()` from `bugbottle/queue-idb` for the megabytes a
 * screenshot wants.
 */
export type QueueStorage = {
    /**
     * Reads, applies `change` to what was stored, writes the result back, and
     * answers with what is now stored.
     *
     * It is the only method, and deliberately: a plain `read` beside it would be
     * a second way to see the queue that no caller here can use safely, since
     * anything read outside a read-modify-write is stale the moment another tab
     * commits. The queue checks what `update` answers with rather than trusting
     * it, so a storage may hand back whatever it holds.
     *
     * It is one call rather than a read and a write so that a storage which
     * *can* be atomic gets to be: IndexedDB orders read-write transactions per
     * database, across tabs as well, where `localStorage` can only hope.
     *
     * Throws, or rejects, when the write was refused. A full quota is the
     * ordinary reason, and the queue answers it by dropping the screenshots.
     */
    update(change: (stored: QueuedReport[]) => QueuedReport[]): MaybePromise<QueuedReport[]>;
};
export type QueueOptions = {
    /** Endpoint that receives the queued reports. The same one you send to. */
    endpoint: string;
    /** `localStorage` key. Default `"bugbottle:queue"`. */
    storageKey?: string;
    /** How many reports to keep. The oldest is evicted first. Default 5. */
    maxEntries?: number;
    /**
     * @deprecated Renamed to `maxEntries` in 0.9, which is what the console
     * buffer, the breadcrumbs and the network log call the same idea. Removed in
     * 1.0 (#64). Given both, `maxEntries` is the one that counts.
     */
    maxItems?: number;
    /** How long a report may wait before it is dropped. Default 7 days. */
    maxAgeMs?: number;
    /** Extra request headers — an auth token, a CSRF header. */
    headers?: Record<string, string>;
    /** Passed to `fetch`. Set to `"include"` for a cross-origin endpoint that needs cookies. */
    credentials?: RequestCredentials;
    /** Replace the global `fetch`, mostly for tests. */
    fetch?: typeof globalThis.fetch;
    /**
     * Where the reports are kept. `localStorage` by default, and
     * `createIdbStorage()` from `bugbottle/queue-idb` when a screenshot has to
     * survive the outage with the report.
     */
    storage?: QueueStorage;
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
 * The line left on a report whose picture had to go. It is a note about the
 * report rather than part of it, so it travels in `notes`, which the server
 * validates like every other field and `toMarkdown` prints above the evidence.
 */
export declare const SCREENSHOT_NOTE = "Screenshot dropped: it did not fit in the offline queue.";
/**
 * A queue in front of `endpoint`. Reads whatever an earlier visit left behind,
 * then tries to deliver it — on load, when the browser comes online, and when
 * the tab becomes visible.
 */
export declare function createQueue(options: QueueOptions): Queue;
//# sourceMappingURL=queue.d.ts.map