import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  initConsoleBuffer,
  getConsoleBuffer,
  resetConsoleBuffer,
} from "../src/console-buffer.ts";

afterEach(() => resetConsoleBuffer());

/** Silences the real console while a block runs, and returns what it saw. */
function withSilencedConsole<T>(fn: () => T): { result: T; seen: unknown[][] } {
  const seen: unknown[][] = [];
  const realError = console.error;
  const realWarn = console.warn;
  console.error = (...a: unknown[]) => void seen.push(a);
  console.warn = (...a: unknown[]) => void seen.push(a);
  try {
    return { result: fn(), seen };
  } finally {
    console.error = realError;
    console.warn = realWarn;
  }
}

test("errors and warnings are recorded", () => {
  withSilencedConsole(() => {
    initConsoleBuffer();
    console.error("save failed");
    console.warn("slow response");
  });
  const entries = getConsoleBuffer();
  assert.equal(entries.length, 2);
  const [first, second] = entries;
  assert.ok(first && second, "both entries were recorded");
  assert.equal(first.level, "error");
  assert.equal(first.message, "save failed");
  assert.equal(second.level, "warn");
  assert.ok(!Number.isNaN(Date.parse(first.ts)), "each entry is timestamped");
});

test("the original console is still called", () => {
  const { seen } = withSilencedConsole(() => {
    initConsoleBuffer();
    console.error("passed through");
  });
  assert.deepEqual(seen, [["passed through"]], "nothing disappears from the console");
});

test("log and debug are deliberately not captured", () => {
  withSilencedConsole(() => {
    initConsoleBuffer();
    console.log("a customer email could sit in here");
    console.debug("and here");
  });
  assert.equal(getConsoleBuffer().length, 0);
});

test("Errors are serialised readably, and odd values do not throw", () => {
  withSilencedConsole(() => {
    initConsoleBuffer();
    console.error(new TypeError("x is not a function"));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    console.error("circular:", circular);
    console.error(undefined, null, 42, Symbol("s"));
  });
  const messages = getConsoleBuffer().map((e) => e.message);
  assert.equal(messages[0], "TypeError: x is not a function");
  assert.ok(messages[1]?.startsWith("circular:"), "a circular structure degrades instead of throwing");
  assert.equal(getConsoleBuffer().length, 3);
});

test("the buffer keeps the most recent 50 entries, not the first 50", () => {
  withSilencedConsole(() => {
    initConsoleBuffer();
    for (let i = 0; i < 60; i++) console.error(`entry ${i}`);
  });
  const entries = getConsoleBuffer();
  assert.equal(entries.length, 50);
  assert.equal(entries[0]?.message, "entry 10", "the oldest were dropped");
  assert.equal(entries[49]?.message, "entry 59", "the newest is kept");
});

test("a very long message is clipped", () => {
  withSilencedConsole(() => {
    initConsoleBuffer();
    console.error("y".repeat(5000));
  });
  assert.equal(getConsoleBuffer()[0]?.message.length, 500);
});

test("initialising twice does not double-record", () => {
  withSilencedConsole(() => {
    initConsoleBuffer();
    initConsoleBuffer();
    console.error("once");
  });
  assert.equal(getConsoleBuffer().length, 1);
});

test("the returned buffer is a copy", () => {
  withSilencedConsole(() => {
    initConsoleBuffer();
    console.error("first");
  });
  const snapshot = getConsoleBuffer();
  snapshot.push({ ts: "", level: "error", message: "injected" });
  assert.equal(getConsoleBuffer().length, 1, "callers cannot mutate the buffer");
});

test("uncaught errors are recorded once, even after a reset and re-init", () => {
  // Node has EventTarget but no window; a bare one is enough to stand in.
  const fakeWindow = new EventTarget();
  (globalThis as { window?: unknown }).window = fakeWindow;
  try {
    const fire = () =>
      fakeWindow.dispatchEvent(
        Object.assign(new Event("error"), { message: "boom", filename: "app.js", lineno: 7 }),
      );
    withSilencedConsole(() => {
      initConsoleBuffer();
      resetConsoleBuffer();
      initConsoleBuffer();
      fire();
    });
    const entries = getConsoleBuffer();
    assert.equal(entries.length, 1, "the old listener was removed on reset");
    assert.equal(entries[0]?.message, "Uncaught: boom (app.js:7)");

    resetConsoleBuffer();
    fire();
    assert.equal(getConsoleBuffer().length, 0, "nothing is recorded after a reset");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
