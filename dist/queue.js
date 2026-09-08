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
/** Random enough to tell two reports apart; it is an identity, not a secret. */
function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
/**
 * The line left on a report whose picture had to go. It is a note about the
 * report rather than part of it, so it travels in `notes`, which the server
 * validates like every other field and `toMarkdown` prints above the evidence.
 */
export const SCREENSHOT_NOTE = "Screenshot dropped: it did not fit in the offline queue.";
/**
 * The same report without its picture, and with a line saying there was one.
 * A report already missing its picture is returned untouched, so a second
 * attempt cannot leave the note twice.
 */
function dropPicture(item) {
    if (!item.body.screenshotDataUrl)
        return item;
    const { screenshotDataUrl: _dropped, ...rest } = item.body;
    const body = { ...rest, notes: [...(item.body.notes ?? []), SCREENSHOT_NOTE] };
    return { ...item, body: body };
}
/**
 * Runs `next` on the value: now when it is one, later when it is a promise.
 *
 * The seam has to allow async, because IndexedDB is, and the default has to
 * stay synchronous, because a page that queues a report and is closed a moment
 * later must not lose it to a microtask that never ran. So every step of the
 * queue is written once and goes through here.
 */
function later(value, next) {
    // `Awaited` because a promise flattens: `later` of something that answers
    // later with a promise is one promise, not two, and the type says so.
    return value instanceof Promise
        ? value.then(next)
        : next(value);
}
/**
 * `localStorage` as a {@link QueueStorage}, which is what a queue uses unless
 * it is handed another one.
 *
 * It throws rather than returning null in a few real browsers: Safari in
 * private mode, a page with site data blocked, a sandboxed iframe. The probe
 * is a read, not a write, because a browser that refuses writes — a full quota
 * above all — still has the reports an earlier visit stored, and refusing to
 * look at them loses the reports the queue exists to keep.
 */
function localStorageQueue(key) {
    try {
        const store = globalThis.localStorage;
        if (!store)
            return null;
        // Some browsers only throw on use, not on access.
        store.getItem("bugbottle:probe");
        const read = () => {
            try {
                // Anything else in that key is somebody else's data or a half-written
                // value. Start empty rather than throwing on every page load.
                const parsed = JSON.parse(store.getItem(key) ?? "null");
                return Array.isArray(parsed) ? parsed : [];
            }
            catch {
                return [];
            }
        };
        return {
            read,
            update(change) {
                const next = change(read());
                if (next.length === 0)
                    store.removeItem(key);
                else
                    store.setItem(key, JSON.stringify(next));
                return next;
            },
        };
    }
    catch {
        return null;
    }
}
/**
 * A queue in front of `endpoint`. Reads whatever an earlier visit left behind,
 * then tries to deliver it — on load, when the browser comes online, and when
 * the tab becomes visible.
 */
export function createQueue(options) {
    const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    const maxEntries = options.maxEntries ?? options.maxItems ?? DEFAULT_MAX_ENTRIES;
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const storage = options.storage ?? localStorageQueue(storageKey);
    let items = [];
    // Storage that reads but will not be written — a full quota, a locked-down
    // browser — leaves the queue memory-only for writes. What was already stored
    // is still worth delivering, so it is read either way.
    let writable = storage !== null;
    // Commits are applied one after another. With `localStorage` that costs
    // nothing, since every step of one is synchronous; with IndexedDB it is what
    // stops two of this tab's own commits reading the same stale array.
    let chain = undefined;
    let pending = null;
    let failures = 0;
    let nextAttempt = 0;
    let timer = null;
    let destroyed = false;
    /** What came out of storage, minus anything that is not a queued report. */
    function sanitise(stored) {
        if (!Array.isArray(stored))
            return [];
        return (stored
            .filter((item) => typeof item === "object" &&
            item !== null &&
            typeof item.at === "number" &&
            typeof item.body === "object" &&
            item.body !== null)
            // Reports queued by an older version have no id. Deriving one from the
            // time they were queued keeps every tab naming the same item the same
            // way, which is the whole job an id has here.
            .map((item) => (typeof item.id === "string" ? item : { ...item, id: `old-${item.at}` })));
    }
    function prune(list) {
        const oldest = Date.now() - maxAgeMs;
        return list
            .filter((item) => item.at > oldest)
            .sort((a, b) => a.at - b.at)
            .slice(-maxEntries);
    }
    /** One attempt at a stored write. A throw and a rejection mean the same thing. */
    function attempt(change, onRefused) {
        const keep = (list) => void (items = list);
        try {
            const done = storage?.update(change);
            if (done instanceof Promise)
                return done.then(keep, onRefused);
            if (done)
                keep(done);
            return;
        }
        catch {
            return onRefused();
        }
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
    function merge(change) {
        // What the merge worked out, whether or not storage then took it. A write
        // refused twice still has to leave the change in memory, and the array to
        // leave there is this one — not the stale `items`, which has never seen
        // what the other tabs stored.
        let merged = null;
        const apply = (stored) => {
            const map = new Map();
            for (const item of sanitise(stored))
                map.set(item.id, item);
            change?.(map);
            return (merged = prune([...map.values()]));
        };
        if (!storage || !writable) {
            items = apply(items);
            return;
        }
        return attempt(apply, () => 
        // A refused write is nearly always the quota, and a screenshot is nearly
        // always what filled it. Everything else about a report is a few hundred
        // bytes, so the second attempt is the same queue with the pictures taken
        // out and a note in their place. Only when that is refused too does the
        // queue go memory-only, which is a report lost on the next reload.
        attempt((stored) => apply(stored).map(dropPicture), () => {
            writable = false;
            items = merged ?? apply(items);
        }));
    }
    /** Applies one change to the queue, after every change asked for before it. */
    function commit(change) {
        return (chain = later(chain, () => merge(change)));
    }
    /** Takes the oldest unclaimed report and writes the claim before returning it. */
    function claimNext() {
        const now = Date.now();
        const picked = [];
        // The map is in `at` order already: `prune` sorts before every write, so
        // that is the order storage is read back in, and a merged-in report from
        // another tab is by definition one of the newest.
        const done = commit((queue) => {
            for (const item of queue.values()) {
                // Somebody is already delivering this one, or was until very recently.
                if ((item.claimedAt ?? 0) + CLAIM_MS > now)
                    continue;
                picked.push(item.id);
                queue.set(item.id, { ...item, claimedAt: now });
                return;
            }
        });
        // The merge prunes, so the item we picked may have been evicted by it.
        return later(done, () => items.find((item) => item.id === picked[0]) ?? null);
    }
    /** Hands a report back after a failed delivery, if it is still queued. */
    function release(item) {
        return commit((queue) => {
            const held = queue.get(item.id);
            // Never re-add it: another tab may have delivered it while we were
            // failing, and a resurrected report is a report sent twice.
            if (held)
                queue.set(item.id, { ...held, claimedAt: 0 });
        });
    }
    function stopTimer() {
        if (timer !== null)
            clearTimeout(timer);
        timer = null;
    }
    function retryLater() {
        // A destroyed queue schedules nothing. Without this a failure that arrives
        // after `destroy` starts a timer nobody will ever clear, and that timer
        // fails and schedules the next one, for ever.
        if (destroyed)
            return;
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
        timer.unref?.();
    }
    async function deliver() {
        while (!destroyed) {
            const item = await claimNext();
            if (!item)
                break;
            let done = false;
            try {
                const doFetch = options.fetch ?? globalThis.fetch;
                const init = {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...options.headers },
                    body: JSON.stringify(item.body),
                };
                if (options.credentials)
                    init.credentials = options.credentials;
                const response = await doFetch(options.endpoint, init);
                // A 4xx is the server saying this report is not acceptable — a
                // malformed body, a revoked token, a rejected origin. Retrying it
                // changes nothing, so it goes. A 5xx is the server having a bad day.
                done = response.ok || (response.status >= 400 && response.status < 500);
            }
            catch {
                done = false;
            }
            if (!done) {
                await release(item);
                // `destroy` may have been called while this request was in flight, and
                // a queue that is gone must not schedule the next attempt.
                retryLater();
                return items.length;
            }
            // By id, not by position: `enqueue` and the eviction it triggers may have
            // moved this report while the POST was in flight, and removing whatever
            // now sits at the head would throw away a report nobody has sent.
            await commit((queue) => void queue.delete(item.id));
        }
        if (!destroyed) {
            failures = 0;
            nextAttempt = 0;
            stopTimer();
        }
        return items.length;
    }
    function flush() {
        if (destroyed)
            return Promise.resolve(items.length);
        // Two flushes at once would send the head of the queue twice: `online` and
        // `visibilitychange` fire together often enough for that to be the normal
        // case, not the rare one. The second caller waits for the first.
        if (pending)
            return pending;
        if (Date.now() < nextAttempt)
            return Promise.resolve(items.length);
        // A commit with nothing to change is how the queue picks up what another
        // tab has stored since this one last looked, and it goes through the same
        // merge as every other write, so a memory-only queue keeps what only it
        // has. It goes through `later` rather than `then` so that a synchronous
        // storage decides what to deliver from the queue as it was when the flush
        // was asked for, not as it is a microtask afterwards.
        const started = later(commit(), () => (items.length === 0 ? 0 : deliver()));
        // Nothing to deliver, and a storage that answered at once: there is no
        // attempt for the next flush to wait behind, and holding one here would
        // make it wait for a delivery that never started.
        if (typeof started === "number")
            return Promise.resolve(started);
        pending = Promise.resolve(started).finally(() => {
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
        if (doc?.visibilityState === "visible")
            void flush();
    };
    if (win && doc) {
        win.addEventListener("online", onOnline);
        doc.addEventListener("visibilitychange", onVisible);
    }
    // Not a commit of its own first: the flush commits before it delivers, and
    // for the default storage that happens before this line returns, so a queue
    // knows its size the moment it is made.
    void flush();
    return {
        enqueue(report) {
            // Nothing is measured here. A picture that fits is a picture worth
            // keeping, and only the storage knows whether it fits; the merge asks
            // it, and drops the pictures when the answer is no.
            const item = { id: newId(), at: Date.now(), body: report };
            void commit((queue) => void queue.set(item.id, item));
        },
        flush,
        size: () => items.length,
        clear() {
            failures = 0;
            nextAttempt = 0;
            stopTimer();
            // Everything in the key, including whatever another tab put there: this
            // is the reporter saying they want none of it sent.
            void commit((queue) => queue.clear());
        },
        destroy() {
            destroyed = true;
            stopTimer();
            win?.removeEventListener("online", onOnline);
            doc?.removeEventListener("visibilitychange", onVisible);
        },
    };
}
//# sourceMappingURL=queue.js.map