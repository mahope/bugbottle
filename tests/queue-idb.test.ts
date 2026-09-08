import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "../src/queue.ts";
import { createIdbStorage } from "../src/queue-idb.ts";
import type { BugReport } from "../src/report-core.ts";

/**
 * IndexedDB, small enough to keep in this file.
 *
 * Node has no IndexedDB and `fake-indexeddb` is a dependency this package is
 * not going to take for one object store with one key in it. What the storage
 * actually needs is narrow: `open` with an upgrade, a transaction that hands
 * out `get`/`put`/`delete`, and — the part that matters — transactions that
 * run one at a time in the order they were asked for, which is what the real
 * thing guarantees per database and what makes the multi-tab claim work.
 *
 * The one liberty taken: a transaction here completes on a macrotask after its
 * last request, rather than when control returns to the event loop. Everything
 * the storage does between two requests is a microtask, so the difference is
 * invisible to it and the fake cannot commit early by accident.
 */
type FakeRequest = {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
  onblocked?: (() => void) | null;
};

function fakeIndexedDB(options: { quota?: number } = {}) {
  const stores = new Map<string, Map<unknown, unknown>>();
  /** How many bytes the whole database may hold. Refused writes abort the tx. */
  const quota = options.quota ?? Infinity;
  /** Transactions run one at a time, in the order they were opened. */
  let chain: Promise<void> = Promise.resolve();
  let transactions = 0;

  const request = (): FakeRequest => ({
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  });

  const size = (): number => {
    // Stringifying a two-megabyte report on every write would make the tests
    // slower than the thing they test, and only a finite quota needs the sum.
    if (quota === Infinity) return 0;
    let bytes = 0;
    for (const store of stores.values()) {
      for (const value of store.values()) bytes += JSON.stringify(value).length;
    }
    return bytes;
  };

  function transaction(name: string, _mode: string) {
    transactions += 1;
    const store = stores.get(name);
    if (!store) throw new Error(`No object store named ${name}`);
    let pending = 0;
    let settled = false;
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const turn = chain;
    chain = chain.then(() => mine);

    const tx: {
      error: unknown;
      oncomplete: (() => void) | null;
      onerror: (() => void) | null;
      onabort: (() => void) | null;
      objectStore: () => unknown;
    } = { error: null, oncomplete: null, onerror: null, onabort: null, objectStore: () => api };

    const settle = (): void => {
      if (settled || pending > 0) return;
      settled = true;
      tx.oncomplete?.();
      release();
    };
    const abort = (error: unknown): void => {
      if (settled) return;
      settled = true;
      tx.error = error;
      tx.onabort?.();
      release();
    };

    const run = (work: () => unknown): FakeRequest => {
      const req = request();
      pending += 1;
      void turn.then(() => {
        if (settled) return;
        try {
          req.result = work();
          req.onsuccess?.();
        } catch (error) {
          req.error = error;
          req.onerror?.();
          pending -= 1;
          abort(error);
          return;
        }
        pending -= 1;
        setTimeout(settle, 0);
      });
      return req;
    };

    const api = {
      get: (key: unknown) => run(() => store.get(key)),
      delete: (key: unknown) => run(() => void store.delete(key)),
      put: (value: unknown, key: unknown) =>
        run(() => {
          const before = store.get(key);
          store.set(key, value);
          if (size() > quota) {
            if (before === undefined) store.delete(key);
            else store.set(key, before);
            throw new Error("QuotaExceededError");
          }
        }),
    };
    return tx;
  }

  const factory = {
    open(_name: string, _version: number) {
      const req = request() as FakeRequest & { result: unknown };
      const db = {
        objectStoreNames: { contains: (name: string) => stores.has(name) },
        createObjectStore: (name: string) => void stores.set(name, new Map()),
        transaction,
      };
      req.result = db;
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };

  /**
   * Resolves once no new transaction has been asked for in a whole tick. The
   * queue reads, claims, posts and deletes in a chain of them, so waiting for
   * a fixed number of milliseconds is what makes a test like this flaky.
   */
  const idle = async (): Promise<void> => {
    for (let i = 0; i < 500; i += 1) {
      const before = transactions;
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (transactions === before) return;
    }
  };

  return { factory, stores, idle };
}

const globals = globalThis as unknown as Record<string, unknown>;
const KEY = "bugbottle:queue";
const STORE = "queue";

function report(message: string): BugReport & Record<string, unknown> {
  return {
    type: "bug",
    message,
    context: { url: "/orders", viewport: "800x600", userAgent: "test" },
  };
}

/** A fetch stand-in answering with the given statuses in order, then the last. */
function fakeFetch(...statuses: number[]) {
  const calls: { body: BugReport }[] = [];
  let i = 0;
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const status = statuses[Math.min(i, statuses.length - 1)] ?? 200;
    i += 1;
    calls.push({ body: JSON.parse(String(init?.body ?? "null")) as BugReport });
    return new Response("{}", { status });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** Waits for a condition rather than for a number of milliseconds. */
async function until(done: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

const made: { destroy(): void }[] = [];
function makeQueue(options: Parameters<typeof createQueue>[0]) {
  const queue = createQueue(options);
  made.push(queue);
  return queue;
}

beforeEach(() => {
  for (const queue of made.splice(0)) queue.destroy();
  delete globals["indexedDB"];
});

test("a two-megabyte report goes in with its picture and comes back out with it", async () => {
  const { factory, stores, idle } = fakeIndexedDB();
  globals["indexedDB"] = factory;

  const big = report("the page went white");
  // Two megabytes, which is the ceiling `MAX_SCREENSHOT_BYTES` puts on a
  // picture and about four times what a `localStorage` origin has to spare.
  big.screenshotDataUrl = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024)}`;

  const filing = makeQueue({
    endpoint: "/api/feedback",
    storage: createIdbStorage(),
    fetch: fakeFetch(503).fetch,
  });
  filing.enqueue(big);
  await idle();

  const stored = stores.get(STORE)?.get(KEY) as { body: BugReport }[];
  assert.equal(stored.length, 1, "it is in the database");
  assert.equal(stored[0]?.body.screenshotDataUrl, big.screenshotDataUrl, "picture and all");
  assert.equal(stored[0]?.body.notes, undefined, "so there is nothing to explain");

  // A new page load, the same database, a server that answers this time.
  const { fetch, calls } = fakeFetch(200);
  const reloaded = makeQueue({ endpoint: "/api/feedback", storage: createIdbStorage(), fetch });
  await idle();
  await reloaded.flush();
  await idle();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body.message, "the page went white");
  assert.equal(calls[0]?.body.screenshotDataUrl, big.screenshotDataUrl, "the picture survived");
  assert.equal(reloaded.size(), 0);
  assert.equal(stores.get(STORE)?.get(KEY), undefined, "an empty queue leaves no key behind");
});

test("two tabs on one database do not deliver the same report twice", async () => {
  const { factory, stores, idle } = fakeIndexedDB();
  globals["indexedDB"] = factory;

  // One report already waiting, exactly as a reload would find it.
  stores.set(STORE, new Map([[KEY, [{ id: "r1", at: Date.now(), body: report("only once") }]]]));

  const first = fakeFetch(200);
  const second = fakeFetch(200);
  // Both tabs load at the same moment and both flush on init. The claim is
  // written inside the same read-write transaction that reads it, so whichever
  // transaction the database runs second sees the other's claim.
  const tabA = makeQueue({
    endpoint: "/api/feedback",
    storage: createIdbStorage(),
    fetch: first.fetch,
  });
  const tabB = makeQueue({
    endpoint: "/api/feedback",
    storage: createIdbStorage(),
    fetch: second.fetch,
  });
  await Promise.all([tabA.flush(), tabB.flush()]);
  await idle();

  assert.equal(
    first.calls.length + second.calls.length,
    1,
    "the claim kept the other tab off a report already going out",
  );
  assert.equal(stores.get(STORE)?.get(KEY), undefined, "and it was delivered, not left behind");
});

test("two tabs queueing at once keep both reports", async () => {
  const { factory, stores, idle } = fakeIndexedDB();
  globals["indexedDB"] = factory;
  const tabA = makeQueue({
    endpoint: "/api/feedback",
    storage: createIdbStorage(),
    fetch: fakeFetch(503).fetch,
  });
  const tabB = makeQueue({
    endpoint: "/api/feedback",
    storage: createIdbStorage(),
    fetch: fakeFetch(503).fetch,
  });

  tabA.enqueue(report("from the first tab"));
  tabB.enqueue(report("from the second tab"));
  await idle();

  const stored = (stores.get(STORE)?.get(KEY) ?? []) as { body: BugReport }[];
  assert.deepEqual(
    stored.map((item) => item.body.message),
    ["from the first tab", "from the second tab"],
    "the second tab merged rather than overwrote",
  );
});

test("a database with no room drops the picture rather than the report", async () => {
  const { factory, stores, idle } = fakeIndexedDB({ quota: 100_000 });
  globals["indexedDB"] = factory;
  const queue = makeQueue({
    endpoint: "/api/feedback",
    storage: createIdbStorage(),
    fetch: fakeFetch(503).fetch,
  });
  const big = report("the page went white");
  big.screenshotDataUrl = `data:image/png;base64,${"A".repeat(200_000)}`;
  queue.enqueue(big);
  await idle();

  const stored = (stores.get(STORE)?.get(KEY) ?? []) as { body: BugReport }[];
  assert.equal(stored.length, 1, "the report was kept");
  assert.equal(stored[0]?.body.message, "the page went white");
  assert.equal(stored[0]?.body.screenshotDataUrl, undefined, "the picture was not");
  assert.deepEqual(stored[0]?.body.notes, [
    "Screenshot dropped: it did not fit in the offline queue.",
  ]);
});

test("a browser without IndexedDB keeps the reports in memory and still sends them", async () => {
  const { fetch, calls } = fakeFetch(200);
  const queue = makeQueue({ endpoint: "/api/feedback", storage: createIdbStorage(), fetch });
  queue.enqueue(report("nowhere to put it"));
  await until(() => queue.size() === 1);
  assert.equal(queue.size(), 1, "memory is the only copy there is");

  await queue.flush();
  await until(() => calls.length === 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.body.message, "nowhere to put it");
  assert.equal(queue.size(), 0);
});
