/**
 * Posting a report to a Slack incoming webhook as Block Kit.
 *
 * `sendReportWebhook(..., { format: "slack" })` already puts the Markdown in a
 * `text` field, which is fine and looks like a paste. This sink is the other
 * option: a header, the message, the facts as two columns, the picture when
 * there is one to fetch, and a button to the full report — the shape somebody
 * can triage from without leaving the channel.
 *
 * The webhook URL is the credential. Anyone holding it can post to that
 * channel, so it belongs on the server and nowhere else.
 *
 * Every Block Kit limit below is a clip rather than a failure. A report that
 * arrives truncated is still read; a report that 400s because a stack trace
 * was 3001 characters long is not.
 */
import { type FetchLike } from "./error.ts";
import { type ChatSink, type ChatSinkContext, type UrlFrom } from "./chat.ts";
/** Slack refuses a message with more blocks than this. */
export declare const MAX_SLACK_BLOCKS = 50;
/** The longest any one text object may be. */
export declare const MAX_SLACK_TEXT = 3000;
/** A `plain_text` header is shorter still. */
export declare const MAX_SLACK_HEADER_TEXT = 150;
/** A section's `fields` are capped both in number and in length. */
export declare const MAX_SLACK_FIELDS = 10;
export declare const MAX_SLACK_FIELD_TEXT = 2000;
export type SlackSinkOptions = {
    /** The incoming webhook URL. Treat it as a secret. */
    webhookUrl: string;
    /** Overrides the channel the webhook was created for, where that is allowed. */
    channel?: string;
    /** Overrides the posting name. */
    username?: string;
    /** Overrides the avatar, e.g. `:beetle:`. */
    iconEmoji?: string;
    /**
     * Where the screenshot can be fetched. Slack fetches the URL itself, so a
     * data URL is no use and is ignored; store the picture first and return its
     * address. Read the privacy note in the README before that address becomes
     * a public one.
     */
    screenshotUrl?: UrlFrom;
    /** A link to the full report in your own tool, shown as a button. */
    reportUrl?: UrlFrom;
    /** The text on that button. Default "Open report". */
    buttonText?: string;
    /** Injected `fetch`, for tests or a runtime with its own client. */
    fetch?: FetchLike;
};
/** Slack reads `&`, `<` and `>` as markup, so they are escaped, `&` first. */
export declare function escapeSlack(text: string): string;
/**
 * Builds the message body. Exported for the tests, which assert the shape
 * rather than a snapshot of it, and useful if you want to post it yourself
 * through a bot token instead of a webhook.
 */
export declare function buildSlackMessage(report: unknown, options: SlackSinkOptions, ctx?: ChatSinkContext): Record<string, unknown>;
/**
 * A sink that posts one Block Kit message per report to a Slack incoming
 * webhook. Resolves on a 2xx, throws `SinkError` carrying the status and the
 * response body on anything else — Slack answers `invalid_payload` or
 * `no_service` as plain text — and lets network failures from `fetch`
 * propagate as they are.
 *
 * ```ts
 * handleReport(req, { sinks: [slackSink({ webhookUrl: process.env.SLACK_URL! })] });
 * ```
 */
export declare function slackSink(options: SlackSinkOptions): ChatSink;
/**
 * @deprecated Renamed to `MAX_SLACK_BLOCKS` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export declare const SLACK_MAX_BLOCKS = 50;
/**
 * @deprecated Renamed to `MAX_SLACK_TEXT` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export declare const SLACK_MAX_TEXT = 3000;
/**
 * @deprecated Renamed to `MAX_SLACK_HEADER_TEXT` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export declare const SLACK_MAX_HEADER_TEXT = 150;
/**
 * @deprecated Renamed to `MAX_SLACK_FIELDS` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export declare const SLACK_MAX_FIELDS = 10;
/**
 * @deprecated Renamed to `MAX_SLACK_FIELD_TEXT` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export declare const SLACK_MAX_FIELD_TEXT = 2000;
//# sourceMappingURL=slack.d.ts.map