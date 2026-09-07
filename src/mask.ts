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
 * Everything under `host` matching `selector`, descending into open shadow
 * roots on the way. `querySelectorAll` stops at a shadow boundary, but a
 * renderer clones `shadowRoot` children into the picture, so an input inside a
 * web component is photographed unless we go and find it ourselves. A closed
 * root has no `shadowRoot` to follow and cannot be masked at all; the README
 * says so.
 */
function collect(host: ParentNode, selector: string, out: Element[]): void {
  let children: Element[];
  try {
    children = Array.from(host.querySelectorAll("*"));
  } catch {
    return;
  }
  for (const el of children) {
    try {
      if (el.matches(selector)) out.push(el);
    } catch {
      // The selector is the same for every element, so one refusal is all of
      // them: a typo in an application's options costs this pass, nothing more.
      return;
    }
    const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (shadow) collect(shadow, selector, out);
  }
}

/**
 * `root` and its descendants matching `selector`, shadow roots included. A
 * selector the browser refuses — a typo in an application's options — yields
 * nothing rather than throwing: a mistake in the annotation must cost the
 * picture, never the report. The root is included because it may itself be the
 * marked region.
 */
function queryAll(root: HTMLElement, selector: string): Element[] {
  const found: Element[] = [];
  try {
    if (root.matches(selector)) found.push(root);
  } catch {
    return [];
  }
  const shadow = (root as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
  if (shadow) collect(shadow, selector, found);
  collect(root, selector, found);
  return found;
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
 * Elements that never render their children. Appending an overlay to one of
 * these does nothing at all — the child is in the tree and invisible — so a
 * `data-bugbottle-block` on an `<img>` used to be a no-op that looked like it
 * had worked. These are covered from the outside instead.
 */
const REPLACED = /^(?:IMG|CANVAS|VIDEO|IFRAME|INPUT|EMBED|OBJECT|SVG)$/;

/**
 * Above everything an application is likely to have positioned. A blocked
 * region with a `z-index: 10` child used to have that child painted straight
 * through the overlay, which is the one thing an overlay must never allow.
 */
const OVERLAY_Z_INDEX = 2147483647;

/** The shared look of an overlay, whichever way it is anchored. */
function paint(overlay: HTMLElement, fill: string, box: string): void {
  overlay.style.cssText =
    `position:absolute;${box}background:${fill};border-radius:inherit;` +
    `pointer-events:none;z-index:${OVERLAY_Z_INDEX};`;
}

/**
 * Covers a replaced element — one that renders no children of its own, so
 * there is nowhere inside it to put an overlay. `visibility: hidden` on the
 * element takes the picture out (a background colour would not: the image
 * paints over it), and a sibling rectangle is positioned over the box it
 * occupied, measured against whatever it is positioned inside. Both are put
 * back by the undo.
 */
function coverReplaced(el: HTMLElement, overlay: HTMLElement, fill: string): (() => void)[] {
  const steps: (() => void)[] = [];
  const visibility = el.style.visibility;
  el.style.visibility = "hidden";
  steps.push(() => {
    el.style.visibility = visibility;
  });

  const host = (el.offsetParent as HTMLElement | null) ?? el.parentElement;
  if (!host || typeof el.getBoundingClientRect !== "function") return steps;
  const rect = el.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const left = rect.left - hostRect.left + (host.scrollLeft || 0);
  const top = rect.top - hostRect.top + (host.scrollTop || 0);
  paint(
    overlay,
    fill,
    `left:${left}px;top:${top}px;width:${rect.width}px;height:${rect.height}px;`,
  );

  const view = el.ownerDocument.defaultView;
  const hostPosition = host.style.position;
  if (view?.getComputedStyle(host).position === "static") host.style.position = "relative";
  host.appendChild(overlay);
  steps.push(() => {
    overlay.remove();
    host.style.position = hostPosition;
  });
  return steps;
}

/**
 * Covers `el` with a child of its own size rather than a positioned rectangle
 * in page coordinates: no geometry to compute, nothing to get wrong when the
 * page scrolls between the measurement and the render. A replaced element has
 * no children to cover with, so it takes the other route.
 */
function cover(el: HTMLElement, colour: string | undefined, undo: (() => void)[]): void {
  const view = el.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(el);
  const fill = colour || computed?.getPropertyValue("--bb-mask").trim() || DEFAULT_MASK_COLOUR;
  const overlay = el.ownerDocument.createElement("div");
  // Not `data-bugbottle`: that is what the default `exclude` filter drops, and
  // this one has to be in the picture.
  overlay.setAttribute("data-bugbottle-mask-overlay", "");

  if (REPLACED.test(el.tagName.toUpperCase())) {
    for (const step of coverReplaced(el, overlay, fill)) undo.push(step);
    return;
  }

  paint(overlay, fill, "left:0;top:0;right:0;bottom:0;");
  const position = el.style.position;
  const overflow = el.style.overflow;
  if (!computed || computed.position === "static") el.style.position = "relative";
  // Content that spills outside the element paints outside the overlay too,
  // and a masked region that leaks its overflow is not masked.
  el.style.overflow = "hidden";
  el.appendChild(overlay);
  undo.push(() => {
    overlay.remove();
    el.style.position = position;
    el.style.overflow = overflow;
  });
}

/**
 * Masks everything under `root` and returns the function that puts it back.
 * Call the returned function in a `finally`: an unrestored page is a page the
 * reporter cannot type in.
 */
export function applyMask(root: HTMLElement, options: MaskOptions = {}): () => void {
  // `undo` is built as the passes run rather than at the end, so a pass that
  // throws half way through has already recorded everything it changed and the
  // restore below puts all of it back. A partial mask left on the page is the
  // one outcome worse than no picture.
  const undo: (() => void)[] = [];
  const selector = options.selector ?? DEFAULT_MASK_SELECTOR;
  const block = options.block ?? DEFAULT_BLOCK_SELECTOR;

  const restore = () => {
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
    undo.length = 0;
  };

  try {
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
    if (block) {
      for (const el of queryAll(root, block)) cover(el as HTMLElement, options.colour, undo);
    }
  } catch (err) {
    // Masking is the one part of a capture that must not fail open: an
    // unmasked picture of a form is exactly what this module exists to
    // prevent. So the page goes back as it was and the caller hears about it.
    restore();
    throw err;
  }

  return restore;
}
