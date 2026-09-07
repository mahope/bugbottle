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
 */
const DEFAULT_STORAGE_KEY = "bugbottle:queue";
const DEFAULT_MAX_ITEMS = 5;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 300_000;
/**
 * The point at which a queued report loses its picture. `localStorage` is a
 * few megabytes for the whole origin, shared with whatever else the
 * application keeps there, and a screenshot is by far the largest field in a
 * report. A report without its picture is still worth sending; a quota error
 * that throws the queue away is not.
 */
const MAX_ITEM_BYTES = 1_000_000;
/**
 * A queue in front of `endpoint`. Reads whatever an earlier visit left behind,
 * then tries to deliver it — on load, when the browser comes online, and when
 * the tab becomes visible.
 */
export function createQueue(options) {
    const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const storage = openStorage();
    let items = prune(read());
    let pending = null;
    let failures = 0;
    let nextAttempt = 0;
    let timer = null;
    function read() {
        try {
            const raw = storage?.getItem(storageKey);
            const parsed = raw ? JSON.parse(raw) : null;
            // Anything else in that key is somebody else's data or a half-written
            // value. Start empty rather than throwing on every page load.
            if (!Array.isArray(parsed))
                return [];
            return parsed.filter((item) => typeof item === "object" &&
                item !== null &&
                typeof item.at === "number" &&
                typeof item.body === "object" &&
                item.body !== null);
        }
        catch {
            return [];
        }
    }
    function persist() {
        if (!storage)
            return;
        try {
            if (items.length === 0)
                storage.removeItem(storageKey);
            else
                storage.setItem(storageKey, JSON.stringify(items));
        }
        catch {
            // A full quota or a locked-down browser means memory-only from here on.
            // Losing the queue is not a reason to lose the send.
        }
    }
    function prune(list) {
        const oldest = Date.now() - maxAgeMs;
        return list.filter((item) => item.at > oldest).slice(-maxItems);
    }
    function stopTimer() {
        if (timer !== null)
            clearTimeout(timer);
        timer = null;
    }
    function retryLater() {
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
        items = prune(items);
        while (items.length > 0) {
            const item = items[0];
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
                persist();
                retryLater();
                return items.length;
            }
            items.shift();
            persist();
        }
        failures = 0;
        nextAttempt = 0;
        stopTimer();
        return 0;
    }
    function flush() {
        // Two flushes at once would send the head of the queue twice: `online` and
        // `visibilitychange` fire together often enough for that to be the normal
        // case, not the rare one. The second caller waits for the first.
        if (pending)
            return pending;
        if (items.length === 0)
            return Promise.resolve(0);
        if (Date.now() < nextAttempt)
            return Promise.resolve(items.length);
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
        if (doc?.visibilityState === "visible")
            void flush();
    };
    if (win && doc) {
        win.addEventListener("online", onOnline);
        doc.addEventListener("visibilitychange", onVisible);
    }
    void flush();
    return {
        enqueue(report) {
            let body = report;
            // Measured on the item as it will be stored, because that is what the
            // quota counts. Dropping the picture keeps everything that describes
            // the bug: the message, the console, the breadcrumbs, the requests.
            if (JSON.stringify(body).length > MAX_ITEM_BYTES && body.screenshotDataUrl) {
                const { screenshotDataUrl: _dropped, ...rest } = body;
                body = rest;
            }
            items = prune([...items, { at: Date.now(), body }]);
            persist();
        },
        flush,
        size: () => items.length,
        clear() {
            items = [];
            failures = 0;
            nextAttempt = 0;
            stopTimer();
            persist();
        },
        destroy() {
            stopTimer();
            win?.removeEventListener("online", onOnline);
            doc?.removeEventListener("visibilitychange", onVisible);
        },
    };
}
/**
 * `localStorage` throws rather than returning null in a few real browsers:
 * Safari in private mode, a page with site data blocked, a sandboxed iframe.
 * Reading it once here means the rest of the module can treat "no storage" as
 * an ordinary state and stay memory-only for the life of the page.
 */
function openStorage() {
    try {
        const store = globalThis.localStorage;
        if (!store)
            return null;
        // Some browsers only throw on use, not on access.
        const probe = "bugbottle:probe";
        store.setItem(probe, "1");
        store.removeItem(probe);
        return store;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=queue.js.map