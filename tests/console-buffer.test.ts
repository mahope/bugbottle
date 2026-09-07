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

test("an uncaught error carries the frames from its error object", () => {
  const fakeWindow = new EventTarget();
  (globalThis as { window?: unknown }).window = fakeWindow;
  try {
    withSilencedConsole(() => {
      initConsoleBuffer();
      const error = new TypeError("order.save is not a function");
      error.stack = [
        "TypeError: order.save is not a function",
        "    at saveOrder (https://app.test/main.js:12:9)",
        "    at https://app.test/vendor.js:1:1",
      ].join("\n");
      fakeWindow.dispatchEvent(
        Object.assign(new Event("error"), {
          message: "order.save is not a function",
          filename: "https://app.test/main.js",
          lineno: 12,
          error,
        }),
      );
    });
    const entry = getConsoleBuffer()[0];
    assert.equal(
      entry?.message,
      "Uncaught: order.save is not a function (https://app.test/main.js:12)",
      "the one-line message is unchanged",
    );
    assert.equal(entry?.stack?.length, 2, "the header line is not a frame");
    assert.equal(entry?.stack?.[0]?.fn, "saveOrder");
    assert.equal(entry?.stack?.[0]?.line, 12);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("a rejection with no usable stack is still recorded, without one", () => {
  const fakeWindow = new EventTarget();
  (globalThis as { window?: unknown }).window = fakeWindow;
  try {
    withSilencedConsole(() => {
      initConsoleBuffer();
      // A promise can be rejected with anything at all, including a string.
      fakeWindow.dispatchEvent(
        Object.assign(new Event("unhandledrejection"), { reason: "gateway timeout" }),
      );
      const withFrames = Object.assign(new Error("nope"), {
        stack: "Error: nope\nretry@https://app.test/main.js:88:3",
      });
      fakeWindow.dispatchEvent(
        Object.assign(new Event("unhandledrejection"), { reason: withFrames }),
      );
    });
    const [plain, framed] = getConsoleBuffer();
    assert.equal(plain?.message, "Unhandled rejection: gateway timeout");
    assert.equal(plain?.stack, undefined, "no frames means no key at all");
    assert.deepEqual(framed?.stack, [
      { file: "https://app.test/main.js", line: 88, col: 3, fn: "retry" },
    ]);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
