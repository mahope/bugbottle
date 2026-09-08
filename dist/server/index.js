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
// The same fingerprint the browser computes, so a sink can write it down and a
// receiver can recognise the report it already has.
export { fingerprint, stableHash } from "../fingerprint.js";
// The fast path over the validators below: one call from `Request` to
// `Response`. Importing it is opt-in, so an integrator who only wants the
// validators does not bundle the sinks it reaches for.
export { handleReport, validateReport, collectExtra, resetRateLimits, resetDedupe, resetSignatures, toResend, toWebhook, toGithub, toLinear, SinkTimeoutError, DEFAULT_MAX_BODY_BYTES, DEFAULT_BODY_TIMEOUT_MS, DEFAULT_SINK_TIMEOUT_MS, MAX_EXTRA_KEYS, MAX_EXTRA_STRING_LENGTH, MAX_RATE_LIMIT_KEY_LENGTH, MAX_RATE_LIMIT_BUCKETS, MAX_DEDUPE_ENTRIES, MAX_SIGNATURE_ENTRIES, DEFAULT_SIGNATURE_SKEW_MS, BAD_SIGNATURE_ERROR, EMPTY_MESSAGE_ERROR, TOO_LARGE_ERROR, } from "./handle.js";
export { expressHandler, } from "./express.js";
// The sinks live here and nowhere else: they carry API keys and webhook URLs,
// neither of which has any business in a browser bundle.
export { SinkError } from "../sinks/error.js";
export { sendReportEmail, } from "../sinks/resend.js";
export { sendReportWebhook, DISCORD_MAX_CONTENT, } from "../sinks/webhook.js";
export { createGithubIssue, } from "../sinks/github.js";
export { createLinearIssue, } from "../sinks/linear.js";
// The two chat sinks are factories rather than send functions, because a
// channel wants one message per report and nothing to configure at the call
// site of the delivery itself.
export { MAX_CHAT_CONSOLE_ENTRIES, } from "../sinks/chat.js";
export { slackSink, buildSlackMessage, escapeSlack, SLACK_MAX_BLOCKS, SLACK_MAX_TEXT, SLACK_MAX_HEADER_TEXT, SLACK_MAX_FIELDS, SLACK_MAX_FIELD_TEXT, } from "../sinks/slack.js";
// The Sentry-compatible sink is the only one that can carry the picture
// itself: an attachment item rides in the same envelope as the event.
export { sentrySink, buildSentryEvent, buildSentryEnvelope, parseSentryDsn, sentryAuthHeader, clipBytes, SentrySinkError, SENTRY_CLIENT, SENTRY_CLIENT_NAME, SENTRY_CLIENT_VERSION, SENTRY_VERSION, MAX_SENTRY_BREADCRUMBS, MAX_SENTRY_MESSAGE_BYTES, MAX_SENTRY_FEEDBACK_MESSAGE, MAX_SENTRY_EVENT_BYTES, MAX_SENTRY_ENVELOPE_BYTES, DEFAULT_SENTRY_RETRY_AFTER, } from "../sinks/sentry.js";
export { discordSink, buildDiscordMessage, DISCORD_COLOURS, DISCORD_MAX_EMBED_TITLE, DISCORD_MAX_EMBED_DESCRIPTION, DISCORD_MAX_EMBED_FIELDS, DISCORD_MAX_FIELD_NAME, DISCORD_MAX_FIELD_VALUE, DISCORD_MAX_FOOTER_TEXT, DISCORD_MAX_EMBED_TOTAL, } from "../sinks/discord.js";
// Useful in the route handler too: scrub once more on the way in, so the row
// that is written is the redacted one whatever the client did or did not do.
export { scrubReport, scrubUrl, BUILTIN_SCRUBBERS, DEFAULT_REPLACEMENT, } from "../scrub.js";
export { decodeScreenshotDataUrl, InvalidScreenshotError, isReportType, normaliseMessage, normaliseContext, normaliseConsole, normaliseElements, normaliseBreadcrumbs, normaliseNetwork, normalisePerf, normaliseStorage, MAX_MESSAGE_LENGTH, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DATA_URL_LENGTH, MAX_CONSOLE_ENTRIES, MAX_CONSOLE_MESSAGE_LENGTH, MAX_ELEMENTS, MAX_ELEMENT_TEXT_LENGTH, MAX_BREADCRUMBS, MAX_BREADCRUMB_TEXT_LENGTH, MAX_NETWORK_ENTRIES, MAX_STORAGE_KEYS, MAX_STORAGE_KEY_LENGTH, MAX_STORAGE_VALUE_LENGTH, MAX_STORAGE_VALUES, MAX_COOKIE_NAMES, MAX_PERF_MS, MAX_STACK_FRAMES, MAX_STACK_STRING_LENGTH, MAX_CONTEXT_LENGTHS, REPORT_TYPES, } from "../report-core.js";
//# sourceMappingURL=index.js.map