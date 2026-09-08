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

import { messageFromBody, readBody, SinkError, type FetchLike } from "./error.ts";
import {
  clip,
  readReport,
  resolveUrl,
  type ChatSink,
  type ChatSinkContext,
  type UrlFrom,
} from "./chat.ts";

/** Slack refuses a message with more blocks than this. */
export const MAX_SLACK_BLOCKS = 50;
/** The longest any one text object may be. */
export const MAX_SLACK_TEXT = 3000;
/** A `plain_text` header is shorter still. */
export const MAX_SLACK_HEADER_TEXT = 150;
/** A section's `fields` are capped both in number and in length. */
export const MAX_SLACK_FIELDS = 10;
export const MAX_SLACK_FIELD_TEXT = 2000;

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
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Block = Record<string, unknown>;

function mrkdwn(text: string, max = MAX_SLACK_TEXT): Block {
  return { type: "mrkdwn", text: clip(text, max) };
}

/**
 * Builds the message body. Exported for the tests, which assert the shape
 * rather than a snapshot of it, and useful if you want to post it yourself
 * through a bot token instead of a webhook.
 */
export function buildSlackMessage(
  report: unknown,
  options: SlackSinkOptions,
  ctx: ChatSinkContext = {},
): Record<string, unknown> {
  const r = readReport(report);
  const screenshot = resolveUrl(options.screenshotUrl, report, ctx.screenshotUrl);
  const link = resolveUrl(options.reportUrl, report);

  const blocks: Block[] = [
    {
      type: "header",
      text: { type: "plain_text", text: clip(r.title, MAX_SLACK_HEADER_TEXT), emoji: true },
    },
  ];

  if (r.message) {
    blocks.push({ type: "section", text: mrkdwn(escapeSlack(r.message)) });
  }

  if (r.facts.length > 0) {
    blocks.push({
      type: "section",
      fields: r.facts
        .slice(0, MAX_SLACK_FIELDS)
        .map(([label, value]) =>
          mrkdwn(`*${escapeSlack(label)}*\n${escapeSlack(value)}`, MAX_SLACK_FIELD_TEXT),
        ),
    });
  }

  if (r.consoleText) {
    // The fence is counted inside the limit, so the text is clipped to what is
    // left of it rather than to the whole 3000.
    const fence = "```";
    const body = clip(escapeSlack(r.consoleText), MAX_SLACK_TEXT - 2 * fence.length - 2);
    blocks.push({ type: "section", text: mrkdwn(`${fence}\n${body}\n${fence}`) });
  }

  if (screenshot) {
    blocks.push({
      type: "image",
      image_url: screenshot,
      alt_text: clip(r.title, MAX_SLACK_HEADER_TEXT),
    });
  }

  const context: string[] = [];
  if (r.timestamp) context.push(r.timestamp);
  if (r.selector) context.push(`\`${escapeSlack(r.selector)}\``);
  if (context.length > 0) {
    blocks.push({ type: "context", elements: [mrkdwn(context.join(" · "))] });
  }

  if (link) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: clip(options.buttonText ?? "Open report", 75),
            emoji: true,
          },
          url: link,
        },
      ],
    });
  }

  const body: Record<string, unknown> = {
    // The fallback text is what a notification and a screen reader get, so it
    // says the title rather than "This message has no text".
    text: clip(escapeSlack(r.title), MAX_SLACK_TEXT),
    blocks: blocks.slice(0, MAX_SLACK_BLOCKS),
  };
  if (options.channel) body.channel = options.channel;
  if (options.username) body.username = options.username;
  if (options.iconEmoji) body.icon_emoji = options.iconEmoji;
  return body;
}

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
export function slackSink(options: SlackSinkOptions): ChatSink {
  return async (report, ctx = {}) => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const response = await doFetch(options.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSlackMessage(report, options, ctx)),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    if (!response.ok) {
      const body = await readBody(response);
      const fallback = `Slack refused the report with status ${response.status}`;
      throw new SinkError(messageFromBody(body, fallback), response.status, body);
    }
  };
}

/**
 * @deprecated Renamed to `MAX_SLACK_BLOCKS` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const SLACK_MAX_BLOCKS = MAX_SLACK_BLOCKS;
/**
 * @deprecated Renamed to `MAX_SLACK_TEXT` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const SLACK_MAX_TEXT = MAX_SLACK_TEXT;
/**
 * @deprecated Renamed to `MAX_SLACK_HEADER_TEXT` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const SLACK_MAX_HEADER_TEXT = MAX_SLACK_HEADER_TEXT;
/**
 * @deprecated Renamed to `MAX_SLACK_FIELDS` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const SLACK_MAX_FIELDS = MAX_SLACK_FIELDS;
/**
 * @deprecated Renamed to `MAX_SLACK_FIELD_TEXT` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const SLACK_MAX_FIELD_TEXT = MAX_SLACK_FIELD_TEXT;
