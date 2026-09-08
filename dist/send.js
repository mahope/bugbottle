/**
 * Building a report and sending it — the part every framework adapter shares.
 *
 * Nothing here is React-specific. A Vue, Svelte or vanilla form calls
 * `buildReport` with what the user typed and `sendReport` with the result; the
 * React hook does the same underneath.
 */
import { collectContext } from "./capture.js";
import { getConsoleBuffer } from "./console-buffer.js";
import { readBreadcrumbs, readNetwork, readPerf, readStorage } from "./registry.js";
/** Assembles the JSON body: message, type, page context, console, screenshot. */
export function buildReport(input) {
    const report = {
        type: input.type,
        message: input.message.trim(),
        context: collectContext(),
    };
    if (input.includeConsole ?? true)
        report.console = getConsoleBuffer();
    if (input.elements && input.elements.length > 0)
        report.elements = input.elements;
    if (input.includeBreadcrumbs ?? true) {
        const crumbs = readBreadcrumbs();
        if (crumbs && crumbs.length > 0)
            report.breadcrumbs = crumbs;
    }
    if (input.includeNetwork ?? true) {
        const requests = readNetwork();
        if (requests && requests.length > 0)
            report.network = requests;
    }
    if (input.includePerf ?? true) {
        const perf = readPerf();
        if (perf)
            report.perf = perf;
        const storage = readStorage();
        if (storage)
            report.storage = storage;
    }
    if (input.screenshotDataUrl)
        report.screenshotDataUrl = input.screenshotDataUrl;
    const body = { ...input.extra, ...report };
    return input.scrub ? input.scrub(body) : body;
}
export const DEFAULT_SEND_TIMEOUT_MS = 15_000;
/**
 * The largest body `keepalive` is used for. The browser limit is 64 KiB across
 * every keepalive request a page has in flight; this leaves room for a second
 * one rather than spending the whole allowance on the first.
 */
export const KEEPALIVE_MAX_BYTES = 60_000;
/** The request was aborted by `timeoutMs` before the server answered. */
export class SendTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`No answer from the endpoint within ${timeoutMs} ms`);
        this.name = "SendTimeoutError";
    }
}
/** The server answered, but not with success. `message` is safe to show. */
export class SendFailedError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.name = "SendFailedError";
        this.status = status;
        this.body = body;
    }
}
/**
 * POSTs a report as JSON. Resolves on a 2xx, throws `SendFailedError` on any
 * other status, `SendTimeoutError` when `timeoutMs` elapses first, and lets
 * network failures from `fetch` propagate as they are.
 *
 * `options.beforeSend` runs first and can drop the report, in which case this
 * resolves `{ dropped: true }` and never touches the network.
 */
export async function sendReport(endpoint, report, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onOuterAbort);
    if (options.signal?.aborted)
        onOuterAbort();
    // The clock starts before `beforeSend`, not after it. An async hook that
    // never settles — a permission dialog nobody answers, a fetch of its own to a
    // dead host — leaves the form on "sending" for ever, which is exactly the
    // failure `timeoutMs` exists to bound. The whole send is on the clock.
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort("timeout"), timeoutMs) : null;
    const timedOut = () => controller.signal.aborted && controller.signal.reason === "timeout";
    let payload = report;
    try {
        if (options.beforeSend) {
            const decided = await Promise.race([
                Promise.resolve(options.beforeSend(payload)),
                rejectWhenAborted(controller.signal),
            ]);
            if (decided === null || decided === undefined) {
                return { dropped: true, body: null, response: null };
            }
            payload = decided;
        }
        const doFetch = options.fetch ?? globalThis.fetch;
        const serialised = JSON.stringify(payload);
        const headers = {
            "Content-Type": "application/json",
            ...options.headers,
        };
        if (options.sign) {
            // Raced against the signal for the same reason `beforeSend` is: a signer
            // that never settles must not leave the form on "sending" for ever.
            const signed = await Promise.race([
                Promise.resolve(options.sign(serialised)),
                rejectWhenAborted(controller.signal),
            ]);
            Object.assign(headers, signed);
        }
        const init = {
            method: "POST",
            headers,
            body: serialised,
            signal: controller.signal,
        };
        if (options.credentials)
            init.credentials = options.credentials;
        if (options.keepalive && serialised.length < KEEPALIVE_MAX_BYTES)
            init.keepalive = true;
        const response = await doFetch(endpoint, init);
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            const fromBody = body;
            const message = options.parseError?.(response, body) ||
                (typeof fromBody?.error === "string" && fromBody.error) ||
                (typeof fromBody?.message === "string" && fromBody.message) ||
                `Request failed with status ${response.status}`;
            throw new SendFailedError(message, response.status, body);
        }
        const id = body?.id;
        return { id: typeof id === "string" ? id : undefined, body, response };
    }
    catch (err) {
        const failure = err instanceof SendFailedError || !timedOut() ? err : new SendTimeoutError(timeoutMs);
        if (options.onFailure) {
            try {
                await options.onFailure(payload, failure);
            }
            catch {
                // A queue that cannot write must not replace the error that says the
                // report never arrived. The send failed either way.
            }
        }
        throw failure;
    }
    finally {
        if (timer)
            clearTimeout(timer);
        options.signal?.removeEventListener("abort", onOuterAbort);
    }
}
/**
 * A promise that rejects the moment the signal aborts, so anything awaited can
 * be raced against it. `Promise.race` subscribes to both sides, so the loser is
 * never an unhandled rejection.
 */
function rejectWhenAborted(signal) {
    return new Promise((_resolve, reject) => {
        const fail = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
        if (signal.aborted)
            fail();
        else
            signal.addEventListener("abort", fail, { once: true });
    });
}
//# sourceMappingURL=send.js.map