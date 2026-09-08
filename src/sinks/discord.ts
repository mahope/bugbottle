/**
 * Posting a report to a Discord incoming webhook as an embed.
 *
 * `sendReportWebhook(..., { format: "discord" })` sends the Markdown as plain
 * `content`, which Discord clips at 2000 characters and renders as a wall.
 * An embed has four times the room, a colour by report type, the facts in
 * columns and a picture — which is the difference between a channel people
 * skim and one they act on.
 *
 * The webhook URL is the credential; keep it on the server.
 *
 * Discord answers a good post with 204 and no body, and a bad one with a JSON
 * error. Every limit below is a clip rather than a failure, and the total
 * 6000-character budget is spent on the description last, because the facts
 * are what somebody triages from.
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
import type { ReportType } from "../report-core.ts";

/** Per-part limits Discord enforces on an embed. */
export const MAX_DISCORD_EMBED_TITLE = 256;
export const MAX_DISCORD_EMBED_DESCRIPTION = 4096;
export const MAX_DISCORD_EMBED_FIELDS = 25;
export const MAX_DISCORD_FIELD_NAME = 256;
export const MAX_DISCORD_FIELD_VALUE = 1024;
export const MAX_DISCORD_FOOTER_TEXT = 2048;
/** And the one across all of them at once. */
export const MAX_DISCORD_EMBED_TOTAL = 6000;

/**
 * Colour down the left edge of the embed, so the type is legible before a
 * word is read. Red for a bug, green for an idea, grey for anything else.
 */
export const DISCORD_COLOURS: Record<ReportType, number> = {
  bug: 0xd7263d,
  idea: 0x2fa84f,
  other: 0x8a8f98,
};

export type DiscordSinkOptions = {
  /** The incoming webhook URL. Treat it as a secret. */
  webhookUrl: string;
  /** Overrides the posting name. */
  username?: string;
  /** Overrides the avatar with a picture URL. */
  avatarUrl?: string;
  /**
   * Where the screenshot can be fetched. Discord fetches the URL itself, so a
   * data URL is ignored; store the picture first and return its address. Read
   * the privacy note in the README before that address becomes a public one.
   */
  screenshotUrl?: string;
  /** Picks the screenshot address out of the report, when it travels there. */
  screenshotUrlFrom?: UrlFrom;
  /** A link to the full report, which becomes the embed's title link. */
  reportUrl?: string;
  /** Picks that link out of the report. Wins over `reportUrl`. */
  reportUrlFrom?: UrlFrom;
  /** Injected `fetch`, for tests or a runtime with its own client. */
  fetch?: FetchLike;
};

type Field = { name: string; value: string; inline?: boolean };

/** The characters Discord counts towards the 6000, minus the description. */
function fixedCost(title: string, fields: Field[], footer: string | undefined): number {
  let total = title.length + (footer?.length ?? 0);
  for (const f of fields) total += f.name.length + f.value.length;
  return total;
}

/**
 * Builds the message body. Exported for the tests, which assert the shape
 * rather than a snapshot of it, and useful if you post it through a bot token
 * rather than a webhook.
 */
export function buildDiscordMessage(
  report: unknown,
  options: DiscordSinkOptions,
  ctx: ChatSinkContext = {},
): Record<string, unknown> {
  const r = readReport(report);
  const screenshot = resolveUrl(
    options.screenshotUrlFrom,
    report,
    options.screenshotUrl ?? ctx.screenshotUrl,
  );
  const link = resolveUrl(options.reportUrlFrom, report, options.reportUrl);

  const title = clip(r.title, MAX_DISCORD_EMBED_TITLE);

  const fields: Field[] = r.facts
    .slice(0, MAX_DISCORD_EMBED_FIELDS)
    .map(([name, value]) => ({
      name: clip(name, MAX_DISCORD_FIELD_NAME),
      value: clip(value, MAX_DISCORD_FIELD_VALUE),
      inline: true,
    }));

  if (r.consoleText && fields.length < MAX_DISCORD_EMBED_FIELDS) {
    // The fence counts towards the 1024, so the entries are clipped to what is
    // left once it is paid for.
    const fence = "```";
    const body = clip(r.consoleText, MAX_DISCORD_FIELD_VALUE - 2 * fence.length - 2);
    fields.push({ name: "Console", value: `${fence}\n${body}\n${fence}` });
  }

  const footer = r.selector ? clip(r.selector, MAX_DISCORD_FOOTER_TEXT) : undefined;

  // Whatever is left of the 6000 after the parts that carry the facts. The
  // description is the reporter's own words, which is the one part that can be
  // read in a truncated form and still make sense.
  const room = Math.max(0, MAX_DISCORD_EMBED_TOTAL - fixedCost(title, fields, footer));
  const description = clip(r.message, Math.min(MAX_DISCORD_EMBED_DESCRIPTION, room));

  const embed: Record<string, unknown> = {
    title,
    color: DISCORD_COLOURS[r.type],
  };
  if (description) embed.description = description;
  if (link) embed.url = link;
  if (fields.length > 0) embed.fields = fields;
  if (screenshot) embed.image = { url: screenshot };
  if (r.timestamp) embed.timestamp = r.timestamp;
  if (footer) embed.footer = { text: footer };

  const body: Record<string, unknown> = { embeds: [embed] };
  if (options.username) body.username = options.username;
  if (options.avatarUrl) body.avatar_url = options.avatarUrl;
  return body;
}

/**
 * A sink that posts one embed per report to a Discord incoming webhook.
 * Resolves on a 2xx — Discord answers 204 with no body — throws `SinkError`
 * carrying the status and the response body on anything else, and lets
 * network failures from `fetch` propagate as they are.
 *
 * ```ts
 * handleReport(req, { sinks: [discordSink({ webhookUrl: process.env.DISCORD_URL! })] });
 * ```
 */
export function discordSink(options: DiscordSinkOptions): ChatSink {
  return async (report, ctx = {}) => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const response = await doFetch(options.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildDiscordMessage(report, options, ctx)),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    if (!response.ok) {
      const body = await readBody(response);
      const fallback = `Discord refused the report with status ${response.status}`;
      throw new SinkError(messageFromBody(body, fallback), response.status, body);
    }
  };
}
