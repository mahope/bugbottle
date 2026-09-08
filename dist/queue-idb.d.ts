/**
 * The offline queue, kept in IndexedDB instead of `localStorage`.
 *
 *     import { createQueue } from "bugbottle/queue";
 *     import { createIdbStorage } from "bugbottle/queue-idb";
 *
 *     const queue = createQueue({
 *       endpoint: "/api/feedback",
 *       storage: createIdbStorage(),
 *     });
 *
 * `localStorage` is a few megabytes for the whole origin, shared with whatever
 * else the application keeps there, and a screenshot as a data URL is a
 * megabyte or two on its own. The default queue answers a refused write by
 * dropping the picture, which is the right thing to do with nowhere to put it
 * — but IndexedDB has somewhere to put it. A browser gives an origin a share
 * of the free disk there, hundreds of megabytes at the least, so a queued
 * report keeps the picture that shows what went wrong.
 *
 * Two things it does better than the default, and one it does worse:
 *
 * - Room. A 2 MB report round-trips.
 * - Atomicity. `update` reads and writes inside one `readwrite` transaction,
 *   and the browser orders those per database — across tabs, not just within
 *   one. The claim two tabs race for is therefore decided by the store rather
 *   than by who wrote last.
 * - Timing. Every step is asynchronous, so a report queued in the last
 *   milliseconds before the tab is closed may not reach the disk. With
 *   `localStorage` it always does. Which of the two matters more depends on
 *   whether your reports carry pictures.
 *
 * It is its own entry point because nothing above it may pay for it: the
 * default queue is about 1.3 kB and this is the alternative, not an addition.
 * Written against no library — `idb` and friends are lovely and this is one
 * object store with one key in it.
 */
import type { QueueStorage } from "./queue.ts";
export type IdbStorageOptions = {
    /** Database to open. Default `"bugbottle"`. */
    databaseName?: string;
    /** Object store inside it. Default `"queue"`. */
    storeName?: string;
    /** The key the array of reports is stored under. Default `"bugbottle:queue"`. */
    storageKey?: string;
};
/**
 * Where the reports go. Hand it to `createQueue` as `storage`.
 *
 * Nothing is opened until the queue first writes, so this costs a closure on a
 * page that never files a report. A browser with no IndexedDB — a locked-down
 * page, an old WebView — makes `update` reject, which is what the queue treats
 * as "storage refused": it drops the pictures, and then goes memory-only. The
 * reports are still sent.
 *
 * The connection is given up when another tab asks for a newer version of the
 * database, and opened again by the next write. A page that holds on blocks
 * that tab's upgrade for as long as it is open.
 */
export declare function createIdbStorage(options?: IdbStorageOptions): QueueStorage;
//# sourceMappingURL=queue-idb.d.ts.map