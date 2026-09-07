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
import { type MarkdownOptions } from "../markdown.ts";
import { type Locale } from "../locales.ts";
import { type FetchLike } from "./error.ts";
export type SendReportEmailOptions = {
    /** A Resend API key. Read it from your own configuration and pass it in. */
    apiKey: string;
    /** Sender, on a domain verified with Resend. */
    from: string;
    /** One recipient or several. */
    to: string | string[];
    /** Overrides the subject built from the locale and the report title. */
    subject?: string;
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
export declare function sendReportEmail(report: unknown, options: SendReportEmailOptions): Promise<SendReportEmailResult>;
//# sourceMappingURL=resend.d.ts.map