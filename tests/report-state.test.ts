import { test } from "node:test";
import assert from "node:assert/strict";
import { createReportState } from "../src/report-state.ts";
import { createQueue, type QueuedReport } from "../src/queue.ts";

for (const outcome of ["sent", "queued", "error"] as const) {
  test(`overlapping submissions share one ${outcome} attempt and allow another`, async (t) => {
    let resolveFetch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetch = t.mock.method(globalThis, "fetch", () => pending);
    let sent = 0;
    const queued: unknown[] = [];
    const form = createReportState({
      endpoint: "/reports",
      onSent: () => { sent++; },
      queue: outcome === "queued" ? {
        enqueue: (report) => { queued.push(report); },
        flush: async () => 0,
        size: () => queued.length,
        clear() {},
        destroy() {},
      } : undefined,
    });
    t.after(() => form.destroy());
    form.actions.setMessage("first report");
    const first = form.actions.submit();
    const second = form.actions.submit();
    resolveFetch(new Response("{}", { status: outcome === "sent" ? 200 : 503 }));
    assert.deepEqual(await Promise.all([first, second]), [outcome !== "error", outcome !== "error"]);
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(first, second);
    assert.equal(sent, outcome === "sent" ? 1 : 0);
    assert.equal(queued.length, outcome === "queued" ? 1 : 0);
    assert.equal(form.getState().status.kind, outcome);

    fetch.mock.mockImplementation(async () => new Response("{}"));
    form.actions.setMessage("next report");
    assert.equal(await form.actions.submit(), true);
    assert.equal(fetch.mock.callCount(), 2);
    assert.equal(sent, outcome === "sent" ? 2 : 1);
    assert.equal(queued.length, outcome === "queued" ? 1 : 0);
  });
}

for (const status of [429, 400, 401, 403]) {
  test(`initial ${status} ${status === 429 ? "queues" : "rejects"} the report`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("{}", { status }));
    const queued: unknown[] = [];
    const form = createReportState({
      endpoint: "/reports",
      queue: {
        enqueue: (report) => { queued.push(report); },
        flush: async () => 0,
        size: () => queued.length,
        clear() {},
        destroy() {},
      },
    });
    t.after(() => form.destroy());
    form.actions.setMessage("test report");
    assert.equal(await form.actions.submit(), status === 429);
    assert.equal(form.getState().status.kind, status === 429 ? "queued" : "error");
    assert.equal(queued.length, status === 429 ? 1 : 0);
  });
}

test("an async beforeSend copy survives storage and retry without running twice", async (t) => {
  let stored = "[]";
  const storage = {
    update(change: (items: QueuedReport[]) => QueuedReport[]) {
      const items = change(JSON.parse(stored));
      stored = JSON.stringify(items);
      return items;
    },
  };
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    requests.push(String(init?.body));
    if (requests.length === 1) throw new TypeError("Failed to fetch");
    return new Response("{}", { status: 200 });
  };
  t.mock.method(globalThis, "fetch", fetch);
  const queue = createQueue({ endpoint: "/reports", storage, fetch });
  t.after(() => queue.destroy());
  await queue.flush();
  let calls = 0;
  const form = createReportState({
    endpoint: "/reports",
    queue,
    beforeSend: async (report) => {
      await Promise.resolve();
      calls++;
      return { ...report, message: `redacted ${calls}` };
    },
  });
  form.actions.setMessage("original test message");
  assert.equal(await form.actions.submit(), true);
  assert.equal(form.getState().status.kind, "queued");
  assert.equal(JSON.parse(stored)[0].body.message, "redacted 1");
  assert.equal(stored.includes("original test message"), false);
  queue.destroy();
  const reloaded = createQueue({ endpoint: "/reports", storage, fetch });
  t.after(() => reloaded.destroy());
  assert.equal(await reloaded.flush(), 0);
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
  assert.equal(requests[1]!.includes("original test message"), false);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(stored), []);
});

for (const decision of ["cancel", "throw", "timeout"] as const) {
  test(`beforeSend ${decision} neither sends nor queues the original report`, async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => new Response("{}"));
    let queued = 0;
    const form = createReportState({
      endpoint: "/reports",
      timeoutMs: decision === "timeout" ? 10 : 1000,
      queue: {
        enqueue: () => { queued++; },
        flush: async () => 0,
        size: () => queued,
        clear() {},
        destroy() {},
      },
      beforeSend: async () => {
        if (decision === "throw") throw new Error("Hook failed");
        if (decision === "timeout") return new Promise(() => {});
        return null;
      },
    });
    form.actions.setMessage("original test message");
    assert.equal(await form.actions.submit(), decision === "cancel");
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(queued, 0);
  });
}
