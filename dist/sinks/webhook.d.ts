/**
 * Posting a report to a webhook — a Slack or Discord channel, or the JSON
 * intake of an automation tool such as Make or n8n.
 *
 * Three shapes, because that is all the difference between the services is:
 * Slack wants `{ text }`, Discord wants `{ content }` and refuses more than
 * 2000 characters, and everything else is happier with the report itself.
 * Nothing here is authenticated; the secret is the URL, so keep it on the
 * server.
 */
import { type MarkdownOptions } from "../markdown.ts";
import { type FetchLike } from "./error.ts";
/** Discord rejects a longer `content` outright, so we clip before it does. */
export declare const MAX_DISCORD_CONTENT = 2000;
export type WebhookFormat = "json" | "slack" | "discord";
/**
 * Where the report goes. `endpoint` is the name everything else in the package
 * uses for the address it POSTs to; `url` is what this sink called it until
 * 0.9 and is accepted in its place until 1.0 (#67). One of the two is
 * required, and giving both is a type error rather than a guess.
 */
export type SendReportWebhookTarget = {
    /** The webhook URL. Treat it as a secret: anyone holding it can post. */
    endpoint: string;
    url?: never;
} | {
    /** @deprecated Renamed to `endpoint` in 0.9. Removed in 1.0 (#67). */
    url: string;
    endpoint?: never;
};
export type SendReportWebhookOptions = SendReportWebhookTarget & {
    /** Injected `fetch`, for tests or a runtime with its own client. */
    fetch?: FetchLike;
    /** Extra request headers — a shared token an intake endpoint expects. */
    headers?: Record<string, string>;
    /** Body shape. Default `json`. */
    format?: WebhookFormat;
    /** Passed through to `toMarkdown` — extra facts, a screenshot URL. */
    markdown?: MarkdownOptions;
};
export type SendReportWebhookResult = {
    /** The HTTP status the webhook answered with. */
    status: number;
};
/**
 * POSTs the report to a webhook. Resolves with the status on a 2xx, throws
 * `SinkError` carrying the status and the response body on anything else, and
 * lets network failures from `fetch` propagate as they are.
 *
 * A malformed report is not an error here: `toMarkdown` renders whatever it
 * can, so a half-built body still reaches the channel where somebody can see
 * that something is wrong.
 */
export declare function sendReportWebhook(report: unknown, options: SendReportWebhookOptions): Promise<SendReportWebhookResult>;
/**
 * @deprecated Renamed to `MAX_DISCORD_CONTENT` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export declare const DISCORD_MAX_CONTENT = 2000;
//# sourceMappingURL=webhook.d.ts.map