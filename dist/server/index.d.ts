/**
 * Server-side helpers for the endpoint that receives a report.
 *
 * Nothing here touches the DOM, so it is safe in a route handler, a serverless
 * function or a worker. There is no storage adapter on purpose: where the
 * screenshot goes is your decision, and it is the one worth making carefully.
 *
 * One thing worth saying plainly: a screenshot of your application can contain
 * whatever the reporter could see — another person's record, an inbox, a
 * half-written document. Put it somewhere private and serve it back through an
 * authenticated route. Do not give it a public URL.
 */
export { toMarkdown, type MarkdownOptions } from "../markdown.ts";
export { handleReport, validateReport, collectExtra, resetRateLimits, toResend, toWebhook, toGithub, toLinear, SinkTimeoutError, DEFAULT_MAX_BODY_BYTES, DEFAULT_BODY_TIMEOUT_MS, DEFAULT_SINK_TIMEOUT_MS, MAX_EXTRA_KEYS, MAX_EXTRA_STRING_LENGTH, MAX_RATE_LIMIT_KEY_LENGTH, MAX_RATE_LIMIT_BUCKETS, EMPTY_MESSAGE_ERROR, TOO_LARGE_ERROR, type HandleReportOptions, type HandleReportResult, type RateLimitOptions, type ReportSink, type SinkContext, type ValidatedReport, } from "./handle.ts";
export { expressHandler, type ExpressRequestLike, type ExpressResponseLike, } from "./express.ts";
export { SinkError, type FetchLike } from "../sinks/error.ts";
export { sendReportEmail, type SendReportEmailOptions, type SendReportEmailResult, } from "../sinks/resend.ts";
export { sendReportWebhook, DISCORD_MAX_CONTENT, type SendReportWebhookOptions, type SendReportWebhookResult, type WebhookFormat, } from "../sinks/webhook.ts";
export { createGithubIssue, type CreateGithubIssueOptions, type CreateGithubIssueResult, } from "../sinks/github.ts";
export { createLinearIssue, type CreateLinearIssueOptions, type CreateLinearIssueResult, } from "../sinks/linear.ts";
export { scrubReport, scrubUrl, BUILTIN_SCRUBBERS, DEFAULT_REPLACEMENT, type ScrubOptions, type Scrubber, type ScrubberName, } from "../scrub.ts";
export { decodeScreenshotDataUrl, InvalidScreenshotError, isReportType, normaliseMessage, normaliseContext, normaliseConsole, normaliseElements, normaliseBreadcrumbs, normaliseNetwork, MAX_MESSAGE_LENGTH, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DATA_URL_LENGTH, MAX_CONSOLE_ENTRIES, MAX_CONSOLE_MESSAGE_LENGTH, MAX_ELEMENTS, MAX_ELEMENT_TEXT_LENGTH, MAX_BREADCRUMBS, MAX_BREADCRUMB_TEXT_LENGTH, MAX_NETWORK_ENTRIES, REPORT_TYPES, type ReportType, type ReportContext, type BugReport, type ConsoleEntry, type ConsoleLevel, type ElementRef, type Breadcrumb, type BreadcrumbKind, type NetworkEntry, } from "../report-core.ts";
//# sourceMappingURL=index.d.ts.map