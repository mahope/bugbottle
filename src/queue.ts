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

const DEFAULT_STORAGE_KEY = "bugbottle:queue";
const DEFAULT_MAX_ENTRIES = 5;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 300_000;

/**
 * How long a claim keeps the other tabs off a report. Long enough to cover a
 * slow POST, short enough that a tab closed mid-delivery does not strand the
 * report for the rest of the day.
 */
const CLAIM_MS = 30_000;

/**
 * The point at which a queued report loses its picture. `localStorage` is a
 * few megabytes for the whole origin, shared with whatever else the
 * application keeps there, and a screenshot is by far the largest field in a
 * report. A report without its picture is still worth sending; a quota error
 * that throws the queue away is not.
 */
const MAX_ITEM_BYTES = 1_000_000;

/** Random enough to tell two reports apart; it is an identity, not a secret. */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A queue in front of `endpoint`. Reads whatever an earlier visit left behind,
 * then tries to deliver it — on load, when the browser comes online, and when
 * the tab becomes visible.
 */
export function createQueue(options: QueueOptions): Queue {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const maxEntries = options.maxEntries ?? options.maxItems ?? DEFAULT_MAX_ENTRIES;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const storage = openStorage();

  let items: QueuedReport[] = [];
  // Storage that reads but will not be written — a full quota, a locked-down
  // browser — leaves the queue memory-only for writes. What was already stored
  // is still worth delivering, so it is read either way.
  let writable = storage !== null;
  let pending: Promise<number> | null = null;
  let failures = 0;
  let nextAttempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function read(): QueuedReport[] {
    try {
      const raw = storage?.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      // Anything else in that key is somebody else's data or a half-written
      // value. Start empty rather than throwing on every page load.
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is QueuedReport =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as QueuedReport).at === "number" &&
            typeof (item as QueuedReport).body === "object" &&
            (item as QueuedReport).body !== null,
        )
        // Reports queued by an older version have no id. Deriving one from the
        // time they were queued keeps every tab naming the same item the same
        // way, which is the whole job an id has here.
        .map((item) => (typeof item.id === "string" ? item : { ...item, id: `old-${item.at}` }));
    } catch {
      return [];
    }
  }

  function prune(list: QueuedReport[]): QueuedReport[] {
    const oldest = Date.now() - maxAgeMs;
    return list
      .filter((item) => item.at > oldest)
      .sort((a, b) => a.at - b.at)
      .slice(-maxEntries);
  }

  /**
   * Re-reads the queue, lets `change` add, update or remove the ids it means to
   * touch, writes the result back and keeps it as the in-memory copy.
   *
   * Reading first is the whole of the multi-tab fix: the other tab's reports
   * are merged in rather than overwritten, and a report it has just delivered
   * stays deleted rather than being resurrected from our stale array. The only
   * time memory is the base is when storage cannot be written, because then
   * memory is the only copy there is.
   */
  function commit(change?: (queue: Map<string, QueuedReport>) => void): void {
    const map = new Map<string, QueuedReport>();
    for (const item of writable ? read() : items) map.set(item.id, item);
    change?.(map);
    items = prune([...map.values()]);
    if (!storage || !writable) return;
    try {
      if (items.length === 0) storage.removeItem(storageKey);
      else storage.setItem(storageKey, JSON.stringify(items));
    } catch {
      // A full quota or a locked-down browser means memory-only from here on.
      // Losing the queue is not a reason to lose the send.
      writable = false;
    }
  }

  /** Takes the oldest unclaimed report and writes the claim before returning it. */
  function claimNext(): QueuedReport | null {
    const now = Date.now();
    const picked: string[] = [];
    // The map is in `at` order already: `prune` sorts before every write, so
    // that is the order storage is read back in, and a merged-in report from
    // another tab is by definition one of the newest.
    commit((queue) => {
      for (const item of queue.values()) {
        // Somebody is already delivering this one, or was until very recently.
        if ((item.claimedAt ?? 0) + CLAIM_MS > now) continue;
        picked.push(item.id);
        queue.set(item.id, { ...item, claimedAt: now });
        return;
      }
    });
    const id = picked[0];
    // The merge prunes, so the item we picked may have been evicted by it.
    return items.find((item) => item.id === id) ?? null;
  }

  /** Hands a report back after a failed delivery, if it is still queued. */
  function release(item: QueuedReport): void {
    commit((queue) => {
      const held = queue.get(item.id);
      // Never re-add it: another tab may have delivered it while we were
      // failing, and a resurrected report is a report sent twice.
      if (held) queue.set(item.id, { ...held, claimedAt: 0 });
    });
  }

  function stopTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function retryLater(): void {
    // A destroyed queue schedules nothing. Without this a failure that arrives
    // after `destroy` starts a timer nobody will ever clear, and that timer
    // fails and schedules the next one, for ever.
    if (destroyed) return;
    failures += 1;
    const delay = Math.min(MIN_BACKOFF_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
    nextAttempt = Date.now() + delay;
    stopTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
    // Node keeps the process alive for a pending timer; a browser does not
    // care either way. A retry must not hold a test run or a script open.
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  async function deliver(): Promise<number> {
    while (!destroyed) {
      const item = claimNext();
      if (!item) break;
      let done = false;
      try {
        const doFetch = options.fetch ?? globalThis.fetch;
        const init: RequestInit = {
          method: "POST",
          headers: { "Content-Type": "application/json", ...options.headers },
          body: JSON.stringify(item.body),
        };
        if (options.credentials) init.credentials = options.credentials;
        const response = await doFetch(options.endpoint, init);
        // A 4xx is the server saying this report is not acceptable — a
        // malformed body, a revoked token, a rejected origin. Retrying it
        // changes nothing, so it goes. A 5xx is the server having a bad day.
        done = response.ok || (response.status >= 400 && response.status < 500);
      } catch {
        done = false;
      }
      if (!done) {
        release(item);
        // `destroy` may have been called while this request was in flight, and
        // a queue that is gone must not schedule the next attempt.
        retryLater();
        return items.length;
      }
      // By id, not by position: `enqueue` and the eviction it triggers may have
      // moved this report while the POST was in flight, and removing whatever
      // now sits at the head would throw away a report nobody has sent.
      commit((queue) => void queue.delete(item.id));
    }
    if (!destroyed) {
      failures = 0;
      nextAttempt = 0;
      stopTimer();
    }
    return items.length;
  }

  function flush(): Promise<number> {
    if (destroyed) return Promise.resolve(items.length);
    // Two flushes at once would send the head of the queue twice: `online` and
    // `visibilitychange` fire together often enough for that to be the normal
    // case, not the rare one. The second caller waits for the first.
    if (pending) return pending;
    if (Date.now() < nextAttempt) return Promise.resolve(items.length);
    // Another tab may have queued something since this one last looked. When
    // storage cannot be written, memory holds reports storage has never seen
    // and re-reading would throw them away.
    if (writable) items = prune(read());
    if (items.length === 0) return Promise.resolve(0);
    pending = deliver().finally(() => {
      pending = null;
    });
    return pending;
  }

  const onOnline = () => {
    // The backoff was waiting for a network that has just come back, so the
    // remaining delay is meaningless. Try at once.
    failures = 0;
    nextAttempt = 0;
    void flush();
  };
  // The window and the document are held rather than looked up again, so
  // `destroy` removes the listeners from the objects they were added to even
  // if the page is being torn down around it.
  const win = typeof window === "undefined" ? null : window;
  const doc = typeof document === "undefined" ? null : document;
  const onVisible = () => {
    if (doc?.visibilityState === "visible") void flush();
  };

  if (win && doc) {
    win.addEventListener("online", onOnline);
    doc.addEventListener("visibilitychange", onVisible);
  }

  commit();
  void flush();

  return {
    enqueue(report) {
      let body = report;
      // Measured on the item as it will be stored, because that is what the
      // quota counts. Dropping the picture keeps everything that describes
      // the bug: the message, the console, the breadcrumbs, the requests.
      if (JSON.stringify(body).length > MAX_ITEM_BYTES && body.screenshotDataUrl) {
        const { screenshotDataUrl: _dropped, ...rest } = body;
        body = rest as BugReport & Record<string, unknown>;
      }
      const item: QueuedReport = { id: newId(), at: Date.now(), body };
      commit((queue) => void queue.set(item.id, item));
    },
    flush,
    size: () => items.length,
    clear() {
      failures = 0;
      nextAttempt = 0;
      stopTimer();
      // Everything in the key, including whatever another tab put there: this
      // is the reporter saying they want none of it sent.
      commit((queue) => queue.clear());
    },
    destroy() {
      destroyed = true;
      stopTimer();
      win?.removeEventListener("online", onOnline);
      doc?.removeEventListener("visibilitychange", onVisible);
    },
  };
}

/**
 * `localStorage` throws rather than returning null in a few real browsers:
 * Safari in private mode, a page with site data blocked, a sandboxed iframe.
 * The probe is a read, not a write, because a browser that refuses writes —
 * a full quota above all — still has the reports an earlier visit stored, and
 * refusing to look at them loses the reports the queue exists to keep. A write
 * that fails is caught where it happens and turns the queue memory-only.
 */
function openStorage(): Storage | null {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    // Some browsers only throw on use, not on access.
    store.getItem("bugbottle:probe");
    return store;
  } catch {
    return null;
  }
}
