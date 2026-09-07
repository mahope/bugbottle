/**
 * Building a report and sending it — the part every framework adapter shares.
 *
 * Nothing here is React-specific. A Vue, Svelte or vanilla form calls
 * `buildReport` with what the user typed and `sendReport` with the result; the
 * React hook does the same underneath.
 */
import type { BugReport, ElementRef, ReportType } from "./report-core.ts";
export type BuildReportInput = {
    type: ReportType;
    message: string;
    /** A PNG data URL from `captureScreenshot`, or nothing. */
    screenshotDataUrl?: string | null;
    /** Attach the recorded console errors. Default true. */
    includeConsole?: boolean;
    /** Elements the reporter pointed at, from `pickElement`. */
    elements?: ElementRef[];
    /**
     * Extra fields to send alongside the report — an app version, a tenant id.
     * The report's own fields win if the names collide.
     */
    extra?: Record<string, unknown>;
};
/** Assembles the JSON body: message, type, page context, console, screenshot. */
export declare function buildReport(input: BuildReportInput): BugReport & Record<string, unknown>;
export type SendOptions = {
    /** Extra request headers — an auth token, a CSRF header. */
    headers?: Record<string, string>;
    /** Passed to `fetch`. Set to `"include"` for a cross-origin endpoint that needs cookies. */
    credentials?: RequestCredentials;
    signal?: AbortSignal;
    /**
     * Abort the request after this many milliseconds. Default 15 000. A hung
     * request must not leave a form stuck on "sending" until the reporter gives
     * up and closes the tab. Set to 0 to disable.
     */
    timeoutMs?: number;
    /** Replace the global `fetch`, mostly for tests. */
    fetch?: typeof globalThis.fetch;
    /**
     * Turn a failed response into a message for the reporter. Defaults to the
     * body's `error` or `message` field, then a generic one.
     */
    parseError?: (response: Response, body: unknown) => string | undefined;
};
export declare const DEFAULT_SEND_TIMEOUT_MS = 15000;
export type SendResult = {
    /** The `id` field of the response body, when the server sends one. */
    id?: string;
    body: unknown;
    response: Response;
};
/** The request was aborted by `timeoutMs` before the server answered. */
export declare class SendTimeoutError extends Error {
    constructor(timeoutMs: number);
}
/** The server answered, but not with success. `message` is safe to show. */
export declare class SendFailedError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown);
}
/**
 * POSTs a report as JSON. Resolves on a 2xx, throws `SendFailedError` on any
 * other status, `SendTimeoutError` when `timeoutMs` elapses first, and lets
 * network failures from `fetch` propagate as they are.
 */
export declare function sendReport(endpoint: string, report: BugReport & Record<string, unknown>, options?: SendOptions): Promise<SendResult>;
//# sourceMappingURL=send.d.ts.map