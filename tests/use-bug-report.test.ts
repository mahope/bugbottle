import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { enMessages } from "../src/locales.ts";
import type { ScreenshotRenderer } from "../src/capture.ts";

/**
 * The hook is the one module in the library that needs both React and a DOM,
 * and `node:test` gives us neither. So this file — and only this file — puts a
 * happy-dom window on `globalThis` before React is loaded, then pulls the hook
 * in dynamically. Registering the DOM here rather than in a shared setup keeps
 * every other test file running against the bare Node globals it expects.
 */
const win = new Window({ url: "https://example.test/orders?tab=open" });
const globals = globalThis as unknown as Record<string, unknown>;

// Node already owns names such as `fetch`, `setTimeout` and `console`, and
// happy-dom's versions of those would fight the test runner. Only the DOM
// names Node lacks are copied, plus the handful React and the element picker
// look up by identity (`e.target instanceof Element` needs *this* Element).
const forced = new Set([
  "window",
  "document",
  "navigator",
  "location",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "Element",
  "HTMLElement",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "PointerEvent",
  "DocumentFragment",
  "MutationObserver",
]);
for (const key of Object.getOwnPropertyNames(win)) {
  if (key.startsWith("_")) continue;
  if (!forced.has(key) && key in globals) continue;
  try {
    globals[key] = (win as unknown as Record<string, unknown>)[key];
  } catch {
    // A few properties are getter-only on the window; none of them matter here.
  }
}
globals["IS_REACT_ACT_ENVIRONMENT"] = true;

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useBugReport } = await import("../src/react/use-bug-report.ts");

const ENDPOINT = "https://example.test/api/bug-reports";
const PNG = "data:image/png;base64,AAAA";

/** A renderer that never touches a canvas, and counts how often it was asked. */
function fakeRenderer(dataUrl = PNG) {
  let calls = 0;
  const render: ScreenshotRenderer = async () => {
    calls += 1;
    return dataUrl;
  };
  return {
    render,
    get calls() {
      return calls;
    },
  };
}

/** Replaces the global `fetch` for one test and restores it afterwards. */
function stubFetch(reply: (url: string, init: RequestInit) => Response) {
  const original = globalThis.fetch;
  const seen: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    return reply(url, init);
  }) as typeof globalThis.fetch;
  return {
    seen,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("the form starts empty, idle and on the initial type", () => {
  const { result, unmount } = renderHook(() => useBugReport({ endpoint: ENDPOINT }));
  assert.equal(result.current.type, "bug");
  assert.equal(result.current.message, "");
  assert.deepEqual(result.current.status, { kind: "idle" });
  assert.deepEqual(result.current.elements, []);
  assert.equal(result.current.screenshot, null);
  assert.equal(result.current.isSending, false);
  assert.equal(result.current.statusMessage, "");
  unmount();
  cleanup();
});

test("without a renderer the screenshot is off and opening captures nothing", async () => {
  const { result, unmount } = renderHook(() => useBugReport({ endpoint: ENDPOINT }));
  assert.equal(result.current.canScreenshot, false);
  assert.equal(result.current.includeScreenshot, false);

  await act(async () => {
    result.current.open();
  });
  assert.equal(result.current.screenshot, null);
  assert.deepEqual(result.current.status, { kind: "idle" });

  // Toggling it on is a no-op too, so a form that forgot to hide the checkbox
  // cannot put the hook into a state it can never leave.
  await act(async () => {
    result.current.toggleScreenshot(true);
  });
  assert.equal(result.current.includeScreenshot, false);
  assert.equal(result.current.screenshot, null);
  unmount();
  cleanup();
});

test("with a renderer, opening the form takes the picture", async () => {
  const renderer = fakeRenderer();
  const { result, unmount } = renderHook(() =>
    useBugReport({ endpoint: ENDPOINT, screenshot: renderer.render }),
  );
  assert.equal(result.current.canScreenshot, true);
  assert.equal(result.current.includeScreenshot, true);
  assert.equal(result.current.screenshot, null);

  await act(async () => {
    result.current.open();
  });
  assert.equal(renderer.calls, 1);
  assert.equal(result.current.screenshot, PNG);
  assert.deepEqual(result.current.status, { kind: "idle" });
  unmount();
  cleanup();
});

test("turning the screenshot off throws the picture away", async () => {
  const renderer = fakeRenderer();
  const { result, unmount } = renderHook(() =>
    useBugReport({ endpoint: ENDPOINT, screenshot: renderer.render }),
  );
  await act(async () => {
    result.current.open();
  });
  assert.equal(result.current.screenshot, PNG);

  await act(async () => {
    result.current.toggleScreenshot(false);
  });
  assert.equal(result.current.includeScreenshot, false);
  assert.equal(result.current.screenshot, null);
  unmount();
  cleanup();
});

test("switching to a type that is not a bug does not arm the screenshot", async () => {
  const renderer = fakeRenderer();
  const { result, unmount } = renderHook(() =>
    useBugReport({ endpoint: ENDPOINT, screenshot: renderer.render }),
  );
  await act(async () => {
    result.current.toggleScreenshot(false);
  });
  assert.equal(renderer.calls, 0);

  await act(async () => {
    result.current.setType("idea");
  });
  assert.equal(result.current.type, "idea");
  assert.equal(result.current.includeScreenshot, false);
  assert.equal(result.current.screenshot, null);
  assert.equal(renderer.calls, 0);

  // Back on a bug the default does arm it again, which is what makes the
  // assertion above about the type and not about the toggle being sticky.
  await act(async () => {
    result.current.setType("bug");
  });
  assert.equal(result.current.includeScreenshot, true);
  assert.equal(result.current.screenshot, PNG);
  assert.equal(renderer.calls, 1);
  unmount();
  cleanup();
});

test("submitting an empty message is refused before any request", async () => {
  const fetchStub = stubFetch(() => json({ id: "never" }));
  const { result, unmount } = renderHook(() => useBugReport({ endpoint: ENDPOINT }));

  let sent: boolean | undefined;
  await act(async () => {
    result.current.setMessage("   ");
  });
  await act(async () => {
    sent = await result.current.submit();
  });
  assert.equal(sent, false);
  assert.deepEqual(result.current.status, {
    kind: "error",
    reason: "empty",
    message: enMessages.empty,
  });
  assert.equal(result.current.statusMessage, enMessages.empty);
  assert.equal(fetchStub.seen.length, 0);
  fetchStub.restore();
  unmount();
  cleanup();
});

test("a successful submit reports the id, clears the form and calls onSent", async () => {
  const fetchStub = stubFetch(() => json({ id: "rep_42" }));
  const seenIds: (string | undefined)[] = [];
  const { result, unmount } = renderHook(() =>
    useBugReport({
      endpoint: ENDPOINT,
      extra: { appVersion: "1.2.3" },
      onSent: (id) => seenIds.push(id),
    }),
  );

  await act(async () => {
    result.current.setMessage("The save button does nothing");
  });
  let sent: boolean | undefined;
  await act(async () => {
    sent = await result.current.submit();
  });

  assert.equal(sent, true);
  assert.deepEqual(result.current.status, { kind: "sent", id: "rep_42" });
  assert.equal(result.current.statusMessage, enMessages.sent);
  assert.equal(result.current.message, "");
  assert.deepEqual(seenIds, ["rep_42"]);

  assert.equal(fetchStub.seen.length, 1);
  const posted = fetchStub.seen[0];
  assert.equal(posted?.url, ENDPOINT);
  const body = posted?.body as Record<string, unknown>;
  assert.equal(body["type"], "bug");
  assert.equal(body["message"], "The save button does nothing");
  assert.equal(body["appVersion"], "1.2.3");
  fetchStub.restore();
  unmount();
  cleanup();
});

test("a rejected report surfaces the server's own message", async () => {
  const fetchStub = stubFetch(() => json({ error: "Reports are closed for this project" }, 500));
  const { result, unmount } = renderHook(() => useBugReport({ endpoint: ENDPOINT }));

  await act(async () => {
    result.current.setMessage("Something is wrong");
  });
  let sent: boolean | undefined;
  await act(async () => {
    sent = await result.current.submit();
  });

  assert.equal(sent, false);
  assert.deepEqual(result.current.status, {
    kind: "error",
    reason: "send-failed",
    message: "Reports are closed for this project",
  });
  // The message the reporter typed survives a failure, so they can try again.
  assert.equal(result.current.message, "Something is wrong");
  fetchStub.restore();
  unmount();
  cleanup();
});

test("a report dropped by beforeSend still thanks the reporter", async () => {
  const fetchStub = stubFetch(() => json({ id: "never" }));
  const { result, unmount } = renderHook(() =>
    useBugReport({ endpoint: ENDPOINT, beforeSend: () => null }),
  );

  await act(async () => {
    result.current.setMessage("Nothing to see here");
  });
  let sent: boolean | undefined;
  await act(async () => {
    sent = await result.current.submit();
  });

  assert.equal(sent, true);
  assert.deepEqual(result.current.status, { kind: "sent", id: undefined });
  assert.equal(result.current.message, "");
  assert.equal(fetchStub.seen.length, 0);
  fetchStub.restore();
  unmount();
  cleanup();
});

test("reset clears the message, the picture and the status", async () => {
  const renderer = fakeRenderer();
  const fetchStub = stubFetch(() => json({ error: "nope" }, 500));
  const { result, unmount } = renderHook(() =>
    useBugReport({ endpoint: ENDPOINT, screenshot: renderer.render }),
  );

  await act(async () => {
    result.current.open();
    result.current.setMessage("Half a report");
  });
  await act(async () => {
    result.current.setType("idea");
  });
  await act(async () => {
    await result.current.submit();
  });
  assert.equal(result.current.status.kind, "error");

  await act(async () => {
    result.current.reset();
  });
  assert.equal(result.current.type, "bug");
  assert.equal(result.current.message, "");
  assert.equal(result.current.screenshot, null);
  assert.deepEqual(result.current.elements, []);
  assert.equal(result.current.includeScreenshot, true);
  assert.deepEqual(result.current.status, { kind: "idle" });
  fetchStub.restore();
  unmount();
  cleanup();
});

test("picking an element attaches it and swallows the click", async () => {
  const target = win.document.createElement("button");
  target.id = "save-order";
  target.textContent = "Save";
  win.document.body.appendChild(target);

  const heard: string[] = [];
  const listener = () => heard.push("click");
  win.document.addEventListener("click", listener);

  const { result, unmount } = renderHook(() => useBugReport({ endpoint: ENDPOINT }));

  let picked: unknown;
  await act(async () => {
    const pending = result.current.pickElement();
    target.dispatchEvent(
      new win.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    picked = await pending;
  });

  assert.deepEqual(heard, [], "the pick swallows the click it is listening for");
  assert.equal(result.current.elements.length, 1);
  assert.equal(result.current.elements[0]?.tag, "button");
  assert.equal(result.current.elements[0]?.selector, "button#save-order");
  assert.equal((picked as { tag: string }).tag, "button");
  assert.deepEqual(result.current.status, { kind: "idle" });

  win.document.removeEventListener("click", listener);
  target.remove();
  unmount();
  cleanup();
});

test("unmounting during a pick lets clicks through again", async () => {
  const target = win.document.createElement("button");
  target.id = "cancel-order";
  win.document.body.appendChild(target);

  const heard: string[] = [];
  const listener = () => heard.push("click");
  win.document.addEventListener("click", listener);

  const { result, unmount } = renderHook(() => useBugReport({ endpoint: ENDPOINT }));

  let picked: unknown = "unset";
  await act(async () => {
    const pending = result.current.pickElement();
    unmount();
    picked = await pending;
  });

  // The unmount aborted the pick, so the picker's capture-phase listeners are
  // gone and an ordinary click reaches the page again.
  assert.equal(picked, null);
  target.dispatchEvent(
    new win.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  assert.deepEqual(heard, ["click"]);

  win.document.removeEventListener("click", listener);
  target.remove();
  cleanup();
});
