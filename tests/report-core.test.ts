import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeScreenshotDataUrl,
  InvalidScreenshotError,
  isReportType,
  normaliseConsole,
  normaliseContext,
  normaliseMessage,
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_MESSAGE_LENGTH,
  MAX_CONTEXT_LENGTHS,
  MAX_STACK_FRAMES,
  MAX_STACK_STRING_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_SCREENSHOT_BYTES,
  REPORT_TYPES,
} from "../src/report-core.ts";

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function pngDataUrl(extraBytes = 64): string {
  const body = new Uint8Array(PNG_SIGNATURE.length + extraBytes);
  body.set(PNG_SIGNATURE, 0);
  return "data:image/png;base64," + toBase64(body);
}

test("a real PNG data URL decodes to its bytes", () => {
  const bytes = decodeScreenshotDataUrl(pngDataUrl());
  assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE);
  assert.equal(bytes.length, 72);
});

test("anything that is not a PNG is refused", () => {
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0]);
  const cases: [string, unknown][] = [
    ["a JPEG wearing a PNG label", "data:image/png;base64," + toBase64(jpegBytes)],
    ["a login page returned as HTML", "data:image/png;base64," + Buffer.from("<html>sign in</html>").toString("base64")],
    ["a JPEG data URL", "data:image/jpeg;base64,/9j/4AAQ"],
    ["an http URL", "https://example.com/x.png"],
    ["an empty string", ""],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
  ];
  for (const [what, value] of cases) {
    assert.throws(
      () => decodeScreenshotDataUrl(value),
      InvalidScreenshotError,
      `${what} must be refused`,
    );
  }
});

test("a buffer too short to hold a signature is refused, not read past its end", () => {
  const stub = "data:image/png;base64," + toBase64(new Uint8Array([0x89, 0x50]));
  assert.throws(() => decodeScreenshotDataUrl(stub), InvalidScreenshotError);
});

test("an oversized screenshot never reaches storage", () => {
  assert.throws(
    () => decodeScreenshotDataUrl(pngDataUrl(MAX_SCREENSHOT_BYTES + 1024)),
    InvalidScreenshotError,
  );
});

test("the ceilings can be tightened by the caller", () => {
  const url = pngDataUrl(4096);
  assert.doesNotThrow(() => decodeScreenshotDataUrl(url));
  assert.throws(
    () => decodeScreenshotDataUrl(url, { maxBytes: 1024 }),
    InvalidScreenshotError,
    "a smaller byte ceiling is honoured",
  );
  assert.throws(
    () => decodeScreenshotDataUrl(url, { maxDataUrlLength: 100 }),
    InvalidScreenshotError,
    "a smaller data-url ceiling is honoured",
  );
});

test("the message is trimmed, capped and rejected when empty", () => {
  assert.equal(normaliseMessage("  the save button does nothing  "), "the save button does nothing");
  assert.equal(normaliseMessage("   "), null);
  assert.equal(normaliseMessage(""), null);
  assert.equal(normaliseMessage(null), null);
  assert.equal(normaliseMessage(123), null);
  assert.equal(normaliseMessage("x".repeat(MAX_MESSAGE_LENGTH + 500))?.length, MAX_MESSAGE_LENGTH);
  assert.equal(normaliseMessage("hello there", 5), "hello");
});

test("only the known report types are accepted", () => {
  for (const ok of REPORT_TYPES) assert.equal(isReportType(ok), true);
  for (const bad of ["Bug", "spam", "", null, undefined, 1, {}]) {
    assert.equal(isReportType(bad), false, `${String(bad)} must not be a type`);
  }
});

test("context strings are clipped so a browser cannot bloat a row", () => {
  const c = normaliseContext({
    url: "/page/" + "a".repeat(2000),
    viewport: "1920x1080",
    userAgent: "u".repeat(2000),
    somethingElse: "ignored",
  });
  assert.equal(c.url.length, 500);
  assert.equal(c.userAgent.length, 500);
  assert.equal(c.viewport, "1920x1080");
  assert.equal(Object.keys(c).length, 3, "no extra keys are carried through");
});

test("the optional context facts are clipped, and anything odd is dropped", () => {
  const c = normaliseContext({
    url: "/orders/42",
    viewport: "1440x900",
    userAgent: "Mozilla/5.0",
    language: "e".repeat(100),
    timezone: "t".repeat(100),
    screen: "s".repeat(100),
    connection: "c".repeat(100),
    colorScheme: "dark",
    online: false,
  });
  assert.equal(c.language?.length, MAX_CONTEXT_LENGTHS.language);
  assert.equal(c.timezone?.length, MAX_CONTEXT_LENGTHS.timezone);
  assert.equal(c.screen?.length, MAX_CONTEXT_LENGTHS.screen);
  assert.equal(c.connection?.length, MAX_CONTEXT_LENGTHS.connection);
  assert.equal(c.colorScheme, "dark");
  assert.equal(c.online, false, "false is a fact, not a missing value");

  const dropped = normaliseContext({
    url: "/a",
    viewport: "",
    userAgent: "",
    language: 42,
    timezone: "",
    screen: null,
    colorScheme: "sepia",
    online: "yes",
    connection: { effectiveType: "4g" },
    somethingElse: "ignored",
  });
  assert.deepEqual(
    Object.keys(dropped),
    ["url", "viewport", "userAgent"],
    "a fact of the wrong type or an empty one is left out entirely",
  );
});

test("missing or nonsense context does not throw", () => {
  const empty = { url: "", viewport: "", userAgent: "" };
  assert.deepEqual(normaliseContext(undefined), empty);
  assert.deepEqual(normaliseContext(null), empty);
  assert.deepEqual(normaliseContext("nonsense"), empty);
  assert.deepEqual(normaliseContext(42), empty);
});

const NUL = String.fromCharCode(0);

test("malformed base64 is refused with InvalidScreenshotError, not a DOMException", () => {
  assert.throws(
    () => decodeScreenshotDataUrl("data:image/png;base64,!!!not base64!!!"),
    InvalidScreenshotError,
  );
});

test("null bytes are stripped so a database insert cannot fail on them", () => {
  assert.equal(normaliseMessage(`save ${NUL}failed`), "save failed");
  assert.equal(normaliseMessage(` ${NUL}${NUL} `), null, "only null bytes means empty");
  assert.equal(normaliseContext({ url: `/a${NUL}b` }).url, "/ab");
  assert.equal(normaliseConsole([{ ts: "", level: "error", message: `x${NUL}y` }])[0]?.message, "xy");
});

test("console entries are validated, clipped and capped at the most recent", () => {
  const raw = [
    { ts: "2026-09-07T08:00:00.000Z", level: "error", message: "real" },
    { ts: "not a date", level: "warn", message: "odd timestamp is kept as empty" },
    { ts: "", level: "log", message: "unknown level is dropped" },
    { ts: "", level: "error", message: 42 },
    { ts: "", level: "error" },
    "a string",
    null,
    { ts: "", level: "error", message: "m".repeat(2000) },
  ];
  const entries = normaliseConsole(raw);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0], { ts: "2026-09-07T08:00:00.000Z", level: "error", message: "real" });
  assert.equal(entries[1]?.ts, "");
  assert.equal(entries[2]?.message.length, MAX_CONSOLE_MESSAGE_LENGTH);
  assert.equal(Object.keys(entries[0] ?? {}).length, 3, "no extra keys are carried through");

  const many = Array.from({ length: 80 }, (_, i) => ({ ts: "", level: "error", message: `e${i}` }));
  const capped = normaliseConsole(many);
  assert.equal(capped.length, MAX_CONSOLE_ENTRIES);
  assert.equal(capped[0]?.message, "e30", "the oldest are dropped");
  assert.equal(normaliseConsole(many, { maxEntries: 5 }).length, 5);
});

test("stack frames are validated, clipped and capped, and a malformed one is dropped", () => {
  const [entry] = normaliseConsole([
    {
      ts: "",
      level: "error",
      message: "Uncaught: boom",
      stack: [
        { file: "https://app.test/main.js", line: 12, col: 9, fn: "saveOrder" },
        { file: "f".repeat(500), line: 1.6, col: -4, fn: "n".repeat(500) },
        { file: 42, line: 1, col: 1 },
        { line: 1, col: 1, fn: "no file at all" },
        "a string",
        null,
      ],
    },
  ]);
  assert.equal(entry?.stack?.length, 2, "a frame without a string file is not a frame");
  assert.deepEqual(entry?.stack?.[0], {
    file: "https://app.test/main.js",
    line: 12,
    col: 9,
    fn: "saveOrder",
  });
  assert.equal(entry?.stack?.[1]?.file.length, MAX_STACK_STRING_LENGTH);
  assert.equal(entry?.stack?.[1]?.fn?.length, MAX_STACK_STRING_LENGTH);
  assert.equal(entry?.stack?.[1]?.line, 1, "a fractional line is truncated");
  assert.equal(entry?.stack?.[1]?.col, 0, "a negative column becomes zero");

  const deep = Array.from({ length: 40 }, (_, i) => ({ file: "a.js", line: i, col: 1 }));
  const [capped] = normaliseConsole([{ ts: "", level: "error", message: "x", stack: deep }]);
  assert.equal(capped?.stack?.length, MAX_STACK_FRAMES);

  for (const bad of [undefined, "at a.js:1:1", 42, {}, [], [{}]]) {
    const [none] = normaliseConsole([{ ts: "", level: "error", message: "x", stack: bad }]);
    assert.equal(none?.stack, undefined, `${JSON.stringify(bad)} is not a stack`);
    assert.equal(Object.keys(none ?? {}).length, 3, "no empty stack key is added");
  }
});

test("a missing or nonsense console section is an empty list, never a throw", () => {
  for (const bad of [undefined, null, "x", 1, {}, [{}]]) {
    assert.deepEqual(normaliseConsole(bad), []);
  }
});
