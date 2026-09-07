import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStack } from "../src/stack.ts";

/**
 * The samples are real stacks, trimmed: no two browsers write the same one, and
 * the parser has to cope with all three without being told which it is looking
 * at. What it must never do is throw, or invent a frame from a line that was
 * only ever a header.
 */
const V8 = [
  "TypeError: order.save is not a function",
  "    at saveOrder (https://app.test/assets/main-4f2a.js:12:9)",
  "    at Object.handleClick (https://app.test/assets/main-4f2a.js:44:17)",
  "    at https://app.test/assets/vendor.js:1:1",
].join("\n");

const FIREFOX = [
  "saveOrder@https://app.test/assets/main-4f2a.js:12:9",
  "handleClick@https://app.test/assets/main-4f2a.js:44:17",
  "@https://app.test/assets/vendor.js:1:1",
].join("\n");

const SAFARI = [
  "saveOrder@https://app.test/assets/main-4f2a.js:12:9",
  "[native code]",
  "global code@https://app.test/assets/vendor.js:1:1",
].join("\n");

test("a V8 stack gives named frames, and the header line is not one", () => {
  const frames = parseStack(V8);
  assert.equal(frames.length, 3, "the TypeError line is a header, not a frame");
  assert.deepEqual(frames[0], {
    file: "https://app.test/assets/main-4f2a.js",
    line: 12,
    col: 9,
    fn: "saveOrder",
  });
  assert.equal(frames[1]?.fn, "Object.handleClick");
  assert.equal(frames[2]?.fn, undefined, "an anonymous frame carries no function name");
  assert.equal(frames[2]?.file, "https://app.test/assets/vendor.js");
});

test("Firefox and Safari write fn@file:line:col, and it parses the same way", () => {
  for (const [name, stack] of [
    ["Firefox", FIREFOX],
    ["Safari", SAFARI],
  ] as const) {
    const frames = parseStack(stack);
    assert.equal(frames[0]?.fn, "saveOrder", name);
    assert.equal(frames[0]?.file, "https://app.test/assets/main-4f2a.js", name);
    assert.equal(frames[0]?.line, 12, name);
    assert.equal(frames[0]?.col, 9, name);
    assert.equal(frames.at(-1)?.file, "https://app.test/assets/vendor.js", name);
  }
  assert.equal(parseStack(FIREFOX)[2]?.fn, undefined, "a bare @frame has no function name");
  assert.equal(parseStack(SAFARI).length, 2, "[native code] has no position, so it is dropped");
});

test("garbage is not a stack, and neither is a missing one", () => {
  assert.deepEqual(parseStack("not a stack at all"), []);
  assert.deepEqual(parseStack(""), []);
  assert.deepEqual(parseStack(undefined), []);
  assert.deepEqual(parseStack(null), []);
  assert.deepEqual(parseStack(42), []);
  assert.deepEqual(parseStack({ stack: "at a.js:1:1" }), []);
});

test("at most ten frames are kept, innermost first", () => {
  const deep = Array.from({ length: 40 }, (_, i) => `    at f${i} (a.js:${i + 1}:1)`).join("\n");
  const frames = parseStack(deep);
  assert.equal(frames.length, 10);
  assert.equal(frames[0]?.fn, "f0", "the top of the stack is the interesting end");
  assert.equal(parseStack(deep, 2).length, 2, "the cap is an argument");
});

test("a very long file or function name is clipped", () => {
  const frames = parseStack(`    at ${"n".repeat(500)} (${"f".repeat(500)}.js:1:2)`);
  assert.equal(frames[0]?.file.length, 200);
  assert.equal(frames[0]?.fn?.length, 200);
});

test("carriage returns from a Windows browser do not hide the position", () => {
  const frames = parseStack("Error: boom\r\n    at saveOrder (main.js:12:9)\r\n");
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.col, 9);
});

test("no source text is ever carried, only positions", () => {
  const frames = parseStack("    at saveOrder (main.js:12:9)");
  assert.deepEqual(Object.keys(frames[0] ?? {}).sort(), ["col", "file", "fn", "line"]);
});
