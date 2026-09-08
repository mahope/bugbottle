import { test } from "node:test";
import assert from "node:assert/strict";
import {
  teamsSink,
  buildTeamsMessage,
  escapeTeams,
  jsonByteLength,
  MAX_TEAMS_MESSAGE_BYTES,
  MAX_TEAMS_TITLE,
  MAX_TEAMS_FACTS,
  TEAMS_CARD_CONTENT_TYPE,
  TEAMS_CARD_SCHEMA,
  TEAMS_CARD_VERSION,
} from "../src/sinks/teams.ts";
import { MAX_CHAT_CONSOLE_ENTRIES } from "../src/sinks/chat.ts";
import { SinkError } from "../src/sinks/error.ts";
import type { ReportSink } from "../src/server/handle.ts";

/** A fetch stand-in that records the request and answers with the given body. */
function fakeFetch(status: number, body: unknown = null) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    // 202 is what a Workflows webhook answers with, and its body is empty.
    if (body === null) return new Response(null, { status });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function sentBody(calls: { init: RequestInit }[]): Record<string, unknown> {
  assert.equal(calls.length, 1, "exactly one request was made");
  return JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
}

type CardElement = Record<string, unknown>;

/** Digs the Adaptive Card out of the Bot Framework message around it. */
function cardOf(payload: Record<string, unknown>): Record<string, unknown> {
  assert.equal(payload.type, "message");
  const attachments = payload.attachments as Record<string, unknown>[];
  assert.equal(attachments.length, 1, "exactly one card per report");
  assert.equal(attachments[0]?.contentType, TEAMS_CARD_CONTENT_TYPE);
  return attachments[0]?.content as Record<string, unknown>;
}

function bodyOf(payload: Record<string, unknown>): CardElement[] {
  return cardOf(payload).body as CardElement[];
}

function elementOfType(payload: Record<string, unknown>, type: string): CardElement | undefined {
  return bodyOf(payload).find((e) => e.type === type);
}

function textBlocks(payload: Record<string, unknown>): CardElement[] {
  return bodyOf(payload).filter((e) => e.type === "TextBlock");
}

const report = {
  type: "bug",
  message: "The save button does nothing",
  context: {
    url: "/orders/91",
    viewport: "1440x900",
    userAgent: "Chrome 141",
    language: "en-GB",
    timezone: "Europe/Copenhagen",
  },
  console: [{ level: "error", message: "save failed", ts: "2026-09-07T10:00:00.000Z" }],
  elements: [
    {
      selector: "form#checkout > button",
      tag: "button",
      text: "Save",
      rect: { x: 1, y: 2, width: 3, height: 4 },
      attributes: {},
    },
  ],
};

// A compile-time check that the factory is usable as a `handleReport` sink:
// the chat context is structurally what `SinkContext` provides.
const _sinks: ReportSink[] = [teamsSink({ webhookUrl: "https://example.logic.azure.com/x" })];
void _sinks;

const TEAMS_URL =
  "https://prod-1.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke";

test("the teams message is one adaptive card in a bot framework envelope", async () => {
  const { fetch, calls } = fakeFetch(202);
  await teamsSink({ webhookUrl: TEAMS_URL, fetch })(report);

  assert.equal(calls[0]?.url, TEAMS_URL);
  assert.equal(calls[0]?.init.method, "POST");
  assert.deepEqual(calls[0]?.init.headers, { "Content-Type": "application/json" });

  const payload = sentBody(calls);
  const card = cardOf(payload);
  assert.equal(card.$schema, TEAMS_CARD_SCHEMA);
  assert.equal(card.type, "AdaptiveCard");
  assert.equal(card.version, TEAMS_CARD_VERSION);
  // Nothing the reporter can submit: a Workflows webhook has nowhere to send it.
  assert.equal("actions" in card, false);

  const blocks = textBlocks(payload);
  assert.deepEqual(blocks[0], {
    type: "TextBlock",
    text: "Bug: The save button does nothing",
    weight: "bolder",
    size: "large",
    wrap: true,
  });
  assert.deepEqual(blocks[1], {
    type: "TextBlock",
    text: "The save button does nothing",
    wrap: true,
  });
});

test("the facts travel as a FactSet of strings, contact first when there is one", () => {
  const payload = buildTeamsMessage(report, { webhookUrl: TEAMS_URL });
  const factSet = elementOfType(payload, "FactSet");
  assert.deepEqual(factSet?.facts, [
    { title: "Page", value: "/orders/91" },
    { title: "Viewport", value: "1440x900" },
    { title: "Browser", value: "Chrome 141" },
    { title: "Language", value: "en-GB" },
    { title: "Time zone", value: "Europe/Copenhagen" },
  ]);

  const withContact = buildTeamsMessage(
    { ...report, contact: "anna@example.com" },
    { webhookUrl: TEAMS_URL },
  );
  const facts = elementOfType(withContact, "FactSet")?.facts as { title: string }[];
  assert.equal(facts[0]?.title, "Contact");
});

test("the last five console entries travel as a monospace block, and no more", () => {
  const many = {
    ...report,
    console: Array.from({ length: 12 }, (_, i) => ({
      level: "error",
      message: `boom ${i}`,
      ts: "2026-09-07T10:00:00.000Z",
    })),
  };
  const payload = buildTeamsMessage(many, { webhookUrl: TEAMS_URL });
  const mono = textBlocks(payload).find((b) => b.fontType === "monospace");
  assert.ok(mono, "a monospace console block is present");
  assert.equal(mono.wrap, true);
  const lines = String(mono.text).split("\n");
  assert.equal(lines.length, MAX_CHAT_CONSOLE_ENTRIES);
  // normaliseConsole keeps the newest, so the last twelve end at "boom 11".
  assert.match(lines.at(-1)!, /boom 11/);
  // A card's code block is the font, not a fence: three backticks would show.
  assert.equal(lines[0]?.startsWith("```"), false);
});

test("the last block is a subtle line with the timestamp and the pointed-at selector", () => {
  const payload = buildTeamsMessage(report, { webhookUrl: TEAMS_URL });
  const last = bodyOf(payload).at(-1);
  assert.deepEqual(last, {
    type: "TextBlock",
    // Nothing in this one needs escaping: `#` and `>` are only markup at the
    // start of a line, and the timestamp is in front of them.
    text: "2026-09-07T10:00:00.000Z · form#checkout > button",
    isSubtle: true,
    size: "small",
    wrap: true,
  });

  const bare = buildTeamsMessage({ type: "idea", message: "a thought" }, { webhookUrl: TEAMS_URL });
  assert.equal(bodyOf(bare).some((e) => e.isSubtle === true), false);
});

test("markdown characters in the message are escaped into plain text", () => {
  const payload = buildTeamsMessage(
    { ...report, message: "rename *.tsx\n- a list\n1. and a number\n# heading" },
    { webhookUrl: TEAMS_URL },
  );
  assert.equal(
    textBlocks(payload)[1]?.text,
    "rename \\*.tsx\n\\- a list\n1\\. and a number\n\\# heading",
  );

  // The backslash is escaped first, or the escapes escape each other.
  assert.equal(escapeTeams("\\*"), "\\\\\\*");
  assert.equal(escapeTeams("a `code` [link](x) _under_ ~strike~"), "a \\`code\\` \\[link\\](x) \\_under\\_ \\~strike\\~");
});

test("a screenshot url becomes an Image and a data url is ignored", () => {
  const withUrl = buildTeamsMessage(report, {
    webhookUrl: TEAMS_URL,
    screenshotUrl: () => "https://files.example.com/a.png",
  });
  assert.deepEqual(elementOfType(withUrl, "Image"), {
    type: "Image",
    url: "https://files.example.com/a.png",
    altText: "Bug: The save button does nothing",
    size: "stretch",
  });

  const dataUrl = buildTeamsMessage(report, {
    webhookUrl: TEAMS_URL,
    screenshotUrl: () => "data:image/png;base64,AAAA",
  });
  assert.equal(elementOfType(dataUrl, "Image"), undefined, "teams cannot fetch a data url");

  const none = buildTeamsMessage(report, { webhookUrl: TEAMS_URL, screenshotUrl: () => undefined });
  assert.equal(elementOfType(none, "Image"), undefined);
});

test("the stored screenshot url from the handler is used when no function is given", () => {
  const payload = buildTeamsMessage(
    report,
    { webhookUrl: TEAMS_URL },
    { screenshotUrl: "https://files.example.com/stored.png" },
  );
  assert.equal(elementOfType(payload, "Image")?.url, "https://files.example.com/stored.png");
});

test("a report url becomes an Action.OpenUrl, and there is none without one", () => {
  const payload = buildTeamsMessage(report, {
    webhookUrl: TEAMS_URL,
    reportUrl: () => "https://app.example.com/reports/7",
  });
  assert.deepEqual(cardOf(payload).actions, [
    {
      type: "Action.OpenUrl",
      title: "Open report",
      url: "https://app.example.com/reports/7",
    },
  ]);

  const named = buildTeamsMessage(report, {
    webhookUrl: TEAMS_URL,
    reportUrl: () => "https://app.example.com/reports/7",
    buttonText: "See the report",
  });
  assert.equal((cardOf(named).actions as { title: string }[])[0]?.title, "See the report");

  const plain = buildTeamsMessage(report, { webhookUrl: TEAMS_URL, reportUrl: () => undefined });
  assert.equal("actions" in cardOf(plain), false);
});

test("a malformed report still posts, with a fallback title and no facts", () => {
  const payload = buildTeamsMessage({ type: "nonsense", message: 42 }, { webhookUrl: TEAMS_URL });
  const blocks = bodyOf(payload);
  assert.equal(blocks[0]?.text, "Feedback: Feedback");
  assert.equal(blocks.length, 1, "nothing else was known about it");
  assert.equal("actions" in cardOf(payload), false);
});

test("no more than twenty facts go on a card, and the title is clipped", () => {
  const everyFact = {
    ...report,
    contact: "anna@example.com",
    message: "x".repeat(9000),
    context: {
      url: "/a",
      viewport: "1x1",
      userAgent: "UA",
      language: "en",
      timezone: "UTC",
      screen: "2x2@1",
      colorScheme: "dark",
      online: true,
      connection: "4g",
    },
  };
  const payload = buildTeamsMessage(everyFact, { webhookUrl: TEAMS_URL });
  const facts = elementOfType(payload, "FactSet")?.facts as unknown[];
  assert.equal(facts.length, 10, "the contact and nine context facts");
  assert.ok(facts.length <= MAX_TEAMS_FACTS);

  // The shared reader clips a title to the first 80 characters of the first
  // line, so the 256 here is a backstop rather than the binding limit.
  const title = String(bodyOf(payload)[0]?.text);
  assert.ok(title.length <= MAX_TEAMS_TITLE);
  assert.ok(title.endsWith("…"));
});

/**
 * Every string at its report-core limit, and every character one that has to
 * be escaped — so a character costs three bytes in the JSON rather than one.
 * This is the largest card a validated report can produce.
 */
const maxedOut = {
  ...report,
  contact: "*".repeat(200),
  message: "*".repeat(4000),
  context: {
    url: `/${"*".repeat(999)}`,
    viewport: "*".repeat(200),
    userAgent: "*".repeat(999),
    language: "*".repeat(200),
    timezone: "*".repeat(200),
    screen: "*".repeat(200),
    colorScheme: "*".repeat(200),
    connection: "*".repeat(200),
    online: true,
  },
  console: Array.from({ length: 5 }, () => ({
    level: "error",
    message: "*".repeat(500),
    ts: "2026-09-07T10:00:00.000Z",
  })),
};

test("every string at its report-core limit still fits in one card", () => {
  // Nothing a validated report can carry reaches the 28 kB a webhook accepts:
  // report-core clips the message to 4000, the page and the user agent to 500
  // and five console entries to 500 each. So the budget below is a backstop
  // against the one address the library did not choose — where the screenshot
  // was stored — rather than against the report.
  const payload = buildTeamsMessage(maxedOut, { webhookUrl: TEAMS_URL });
  assert.ok(
    jsonByteLength(payload) < MAX_TEAMS_MESSAGE_BYTES,
    `${jsonByteLength(payload)} bytes is within the 28 kB a webhook accepts`,
  );
  assert.ok(textBlocks(payload).some((b) => b.fontType === "monospace"));
});

test("a card past the 28 kB cap drops the console first", () => {
  const payload = buildTeamsMessage(maxedOut, {
    webhookUrl: TEAMS_URL,
    // A stored screenshot lives wherever you put it, and its address can be
    // any length. This one leaves room for everything but the console.
    screenshotUrl: () => `https://files.example.com/${"a".repeat(4000)}.png`,
  });

  assert.ok(
    jsonByteLength(payload) <= MAX_TEAMS_MESSAGE_BYTES,
    `${jsonByteLength(payload)} bytes is within the 28 kB a webhook accepts`,
  );
  assert.equal(
    textBlocks(payload).some((b) => b.fontType === "monospace"),
    false,
    "the console is what gave way",
  );
  // The facts and the reporter's own words survived it whole.
  assert.equal((elementOfType(payload, "FactSet")?.facts as unknown[]).length, 9);
  assert.equal(String(textBlocks(payload)[1]?.text).length, 8000);
  assert.ok(elementOfType(payload, "Image"), "and so did the picture it was spent on");
});

test("a card still over the cap loses its facts from the back, and then the message", () => {
  const payload = buildTeamsMessage(maxedOut, {
    webhookUrl: TEAMS_URL,
    screenshotUrl: () => `https://files.example.com/${"a".repeat(16000)}.png`,
  });

  assert.ok(jsonByteLength(payload) <= MAX_TEAMS_MESSAGE_BYTES);
  assert.equal(
    textBlocks(payload).some((b) => b.fontType === "monospace"),
    false,
  );
  assert.equal(elementOfType(payload, "FactSet"), undefined, "every fact was dropped");
  const message = String(textBlocks(payload)[1]?.text);
  assert.ok(message.length > 0, "a truncated sentence still says what went wrong");
  assert.ok(message.length < 8000, "and it was clipped last of all");
  assert.ok(elementOfType(payload, "Image"));
});

test("an address too long to fit is dropped rather than sent over the cap", () => {
  // A stored screenshot behind a signed URL is where an address of this size
  // comes from. Nothing the card can clip makes room for one, so the picture
  // and the button go: a card that is refused says nothing at all, and Teams
  // refuses one over 28 kB outright rather than truncating it.
  const payload = buildTeamsMessage(maxedOut, {
    webhookUrl: TEAMS_URL,
    screenshotUrl: () => `https://files.example.com/${"a".repeat(40000)}.png`,
    reportUrl: () => `https://inbox.example.com/${"b".repeat(40000)}`,
  });

  assert.ok(
    jsonByteLength(payload) <= MAX_TEAMS_MESSAGE_BYTES,
    `the card weighs ${jsonByteLength(payload)} bytes`,
  );
  assert.equal(elementOfType(payload, "Image"), undefined, "the picture went");
  assert.ok(String(textBlocks(payload)[1]?.text).length > 0, "the message stayed");
});

test("the message survives an address the card had to drop", () => {
  const payload = buildTeamsMessage(maxedOut, {
    webhookUrl: TEAMS_URL,
    screenshotUrl: () => `https://files.example.com/${"a".repeat(40000)}.png`,
  });

  assert.ok(jsonByteLength(payload) <= MAX_TEAMS_MESSAGE_BYTES);
  assert.equal(elementOfType(payload, "Image"), undefined);
  // The address was the whole overspend, so nothing else needed to give way.
  assert.equal(String(textBlocks(payload)[1]?.text).length, 8000);
});

test("a refused teams webhook becomes a SinkError carrying the status and body", async () => {
  const { fetch } = fakeFetch(400, "Invalid workflow request");
  await assert.rejects(teamsSink({ webhookUrl: TEAMS_URL, fetch })(report), (err: unknown) => {
    assert.ok(err instanceof SinkError);
    assert.equal(err.status, 400);
    assert.equal(err.body, "Invalid workflow request");
    assert.equal(err.message, "Invalid workflow request");
    return true;
  });
});

test("a teams 502 with no useful body still names the status", async () => {
  const { fetch } = fakeFetch(502, "");
  await assert.rejects(teamsSink({ webhookUrl: TEAMS_URL, fetch })(report), (err: unknown) => {
    assert.ok(err instanceof SinkError);
    assert.equal(err.status, 502);
    assert.match(err.message, /Microsoft Teams refused the report with status 502/);
    return true;
  });
});

test("every 2xx is a success, 202 with an empty body included", async () => {
  for (const status of [200, 201, 202, 204]) {
    const { fetch } = fakeFetch(status);
    await teamsSink({ webhookUrl: TEAMS_URL, fetch })(report);
  }
});

test("a legacy webhook's 200 that says delivery failed is still a SinkError", async () => {
  // The retired Office 365 connector webhooks answer 200 and put the failure
  // in the body, so a status check on its own reads a lost report as delivered.
  const { fetch } = fakeFetch(
    200,
    "Webhook message delivery failed with error: Microsoft Teams endpoint returned HTTP error 413.",
  );
  await assert.rejects(teamsSink({ webhookUrl: TEAMS_URL, fetch })(report), (err: unknown) => {
    assert.ok(err instanceof SinkError);
    assert.equal(err.status, 200);
    assert.match(err.message, /^Webhook message delivery failed/);
    return true;
  });
});

test("a 200 whose body only mentions the phrase later is a success", async () => {
  const { fetch } = fakeFetch(200, "1 (Webhook message delivery failed is not what happened)");
  await teamsSink({ webhookUrl: TEAMS_URL, fetch })(report);
});

test("an invalid webhook url is refused at construction, before any fetch", () => {
  let called = false;
  const fetch = (async () => {
    called = true;
    return new Response(null, { status: 202 });
  }) as typeof globalThis.fetch;
  assert.throws(
    () => teamsSink({ webhookUrl: "not a url", fetch }),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 0);
      assert.match(err.message, /webhookUrl/);
      assert.doesNotMatch(err.message, /not a url/, "the value is never quoted back");
      return true;
    },
  );
  assert.equal(called, false, "nothing was sent");
});

test("the teams sink hands its abort signal to fetch", async () => {
  const { fetch, calls } = fakeFetch(202);
  const controller = new AbortController();
  await teamsSink({ webhookUrl: TEAMS_URL, fetch })(report, { signal: controller.signal });
  assert.equal(calls[0]?.init.signal, controller.signal);
});

test("a card of astral characters is clipped to the cap without looping", () => {
  // The message is measured in characters and the cap in bytes, and an emoji
  // is two UTF-16 units. Asking `clip` for a limit in units would be a limit
  // the message is already under, so nothing would come off and the loop would
  // never end — which only shows when the overspend is smaller than the
  // difference between the two counts, so the address is sized to leave the
  // card a few hundred bytes over and no more.
  const message = "\u{1F41B}".repeat(2000);
  const url = (padding: number) => `https://files.example.com/${"a".repeat(padding)}.png`;
  const base = jsonByteLength(
    buildTeamsMessage({ type: "bug", message }, { webhookUrl: TEAMS_URL, screenshotUrl: () => url(0) }),
  );
  const padding = MAX_TEAMS_MESSAGE_BYTES - base + 500;
  assert.ok(padding > 0, "the address is what puts the card over the cap");

  const payload = buildTeamsMessage(
    { type: "bug", message },
    { webhookUrl: TEAMS_URL, screenshotUrl: () => url(padding) },
  );

  assert.ok(jsonByteLength(payload) <= MAX_TEAMS_MESSAGE_BYTES, "the card fits");
  const text = String(textBlocks(payload)[1]?.text ?? "");
  assert.ok(text.length > 0, "a truncated sentence still says what went wrong");
  assert.ok(Array.from(text).length < 2000, "and it really was clipped");
  assert.ok(!text.includes("�"), "nothing was cut in half");
});
