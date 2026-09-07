import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

/**
 * The annotator without a browser: the tool state machine, the undo stack, the
 * keyboard, and what each tool asks the 2D context to do.
 *
 * happy-dom has no canvas, so the context is a recorder that answers
 * `getImageData` with a flat region and writes down every call. That is enough
 * to prove which drawing calls a drag makes, that undo replays the picture
 * from the original image, and that a blur tiles its region with uniform
 * blocks. It is not enough to prove the exported pixels really changed, which
 * is what `scripts/annotate-smoke.mjs` does in a real Chrome.
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

/** Every pixel of the stubbed picture, so a blur block averages to this. */
const FLAT = 120;

type Call = { fn: string; args: unknown[] };

/** A 2D context that records rather than paints. */
function recorder(calls: Call[]): Record<string, unknown> {
  const note =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({ fn, args });
    };
  return {
    drawImage: note("drawImage"),
    strokeRect: note("strokeRect"),
    fillRect: note("fillRect"),
    beginPath: note("beginPath"),
    moveTo: note("moveTo"),
    lineTo: note("lineTo"),
    stroke: note("stroke"),
    getImageData(x: number, y: number, w: number, h: number) {
      calls.push({ fn: "getImageData", args: [x, y, w, h] });
      return { data: new Uint8ClampedArray(Math.max(0, w * h * 4)).fill(FLAT), width: w, height: h };
    },
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
  };
}

const calls: Call[] = [];
const context = recorder(calls);
// The recorder is shared, so `fillStyle` at the time of a fillRect has to be
// captured with the call rather than read afterwards.
const fills: { colour: unknown; rect: unknown[] }[] = [];
const rawFillRect = context.fillRect as (...args: unknown[]) => void;
context.fillRect = (...args: unknown[]) => {
  fills.push({ colour: context.fillStyle, rect: args });
  rawFillRect(...args);
};

const canvasProto = win.HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
canvasProto.getContext = function getContext(kind: string) {
  return kind === "2d" ? context : null;
};
canvasProto.toDataURL = () => "data:image/png;base64,MARKED";

/** The picture: 64x48, and one URL that refuses to load. */
const BROKEN = "data:image/png;base64,broken";
class FakeImage {
  onload: (() => void) | null = null;
  onerror: ((error?: unknown) => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  set src(value: string) {
    if (value === BROKEN) {
      queueMicrotask(() => this.onerror?.(new Error("no")));
      return;
    }
    this.naturalWidth = 64;
    this.naturalHeight = 48;
    queueMicrotask(() => this.onload?.());
  }
}
globals.Image = FakeImage;

const { createAnnotator } = await import("../src/annotate.ts");

const PICTURE = "data:image/png;base64,AAAA";

function freshCanvas(): HTMLCanvasElement {
  calls.length = 0;
  fills.length = 0;
  const canvas = win.document.createElement("canvas");
  win.document.body.append(canvas);
  return canvas as unknown as HTMLCanvasElement;
}

/**
 * A pointer event as the annotator reads it. happy-dom has no `PointerEvent`,
 * and the module only ever looks at `clientX`, `clientY` and `pointerId`.
 */
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

function drag(canvas: HTMLElement, x1: number, y1: number, x2: number, y2: number): void {
  fire(canvas, "pointerdown", x1, y1);
  fire(canvas, "pointermove", x2, y2);
  fire(canvas, "pointerup", x2, y2);
}

function press(target: HTMLElement, key: string): boolean {
  const event = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event as unknown as Event);
  return event.defaultPrevented;
}

const made = (fn: string) => calls.filter((c) => c.fn === fn).length;

/**
 * The calls of the most recent redraw. Every redraw starts with the picture,
 * so the drawing after the last `drawImage` is the state as it now stands —
 * without the live preview each pointer move painted on the way there.
 */
const lastRender = (): Call[] =>
  calls.slice(calls.map((c) => c.fn).lastIndexOf("drawImage") + 1);

test("the picture is drawn once it loads, and the canvas takes its size", async () => {
  const canvas = freshCanvas();
  const annotator = createAnnotator(canvas, PICTURE);
  assert.equal(made("drawImage"), 0, "nothing is drawn before the image is decoded");
  await annotator.ready;
  assert.equal(canvas.width, 64);
  assert.equal(canvas.height, 48);
  assert.equal(made("drawImage"), 1);
  assert.equal(annotator.count(), 0);
  assert.equal(annotator.getTool(), "rect", "the rectangle is the tool to begin with");
  annotator.destroy();
});

test("a rectangle drag is one stroked rectangle over the redrawn picture", async () => {
  const canvas = freshCanvas();
  const annotator = createAnnotator(canvas, PICTURE);
  await annotator.ready;

  drag(canvas, 10, 10, 40, 30);
  assert.equal(annotator.count(), 1);
  const rects = calls.filter((c) => c.fn === "strokeRect");
  assert.ok(rects.length >= 1, "the rectangle is stroked");
  assert.deepEqual(rects[rects.length - 1]?.args, [10, 10, 30, 20]);
  assert.equal(made("drawImage") > 1, true, "and the picture is redrawn under it");
  annotator.destroy();
});

test("a drag that goes up and to the left is still a rectangle", async () => {
  const canvas = freshCanvas();
  const annotator = createAnnotator(canvas, PICTURE);
  await annotator.ready;

  drag(canvas, 40, 30, 10, 10);
  const rects = calls.filter((c) => c.fn === "strokeRect");
  assert.deepEqual(rects[rects.length - 1]?.args, [10, 10, 30, 20], "normalised, not negative");
  annotator.destroy();
});

test("the arrow points where the drag ended", async () => {
  const canvas = freshCanvas();
  const annotator = createAnnotator(canvas, PICTURE);
  await annotator.ready;
  annotator.setTool("arrow");
  assert.equal(annotator.getTool(), "arrow");

  drag(canvas, 5, 5, 45, 25);
  assert.equal(annotator.count(), 1);
  assert.equal(made("strokeRect"), 0, "an arrow is not a rectangle");
  assert.equal(made("stroke") >= 1, true);
  const lines = lastRender()
    .filter((c) => c.fn === "lineTo")
    .map((c) => c.args);
  assert.equal(lines.length, 3, "a shaft and the two sides of the head");
  assert.deepEqual(lines[0], [45, 25], "the shaft runs to the end of the drag");
  annotator.destroy();
});

test("a blur tiles its region with uniform blocks of the average colour", async () => {
  const canvas = freshCanvas();
  const annotator = createAnnotator(canvas, PICTURE);
  await annotator.ready;
  annotator.setTool("blur");

  drag(canvas, 12, 12, 36, 36);
  assert.equal(annotator.count(), 1);
  const region = calls.filter((c) => c.fn === "getImageData").at(-1);
  assert.deepEqual(region?.args, [12, 12, 24, 24], "only the region is read back");

  // 24x24 at the default 12px block is four blocks, each one flat colour.
  const last = fills.slice(-4);
  assert.equal(last.length, 4);
  for (const fill of last) {
    assert.equal(fill.colour, `rgb(${FLAT},${FLAT},${FLAT})`, "the block is the average colour");
    assert.deepEqual(fill.rect.slice(2), [12, 12], "and a whole block wide and tall");
  }
  assert.deepEqual(
    last.map((f) => f.rect.slice(0, 2)),
    [
      [12, 12],
      [24, 12],
      [12, 24],
      [24, 24],
    ],
    "the blocks tile the region",
  );
  annotator.destroy();
});

test("a smaller block size makes more blocks", async () => {
  const canvas = freshCanvas();
  const annotator = createAnnotator(canvas, PICTURE, { blockSize: 8 });
  await annotator.ready;
  annotator.setTool("blur");

  drag(canvas, 0, 0, 24, 24);
  assert.equal(
    lastRender().filter((c) => c.fn === "fillRect").length,
    9,
    "24 divided by 8, squared",
  );
  annotator.destroy();
});

test("undo removes the last mark and clear removes them all", async () => {
  const canvas = freshCanvas();
  const seen: number[] = [];
  const annotator = createAnnotator(canvas, PICTURE, { onChange: (n) => seen.push(n) });
  await annotator.ready;

  drag(canvas, 1, 1, 20, 20);
  drag(canvas, 5, 5, 30, 30);
  assert.equal(annotator.count(), 2);

  assert.equal(annotator.undo(), true);
  assert.equal(annotator.count(), 1);
  const rects = calls.filter((c) => c.fn === "strokeRect");
  assert.deepEqual(rects[rects.length - 1]?.args, [1, 1, 19, 19], "the first mark is drawn again");

  annotator.clear();
  assert.equal(annotator.count(), 0);
  assert.equal(annotator.undo(), false, "there is nothing left to undo");
  assert.deepEqual(seen, [1, 2, 1, 0], "every change is reported with the count");
  annotator.destroy();
});

test("Backspace and Delete undo; Escape cancels only the mark in progress", async () => {
  const canvas = freshCanvas();
  const annotator = createAnnotator(canvas, PICTURE);
  await annotator.ready;

  drag(canvas, 1, 1, 20, 20);
  drag(canvas, 2, 2, 22, 22);
  assert.equal(press(canvas, "Backspace"), true);
  assert.equal(annotator.count(), 1);
  assert.equal(press(canvas, "Delete"), true);
  assert.equal(annotator.count(), 0);

  assert.equal(
    press(canvas, "Escape"),
    false,
    "with nothing being drawn the key belongs to the panel around it",
  );

  fire(canvas, "pointerdown", 4, 4);
  fire(canvas, "pointermove", 40, 40);
  assert.equal(press(canvas, "Escape"), true, "a mark in progress is cancelled here");
  fire(canvas, "pointerup", 40, 40);
  assert.equal(annotator.count(), 0, "and never becomes a mark");
  annotator.destroy();
});

test("a click that barely moves is not a mark", async () => {
  const canvas = freshCanvas();
  const annotator = createAnnotator(canvas, PICTURE);
  await annotator.ready;

  drag(canvas, 20, 20, 21, 21);
  assert.equal(annotator.count(), 0);
  annotator.destroy();
});

test("destroy stops listening, and the canvas keeps what is on it", async () => {
  const canvas = freshCanvas();
  const annotator = createAnnotator(canvas, PICTURE);
  await annotator.ready;
  drag(canvas, 1, 1, 20, 20);
  annotator.destroy();

  drag(canvas, 30, 30, 50, 40);
  assert.equal(annotator.count(), 1, "the drag after destroy draws nothing");
  assert.equal(annotator.toDataUrl(), "data:image/png;base64,MARKED");
});

test("a picture that will not decode rejects rather than drawing nothing quietly", async () => {
  const canvas = freshCanvas();
  const annotator = createAnnotator(canvas, BROKEN);
  await assert.rejects(annotator.ready, /screenshot could not be loaded/);
  assert.equal(annotator.count(), 0);
  annotator.destroy();
});

test("a canvas with no 2D context is refused, not silently ignored", () => {
  const canvas = freshCanvas();
  (canvas as unknown as Record<string, unknown>).getContext = () => null;
  assert.throws(() => createAnnotator(canvas, PICTURE), /2D context/);
});

test("the canvas gets a tab stop unless it already has one", async () => {
  const canvas = freshCanvas();
  createAnnotator(canvas, PICTURE).destroy();
  assert.equal(canvas.getAttribute("tabindex"), "0");

  const own = freshCanvas();
  own.setAttribute("tabindex", "-1");
  createAnnotator(own, PICTURE).destroy();
  assert.equal(own.getAttribute("tabindex"), "-1", "the caller's own value is left alone");
});
