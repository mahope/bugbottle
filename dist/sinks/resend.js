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
import { toMarkdown } from "../markdown.js";
import { en } from "../locales.js";
import { messageFromBody, readBody, SinkError } from "./error.js";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
/** Base64 without a dependency: `btoa` exists in Node 18+, workers and Deno. */
function bytesToBase64(bytes) {
    let binary = "";
    // In chunks, because spreading a megabyte of bytes into one call blows the
    // argument limit.
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
/** The first heading of a rendered report, without the type prefix. */
function titleOf(report, options) {
    // The caller's options shape the body, not the subject: with headingLevel 0
    // the first line would be the message or the facts table, so the heading is
    // forced here.
    const heading = toMarkdown(report, { ...options, typeInTitle: false, headingLevel: 2, screenshotUrl: undefined })
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
export async function sendReportEmail(report, options) {
    const locale = options.locale ?? en;
    const markdownOptions = options.markdown ?? {};
    const markdown = toMarkdown(report, markdownOptions);
    const title = titleOf(report, markdownOptions);
    const subject = options.subject ?? locale.email.subject.replace("{title}", () => title);
    const intro = locale.email.intro;
    const payload = {
        from: options.from,
        to: options.to,
        subject,
        text: `${intro}\n\n${markdown}`,
        html: `<p>${escapeHtml(intro)}</p>\n<pre>${escapeHtml(markdown)}</pre>`,
    };
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
    const id = body?.id;
    return { id: typeof id === "string" ? id : undefined };
}
//# sourceMappingURL=resend.js.map