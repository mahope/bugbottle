/**
 * Pointing at the thing the report is about.
 *
 * "The button does nothing" is a different report when it arrives with
 * `button#save-order` and the text "Save", the page it sat on, and where on
 * the page it was. That is enough for a developer — or an agent reading the
 * report — to open the right file without asking.
 *
 * `describeElement` is the pure part: it turns an element into a small,
 * serialisable description. `pickElement` is the interactive part: it waits
 * for the reporter to choose something with the pointer or keyboard.
 */

import { pickElementWithPointer } from "./element-picker-pointer.ts";
import type { ElementRef } from "./report-core.ts";
import { MAX_ELEMENT_TEXT_LENGTH } from "./report-core.ts";

/** Defined by the script-tag build; ESM keeps keyboard selection. */
declare const __BUGBOTTLE_KEYBOARD_PICKER__: boolean;

/** Attributes worth carrying. `data-bugbottle*` is the library's own and is skipped. */
const ATTRIBUTES = ["id", "name", "role", "type", "href", "aria-label", "placeholder", "title"];
const MAX_SELECTOR_DEPTH = 5;
/**
 * Longest selector the builder writes. A selector is something a person reads
 * in a ticket and pastes into DevTools; past this it stops being either.
 */
const MAX_SELECTOR_LENGTH = 200;
/**
 * Longest id, test id or label used as an anchor. A longer one is usually
 * generated — a hash, a serialised state — and would eat the whole budget.
 */
const MAX_ANCHOR_LENGTH = 64;

/** The subset of Element the selector builder needs, so it can be tested without a DOM. */
type SelectorNode = {
  tagName: string;
  id: string;
  parentElement: SelectorNode | null;
  previousElementSibling: SelectorNode | null;
  getAttribute(name: string): string | null;
};

function isUnique(selector: string, root: { querySelectorAll(s: string): ArrayLike<unknown> } | null) {
  if (!root) return false;
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function escape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/[^\w-]/g, "\\$&");
}

const anchor = (value: string | null): value is string =>
  !!value && value.length <= MAX_ANCHOR_LENGTH;

/**
 * One level of the selector. An id comes first, then `data-testid` — both are
 * there to be found again — then `aria-label`, which names the control the way
 * the reporter saw it. Only the first two end the walk on their own: a label is
 * often shared (every row's "Delete"), so it ends the walk only once it is
 * unique, like any other step.
 */
function step(node: SelectorNode): string {
  const tag = node.tagName.toLowerCase();
  if (anchor(node.id)) return `${tag}#${escape(node.id)}`;
  const testId = node.getAttribute("data-testid");
  if (anchor(testId)) return `${tag}[data-testid="${escape(testId)}"]`;
  const label = node.getAttribute("aria-label");
  if (anchor(label)) return `${tag}[aria-label="${escape(label)}"]`;

  let index = 1;
  for (let s = node.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.tagName === node.tagName) index++;
  }
  return index === 1 ? tag : `${tag}:nth-of-type(${index})`;
}

/**
 * A short CSS selector for the node. Stops at the first ancestor with an id or
 * a `data-testid`, or when the selector is unique in `root`, or after five
 * levels, or before it passes 200 characters — enough to find the element
 * again, short enough to read.
 */
export function buildSelector(
  node: SelectorNode,
  root: { querySelectorAll(s: string): ArrayLike<unknown> } | null = null,
): string {
  const parts: string[] = [];
  let current: SelectorNode | null = node;
  while (current && parts.length < MAX_SELECTOR_DEPTH) {
    const part = step(current);
    // The nearest steps are the specific ones, so a selector that would grow
    // past the cap keeps what it has rather than an ancestor.
    if (parts.length > 0 && part.length + 3 + parts.join(" > ").length > MAX_SELECTOR_LENGTH) break;
    parts.unshift(part);
    const selector = parts.join(" > ");
    const anchored = anchor(current.id) || anchor(current.getAttribute("data-testid"));
    if (anchored || isUnique(selector, root)) break;
    current = current.parentElement;
    if (current && current.tagName.toLowerCase() === "body") break;
  }
  return parts.join(" > ");
}

/** A serialisable description of an element: what it is, what it says, where it is. */
export function describeElement(el: Element): ElementRef {
  const attributes: Record<string, string> = {};
  for (const name of ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value) attributes[name] = value.slice(0, 200);
  }
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("data-") && !attr.name.startsWith("data-bugbottle")) {
      attributes[attr.name] = attr.value.slice(0, 200);
    }
  }
  const rect = el.getBoundingClientRect();
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ");
  return {
    selector: buildSelector(el as unknown as SelectorNode, el.ownerDocument),
    tag: el.tagName.toLowerCase(),
    text: text.slice(0, MAX_ELEMENT_TEXT_LENGTH),
    rect: {
      x: Math.round(rect.x + (window.scrollX || 0)),
      y: Math.round(rect.y + (window.scrollY || 0)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    attributes,
  };
}

export type PickOptions = {
  /** Cancels the pick. Resolves with null. */
  signal?: AbortSignal;
  /** Called when the pointer or keyboard selection changes. */
  onHover?: (el: Element | null) => void;
  /** Visible and accessible keyboard instructions. Defaults to English. */
  instructions?: string;
  /** Draw a highlight over the selected element. Default true. */
  highlight?: boolean;
  /** Elements that cannot be picked. Defaults to anything inside `[data-bugbottle]`. */
  ignore?: (el: Element) => boolean;
};

const defaultIgnore = (el: Element) => el.closest("[data-bugbottle]") !== null;

/**
 * Waits for a click, or Tab/arrow navigation followed by Enter/Space, and
 * resolves with the element's description. Escape, or the signal, resolves
 * with null. Selection never activates the chosen element.
 *
 * The highlight box carries `data-bugbottle`, so it never appears in a
 * screenshot and cannot be picked itself.
 */
export const pickElement: (options?: PickOptions) => Promise<ElementRef | null> =
  typeof __BUGBOTTLE_KEYBOARD_PICKER__ !== "undefined" && !__BUGBOTTLE_KEYBOARD_PICKER__
    ? pickElementWithPointer
    : pickElementWithKeyboard;

function pickElementWithKeyboard(options: PickOptions = {}): Promise<ElementRef | null> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("pickElement requires a browser environment"));
  }
  const ignore = options.ignore ?? defaultIgnore;
  const highlight = options.highlight ?? true;

  return new Promise((resolve) => {
    let box: HTMLDivElement | null = null;
    if (highlight) {
      box = document.createElement("div");
      box.dataset.bugbottle = "highlight";
      box.setAttribute("aria-hidden", "true");
      box.style.cssText =
        "position:fixed;pointer-events:none;z-index:2147483647;display:none;" +
        "outline:2px solid #e11d48;outline-offset:1px;background:rgba(225,29,72,.08);border-radius:2px";
      document.body.appendChild(box);
    }
    const previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";
    const previousFocus = document.activeElement as HTMLElement | null;
    const picker = document.createElement("div");
    picker.dataset.bugbottle = "picker";
    picker.tabIndex = -1;
    // This temporary keyboard surface needs arrow keys from screen readers too.
    picker.setAttribute("role", "application");
    const instructions = options.instructions ??
      "Click an element, or use Tab and arrow keys to move, Enter or Space to attach. Escape cancels.";
    picker.setAttribute("aria-label", instructions);
    picker.style.cssText = "position:fixed;bottom:8px;left:8px;right:8px;z-index:2147483647;pointer-events:none;" +
      "padding:12px;background:Canvas;color:CanvasText;border:2px solid;" +
      "font:16px/1.5 system-ui;max-height:30vh;overflow:auto";
    const hint = document.createElement("div");
    hint.textContent = instructions;
    const announcement = document.createElement("div");
    announcement.setAttribute("role", "status");
    announcement.setAttribute("aria-live", "polite");
    announcement.setAttribute("aria-atomic", "true");
    picker.append(hint, announcement);
    document.body.appendChild(picker);
    let selected: Element | null = null;
    let confirming: string | null = null;

    const targetOf = (e: Event): Element | null => {
      const t = e.target;
      if (!(t instanceof Element)) return null;
      return ignore(t) ? null : t;
    };

    const finish = (result: ElementRef | null) => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("scroll", draw, true);
      window.removeEventListener("resize", draw);
      options.signal?.removeEventListener("abort", onAbort);
      document.documentElement.style.cursor = previousCursor;
      box?.remove();
      picker.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      options.onHover?.(null);
      resolve(result);
    };

    const draw = () => {
      options.onHover?.(selected);
      if (selected) {
        const below = selected.getBoundingClientRect().top > window.innerHeight / 2;
        picker.style.top = below ? "8px" : "";
        picker.style.bottom = below ? "" : "8px";
      }
      if (!box) return;
      if (!selected?.isConnected) {
        box.style.display = "none";
        return;
      }
      const r = selected.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = `${r.left}px`;
      box.style.top = `${r.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
    };
    const select = (el: Element | null) => {
      selected = el;
      draw();
      announcement.textContent = el ? `${el.tagName.toLowerCase()}: ${
        el.getAttribute("aria-label") || el.getAttribute("alt") ||
        ((el as HTMLElement).innerText ?? el.textContent ?? "").trim().slice(0, MAX_ELEMENT_TEXT_LENGTH)
      }` : "";
    };
    const onMove = (e: PointerEvent) => select(targetOf(e));
    const onClick = (e: MouseEvent) => {
      const el = targetOf(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      finish(describeElement(el));
    };
    const onKey = (e: KeyboardEvent) => {
      if (!["Escape", "Tab", "ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End", "Enter", " "].includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        finish(null);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        if (selected) confirming = e.key;
        return;
      }
      confirming = null;
      const candidates = Array.from(document.body.querySelectorAll("*")).filter(el => {
        if (el.closest('[data-bugbottle], [hidden], [inert], [aria-hidden="true"]') || ignore(el)) return false;
        for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
          if (window.getComputedStyle(ancestor).opacity === "0") return false;
        }
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility === "visible" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      });
      const backwards = ["ArrowUp", "ArrowLeft"].includes(e.key) || (e.key === "Tab" && e.shiftKey);
      const current = selected ? candidates.indexOf(selected) : -1;
      const index = e.key === "Home" ? 0 : e.key === "End" ? candidates.length - 1 :
        current < 0 ? (backwards ? candidates.length - 1 : 0) :
          (current + (backwards ? -1 : 1) + candidates.length) % candidates.length;
      const next = candidates[index] ?? null;
      next?.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      select(next);
    };
    // Finish on release so Space cannot click the restored panel control.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (confirming === e.key && selected?.isConnected && !ignore(selected)) finish(describeElement(selected));
      confirming = null;
    };
    const onAbort = () => finish(null);

    if (options.signal?.aborted) {
      finish(null);
      return;
    }
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("scroll", draw, true);
    window.addEventListener("resize", draw);
    options.signal?.addEventListener("abort", onAbort);
    picker.focus({ preventScroll: true });
  });
}
