import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

/**
 * The panel's two button-free ways in: the keyboard shortcut and the opt-in
 * auto-open. Both need a real document — a shadow root, a keydown that
 * bubbles, a window that dispatches an error event — so this file puts a
 * happy-dom window on `globalThis` before the widget is imported, the same way
 * the hook's tests do.
 */
const win = new Window({ url: "https://example.test/orders?tab=open" });
const globals = globalThis as unknown as Record<string, unknown>;

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

const { mountBugbottle } = await import("../src/ui/index.ts");
const { en } = await import("../src/locales.ts");
const { DEFAULT_SHORTCUT, parseShortcut } = await import("../src/triggers.ts");
const { onShake } = await import("../src/shake.ts");

const ENDPOINT = "https://example.test/api/bug-reports";

/** A fetch that never leaves the process, and remembers what it was given. */
function fakeFetch() {
  const bodies: Record<string, unknown>[] = [];
  const fn = (async (_input: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: "rep_1" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fn, bodies };
}

/** The panel's parts, read out of the shadow root the way a reporter sees them. */
function parts(host: HTMLElement) {
  const root = host.shadowRoot;
  assert.ok(root, "the widget mounts an open shadow root");
  return {
    panel: root.querySelector(".panel") as HTMLElement,
    intro: root.querySelector(".intro") as HTMLElement,
    textarea: root.querySelector("textarea") as HTMLTextAreaElement,
    types: [...root.querySelectorAll(".type")] as HTMLElement[],
  };
}

/** An uncaught error the way the browser announces one. */
function throwOnPage(error: Error): void {
  const event = new win.Event("error");
  Object.assign(event, { error, message: `Uncaught ${error.message}` });
  win.dispatchEvent(event);
}

test("an uncaught error opens the panel, explains itself and prefills the message", () => {
  const { fn } = fakeFetch();
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    fetch: fn,
    openOnError: { prefill: true },
  });
  const { panel, intro, textarea, types } = parts(widget.host);
  assert.equal(panel.hidden, true, "nothing is open until something goes wrong");

  throwOnPage(new Error("Cannot read properties of undefined"));

  assert.equal(panel.hidden, false);
  assert.equal(intro.textContent, en.ui.openedByError);
  assert.equal(textarea.value, "Cannot read properties of undefined");
  assert.equal(types[0]?.getAttribute("aria-checked"), "true", "the type is set to bug");

  // The reporter closes it without sending: the panel goes back to its ordinary
  // self, because the next time they open it they came of their own accord.
  widget.close();
  widget.open();
  assert.equal(intro.textContent, en.ui.intro);
  widget.destroy();
});

test("a loop of the same error opens the panel once", () => {
  const { fn } = fakeFetch();
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fn, openOnError: true });
  const { panel, textarea } = parts(widget.host);

  const error = new Error("render loop");
  throwOnPage(error);
  assert.equal(panel.hidden, false);
  assert.equal(textarea.value, "", "without prefill the reporter writes their own words");

  widget.close();
  throwOnPage(error);
  assert.equal(panel.hidden, true, "the second copy of the same error is not news");
  widget.destroy();
});

test("nothing opens by itself unless openOnError is asked for", () => {
  const { fn } = fakeFetch();
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fn });
  const { panel } = parts(widget.host);
  throwOnPage(new Error("unwatched"));
  assert.equal(panel.hidden, true);
  widget.destroy();
});

/** A keydown for the default combination, whatever `mod` means on this platform. */
function pressShortcut(): void {
  const shortcut = parseShortcut(DEFAULT_SHORTCUT);
  const event = new win.KeyboardEvent("keydown", {
    key: shortcut.key,
    ctrlKey: shortcut.ctrl,
    metaKey: shortcut.meta,
    shiftKey: shortcut.shift,
    altKey: shortcut.alt,
    bubbles: true,
    cancelable: true,
  });
  win.document.dispatchEvent(event);
}

test("the keyboard shortcut opens the panel and closes it from outside the box", () => {
  const { fn } = fakeFetch();
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fn });
  const { panel, textarea } = parts(widget.host);

  pressShortcut();
  assert.equal(panel.hidden, false);

  // The panel puts the caret in its own textarea when it opens, and that
  // textarea lives in a shadow root: the keydown is retargeted to the host on
  // its way to the document, so `target` says "the widget" while the reporter
  // is in fact typing. The shortcut must stay out of their way.
  textarea.focus();
  pressShortcut();
  assert.equal(panel.hidden, false, "the caret is in the box, so the keys are the reporter's");

  // Blurred, the same keys toggle again — Escape and the close button are the
  // ways out while the box has focus.
  textarea.blur();
  pressShortcut();
  assert.equal(panel.hidden, true);

  widget.destroy();
  pressShortcut();
  assert.equal(panel.hidden, true, "a destroyed widget listens to nothing");
});

test("shortcut false installs no listener, and a custom combination is honoured", () => {
  const { fn } = fakeFetch();
  const silent = mountBugbottle({ endpoint: ENDPOINT, fetch: fn, shortcut: false });
  pressShortcut();
  assert.equal(parts(silent.host).panel.hidden, true);
  silent.destroy();

  const custom = mountBugbottle({ endpoint: ENDPOINT, fetch: fn, shortcut: "alt+k" });
  const event = new win.KeyboardEvent("keydown", { key: "k", altKey: true, bubbles: true });
  win.document.dispatchEvent(event);
  assert.equal(parts(custom.host).panel.hidden, false);
  custom.destroy();
});

/** One motion reading, the way a phone delivers it. */
function move(x: number): void {
  const event = new win.Event("devicemotion");
  Object.assign(event, { accelerationIncludingGravity: { x, y: 0, z: 9.8 } });
  win.dispatchEvent(event);
}

/** A shake: the still phone that seeds gravity, then three alternating swings. */
function shakePhone(): void {
  move(0);
  move(40);
  move(-40);
  move(40);
}

test("a shake opens the panel when the detector is handed in", () => {
  const { fn } = fakeFetch();
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fn, shake: onShake });
  const { panel } = parts(widget.host);

  shakePhone();
  assert.equal(panel.hidden, false);

  // A shake opens; it never closes. The gesture that would close the panel is
  // the same one that shook it open, and a reporter holding a phone moves it.
  widget.close();
  widget.destroy();
});

test("the shake threshold can be tuned, and a destroyed widget stops listening", () => {
  const { fn } = fakeFetch();
  const deaf = mountBugbottle({
    endpoint: ENDPOINT,
    fetch: fn,
    shake: { on: onShake, threshold: 60 },
  });
  shakePhone();
  assert.equal(parts(deaf.host).panel.hidden, true, "40 m/s² is under a 60 m/s² threshold");
  deaf.destroy();

  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fn, shake: onShake });
  widget.destroy();
  shakePhone();
  assert.equal(parts(widget.host).panel.hidden, true);
});

test("no shake option installs no motion listener", () => {
  const { fn } = fakeFetch();
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fn });
  shakePhone();
  assert.equal(parts(widget.host).panel.hidden, true);
  widget.destroy();
});

/**
 * The two recorders the panel does not import. `initNetwork` and `initPerf`
 * are handed in exactly like `onShake`, so a fake of the right shape proves
 * the wiring without patching `fetch` or listening to the performance
 * timeline: what matters is that the panel calls what it was given, with the
 * options it was given, and stops it again on `destroy()`.
 */
function fakeRecorder() {
  const calls: Record<string, unknown>[] = [];
  let stopped = 0;
  const on = (options: Record<string, unknown> = {}) => {
    calls.push(options);
    return () => {
      stopped += 1;
    };
  };
  return { on, calls, stops: () => stopped };
}

test("no network or perf option starts no recorder", () => {
  const { fn } = fakeFetch();
  const network = fakeRecorder();
  const perf = fakeRecorder();
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fn });
  widget.destroy();
  assert.equal(network.calls.length, 0);
  assert.equal(perf.calls.length, 0);
});

test("a network recorder is started with the panel's endpoint and stopped on destroy", () => {
  const { fn } = fakeFetch();
  const network = fakeRecorder();
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    fetch: fn,
    network: network.on as never,
  });
  assert.equal(network.calls.length, 1);
  // The endpoint is passed so the recorder never records the report's own
  // delivery, which would be a mirror rather than evidence.
  assert.equal(network.calls[0]?.endpoint, ENDPOINT);
  assert.equal(network.stops(), 0);
  widget.destroy();
  assert.equal(network.stops(), 1);
});

test("the config object form reaches the recorder, endpoint and all", () => {
  const { fn } = fakeFetch();
  const network = fakeRecorder();
  const perf = fakeRecorder();
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    fetch: fn,
    network: { on: network.on as never, all: true, maxEntries: 5 },
    perf: { on: perf.on as never, storage: false },
  });
  assert.equal(network.calls[0]?.all, true);
  assert.equal(network.calls[0]?.maxEntries, 5);
  assert.equal(network.calls[0]?.endpoint, ENDPOINT);
  assert.equal(perf.calls[0]?.storage, false);
  widget.destroy();
  assert.equal(network.stops(), 1);
  assert.equal(perf.stops(), 1);
});

test("a named endpoint wins over the panel's, and perf takes the defaults", () => {
  const { fn } = fakeFetch();
  const network = fakeRecorder();
  const perf = fakeRecorder();
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    fetch: fn,
    network: { on: network.on as never, endpoint: "https://other.test/ingest" },
    perf: perf.on as never,
  });
  assert.equal(network.calls[0]?.endpoint, "https://other.test/ingest");
  assert.equal(perf.calls.length, 1);
  widget.destroy();
  assert.equal(perf.stops(), 1);
});
