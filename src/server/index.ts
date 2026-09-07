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

// The same fingerprint the browser computes, so a sink can write it down and a
// receiver can recognise the report it already has.
export { fingerprint, stableHash, type FingerprintInput } from "../fingerprint.ts";

// The fast path over the validators below: one call from `Request` to
// `Response`. Importing it is opt-in, so an integrator who only wants the
// validators does not bundle the sinks it reaches for.
export {
  handleReport,
  validateReport,
  collectExtra,
  resetRateLimits,
  resetDedupe,
  resetSignatures,
  toResend,
  toWebhook,
  toGithub,
  toLinear,
  SinkTimeoutError,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_BODY_TIMEOUT_MS,
  DEFAULT_SINK_TIMEOUT_MS,
  MAX_EXTRA_KEYS,
  MAX_EXTRA_STRING_LENGTH,
  MAX_RATE_LIMIT_KEY_LENGTH,
  MAX_RATE_LIMIT_BUCKETS,
  MAX_DEDUPE_ENTRIES,
  MAX_SIGNATURE_ENTRIES,
  DEFAULT_SIGNATURE_SKEW_MS,
  BAD_SIGNATURE_ERROR,
  EMPTY_MESSAGE_ERROR,
  TOO_LARGE_ERROR,
  type DedupeOptions,
  type HandleReportOptions,
  type HandleReportResult,
  type RateLimitOptions,
  type SignatureOptions,
  type ReportSink,
  type SinkContext,
  type ValidatedReport,
} from "./handle.ts";

export {
  expressHandler,
  type ExpressRequestLike,
  type ExpressResponseLike,
} from "./express.ts";

// The sinks live here and nowhere else: they carry API keys and webhook URLs,
// neither of which has any business in a browser bundle.
export { SinkError, type FetchLike } from "../sinks/error.ts";

export {
  sendReportEmail,
  type SendReportEmailOptions,
  type SendReportEmailResult,
} from "../sinks/resend.ts";

export {
  sendReportWebhook,
  DISCORD_MAX_CONTENT,
  type SendReportWebhookOptions,
  type SendReportWebhookResult,
  type WebhookFormat,
} from "../sinks/webhook.ts";

export {
  createGithubIssue,
  type CreateGithubIssueOptions,
  type CreateGithubIssueResult,
} from "../sinks/github.ts";

export {
  createLinearIssue,
  type CreateLinearIssueOptions,
  type CreateLinearIssueResult,
} from "../sinks/linear.ts";
// Useful in the route handler too: scrub once more on the way in, so the row
// that is written is the redacted one whatever the client did or did not do.
export {
  scrubReport,
  scrubUrl,
  BUILTIN_SCRUBBERS,
  DEFAULT_REPLACEMENT,
  type ScrubOptions,
  type Scrubber,
  type ScrubberName,
} from "../scrub.ts";

export {
  decodeScreenshotDataUrl,
  InvalidScreenshotError,
  isReportType,
  normaliseMessage,
  normaliseContext,
  normaliseConsole,
  normaliseElements,
  normaliseBreadcrumbs,
  normaliseNetwork,
  MAX_MESSAGE_LENGTH,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_MESSAGE_LENGTH,
  MAX_ELEMENTS,
  MAX_ELEMENT_TEXT_LENGTH,
  MAX_BREADCRUMBS,
  MAX_BREADCRUMB_TEXT_LENGTH,
  MAX_NETWORK_ENTRIES,
  MAX_STACK_FRAMES,
  MAX_STACK_STRING_LENGTH,
  MAX_CONTEXT_LENGTHS,
  REPORT_TYPES,
  type ReportType,
  type ReportContext,
  type BugReport,
  type ConsoleEntry,
  type ConsoleLevel,
  type StackFrame,
  type ElementRef,
  type Breadcrumb,
  type BreadcrumbKind,
  type NetworkEntry,
} from "../report-core.ts";
