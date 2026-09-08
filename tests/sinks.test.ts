import { test } from "node:test";
import assert from "node:assert/strict";
import { sendReportEmail } from "../src/sinks/resend.ts";
import { sendReportWebhook, MAX_DISCORD_CONTENT } from "../src/sinks/webhook.ts";
import { createGithubIssue } from "../src/sinks/github.ts";
import { createLinearIssue } from "../src/sinks/linear.ts";
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

test("a contact line that is an address becomes the reply-to", async () => {
  const { fetch, calls } = fakeFetch(200, { id: "re_c1" });
  await sendReportEmail(
    { ...report, contact: "  anna@example.com  " },
    { apiKey: "k", from: "a@b.c", to: "t@example.com", fetch },
  );
  const body = sentBody(calls);
  assert.equal(body.reply_to, "anna@example.com");
  assert.match(String(body.text), /\| Contact \| anna@example\.com \|/, "and it is in the body");
});

test("a contact line that is not an address is in the body and not the reply-to", async () => {
  const phone = fakeFetch(200, { id: "re_c2" });
  await sendReportEmail(
    { ...report, contact: "call me on 12345678" },
    { apiKey: "k", from: "a@b.c", to: "t@example.com", fetch: phone.fetch },
  );
  const body = sentBody(phone.calls);
  assert.equal("reply_to" in body, false, "Resend would refuse the whole send");
  assert.match(String(body.text), /\| Contact \| call me on 12345678 \|/);

  const none = fakeFetch(200, { id: "re_c3" });
  await sendReportEmail(report, { apiKey: "k", from: "a@b.c", to: "t@example.com", fetch: none.fetch });
  assert.equal("reply_to" in sentBody(none.calls), false, "no contact line, no reply-to");
});

test("an explicit replyTo wins, and false sends none at all", async () => {
  const explicit = fakeFetch(200, { id: "re_c4" });
  await sendReportEmail(
    { ...report, contact: "anna@example.com" },
    { apiKey: "k", from: "a@b.c", to: "t@example.com", replyTo: "bugs@example.com", fetch: explicit.fetch },
  );
  assert.equal(sentBody(explicit.calls).reply_to, "bugs@example.com");

  const off = fakeFetch(200, { id: "re_c5" });
  await sendReportEmail(
    { ...report, contact: "anna@example.com" },
    { apiKey: "k", from: "a@b.c", to: "t@example.com", replyTo: false, fetch: off.fetch },
  );
  assert.equal("reply_to" in sentBody(off.calls), false);
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
  assert.equal(content.length, MAX_DISCORD_CONTENT);
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

test("the issue is opened on the named repository with the documented headers", async () => {
  const { fetch, calls } = fakeFetch(201, {
    number: 41,
    html_url: "https://github.com/acme/app/issues/41",
  });
  const result = await createGithubIssue(report, {
    token: "ghp_test_token",
    owner: "acme",
    repo: "app",
    fetch,
  });

  assert.deepEqual(result, { number: 41, url: "https://github.com/acme/app/issues/41" });
  assert.equal(calls[0]?.url, "https://api.github.com/repos/acme/app/issues");
  assert.equal(calls[0]?.init.method, "POST");
  assert.equal(headerOf(calls[0]!.init, "Authorization"), "Bearer ghp_test_token");
  assert.equal(headerOf(calls[0]!.init, "Accept"), "application/vnd.github+json");
  assert.equal(headerOf(calls[0]!.init, "X-GitHub-Api-Version"), "2022-11-28");
  assert.equal(headerOf(calls[0]!.init, "User-Agent"), "bugbottle");

  const body = sentBody(calls);
  assert.equal(body.title, "Bug: The save button does nothing");
  assert.match(String(body.body), /## Bug: The save button does nothing/);
  assert.match(String(body.body), /`\/orders\/91`/);
  assert.equal("labels" in body, false, "no labels key when none were asked for");
});

test("the issue body carries the contact line as a fact row", async () => {
  const { fetch, calls } = fakeFetch(201, { number: 42, html_url: "https://example.com/42" });
  await createGithubIssue({ ...report, contact: "anna@example.com" }, {
    token: "t",
    owner: "acme",
    repo: "app",
    fetch,
  });
  assert.match(String(sentBody(calls).body), /\| Contact \| anna@example\.com \|/);
});

test("labels are passed along and an explicit title wins", async () => {
  const { fetch, calls } = fakeFetch(201, { number: 7, html_url: "https://example.com/7" });
  await createGithubIssue(report, {
    token: "t",
    owner: "acme",
    repo: "app",
    labels: ["bug", "from-bugbottle"],
    title: "Something specific",
    fetch,
  });

  const body = sentBody(calls);
  assert.deepEqual(body.labels, ["bug", "from-bugbottle"]);
  assert.equal(body.title, "Something specific");
});

test("a screenshot url is linked in the issue body", async () => {
  const { fetch, calls } = fakeFetch(201, { number: 8, html_url: "https://example.com/8" });
  await createGithubIssue(report, {
    token: "t",
    owner: "acme",
    repo: "app",
    screenshotUrl: "https://files.example.com/shots/abc.png",
    fetch,
  });

  // The API cannot take an attachment, so the address you stored it at is the
  // only way the picture reaches the issue.
  assert.match(String(sentBody(calls).body), /https:\/\/files\.example\.com\/shots\/abc\.png/);
});

test("a rejected token becomes a SinkError carrying the status and body", async () => {
  const { fetch } = fakeFetch(401, { message: "Bad credentials" });
  await assert.rejects(
    () => createGithubIssue(report, { token: "expired", owner: "acme", repo: "app", fetch }),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.name, "SinkError");
      assert.equal(err.status, 401);
      assert.equal(err.message, "Bad credentials");
      assert.deepEqual(err.body, { message: "Bad credentials" });
      return true;
    },
  );
});

test("a malformed report is still filed, with a fallback title", async () => {
  const { fetch, calls } = fakeFetch(201, { number: 9, html_url: "https://example.com/9" });
  const result = await createGithubIssue(
    { type: 42, message: null, console: "not an array" },
    { token: "t", owner: "acme", repo: "app", fetch },
  );

  assert.equal(result.number, 9);
  assert.equal(sentBody(calls).title, "Feedback: Feedback");
});

test("a github answer without a number resolves rather than failing", async () => {
  const { fetch } = fakeFetch(201, "created");
  const result = await createGithubIssue(report, {
    token: "t",
    owner: "acme",
    repo: "app",
    fetch,
  });
  assert.deepEqual(result, { number: undefined, url: undefined });
});

const linearOk = {
  data: { issueCreate: { success: true, issue: { id: "iss_1", identifier: "ENG-214", url: "https://linear.app/acme/issue/ENG-214" } } },
};

/** The `input` of the single recorded GraphQL mutation. */
function linearInput(calls: { init: RequestInit }[]): Record<string, unknown> {
  const body = sentBody(calls);
  const variables = body.variables as { input: Record<string, unknown> };
  return variables.input;
}

test("the issue goes to Linear as a GraphQL mutation with the key sent as-is", async () => {
  const { fetch, calls } = fakeFetch(200, linearOk);
  const result = await createLinearIssue(report, {
    apiKey: "lin_api_key",
    teamId: "team-uuid",
    fetch,
  });

  assert.deepEqual(result, {
    id: "iss_1",
    identifier: "ENG-214",
    url: "https://linear.app/acme/issue/ENG-214",
  });
  assert.equal(calls[0]?.url, "https://api.linear.app/graphql");
  assert.equal(calls[0]?.init.method, "POST");
  // Linear takes a personal key without a Bearer prefix; adding one is a 401.
  assert.equal(headerOf(calls[0]!.init, "Authorization"), "lin_api_key");

  const input = linearInput(calls);
  assert.equal(input.teamId, "team-uuid");
  assert.equal(input.title, "Bug: The save button does nothing");
  assert.match(String(input.description), /## Bug: The save button does nothing/);
  assert.match(String(input.description), /`\/orders\/91`/);
  assert.equal("projectId" in input, false, "no projectId key when none was asked for");
  assert.equal("labelIds" in input, false, "no labelIds key when none were asked for");
  assert.match(String(sentBody(calls).query), /issueCreate/);
});

test("the Linear description carries the contact line as a fact row", async () => {
  const { fetch, calls } = fakeFetch(200, linearOk);
  await createLinearIssue({ ...report, contact: "anna@example.com" }, {
    apiKey: "k",
    teamId: "team-uuid",
    fetch,
  });
  assert.match(String(linearInput(calls).description), /\| Contact \| anna@example\.com \|/);
});

test("a project, labels and an explicit title are passed along", async () => {
  const { fetch, calls } = fakeFetch(200, linearOk);
  await createLinearIssue(report, {
    apiKey: "k",
    teamId: "team-uuid",
    projectId: "project-uuid",
    labelIds: ["label-uuid-1", "label-uuid-2"],
    title: "Something specific",
    fetch,
  });

  const input = linearInput(calls);
  assert.equal(input.projectId, "project-uuid");
  assert.deepEqual(input.labelIds, ["label-uuid-1", "label-uuid-2"]);
  assert.equal(input.title, "Something specific");
});

test("a screenshot url is linked in the linear description", async () => {
  const { fetch, calls } = fakeFetch(200, linearOk);
  await createLinearIssue(report, {
    apiKey: "k",
    teamId: "team-uuid",
    screenshotUrl: "https://files.example.com/shots/abc.png",
    fetch,
  });

  assert.match(String(linearInput(calls).description), /https:\/\/files\.example\.com\/shots\/abc\.png/);
});

test("graphql errors arrive with a 200 and still become a SinkError", async () => {
  const { fetch } = fakeFetch(200, {
    data: null,
    errors: [{ message: "Team not found" }, { message: "Argument Validation Error" }],
  });

  await assert.rejects(
    () => createLinearIssue(report, { apiKey: "k", teamId: "gone", fetch }),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 200);
      assert.equal(err.message, "Team not found; Argument Validation Error");
      return true;
    },
  );
});

test("a mutation that answers success false is a SinkError, not a silent pass", async () => {
  const { fetch } = fakeFetch(200, { data: { issueCreate: { success: false } } });
  await assert.rejects(
    () => createLinearIssue(report, { apiKey: "k", teamId: "t", fetch }),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.message, "Linear did not create the issue");
      return true;
    },
  );
});

test("a rejected linear key becomes a SinkError carrying the status and body", async () => {
  const { fetch } = fakeFetch(401, { message: "Authentication required" });
  await assert.rejects(
    () => createLinearIssue(report, { apiKey: "expired", teamId: "t", fetch }),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 401);
      assert.equal(err.message, "Authentication required");
      assert.deepEqual(err.body, { message: "Authentication required" });
      return true;
    },
  );
});

test("a malformed report is still filed in linear, with a fallback title", async () => {
  const { fetch, calls } = fakeFetch(200, {
    data: { issueCreate: { success: true, issue: { id: "iss_2" } } },
  });
  const result = await createLinearIssue(
    { type: 42, message: null, console: "not an array" },
    { apiKey: "k", teamId: "t", fetch },
  );

  assert.equal(result.id, "iss_2");
  assert.equal(result.identifier, undefined);
  assert.equal(linearInput(calls).title, "Feedback: Feedback");
});
