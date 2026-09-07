/**
 * Hiding what the reporter typed, for the length of one render.
 *
 * A renderer works from a clone of the live DOM, and the clone is made inside
 * the renderer where we cannot reach it. So masking happens in the live
 * document instead: the values are swapped for bullets, the marked regions are
 * covered, the picture is taken, and everything is put back. The swap is
 * synchronous and every renderer we know of clones synchronously too, so the
 * page is never painted in its masked state and no flicker is visible. Should
 * a renderer ever clone asynchronously, the worst case is a frame of bullets —
 * not lost data, which is the direction that matters.
 *
 * The element is kept, only its content is hidden. Layout therefore survives:
 * the screenshot still shows a filled-in form of the right shape, with the
 * right fields highlighted in red, which is usually the whole point of the
 * picture. That is what makes this different from `exclude`, which removes the
 * node and takes the layout with it.
 *
 * The attribute names are rrweb's, so a team that already annotated its
 * templates for session replay does not annotate them twice.
 */

export type MaskOptions = {
  /**
   * Mask the value of every `input` and `textarea`, and the text of every
   * `contenteditable` region. Default true. Buttons, checkboxes and the other
   * types that carry no typed text are left alone.
   */
  inputs?: boolean;
  /**
   * Elements whose text is replaced with bullets. Default
   * `[data-bugbottle-mask]`; `false` switches this pass off.
   */
  selector?: string | false;
  /**
   * Elements covered by a solid overlay, for a region whose shape is as
   * telling as its text — a chart, a photograph, an avatar. Default
   * `[data-bugbottle-block]`; `false` switches this pass off.
   */
  block?: string | false;
  /**
   * Colour of that overlay. Defaults to the element's `--bb-mask` custom
   * property, then to `#999`.
   */
  colour?: string;
};

/** Elements masked by the `inputs` pass. */
const INPUT_SELECTOR = "input, textarea, [contenteditable]";

/** Input types with no typed text to hide. */
const UNTYPED = /^(?:button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/;

const BULLET = "•";

export const DEFAULT_MASK_SELECTOR = "[data-bugbottle-mask]";
export const DEFAULT_BLOCK_SELECTOR = "[data-bugbottle-block]";
export const DEFAULT_MASK_COLOUR = "#999";

/**
 * `root` and its descendants matching `selector`. A selector the browser
 * refuses — a typo in an application's options — yields nothing rather than
 * throwing: a mistake in the annotation must cost the picture, never the
 * report. The root is included because it may itself be the marked region.
 */
function queryAll(root: HTMLElement, selector: string): Element[] {
  try {
    const found = Array.from(root.querySelectorAll(selector));
    return root.matches(selector) ? [root, ...found] : found;
  } catch {
    return [];
  }
}

/** Replaces every non-space character of every text node under `el`. */
function bulletText(el: Node, undo: (() => void)[]): void {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      const text = child as Text;
      const original = text.data;
      if (!original.trim()) continue;
      text.data = original.replace(/\S/g, BULLET);
      undo.push(() => {
        text.data = original;
      });
    } else if (child.nodeType === 1) {
      bulletText(child, undo);
    }
  }
}

/** Same number of characters, so the field keeps its width and its wrapping. */
function bulletValue(el: HTMLInputElement | HTMLTextAreaElement, undo: (() => void)[]): void {
  const value = el.value;
  const placeholder = el.placeholder;
  if (!value && !placeholder) return;
  if (value) el.value = BULLET.repeat(value.length);
  // A placeholder is written by the application rather than the reporter, but
  // an empty field showing "you@example.com" says which field it is, and that
  // is exactly what the masked picture is meant not to say.
  if (placeholder) el.placeholder = "";
  undo.push(() => {
    el.value = value;
    el.placeholder = placeholder;
  });
}

/**
 * Covers `el` with a child of its own size rather than a positioned rectangle
 * in page coordinates: no geometry to compute, nothing to get wrong when the
 * page scrolls between the measurement and the render.
 */
function cover(el: HTMLElement, colour: string | undefined, undo: (() => void)[]): void {
  const view = el.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(el);
  const fill = colour || computed?.getPropertyValue("--bb-mask").trim() || DEFAULT_MASK_COLOUR;
  const overlay = el.ownerDocument.createElement("div");
  // Not `data-bugbottle`: that is what the default `exclude` filter drops, and
  // this one has to be in the picture.
  overlay.setAttribute("data-bugbottle-mask-overlay", "");
  overlay.style.cssText =
    `position:absolute;left:0;top:0;right:0;bottom:0;background:${fill};` +
    "border-radius:inherit;pointer-events:none;";
  const position = el.style.position;
  if (!computed || computed.position === "static") el.style.position = "relative";
  el.appendChild(overlay);
  undo.push(() => {
    overlay.remove();
    el.style.position = position;
  });
}

/**
 * Masks everything under `root` and returns the function that puts it back.
 * Call the returned function in a `finally`: an unrestored page is a page the
 * reporter cannot type in.
 */
export function applyMask(root: HTMLElement, options: MaskOptions = {}): () => void {
  const undo: (() => void)[] = [];
  const selector = options.selector ?? DEFAULT_MASK_SELECTOR;
  const block = options.block ?? DEFAULT_BLOCK_SELECTOR;

  if (options.inputs ?? true) {
    // Tag names rather than `instanceof`: an element from an iframe or another
    // realm is still an input, and the check has to say so.
    for (const el of queryAll(root, INPUT_SELECTOR)) {
      const field = el as HTMLInputElement;
      if (el.tagName === "TEXTAREA") bulletValue(field, undo);
      else if (el.tagName === "INPUT") {
        if (!UNTYPED.test(field.type)) bulletValue(field, undo);
      } else if (el.getAttribute("contenteditable") !== "false") bulletText(el, undo);
    }
  }
  if (selector) for (const el of queryAll(root, selector)) bulletText(el, undo);
  if (block) for (const el of queryAll(root, block)) cover(el as HTMLElement, options.colour, undo);

  return () => {
    // Backwards, so an element masked by two passes is unwound in the order it
    // was wound. Each restore is on its own: one that throws must not strand
    // the rest of the page in bullets.
    for (let i = undo.length - 1; i >= 0; i -= 1) {
      try {
        undo[i]?.();
      } catch {
        // Nothing useful to do here, and nothing worth losing the report over.
      }
    }
  };
}
