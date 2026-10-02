import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { da, en } from "../src/locales.ts";

/**
 * The area and element modes in a page: the overlay, the keys that leave it,
 * the crop that comes out at the device's pixel ratio, the panel's three
 * buttons, and the form state that carries the region to the report.
 *
 * happy-dom has no renderer and no canvas, so the renderer, the canvas and
 * `Image` are stand-ins that record what they are asked for: the picture a
 * renderer returns names its own size, `Image` reads it back, and the canvas
 * records every `drawImage` and `strokeRect`.
 */
const win = new Window({ url: "https://example.test/orders" });
const globals = globalThis as unknown as Record<string, unknown>;
const forced = new Set([
  "window",
  "document",
  "navigator",
  "location",
  "getComputedStyle",
  "Element",
  "HTMLElement",
  "HTMLCanvasElement",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "PointerEvent",
]);
for (const key of Object.getOwnPropertyNames(win)) {
  if (key.startsWith("_")) continue;
  if (!forced.has(key) && key in globals) continue;
  try {
    globals[key] = (win as unknown as Record<string, unknown>)[key];
  } catch {
    // A few window properties are getter-only; none of them matter here.
  }
}

/** The picture's size travels inside its own data URL, so `Image` can read it back. */
class FakeImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    const size = /W(\d+)x(\d+)/.exec(value);
    setTimeout(() => {
      if (!size) return this.onerror?.();
      this.naturalWidth = Number(size[1]);
      this.naturalHeight = Number(size[2]);
      this.onload?.();
    }, 0);
  }
}
globals.Image = FakeImage;

type Call = [string, ...unknown[]];
let calls: Call[] = [];
const context = {
  drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
  strokeRect: (...args: unknown[]) => calls.push(["strokeRect", ...args]),
  strokeStyle: "",
  lineWidth: 0,
};
const canvasProto = (win as unknown as { HTMLCanvasElement: { prototype: Record<string, unknown> } })
  .HTMLCanvasElement.prototype;
canvasProto.getContext = () => context;
canvasProto.toDataURL = function (this: { width: number; height: number }) {
  return `data:image/png;base64,W${this.width}x${this.height}`;
};

const { selectArea, captureArea, captureElement } = await import("../src/region.ts");
const { mountBugbottle } = await import("../src/ui/index.ts");
const { createReportState } = await import("../src/report-state.ts");

/** A renderer that renders nothing and returns a picture of the body's size at the ratio asked. */
let rendered: number[] = [];
const renderer = async (_root: HTMLElement, opts: { pixelRatio: number }) => {
  rendered.push(opts.pixelRatio);
  return `data:image/png;base64,W${1000 * opts.pixelRatio}x${3000 * opts.pixelRatio}`;
};

function setScroll(x: number, y: number) {
  Object.defineProperty(window, "scrollX", { value: x, configurable: true });
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

function setRect(node: Element, r: { left: number; top: number; width: number; height: number }) {
  (node as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({
    ...r,
    x: r.left,
    y: r.top,
    right: r.left + r.width,
    bottom: r.top + r.height,
  });
}

const overlay = () => document.querySelector<HTMLElement>('[data-bugbottle="region"]');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function pointer(target: EventTarget, type: string, x: number, y: number) {
  target.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, button: 0 }),
  );
}
function key(name: string) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
  calls = [];
  rendered = [];
  setScroll(0, 0);
  Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
  setRect(document.body, { left: 0, top: 0, width: 1000, height: 3000 });
});

test("the overlay is a named dialog that takes focus, says what to do and gives focus back", async () => {
  const before = document.createElement("button");
  document.body.append(before);
  before.focus();
  const pending = selectArea({ instructions: "Drag it" });
  const layer = overlay();
  assert.ok(layer, "an overlay is mounted");
  assert.equal(layer.getAttribute("role"), "dialog");
  assert.equal(layer.getAttribute("aria-modal"), "true");
  assert.equal(layer.getAttribute("aria-label"), "Drag it");
  assert.equal(document.activeElement, layer);
  const hint = layer.shadowRoot?.querySelector(".hint");
  assert.equal(hint?.textContent, "Drag it");
  assert.equal(hint?.getAttribute("role"), "status");
  key("Escape");
  assert.equal(await pending, null);
  assert.equal(overlay(), null, "the overlay is gone");
  assert.equal(document.activeElement, before, "focus is back where it was");
});

test("a drag resolves with the rectangle in page and viewport coordinates", async () => {
  setScroll(0, 1800);
  const pending = selectArea();
  const layer = overlay()!;
  pointer(layer, "pointerdown", 300, 120);
  pointer(layer, "pointermove", 200, 160);
  const box = layer.shadowRoot!.querySelector<HTMLElement>(".box")!;
  assert.equal(box.style.display, "block", "the box follows the pointer");
  assert.equal(box.style.left, "200px");
  pointer(layer, "pointerup", 100, 220);
  assert.deepEqual(await pending, {
    rect: { x: 100, y: 1920, width: 200, height: 100 },
    viewport: { x: 100, y: 120, width: 200, height: 100 },
  });
});

test("a drag smaller than the minimum is a stray click, and the overlay stays", async () => {
  const pending = selectArea({ minSize: 10 });
  const layer = overlay()!;
  pointer(layer, "pointerdown", 100, 100);
  pointer(layer, "pointerup", 105, 140);
  await tick();
  assert.ok(overlay(), "still selecting");
  key("Escape");
  assert.equal(await pending, null);
});

test("Enter takes the visible page, which is the keyboard's way through", async () => {
  setScroll(0, 400);
  const pending = selectArea();
  key("Enter");
  assert.deepEqual(await pending, {
    rect: { x: 0, y: 400, width: 1000, height: 600 },
    viewport: { x: 0, y: 0, width: 1000, height: 600 },
  });
});

test("a held Enter from the button that opened the overlay is not a choice", async () => {
  const pending = selectArea();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true }));
  await tick();
  assert.ok(overlay(), "still selecting");
  key("Escape");
  assert.equal(await pending, null);
});

test("a nonsense minimum size falls back to the default rather than accepting a click", async () => {
  const pending = selectArea({ minSize: Number.NaN });
  const layer = overlay()!;
  pointer(layer, "pointerdown", 100, 100);
  pointer(layer, "pointerup", 101, 101);
  await tick();
  assert.ok(overlay(), "a one-pixel drag is still a stray click");
  key("Escape");
  assert.equal(await pending, null);
});

test("the signal cancels a selection, and an aborted one never mounts", async () => {
  const controller = new AbortController();
  const pending = selectArea({ signal: controller.signal });
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(overlay(), null);
  assert.equal(await selectArea({ signal: controller.signal }), null);
  assert.equal(overlay(), null);
});

test("an area is rendered at the device pixel ratio and cut out at it", async () => {
  Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
  setScroll(0, 1000);
  // Scrolled, the body's box starts above the viewport.
  setRect(document.body, { left: 0, top: -1000, width: 1000, height: 3000 });
  const pending = captureArea(renderer);
  const layer = overlay()!;
  pointer(layer, "pointerdown", 100, 50);
  pointer(layer, "pointerup", 400, 200);
  const shot = await pending;
  assert.deepEqual(rendered, [2], "rendered once, at the device's ratio");
  assert.deepEqual(calls[0], ["drawImage", calls[0]![1], 200, 2100, 600, 300, 0, 0, 600, 300]);
  assert.equal(shot?.dataUrl, "data:image/png;base64,W600x300");
  assert.deepEqual(shot?.region, {
    mode: "area",
    rect: { x: 100, y: 1050, width: 300, height: 150 },
    viewport: { x: 100, y: 50, width: 300, height: 150 },
  });
});

test("annotate draws the rectangle on the whole page instead of cutting it out", async () => {
  const pending = captureArea(renderer, { annotate: true });
  const layer = overlay()!;
  pointer(layer, "pointerdown", 10, 20);
  pointer(layer, "pointerup", 110, 70);
  const shot = await pending;
  assert.equal(shot?.region?.annotated, true);
  assert.equal(shot?.dataUrl, "data:image/png;base64,W1000x3000", "the whole page");
  const strokes = calls.filter(([name]) => name === "strokeRect");
  assert.equal(strokes.length, 2, "a dark stroke under a light one");
  assert.deepEqual(strokes[1]!.slice(1), [10, 20, 100, 50]);
});

test("an element is picked with a high-contrast box and cut out with its padding", async () => {
  Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Save order");
  button.textContent = "Save";
  document.body.append(button);
  setRect(button, { left: 100, top: 300, width: 80, height: 30 });

  const pending = captureElement(renderer, { instructions: "Pick it" });
  const layer = overlay()!;
  assert.equal(layer.getAttribute("role"), null, "the page underneath keeps the pointer");
  assert.match(layer.style.cssText, /pointer-events: ?none/);
  assert.equal(layer.shadowRoot!.querySelector(".hint")?.textContent, "Pick it");

  pointer(button, "pointermove", 120, 310);
  const box = layer.shadowRoot!.querySelector<HTMLElement>(".box")!;
  assert.equal(box.style.display, "block");
  assert.equal(box.style.width, "80px");

  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  const shot = await pending;
  assert.equal(overlay(), null);
  assert.equal(shot?.element?.tag, "button");
  assert.equal(shot?.element?.text, "Save");
  assert.equal(shot?.region?.mode, "element");
  assert.equal(shot?.region?.selector, shot?.element?.selector);
  // 8 CSS pixels of padding on every side, at 2x.
  assert.deepEqual(calls[0]!.slice(2), [184, 584, 192, 92, 0, 0, 192, 92]);
});

test("Escape leaves the element picker with nothing taken", async () => {
  const pending = captureElement(renderer);
  key("Escape");
  assert.equal(await pending, null);
  assert.equal(overlay(), null);
  assert.deepEqual(rendered, []);
});

// ---- the panel

const ENDPOINT = "https://example.test/api/bug-reports";

function recordingFetch() {
  const bodies: Record<string, unknown>[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: "rep_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { bodies, fetch: fetch as typeof globalThis.fetch };
}

const fakeShot = {
  dataUrl: "data:image/png;base64,W10x10",
  region: {
    mode: "element" as const,
    rect: { x: 1, y: 2, width: 3, height: 4 },
    viewport: { x: 1, y: 2, width: 3, height: 4 },
    selector: "button#save",
  },
  element: {
    selector: "button#save",
    tag: "button",
    text: "Save",
    rect: { x: 1, y: 2, width: 3, height: 4 },
    attributes: {},
  },
};

test("without region the panel offers no modes at all", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, screenshot: renderer });
  const row = widget.host.shadowRoot!.querySelector<HTMLElement>(".modes")!;
  assert.equal(row.hidden, true);
  assert.equal(row.querySelectorAll("button").length, 0);
  widget.destroy();
});

test("the three modes are a labelled group in the reporter's language", () => {
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    screenshot: renderer,
    region: async () => null,
    locale: da,
  });
  const row = widget.host.shadowRoot!.querySelector<HTMLElement>(".modes")!;
  assert.equal(row.hidden, false);
  assert.equal(row.getAttribute("role"), "group");
  assert.equal(row.getAttribute("aria-label"), da.ui.shotModeLabel);
  const labels = [...row.querySelectorAll("button")].map((b) => b.textContent);
  assert.deepEqual(labels, [da.ui.shotPage, da.ui.shotArea, da.ui.shotElement]);
  // A locale written before the modes existed falls back to English.
  const { shotModeLabel: _a, shotPage: _b, shotArea: _c, shotElement: _d, ...old } = da.ui;
  widget.setLocale({ ...da, ui: old });
  assert.equal(row.getAttribute("aria-label"), en.ui.shotModeLabel);
  widget.destroy();
});

test("picking an element for the picture hides the panel, then sends the region and the element", async () => {
  const { bodies, fetch } = recordingFetch();
  const asked: { mode: string; instructions?: string }[] = [];
  let release: (value: typeof fakeShot) => void = () => {};
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    fetch,
    screenshot: renderer,
    locale: da,
    region: (_render, mode, options) => {
      asked.push({ mode, instructions: options?.instructions });
      return new Promise((resolve) => (release = resolve));
    },
  });
  widget.open();
  await tick();
  const root = widget.host.shadowRoot!;
  const panel = root.querySelector<HTMLElement>(".panel")!;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>(".modes button")];
  buttons[2]!.click();
  assert.equal(panel.hidden, true, "the panel is out of the way while picking");
  assert.deepEqual(asked, [{ mode: "element", instructions: da.ui.picking }]);

  release(fakeShot);
  await tick();
  await tick();
  assert.equal(panel.hidden, false);
  assert.equal(root.activeElement, buttons[2], "focus returns to the button");
  assert.equal(buttons[2]!.getAttribute("aria-pressed"), "true");
  assert.equal(buttons[0]!.getAttribute("aria-pressed"), "false");
  assert.equal(root.querySelector<HTMLImageElement>(".preview")!.src, fakeShot.dataUrl);

  root.querySelector("textarea")!.value = "The save button does nothing";
  root.querySelector<HTMLButtonElement>(".send")!.click();
  await tick();
  await tick();
  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0]!.screenshotRegion, fakeShot.region);
  assert.deepEqual(bodies[0]!.elements, [fakeShot.element]);
  assert.equal(bodies[0]!.screenshotDataUrl, fakeShot.dataUrl);
  widget.destroy();
});

test("a cancelled selection leaves the picture that was there", async () => {
  let calls = 0;
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    screenshot: renderer,
    region: async () => {
      calls++;
      return null;
    },
  });
  widget.open();
  await tick();
  await tick();
  const root = widget.host.shadowRoot!;
  const before = root.querySelector<HTMLImageElement>(".preview")!.src;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>(".modes button")];
  assert.equal(buttons[0]!.getAttribute("aria-pressed"), "true", "the whole page, as it opened");
  buttons[1]!.click();
  await tick();
  assert.equal(calls, 1);
  assert.equal(root.querySelector<HTMLImageElement>(".preview")!.src, before);
  assert.equal(buttons[0]!.getAttribute("aria-pressed"), "true");
  widget.destroy();
});

// ---- the headless form

test("attachScreenshot puts a region on the form state and the report", async () => {
  const { bodies, fetch } = recordingFetch();
  const original = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const store = createReportState({ endpoint: ENDPOINT, screenshot: renderer });
    store.actions.attachScreenshot(null);
    assert.equal(store.getState().screenshot, null, "a cancelled selection changes nothing");
    store.actions.attachScreenshot(fakeShot);
    const state = store.getState();
    assert.equal(state.screenshot, fakeShot.dataUrl);
    assert.equal(state.includeScreenshot, true);
    assert.deepEqual(state.screenshotRegion, fakeShot.region);
    assert.deepEqual(state.elements, [fakeShot.element]);

    store.actions.setMessage("The total is wrong");
    assert.equal(await store.actions.submit(), true);
    assert.deepEqual(bodies[0]!.screenshotRegion, fakeShot.region);
    assert.equal(store.getState().screenshotRegion, null, "a sent report leaves an empty form");

    store.actions.attachScreenshot(fakeShot);
    store.actions.toggleScreenshot(false);
    assert.equal(store.getState().screenshotRegion, null, "no picture, no region");
  } finally {
    globalThis.fetch = original;
  }
});

test("a whole-page capture that finishes late does not replace an attached area", async () => {
  let finish: (value: string) => void = () => {};
  const slow = (_root: HTMLElement, _opts: { pixelRatio: number }) =>
    new Promise<string>((resolve) => (finish = resolve));
  const store = createReportState({ endpoint: ENDPOINT, screenshot: slow });
  void store.actions.recapture();
  store.actions.attachScreenshot(fakeShot);
  finish("data:image/png;base64,W1x1");
  await tick();
  assert.equal(store.getState().screenshot, fakeShot.dataUrl);
  assert.deepEqual(store.getState().screenshotRegion, fakeShot.region);
  assert.equal(store.getState().status.kind, "idle");
});
