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
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { looksLikeEmail, normaliseContact } from "../report-core.js";
import { toMarkdown } from "../markdown.js";
import { en } from "../locales.js";
import { SinkError } from "./error.js";
import { resolveUrl } from "./chat.js";
/** How long any single phase may take before the connection is given up on. */
export const DEFAULT_SMTP_TIMEOUT_MS = 10_000;
/** The implicit-TLS port. Every other port starts in the clear. */
export const SMTP_TLS_PORT = 465;
/** The submission port. */
export const DEFAULT_SMTP_PORT = 587;
/**
 * The status a `SinkError` carries when the server never got as far as saying
 * a code — a refused connection, a hang, a client-side refusal to authenticate
 * over an unencrypted socket. A real reply code is always three digits, so
 * zero cannot collide with one.
 */
export const SMTP_NO_REPLY = 0;
/** The longest a header line may be before it is folded. RFC 5322 says 78. */
const MAX_HEADER_LINE = 78;
/* -------------------------------------------------------------------------- */
/* The message                                                                 */
/* -------------------------------------------------------------------------- */
/**
 * Strips CR and LF out of anything that becomes a header value.
 *
 * `Reply-To` comes from the report, which is attacker-controlled input, and a
 * newline in a header value is how somebody adds a `Bcc:` of their own. The
 * value is checked with `looksLikeEmail` before it gets here, which already
 * refuses whitespace, but a second guard costs one `replace` and covers every
 * other header as well.
 */
function headerSafe(value) {
    return value.replace(/[\r\n]+/g, " ").trim();
}
/**
 * An RFC 2047 encoded word, for a subject with a non-ASCII character in it.
 * Base64 of the whole value rather than quoted-printable of the parts: a
 * subject is short, and a reader never sees the encoding either way.
 */
function encodeWord(value) {
    const base64 = Buffer.from(value, "utf8").toString("base64");
    return `=?UTF-8?B?${base64}?=`;
}
/**
 * One header, folded to fit RFC 5322's line length.
 *
 * Folding happens at the spaces already in the value, and a value with no
 * space in it — a long address, an encoded word — is left over-length rather
 * than broken, because a fold inside a token changes what the token says.
 */
export function foldHeader(name, value) {
    const clean = headerSafe(value);
    const encoded = /[^\x20-\x7e]/.test(clean) ? encodeWord(clean) : clean;
    const words = encoded.split(" ").filter((word) => word.length > 0);
    const lines = [];
    let line = `${name}:`;
    for (const word of words) {
        if (line.length + 1 + word.length > MAX_HEADER_LINE && line !== `${name}:`) {
            lines.push(line);
            // A continuation line starts with whitespace; that space is the fold,
            // and unfolding puts it back as the separator it was.
            line = ` ${word}`;
        }
        else {
            line += ` ${word}`;
        }
    }
    lines.push(line);
    return lines.join("\r\n");
}
/**
 * Dot-stuffing, from RFC 5321 §4.5.2: a line that starts with a period would
 * otherwise be read as the end of the message, so it gets a second one that
 * the server takes back off.
 *
 * Applied to the whole DATA payload, headers included, after the line endings
 * have been normalised — a lone LF inside the body would end the line the
 * server counts from, and dot-stuffing a CRLF-only string is the same walk.
 */
export function dotStuff(text) {
    return text.replace(/\r\n\./g, "\r\n..").replace(/^\./, "..");
}
/** Every line of a body reaches the wire as CRLF, whatever it arrived as. */
function toCrlf(text) {
    return text.replace(/\r\n|\r|\n/g, "\r\n");
}
/** Wraps one encoded line at 76 characters, never through an `=XX` triplet. */
function softWrap(line) {
    const lines = [];
    let rest = line;
    while (rest.length > 76) {
        let cut = 75;
        if (rest[cut - 1] === "=")
            cut -= 1;
        else if (rest[cut - 2] === "=")
            cut -= 2;
        lines.push(`${rest.slice(0, cut)}=`);
        rest = rest.slice(cut);
    }
    lines.push(rest);
    return lines.join("\r\n");
}
/**
 * Quoted-printable, from RFC 2045 §6.7.
 *
 * Base64 would be four lines shorter to write, and it would make the whole
 * body unreadable to anything that is not a mail client — including the person
 * reading a stuck message on the server. A report is nearly all ASCII, so
 * quoted-printable leaves it legible and spends three characters on each
 * `æ` and `×` that turns up in a message or a viewport size.
 */
function quotedPrintable(text) {
    const lines = [];
    for (const line of text.split("\r\n")) {
        const bytes = Buffer.from(line, "utf8");
        let encoded = "";
        for (let index = 0; index < bytes.length; index += 1) {
            const byte = bytes[index];
            const trailing = index === bytes.length - 1;
            if ((byte === 0x20 || byte === 0x09) && !trailing) {
                encoded += String.fromCharCode(byte);
            }
            else if (byte >= 0x21 && byte <= 0x7e && byte !== 0x3d) {
                encoded += String.fromCharCode(byte);
            }
            else {
                // A space or a tab at the end of a line is encoded because a mail
                // server is allowed to strip trailing whitespace, and Markdown gives
                // two of them a meaning.
                encoded += `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
            }
        }
        lines.push(softWrap(encoded));
    }
    return lines.join("\r\n");
}
/**
 * How a body part travels.
 *
 * Plain 7-bit text when it is plain 7-bit text and no line is longer than the
 * 998 characters RFC 5321 allows — that is the common case, and it keeps the
 * message readable in a `telnet` session and in a test. Anything else is
 * quoted-printable: a Danish message, or the `×` in a viewport size, is not
 * safe to put on the wire raw when the server never announced 8BITMIME.
 */
function encodePart(text) {
    const crlf = toCrlf(text);
    const longLine = crlf.split("\r\n").some((line) => line.length > 998);
    if (!longLine && !/[^\x00-\x7f]/.test(crlf))
        return { encoding: "7bit", body: crlf };
    return { encoding: "quoted-printable", body: quotedPrintable(crlf) };
}
/** A `Message-ID` that is unique enough without pulling in a uuid library. */
function messageId(domain) {
    const random = Math.random().toString(36).slice(2, 12);
    return `<${Date.now().toString(36)}.${random}@${domain}>`;
}
/** The domain half of an address, for EHLO and the `Message-ID`. */
function domainOf(address) {
    const at = address.lastIndexOf("@");
    const domain = at === -1 ? "" : address.slice(at + 1).trim();
    return /^[a-z0-9.\-]+$/i.test(domain) && domain.length > 0 ? domain : "localhost";
}
/** `Mads <a@b.c>` in a header is `a@b.c` in the envelope. */
function bareAddress(address) {
    const angled = /<([^>]*)>/.exec(address);
    return headerSafe(angled?.[1] ?? address);
}
/** The first heading of a rendered report, without the type prefix. */
function titleOf(report, options) {
    const heading = toMarkdown(report, {
        ...options,
        typeInTitle: false,
        headingLevel: 2,
        screenshotUrl: undefined,
    }).split(/\r?\n/)[0] ?? "";
    return heading.replace(/^#{1,6}\s*/, "").trim();
}
/**
 * The RFC 5322 message: headers, then a `multipart/alternative` of the report
 * as text and the same report labelled as Markdown.
 *
 * The two parts carry nearly the same bytes, which is the point — a mail
 * client shows the plain one and a tool that fetches the mail back out gets
 * the Markdown with its table syntax intact and no intro line in front of it.
 */
export function buildMessage(input) {
    const id = input.id ?? messageId(domainOf(bareAddress(input.from)));
    const boundary = `=_bugbottle_${id.replace(/[^a-z0-9]/gi, "").slice(0, 24)}`;
    const plain = encodePart(`${input.intro}\n\n${input.markdown}`);
    const markdown = encodePart(input.markdown);
    const headers = [
        foldHeader("From", input.from),
        foldHeader("To", input.to.join(", ")),
        ...(input.replyTo ? [foldHeader("Reply-To", input.replyTo)] : []),
        foldHeader("Subject", input.subject),
        foldHeader("Date", (input.date ?? new Date()).toUTCString().replace("GMT", "+0000")),
        foldHeader("Message-ID", id),
        foldHeader("MIME-Version", "1.0"),
        foldHeader("Content-Type", `multipart/alternative; boundary="${boundary}"`),
    ];
    return [
        headers.join("\r\n"),
        "",
        "This is a message in MIME format.",
        `--${boundary}`,
        'Content-Type: text/plain; charset="utf-8"',
        `Content-Transfer-Encoding: ${plain.encoding}`,
        "",
        plain.body,
        `--${boundary}`,
        'Content-Type: text/markdown; charset="utf-8"',
        `Content-Transfer-Encoding: ${markdown.encoding}`,
        "",
        markdown.body,
        `--${boundary}--`,
        "",
    ].join("\r\n");
}
/* -------------------------------------------------------------------------- */
/* The conversation                                                            */
/* -------------------------------------------------------------------------- */
/** A refusal that never reached a server, or a server that stopped talking. */
function localError(message) {
    return new SinkError(message, SMTP_NO_REPLY, undefined);
}
/** A reply the client cannot continue from, with the server's own line in it. */
function replyError(phase, reply) {
    return new SinkError(`The SMTP server refused ${phase} with ${reply.text}`, reply.code, reply.text);
}
/**
 * Reads one reply out of a buffer, or nothing when it is not complete yet.
 *
 * A reply is one or more lines; every line but the last has a hyphen after the
 * code, and the last has a space. Anything that is not `NNN` followed by a
 * hyphen, a space or the end of the line is a server this client will not
 * guess about.
 */
function takeReply(buffer) {
    const lines = [];
    let offset = 0;
    for (;;) {
        const end = buffer.indexOf("\r\n", offset);
        if (end === -1)
            return undefined;
        const line = buffer.slice(offset, end);
        lines.push(line);
        offset = end + 2;
        const separator = line[3];
        if (!/^\d{3}/.test(line)) {
            throw localError(`The SMTP server answered something that is not a reply: ${line}`);
        }
        if (separator === undefined || separator === " ") {
            const code = Number(lines[lines.length - 1].slice(0, 3));
            return { reply: { code, text: lines.join(" "), lines }, rest: buffer.slice(offset) };
        }
    }
}
/**
 * The socket, wrapped in the two operations the conversation needs: send a
 * line, wait for a reply. The socket is replaceable because STARTTLS replaces
 * it — the raw connection becomes the transport under a `TLSSocket`, and every
 * listener has to move across with it or the first encrypted byte is lost.
 */
function createSession(socket, timeoutMs) {
    let current = socket;
    let buffer = "";
    let failure;
    let waiting;
    const onData = (chunk) => {
        buffer += chunk.toString("utf8");
        deliver();
    };
    const onError = (error) => fail(localError(`The SMTP connection failed: ${error.message}`));
    const onClose = () => fail(localError("The SMTP server closed the connection"));
    function deliver() {
        if (!waiting)
            return;
        let taken;
        try {
            taken = takeReply(buffer);
        }
        catch (error) {
            fail(error);
            return;
        }
        if (!taken)
            return;
        buffer = taken.rest;
        const settle = waiting;
        waiting = undefined;
        settle.resolve(taken.reply);
    }
    function fail(error) {
        failure ??= error;
        const settle = waiting;
        waiting = undefined;
        settle?.reject(error);
    }
    function listen(next) {
        next.on("data", onData);
        next.on("error", onError);
        next.on("close", onClose);
    }
    function unlisten(previous) {
        previous.off("data", onData);
        previous.off("error", onError);
        previous.off("close", onClose);
    }
    listen(current);
    /** Waits for one reply, on this phase's deadline. */
    function read(phase) {
        if (failure)
            return Promise.reject(failure);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                fail(localError(`The SMTP server did not answer ${phase} within ${timeoutMs} ms`));
            }, timeoutMs);
            waiting = {
                resolve: (reply) => {
                    clearTimeout(timer);
                    resolve(reply);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            };
            // Whatever arrived while the previous phase was being handled is still
            // in the buffer, so the reply may already be here.
            deliver();
        });
    }
    function write(text) {
        if (failure)
            return Promise.reject(failure);
        return new Promise((resolve, reject) => {
            current.write(text, (error) => (error ? reject(error) : resolve()));
        });
    }
    /** Sends a command and reads the reply it is answered with. */
    async function command(line, phase) {
        await write(`${line}\r\n`);
        return read(phase);
    }
    /** Puts TLS over the connection, keeping the reply reader attached. */
    async function upgrade(host, options) {
        unlisten(current);
        const upgraded = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(localError(`The TLS handshake did not finish within ${timeoutMs} ms`));
            }, timeoutMs);
            const tlsSocket = tlsConnect({ servername: host, ...options, socket: current }, () => {
                clearTimeout(timer);
                resolve(tlsSocket);
            });
            tlsSocket.once("error", (error) => {
                clearTimeout(timer);
                reject(localError(`The TLS handshake failed: ${error.message}`));
            });
        });
        current = upgraded;
        session.secure = true;
        // Whatever the server said before the handshake is not part of the
        // encrypted session, and RFC 3207 says to discard it.
        buffer = "";
        listen(current);
    }
    function close() {
        unlisten(current);
        current.destroy();
    }
    /** Whether AUTH may travel: true once the transport is encrypted. */
    const session = { secure: false, read, write, command, upgrade, close };
    return session;
}
/** Opens the socket, with the same deadline every other phase gets. */
function open(host, port, secure, timeoutMs, tlsOptions) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.destroy();
            reject(localError(`The SMTP connection to ${host}:${port} timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        const done = () => {
            clearTimeout(timer);
            socket.off("error", onError);
            resolve(socket);
        };
        const onError = (error) => {
            clearTimeout(timer);
            reject(localError(`The SMTP connection to ${host}:${port} failed: ${error.message}`));
        };
        const socket = secure
            ? tlsConnect({ host, port, servername: host, ...tlsOptions }, done)
            : netConnect({ host, port }, done);
        socket.once("error", onError);
    });
}
/** The capability names an EHLO reply advertised, upper-cased. */
function capabilities(reply) {
    const names = new Set();
    for (const line of reply.lines.slice(1)) {
        for (const word of line.slice(4).trim().toUpperCase().split(/\s+/)) {
            if (word)
                names.add(word);
        }
    }
    return names;
}
/** Base64 without a line break, which is what AUTH takes and returns. */
function b64(text) {
    return Buffer.from(text, "utf8").toString("base64");
}
/**
 * AUTH PLAIN when the server offers it, LOGIN when it offers only that.
 *
 * The password reaches the socket and nothing else: a failure is reported with
 * the server's reply, never with what was sent, because the base64 of an AUTH
 * LOGIN step is the password in a thin disguise.
 */
async function authenticate(session, user, pass, offered) {
    if (offered.has("LOGIN") && !offered.has("PLAIN")) {
        const start = await session.command("AUTH LOGIN", "AUTH LOGIN");
        if (start.code !== 334)
            throw replyError("AUTH LOGIN", start);
        const afterUser = await session.command(b64(user), "the AUTH LOGIN username");
        if (afterUser.code !== 334)
            throw replyError("the AUTH LOGIN username", afterUser);
        const afterPass = await session.command(b64(pass), "the AUTH LOGIN password");
        if (afterPass.code !== 235)
            throw replyError("the AUTH LOGIN password", afterPass);
        return;
    }
    // RFC 4954: authorisation identity, authentication identity and password,
    // joined by NUL. The authorisation identity is left empty, which means "the
    // one that authenticated".
    const secret = b64(`\u0000${user}\u0000${pass}`);
    const reply = await session.command(`AUTH PLAIN ${secret}`, "AUTH PLAIN");
    if (reply.code !== 235)
        throw replyError("AUTH PLAIN", reply);
}
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
export async function sendReportSmtp(report, options, ctx = {}) {
    const locale = options.locale ?? en;
    const secure = options.secure ?? (options.port ?? DEFAULT_SMTP_PORT) === SMTP_TLS_PORT;
    const port = options.port ?? (secure ? SMTP_TLS_PORT : DEFAULT_SMTP_PORT);
    const timeoutMs = options.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS;
    const recipients = (Array.isArray(options.to) ? options.to : [options.to]).map((address) => headerSafe(address));
    if (recipients.length === 0)
        throw localError("The SMTP sink was given no recipient");
    const screenshotUrl = resolveUrl(options.screenshotUrlFrom, report, options.screenshotUrl ?? ctx.screenshotUrl);
    const markdownOptions = {
        ...options.markdown,
        ...(screenshotUrl ? { screenshotUrl } : {}),
    };
    const markdown = toMarkdown(report, markdownOptions);
    const subject = options.subject ??
        locale.email.subject.replace("{title}", () => titleOf(report, markdownOptions));
    // The same rule as the Resend sink: a contact line that is an address is
    // what somebody replies to, and one that says "call me on 12345678" is left
    // in the body as a fact row.
    const contact = normaliseContact(report?.contact);
    const replyTo = options.replyTo === false
        ? undefined
        : (options.replyTo ?? (looksLikeEmail(contact) ? contact : undefined));
    const sender = bareAddress(options.from);
    const id = messageId(domainOf(sender));
    const message = buildMessage({
        from: options.from,
        to: recipients,
        subject,
        intro: locale.email.intro,
        markdown,
        replyTo,
        id,
    });
    const socket = await open(options.host, port, secure, timeoutMs, options.tls);
    const session = createSession(socket, timeoutMs);
    session.secure = secure;
    try {
        const greeting = await session.read("the greeting");
        if (greeting.code !== 220)
            throw replyError("the connection", greeting);
        const clientName = options.clientName ?? domainOf(sender);
        let hello = await session.command(`EHLO ${headerSafe(clientName)}`, "EHLO");
        if (hello.code !== 250)
            throw replyError("EHLO", hello);
        let offered = capabilities(hello);
        if (!session.secure && offered.has("STARTTLS")) {
            const ready = await session.command("STARTTLS", "STARTTLS");
            if (ready.code !== 220)
                throw replyError("STARTTLS", ready);
            await session.upgrade(options.host, options.tls);
            // The capability list before the handshake is not to be trusted, so the
            // greeting is asked for again over the encrypted connection.
            hello = await session.command(`EHLO ${headerSafe(clientName)}`, "the second EHLO");
            if (hello.code !== 250)
                throw replyError("the second EHLO", hello);
            offered = capabilities(hello);
        }
        if (options.user && options.pass) {
            if (!session.secure && !options.allowInsecureAuth) {
                throw localError("The SMTP server offered no STARTTLS, so authenticating would send the password " +
                    "in the clear. Use a TLS port, or set allowInsecureAuth for a server you trust.");
            }
            await authenticate(session, options.user, options.pass, offered);
        }
        const mailFrom = await session.command(`MAIL FROM:<${sender}>`, "MAIL FROM");
        if (mailFrom.code !== 250)
            throw replyError("MAIL FROM", mailFrom);
        for (const recipient of recipients) {
            const address = bareAddress(recipient);
            const rcpt = await session.command(`RCPT TO:<${address}>`, "RCPT TO");
            // 251 is "not local, will forward", which is a yes.
            if (rcpt.code !== 250 && rcpt.code !== 251)
                throw replyError(`RCPT TO <${address}>`, rcpt);
        }
        const data = await session.command("DATA", "DATA");
        if (data.code !== 354)
            throw replyError("DATA", data);
        await session.write(`${dotStuff(toCrlf(message))}\r\n.\r\n`);
        const accepted = await session.read("the message");
        if (accepted.code !== 250)
            throw replyError("the message", accepted);
        // QUIT is a courtesy, not a delivery: the message is accepted by the reply
        // above, so a server that hangs up rudely here has still taken it.
        try {
            await session.command("QUIT", "QUIT");
        }
        catch {
            // Nothing to do about it, and nothing worth telling the caller.
        }
        return { messageId: id, response: accepted.text };
    }
    finally {
        session.close();
    }
}
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
export function smtpSink(options) {
    return (report, ctx = {}) => sendReportSmtp(report, options, ctx);
}
//# sourceMappingURL=smtp.js.map