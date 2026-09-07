import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  initNetwork,
  getNetwork,
  resetNetwork,
  isNetworkActive,
} from "../src/network.ts";
import { buildReport } from "../src/send.ts";
import { normaliseNetwork, MAX_NETWORK_ENTRIES } from "../src/report-core.ts";
import { toMarkdown } from "../src/markdown.ts";

/**
 * Node has `fetch` but no `XMLHttpRequest` and no `location`, so both are
 * stood up by hand — the same trick `breadcrumbs.test.ts` uses for `document`
 * and `history`. The fake `fetch` answers whatever the test asked for; the
 * fake `XMLHttpRequest` is an EventTarget, which is all the patch needs.
 */
type Globals = {
  fetch?: unknown;
  XMLHttpRequest?: unknown;
  location?: unknown;
};

type Answer = { status?: number; delayMs?: number; reject?: unknown };

type Browser = {
  /** The fake `fetch` as it was before `initNetwork` patched anything. */
  original: typeof globalThis.fetch;
  /** What every following call answers with. */
  answer: (next: Answer) => void;
  /** The calls the fake actually saw, so the host contract can be checked. */
  calls: string[];
  Xhr: FakeXhrConstructor;
};

type FakeXhr = EventTarget & {
  status: number;
  open(method: string, url: string): void;
  send(body?: unknown): void;
  /** Ends the request the way the browser would, through `loadend`. */
  finish(status: number, afterMs?: number): Promise<void>;
};

type FakeXhrConstructor = new () => FakeXhr;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withBrowser(fn: (env: Browser) => Promise<void> | void): Promise<void> | void {
  const g = globalThis as Globals;
  const previousFetch = g.fetch;
  const calls: string[] = [];
  let next: Answer = { status: 200 };

  const fakeFetch = async (input: unknown, init?: unknown) => {
    calls.push(String((init as { method?: string } | undefined)?.method ?? "GET") + " " + String(input));
    if (next.delayMs) await delay(next.delayMs);
    if (next.reject) throw next.reject;
    return { status: next.status ?? 200, ok: (next.status ?? 200) < 400 };
  };

  class Xhr extends EventTarget {
    status = 0;
    method = "";
    url = "";
    open(method: string, url: string): void {
      this.method = method;
      this.url = url;
    }
    send(_body?: unknown): void {
      // A real XMLHttpRequest sends; this one waits to be told how it ended.
    }
    async finish(status: number, afterMs = 0): Promise<void> {
      if (afterMs) await delay(afterMs);
      this.status = status;
      this.dispatchEvent(new Event("loadend"));
    }
  }

  g.fetch = fakeFetch;
  g.XMLHttpRequest = Xhr;
  g.location = { href: "https://app.example/orders/1", origin: "https://app.example" };

  const done = () => {
    g.fetch = previousFetch;
    delete g.XMLHttpRequest;
    delete g.location;
  };

  let result: Promise<void> | void;
  try {
    result = fn({
      original: fakeFetch as unknown as typeof globalThis.fetch,
      answer: (a) => {
        next = a;
      },
      calls,
      Xhr: Xhr as unknown as FakeXhrConstructor,
    });
  } catch (err) {
    done();
    throw err;
  }
  return result instanceof Promise ? result.finally(done) : done();
}

afterEach(() => resetNetwork());

test("a fast, successful request is not recorded", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork();
    answer({ status: 200 });
    await fetch("/api/orders");
    assert.equal(getNetwork().length, 0, "the requests that worked are not the story");
  });
});

test("a failed request is recorded with its method, url, status and duration", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork();
    answer({ status: 500 });
    await fetch("/api/orders", { method: "post" });
    const entries = getNetwork();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.method, "POST", "the method is recorded upper case");
    assert.equal(entries[0]?.url, "/api/orders");
    assert.equal(entries[0]?.status, 500);
    assert.equal(typeof entries[0]?.ms, "number");
    assert.ok(!Number.isNaN(Date.parse(entries[0]?.ts ?? "")), "each entry is timestamped");
  });
});

test("a slow but successful request is recorded", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork({ slowMs: 0 });
    answer({ status: 200, delayMs: 8 });
    await fetch("/api/report");
    const entries = getNetwork();
    assert.equal(entries.length, 1, "slow is a symptom even when the status is 200");
    assert.equal(entries[0]?.status, 200);
    assert.ok((entries[0]?.ms ?? 0) > 0);
  });
});

test("a network failure is recorded as status 0 and rethrown unchanged", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork();
    const failure = new TypeError("Failed to fetch");
    answer({ reject: failure });
    await assert.rejects(
      () => fetch("/api/orders"),
      (err) => err === failure,
      "the host sees exactly the error its fetch produced",
    );
    const entry = getNetwork()[0];
    assert.equal(entry?.status, 0);
    assert.equal(entry?.error, true);
  });
});

test("all: true records the successful requests too", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork({ all: true });
    answer({ status: 200 });
    await fetch("/api/orders");
    await fetch("/api/customers");
    assert.equal(getNetwork().length, 2);
  });
});

test("the ring buffer keeps the most recent entries only", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork({ all: true, maxEntries: 3 });
    answer({ status: 200 });
    for (let i = 0; i < 6; i++) await fetch(`/api/${i}`);
    const urls = getNetwork().map((e) => e.url);
    assert.deepEqual(urls, ["/api/3", "/api/4", "/api/5"]);
  });
});

test("a maxEntries that is not a number falls back to the default bound", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork({ all: true, maxEntries: Number.NaN });
    answer({ status: 200 });
    for (let i = 0; i < MAX_NETWORK_ENTRIES + 3; i++) await fetch(`/api/${i}`);
    assert.equal(getNetwork().length, MAX_NETWORK_ENTRIES, "NaN must not remove the bound");
  });
});

test("maxEntries: 0 records nothing and patches nothing", async () => {
  await withBrowser(async ({ answer, original }) => {
    initNetwork({ maxEntries: 0 });
    assert.equal(isNetworkActive(), false, "there is nothing to be active for");
    assert.equal(globalThis.fetch, original, "an inert recorder does not patch fetch");
    answer({ status: 500 });
    await fetch("/api/orders");
    assert.equal(getNetwork().length, 0);
  });
});

test("reset puts fetch and XMLHttpRequest back as it found them", async () => {
  await withBrowser(async ({ original, Xhr }) => {
    const openBefore = Xhr.prototype.open;
    const sendBefore = Xhr.prototype.send;
    initNetwork();
    assert.notEqual(globalThis.fetch, original, "the patch is in place while recording");
    resetNetwork();
    assert.equal(globalThis.fetch, original);
    assert.equal(Xhr.prototype.open, openBefore);
    assert.equal(Xhr.prototype.send, sendBefore);
    assert.equal(isNetworkActive(), false);
  });
});

test("beforeRequest returning null drops the entry", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork({ beforeRequest: (entry) => (entry.url.startsWith("/admin") ? null : entry) });
    answer({ status: 500 });
    await fetch("/admin/users");
    await fetch("/api/orders");
    assert.deepEqual(getNetwork().map((e) => e.url), ["/api/orders"]);
  });
});

test("beforeRequest may rewrite the entry", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork({
      beforeRequest: (entry) => ({ ...entry, url: entry.url.replace(/\/\d+/, "/:id") }),
    });
    answer({ status: 404 });
    await fetch("/api/orders/42");
    assert.equal(getNetwork()[0]?.url, "/api/orders/:id");
  });
});

test("a beforeRequest that throws drops the entry and never reaches the caller", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork({
      beforeRequest: () => {
        throw new Error("hook is broken");
      },
    });
    answer({ status: 500 });
    const response = await fetch("/api/orders");
    assert.equal(response.status, 500, "the host still gets its response");
    assert.equal(getNetwork().length, 0, "a hook that cannot decide drops the entry");
  });
});

test("an ignore that throws drops the entry rather than guessing", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork({
      ignore: () => {
        throw new Error("ignore is broken");
      },
    });
    answer({ status: 500 });
    await fetch("/api/orders");
    assert.equal(getNetwork().length, 0);
  });
});

test("requests to the report endpoint itself are skipped", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork({ endpoint: "/api/bug-reports" });
    answer({ status: 500 });
    await fetch("/api/bug-reports?retry=2", { method: "POST" });
    await fetch("/api/orders");
    assert.deepEqual(getNetwork().map((e) => e.url), ["/api/orders"]);
  });
});

test("sensitive query values are redacted, ordinary ones are kept", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork();
    answer({ status: 500 });
    await fetch("/api/orders?tab=notes&token=sk-live-9f2&page=2");
    assert.equal(getNetwork()[0]?.url, "/api/orders?tab=notes&token=[redacted]&page=2");
  });
});

test("a cross-origin request keeps its origin, a same-origin one does not", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork({ all: true });
    answer({ status: 200 });
    await fetch("https://api.stripe.com/v1/charges#section");
    await fetch("https://app.example/api/orders");
    assert.deepEqual(getNetwork().map((e) => e.url), [
      "https://api.stripe.com/v1/charges",
      "/api/orders",
    ]);
  });
});

test("a Request object is read for its method and url", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork();
    answer({ status: 503 });
    await fetch({ url: "/api/orders", method: "PUT" } as unknown as Request);
    const entry = getNetwork()[0];
    assert.equal(entry?.method, "PUT");
    assert.equal(entry?.url, "/api/orders");
  });
});

test("an XMLHttpRequest is recorded when it ends, timed from send to loadend", async () => {
  await withBrowser(async ({ Xhr }) => {
    initNetwork();
    const xhr = new Xhr();
    xhr.open("get", "/api/orders?token=abc");
    xhr.send();
    await xhr.finish(500, 5);
    const entry = getNetwork()[0];
    assert.equal(entry?.method, "GET");
    assert.equal(entry?.url, "/api/orders?token=[redacted]");
    assert.equal(entry?.status, 500);
    assert.ok((entry?.ms ?? 0) >= 4, "the duration is measured across the request");
  });
});

test("an XMLHttpRequest that ends without a status is a network error", async () => {
  await withBrowser(async ({ Xhr }) => {
    initNetwork();
    const xhr = new Xhr();
    xhr.open("POST", "/api/orders");
    xhr.send();
    await xhr.finish(0);
    const entry = getNetwork()[0];
    assert.equal(entry?.status, 0);
    assert.equal(entry?.error, true);
  });
});

test("a successful XMLHttpRequest is not recorded by default", async () => {
  await withBrowser(async ({ Xhr }) => {
    initNetwork();
    const xhr = new Xhr();
    xhr.open("GET", "/api/orders");
    xhr.send();
    await xhr.finish(204);
    assert.equal(getNetwork().length, 0);
  });
});

test("initNetwork twice patches once", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork();
    const patched = globalThis.fetch;
    initNetwork({ all: true });
    assert.equal(globalThis.fetch, patched, "the second call is a no-op");
    answer({ status: 200 });
    await fetch("/api/orders");
    assert.equal(getNetwork().length, 0, "including its options");
  });
});

test("buildReport attaches the recorded requests while the recorder is active", async () => {
  await withBrowser(async ({ answer }) => {
    initNetwork();
    answer({ status: 500 });
    await fetch("/api/orders");
    const report = buildReport({ type: "bug", message: "Saving does nothing" });
    assert.equal(report.network?.length, 1);
    assert.equal(report.network?.[0]?.status, 500);
    const without = buildReport({ type: "bug", message: "x", includeNetwork: false });
    assert.equal(without.network, undefined);
  });
  resetNetwork();
  const afterReset = buildReport({ type: "bug", message: "x" });
  assert.equal(afterReset.network, undefined, "nothing recording, nothing attached");
});

test("normaliseNetwork drops what is not a request and clips the rest", () => {
  const entries = normaliseNetwork([
    null,
    "GET /api",
    { method: "GET" },
    { url: "/api/orders", method: "G".repeat(60), status: 1e9, ms: -5 },
    { url: `/a${String.fromCharCode(0)}b`, status: "500", ms: 12.6, error: "yes", ts: "not a date" },
    { url: "/api/x", method: "POST", status: 500, ms: 40, error: true, ts: "2026-09-07T08:12:31.004Z" },
  ]);
  assert.equal(entries.length, 3, "an entry without a url is not a request");
  assert.equal(entries[0]?.method.length, 20, "a method is a short token");
  assert.equal(entries[0]?.status, 999, "an impossible status is clamped, not trusted");
  assert.equal(entries[0]?.ms, 0, "a negative duration is not a duration");
  assert.equal(entries[1]?.url, "/ab", "null bytes are stripped; Postgres refuses them");
  assert.equal(entries[1]?.status, 0, "a status that is not a number is no status");
  assert.equal(entries[1]?.ms, 13);
  assert.equal(entries[1]?.error, undefined, "only a literal true means it failed");
  assert.equal(entries[1]?.ts, "", "an unparseable timestamp is dropped");
  assert.equal(entries[2]?.error, true);
  assert.deepEqual(normaliseNetwork("not an array"), []);
  assert.deepEqual(normaliseNetwork(undefined), []);
});

test("normaliseNetwork keeps the most recent entries", () => {
  const raw = Array.from({ length: MAX_NETWORK_ENTRIES + 5 }, (_v, i) => ({ url: `/api/${i}` }));
  const entries = normaliseNetwork(raw);
  assert.equal(entries.length, MAX_NETWORK_ENTRIES);
  assert.equal(entries.at(-1)?.url, `/api/${MAX_NETWORK_ENTRIES + 4}`);
  assert.equal(normaliseNetwork(raw, { maxEntries: 2 }).length, 2);
});

test("toMarkdown renders a Requests table after breadcrumbs and before the console", () => {
  const md = toMarkdown({
    type: "bug",
    message: "The save button does nothing",
    breadcrumbs: [{ ts: "2026-09-07T08:12:30.400Z", kind: "click", target: "button#save" }],
    network: [
      { ts: "2026-09-07T08:12:31.004Z", method: "POST", url: "/api/orders", status: 500, ms: 812 },
      { ts: "2026-09-07T08:12:32.004Z", method: "GET", url: "/api/me", status: 0, ms: 30, error: true },
    ],
    console: [{ ts: "2026-09-07T08:12:31.104Z", level: "error", message: "TypeError" }],
  });
  assert.ok(md.includes("### Requests"));
  assert.ok(md.includes("| Method | URL | Status | ms |"));
  assert.ok(md.includes("| POST | `/api/orders` | 500 | 812 |"));
  assert.ok(md.includes("| GET | `/api/me` | failed | 30 |"), "status 0 reads as a failure");
  assert.ok(
    md.indexOf("What happened before") < md.indexOf("### Requests"),
    "the timeline comes first",
  );
  assert.ok(md.indexOf("### Requests") < md.indexOf("Console ("), "the console comes last");
  assert.ok(!toMarkdown({ type: "bug", message: "x" }).includes("### Requests"));
});
