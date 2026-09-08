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
export { fingerprint, stableHash, type FingerprintInput } from "../fingerprint.ts";
export { handleReport, validateReport, collectExtra, resetRateLimits, resetDedupe, resetSignatures, toResend, toWebhook, toGithub, toLinear, SinkTimeoutError, DEFAULT_MAX_BODY_BYTES, DEFAULT_BODY_TIMEOUT_MS, DEFAULT_SINK_TIMEOUT_MS, MAX_EXTRA_KEYS, MAX_EXTRA_STRING_LENGTH, MAX_RATE_LIMIT_KEY_LENGTH, MAX_RATE_LIMIT_BUCKETS, MAX_DEDUPE_ENTRIES, MAX_SIGNATURE_ENTRIES, MAX_SIGNATURE_ENTRIES_PER_SECOND, MAX_SIGNATURE_SECONDS, DEFAULT_SIGNATURE_SKEW_MS, BAD_SIGNATURE_ERROR, EMPTY_MESSAGE_ERROR, TOO_LARGE_ERROR, type DedupeEntry, type DedupeOptions, type DedupeStore, type HandleReportOptions, type HandleReportResult, type RateLimitOptions, type RateLimitStore, type ReplayStore, type SignatureOptions, type ReportSink, type SinkContext, type ValidatedReport, } from "./handle.ts";
export { expressHandler, type ExpressRequestLike, type ExpressResponseLike, } from "./express.ts";
export { SinkError, type FetchLike } from "../sinks/error.ts";
export { sendReportEmail, type SendReportEmailOptions, type SendReportEmailResult, } from "../sinks/resend.ts";
export { sendReportWebhook, DISCORD_MAX_CONTENT, type SendReportWebhookOptions, type SendReportWebhookResult, type WebhookFormat, } from "../sinks/webhook.ts";
export { createGithubIssue, type CreateGithubIssueOptions, type CreateGithubIssueResult, } from "../sinks/github.ts";
export { createLinearIssue, type CreateLinearIssueOptions, type CreateLinearIssueResult, } from "../sinks/linear.ts";
export { MAX_CHAT_CONSOLE_ENTRIES, type ChatSink, type ChatSinkContext, type UrlFrom, } from "../sinks/chat.ts";
export { slackSink, buildSlackMessage, escapeSlack, SLACK_MAX_BLOCKS, SLACK_MAX_TEXT, SLACK_MAX_HEADER_TEXT, SLACK_MAX_FIELDS, SLACK_MAX_FIELD_TEXT, type SlackSinkOptions, } from "../sinks/slack.ts";
export { sentrySink, buildSentryEvent, buildSentryEnvelope, parseSentryDsn, sentryAuthHeader, clipBytes, SentrySinkError, SENTRY_CLIENT, SENTRY_CLIENT_NAME, SENTRY_CLIENT_VERSION, SENTRY_VERSION, MAX_SENTRY_BREADCRUMBS, MAX_SENTRY_MESSAGE_BYTES, MAX_SENTRY_FEEDBACK_MESSAGE, MAX_SENTRY_EVENT_BYTES, MAX_SENTRY_ENVELOPE_BYTES, DEFAULT_SENTRY_RETRY_AFTER, type SentrySinkOptions, type SentryDsn, type SentryEnvelope, type SentrySinkContext, type SentryItemType, type SentryTruncation, } from "../sinks/sentry.ts";
export { jiraSink, buildJiraDescription, jiraBaseUrl, jiraAuthHeader, messageFromJiraBody, DEFAULT_JIRA_ISSUE_TYPE, MAX_JIRA_CONSOLE_ENTRIES, MAX_JIRA_SUMMARY, type JiraSink, type JiraSinkOptions, type CreateJiraIssueResult, type AdfDoc, type AdfNode, } from "../sinks/jira.ts";
export { gitlabSink, messageFromGitlabBody, DEFAULT_GITLAB_HOST, MAX_GITLAB_DESCRIPTION, MAX_GITLAB_TITLE, type GitlabSink, type GitlabSinkOptions, type CreateGitlabIssueResult, } from "../sinks/gitlab.ts";
export { discordSink, buildDiscordMessage, DISCORD_COLOURS, DISCORD_MAX_EMBED_TITLE, DISCORD_MAX_EMBED_DESCRIPTION, DISCORD_MAX_EMBED_FIELDS, DISCORD_MAX_FIELD_NAME, DISCORD_MAX_FIELD_VALUE, DISCORD_MAX_FOOTER_TEXT, DISCORD_MAX_EMBED_TOTAL, type DiscordSinkOptions, } from "../sinks/discord.ts";
export { scrubReport, scrubUrl, BUILTIN_SCRUBBERS, DEFAULT_REPLACEMENT, type ScrubOptions, type Scrubber, type ScrubberName, } from "../scrub.ts";
export { decodeScreenshotDataUrl, InvalidScreenshotError, isReportType, normaliseMessage, normaliseContext, normaliseConsole, normaliseElements, normaliseBreadcrumbs, normaliseNetwork, normalisePerf, normaliseStorage, MAX_MESSAGE_LENGTH, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DATA_URL_LENGTH, MAX_CONSOLE_ENTRIES, MAX_CONSOLE_MESSAGE_LENGTH, MAX_ELEMENTS, MAX_ELEMENT_TEXT_LENGTH, MAX_BREADCRUMBS, MAX_BREADCRUMB_TEXT_LENGTH, MAX_NETWORK_ENTRIES, MAX_STORAGE_KEYS, MAX_STORAGE_KEY_LENGTH, MAX_STORAGE_VALUE_LENGTH, MAX_STORAGE_VALUES, MAX_COOKIE_NAMES, MAX_PERF_MS, MAX_STACK_FRAMES, MAX_STACK_STRING_LENGTH, MAX_CONTEXT_LENGTHS, REPORT_TYPES, type ReportType, type ReportContext, type BugReport, type ConsoleEntry, type ConsoleLevel, type StackFrame, type ElementRef, type Breadcrumb, type BreadcrumbKind, type NetworkEntry, type PerfSnapshot, type StorageKeyRef, type StorageSnapshot, } from "../report-core.ts";
//# sourceMappingURL=index.d.ts.map