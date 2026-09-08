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
  clientAddress,
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
  MAX_SIGNATURE_ENTRIES_PER_SECOND,
  MAX_SIGNATURE_SECONDS,
  DEFAULT_SIGNATURE_SKEW_MS,
  BAD_SIGNATURE_ERROR,
  EMPTY_MESSAGE_ERROR,
  TOO_LARGE_ERROR,
  type DecisionReason,
  type DedupeEntry,
  type DedupeOptions,
  type DedupeStore,
  type HandleReportOptions,
  type HandleReportResult,
  type RateLimitOptions,
  type ReportDecision,
  type RateLimitStore,
  type ReplayStore,
  type SignatureOptions,
  type TrustProxyOptions,
  type ReportSink,
  type SinkContext,
  type ValidatedReport,
} from "./handle.ts";

// The directory of files most small deployments want before they want a
// database. It is the one module here that reaches for `node:fs`, and nothing
// the validators reach imports it, so the validator-only bundle stays free of
// it — CI greps the minified text to be sure.
export {
  fileStore,
  DEFAULT_MAX_REPORTS,
  type FileStore,
  type FileStoreOptions,
  type StoredReport,
  type StoredReportFile,
} from "./file-store.ts";

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

// The only sink that speaks a protocol rather than an HTTP API, and the only
// one that is Node-only: it imports `node:net` and `node:tls`. Nothing else in
// this entry imports it, so a runtime without those modules is fine until
// somebody asks for `smtpSink` by name.
export {
  smtpSink,
  sendReportSmtp,
  buildMessage,
  foldHeader,
  dotStuff,
  DEFAULT_SMTP_PORT,
  DEFAULT_SMTP_TIMEOUT_MS,
  SMTP_TLS_PORT,
  SMTP_NO_REPLY,
  type SmtpSink,
  type SmtpSinkOptions,
  type SendReportSmtpResult,
} from "../sinks/smtp.ts";

export {
  sendReportWebhook,
  MAX_DISCORD_CONTENT,
  DISCORD_MAX_CONTENT,
  type SendReportWebhookOptions,
  type SendReportWebhookTarget,
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

// The two chat sinks are factories rather than send functions, because a
// channel wants one message per report and nothing to configure at the call
// site of the delivery itself.
export {
  MAX_CHAT_CONSOLE_ENTRIES,
  type ChatSink,
  type ChatSinkContext,
  type UrlFrom,
} from "../sinks/chat.ts";

export {
  slackSink,
  buildSlackMessage,
  escapeSlack,
  MAX_SLACK_BLOCKS,
  MAX_SLACK_TEXT,
  MAX_SLACK_HEADER_TEXT,
  MAX_SLACK_FIELDS,
  MAX_SLACK_FIELD_TEXT,
  SLACK_MAX_BLOCKS,
  SLACK_MAX_TEXT,
  SLACK_MAX_HEADER_TEXT,
  SLACK_MAX_FIELDS,
  SLACK_MAX_FIELD_TEXT,
  type SlackSinkOptions,
} from "../sinks/slack.ts";

// The Sentry-compatible sink is the only one that can carry the picture
// itself: an attachment item rides in the same envelope as the event.
export {
  sentrySink,
  buildSentryEvent,
  buildSentryEnvelope,
  parseSentryDsn,
  sentryAuthHeader,
  clipBytes,
  SentrySinkError,
  SENTRY_CLIENT,
  SENTRY_CLIENT_NAME,
  SENTRY_CLIENT_VERSION,
  SENTRY_VERSION,
  MAX_SENTRY_BREADCRUMBS,
  MAX_SENTRY_MESSAGE_BYTES,
  MAX_SENTRY_FEEDBACK_MESSAGE,
  MAX_SENTRY_EVENT_BYTES,
  MAX_SENTRY_ENVELOPE_BYTES,
  DEFAULT_SENTRY_RETRY_AFTER,
  type SentrySinkOptions,
  type SentryDsn,
  type SentryEnvelope,
  type SentrySinkContext,
  type SentryItemType,
  type SentryTruncation,
} from "../sinks/sentry.ts";

// The two issue-tracker sinks for teams that are on neither GitHub nor Linear.
// Jira is the only sink that does not send Markdown: its v3 API takes the
// Atlassian Document Format, so the report is rendered as a node tree instead.
export {
  jiraSink,
  buildJiraDescription,
  jiraBaseUrl,
  jiraAuthHeader,
  messageFromJiraBody,
  DEFAULT_JIRA_ISSUE_TYPE,
  MAX_JIRA_CONSOLE_ENTRIES,
  MAX_JIRA_SUMMARY,
  type JiraSink,
  type JiraSinkOptions,
  type CreateJiraIssueResult,
  type AdfDoc,
  type AdfNode,
} from "../sinks/jira.ts";

export {
  gitlabSink,
  messageFromGitlabBody,
  DEFAULT_GITLAB_HOST,
  MAX_GITLAB_DESCRIPTION,
  MAX_GITLAB_TITLE,
  type GitlabSink,
  type GitlabSinkOptions,
  type CreateGitlabIssueResult,
} from "../sinks/gitlab.ts";

export {
  discordSink,
  buildDiscordMessage,
  DISCORD_COLOURS,
  MAX_DISCORD_EMBED_TITLE,
  MAX_DISCORD_EMBED_DESCRIPTION,
  MAX_DISCORD_EMBED_FIELDS,
  MAX_DISCORD_FIELD_NAME,
  MAX_DISCORD_FIELD_VALUE,
  MAX_DISCORD_FOOTER_TEXT,
  MAX_DISCORD_EMBED_TOTAL,
  DISCORD_MAX_EMBED_TITLE,
  DISCORD_MAX_EMBED_DESCRIPTION,
  DISCORD_MAX_EMBED_FIELDS,
  DISCORD_MAX_FIELD_NAME,
  DISCORD_MAX_FIELD_VALUE,
  DISCORD_MAX_FOOTER_TEXT,
  DISCORD_MAX_EMBED_TOTAL,
  type DiscordSinkOptions,
} from "../sinks/discord.ts";

// Microsoft Teams is the third chat sink, and the odd one out: the Office 365
// connector webhooks are retired, so a card goes through a Workflows webhook
// inside a Bot Framework message, and the whole request is capped at 28 kB.
export {
  teamsSink,
  buildTeamsMessage,
  escapeTeams,
  TEAMS_CARD_SCHEMA,
  TEAMS_CARD_VERSION,
  TEAMS_CARD_CONTENT_TYPE,
  MAX_TEAMS_MESSAGE_BYTES,
  MAX_TEAMS_TITLE,
  MAX_TEAMS_MESSAGE,
  MAX_TEAMS_FACTS,
  MAX_TEAMS_FACT_TITLE,
  MAX_TEAMS_FACT_VALUE,
  MAX_TEAMS_CONSOLE,
  MAX_TEAMS_BUTTON_TEXT,
  type TeamsSinkOptions,
} from "../sinks/teams.ts";
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
  normaliseContact,
  looksLikeEmail,
  normaliseContext,
  normaliseConsole,
  normaliseElements,
  normaliseBreadcrumbs,
  normaliseNetwork,
  normalisePerf,
  normaliseNotes,
  normaliseReplay,
  normaliseStorage,
  MAX_MESSAGE_LENGTH,
  MAX_CONTACT_LENGTH,
  MAX_NOTES,
  MAX_NOTE_LENGTH,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_MESSAGE_LENGTH,
  MAX_ELEMENTS,
  MAX_ELEMENT_TEXT_LENGTH,
  MAX_BREADCRUMBS,
  MAX_BREADCRUMB_TEXT_LENGTH,
  MAX_NETWORK_ENTRIES,
  MAX_STORAGE_KEYS,
  MAX_STORAGE_KEY_LENGTH,
  MAX_STORAGE_VALUE_LENGTH,
  MAX_STORAGE_VALUES,
  MAX_COOKIE_NAMES,
  MAX_PERF_MS,
  MAX_REPLAY_BYTES,
  MAX_REPLAY_EVENTS,
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
  type PerfSnapshot,
  type StorageKeyRef,
  type StorageSnapshot,
  type ReplayEvent,
  type ReplayCapture,
} from "../report-core.ts";
