/**
 * Sending a report by email through any SMTP account.
 *
 * `sendReportEmail` needs a Resend key. Most people running their own endpoint
 * already have an SMTP account — their host's, Postmark's, Mailgun's, a
 * Stalwart or Postfix box on the same machine — and no reason to sign up for
 * anything. So this is the same email, spoken to a mail server directly.
 *
 * It is a deliberately small client: EHLO, STARTTLS when the server offers it,
 * AUTH PLAIN or LOGIN, one message, QUIT. No connection pooling, no pipelining,
 * no queue, no DSN, no attachments — one report is one connection, and the
 * retrying belongs to whoever runs the endpoint. That is the whole reason it
 * can be zero dependencies: nodemailer is a fine library, but it is a
 * dependency in every server bundle for a conversation that fits in one file.
 *
 * Server-only, and Node-only: it imports `node:net` and `node:tls`. Nothing in
 * the core entry imports this module, so a browser bundle never sees it, and
 * `bugbottle/server` only carries it when you import `smtpSink` yourself.
 *
 * Credentials are never written anywhere. The AUTH exchange is the one part of
 * the conversation this module does not put in an error message, because a
 * failed AUTH LOGIN would otherwise quote the base64 of the password back.
 *
 * Checked against RFC 5321 (SMTP), RFC 5322 (message format), RFC 3207
 * (STARTTLS) and RFC 4954 (AUTH) on 2026-09-08.
 */
import { type ConnectionOptions } from "node:tls";
import { type MarkdownOptions } from "../markdown.ts";
import { type Locale } from "../locales.ts";
import { type ChatSinkContext, type UrlFrom } from "./chat.ts";
/** How long any single phase may take before the connection is given up on. */
export declare const DEFAULT_SMTP_TIMEOUT_MS = 10000;
/** The implicit-TLS port. Every other port starts in the clear. */
export declare const SMTP_TLS_PORT = 465;
/** The submission port. */
export declare const DEFAULT_SMTP_PORT = 587;
/**
 * The status a `SinkError` carries when the server never got as far as saying
 * a code — a refused connection, a hang, a client-side refusal to authenticate
 * over an unencrypted socket. A real reply code is always three digits, so
 * zero cannot collide with one.
 */
export declare const SMTP_NO_REPLY = 0;
export type SmtpSinkOptions = {
    /** The mail server: `smtp.example.com`. */
    host: string;
    /** Default 465 when `secure` is true, and 587 otherwise. */
    port?: number;
    /**
     * Implicit TLS from the first byte, which is what port 465 wants. Left
     * unset, it is true for port 465 and false for anything else — and a plain
     * connection still upgrades itself when the server offers STARTTLS.
     */
    secure?: boolean;
    /** The account name. Without it (and `pass`) no AUTH is attempted at all. */
    user?: string;
    /** The password or app-specific token. Never logged, never in an error. */
    pass?: string;
    /**
     * AUTH over a connection that is not encrypted hands the password to
     * everything between here and the server, so it is refused. Set this only
     * for a server on the same host, or in a test.
     */
    allowInsecureAuth?: boolean;
    /** The envelope sender and the `From` header: `bugs@example.com`. */
    from: string;
    /** One recipient or several. */
    to: string | string[];
    /** Overrides the subject built from the locale and the report title. */
    subject?: string;
    /**
     * Overrides the reply address. Without it, the report's own `contact` field
     * is used when it looks like an email, so hitting reply answers the person
     * who wrote the report. Pass `false` to send no `Reply-To` at all.
     */
    replyTo?: string | false;
    /** The name given in EHLO. Defaults to the domain of `from`. */
    clientName?: string;
    /** Per phase, not for the whole conversation. Default 10 000 ms. */
    timeoutMs?: number;
    /** Passed to `tls.connect`, for a self-signed certificate or a pinned CA. */
    tls?: ConnectionOptions;
    /** Wording of subject and intro. Default English. */
    locale?: Locale;
    /** Where you stored the screenshot. Linked from the facts table. */
    screenshotUrl?: string;
    /** Picks the screenshot address out of the report, when it travels there. */
    screenshotUrlFrom?: UrlFrom;
    /** Passed through to `toMarkdown` — extra facts, a heading level. */
    markdown?: MarkdownOptions;
};
export type SendReportSmtpResult = {
    /** The `Message-ID` this client generated, for the log line. */
    messageId: string;
    /** The server's last line, which usually carries its own queue id. */
    response: string;
};
/** A sink that sends one mail per report. */
export type SmtpSink = (report: unknown, ctx?: ChatSinkContext) => Promise<SendReportSmtpResult>;
/**
 * One header, folded to fit RFC 5322's line length.
 *
 * Folding happens at the spaces already in the value, and a value with no
 * space in it — a long address, an encoded word — is left over-length rather
 * than broken, because a fold inside a token changes what the token says.
 */
export declare function foldHeader(name: string, value: string): string;
/**
 * Dot-stuffing, from RFC 5321 §4.5.2: a line that starts with a period would
 * otherwise be read as the end of the message, so it gets a second one that
 * the server takes back off.
 *
 * Applied to the whole DATA payload, headers included, after the line endings
 * have been normalised — a lone LF inside the body would end the line the
 * server counts from, and dot-stuffing a CRLF-only string is the same walk.
 */
export declare function dotStuff(text: string): string;
/**
 * The RFC 5322 message: headers, then a `multipart/alternative` of the report
 * as text and the same report labelled as Markdown.
 *
 * The two parts carry nearly the same bytes, which is the point — a mail
 * client shows the plain one and a tool that fetches the mail back out gets
 * the Markdown with its table syntax intact and no intro line in front of it.
 */
export declare function buildMessage(input: {
    from: string;
    to: string[];
    subject: string;
    intro: string;
    markdown: string;
    replyTo?: string | undefined;
    date?: Date;
    id?: string;
}): string;
/**
 * Sends one report as one mail over one connection.
 *
 * Resolves with the `Message-ID` it generated and the server's final line —
 * most servers put their queue id in it, which is the string worth writing to
 * a log. Throws `SinkError` carrying the reply code and the server's own line
 * on a refusal, and a `SinkError` with a code of `0` when the failure happened
 * before a reply: a refused connection, a hang, or AUTH asked for over a
 * connection that is not encrypted.
 */
export declare function sendReportSmtp(report: unknown, options: SmtpSinkOptions, ctx?: ChatSinkContext): Promise<SendReportSmtpResult>;
/**
 * A sink that emails one report per connection through an SMTP account.
 *
 * ```ts
 * handleReport(req, {
 *   sinks: [
 *     smtpSink({
 *       host: "smtp.example.com",
 *       user: process.env.SMTP_USER!,
 *       pass: process.env.SMTP_PASS!,
 *       from: "bugs@example.com",
 *       to: "team@example.com",
 *     }),
 *   ],
 * });
 * ```
 */
export declare function smtpSink(options: SmtpSinkOptions): SmtpSink;
//# sourceMappingURL=smtp.d.ts.map