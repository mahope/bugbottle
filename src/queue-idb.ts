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

import type { QueuedReport, QueueStorage } from "./queue.ts";

export type IdbStorageOptions = {
  /** Database to open. Default `"bugbottle"`. */
  databaseName?: string;
  /** Object store inside it. Default `"queue"`. */
  storeName?: string;
  /** The key the array of reports is stored under. Default `"bugbottle:queue"`. */
  storageKey?: string;
};

const DEFAULT_DATABASE_NAME = "bugbottle";
const DEFAULT_STORE_NAME = "queue";
const DEFAULT_STORAGE_KEY = "bugbottle:queue";

/** An IndexedDB request as a promise. Every call in here is one of these. */
function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Where the reports go. Hand it to `createQueue` as `storage`.
 *
 * Nothing is opened until the queue first reads or writes, so this costs a
 * closure on a page that never files a report. A browser with no IndexedDB —
 * a locked-down page, an old WebView — makes `read` answer with nothing and
 * `update` reject, which is what the queue treats as "storage refused": it
 * drops the pictures, and then goes memory-only. The reports are still sent.
 */
export function createIdbStorage(options: IdbStorageOptions = {}): QueueStorage {
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;

  let opening: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    // One connection for the life of the page. A rejected open is not cached,
    // so a browser that refused once because the disk was full is asked again.
    if (opening) return opening;
    const factory = globalThis.indexedDB;
    if (!factory) return Promise.reject(new Error("IndexedDB is unavailable"));
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName, 1);
      request.onupgradeneeded = () => {
        // Keyed by the caller, not by a key path: what is stored is one array
        // under one name, which is the same shape `localStorage` holds.
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB would not open"));
      // Another tab is holding an older version open. Nothing here upgrades
      // twice, so this only ever fires on a database somebody else named.
      request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
    }).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  }

  /** Runs one transaction and resolves when it has actually committed. */
  async function transact<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const db = await open();
    const tx = db.transaction(storeName, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      // A quota the write did not fit in arrives here rather than on the
      // request, which is the whole reason the commit is awaited.
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction was aborted"));
    });
    // The commit is awaited below, but a request that fails first rejects this
    // one with nobody yet waiting on it. Claiming it here keeps a refused
    // write — the case this whole seam exists for — from surfacing as an
    // unhandled rejection.
    void done.catch(() => {});
    const result = await run(tx.objectStore(storeName));
    await done;
    return result;
  }

  return {
    async read(): Promise<QueuedReport[]> {
      try {
        const stored = await transact("readonly", (store) =>
          promised<unknown>(store.get(storageKey)),
        );
        return Array.isArray(stored) ? (stored as QueuedReport[]) : [];
      } catch {
        // A store that cannot be read is a store with nothing in it. The queue
        // keeps what it holds in memory and goes on sending.
        return [];
      }
    },
    update(change): Promise<QueuedReport[]> {
      // Read and write in one `readwrite` transaction: the browser orders
      // those per database and per tab alike, so the read-modify-write two
      // tabs race for is decided here rather than by whoever wrote last.
      return transact("readwrite", async (store) => {
        const stored: unknown = await promised(store.get(storageKey));
        const next = change(Array.isArray(stored) ? (stored as QueuedReport[]) : []);
        if (next.length === 0) await promised(store.delete(storageKey));
        else await promised(store.put(next, storageKey));
        return next;
      });
    },
  };
}
