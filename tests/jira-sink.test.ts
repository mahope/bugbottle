import { test } from "node:test";
import assert from "node:assert/strict";
import {
  jiraSink,
  buildJiraDescription,
  jiraBaseUrl,
  jiraAuthHeader,
  messageFromJiraBody,
  MAX_JIRA_SUMMARY,
  type AdfDoc,
  type AdfNode,
} from "../src/sinks/jira.ts";
import { SinkError } from "../src/sinks/error.ts";

/** A fetch stand-in that records the request and answers with the given body. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
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

/** The `fields` object of the single recorded request. */
function fieldsOf(calls: { init: RequestInit }[]): Record<string, unknown> {
  return sentBody(calls).fields as Record<string, unknown>;
}

/** The first node of a given type anywhere in an ADF tree. */
function firstNode(doc: AdfDoc | AdfNode, type: string): AdfNode | undefined {
  for (const node of doc.content ?? []) {
    if (node.type === type) return node;
    const nested = firstNode(node, type);
    if (nested) return nested;
  }
  return undefined;
}

/** Every text leaf of a node, joined — what a reader would see. */
function textOf(node: AdfNode | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(textOf).join("\n");
}

const created = {
  id: "10000",
  key: "SUP-24",
  self: "https://acme.atlassian.net/rest/api/3/issue/10000",
};

const report = {
  type: "bug",
  message: "The save button does nothing",
  context: { url: "/orders/91", viewport: "1440×900", userAgent: "Chrome 141" },
  console: [{ level: "error", message: "save failed", ts: "2026-09-07T10:00:00.000Z" }],
  elements: [
    {
      selector: "#save",
      tag: "button",
      text: "Save",
      attributes: { id: "save" },
      rect: { x: 10, y: 20, width: 80, height: 32 },
    },
  ],
};

const credentials = { site: "acme", email: "bot@example.com", apiToken: "tok_1" };

test("the issue goes to the v3 create endpoint with basic auth", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  const result = await jiraSink({ ...credentials, projectKey: "SUP", fetch })(report);

  assert.deepEqual(result, {
    id: "10000",
    key: "SUP-24",
    url: "https://acme.atlassian.net/rest/api/3/issue/10000",
  });
  assert.equal(calls[0]?.url, "https://acme.atlassian.net/rest/api/3/issue");
  assert.equal(calls[0]?.init.method, "POST");
  // The pair is base64 of `email:apiToken`, which is what Jira decodes.
  assert.equal(
    headerOf(calls[0]?.init ?? {}, "Authorization"),
    `Basic ${btoa("bot@example.com:tok_1")}`,
  );
  assert.equal(headerOf(calls[0]?.init ?? {}, "Content-Type"), "application/json");

  const fields = fieldsOf(calls);
  assert.deepEqual(fields.project, { key: "SUP" });
  // The project's own name for a defect, defaulted.
  assert.deepEqual(fields.issuetype, { name: "Bug" });
  assert.equal(fields.summary, "Bug: The save button does nothing");
});

test("a bare name, a host and a full URL all name the same site", () => {
  assert.equal(jiraBaseUrl("acme"), "https://acme.atlassian.net");
  assert.equal(jiraBaseUrl("acme.atlassian.net"), "https://acme.atlassian.net");
  assert.equal(jiraBaseUrl("https://acme.atlassian.net/"), "https://acme.atlassian.net");
  assert.equal(jiraBaseUrl(" https://jira.example.com "), "https://jira.example.com");
});

test("a non-ASCII credential is encoded as UTF-8 before base64", () => {
  // btoa alone throws on a character above U+00FF, which would lose the report
  // to a formatting bug rather than to a refused request.
  const header = jiraAuthHeader("mårten@example.com", "tøken");
  assert.match(header, /^Basic [A-Za-z0-9+/=]+$/);
  assert.equal(
    Buffer.from(header.slice("Basic ".length), "base64").toString("utf8"),
    "mårten@example.com:tøken",
  );
});

test("the issue type is the project's own name when one is given", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await jiraSink({ ...credentials, projectKey: "SUP", issueType: "Fejl", fetch })(report);
  assert.deepEqual(fieldsOf(calls).issuetype, { name: "Fejl" });
});

test("the description is an ADF document, not Markdown", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await jiraSink({ ...credentials, projectKey: "SUP", fetch })(report);

  const doc = fieldsOf(calls).description as AdfDoc;
  assert.equal(doc.type, "doc");
  assert.equal(doc.version, 1);
  assert.ok(Array.isArray(doc.content) && doc.content.length > 0);
});

test("the message is a paragraph, the facts a bullet list and the console a code block", () => {
  const doc = buildJiraDescription(report);

  const words = doc.content[0];
  assert.equal(words?.type, "paragraph");
  assert.equal(textOf(words), "The save button does nothing");

  const list = firstNode(doc, "bulletList");
  assert.ok(list, "the facts are a bullet list");
  // A listItem must hold a block, so each holds a paragraph of its own.
  const item = list?.content?.[0];
  assert.equal(item?.type, "listItem");
  assert.equal(item?.content?.[0]?.type, "paragraph");
  const facts = (list?.content ?? []).map(textOf);
  assert.ok(facts.includes("Type: Bug"));
  assert.ok(facts.includes("Page: /orders/91"));
  assert.ok(facts.includes("Browser: Chrome 141"));

  const code = firstNode(doc, "codeBlock");
  assert.equal(code?.attrs?.language, "text");
  assert.equal(textOf(code), "2026-09-07T10:00:00.000Z [error] save failed");
});

test("the element the reporter pointed at is listed with its position", () => {
  const doc = buildJiraDescription(report);
  const text = doc.content.map(textOf).join("\n");
  assert.match(text, /Element pointed at/);
  assert.match(text, /#save — "Save" at 10,20 80×32/);
});

test("a stored screenshot is one of the facts", () => {
  const doc = buildJiraDescription(report, {}, {
    screenshotUrl: "https://files.example.com/shots/abc.png",
  });
  const facts = (firstNode(doc, "bulletList")?.content ?? []).map(textOf);
  assert.ok(facts.includes("Screenshot: https://files.example.com/shots/abc.png"));
});

test("a data url is not offered as a screenshot link", () => {
  // Nobody can GET one, and pasting a megabyte of base64 into an issue is not
  // a link — it is the picture, in the wrong place.
  const doc = buildJiraDescription(report, {}, { screenshotUrl: "data:image/png;base64,AAA" });
  const facts = (firstNode(doc, "bulletList")?.content ?? []).map(textOf);
  assert.ok(!facts.some((line) => line.startsWith("Screenshot:")));
});

test("extra facts are appended to the list", () => {
  const doc = buildJiraDescription(report, { facts: { App: "checkout 1.4.2", User: undefined } });
  const facts = (firstNode(doc, "bulletList")?.content ?? []).map(textOf);
  assert.ok(facts.includes("App: checkout 1.4.2"));
  assert.ok(!facts.some((line) => line.startsWith("User:")));
});

test("a malformed report is still filed, with a fallback summary and a valid doc", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await jiraSink({ ...credentials, projectKey: "SUP", fetch })(
    { type: "nonsense", message: 42, console: "not an array" },
  );

  const fields = fieldsOf(calls);
  assert.equal(fields.summary, "Feedback: Feedback");
  const doc = fields.description as AdfDoc;
  // Nothing survived normalising but the type, so the document is the one
  // fact — never an empty doc, which ADF rejects.
  assert.equal(doc.content.length, 1);
  assert.equal(doc.content[0]?.type, "bulletList");
  assert.equal(textOf(doc.content[0]), "Type: Feedback");
});

test("an empty message never produces an empty text node", () => {
  const doc = buildJiraDescription({ type: "bug", context: { url: "/x" } });
  const walk = (node: AdfDoc | AdfNode): void => {
    if (node.type === "text") assert.notEqual(node.text, "", "no empty text node");
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
});

test("a very long summary is clipped to what Jira keeps", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await jiraSink({ ...credentials, projectKey: "SUP", title: "x".repeat(400), fetch })(report);
  const summary = String(fieldsOf(calls).summary);
  assert.equal(summary.length, MAX_JIRA_SUMMARY);
});

test("a rejected create becomes a SinkError carrying Jira's own message", async () => {
  const { fetch } = fakeFetch(400, {
    errorMessages: ["Field 'priority' cannot be set."],
    errors: { issuetype: "Specify an issue type" },
  });
  await assert.rejects(
    () => jiraSink({ ...credentials, projectKey: "SUP", fetch })(report),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 400);
      // Both lists are joined: either can be the empty one.
      assert.equal(
        err.message,
        "Field 'priority' cannot be set.; issuetype: Specify an issue type",
      );
      return true;
    },
  );
});

test("a spent token becomes a SinkError with the status and the body", async () => {
  const { fetch } = fakeFetch(401, "Unauthorized");
  await assert.rejects(
    () => jiraSink({ ...credentials, projectKey: "SUP", fetch })(report),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 401);
      assert.equal(err.body, "Unauthorized");
      return true;
    },
  );
});

test("a 500 with no usable body falls back to naming the status", async () => {
  const { fetch } = fakeFetch(500, {});
  await assert.rejects(
    () => jiraSink({ ...credentials, projectKey: "SUP", fetch })(report),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 500);
      assert.equal(err.message, "Jira refused the issue with status 500");
      return true;
    },
  );
});

test("an error body that is neither list still yields something readable", () => {
  assert.equal(messageFromJiraBody({ message: "nope" }, "fallback"), "nope");
  assert.equal(messageFromJiraBody({ errorMessages: [] }, "fallback"), "fallback");
});

test("the sink's deadline reaches fetch as an abort signal", async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    seen = init?.signal ?? undefined;
    if (seen?.aborted) throw new DOMException("This operation was aborted", "AbortError");
    return new Response(JSON.stringify(created), { status: 201 });
  }) as typeof globalThis.fetch;

  await jiraSink({ ...credentials, projectKey: "SUP", fetch })(report, {
    signal: controller.signal,
  });
  assert.equal(seen, controller.signal);

  controller.abort();
  await assert.rejects(
    () => jiraSink({ ...credentials, projectKey: "SUP", fetch })(report, { signal: controller.signal }),
    (err: unknown) => (err as Error).name === "AbortError",
  );
});

test("the contact line is a fact, directly under the type", () => {
  // Every other sink carries it — `toMarkdown` for GitHub, GitLab and Linear,
  // the fields for Slack and Discord, `contact_email` for Sentry, `reply_to`
  // for Resend. Jira builds its own facts, so it has to be told separately.
  const doc = buildJiraDescription({ ...report, contact: "anna@example.com" });
  const facts = (firstNode(doc, "bulletList")?.content ?? []).map(textOf);
  assert.deepEqual(facts.slice(0, 2), ["Type: Bug", "Contact: anna@example.com"]);
});

test("a contact line of whitespace is not a fact", () => {
  const doc = buildJiraDescription({ ...report, contact: "   " });
  const facts = (firstNode(doc, "bulletList")?.content ?? []).map(textOf);
  assert.ok(!facts.some((line) => line.startsWith("Contact:")));
});

test("a report with no contact line has no contact fact", () => {
  const doc = buildJiraDescription(report);
  const facts = (firstNode(doc, "bulletList")?.content ?? []).map(textOf);
  assert.ok(!facts.some((line) => line.startsWith("Contact:")));
});

test("a two-line message is text, hardBreak, text", () => {
  // ADF has no newline inside a `text` node: the format's line break is its
  // own inline node. A message that ran to two lines used to be sent as one
  // text node carrying a raw newline, which Jira collapses at best and refuses
  // at worst — and a reporter writing steps to reproduce writes two lines far
  // more often than one.
  const doc = buildJiraDescription({
    type: "bug",
    message: "The save button does nothing\nIt spins forever",
  });

  const words = doc.content[0];
  assert.equal(words?.type, "paragraph");
  assert.deepEqual(words?.content, [
    { type: "text", text: "The save button does nothing" },
    { type: "hardBreak" },
    { type: "text", text: "It spins forever" },
  ]);
});

test("a blank line is breaks alone, never an empty text node", () => {
  const doc = buildJiraDescription({
    type: "bug",
    message: "First paragraph\n\nSecond paragraph",
  });

  assert.deepEqual(doc.content[0]?.content, [
    { type: "text", text: "First paragraph" },
    { type: "hardBreak" },
    { type: "hardBreak" },
    { type: "text", text: "Second paragraph" },
  ]);
});

test("a Windows line ending is one break, not two", () => {
  const doc = buildJiraDescription({ type: "bug", message: "One\r\nTwo" });
  assert.deepEqual(doc.content[0]?.content, [
    { type: "text", text: "One" },
    { type: "hardBreak" },
    { type: "text", text: "Two" },
  ]);
});

test("a message of nothing but newlines is dropped rather than filed as air", () => {
  const doc = buildJiraDescription({ type: "bug", message: "\n\n", context: { url: "/x" } });
  assert.equal(doc.content[0]?.type, "bulletList", "the facts are the first block");
});

test("the console code block keeps its newlines, which is where they belong", () => {
  // A `codeBlock` is the one place ADF does carry newlines in its text: the
  // content is preformatted, so splitting the entries into breaks there would
  // put the whole console back on one line.
  const doc = buildJiraDescription({
    type: "bug",
    message: "x",
    console: [
      { level: "error", message: "first" },
      { level: "warn", message: "second" },
    ],
  });
  const code = firstNode(doc, "codeBlock");
  assert.equal(code?.content?.length, 1);
  assert.equal(code?.content?.[0]?.text, "[error] first\n[warn] second");
});
