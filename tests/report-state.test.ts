import { test } from "node:test";
import assert from "node:assert/strict";
import { createReportState } from "../src/report-state.ts";
import { createQueue, type QueuedReport } from "../src/queue.ts";

for (const withQueue of [true, false]) {
  test(`onSent throwing preserves successful delivery ${withQueue ? "with" : "without"} a queue`, async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () =>
      new Response(JSON.stringify({ id: "report-131" }), { status: 201 }));
    const error = new Error("Host callback failed");
    const logged = t.mock.method(console, "error", () => {});
    const queued: unknown[] = [];
    const onSent = t.mock.fn((id: string | undefined) => {
      assert.equal(id, "report-131");
      throw error;
    });
    const form = createReportState({
      endpoint: "/reports",
      onSent,
      queue: withQueue ? {
        enqueue: (report) => { queued.push(report); },
        flush: async () => 0,
        size: () => queued.length,
        clear() {},
        destroy() {},
      } : undefined,
    });
    t.after(() => form.destroy());
    form.actions.setMessage("test report");
    form.actions.setContact("test contact");
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    form.actions.attachScreenshot({
      dataUrl: "data:image/png;base64,dGVzdA==",
      region: { mode: "element", rect, viewport: rect, selector: "#test" },
      element: { selector: "#test", tag: "button", text: "Test", rect, attributes: {} },
    });
    assert.equal(await form.actions.submit(), true);
    assert.deepEqual(form.getState().status, { kind: "sent", id: "report-131" });
    assert.equal(form.getState().message, "");
    assert.equal(form.getState().contact, "");
    assert.equal(form.getState().screenshot, null);
    assert.equal(form.getState().screenshotRegion, null);
    assert.deepEqual(form.getState().elements, []);
    assert.equal(queued.length, 0);
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(onSent.mock.callCount(), 1);
    assert.deepEqual(logged.mock.calls.map((call) => call.arguments), [[error]]);
  });
}

test("a throwing console logger cannot fail a delivered report", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 201 }));
  t.mock.method(console, "error", () => { throw new Error("Logger failed"); });
  const form = createReportState({
    endpoint: "/reports",
    onSent: () => { throw new Error("Host callback failed"); },
  });
  t.after(() => form.destroy());
  form.actions.setMessage("test report");
  assert.equal(await form.actions.submit(), true);
  assert.equal(form.getState().status.kind, "sent");
  assert.equal(form.getState().message, "");
});

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

for (const lifecycle of ["reset", "destroy"] as const) {
  for (const outcome of ["success", "failure", "queued"] as const) {
    test(`late ${outcome} after ${lifecycle} preserves the replacement draft`, async (t) => {
      let resolve!: (response: Response) => void;
      let reject!: (error: Error) => void;
      const response = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
      t.mock.method(globalThis, "fetch", () => response);
      const queued: unknown[] = [];
      let sent = 0;
      const form = createReportState({
        endpoint: "/reports",
        onSent: () => { sent++; },
        queue: outcome === "queued" ? {
          enqueue: (report) => { queued.push(report); },
          flush: async () => 0, size: () => queued.length, clear() {}, destroy() {},
        } : undefined,
      });
      form.actions.setMessage("draft A");
      form.actions.setContact("contact A");
      const submission = form.actions.submit();
      if (lifecycle === "reset") form.actions.reset();
      else form.destroy();
      form.actions.setMessage("draft B");
      form.actions.setContact("contact B");
      form.actions.attachScreenshot({
        dataUrl: "data:image/png;base64,Yg==",
        region: { mode: "area", rect: { x: 1, y: 2, width: 3, height: 4 },
          viewport: { x: 1, y: 2, width: 3, height: 4 } },
        element: { selector: "#replacement", tag: "button", text: "Replacement",
          rect: { x: 1, y: 2, width: 3, height: 4 }, attributes: {} },
      });
      const replacement = form.getState();
      let notifications = 0;
      form.subscribe(() => { notifications++; });
      if (outcome === "success") resolve(new Response('{"id":"original-id"}'));
      else reject(new TypeError("Failed to fetch"));
      assert.equal(await submission, outcome !== "failure");
      assert.deepEqual(form.getState(), replacement);
      assert.equal(notifications, 0);
      assert.equal(sent, 0);
      assert.equal(queued.length, outcome === "queued" ? 1 : 0);
      if (outcome === "queued") {
        assert.equal((queued[0] as { message: string }).message, "draft A");
        assert.equal((queued[0] as { contact: string }).contact, "contact A");
      }
    });
  }
}

for (const lifecycle of ["reset", "destroy"] as const) {
  test(`a new submission after ${lifecycle} stays coalesced when the old one finishes`, async (t) => {
    const responses: ((response: Response) => void)[] = [];
    const fetch = t.mock.method(globalThis, "fetch", () =>
      new Promise<Response>((resolve) => { responses.push(resolve); }));
    const form = createReportState({ endpoint: "/reports" });
    t.after(() => form.destroy());
    form.actions.setMessage("draft A");
    const first = form.actions.submit();
    if (lifecycle === "reset") form.actions.reset();
    else form.destroy();
    form.actions.setMessage("draft B");
    const second = form.actions.submit();
    assert.notEqual(first, second);
    assert.equal(fetch.mock.callCount(), 2);
    responses[0]!(new Response("{}"));
    assert.equal(await first, true);
    assert.equal(form.getState().message, "draft B");
    assert.equal(form.getState().status.kind, "sending");
    assert.equal(form.actions.submit(), second);
    assert.equal(fetch.mock.callCount(), 2);
    responses[1]!(new Response("{}"));
    assert.equal(await second, true);
    assert.equal(form.getState().message, "");
    assert.equal(form.getState().status.kind, "sent");
  });
}
