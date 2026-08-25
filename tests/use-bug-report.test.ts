import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useBugReport, type UseBugReportOptions } from "../src/react/use-bug-report.ts";

// Tells React this environment drives updates through `act()`, so state
// updates are flushed synchronously instead of warning about un-batched work.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A minimal `renderHook`: mounts the hook inside a component that stores its
 * latest return value in a closure, so tests can read and act on it without
 * needing a DOM. `react-test-renderer` renders to an in-memory tree rather
 * than a browser, which is all a headless hook needs.
 */
function renderHook<T>(hook: () => T) {
  let latest: T;
  function Probe() {
    latest = hook();
    return null;
  }
  act(() => {
    create(createElement(Probe));
  });
  return {
    get current(): T {
      return latest;
    },
  };
}

type FetchCall = { input: RequestInfo | URL; init: RequestInit | undefined };

function stubFetch(impl: (call: FetchCall) => Promise<Partial<Response> & { ok: boolean }>) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return impl({ input, init });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const baseOptions: UseBugReportOptions = { endpoint: "/api/feedback" };

test("an empty message is refused without a network call", async () => {
  const fetchStub = stubFetch(() => {
    throw new Error("fetch must not be called for an empty message");
  });
  try {
    const hook = renderHook(() => useBugReport(baseOptions));
    let sent: boolean | undefined;
    await act(async () => {
      sent = await hook.current.submit();
    });
    assert.equal(sent, false);
    assert.equal(hook.current.status.kind, "error");
    assert.equal((hook.current.status as { reason?: string }).reason, "empty");
    assert.equal(fetchStub.calls.length, 0);
  } finally {
    fetchStub.restore();
  }
});

test("a successful submit clears the message and reports sent", async () => {
  const fetchStub = stubFetch(async () => ({
    ok: true,
    json: async () => ({ id: "report_1" }),
  }));
  try {
    // No screenshot in play, so no browser environment is required.
    const hook = renderHook(() =>
      useBugReport({ ...baseOptions, screenshotFor: () => false }),
    );
    act(() => hook.current.setMessage("the save button does nothing"));

    let sent: boolean | undefined;
    await act(async () => {
      sent = await hook.current.submit();
    });

    assert.equal(sent, true);
    assert.equal(hook.current.status.kind, "sent");
    assert.equal((hook.current.status as { id?: string }).id, "report_1");
    assert.equal(hook.current.message, "");
    assert.equal(fetchStub.calls.length, 1);
  } finally {
    fetchStub.restore();
  }
});

test("a failed response surfaces the server's error text", async () => {
  const fetchStub = stubFetch(async () => ({
    ok: false,
    json: async () => ({ error: "Message is too long" }),
  }));
  try {
    const hook = renderHook(() =>
      useBugReport({ ...baseOptions, screenshotFor: () => false }),
    );
    act(() => hook.current.setMessage("x".repeat(10_000)));

    let sent: boolean | undefined;
    await act(async () => {
      sent = await hook.current.submit();
    });

    assert.equal(sent, false);
    assert.equal(hook.current.status.kind, "error");
    assert.equal((hook.current.status as { reason?: string }).reason, "send-failed");
    assert.equal((hook.current.status as { message?: string }).message, "Message is too long");
    // The message survives a failed send so the reporter does not retype it.
    assert.equal(hook.current.message, "x".repeat(10_000));
  } finally {
    fetchStub.restore();
  }
});

test("a screenshot failure turns the attachment off but leaves the message intact and submittable", async () => {
  const fetchStub = stubFetch(async () => ({
    ok: true,
    json: async () => ({ id: "report_2" }),
  }));
  try {
    // Default options arm the screenshot for "bug" reports. There is no
    // document in this test environment, so captureScreenshot() rejects —
    // exercising the same failure path a real capture error would.
    const hook = renderHook(() => useBugReport(baseOptions));
    act(() => hook.current.setMessage("the save button does nothing"));

    await act(async () => {
      hook.current.open();
    });

    assert.equal(hook.current.status.kind, "error");
    assert.equal((hook.current.status as { reason?: string }).reason, "screenshot-failed");
    assert.equal(hook.current.includeScreenshot, false, "the attachment is turned off");
    assert.equal(hook.current.message, "the save button does nothing", "the message is untouched");

    let sent: boolean | undefined;
    await act(async () => {
      sent = await hook.current.submit();
    });
    assert.equal(sent, true, "the report is still submittable after a screenshot failure");
    assert.equal(hook.current.status.kind, "sent");
  } finally {
    fetchStub.restore();
  }
});
