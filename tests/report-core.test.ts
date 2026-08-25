import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeScreenshotDataUrl,
  InvalidScreenshotError,
  isReportType,
  normaliseContext,
  normaliseMessage,
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
