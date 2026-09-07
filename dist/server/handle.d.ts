/**
 * One receiver for every runtime that speaks the web `Request`.
 *
 * The README's hand-written handler is still the honest way to see what
 * happens to a report, and it stays documented. This is the same sequence with
 * the boilerplate removed: authorise, bound the body, validate every field
 * through the `normalise*` helpers, optionally scrub, decide what happens to
 * the screenshot, store, then fan out to the sinks. A Next.js route handler, a
 * Hono route, a Worker, Bun or Deno is three lines; Express gets the small
 * adapter next door.
 *
 * Nothing here reads your environment and nothing here is a hosted service.
 * Keys, tokens and URLs are arguments, exactly as they are for the sinks.
 *
 * The failure rules are the ones the rest of the library already follows: a
 * rejected screenshot never fails a report, a sink that is down never fails a
 * report that was already stored, and an unexpected error answers 500 without
 * telling the reporter what broke.
 */
import { type Breadcrumb, type ConsoleEntry, type ElementRef, type NetworkEntry, type ReportContext, type ReportType } from "../report-core.ts";
import { type MarkdownOptions } from "../markdown.ts";
import { type ScrubOptions } from "../scrub.ts";
import { type SendReportEmailOptions } from "../sinks/resend.ts";
import { type SendReportWebhookOptions } from "../sinks/webhook.ts";
import { type CreateGithubIssueOptions } from "../sinks/github.ts";
import { type CreateLinearIssueOptions } from "../sinks/linear.ts";
/** Default ceiling for a request body: the screenshot dominates it. */
export declare const DEFAULT_MAX_BODY_BYTES: number;
/** Longest string kept for one `extra` value. */
export declare const MAX_EXTRA_STRING_LENGTH = 500;
/** How many unknown top-level keys are kept. */
export declare const MAX_EXTRA_KEYS = 20;
/** How long the whole body may take to arrive. Default 15 s. Over it answers 408. */
export declare const DEFAULT_BODY_TIMEOUT_MS = 15000;
/** How long one sink may take before it is abandoned. Default 10 s. */
export declare const DEFAULT_SINK_TIMEOUT_MS = 10000;
/** The locale-neutral answer to a report with nothing written in it. */
export declare const EMPTY_MESSAGE_ERROR = "Write a message first";
/** The answer to a body over the ceiling. Shared with the Express adapter. */
export declare const TOO_LARGE_ERROR = "Report is too large";
/**
 * A report after every field has been through its validator: the shape you can
 * write to a row without checking anything again.
 *
 * `extra` is whatever the client sent beside the known fields — a tenant id, a
 * build number, the signed-in user. It is capped rather than trusted: strings
 * are clipped, numbers and booleans pass, and anything nested is dropped,
 * because a nested object is an unbounded amount of attacker-controlled JSON.
 */
export type ValidatedReport = {
    type: ReportType;
    message: string;
    context: ReportContext;
    console: ConsoleEntry[];
    elements: ElementRef[];
    breadcrumbs: Breadcrumb[];
    network: NetworkEntry[];
    extra: Record<string, unknown>;
    /** ISO 8601 timestamp of when the server accepted it. */
    receivedAt: string;
};
/** What a sink is handed beside the report. */
export type SinkContext = {
    /** The report rendered by `toMarkdown`, screenshot link included. */
    markdown: string;
    /** Where the screenshot was stored, when a `screenshot` function stored it. */
    screenshotUrl?: string;
    /** The decoded PNG, when it was kept. */
    screenshot?: Uint8Array;
    /**
     * Aborts when the sink runs out of its `sinkTimeoutMs`. Hand it to `fetch` so
     * the request is dropped as well; the handler stops waiting either way.
     */
    signal?: AbortSignal;
};
/** A delivery. Run after `store`, in order, and never allowed to fail the reply. */
export type ReportSink = (report: ValidatedReport, ctx: SinkContext) => Promise<unknown>;
/** What `respond` is handed, and what a caller gets back from the pieces below. */
export type HandleReportResult = {
    report: ValidatedReport;
    /** The id `store` returned, when it returned one. */
    id?: string;
    /** The decoded PNG, when `screenshot` was `"keep"`. */
    screenshot?: Uint8Array;
    /** The URL a `screenshot` function returned. */
    screenshotUrl?: string;
    markdown: string;
    /** One entry per sink that threw, in the order the sinks were listed. */
    sinkErrors: unknown[];
};
/** How much traffic one key may send. In memory, so per instance. */
export type RateLimitOptions = {
    limit: number;
    windowMs: number;
    /**
     * What counts as one caller. Default: the forwarded client address, which is
     * a header and therefore a claim — see the README. Clipped to 64 characters,
     * because the key is a map entry an attacker would otherwise size.
     */
    key?: (request: Request) => string;
};
/** Longest key kept for a bucket: a header is not allowed to size the map. */
export declare const MAX_RATE_LIMIT_KEY_LENGTH = 64;
/** Hard ceiling on the bucket map, whatever the traffic looks like. */
export declare const MAX_RATE_LIMIT_BUCKETS = 10000;
export type HandleReportOptions = {
    /** False answers 401 before the body is read. */
    authorize?: (request: Request) => boolean | Promise<boolean>;
    /** Ceiling for the request body. Default 4 MB. Over it answers 413. */
    maxBodyBytes?: number;
    /** How long the whole body may take to arrive. Default 15 s. Over it answers 408. */
    bodyTimeoutMs?: number;
    /** How long one sink may take before it is abandoned and counted as failed. Default 10 s. */
    sinkTimeoutMs?: number;
    /** Run `scrubReport` on the server as well, whatever the client did. */
    scrub?: boolean | ScrubOptions;
    /**
     * What happens to the picture. `"keep"` (the default) puts the decoded bytes
     * in the result and the sink context; `"drop"` throws it away without
     * decoding it; a function stores it and returns a URL, which reaches
     * `toMarkdown` and the sinks as `screenshotUrl`.
     */
    screenshot?: "drop" | "keep" | ((bytes: Uint8Array, report: ValidatedReport) => Promise<string | undefined>);
    /** Where the report is written. Its `id` is what the client is told. */
    store?: (report: ValidatedReport, screenshot?: Uint8Array) => Promise<{
        id?: string;
    } | void> | {
        id?: string;
    } | void;
    /** Deliveries, run in order after `store`. A failure is collected, not thrown. */
    sinks?: ReportSink[];
    /** Called once per failed sink, with its position in `sinks`. */
    onSinkError?: (error: unknown, index: number) => void;
    /** Called for anything unexpected, before the 500 goes out. */
    onError?: (error: unknown) => void;
    /** Replaces the default reply — 201 `{ id }`, or 202 `{}` without one. */
    respond?: (result: HandleReportResult) => Response;
    /** `true` for `*`, or the one origin you allow. Also answers `OPTIONS`. */
    cors?: string | boolean;
    /** In-memory, per instance. Fine per serverless isolate, not shared. */
    rateLimit?: RateLimitOptions;
    /** Passed through to `toMarkdown` — extra facts, a heading level. */
    markdown?: MarkdownOptions;
};
/** Exported for tests, which would otherwise leak counts into each other. */
export declare function resetRateLimits(): void;
/**
 * The unknown top-level keys, capped. Strings are clipped, numbers and
 * booleans pass as they are, and anything else — an object, an array, a
 * function that arrived as JSON cannot — is left out.
 */
export declare function collectExtra(payload: Record<string, unknown>): Record<string, unknown>;
/**
 * Validates a parsed body into a `ValidatedReport`, or returns null when there
 * is no message — the one field without which there is nothing to store.
 */
export declare function validateReport(payload: unknown): ValidatedReport | null;
/** A sink that never answered. Counted exactly like a sink that threw. */
export declare class SinkTimeoutError extends Error {
    constructor(ms: number);
}
/**
 * Turns an incoming request into a stored, delivered report and a `Response`.
 *
 * ```ts
 * export const POST = (req: Request) =>
 *   handleReport(req, { sinks: [toResend({ apiKey, from, to })] });
 * ```
 */
export declare function handleReport(request: Request, options?: HandleReportOptions): Promise<Response>;
/** Sends every report on to Resend. The screenshot is attached when it was kept. */
export declare function toResend(options: Omit<SendReportEmailOptions, "screenshot">): ReportSink;
/** POSTs every report to a webhook — `json`, `slack` or `discord`. */
export declare function toWebhook(options: SendReportWebhookOptions): ReportSink;
/** Files every report as a GitHub issue, linking the stored screenshot. */
export declare function toGithub(options: CreateGithubIssueOptions): ReportSink;
/** Files every report as a Linear issue, linking the stored screenshot. */
export declare function toLinear(options: CreateLinearIssueOptions): ReportSink;
//# sourceMappingURL=handle.d.ts.map