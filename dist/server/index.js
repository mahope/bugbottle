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
export { toMarkdown } from "../markdown.js";
// The fast path over the validators below: one call from `Request` to
// `Response`. Importing it is opt-in, so an integrator who only wants the
// validators does not bundle the sinks it reaches for.
export { handleReport, validateReport, collectExtra, resetRateLimits, toResend, toWebhook, toGithub, toLinear, SinkTimeoutError, DEFAULT_MAX_BODY_BYTES, DEFAULT_BODY_TIMEOUT_MS, DEFAULT_SINK_TIMEOUT_MS, MAX_EXTRA_KEYS, MAX_EXTRA_STRING_LENGTH, MAX_RATE_LIMIT_KEY_LENGTH, MAX_RATE_LIMIT_BUCKETS, EMPTY_MESSAGE_ERROR, TOO_LARGE_ERROR, } from "./handle.js";
export { expressHandler, } from "./express.js";
// The sinks live here and nowhere else: they carry API keys and webhook URLs,
// neither of which has any business in a browser bundle.
export { SinkError } from "../sinks/error.js";
export { sendReportEmail, } from "../sinks/resend.js";
export { sendReportWebhook, DISCORD_MAX_CONTENT, } from "../sinks/webhook.js";
export { createGithubIssue, } from "../sinks/github.js";
export { createLinearIssue, } from "../sinks/linear.js";
// Useful in the route handler too: scrub once more on the way in, so the row
// that is written is the redacted one whatever the client did or did not do.
export { scrubReport, scrubUrl, BUILTIN_SCRUBBERS, DEFAULT_REPLACEMENT, } from "../scrub.js";
export { decodeScreenshotDataUrl, InvalidScreenshotError, isReportType, normaliseMessage, normaliseContext, normaliseConsole, normaliseElements, normaliseBreadcrumbs, normaliseNetwork, MAX_MESSAGE_LENGTH, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DATA_URL_LENGTH, MAX_CONSOLE_ENTRIES, MAX_CONSOLE_MESSAGE_LENGTH, MAX_ELEMENTS, MAX_ELEMENT_TEXT_LENGTH, MAX_BREADCRUMBS, MAX_BREADCRUMB_TEXT_LENGTH, MAX_NETWORK_ENTRIES, REPORT_TYPES, } from "../report-core.js";
//# sourceMappingURL=index.js.map