import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slackSink,
  buildSlackMessage,
  escapeSlack,
  MAX_SLACK_BLOCKS,
  MAX_SLACK_TEXT,
  MAX_SLACK_HEADER_TEXT,
  MAX_SLACK_FIELDS,
} from "../src/sinks/slack.ts";
import {
  discordSink,
  buildDiscordMessage,
  DISCORD_COLOURS,
  MAX_DISCORD_EMBED_TITLE,
  MAX_DISCORD_EMBED_FIELDS,
  MAX_DISCORD_FIELD_VALUE,
  MAX_DISCORD_EMBED_TOTAL,
} from "../src/sinks/discord.ts";
import { clip, MAX_CHAT_CONSOLE_ENTRIES } from "../src/sinks/chat.ts";
import { SinkError } from "../src/sinks/error.ts";
import type { ReportSink } from "../src/server/handle.ts";

/** A fetch stand-in that records the request and answers with the given body. */
function fakeFetch(status: number, body: unknown = null) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    // 204 is what a Discord webhook answers with, and a body is not allowed.
    if (status === 204) return new Response(null, { status });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function sentBody(calls: { init: RequestInit }[]): Record<string, unknown> {
  assert.equal(calls.length, 1, "exactly one request was made");
  return JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
}

type Block = Record<string, unknown>;

function blocksOf(payload: Record<string, unknown>): Block[] {
  assert.ok(Array.isArray(payload.blocks), "the payload carries blocks");
  return payload.blocks as Block[];
}

function blockOfType(payload: Record<string, unknown>, type: string): Block | undefined {
  return blocksOf(payload).find((b) => b.type === type);
}

function embedOf(payload: Record<string, unknown>): Record<string, unknown> {
  const embeds = payload.embeds as Record<string, unknown>[];
  assert.equal(embeds.length, 1, "exactly one embed per report");
  return embeds[0]!;
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

// A compile-time check that both factories are usable as `handleReport` sinks:
// the chat context is structurally what `SinkContext` provides.
const _sinks: ReportSink[] = [
  slackSink({ webhookUrl: "https://hooks.slack.com/x" }),
  discordSink({ webhookUrl: "https://discord.com/api/webhooks/x" }),
];
void _sinks;

const SLACK_URL = "https://hooks.slack.com/services/T/B/xxx";
const DISCORD_URL = "https://discord.com/api/webhooks/1/xxx";

// --- Slack -----------------------------------------------------------------

test("the slack message is one Block Kit post with a header, the message and the facts", async () => {
  const { fetch, calls } = fakeFetch(200, "ok");
  await slackSink({ webhookUrl: SLACK_URL, fetch })(report);

  assert.equal(calls[0]?.url, SLACK_URL);
  assert.equal(calls[0]?.init.method, "POST");
  const body = sentBody(calls);
  assert.equal(body.text, "Bug: The save button does nothing");

  const blocks = blocksOf(body);
  assert.equal(blocks[0]?.type, "header");
  assert.deepEqual(blocks[0]?.text, {
    type: "plain_text",
    text: "Bug: The save button does nothing",
    emoji: true,
  });

  const sections = blocks.filter((b) => b.type === "section");
  assert.deepEqual(sections[0]?.text, {
    type: "mrkdwn",
    text: "The save button does nothing",
  });

  const fields = sections[1]?.fields as { type: string; text: string }[];
  assert.deepEqual(
    fields.map((f) => f.text),
    [
      "*Page*\n/orders/91",
      "*Viewport*\n1440x900",
      "*Browser*\nChrome 141",
      "*Language*\nen-GB",
      "*Time zone*\nEurope/Copenhagen",
    ],
  );
  for (const f of fields) assert.equal(f.type, "mrkdwn");
});

test("a contact line is the first field in both channels, and absent when there is none", () => {
  const withContact = { ...report, contact: "anna@example.com" };

  const slack = buildSlackMessage(withContact, { webhookUrl: SLACK_URL });
  const slackFields = blocksOf(slack).find((b) => "fields" in b)?.fields as { text: string }[];
  assert.equal(slackFields[0]?.text, "*Contact*\nanna@example.com");

  const discord = buildDiscordMessage(withContact, { webhookUrl: DISCORD_URL });
  const discordFields = embedOf(discord).fields as { name: string; value: string }[];
  assert.deepEqual([discordFields[0]?.name, discordFields[0]?.value], ["Contact", "anna@example.com"]);

  const plain = buildDiscordMessage(report, { webhookUrl: DISCORD_URL });
  const plainFields = embedOf(plain).fields as { name: string }[];
  assert.equal(plainFields.some((f) => f.name === "Contact"), false);
});

test("the last five console entries travel as a fenced block, and no more", async () => {
  const many = {
    ...report,
    console: Array.from({ length: 12 }, (_, i) => ({
      level: "error",
      message: `boom ${i}`,
      ts: "2026-09-07T10:00:00.000Z",
    })),
  };
  const payload = buildSlackMessage(many, { webhookUrl: SLACK_URL });
  const fenced = blocksOf(payload)
    .map((b) => (b.text as { text?: string } | undefined)?.text ?? "")
    .find((t) => t.startsWith("```"));
  assert.ok(fenced, "a fenced console section is present");
  const lines = fenced.split("\n").slice(1, -1);
  assert.equal(lines.length, MAX_CHAT_CONSOLE_ENTRIES);
  // normaliseConsole keeps the newest, so the last twelve end at "boom 11".
  assert.match(lines.at(-1)!, /boom 11/);
});

test("the context block carries the timestamp and the pointed-at selector", () => {
  const payload = buildSlackMessage(report, { webhookUrl: SLACK_URL });
  const context = blockOfType(payload, "context");
  const elements = context?.elements as { text: string }[];
  // The selector is escaped too: a `>` combinator would otherwise open markup.
  assert.equal(elements[0]?.text, "2026-09-07T10:00:00.000Z · `form#checkout &gt; button`");
});

test("slack markup characters in the message are escaped", () => {
  const payload = buildSlackMessage(
    { ...report, message: "a & b < c > d" },
    { webhookUrl: SLACK_URL },
  );
  const section = blocksOf(payload).find(
    (b) => b.type === "section" && (b.text as { text: string }).text.includes("amp"),
  );
  assert.equal((section?.text as { text: string }).text, "a &amp; b &lt; c &gt; d");
  // The ampersand is escaped first, or the escapes escape each other.
  assert.equal(escapeSlack("&lt;"), "&amp;lt;");
});

test("a screenshot url becomes an image block and a data url is ignored", () => {
  const withUrl = buildSlackMessage(report, {
    webhookUrl: SLACK_URL,
    screenshotUrlFrom: () => "https://files.example.com/a.png",
  });
  const image = blockOfType(withUrl, "image");
  assert.equal(image?.image_url, "https://files.example.com/a.png");
  assert.equal(image?.alt_text, "Bug: The save button does nothing");

  const dataUrl = buildSlackMessage(report, {
    webhookUrl: SLACK_URL,
    screenshotUrlFrom: () => "data:image/png;base64,AAAA",
  });
  assert.equal(blockOfType(dataUrl, "image"), undefined, "slack cannot fetch a data url");

  const none = buildSlackMessage(report, { webhookUrl: SLACK_URL, screenshotUrlFrom: () => undefined });
  assert.equal(blockOfType(none, "image"), undefined);
});

/**
 * Since 1.0 every sink takes the same two keys: `screenshotUrl` for an address
 * you already have and `screenshotUrlFrom` for one that has to be read out of
 * the report. Slack and Discord took the function under the first name until
 * then, which was the one place a key meant two things depending on the
 * import.
 */
test("a screenshot url may be a plain string, and the function wins over it", () => {
  const asString = buildSlackMessage(report, {
    webhookUrl: SLACK_URL,
    screenshotUrl: "https://files.example.com/plain.png",
  });
  assert.equal(blockOfType(asString, "image")?.image_url, "https://files.example.com/plain.png");

  const both = buildSlackMessage(report, {
    webhookUrl: SLACK_URL,
    screenshotUrl: "https://files.example.com/plain.png",
    screenshotUrlFrom: () => "https://files.example.com/read.png",
  });
  assert.equal(blockOfType(both, "image")?.image_url, "https://files.example.com/read.png");

  const discord = buildDiscordMessage(report, {
    webhookUrl: DISCORD_URL,
    screenshotUrl: "https://files.example.com/plain.png",
  });
  assert.deepEqual(embedOf(discord).image, { url: "https://files.example.com/plain.png" });
});

test("an option address wins over the one the handler stored", () => {
  const payload = buildSlackMessage(
    report,
    { webhookUrl: SLACK_URL, screenshotUrl: "https://files.example.com/mine.png" },
    { screenshotUrl: "https://files.example.com/stored.png" },
  );
  assert.equal(blockOfType(payload, "image")?.image_url, "https://files.example.com/mine.png");
});

test("the stored screenshot url from the handler is used when no function is given", () => {
  const payload = buildSlackMessage(
    report,
    { webhookUrl: SLACK_URL },
    { screenshotUrl: "https://files.example.com/stored.png" },
  );
  assert.equal(blockOfType(payload, "image")?.image_url, "https://files.example.com/stored.png");
});

test("a report url becomes an actions block, and there is none without one", () => {
  const payload = buildSlackMessage(report, {
    webhookUrl: SLACK_URL,
    reportUrl: () => "https://app.example.com/reports/7",
    buttonText: "See the report",
  });
  const actions = blockOfType(payload, "actions");
  assert.deepEqual(actions?.elements, [
    {
      type: "button",
      text: { type: "plain_text", text: "See the report", emoji: true },
      url: "https://app.example.com/reports/7",
    },
  ]);

  const plain = buildSlackMessage(report, { webhookUrl: SLACK_URL });
  assert.equal(blockOfType(plain, "actions"), undefined);
});

test("channel, username and icon are sent only when configured", () => {
  const bare = buildSlackMessage(report, { webhookUrl: SLACK_URL });
  assert.equal("channel" in bare, false);
  assert.equal("username" in bare, false);
  assert.equal("icon_emoji" in bare, false);

  const dressed = buildSlackMessage(report, {
    webhookUrl: SLACK_URL,
    channel: "#bugs",
    username: "bugbottle",
    iconEmoji: ":beetle:",
  });
  assert.equal(dressed.channel, "#bugs");
  assert.equal(dressed.username, "bugbottle");
  assert.equal(dressed.icon_emoji, ":beetle:");
});

test("the header is clipped to 150 characters and the message to 3000", () => {
  const payload = buildSlackMessage(
    { ...report, message: "x".repeat(9000) },
    { webhookUrl: SLACK_URL },
  );
  const blocks = blocksOf(payload);
  const header = (blocks[0]?.text as { text: string }).text;
  assert.ok(header.length <= MAX_SLACK_HEADER_TEXT);
  const message = (blocks[1]?.text as { text: string }).text;
  assert.equal(message.length, MAX_SLACK_TEXT);
  assert.ok(message.endsWith("…"), "a clipped text object ends in an ellipsis");
});

test("no more than ten fields go in a section, and no more than fifty blocks are sent", () => {
  const everyFact = {
    ...report,
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
  const payload = buildSlackMessage(everyFact, { webhookUrl: SLACK_URL });
  const fields = blocksOf(payload).find((b) => "fields" in b)?.fields as unknown[];
  assert.ok(fields.length <= MAX_SLACK_FIELDS, `${fields.length} fields is within the limit`);
  assert.ok(blocksOf(payload).length <= MAX_SLACK_BLOCKS);
});

test("a malformed report still posts, with a fallback title and no facts", () => {
  const payload = buildSlackMessage({ type: "nonsense", message: 42 }, { webhookUrl: SLACK_URL });
  const blocks = blocksOf(payload);
  assert.equal((blocks[0]?.text as { text: string }).text, "Feedback: Feedback");
  assert.equal(blocks.some((b) => "fields" in b), false);
});

test("a refused slack webhook becomes a SinkError carrying the status and body", async () => {
  const { fetch } = fakeFetch(404, "no_service");
  await assert.rejects(
    slackSink({ webhookUrl: SLACK_URL, fetch })(report),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 404);
      assert.equal(err.body, "no_service");
      assert.equal(err.message, "no_service");
      return true;
    },
  );
});

test("a slack 500 with no useful body still names the status", async () => {
  const { fetch } = fakeFetch(500, "");
  await assert.rejects(slackSink({ webhookUrl: SLACK_URL, fetch })(report), (err: unknown) => {
    assert.ok(err instanceof SinkError);
    assert.equal(err.status, 500);
    assert.match(err.message, /Slack refused the report with status 500/);
    return true;
  });
});

test("the sink hands its abort signal to fetch", async () => {
  const { fetch, calls } = fakeFetch(200, "ok");
  const controller = new AbortController();
  await slackSink({ webhookUrl: SLACK_URL, fetch })(report, { signal: controller.signal });
  assert.equal(calls[0]?.init.signal, controller.signal);
});

// --- Discord ---------------------------------------------------------------

test("the discord message is one embed with the title, description and fields", async () => {
  const { fetch, calls } = fakeFetch(204);
  await discordSink({ webhookUrl: DISCORD_URL, fetch })(report);

  assert.equal(calls[0]?.url, DISCORD_URL);
  const embed = embedOf(sentBody(calls));
  assert.equal(embed.title, "Bug: The save button does nothing");
  assert.equal(embed.description, "The save button does nothing");
  assert.equal(embed.color, DISCORD_COLOURS.bug);
  assert.equal(embed.timestamp, "2026-09-07T10:00:00.000Z");
  assert.deepEqual(embed.footer, { text: "form#checkout > button" });

  const fields = embed.fields as { name: string; value: string; inline?: boolean }[];
  assert.deepEqual(
    fields.slice(0, 5).map((f) => [f.name, f.value]),
    [
      ["Page", "/orders/91"],
      ["Viewport", "1440x900"],
      ["Browser", "Chrome 141"],
      ["Language", "en-GB"],
      ["Time zone", "Europe/Copenhagen"],
    ],
  );
  assert.equal(fields.at(-1)?.name, "Console");
  assert.match(String(fields.at(-1)?.value), /^```\n.*save failed[\s\S]*```$/);
});

test("the colour follows the report type", () => {
  for (const [type, colour] of Object.entries(DISCORD_COLOURS)) {
    const payload = buildDiscordMessage({ ...report, type }, { webhookUrl: DISCORD_URL });
    assert.equal(embedOf(payload).color, colour);
  }
  // An unknown type falls back to the neutral colour rather than failing.
  const odd = buildDiscordMessage({ ...report, type: "nonsense" }, { webhookUrl: DISCORD_URL });
  assert.equal(embedOf(odd).color, DISCORD_COLOURS.other);
});

test("a screenshot url becomes the embed image and a report url its link", () => {
  const payload = buildDiscordMessage(report, {
    webhookUrl: DISCORD_URL,
    screenshotUrlFrom: () => "https://files.example.com/a.png",
    reportUrl: () => "https://app.example.com/reports/7",
  });
  const embed = embedOf(payload);
  assert.deepEqual(embed.image, { url: "https://files.example.com/a.png" });
  assert.equal(embed.url, "https://app.example.com/reports/7");

  const bare = buildDiscordMessage(report, {
    webhookUrl: DISCORD_URL,
    screenshotUrlFrom: () => undefined,
    reportUrl: () => undefined,
  });
  assert.equal("image" in embedOf(bare), false);
  assert.equal("url" in embedOf(bare), false);

  const dataUrl = buildDiscordMessage(report, {
    webhookUrl: DISCORD_URL,
    screenshotUrlFrom: () => "data:image/png;base64,AAAA",
  });
  assert.equal("image" in embedOf(dataUrl), false, "discord cannot fetch a data url");
});

test("username and avatar are sent only when configured", () => {
  const bare = buildDiscordMessage(report, { webhookUrl: DISCORD_URL });
  assert.equal("username" in bare, false);
  assert.equal("avatar_url" in bare, false);

  const dressed = buildDiscordMessage(report, {
    webhookUrl: DISCORD_URL,
    username: "bugbottle",
    avatarUrl: "https://files.example.com/avatar.png",
  });
  assert.equal(dressed.username, "bugbottle");
  assert.equal(dressed.avatar_url, "https://files.example.com/avatar.png");
});

test("the title stays under 256 and the whole embed under 6000", () => {
  // A report at every report-core limit at once: a 4000-character message, a
  // 500-character page and user agent, five 500-character console entries.
  // Their sum is past Discord's 6000, so something has to give.
  const long = {
    ...report,
    message: `${"t".repeat(400)}\n${"m".repeat(9000)}`,
    context: { ...report.context, url: "u".repeat(900), userAgent: "a".repeat(900) },
    console: Array.from({ length: 5 }, () => ({
      level: "error",
      message: "c".repeat(900),
      ts: "2026-09-07T10:00:00.000Z",
    })),
  };
  const embed = embedOf(buildDiscordMessage(long, { webhookUrl: DISCORD_URL }));
  // The shared reader already clips a title to the first 80 characters of the
  // first line, so Discord's 256 is a backstop rather than the binding limit.
  assert.ok(String(embed.title).length <= MAX_DISCORD_EMBED_TITLE);
  assert.ok(String(embed.title).endsWith("…"));

  const fields = embed.fields as { name: string; value: string }[];
  for (const f of fields) assert.ok(f.value.length <= MAX_DISCORD_FIELD_VALUE);
  assert.equal(fields.at(-1)?.value.length, MAX_DISCORD_FIELD_VALUE, "the console field is full");

  let total = String(embed.title).length + String(embed.description ?? "").length;
  total += (embed.footer as { text: string } | undefined)?.text.length ?? 0;
  for (const f of fields) total += f.name.length + f.value.length;
  assert.ok(total <= MAX_DISCORD_EMBED_TOTAL, `${total} characters is within the budget`);

  // The description is what gave way, not the facts: Page and Browser are
  // still the full 500 characters report-core allows them.
  assert.equal(fields[0]?.value.length, 500);
  assert.equal(fields[2]?.value.length, 500);
  assert.ok(String(embed.description).length < 4000, "the description was clipped");
});

test("no more than twenty-five fields go on an embed", () => {
  const everyFact = {
    ...report,
    context: {
      url: "/a",
      viewport: "1x1",
      userAgent: "UA",
      language: "en",
      timezone: "UTC",
      screen: "2x2@1",
      colorScheme: "dark",
      online: false,
      connection: "4g",
    },
  };
  const embed = embedOf(buildDiscordMessage(everyFact, { webhookUrl: DISCORD_URL }));
  const fields = embed.fields as unknown[];
  assert.ok(fields.length <= MAX_DISCORD_EMBED_FIELDS, `${fields.length} fields`);
  assert.equal(fields.length, 10, "nine context facts and the console block");
});

test("a malformed report still posts to discord, with a fallback title", () => {
  const embed = embedOf(buildDiscordMessage({ console: "nope" }, { webhookUrl: DISCORD_URL }));
  assert.equal(embed.title, "Feedback: Feedback");
  assert.equal("description" in embed, false);
  assert.equal("fields" in embed, false);
  assert.equal("timestamp" in embed, false);
});

test("a refused discord webhook becomes a SinkError carrying the status and body", async () => {
  const { fetch } = fakeFetch(400, { message: "Cannot send an empty message", code: 50006 });
  await assert.rejects(
    discordSink({ webhookUrl: DISCORD_URL, fetch })(report),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 400);
      assert.equal(err.message, "Cannot send an empty message");
      assert.deepEqual(err.body, { message: "Cannot send an empty message", code: 50006 });
      return true;
    },
  );
});

test("a discord 502 with an unhelpful body still names the status", async () => {
  const { fetch } = fakeFetch(502, "");
  await assert.rejects(discordSink({ webhookUrl: DISCORD_URL, fetch })(report), (err: unknown) => {
    assert.ok(err instanceof SinkError);
    assert.equal(err.status, 502);
    assert.match(err.message, /Discord refused the report with status 502/);
    return true;
  });
});

test("the discord sink hands its abort signal to fetch", async () => {
  const { fetch, calls } = fakeFetch(204);
  const controller = new AbortController();
  await discordSink({ webhookUrl: DISCORD_URL, fetch })(report, { signal: controller.signal });
  assert.equal(calls[0]?.init.signal, controller.signal);
});

test("clip counts code points, so it never leaves half a character behind", () => {
  // Two astral characters are four UTF-16 units. Clipping at three used to cut
  // the second one in half and leave a lone surrogate, which renders as U+FFFD.
  assert.equal(clip("\u{1F41B}\u{1F41B}", 3), "\u{1F41B}\u{1F41B}", "two characters fit in three");

  const three = clip("\u{1F41B}\u{1F41B}\u{1F41B}", 2);
  assert.equal(three, "\u{1F41B}…");
  assert.equal(Array.from(three).length, 2, "the clip is measured in characters");
  assert.doesNotMatch(three, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, "no lone surrogate is left");
});

test("a message of astral characters is clipped without a replacement character", () => {
  const payload = buildSlackMessage(
    { ...report, message: "\u{1F41B}".repeat(4000) },
    { webhookUrl: SLACK_URL },
  );
  const message = ((blocksOf(payload)[1]?.text as { text: string }) ?? { text: "" }).text;
  assert.ok(Array.from(message).length <= MAX_SLACK_TEXT, "the clip is in characters");
  assert.ok(!message.includes("�"), "nothing was cut in half");
});
