import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createQueue,
  SCREENSHOT_NOTE,
  type QueuedReport,
  type QueueOptions,
  type QueueStorage,
} from "../src/queue.ts";
import type { BugReport } from "../src/report-core.ts";
import {
  computeSignature,
  createSigner,
  DEFAULT_SIGNATURE_HEADER,
  hmacHex,
} from "../src/sign.ts";

/**
 * The queue talks to two things it does not own: `localStorage` and `fetch`.
 * Both are replaced here, so a test can watch a report survive a reload, or a
 * server answer 503 twice and 200 on the third try, without a browser.
 */

const globals = globalThis as unknown as Record<string, unknown>;

/** A `localStorage` that is a plain map, with an optional quota that throws. */
function fakeStorage(initial: Record<string, string> = {}, quota = Infinity) {
  const map = new Map(Object.entries(initial));
  let broken = false;
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (broken || value.length > quota) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  return {
    storage: storage as unknown as Storage,
    map,
    break() {
      broken = true;
    },
  };
}

/** A fetch stand-in answering with the given statuses in order, then the last. */
function fakeFetch(...statuses: (number | "network-error")[]) {
  const calls: { url: string; body: unknown }[] = [];
  let i = 0;
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const status = statuses[Math.min(i, statuses.length - 1)] ?? 200;
    i += 1;
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) });
    if (status === "network-error") throw new TypeError("Failed to fetch");
    return new Response("{}", { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function report(message: string): BugReport & Record<string, unknown> {
  return {
    type: "bug",
    message,
    context: { url: "/orders", viewport: "800x600", userAgent: "test" },
  };
}

const KEY = "bugbottle:queue";

/**
 * Waits for a condition rather than for a number of milliseconds: a storage
 * that answers later answers when it answers, and a fixed sleep is a test that
 * fails on a loaded machine.
 */
async function until(done: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** Builds a queue and remembers it, so the listeners never outlive the test. */
const made: { destroy(): void }[] = [];
function makeQueue(options: QueueOptions) {
  const queue = createQueue(options);
  made.push(queue);
  return queue;
}

beforeEach(() => {
  for (const queue of made.splice(0)) queue.destroy();
  delete globals["localStorage"];
});

test("a queued report is written to storage and read back by the next page load", async () => {
  const { storage, map } = fakeStorage();
  globals["localStorage"] = storage;
  const first = fakeFetch("network-error");
  const queue = makeQueue({ endpoint: "/api/feedback", fetch: first.fetch });
  queue.enqueue(report("it broke"));
  assert.equal(queue.size(), 1);
  assert.ok(map.get(KEY)?.includes("it broke"), "the report is in storage");

  // A new page load, the same storage, a server that answers this time.
  const second = fakeFetch(200);
  const reloaded = makeQueue({ endpoint: "/api/feedback", fetch: second.fetch });
  assert.equal(reloaded.size(), 1, "the report survived the reload");
  await reloaded.flush();
  assert.equal(reloaded.size(), 0);
  assert.equal(second.calls.length, 1);
  assert.equal((second.calls[0]?.body as BugReport).message, "it broke");
  assert.equal(map.get(KEY), undefined, "an empty queue leaves no key behind");
});

test("reports are delivered oldest first", async () => {
  const { fetch, calls } = fakeFetch(200);
  const queue = makeQueue({ endpoint: "/api/feedback", fetch });
  queue.enqueue(report("one"));
  queue.enqueue(report("two"));
  queue.enqueue(report("three"));
  await queue.flush();
  assert.deepEqual(
    calls.map((c) => (c.body as BugReport).message),
    ["one", "two", "three"],
  );
});

test("a 4xx drops the report and a 5xx keeps it", async () => {
  const rejected = fakeFetch(422);
  const dropping = makeQueue({ endpoint: "/api/feedback", fetch: rejected.fetch });
  dropping.enqueue(report("malformed"));
  await dropping.flush();
  assert.equal(dropping.size(), 0, "the server refused it; retrying changes nothing");

  const broken = fakeFetch(503);
  const keeping = makeQueue({ endpoint: "/api/feedback", fetch: broken.fetch });
  keeping.enqueue(report("try again later"));
  await keeping.flush();
  assert.equal(keeping.size(), 1, "a server having a bad day is worth retrying");
});

test("a network error keeps the report and the next flush waits for the backoff", async () => {
  const { fetch, calls } = fakeFetch("network-error");
  const queue = makeQueue({ endpoint: "/api/feedback", fetch });
  queue.enqueue(report("offline"));
  await queue.flush();
  assert.equal(calls.length, 1);
  assert.equal(queue.size(), 1);
  await queue.flush();
  assert.equal(calls.length, 1, "the second flush is inside the first second of backoff");
});

test("two flushes at once send the report once", async () => {
  let inFlight = 0;
  let overlapped = false;
  const calls: string[] = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    inFlight += 1;
    if (inFlight > 1) overlapped = true;
    calls.push(String((JSON.parse(String(init?.body)) as BugReport).message));
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  const queue = makeQueue({ endpoint: "/api/feedback", fetch });
  queue.enqueue(report("once"));
  await Promise.all([queue.flush(), queue.flush(), queue.flush()]);
  assert.equal(overlapped, false, "no two deliveries were in flight together");
  assert.deepEqual(calls, ["once"]);
});

test("only the newest maxEntries reports are kept", () => {
  const queue = makeQueue({
    endpoint: "/api/feedback",
    maxEntries: 2,
    fetch: fakeFetch(503).fetch,
  });
  queue.enqueue(report("one"));
  queue.enqueue(report("two"));
  queue.enqueue(report("three"));
  assert.equal(queue.size(), 2);
});

test("a report older than maxAgeMs is dropped rather than sent", async () => {
  const stale = JSON.stringify([{ at: Date.now() - 10_000, body: report("last week") }]);
  globals["localStorage"] = fakeStorage({ [KEY]: stale }).storage;
  const { fetch, calls } = fakeFetch(200);
  const queue = makeQueue({ endpoint: "/api/feedback", maxAgeMs: 1_000, fetch });
  assert.equal(queue.size(), 0);
  await queue.flush();
  assert.equal(calls.length, 0, "nothing was sent");
});

test("a report whose picture fits keeps it", () => {
  const { storage, map } = fakeStorage();
  globals["localStorage"] = storage;
  const queue = makeQueue({ endpoint: "/api/feedback", fetch: fakeFetch(503).fetch });
  const big = report("the page went white");
  big.screenshotDataUrl = `data:image/png;base64,${"A".repeat(1_100_000)}`;
  queue.enqueue(big);
  assert.equal(queue.size(), 1);
  // Nothing is dropped on a guess about where the quota is. Only the storage
  // knows, and this one had the room.
  const stored = JSON.parse(map.get(KEY) ?? "[]") as { body: BugReport }[];
  assert.equal(stored[0]?.body.screenshotDataUrl, big.screenshotDataUrl, "the picture is there");
  assert.equal(stored[0]?.body.notes, undefined, "and there is nothing to explain");
});

test("a storage that refuses to be written degrades to memory-only", async () => {
  const broken = fakeStorage();
  broken.break();
  globals["localStorage"] = broken.storage;
  const { fetch, calls } = fakeFetch(200);
  const queue = makeQueue({ endpoint: "/api/feedback", fetch });
  queue.enqueue(report("no storage here"));
  assert.equal(queue.size(), 1, "the report is still queued in memory");
  await queue.flush();
  assert.equal(calls.length, 1);
  assert.equal(queue.size(), 0);
});

test("rubbish in the storage key is ignored rather than thrown", () => {
  globals["localStorage"] = fakeStorage({ [KEY]: "{not json" }).storage;
  const queue = makeQueue({ endpoint: "/api/feedback", fetch: fakeFetch(200).fetch });
  assert.equal(queue.size(), 0);

  globals["localStorage"] = fakeStorage({ [KEY]: JSON.stringify(["nonsense", 3, null]) }).storage;
  const second = makeQueue({ endpoint: "/api/feedback", fetch: fakeFetch(200).fetch });
  assert.equal(second.size(), 0, "entries that are not queued reports are skipped");
});

test("a queue flushes what it found in storage without being asked", async () => {
  const waiting = JSON.stringify([{ at: Date.now(), body: report("from last time") }]);
  globals["localStorage"] = fakeStorage({ [KEY]: waiting }).storage;
  const { fetch, calls } = fakeFetch(200);
  const queue = makeQueue({ endpoint: "/api/feedback", fetch });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1, "the flush on init has already happened");
  assert.equal(queue.size(), 0);
});

test("coming back online and returning to the tab both flush", async () => {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const on = (type: string, fn: (event: unknown) => void) => {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  };
  const off = () => {};
  const fire = async (type: string) => {
    for (const fn of listeners.get(type) ?? []) fn({});
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  globals["window"] = { addEventListener: on, removeEventListener: off };
  globals["document"] = { addEventListener: on, removeEventListener: off, visibilityState: "visible" };
  try {
    const { fetch, calls } = fakeFetch("network-error", 200, 200);
    const queue = makeQueue({ endpoint: "/api/feedback", fetch });
    queue.enqueue(report("offline"));
    await queue.flush();
    assert.equal(calls.length, 1, "the first attempt failed");

    // `online` means the network is back, so the remaining backoff is stale.
    await fire("online");
    assert.equal(calls.length, 2);
    assert.equal(queue.size(), 0);

    queue.enqueue(report("second"));
    await fire("visibilitychange");
    assert.equal(calls.length, 3);
    assert.equal(queue.size(), 0);
  } finally {
    delete globals["window"];
    delete globals["document"];
  }
});

/** What is actually in the storage key, in the order it is stored. */
function storedMessages(map: Map<string, string>): string[] {
  const stored = JSON.parse(map.get(KEY) ?? "[]") as { body: BugReport }[];
  return stored.map((item) => String(item.body.message));
}

/**
 * Two tabs on the same origin share one `localStorage` and cannot change it
 * atomically. A queue that read the array once and wrote it back whole lost the
 * other tab's reports, sent the same one twice, and put back reports the other
 * tab had just delivered. Each of the three has a test.
 */
test("two tabs queueing at once keep both reports", () => {
  const { storage, map } = fakeStorage();
  globals["localStorage"] = storage;
  const tabA = makeQueue({ endpoint: "/api/feedback", fetch: fakeFetch(503).fetch });
  const tabB = makeQueue({ endpoint: "/api/feedback", fetch: fakeFetch(503).fetch });

  tabA.enqueue(report("from the first tab"));
  tabB.enqueue(report("from the second tab"));

  assert.deepEqual(storedMessages(map), ["from the first tab", "from the second tab"]);
  assert.equal(tabB.size(), 2, "the second tab merged rather than overwrote");
});

test("two tabs do not deliver the same queued report twice", async () => {
  const waiting = JSON.stringify([{ id: "r1", at: Date.now(), body: report("only once") }]);
  globals["localStorage"] = fakeStorage({ [KEY]: waiting }).storage;
  const first = fakeFetch(200);
  const second = fakeFetch(200);

  // Both tabs load, both find the same report waiting, and both flush on init.
  makeQueue({ endpoint: "/api/feedback", fetch: first.fetch });
  makeQueue({ endpoint: "/api/feedback", fetch: second.fetch });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(
    first.calls.length + second.calls.length,
    1,
    "the claim kept the other tab off a report already going out",
  );
});

test("a report one tab has delivered is not written back by the other", async () => {
  const { storage, map } = fakeStorage();
  globals["localStorage"] = storage;
  const stale = makeQueue({ endpoint: "/api/feedback", fetch: fakeFetch(503).fetch });
  stale.enqueue(report("sent once"));

  const sender = fakeFetch(200);
  const sending = makeQueue({ endpoint: "/api/feedback", fetch: sender.fetch });
  await sending.flush();
  assert.equal(sender.calls.length, 1);
  assert.equal(map.get(KEY), undefined, "delivered, so gone from storage");

  // The other tab still holds the delivered report in its own memory. Nothing
  // it writes afterwards may put it back.
  stale.enqueue(report("written later"));
  assert.deepEqual(storedMessages(map), ["written later"]);
});

test("destroying the queue during a flush stops it retrying for ever", async () => {
  let fail!: () => void;
  const calls: string[] = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    calls.push(String((JSON.parse(String(init?.body)) as BugReport).message));
    await new Promise<void>((resolve) => (fail = resolve));
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof globalThis.fetch;

  const queue = makeQueue({ endpoint: "/api/feedback", fetch });
  queue.enqueue(report("in flight"));
  const flushing = queue.flush();
  // The storage seam may be asynchronous, so a flush reads before it posts and
  // the first request is one turn away rather than in this one.
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The tab is torn down while the POST is still open. The failure that comes
  // back used to schedule a retry, which failed and scheduled the next one.
  const scheduled: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    scheduled.push(Number(ms ?? 0));
    return realSetTimeout(fn, ms);
  }) as unknown as typeof globalThis.setTimeout;
  try {
    queue.destroy();
    fail();
    await flushing;
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }

  assert.deepEqual(scheduled, [], "no retry timer was armed after destroy");
  await queue.flush();
  assert.equal(calls.length, 1, "and nothing else was sent");
});

test("a report delivered while the queue shifted under it is removed by identity", async () => {
  globals["localStorage"] = fakeStorage().storage;
  let deliver!: () => void;
  const sent: string[] = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    sent.push(String((JSON.parse(String(init?.body)) as BugReport).message));
    if (sent.length === 1) await new Promise<void>((resolve) => (deliver = resolve));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  const queue = makeQueue({ endpoint: "/api/feedback", maxEntries: 2, fetch });
  queue.enqueue(report("one"));
  queue.enqueue(report("two"));
  const flushing = queue.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(sent, ["one"]);

  // A third report while the first is still in flight. At maxEntries that evicts
  // the head, so the item at position 0 is no longer the one being delivered —
  // and removing by position would throw away a report nobody has sent.
  queue.enqueue(report("three"));
  deliver();
  await flushing;

  assert.deepEqual(sent, ["one", "two", "three"]);
  assert.equal(queue.size(), 0);
});

test("a storage that reads but refuses writes still delivers what it held", async () => {
  const waiting = JSON.stringify([{ id: "r1", at: Date.now(), body: report("queued yesterday") }]);
  const broken = fakeStorage({ [KEY]: waiting });
  broken.break();
  globals["localStorage"] = broken.storage;
  const { fetch, calls } = fakeFetch(200);

  const queue = makeQueue({ endpoint: "/api/feedback", fetch });
  assert.equal(queue.size(), 1, "a full quota must not hide what is already stored");
  await queue.flush();
  assert.equal(calls.length, 1);
  assert.equal((calls[0]?.body as BugReport).message, "queued yesterday");
  assert.equal(queue.size(), 0);
});

test("a storage that breaks after the queue was made keeps the reports in memory", async () => {
  const broken = fakeStorage();
  globals["localStorage"] = broken.storage;
  const { fetch, calls } = fakeFetch(200);
  const queue = makeQueue({ endpoint: "/api/feedback", fetch });

  queue.enqueue(report("while there was room"));
  broken.break();
  queue.enqueue(report("after the quota filled"));
  queue.enqueue(report("and one more"));
  assert.equal(queue.size(), 3, "storage stopped being the copy that counts");

  await queue.flush();
  assert.deepEqual(
    calls.map((c) => (c.body as BugReport).message),
    ["while there was room", "after the quota filled", "and one more"],
  );
});

test("clear throws the queue away in memory and in storage", () => {
  const { storage, map } = fakeStorage();
  globals["localStorage"] = storage;
  const queue = makeQueue({ endpoint: "/api/feedback", fetch: fakeFetch(503).fetch });
  queue.enqueue(report("never mind"));
  queue.clear();
  assert.equal(queue.size(), 0);
  assert.equal(map.get(KEY), undefined);
});

/**
 * What a full quota costs. Until 0.13 a refused `setItem` turned the queue
 * memory-only and that was the whole of it: the report reached `localStorage`
 * nowhere, so the next page load found nothing — and the outage a report is
 * written during is exactly the kind of thing that ends in a reload.
 */
test("a report refused for its size is stored without the picture, not lost", async () => {
  // A quota one report with a picture fits inside and two do not.
  const { storage, map } = fakeStorage({}, 600_000);
  globals["localStorage"] = storage;
  const queue = makeQueue({ endpoint: "/api/feedback", fetch: fakeFetch(503).fetch });
  const big = report("the page went white");
  big.screenshotDataUrl = `data:image/png;base64,${"A".repeat(400_000)}`;
  queue.enqueue(big);
  assert.ok(map.get(KEY)?.includes("screenshotDataUrl"), "it fitted, picture and all");

  const second = report("and again");
  second.screenshotDataUrl = `data:image/png;base64,${"B".repeat(400_000)}`;
  queue.enqueue(second);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const stored = JSON.parse(map.get(KEY) ?? "[]") as { body: BugReport }[];
  assert.deepEqual(
    stored.map((item) => item.body.message),
    ["the page went white", "and again"],
    "both reports survived the refusal",
  );
  assert.equal(stored[1]?.body.screenshotDataUrl, undefined, "the picture is gone");
  assert.deepEqual(stored[1]?.body.notes, [SCREENSHOT_NOTE], "and it says so");
});

/**
 * The storage is a seam, and `localStorage` is only its default. Everything
 * above is the default; these two are the seam itself, synchronous and not.
 */
test("a storage handed in is used instead of localStorage", () => {
  const { storage: unused, map } = fakeStorage();
  globals["localStorage"] = unused;
  let stored: QueuedReport[] = [];
  const custom: QueueStorage = {
    update(change) {
      stored = change(stored);
      return stored;
    },
  };
  const queue = makeQueue({
    endpoint: "/api/feedback",
    storage: custom,
    fetch: fakeFetch(503).fetch,
  });
  queue.enqueue(report("through the seam"));
  assert.equal(queue.size(), 1);
  assert.equal(stored[0]?.body.message, "through the seam");
  assert.equal(map.size, 0, "localStorage was never touched");
});

test("a storage that answers with promises queues, merges and delivers", async () => {
  let stored: QueuedReport[] = [];
  const slow: QueueStorage = {
    async update(change) {
      // A real asynchronous storage does not answer in the same turn, and a
      // read-modify-write that spans one is where two commits would collide.
      await new Promise((resolve) => setTimeout(resolve, 1));
      stored = change(stored);
      return stored;
    },
  };
  const { fetch, calls } = fakeFetch(200);
  const queue = makeQueue({ endpoint: "/api/feedback", storage: slow, fetch });
  queue.enqueue(report("one"));
  queue.enqueue(report("two"));
  await until(() => stored.length === 2);
  assert.deepEqual(
    stored.map((item) => item.body.message),
    ["one", "two"],
    "the second commit did not overwrite the first",
  );

  await queue.flush();
  assert.deepEqual(
    calls.map((c) => (c.body as BugReport).message),
    ["one", "two"],
  );
  assert.equal(queue.size(), 0);
  assert.deepEqual(stored, []);
});

test("an asynchronous storage that refuses a write drops the picture too", async () => {
  let stored: QueuedReport[] = [];
  const refusing: QueueStorage = {
    async update(change) {
      const next = change(stored);
      if (JSON.stringify(next).length > 200_000) {
        throw new Error("QuotaExceededError");
      }
      stored = next;
      return next;
    },
  };
  const queue = makeQueue({
    endpoint: "/api/feedback",
    storage: refusing,
    fetch: fakeFetch(503).fetch,
  });
  const big = report("the page went white");
  big.screenshotDataUrl = `data:image/png;base64,${"A".repeat(300_000)}`;
  queue.enqueue(big);
  await until(() => stored.length === 1);

  assert.equal(stored.length, 1, "the report was kept");
  assert.equal(stored[0]?.body.screenshotDataUrl, undefined, "without the picture");
  assert.deepEqual(stored[0]?.body.notes, [SCREENSHOT_NOTE]);
});

test("a storage need only implement update", () => {
  // `read` was in the seam and never called: every path through the queue goes
  // through `update`, because it is the one that cannot race. A storage that
  // implements only `update` is a whole storage.
  let stored: QueuedReport[] = [];
  const minimal: QueueStorage = {
    update(change) {
      stored = change(stored);
      return stored;
    },
  };
  const queue = makeQueue({
    endpoint: "/api/feedback",
    storage: minimal,
    fetch: fakeFetch(503).fetch,
  });
  queue.enqueue(report("no read anywhere"));
  assert.equal(queue.size(), 1);
  assert.equal(stored[0]?.body.message, "no read anywhere");
});

/**
 * A fetch that records the headers and the body text of every attempt before
 * handing the call on. The queue signs the serialised body it is about to
 * send, so both halves have to be seen exactly as they left.
 */
function watchHeaders(inner: typeof globalThis.fetch) {
  const seen: { headers: Record<string, string>; body: string }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      headers: { ...(init?.headers as Record<string, string>) },
      body: String(init?.body),
    });
    return inner(url, init);
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const SIGN_KEY = "the-key-your-server-knows";

test("a queued report is delivered with a signature over the bytes that were sent", async () => {
  const { fetch, seen } = watchHeaders(fakeFetch(200).fetch);
  const queue = makeQueue({
    endpoint: "/api/feedback",
    fetch,
    sign: createSigner({ key: SIGN_KEY }),
  });
  queue.enqueue(report("signed on the way out"));
  await queue.flush();

  assert.equal(seen.length, 1);
  const header = seen[0]?.headers[DEFAULT_SIGNATURE_HEADER];
  assert.ok(header, "the queue delivered without a signature header");
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  assert.ok(match, `the header is not in the t=…,v1=… shape: ${header}`);
  // Recomputed over the exact text that was POSTed rather than over a fresh
  // serialisation of the report: that is the whole promise the header makes.
  assert.equal(match[2], await hmacHex(SIGN_KEY, `${match[1]}.${seen[0]?.body}`));
});

test("a retry after the backoff signs again, with a fresh timestamp", async () => {
  // The first attempt fails, the queue's own timer runs the second a second
  // later, and the two headers must differ: a signature minted when the report
  // was written would be outside the server's skew window by the time the
  // network came back, which is every report the queue exists to save.
  const { fetch, seen } = watchHeaders(fakeFetch(503, 200).fetch);
  const queue = makeQueue({
    endpoint: "/api/feedback",
    fetch,
    sign: createSigner({ key: SIGN_KEY }),
  });
  // The retry is armed with the queue's own backoff timer, a second at least.
  // A loaded CI runner has been seen to miss that inside the test's deadline,
  // so the timer is shortened here rather than waited for: what is under test
  // is the signature the retry mints, not the length of the pause before it.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number) =>
    realSetTimeout(fn, Math.min(Number(ms ?? 0), 5))) as unknown as typeof globalThis.setTimeout;
  try {
    queue.enqueue(report("the outage it describes"));
    await queue.flush();
    assert.equal(seen.length, 1);
    await until(() => seen.length === 2, 5_000);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(seen.length, 2, "the backoff retry never ran");
  await until(() => queue.size() === 0);
  assert.equal(queue.size(), 0, "the second attempt was accepted");
  const first = /^t=(\d+),/.exec(seen[0]!.headers[DEFAULT_SIGNATURE_HEADER]!)?.[1];
  const retry = seen[1]!.headers[DEFAULT_SIGNATURE_HEADER]!;
  const second = /^t=(\d+),/.exec(retry)?.[1];
  assert.ok(Number(second) > Number(first), "the retry reused the first attempt's timestamp");
  // And the retry's signature is valid for its own timestamp, not merely new.
  assert.equal(retry, await computeSignature(SIGN_KEY, seen[1]!.body, Number(second)));
});

test("a queue without a signer sends no signature header", async () => {
  const { fetch, seen } = watchHeaders(fakeFetch(200).fetch);
  const queue = makeQueue({ endpoint: "/api/feedback", fetch });
  queue.enqueue(report("unsigned, as before"));
  await queue.flush();
  assert.equal(seen[0]?.headers[DEFAULT_SIGNATURE_HEADER], undefined);
  assert.equal(seen[0]?.headers["Content-Type"], "application/json");
});
