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

test("a missing or nonsense console section is an empty list, never a throw", () => {
  for (const bad of [undefined, null, "x", 1, {}, [{}]]) {
    assert.deepEqual(normaliseConsole(bad), []);
  }
});
