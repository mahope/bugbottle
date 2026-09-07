/**
 * Building a report and sending it — the part every framework adapter shares.
 *
 * Nothing here is React-specific. A Vue, Svelte or vanilla form calls
 * `buildReport` with what the user typed and `sendReport` with the result; the
 * React hook does the same underneath.
 */
import { collectContext } from "./capture.js";
import { getConsoleBuffer } from "./console-buffer.js";
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
    if (input.screenshotDataUrl)
        report.screenshotDataUrl = input.screenshotDataUrl;
    return { ...input.extra, ...report };
}
export const DEFAULT_SEND_TIMEOUT_MS = 15_000;
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
 */
export async function sendReport(endpoint, report, options = {}) {
    const doFetch = options.fetch ?? globalThis.fetch;
    const init = {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        body: JSON.stringify(report),
    };
    if (options.credentials)
        init.credentials = options.credentials;
    const timeoutMs = options.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", onOuterAbort);
    if (options.signal?.aborted)
        onOuterAbort();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort("timeout"), timeoutMs) : null;
    init.signal = controller.signal;
    let response;
    let body;
    try {
        response = await doFetch(endpoint, init);
        body = await response.json().catch(() => null);
    }
    catch (err) {
        if (controller.signal.aborted && controller.signal.reason === "timeout") {
            throw new SendTimeoutError(timeoutMs);
        }
        throw err;
    }
    finally {
        if (timer)
            clearTimeout(timer);
        options.signal?.removeEventListener("abort", onOuterAbort);
    }
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
//# sourceMappingURL=send.js.map