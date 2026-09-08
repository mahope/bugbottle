/**
 * Sending a report on by email through Resend.
 *
 * This is one `fetch` and a formatter, which is why it is here rather than in
 * a dependency. The API key is an argument, never read from the environment:
 * a sink that reaches for `process.env` on its own is a sink that quietly
 * works in one runtime and not another, and it hides where the secret came
 * from at the call site.
 *
 * Server-only, like everything under `bugbottle/server` — a key that reaches
 * the browser is a key that has been given away.
 */

import { looksLikeEmail, normaliseContact } from "../report-core.ts";
import { toMarkdown, type MarkdownOptions } from "../markdown.ts";
import { en, type Locale } from "../locales.ts";
import { messageFromBody, readBody, SinkError, type FetchLike } from "./error.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type SendReportEmailOptions = {
  /** A Resend API key. Read it from your own configuration and pass it in. */
  apiKey: string;
  /** Sender, on a domain verified with Resend. */
  from: string;
  /** One recipient or several. */
  to: string | string[];
  /** Overrides the subject built from the locale and the report title. */
  subject?: string;
  /**
   * Overrides the reply address. Without it, the report's own `contact` field
   * is used when it looks like an email — so hitting reply answers the person
   * who wrote the report. Pass `false` to send no `reply_to` at all.
   */
  replyTo?: string | string[] | false;
  /** Injected `fetch`, for tests or a runtime with its own client. */
  fetch?: FetchLike;
  /** Decoded PNG bytes from `decodeScreenshotDataUrl`, attached as a file. */
  screenshot?: Uint8Array;
  /** Wording of subject and intro. Default English. */
  locale?: Locale;
  /** Passed through to `toMarkdown` — extra facts, a screenshot URL. */
  markdown?: MarkdownOptions;
};

export type SendReportEmailResult = {
  /** The Resend message id, when it answered with one. */
  id: string | undefined;
};

/** Base64 without a dependency: `btoa` exists in Node 18+, workers and Deno. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // In chunks, because spreading a megabyte of bytes into one call blows the
  // argument limit.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The first heading of a rendered report, without the type prefix. */
function titleOf(report: unknown, options: MarkdownOptions): string {
  // The caller's options shape the body, not the subject: with headingLevel 0
  // the first line would be the message or the facts table, so the heading is
  // forced here.
  const heading =
    toMarkdown(report, { ...options, typeInTitle: false, headingLevel: 2, screenshotUrl: undefined })
      .split(/\r?\n/)[0] ?? "";
  return heading.replace(/^#{1,6}\s*/, "").trim();
}

/**
 * Renders the report as Markdown and emails it through Resend. Resolves with
 * the message id, throws `SinkError` carrying the status and the response body
 * on anything but a 2xx, and lets network failures from `fetch` propagate as
 * they are.
 *
 * The body is the Markdown itself, plus a minimal HTML version — no template
 * engine, no inlined CSS. Mail clients render a preformatted block fine, and
 * the plain text stays the thing people actually read.
 */
export async function sendReportEmail(
  report: unknown,
  options: SendReportEmailOptions,
): Promise<SendReportEmailResult> {
  const locale = options.locale ?? en;
  const markdownOptions = options.markdown ?? {};
  const markdown = toMarkdown(report, markdownOptions);
  const title = titleOf(report, markdownOptions);
  const subject = options.subject ?? locale.email.subject.replace("{title}", () => title);
  const intro = locale.email.intro;

  const payload: Record<string, unknown> = {
    from: options.from,
    to: options.to,
    subject,
    text: `${intro}\n\n${markdown}`,
    html: `<p>${escapeHtml(intro)}</p>\n<pre>${escapeHtml(markdown)}</pre>`,
  };
  // A contact line that is an address is what somebody replies to; one that
  // says "call me on 12345678" is not, and Resend would refuse the whole send
  // rather than ignore it. Either way the line is in the body, as a fact row.
  const contact = normaliseContact((report as { contact?: unknown } | null)?.contact);
  const replyTo =
    options.replyTo === false
      ? undefined
      : (options.replyTo ?? (looksLikeEmail(contact) ? contact : undefined));
  if (replyTo) payload.reply_to = replyTo;
  if (options.screenshot && options.screenshot.length > 0) {
    payload.attachments = [
      { filename: "screenshot.png", content: bytesToBase64(options.screenshot) },
    ];
  }

  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await readBody(response);
  if (!response.ok) {
    const fallback = `Resend refused the report with status ${response.status}`;
    throw new SinkError(messageFromBody(body, fallback), response.status, body);
  }

  const id = (body as { id?: unknown } | null)?.id;
  return { id: typeof id === "string" ? id : undefined };
}
