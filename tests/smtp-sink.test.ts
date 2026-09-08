/**
 * The SMTP sink, against a scripted mail server on `node:net`.
 *
 * There is no network here and no mail account: the server below answers from
 * a script and records every line it was given, so a test can read the
 * conversation the way `tcpdump` would. That is the only honest way to test a
 * protocol client — asserting on the strings that reach the wire, not on the
 * shape of an object that was meant to become them.
 *
 * The STARTTLS test goes through the whole upgrade. The certificate is built
 * here, in DER, from a key pair `node:crypto` generates: a minimal X.509 is a
 * hundred lines of ASN.1 and no dependency, where a checked-in PEM would be a
 * private key in a public repository and an expiry date somebody has to renew.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { generateKeyPairSync, sign as signWith } from "node:crypto";
import {
  buildMessage,
  dotStuff,
  foldHeader,
  sendReportSmtp,
  smtpSink,
  SMTP_NO_REPLY,
} from "../src/sinks/smtp.ts";
import { SinkError } from "../src/sinks/error.ts";
import { da } from "../src/locales.ts";

const NUL = String.fromCharCode(0);

const report = {
  type: "bug",
  message: "The save button does nothing",
  contact: "reporter@example.com",
  context: { url: "/orders/91", viewport: "1440×900", userAgent: "Chrome 141" },
  console: [{ level: "error", message: "save failed", ts: "2026-09-07T10:00:00.000Z" }],
};

/* -------------------------------------------------------------------------- */
/* A self-signed certificate, built here so the STARTTLS test can finish       */
/* -------------------------------------------------------------------------- */

/** DER: the length prefix, short form under 128 and long form above it. */
function derLength(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size]);
  const bytes: number[] = [];
  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** DER: one tag-length-value. */
function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const SEQUENCE = 0x30;
const SET = 0x31;
const INTEGER = 0x02;
const BIT_STRING = 0x03;
const UTC_TIME = 0x17;
const UTF8_STRING = 0x0c;

/** `sha256WithRSAEncryption` (1.2.840.113549.1.1.11), with its NULL parameter. */
const SHA256_RSA = der(
  SEQUENCE,
  Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
  Buffer.from([0x05, 0x00]),
);

/** `CN=<name>`, the only attribute the certificate carries. */
function name(common: string): Buffer {
  return der(
    SEQUENCE,
    der(
      SET,
      der(
        SEQUENCE,
        Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]),
        der(UTF8_STRING, Buffer.from(common, "utf8")),
      ),
    ),
  );
}

/** `YYMMDDHHMMSSZ`, which is what a UTCTime is until 2050. */
function utcTime(date: Date): Buffer {
  const pad = (value: number) => String(value).padStart(2, "0");
  const text =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z";
  return der(UTC_TIME, Buffer.from(text, "ascii"));
}

function pem(label: string, bytes: Buffer): string {
  const body = (bytes.toString("base64").match(/.{1,64}/g) ?? []).join("\n");
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

/**
 * A self-signed certificate for `localhost`, valid for a decade. The client
 * connects with `rejectUnauthorized: false`, so what matters is that the
 * structure parses and the signature is over the right bytes.
 */
function selfSigned(): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const now = new Date();
  const tbs = der(
    SEQUENCE,
    der(0xa0, der(INTEGER, Buffer.from([0x02]))), // version 3
    der(INTEGER, Buffer.from([0x01])), // serial 1
    SHA256_RSA,
    name("localhost"),
    der(
      SEQUENCE,
      utcTime(new Date(now.getTime() - 86_400_000)),
      utcTime(new Date(now.getTime() + 3650 * 86_400_000)),
    ),
    name("localhost"),
    spki,
  );
  const signature = signWith("sha256", tbs, privateKey);
  const certificate = der(
    SEQUENCE,
    tbs,
    SHA256_RSA,
    der(BIT_STRING, Buffer.from([0x00]), signature),
  );
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    cert: pem("CERTIFICATE", certificate),
  };
}

/* -------------------------------------------------------------------------- */
/* The scripted server                                                         */
/* -------------------------------------------------------------------------- */

type FakeOptions = {
  /** Capability lines after the `250-` greeting: `AUTH PLAIN LOGIN`, `STARTTLS`. */
  ehlo?: string[];
  /** Replies keyed by verb, overriding the defaults: `RCPT`, `MAIL`, `DATA`. */
  replies?: Record<string, string>;
  /** The verb after which the server says nothing at all. */
  hangAfter?: string;
  /** Offers STARTTLS and really upgrades, with this key and certificate. */
  tls?: { key: string; cert: string };
};

type Fake = {
  port: number;
  /** Every command line the server was given, in order. */
  commands: string[];
  /** The DATA payload exactly as it arrived, dot-stuffing and all. */
  data: string;
  /** True once the conversation moved inside TLS. */
  encrypted: boolean;
  close: () => Promise<void>;
};

async function startSmtp(options: FakeOptions = {}): Promise<Fake> {
  const state: Fake = {
    port: 0,
    commands: [],
    data: "",
    encrypted: false,
    close: async () => {},
  };
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    let buffer = "";
    let inData = false;
    let authStep = 0;
    let current: Socket | TLSSocket = socket;

    const say = (line: string) => current.write(`${line}\r\n`);

    const handle = (line: string) => {
      if (inData) {
        if (line === ".") {
          inData = false;
          say(options.replies?.["DATA_END"] ?? "250 2.0.0 Ok: queued as 4F1D2");
          return;
        }
        state.data += `${line}\r\n`;
        return;
      }
      state.commands.push(line);
      const verb = line.split(" ")[0]?.toUpperCase() ?? "";
      if (options.hangAfter && verb === options.hangAfter.toUpperCase()) return;

      if (authStep === 1) {
        authStep = 2;
        say("334 UGFzc3dvcmQ6");
        return;
      }
      if (authStep === 2) {
        authStep = 0;
        say(options.replies?.["AUTH"] ?? "235 2.7.0 Authentication successful");
        return;
      }

      const override = options.replies?.[verb];
      if (override) {
        say(override);
        return;
      }

      switch (verb) {
        case "EHLO": {
          const extra = options.ehlo ?? [];
          const all = options.tls ? [...extra, "STARTTLS"] : extra;
          say(`250-fake greets you`);
          for (const [index, capability] of all.entries()) {
            say(`${index === all.length - 1 ? "250 " : "250-"}${capability}`);
          }
          if (all.length === 0) say("250 SIZE 10240000");
          return;
        }
        case "STARTTLS": {
          if (!options.tls) {
            say("502 5.5.1 Not implemented");
            return;
          }
          say("220 2.0.0 Ready to start TLS");
          current.removeAllListeners("data");
          const secure = new TLSSocket(current as Socket, {
            isServer: true,
            key: options.tls.key,
            cert: options.tls.cert,
          });
          current = secure;
          state.encrypted = true;
          buffer = "";
          secure.on("data", onData);
          secure.on("error", () => {});
          return;
        }
        case "AUTH": {
          if (/^AUTH\s+LOGIN\s*$/i.test(line)) {
            authStep = 1;
            say("334 VXNlcm5hbWU6");
            return;
          }
          say(options.replies?.["AUTH"] ?? "235 2.7.0 Authentication successful");
          return;
        }
        case "DATA":
          inData = true;
          say("354 End data with <CR><LF>.<CR><LF>");
          return;
        case "QUIT":
          say("221 2.0.0 Bye");
          current.end();
          return;
        default:
          say("250 2.0.0 Ok");
      }
    };

    function onData(chunk: Buffer): void {
      buffer += chunk.toString("utf8");
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end === -1) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        handle(line);
      }
    }

    socket.on("data", onData);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    if (options.hangAfter !== "greeting") say("220 fake.example.com ESMTP");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  state.port = typeof address === "object" && address ? address.port : 0;
  state.close = () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
  return state;
}

/** The message as the server reconstructs it: dot-stuffing taken back off. */
function received(fake: Fake): string {
  return fake.data.replace(/\r\n\.\./g, "\r\n.").replace(/^\.\./, ".");
}

/**
 * One MIME part of a received message, decoded back to the text that went in.
 * A test asserts on what the reader sees, not on the transfer encoding — that
 * has a test of its own.
 */
function part(message: string, contentType: string): string {
  const boundary = /boundary="([^"]+)"/.exec(message.replace(/\r\n[ \t]+/g, " "))?.[1];
  assert.ok(boundary, "the message declares a boundary");
  const sections = message.split(`--${boundary}`);
  const section = sections.find((piece) => piece.includes(`Content-Type: ${contentType}`));
  assert.ok(section, `the message has a ${contentType} part`);
  const headers = section.split("\r\n\r\n")[0] ?? "";
  const body = section.slice(headers.length + 4).replace(/\r\n$/, "");
  if (headers.includes("quoted-printable")) {
    return body
      .replace(/=\r\n/g, "")
      .replace(/(?:=[0-9A-F]{2})+/g, (run) =>
        Buffer.from(run.split("=").filter(Boolean).join(""), "hex").toString("utf8"),
      );
  }
  if (headers.includes("base64")) return Buffer.from(body, "base64").toString("utf8");
  return body;
}

/** One header's unfolded value out of a received message. */
function header(message: string, field: string): string | undefined {
  const headers = message.split("\r\n\r\n")[0] ?? "";
  const unfolded = headers.replace(/\r\n[ \t]+/g, " ");
  for (const line of unfolded.split("\r\n")) {
    if (line.toLowerCase().startsWith(`${field.toLowerCase()}:`)) {
      return line.slice(field.length + 1).trim();
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* The conversation                                                            */
/* -------------------------------------------------------------------------- */

test("the plain path sends one message end to end", async () => {
  const fake = await startSmtp();
  try {
    const result = await sendReportSmtp(report, {
      host: "127.0.0.1",
      port: fake.port,
      from: "bugs@example.com",
      to: ["team@example.com", "ops@example.com"],
    });

    assert.match(fake.commands[0] ?? "", /^EHLO /);
    assert.equal(fake.commands[1], "MAIL FROM:<bugs@example.com>");
    assert.equal(fake.commands[2], "RCPT TO:<team@example.com>");
    assert.equal(fake.commands[3], "RCPT TO:<ops@example.com>");
    assert.equal(fake.commands[4], "DATA");
    assert.equal(fake.commands[5], "QUIT");

    const message = received(fake);
    assert.equal(header(message, "From"), "bugs@example.com");
    assert.equal(header(message, "To"), "team@example.com, ops@example.com");
    assert.equal(header(message, "Subject"), "New report: The save button does nothing");
    // The contact line is an address, so answering the mail answers the person.
    assert.equal(header(message, "Reply-To"), "reporter@example.com");
    assert.match(header(message, "Content-Type") ?? "", /^multipart\/alternative; boundary="/);
    assert.match(part(message, "text/plain"), /A new report arrived/);
    assert.match(part(message, "text/plain"), /## Bug: The save button does nothing/);
    // The second part is the same report without the intro line, so a tool
    // that fetches the mail back gets the Markdown and nothing else.
    assert.match(part(message, "text/markdown"), /^## Bug: The save button does nothing/);
    assert.doesNotMatch(part(message, "text/markdown"), /A new report arrived/);
    assert.equal(result.messageId, header(message, "Message-ID"));
    assert.match(result.response, /queued as 4F1D2/);
  } finally {
    await fake.close();
  }
});

test("a contact line that is not an address sends no Reply-To", async () => {
  const fake = await startSmtp();
  try {
    await sendReportSmtp(
      { ...report, contact: "call me on 12345678" },
      { host: "127.0.0.1", port: fake.port, from: "bugs@example.com", to: "team@example.com" },
    );
    assert.equal(header(received(fake), "Reply-To"), undefined);
  } finally {
    await fake.close();
  }
});

test("the locale decides the subject and the intro", async () => {
  const fake = await startSmtp();
  try {
    await sendReportSmtp(report, {
      host: "127.0.0.1",
      port: fake.port,
      from: "bugs@example.com",
      to: "team@example.com",
      locale: da,
    });
    const message = received(fake);
    assert.equal(header(message, "Subject"), "Ny rapport: The save button does nothing");
    assert.match(part(message, "text/plain"), /Detaljerne står nedenfor/);
  } finally {
    await fake.close();
  }
});

test("AUTH PLAIN carries the credentials the way RFC 4954 spells them", async () => {
  const fake = await startSmtp({ ehlo: ["AUTH PLAIN LOGIN"] });
  try {
    await sendReportSmtp(report, {
      host: "127.0.0.1",
      port: fake.port,
      from: "bugs@example.com",
      to: "team@example.com",
      user: "postmaster@example.com",
      pass: "hunter2",
      allowInsecureAuth: true,
    });
    const auth = fake.commands.find((line) => line.startsWith("AUTH PLAIN "));
    assert.ok(auth, "the client authenticated");
    const decoded = Buffer.from(auth.slice("AUTH PLAIN ".length), "base64").toString("utf8");
    assert.equal(decoded, `${NUL}postmaster@example.com${NUL}hunter2`);
    // And it still sent the mail afterwards.
    assert.ok(fake.commands.includes("MAIL FROM:<bugs@example.com>"));
  } finally {
    await fake.close();
  }
});

test("AUTH LOGIN is used when the server offers only that", async () => {
  const fake = await startSmtp({ ehlo: ["AUTH LOGIN"] });
  try {
    await sendReportSmtp(report, {
      host: "127.0.0.1",
      port: fake.port,
      from: "bugs@example.com",
      to: "team@example.com",
      user: "bugs",
      pass: "hunter2",
      allowInsecureAuth: true,
    });
    const start = fake.commands.indexOf("AUTH LOGIN");
    assert.ok(start >= 0, "the client asked for AUTH LOGIN");
    assert.equal(Buffer.from(fake.commands[start + 1] ?? "", "base64").toString("utf8"), "bugs");
    assert.equal(Buffer.from(fake.commands[start + 2] ?? "", "base64").toString("utf8"), "hunter2");
  } finally {
    await fake.close();
  }
});

test("AUTH is refused over a connection that is not encrypted", async () => {
  const fake = await startSmtp({ ehlo: ["AUTH PLAIN LOGIN"] });
  try {
    const failure = await sendReportSmtp(report, {
      host: "127.0.0.1",
      port: fake.port,
      from: "bugs@example.com",
      to: "team@example.com",
      user: "bugs",
      pass: "hunter2",
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    assert.ok(failure instanceof SinkError, "a SinkError is thrown");
    assert.equal(failure.status, SMTP_NO_REPLY);
    assert.match(failure.message, /allowInsecureAuth/);
    assert.doesNotMatch(failure.message, /hunter2/, "the password is never in the message");
    assert.ok(
      !fake.commands.some((line) => line.startsWith("AUTH")),
      "nothing was sent to the server",
    );
  } finally {
    await fake.close();
  }
});

test("a line that starts with a period is dot-stuffed on the wire", async () => {
  const fake = await startSmtp();
  const message = "It fails when I save.\n.hidden line\n..two dots";
  try {
    await sendReportSmtp(
      { ...report, message },
      { host: "127.0.0.1", port: fake.port, from: "bugs@example.com", to: "team@example.com" },
    );
    // What arrived is stuffed…
    assert.match(fake.data, /\r\n\.\.hidden line\r\n/);
    assert.match(fake.data, /\r\n\.\.\.two dots\r\n/);
    // …and unstuffs back to what was written.
    assert.match(received(fake), /\r\n\.hidden line\r\n/);
    assert.match(received(fake), /\r\n\.\.two dots\r\n/);
    // The lone period the server read as the end never reached the body.
    assert.doesNotMatch(fake.data, /\r\n\.\r\n/);
  } finally {
    await fake.close();
  }
});

test("a long header is folded, and unfolds to the value it was given", async () => {
  const fake = await startSmtp();
  const subject =
    "The save button does nothing at all when the order has more than forty lines on it " +
    "and the customer is in another country";
  try {
    await sendReportSmtp(report, {
      host: "127.0.0.1",
      port: fake.port,
      from: "bugs@example.com",
      to: "team@example.com",
      subject,
    });
    const message = received(fake);
    const headers = message.split("\r\n\r\n")[0] ?? "";
    assert.ok(headers.includes("\r\n "), "the subject was folded onto a continuation line");
    for (const line of headers.split("\r\n")) {
      assert.ok(line.length <= 78, `a header line is ${line.length} characters: ${line}`);
    }
    assert.equal(header(message, "Subject"), subject);
  } finally {
    await fake.close();
  }
});

test("STARTTLS is taken up, and the message travels inside it", async () => {
  const credentials = selfSigned();
  const fake = await startSmtp({ ehlo: ["AUTH PLAIN LOGIN"], tls: credentials });
  try {
    await sendReportSmtp(report, {
      host: "localhost",
      port: fake.port,
      from: "bugs@example.com",
      to: "team@example.com",
      user: "bugs",
      pass: "hunter2",
      tls: { rejectUnauthorized: false },
    });

    assert.ok(fake.encrypted, "the server upgraded the connection");
    assert.equal(fake.commands.filter((line) => line.startsWith("EHLO")).length, 2);
    const starttls = fake.commands.indexOf("STARTTLS");
    assert.ok(starttls > 0, "STARTTLS was asked for");
    // Everything that matters happened after the upgrade: the second EHLO, the
    // credentials, and the message itself.
    const after = fake.commands.slice(starttls + 1);
    assert.match(after[0] ?? "", /^EHLO /);
    assert.ok(after.some((line) => line.startsWith("AUTH PLAIN ")));
    assert.ok(after.includes("DATA"));
    assert.match(part(received(fake), "text/plain"), /## Bug: The save button does nothing/);
  } finally {
    await fake.close();
  }
});

test("a 5xx reply throws a SinkError carrying the code and the server's line", async () => {
  const fake = await startSmtp({
    replies: { RCPT: "550 5.1.1 <team@example.com>: Recipient address rejected" },
  });
  try {
    const failure = await sendReportSmtp(report, {
      host: "127.0.0.1",
      port: fake.port,
      from: "bugs@example.com",
      to: "team@example.com",
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    assert.ok(failure instanceof SinkError);
    assert.equal(failure.status, 550);
    assert.match(failure.message, /Recipient address rejected/);
    assert.match(String(failure.body), /^550 5\.1\.1 /);
  } finally {
    await fake.close();
  }
});

test("a server that stops answering ends in a timeout, not a hang", async () => {
  const fake = await startSmtp({ hangAfter: "MAIL" });
  try {
    const started = Date.now();
    const failure = await sendReportSmtp(report, {
      host: "127.0.0.1",
      port: fake.port,
      from: "bugs@example.com",
      to: "team@example.com",
      timeoutMs: 120,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    assert.ok(failure instanceof SinkError);
    assert.equal(failure.status, SMTP_NO_REPLY);
    assert.match(failure.message, /did not answer MAIL FROM within 120 ms/);
    assert.ok(Date.now() - started < 5000, "it gave up quickly");
  } finally {
    await fake.close();
  }
});

test("a connection that is refused is a SinkError with no reply code", async () => {
  const fake = await startSmtp({ replies: {} });
  await fake.close();
  const failure = await sendReportSmtp(report, {
    host: "127.0.0.1",
    port: fake.port,
    from: "bugs@example.com",
    to: "team@example.com",
    timeoutMs: 200,
  }).then(
    () => undefined,
    (error: unknown) => error,
  );
  assert.ok(failure instanceof SinkError, "a refused connection is a SinkError too");
  assert.equal(failure.status, SMTP_NO_REPLY);
});

test("smtpSink is a factory `handleReport` can run, and takes the screenshot URL", async () => {
  const fake = await startSmtp();
  try {
    const sink = smtpSink({
      host: "127.0.0.1",
      port: fake.port,
      from: "bugs@example.com",
      to: "team@example.com",
    });
    await sink(report, { screenshotUrl: "https://files.example.com/a.png" });
    assert.match(part(received(fake), "text/plain"), /https:\/\/files\.example\.com\/a\.png/);
  } finally {
    await fake.close();
  }
});

/* -------------------------------------------------------------------------- */
/* The message, without a server in the way                                    */
/* -------------------------------------------------------------------------- */

test("a header with no space in it is left over-length rather than broken", () => {
  const address = `a${"very-long-".repeat(9)}address@example.com`;
  const folded = foldHeader("To", address);
  assert.equal(folded, `To: ${address}`);
  assert.ok(!folded.includes("\r\n"), "a token is never folded through the middle");
});

test("a header value cannot smuggle a second header in", () => {
  const folded = foldHeader("Reply-To", "evil@example.com\r\nBcc: everyone@example.com");
  assert.equal(folded.split("\r\n").length, 1);
  assert.ok(!/\r|\n/.test(folded.replace(/\r\n[ \t]/g, "")));
  assert.match(folded, /^Reply-To: evil@example\.com Bcc: everyone@example\.com$/);
});

test("a non-ASCII display name is encoded without swallowing the address", () => {
  const folded = foldHeader("From", "Bjørn Hansen <bugs@example.com>");
  // The address has to survive as an address: an encoded word around the whole
  // value leaves a From header no MTA can route or reply to.
  assert.match(folded, /<bugs@example\.com>$/);
  assert.match(folded, /=\?UTF-8\?B\?/);
  assert.ok(!folded.includes("Bjørn"), "the name itself is not left raw on the wire");
});

test("every address in a non-ASCII To keeps its angle brackets", () => {
  const folded = foldHeader("To", "Bjørn <a@b.c>, Ana <d@e.f>");
  const unfolded = folded.replace(/\r\n[ \t]/g, " ");
  assert.match(unfolded, /<a@b\.c>/);
  assert.match(unfolded, /<d@e\.f>/);
});

test("an encoded word stays inside the seventy-five characters RFC 2047 allows", () => {
  const folded = foldHeader(
    "Subject",
    "Fejl på siden når jeg trykker på knappen med en meget lang overskrift " +
      "der fylder mere end otteoghalvfjerds tegn",
  );
  for (const word of folded.match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? []) {
    assert.ok(word.length <= 75, `an encoded word of ${word.length} characters is too long`);
  }
  // Each folded line still fits, and every continuation begins with the space
  // that unfolding turns back into the separator it was.
  for (const line of folded.split("\r\n")) assert.ok(line.length <= 78, `over-long: ${line}`);
});

test("dot-stuffing covers the first line as well as the rest", () => {
  assert.equal(dotStuff(".first\r\nsecond"), "..first\r\nsecond");
  assert.equal(dotStuff("first\r\n.second"), "first\r\n..second");
  assert.equal(dotStuff("nothing to do"), "nothing to do");
});

test("a non-ASCII body travels quoted-printable rather than raw eight-bit", () => {
  const message = buildMessage({
    from: "bugs@example.com",
    to: ["team@example.com"],
    subject: "Fejl på siden",
    intro: "En ny rapport",
    markdown: "## Fejl\n\nKnappen gør ingenting på siden æøå.",
    id: "<x@example.com>",
  });
  assert.match(message, /Content-Transfer-Encoding: quoted-printable/);
  // The ASCII around it is still readable, which is the whole reason for
  // quoted-printable over base64.
  assert.match(message, /Knappen g=C3=B8r ingenting p=C3=A5 siden =C3=A6=C3=B8=C3=A5\./);
  assert.equal(part(message, "text/markdown"), "## Fejl\r\n\r\nKnappen gør ingenting på siden æøå.");
  // A non-ASCII subject cannot travel raw at all, so it is an encoded word.
  const subject = header(message, "Subject") ?? "";
  assert.match(subject, /^=\?UTF-8\?B\?/);
  const decoded = Buffer.from(/\?B\?([^?]+)\?=/.exec(subject)?.[1] ?? "", "base64");
  assert.equal(decoded.toString("utf8"), "Fejl på siden");
});

test("a body line longer than 76 characters is soft-wrapped and comes back whole", () => {
  const long = `Rapporten fejler på siden ${"med mange ord ".repeat(15)}slut.`;
  const message = buildMessage({
    from: "bugs@example.com",
    to: ["team@example.com"],
    subject: "Report",
    intro: "En ny rapport på dansk",
    markdown: long,
    id: "<x@example.com>",
  });
  for (const line of message.split("\r\n")) {
    assert.ok(line.length <= 78, `a line is ${line.length} characters long`);
  }
  assert.equal(part(message, "text/markdown"), long);
});

test("an ASCII body stays readable on the wire", () => {
  const message = buildMessage({
    from: "bugs@example.com",
    to: ["team@example.com"],
    subject: "Report",
    intro: "A new report arrived",
    markdown: "## Bug: it broke\n\nNothing happened.",
    id: "<x@example.com>",
  });
  assert.match(message, /Content-Transfer-Encoding: 7bit/);
  assert.match(message, /Nothing happened\./);
  assert.doesNotMatch(message, /Content-Transfer-Encoding: quoted-printable/);
});
