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
import { registerNetworkSource } from "./registry.js";
import { MAX_NETWORK_ENTRIES } from "./report-core.js";
import { scrubUrl } from "./scrub.js";
let buffer = [];
let initialised = false;
let maxEntries = MAX_NETWORK_ENTRIES;
let slowMs = 2000;
let recordAll = false;
let beforeRequest = null;
let shouldIgnore = null;
/** One undo per thing `initNetwork` patched, so reset cannot forget one. */
let undo = [];
/**
 * Path and query for a same-origin request, the whole thing minus the fragment
 * for a cross-origin one. Which host failed is half the answer when the call
 * went somewhere else; when it did not, the origin is the page's own and says
 * nothing. The fragment is left out either way — it is the part of a URL that
 * applications habitually put identifiers in.
 *
 * Takes whatever `fetch` was handed: a string, a `URL`, or a `Request`.
 */
function urlOf(raw) {
    const input = typeof raw === "string" ? raw : String(raw?.url ?? raw ?? "");
    try {
        const parsed = new URL(input, globalThis.location?.href);
        const path = parsed.pathname + parsed.search;
        return parsed.origin === globalThis.location?.origin ? path : parsed.origin + path;
    }
    catch {
        return input.split("#")[0] ?? "";
    }
}
function methodOf(raw, init) {
    const method = init?.method ?? raw?.method;
    return (typeof method === "string" ? method : "GET").toUpperCase();
}
/**
 * Whether an entry is worth keeping. A fast 200 is the request that worked,
 * and there are hundreds of those in any session.
 */
function isInteresting(status, ms, error) {
    return recordAll || error || status >= 400 || ms > slowMs;
}
function record(method, raw, status, ms, error) {
    if (!isInteresting(status, ms, error))
        return;
    const url = urlOf(raw);
    if (shouldIgnore) {
        try {
            if (shouldIgnore(url))
                return;
        }
        catch {
            // An `ignore` that throws cannot say yes, and a request the caller may
            // have meant to hide is not one to record on a guess. Drop it.
            return;
        }
    }
    const entry = {
        ts: new Date().toISOString(),
        method,
        url: scrubUrl(url),
        status,
        ms: Math.round(ms),
    };
    if (error)
        entry.error = true;
    let kept = entry;
    if (beforeRequest) {
        try {
            kept = beforeRequest(entry);
        }
        catch {
            // `record` is reached from the host's own request handling. A hook that
            // cannot decide is read the same way as one that returned null: the
            // entry is dropped, and the application carries on.
            return;
        }
    }
    if (!kept)
        return;
    buffer.push(kept);
    if (buffer.length > maxEntries)
        buffer = buffer.slice(-maxEntries);
}
/**
 * How many entries to keep, given what the caller asked for. `slice(-0)` is
 * the whole array and `slice(-NaN)` is too, so an unchecked 0 or NaN removes
 * the bound instead of tightening it. An explicit 0 means "record nothing";
 * anything else that is not a finite positive number falls back to the default.
 */
function resolveMaxEntries(requested) {
    if (requested === 0)
        return 0;
    return typeof requested === "number" && Number.isFinite(requested) && requested > 0
        ? Math.max(1, Math.floor(requested))
        : MAX_NETWORK_ENTRIES;
}
/**
 * The default `ignore`: the endpoint the reports themselves go to, matched on
 * everything but the query string, so a differing `?retry=2` does not let it
 * through. Both sides have been through `urlOf` by the time they are compared.
 */
function ignoreEndpoint(endpoint) {
    const target = urlOf(endpoint).split("?")[0];
    return (url) => url.split("?")[0] === target;
}
function patchFetch() {
    const original = globalThis.fetch;
    if (typeof original !== "function")
        return;
    const patched = function (input, init) {
        const method = methodOf(input, init);
        const started = Date.now();
        // The original is always called, and its result is always handed back
        // untouched. Whatever this module does with the timing, the host sees the
        // fetch it wrote — including its rejections, rethrown as they were.
        return original.call(globalThis, input, init).then((response) => {
            record(method, input, response.status, Date.now() - started, false);
            return response;
        }, (err) => {
            record(method, input, 0, Date.now() - started, true);
            throw err;
        });
    };
    globalThis.fetch = patched;
    undo.push(() => {
        globalThis.fetch = original;
    });
}
function patchXhr() {
    const ctor = globalThis.XMLHttpRequest;
    if (!ctor?.prototype?.open)
        return;
    const proto = ctor.prototype;
    const openOriginal = proto.open;
    const sendOriginal = proto.send;
    // A WeakMap rather than a property on the instance: the host's object is not
    // ours to add fields to, and a request that is never sent is collected as if
    // this module had never seen it.
    const pending = new WeakMap();
    proto.open = function (method, url, ...rest) {
        pending.set(this, { method: String(method ?? "GET").toUpperCase(), url: String(url ?? "") });
        return openOriginal.call(this, method, url, ...rest);
    };
    proto.send = function (body) {
        const request = pending.get(this);
        if (request) {
            const started = Date.now();
            // `loadend` is the one event that fires for every ending — load, error,
            // abort and timeout alike — so the duration is recorded exactly once.
            this.addEventListener("loadend", () => {
                const status = Number(this.status) || 0;
                record(request.method, request.url, status, Date.now() - started, status === 0);
            });
        }
        return sendOriginal.call(this, body);
    };
    undo.push(() => {
        proto.open = openOriginal;
        proto.send = sendOriginal;
    });
}
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
export function initNetwork(options = {}) {
    if (initialised)
        return;
    const cap = resolveMaxEntries(options.maxEntries);
    if (cap === 0)
        return;
    initialised = true;
    maxEntries = cap;
    slowMs =
        typeof options.slowMs === "number" && Number.isFinite(options.slowMs) && options.slowMs >= 0
            ? options.slowMs
            : 2000;
    recordAll = options.all === true;
    beforeRequest = options.beforeRequest ?? null;
    shouldIgnore = options.ignore ?? (options.endpoint ? ignoreEndpoint(options.endpoint) : null);
    patchFetch();
    patchXhr();
    registerNetworkSource(getNetwork);
}
/** A copy of what has been recorded so far, oldest first. */
export function getNetwork() {
    return [...buffer];
}
/** Whether `initNetwork` has run and not been reset since. */
export function isNetworkActive() {
    return initialised;
}
/** Empties the buffer and puts `fetch` and `XMLHttpRequest` back as they were. */
export function resetNetwork() {
    buffer = [];
    registerNetworkSource(null);
    for (const step of undo)
        step();
    undo = [];
    beforeRequest = null;
    shouldIgnore = null;
    maxEntries = MAX_NETWORK_ENTRIES;
    slowMs = 2000;
    recordAll = false;
    initialised = false;
}
//# sourceMappingURL=network.js.map