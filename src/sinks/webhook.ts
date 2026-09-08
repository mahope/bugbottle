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

import { toMarkdown, type MarkdownOptions } from "../markdown.ts";
import { messageFromBody, readBody, SinkError, type FetchLike } from "./error.ts";

/** Discord rejects a longer `content` outright, so we clip before it does. */
export const MAX_DISCORD_CONTENT = 2000;

export type WebhookFormat = "json" | "slack" | "discord";

/**
 * Where the report goes. `endpoint` is the name everything else in the package
 * uses for the address it POSTs to — `sendReport(endpoint, …)`,
 * `QueueOptions.endpoint`, `data-endpoint` — and the address here is the
 * integrator's own server, so it uses the same word.
 */
export type SendReportWebhookTarget = {
  /** The webhook URL. Treat it as a secret: anyone holding it can post. */
  endpoint: string;
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

/** Clips to `max` characters, spending the last one on an ellipsis. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function bodyFor(report: unknown, format: WebhookFormat, markdown: string): unknown {
  if (format === "slack") return { text: markdown };
  if (format === "discord") return { content: clip(markdown, MAX_DISCORD_CONTENT) };
  const base = typeof report === "object" && report !== null ? report : {};
  return { ...(base as Record<string, unknown>), markdown };
}

/**
 * POSTs the report to a webhook. Resolves with the status on a 2xx, throws
 * `SinkError` carrying the status and the response body on anything else, and
 * lets network failures from `fetch` propagate as they are.
 *
 * A malformed report is not an error here: `toMarkdown` renders whatever it
 * can, so a half-built body still reaches the channel where somebody can see
 * that something is wrong.
 */
export async function sendReportWebhook(
  report: unknown,
  options: SendReportWebhookOptions,
): Promise<SendReportWebhookResult> {
  const format = options.format ?? "json";
  const markdown = toMarkdown(report, options.markdown ?? {});

  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(options.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify(bodyFor(report, format, markdown)),
  });

  if (!response.ok) {
    const body = await readBody(response);
    const fallback = `The webhook refused the report with status ${response.status}`;
    throw new SinkError(messageFromBody(body, fallback), response.status, body);
  }

  return { status: response.status };
}
