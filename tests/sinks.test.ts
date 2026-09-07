import { test } from "node:test";
import assert from "node:assert/strict";
import { sendReportEmail } from "../src/sinks/resend.ts";
import { sendReportWebhook, DISCORD_MAX_CONTENT } from "../src/sinks/webhook.ts";
import { SinkError } from "../src/sinks/error.ts";
import { da } from "../src/locales.ts";

/** A fetch stand-in that records the request and answers with the given body. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    // 204 is what Discord answers with, and a body is not allowed with it.
    if (status === 204) return new Response(null, { status });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** The JSON body of the single recorded request. */
function sentBody(calls: { init: RequestInit }[]): Record<string, unknown> {
  assert.equal(calls.length, 1, "exactly one request was made");
  return JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

const report = {
  type: "bug",
  message: "The save button does nothing",
  context: { url: "/orders/91", viewport: "1440×900", userAgent: "Chrome 141" },
  console: [{ level: "error", message: "save failed", ts: "2026-09-07T10:00:00.000Z" }],
};

test("the email goes to Resend with a bearer key and the report as Markdown", async () => {
  const { fetch, calls } = fakeFetch(200, { id: "re_123" });
  const result = await sendReportEmail(report, {
    apiKey: "re_test_key",
    from: "bugs@example.com",
    to: "team@example.com",
    fetch,
  });

  assert.equal(result.id, "re_123");
  assert.equal(calls[0]?.url, "https://api.resend.com/emails");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal(headerOf(calls[0]!.init, "Authorization"), "Bearer re_test_key");
  assert.equal(headerOf(calls[0]!.init, "Content-Type"), "application/json");

  const body = sentBody(calls);
  assert.equal(body.from, "bugs@example.com");
  assert.equal(body.to, "team@example.com");
  assert.equal(body.subject, "New report: The save button does nothing");
  assert.match(String(body.text), /## Bug: The save button does nothing/);
  assert.match(String(body.text), /A new report arrived/);
  assert.match(String(body.html), /^<p>A new report arrived/);
  assert.equal("attachments" in body, false, "no attachment key without a screenshot");
});

test("the subject and intro follow the locale, and an explicit subject wins", async () => {
  const danish = fakeFetch(200, { id: "re_1" });
  await sendReportEmail(report, {
    apiKey: "k",
    from: "a@b.c",
    to: ["one@example.com", "two@example.com"],
    locale: da,
    fetch: danish.fetch,
  });
  const body = sentBody(danish.calls);
  assert.equal(body.subject, "Ny rapport: The save button does nothing");
  assert.match(String(body.text), /Der er kommet en ny rapport/);
  assert.deepEqual(body.to, ["one@example.com", "two@example.com"]);

  const override = fakeFetch(200, { id: "re_2" });
  await sendReportEmail(report, {
    apiKey: "k",
    from: "a@b.c",
    to: "t@example.com",
    subject: "Something specific",
    fetch: override.fetch,
  });
  assert.equal(sentBody(override.calls).subject, "Something specific");
});

test("a screenshot is attached as base64 PNG bytes", async () => {
  const { fetch, calls } = fakeFetch(200, { id: "re_3" });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
  await sendReportEmail(report, {
    apiKey: "k",
    from: "a@b.c",
    to: "t@example.com",
    screenshot: png,
    fetch,
  });

  const attachments = sentBody(calls).attachments as { filename: string; content: string }[];
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]?.filename, "screenshot.png");
  assert.deepEqual(
    new Uint8Array(Buffer.from(attachments[0]!.content, "base64")),
    png,
    "the attachment decodes back to the same bytes",
  );
});

test("a refused email becomes a SinkError carrying the status and body", async () => {
  const { fetch } = fakeFetch(422, { message: "The from address is not verified" });
  await assert.rejects(
    () =>
      sendReportEmail(report, { apiKey: "k", from: "a@b.c", to: "t@example.com", fetch }),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 422);
      assert.equal(err.message, "The from address is not verified");
      assert.deepEqual(err.body, { message: "The from address is not verified" });
      return true;
    },
  );
});

test("an email for a malformed report still sends, with a fallback title", async () => {
  const { fetch, calls } = fakeFetch(200, { id: "re_4" });
  const result = await sendReportEmail(
    { type: 42, message: null, console: "not an array" },
    { apiKey: "k", from: "a@b.c", to: "t@example.com", fetch },
  );

  assert.equal(result.id, "re_4");
  const body = sentBody(calls);
  assert.equal(body.subject, "New report: Feedback");
  assert.match(String(body.text), /## Feedback: Feedback/);
});

test("a resend answer without an id resolves with no id rather than failing", async () => {
  const { fetch } = fakeFetch(200, "accepted");
  const result = await sendReportEmail(report, {
    apiKey: "k",
    from: "a@b.c",
    to: "t@example.com",
    fetch,
  });
  assert.equal(result.id, undefined);
});

test("the json webhook posts the report itself plus a markdown field", async () => {
  const { fetch, calls } = fakeFetch(200, { ok: true });
  const result = await sendReportWebhook(report, {
    url: "https://hook.example.com/intake",
    headers: { "X-Token": "s3cret" },
    fetch,
  });

  assert.equal(result.status, 200);
  assert.equal(calls[0]?.url, "https://hook.example.com/intake");
  assert.equal(headerOf(calls[0]!.init, "X-Token"), "s3cret");
  const body = sentBody(calls);
  assert.equal(body.type, "bug");
  assert.equal(body.message, "The save button does nothing");
  assert.match(String(body.markdown), /## Bug: The save button does nothing/);
});

test("slack gets text and discord gets content", async () => {
  const slack = fakeFetch(200, "ok");
  await sendReportWebhook(report, {
    url: "https://hooks.slack.com/services/x",
    format: "slack",
    fetch: slack.fetch,
  });
  const slackBody = sentBody(slack.calls);
  assert.deepEqual(Object.keys(slackBody), ["text"]);
  assert.match(String(slackBody.text), /## Bug: The save button does nothing/);

  const discord = fakeFetch(204, "");
  const result = await sendReportWebhook(report, {
    url: "https://discord.com/api/webhooks/x",
    format: "discord",
    fetch: discord.fetch,
  });
  assert.equal(result.status, 204);
  assert.deepEqual(Object.keys(sentBody(discord.calls)), ["content"]);
});

test("a long report is clipped to the discord limit", async () => {
  const { fetch, calls } = fakeFetch(204, "");
  const long = {
    type: "bug",
    message: `Overflowing\n${"x".repeat(5000)}`,
  };
  await sendReportWebhook(long, {
    url: "https://discord.com/api/webhooks/x",
    format: "discord",
    fetch,
  });

  const content = String(sentBody(calls).content);
  assert.equal(content.length, DISCORD_MAX_CONTENT);
  assert.ok(content.endsWith("…"), "the clip is visible to the reader");
});

test("a refused webhook becomes a SinkError", async () => {
  const { fetch } = fakeFetch(404, "no_service");
  await assert.rejects(
    () => sendReportWebhook(report, { url: "https://hooks.slack.com/gone", fetch }),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.name, "SinkError");
      assert.equal(err.status, 404);
      assert.equal(err.message, "no_service");
      return true;
    },
  );
});
