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
