import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

/**
 * The "Edit picture" flow inside the ready-made panel: the button appears with
 * the picture, the toolbar is a radio group the arrows walk through, undo is
 * disabled until there is something to undo, done folds the marked picture
 * back into the report and puts focus back where it started, and
 * `annotate: false` renders none of it.
 *
 * The canvas is the recorder from `tests/annotate.test.ts` in miniature: what
 * is checked here is the panel around the annotator, not the drawing.
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

const context = {
  drawImage() {},
  strokeRect() {},
  fillRect() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: new Uint8ClampedArray(Math.max(0, w * h * 4)), width: w, height: h };
  },
  strokeStyle: "",
  fillStyle: "",
  lineWidth: 0,
  lineCap: "",
  lineJoin: "",
};
const canvasProto = win.HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
canvasProto.getContext = (kind: string) => (kind === "2d" ? context : null);
canvasProto.toDataURL = () => MARKED;

const SHOT = "data:image/png;base64,AAAA";
const MARKED = "data:image/png;base64,MARKED";

class FakeImage {
  onload: (() => void) | null = null;
  onerror: ((error?: unknown) => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  set src(_value: string) {
    this.naturalWidth = 64;
    this.naturalHeight = 48;
    queueMicrotask(() => this.onload?.());
  }
}
globals.Image = FakeImage;

const { mountBugbottle } = await import("../src/ui/index.ts");
const { en } = await import("../src/locales.ts");

const ENDPOINT = "https://example.test/api/bug-reports";
const fakeFetch = (async () =>
  new Response(JSON.stringify({ id: "rep_1" }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof globalThis.fetch;

/** Long enough for the capture promise and the image decode to settle. */
const settle = () => new Promise((done) => setTimeout(done, 0));

function parts(host: HTMLElement) {
  const root = host.shadowRoot;
  assert.ok(root, "the widget mounts an open shadow root");
  return {
    root,
    panel: root.querySelector(".panel") as HTMLElement,
    trigger: root.querySelector(".trigger") as HTMLButtonElement,
    shotBox: root.querySelector(".check input") as HTMLInputElement,
    preview: root.querySelector(".preview") as HTMLImageElement,
    editBtn: root.querySelector(".edit") as HTMLButtonElement,
    editor: root.querySelector(".editor") as HTMLElement,
    toolsRow: root.querySelector(".tools") as HTMLElement,
    tools: [...root.querySelectorAll(".tool")] as HTMLButtonElement[],
    canvas: root.querySelector("canvas") as HTMLCanvasElement,
    undoBtn: root.querySelectorAll(".act")[0] as HTMLButtonElement,
    doneBtn: root.querySelectorAll(".act")[1] as HTMLButtonElement,
  };
}

function press(target: HTMLElement, key: string): boolean {
  const event = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event as unknown as Event);
  return event.defaultPrevented;
}

function fire(target: HTMLElement, type: string, x: number, y: number): void {
  const event = new win.Event(type, { bubbles: true, cancelable: true }) as unknown as Record<
    string,
    unknown
  >;
  event.clientX = x;
  event.clientY = y;
  event.pointerId = 1;
  target.dispatchEvent(event as unknown as Event);
}

function mount(extra: Record<string, unknown> = {}) {
  return mountBugbottle({
    endpoint: ENDPOINT,
    fetch: fakeFetch,
    screenshot: async () => SHOT,
    ...extra,
  });
}

/** Opens the panel, takes the picture and waits for both to settle. */
async function withPicture(widget: ReturnType<typeof mount>) {
  const p = parts(widget.host);
  p.trigger.click();
  p.shotBox.checked = true;
  p.shotBox.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  await settle();
  return p;
}

test("the edit button appears with the picture and opens the annotator", async () => {
  const widget = mount();
  const p = await withPicture(widget);

  assert.equal(p.editBtn.hidden, false, "there is a picture to mark");
  assert.equal(p.editBtn.textContent, en.ui.annotate);
  assert.equal(p.editor.hidden, true, "but the editor is not open yet");

  p.editBtn.click();
  await settle();
  assert.equal(p.editor.hidden, false);
  assert.equal(p.preview.hidden, true, "the canvas replaces the preview rather than joining it");
  assert.equal(p.editBtn.hidden, true);
  assert.equal(p.canvas.getAttribute("aria-label"), en.ui.annotateArea);
  assert.equal(p.canvas.getAttribute("role"), "img");
  assert.equal(p.canvas.width, 64, "the canvas took the size of the picture");

  widget.destroy();
});

test("the tools are a labelled radio group the arrow keys walk through", async () => {
  const widget = mount();
  const p = await withPicture(widget);
  p.editBtn.click();
  await settle();

  assert.equal(p.toolsRow.getAttribute("role"), "radiogroup");
  assert.equal(p.toolsRow.getAttribute("aria-label"), en.ui.toolLabel);
  assert.deepEqual(
    p.tools.map((t) => t.textContent),
    [en.ui.toolRect, en.ui.toolArrow, en.ui.toolBlur],
  );

  const checked = () => p.tools.findIndex((t) => t.getAttribute("aria-checked") === "true");
  const inTabOrder = () => p.tools.filter((t) => t.getAttribute("tabindex") === "0").length;
  assert.equal(checked(), 0, "the rectangle is selected to begin with");
  assert.equal(inTabOrder(), 1, "a radio group is one stop in the tab order");

  assert.equal(press(p.tools[0] as HTMLElement, "ArrowRight"), true);
  assert.equal(checked(), 1);
  press(p.tools[1] as HTMLElement, "ArrowRight");
  assert.equal(checked(), 2);
  press(p.tools[2] as HTMLElement, "ArrowRight");
  assert.equal(checked(), 0, "the group wraps round");
  press(p.tools[0] as HTMLElement, "ArrowLeft");
  assert.equal(checked(), 2, "and wraps backwards");

  p.tools[1]?.click();
  assert.equal(checked(), 1, "clicking one selects it too");

  widget.destroy();
});

test("undo waits for a mark, and done keeps the marked picture and returns focus", async () => {
  const widget = mount();
  const p = await withPicture(widget);
  p.editBtn.click();
  await settle();

  assert.equal(p.undoBtn.textContent, en.ui.undo);
  assert.equal(p.doneBtn.textContent, en.ui.done);
  assert.equal(p.undoBtn.disabled, true, "there is nothing to undo yet");

  fire(p.canvas, "pointerdown", 10, 10);
  fire(p.canvas, "pointermove", 40, 30);
  fire(p.canvas, "pointerup", 40, 30);
  assert.equal(p.undoBtn.disabled, false, "a mark switches undo on");

  p.undoBtn.click();
  assert.equal(p.undoBtn.disabled, true, "and the last one undone switches it off again");

  fire(p.canvas, "pointerdown", 10, 10);
  fire(p.canvas, "pointermove", 40, 30);
  fire(p.canvas, "pointerup", 40, 30);
  p.doneBtn.click();

  assert.equal(p.editor.hidden, true);
  assert.equal(p.preview.hidden, false, "the marked picture is the preview again");
  assert.equal(p.preview.getAttribute("src"), MARKED);
  assert.equal(p.editBtn.hidden, false, "and can be marked again");
  assert.equal(p.root.activeElement, p.editBtn, "focus goes back to the control that opened it");

  widget.destroy();
});

test("the marked picture is what the report carries", async () => {
  const bodies: string[] = [];
  const widget = mount({
    fetch: (async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return new Response(JSON.stringify({ id: "rep_1" }), { status: 201 });
    }) as unknown as typeof globalThis.fetch,
  });
  const p = await withPicture(widget);
  p.editBtn.click();
  await settle();
  fire(p.canvas, "pointerdown", 5, 5);
  fire(p.canvas, "pointermove", 40, 30);
  fire(p.canvas, "pointerup", 40, 30);
  p.doneBtn.click();

  const textarea = p.root.querySelector("textarea") as HTMLTextAreaElement;
  textarea.value = "The total is wrong";
  (p.root.querySelector(".send") as HTMLButtonElement).click();
  await settle();

  assert.equal(bodies.length, 1);
  assert.equal(JSON.parse(bodies[0] ?? "{}").screenshotDataUrl, MARKED);

  widget.destroy();
});

test("closing the panel keeps the marks; clearing the picture drops the editor", async () => {
  const widget = mount();
  const p = await withPicture(widget);
  p.editBtn.click();
  await settle();
  fire(p.canvas, "pointerdown", 5, 5);
  fire(p.canvas, "pointermove", 40, 30);
  fire(p.canvas, "pointerup", 40, 30);

  press(p.canvas, "Escape");
  assert.equal(p.panel.hidden, true, "with no mark in progress Escape still closes the panel");
  assert.equal(p.editor.hidden, true, "and the editor closes with it");
  assert.equal(p.preview.getAttribute("src"), MARKED, "the marks are part of the draft");

  p.trigger.click();
  p.shotBox.checked = false;
  p.shotBox.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  assert.equal(p.editBtn.hidden, true, "no picture, no button");
  assert.equal(p.editor.hidden, true);

  widget.destroy();
});

test("the canvas is inside the focus loop while the editor is open", async () => {
  const widget = mount();
  const p = await withPicture(widget);
  p.editBtn.click();
  await settle();

  const focusable = [
    ...p.panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]),input:not([disabled]),' +
        'canvas:not([tabindex="-1"])',
    ),
  ].filter((n) => !n.hidden && !n.closest("[hidden]"));
  assert.ok(focusable.includes(p.canvas), "Tab reaches the drawing area");

  widget.destroy();
});

test("annotate: false renders no way in", async () => {
  const widget = mount({ annotate: false });
  const p = await withPicture(widget);

  assert.equal(p.preview.hidden, false, "the picture is still attached");
  assert.equal(p.editBtn.hidden, true, "there is simply nothing that opens an editor");
  assert.equal(p.editor.hidden, true);

  widget.destroy();
});

test("a locale swap renames every control of the editor", async () => {
  const { da } = await import("../src/locales.ts");
  const widget = mount();
  const p = await withPicture(widget);
  widget.setLocale(da);

  assert.equal(p.editBtn.textContent, da.ui.annotate);
  assert.equal(p.toolsRow.getAttribute("aria-label"), da.ui.toolLabel);
  assert.equal(p.canvas.getAttribute("aria-label"), da.ui.annotateArea);
  assert.deepEqual(
    p.tools.map((t) => t.textContent),
    [da.ui.toolRect, da.ui.toolArrow, da.ui.toolBlur],
  );
  assert.equal(p.undoBtn.textContent, da.ui.undo);
  assert.equal(p.doneBtn.textContent, da.ui.done);

  widget.destroy();
});
