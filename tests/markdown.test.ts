import { test } from "node:test";
import assert from "node:assert/strict";
import { toMarkdown } from "../src/markdown.ts";

const report = {
  type: "bug",
  message: "The save button does nothing\n\nI clicked it twice.",
  context: { url: "/orders/42?tab=notes", viewport: "1440x900", userAgent: "Mozilla/5.0 Test" },
  console: [
    { ts: "2026-09-07T08:12:30.000Z", level: "warn", message: "slow response" },
    { ts: "2026-09-07T08:12:31.004Z", level: "error", message: "TypeError: x is not a function" },
  ],
  elements: [
    {
      selector: "form#checkout > button:nth-of-type(2)",
      tag: "button",
      text: "Save order",
      rect: { x: 912, y: 640, width: 118, height: 36 },
      attributes: { type: "submit", "data-testid": "save-order" },
    },
  ],
  screenshotDataUrl: "data:image/png;base64,AAAA",
};

test("a full report renders title, message, facts, elements and console", () => {
  const md = toMarkdown(report, { facts: { App: "checkout 1.4.2" } });
  assert.match(md, /^## Bug: The save button does nothing\n/);
  assert.match(md, /\nI clicked it twice\.\n/);
  assert.match(md, /\| Page \| `\/orders\/42\?tab=notes` \|/);
  assert.match(md, /\| Viewport \| 1440x900 \|/);
  assert.match(md, /\| Screenshot \| attached \|/);
  assert.match(md, /\| App \| checkout 1\.4\.2 \|/);
  assert.match(md, /### Element pointed at\n\n- `form#checkout > button:nth-of-type\(2\)` — "Save order" \(type="submit" data-testid="save-order"\) at 912,640 118×36/);
  assert.match(md, /<details><summary>Console \(2 entries\)<\/summary>/);
  assert.match(md, /2026-09-07T08:12:31\.004Z \[error\] TypeError: x is not a function/);
  assert.ok(md.endsWith("\n") && !md.endsWith("\n\n"), "ends with exactly one newline");
});

test("the optional context facts become rows, and stack frames sit under their entry", () => {
  const md = toMarkdown({
    type: "bug",
    message: "It threw",
    context: {
      url: "/orders/42",
      viewport: "1440x900",
      userAgent: "Mozilla/5.0 Test",
      language: "en-GB",
      timezone: "Europe/Copenhagen",
      screen: "2560x1440@2",
      colorScheme: "dark",
      online: false,
      connection: "4g",
    },
    console: [
      {
        ts: "",
        level: "error",
        message: "Uncaught: order.save is not a function",
        stack: [
          { file: "https://app.test/main.js", line: 12, col: 9, fn: "saveOrder" },
          { file: "https://app.test/main.js", line: 44, col: 17 },
          { file: "https://app.test/vendor.js", line: 1, col: 1, fn: "dispatch" },
          { file: "https://app.test/vendor.js", line: 2, col: 2, fn: "notPrinted" },
        ],
      },
    ],
  });
  assert.match(md, /\| Screen \| 2560x1440@2 \|/);
  assert.match(md, /\| Language \| en-GB \|/);
  assert.match(md, /\| Time zone \| Europe\/Copenhagen \|/);
  assert.match(md, /\| Colour scheme \| dark \|/);
  assert.match(md, /\| Online \| no \|/, "offline is a fact worth printing");
  assert.match(md, /\| Connection \| 4g \|/);
  assert.match(md, /\n {4}at saveOrder https:\/\/app\.test\/main\.js:12:9\n/);
  assert.match(md, /\n {4}at https:\/\/app\.test\/main\.js:44:17\n/, "an anonymous frame still prints");
  assert.ok(!md.includes("notPrinted"), "only the top three frames are rendered");
});

test("a context without the optional facts renders no rows for them", () => {
  const md = toMarkdown(report);
  for (const label of ["Screen", "Language", "Time zone", "Colour scheme", "Online", "Connection"]) {
    assert.ok(!md.includes(`| ${label} |`), `${label} is left out when it was not sent`);
  }
});

test("options change heading, title, console collapsing and screenshot url", () => {
  const md = toMarkdown(report, {
    headingLevel: 1,
    typeInTitle: false,
    collapseConsole: false,
    screenshotUrl: "https://files.example/s/1.png",
    maxConsoleEntries: 1,
  });
  assert.match(md, /^# The save button does nothing\n/);
  assert.match(md, /### Console \(1 entry\)/);
  assert.doesNotMatch(md, /slow response/, "the oldest entry was dropped");
  assert.match(md, /\| Screenshot \| https:\/\/files\.example\/s\/1\.png \|/);
  assert.equal(toMarkdown(report, { headingLevel: 0 }).startsWith("The save"), true);
});

test("a long first line is clipped into the title, the message stays whole", () => {
  const long = "x".repeat(200);
  const md = toMarkdown({ type: "idea", message: long }, { maxTitleLength: 40 });
  const [heading] = md.split("\n");
  assert.equal(heading, `## Idea: ${"x".repeat(39)}…`);
  assert.ok(md.includes(long), "the full message is still there");
});

test("malformed input renders something readable and never throws", () => {
  for (const bad of [undefined, null, "x", 42, [], {}]) {
    const md = toMarkdown(bad);
    assert.equal(md, "## Feedback: Feedback\n\n| | |\n|---|---|\n| Type | Feedback |\n");
  }
  const md = toMarkdown({ type: "bug", message: "a | b\nc", console: "nope", elements: [{}] });
  assert.match(md, /^## Bug: a \| b\n/);
  assert.doesNotMatch(md, /Element/);
  assert.doesNotMatch(md, /Console/);
});

test("a message containing a code fence does not break the console block", () => {
  const md = toMarkdown({
    type: "bug",
    message: "see below",
    console: [{ ts: "", level: "error", message: "```\ninjected\n```" }],
  });
  assert.match(md, /````text\n\[error\] ```\ninjected\n```\n````/);
});
