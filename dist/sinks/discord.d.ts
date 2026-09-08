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
import { type FetchLike } from "./error.ts";
import { type ChatSink, type ChatSinkContext, type UrlFrom } from "./chat.ts";
import type { ReportType } from "../report-core.ts";
/** Per-part limits Discord enforces on an embed. */
export declare const DISCORD_MAX_EMBED_TITLE = 256;
export declare const DISCORD_MAX_EMBED_DESCRIPTION = 4096;
export declare const DISCORD_MAX_EMBED_FIELDS = 25;
export declare const DISCORD_MAX_FIELD_NAME = 256;
export declare const DISCORD_MAX_FIELD_VALUE = 1024;
export declare const DISCORD_MAX_FOOTER_TEXT = 2048;
/** And the one across all of them at once. */
export declare const DISCORD_MAX_EMBED_TOTAL = 6000;
/**
 * Colour down the left edge of the embed, so the type is legible before a
 * word is read. Red for a bug, green for an idea, grey for anything else.
 */
export declare const DISCORD_COLOURS: Record<ReportType, number>;
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
    screenshotUrl?: UrlFrom;
    /** A link to the full report, which becomes the embed's title link. */
    reportUrl?: UrlFrom;
    /** Injected `fetch`, for tests or a runtime with its own client. */
    fetch?: FetchLike;
};
/**
 * Builds the message body. Exported for the tests, which assert the shape
 * rather than a snapshot of it, and useful if you post it through a bot token
 * rather than a webhook.
 */
export declare function buildDiscordMessage(report: unknown, options: DiscordSinkOptions, ctx?: ChatSinkContext): Record<string, unknown>;
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
export declare function discordSink(options: DiscordSinkOptions): ChatSink;
//# sourceMappingURL=discord.d.ts.map