import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  initPerf,
  getPerf,
  getStorageSnapshot,
  isPerfActive,
  resetPerf,
} from "../src/perf.ts";
import { buildReport } from "../src/send.ts";
import { normalisePerf, normaliseStorage, MAX_STORAGE_KEYS } from "../src/report-core.ts";
import { toMarkdown } from "../src/markdown.ts";
import { scrubReport } from "../src/scrub.ts";

/**
 * Node has no `PerformanceObserver`, no `localStorage` and no `document`, so
 * all three are stood up by hand — happy-dom for the DOM and the two stores,
 * a stub for the observer. The stub is the interesting half: it records which
 * entry types were observed and hands each one whatever entries the test says
 * the browser had already buffered, which is exactly the contract
 * `buffered: true` is relied on for.
 */
type Entry = Record<string, unknown>;

type Globals = {
  PerformanceObserver?: unknown;
  performance?: unknown;
  window?: unknown;
  document?: unknown;
  localStorage?: unknown;
  sessionStorage?: unknown;
};

type Observed = { type: string; buffered: boolean };

type Env = {
  /** Every `observe` the module made, in order. */
  observed: Observed[];
  /** Delivers entries to the observers of one type, as the browser would. */
  emit: (type: string, entries: Entry[]) => void;
  /** How many observers are still connected. */
  connected: () => number;
  localStorage: Storage;
  sessionStorage: Storage;
  /** Sets `document.cookie` to a whole cookie string. */
  setCookies: (raw: string) => void;
};

/**
 * Installs the fake browser, runs the test in it, and puts every global back —
 * including the ones that were not there to begin with.
 */
function withBrowser(
  options: { buffered?: Record<string, Entry[]>; navigation?: Entry; memory?: Entry },
  fn: (env: Env) => void | Promise<void>,
): Promise<void> | void {
  const g = globalThis as Globals;
  const saved: Globals = {
    PerformanceObserver: g.PerformanceObserver,
    performance: g.performance,
    window: g.window,
    document: g.document,
    localStorage: g.localStorage,
    sessionStorage: g.sessionStorage,
  };

  const window = new Window({ url: "https://example.test/checkout" });
  const observed: Observed[] = [];
  const handlers = new Map<string, ((entries: Entry[]) => void)[]>();
  let connected = 0;

  class FakeObserver {
    #callback: (list: { getEntries: () => Entry[] }) => void;
    #types: string[] = [];
    constructor(callback: (list: { getEntries: () => Entry[] }) => void) {
      this.#callback = callback;
    }
    observe(init: { type: string; buffered?: boolean }) {
      observed.push({ type: init.type, buffered: init.buffered === true });
      this.#types.push(init.type);
      connected += 1;
      const deliver = (entries: Entry[]) =>
        this.#callback({ getEntries: () => entries });
      const list = handlers.get(init.type) ?? [];
      list.push(deliver);
      handlers.set(init.type, list);
      // What `buffered: true` buys: the entries the browser recorded before
      // anybody was listening are delivered as soon as the observer starts.
      const already = options.buffered?.[init.type];
      if (already) deliver(already);
    }
    disconnect() {
      connected -= this.#types.length;
      this.#types = [];
    }
  }

  g.PerformanceObserver = FakeObserver;
  g.performance = {
    getEntriesByType: (type: string) =>
      type === "navigation" && options.navigation ? [options.navigation] : [],
    ...(options.memory ? { memory: options.memory } : {}),
  };
  g.window = window;
  g.document = window.document;
  g.localStorage = window.localStorage;
  g.sessionStorage = window.sessionStorage;

  const restore = () => {
    resetPerf();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete (g as Record<string, unknown>)[key];
      else (g as Record<string, unknown>)[key] = value;
    }
  };

  const env: Env = {
    observed,
    emit: (type, entries) => {
      for (const deliver of handlers.get(type) ?? []) deliver(entries);
    },
    connected: () => connected,
    localStorage: window.localStorage as unknown as Storage,
    sessionStorage: window.sessionStorage as unknown as Storage,
    setCookies: (raw) => {
      for (const pair of raw.split("; ")) window.document.cookie = pair;
    },
  };

  try {
    const result = fn(env);
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return;
  } catch (err) {
    restore();
    throw err;
  }
}

afterEach(() => {
  resetPerf();
});

test("the observers ask for buffered entries, so an LCP from before init is seen", () => {
  withBrowser(
    { buffered: { "largest-contentful-paint": [{ startTime: 1234.6 }] } },
    (env) => {
      initPerf();
      assert.ok(env.observed.every((o) => o.buffered));
      assert.deepEqual(getPerf(), { lcp: 1235 });
    },
  );
});

test("LCP takes the last candidate, not the first", () => {
  withBrowser({}, (env) => {
    initPerf();
    env.emit("largest-contentful-paint", [{ startTime: 400 }]);
    env.emit("largest-contentful-paint", [{ startTime: 1800 }]);
    assert.equal(getPerf()?.lcp, 1800);
  });
});

test("CLS sums the shifts and skips the ones that followed an input", () => {
  withBrowser({}, (env) => {
    initPerf();
    env.emit("layout-shift", [
      { value: 0.05 },
      { value: 0.02, hadRecentInput: true },
      { value: 0.031 },
    ]);
    // 0.05 + 0.031, rounded to three decimals. The 0.02 the reporter caused by
    // clicking is not a layout shift they suffered.
    assert.equal(getPerf()?.cls, 0.081);
  });
});

test("INP is the worst interaction, which is the documented simplification", () => {
  withBrowser({}, (env) => {
    initPerf();
    env.emit("event", [{ duration: 40 }, { duration: 210 }]);
    env.emit("event", [{ duration: 96 }]);
    assert.equal(getPerf()?.inp, 210);
  });
});

test("a browser with no `event` type still contributes its first-input delay", () => {
  withBrowser({ buffered: { "first-input": [{ duration: 180 }] } }, () => {
    initPerf();
    assert.equal(getPerf()?.inp, 180);
  });
});

test("long tasks are counted and totalled", () => {
  withBrowser({}, (env) => {
    initPerf();
    env.emit("longtask", [{ duration: 80 }, { duration: 120.4 }]);
    assert.deepEqual(getPerf()?.longTasks, { count: 2, totalMs: 200 });
  });
});

test("the navigation entry supplies TTFB and the load milestones", () => {
  withBrowser(
    {
      navigation: {
        responseStart: 128.4,
        domContentLoadedEventEnd: 640.7,
        loadEventEnd: 1200,
      },
    },
    () => {
      initPerf();
      const perf = getPerf();
      assert.equal(perf?.ttfb, 128);
      assert.equal(perf?.domContentLoaded, 641);
      assert.equal(perf?.load, 1200);
    },
  );
});

test("memory is reported in megabytes where the browser exposes it, and left out where it does not", () => {
  withBrowser({ memory: { usedJSHeapSize: 33_554_432, jsHeapSizeLimit: 2_147_483_648 } }, () => {
    initPerf();
    assert.deepEqual(getPerf()?.memory, { usedMB: 32, limitMB: 2048 });
  });
  withBrowser({}, () => {
    initPerf();
    assert.equal(getPerf(), null);
  });
});

test("a page that measured nothing has no perf block at all", () => {
  withBrowser({}, () => {
    initPerf();
    assert.equal(getPerf(), null);
  });
});

test("nothing throws where there is no PerformanceObserver at all", () => {
  const g = globalThis as Globals;
  const saved = g.PerformanceObserver;
  delete g.PerformanceObserver;
  try {
    initPerf();
    assert.equal(isPerfActive(), true);
    assert.equal(getPerf(), null);
  } finally {
    resetPerf();
    if (saved !== undefined) g.PerformanceObserver = saved;
  }
});

test("stop disconnects every observer and unregisters both sources", () => {
  withBrowser({}, (env) => {
    const stop = initPerf();
    assert.ok(env.connected() > 0);
    stop();
    assert.equal(env.connected(), 0);
    assert.equal(isPerfActive(), false);
    const report = buildReport({ type: "bug", message: "gone" });
    assert.equal("perf" in report, false);
    assert.equal("storage" in report, false);
  });
});

test("the storage snapshot lists key names and value lengths, never values", () => {
  withBrowser({}, (env) => {
    env.localStorage.setItem("authToken", "supersecret-token-value");
    env.localStorage.setItem("theme", "dark");
    env.sessionStorage.setItem("cart", "[1,2,3]");
    initPerf();
    const snapshot = getStorageSnapshot();
    assert.deepEqual(snapshot?.local, [
      { key: "authToken", length: 23 },
      { key: "theme", length: 4 },
    ]);
    assert.deepEqual(snapshot?.session, [{ key: "cart", length: 7 }]);
    assert.equal(snapshot?.values, undefined);
    assert.equal(JSON.stringify(snapshot).includes("supersecret"), false);
  });
});

test("no value travels without being named in the allow-list, and then only that one", () => {
  withBrowser({}, (env) => {
    env.localStorage.setItem("tenant", "acme");
    env.localStorage.setItem("authToken", "secret");
    initPerf({ allowValues: ["tenant", "absent"] });
    const snapshot = getStorageSnapshot();
    assert.deepEqual(snapshot?.values, { tenant: "acme" });
    assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  });
});

test("an allow-listed value is clipped to 200 characters", () => {
  withBrowser({}, (env) => {
    env.localStorage.setItem("flags", "x".repeat(500));
    initPerf({ allowValues: ["flags"] });
    assert.equal(getStorageSnapshot()?.values?.flags?.length, 200);
  });
});

test("the key list is capped, and the cap cannot be raised past MAX_STORAGE_KEYS", () => {
  withBrowser({}, (env) => {
    for (let i = 0; i < 80; i += 1) env.localStorage.setItem(`k${i}`, "v");
    initPerf({ maxKeys: 500 });
    assert.equal(getStorageSnapshot()?.local?.length, MAX_STORAGE_KEYS);
  });
  withBrowser({}, (env) => {
    for (let i = 0; i < 80; i += 1) env.localStorage.setItem(`k${i}`, "v");
    initPerf({ maxKeys: 3 });
    assert.equal(getStorageSnapshot()?.local?.length, 3);
  });
});

test("cookies are listed by name and never by value", () => {
  withBrowser({}, (env) => {
    env.setCookies("session=abc123; consent=yes");
    initPerf();
    const snapshot = getStorageSnapshot();
    assert.deepEqual(snapshot?.cookies, ["session", "consent"]);
    assert.equal(JSON.stringify(snapshot).includes("abc123"), false);
  });
});

test("a cookie is never included by the allow-list either", () => {
  withBrowser({}, (env) => {
    env.setCookies("session=abc123");
    initPerf({ allowValues: ["session"] });
    const snapshot = getStorageSnapshot();
    assert.equal(snapshot?.values, undefined);
    assert.equal(JSON.stringify(snapshot).includes("abc123"), false);
  });
});

test("storage: false leaves the snapshot out and still measures", () => {
  withBrowser({}, (env) => {
    env.localStorage.setItem("theme", "dark");
    initPerf({ storage: false });
    env.emit("largest-contentful-paint", [{ startTime: 900 }]);
    const report = buildReport({ type: "bug", message: "slow" });
    assert.equal(report.perf?.lcp, 900);
    assert.equal("storage" in report, false);
  });
});

test("buildReport carries both blocks while initPerf is measuring, and neither when it is not", () => {
  withBrowser({}, (env) => {
    env.localStorage.setItem("theme", "dark");
    const before = buildReport({ type: "bug", message: "before" });
    assert.equal("perf" in before, false);
    assert.equal("storage" in before, false);

    initPerf();
    env.emit("largest-contentful-paint", [{ startTime: 2400 }]);
    const during = buildReport({ type: "bug", message: "during" });
    assert.equal(during.perf?.lcp, 2400);
    assert.deepEqual(during.storage?.local, [{ key: "theme", length: 4 }]);

    const off = buildReport({ type: "bug", message: "off", includePerf: false });
    assert.equal("perf" in off, false);
    assert.equal("storage" in off, false);
  });
});

test("the snapshot is taken when the report is built, not when initPerf ran", () => {
  withBrowser({}, (env) => {
    initPerf();
    env.localStorage.setItem("addedLater", "1");
    assert.deepEqual(buildReport({ type: "bug", message: "x" }).storage?.local, [
      { key: "addedLater", length: 1 },
    ]);
  });
});

test("a second initPerf does not observe twice", () => {
  withBrowser({}, (env) => {
    initPerf();
    const first = env.observed.length;
    initPerf();
    assert.equal(env.observed.length, first);
  });
});

test("the normalisers clip what a client sends, and refuse what is not a snapshot", () => {
  assert.equal(normalisePerf(null), null);
  assert.equal(normalisePerf([]), null);
  assert.equal(normalisePerf({}), null);
  assert.equal(normalisePerf({ lcp: "fast" }), null);
  assert.deepEqual(normalisePerf({ lcp: -5, cls: 0.12345, load: 1e300 }), {
    cls: 0.123,
    load: 3_600_000,
  });
  assert.equal(normaliseStorage("nope"), null);
  assert.equal(normaliseStorage({ local: [] }), null);
  assert.deepEqual(
    normaliseStorage({
      local: [{ key: "a".repeat(300), length: 4.6 }, { nope: 1 }],
      cookies: ["ok", 7],
      values: { k: "v", bad: 3 },
    }),
    {
      local: [{ key: "a".repeat(100), length: 5 }],
      cookies: ["ok"],
      values: { k: "v" },
    },
  );
});

test("the scrubber redacts an allow-listed value and a cookie named after a person", () => {
  const scrubbed = scrubReport({
    message: "hi",
    storage: {
      local: [{ key: "user@example.com", length: 3 }],
      cookies: ["session", "seen-by-ada@example.com"],
      values: { profile: "signed in as ada@example.com" },
    },
  }) as { storage: { cookies: string[]; values: Record<string, string>; local: unknown[] } };
  assert.equal(scrubbed.storage.values.profile, "signed in as [redacted]");
  assert.deepEqual(scrubbed.storage.cookies, ["session", "[redacted]"]);
  // The key names are the shape of the store, and redacting them would cost
  // the reader the point of the snapshot.
  assert.deepEqual(scrubbed.storage.local, [{ key: "user@example.com", length: 3 }]);
});

test("toMarkdown renders only the figures that are present, and collapses the storage", () => {
  const md = toMarkdown({
    type: "bug",
    message: "Slow",
    perf: { lcp: 3400, cls: 0.21, longTasks: { count: 3, totalMs: 480 } },
    storage: { local: [{ key: "theme", length: 4 }], cookies: ["session"] },
  });
  assert.match(md, /### Performance/);
  assert.match(md, /\| Largest contentful paint \| 3400 ms \|/);
  assert.match(md, /\| Cumulative layout shift \| 0\.21 \|/);
  assert.match(md, /\| Long tasks \| 3 \(480 ms total\) \|/);
  assert.equal(/Interaction to next paint/.test(md), false);
  assert.match(md, /<details><summary>Storage<\/summary>/);
  assert.match(md, /localStorage: `theme` \(4\)/);
  assert.match(md, /Cookies: `session`/);
});

test("toMarkdown leaves both sections out of a report that has neither", () => {
  const md = toMarkdown({ type: "bug", message: "Plain" });
  assert.equal(/### Performance/.test(md), false);
  assert.equal(/Storage/.test(md), false);
});
