/**
 * A short timeline of what the reporter did before they reported.
 *
 * The console buffer says what went wrong; breadcrumbs say what was being done
 * at the time. "It broke after I clicked save" stops being a guess when the
 * report carries `clicked button#save-order`, then a navigation, then the
 * error — that is usually the difference between reading a report and
 * reproducing one.
 *
 * Four things are recorded and nothing else: clicks, navigation, form submits
 * and visibility changes. Deliberately absent: input values, keystrokes, and
 * anything read out of a field. A breadcrumb says *where* someone clicked,
 * never *what they typed*. Elements inside `[data-bugbottle]` are skipped
 * entirely, anything inside `[data-bugbottle-mask]` or a `contenteditable`
 * region records its selector with no text, and `beforeBreadcrumb` has the last
 * word: return null and the breadcrumb is dropped.
 *
 * This is a separate entry point (`bugbottle/breadcrumbs`) so an application
 * that does not import it does not carry it, and it stays under 1 kB gzipped.
 */

import { buildSelector } from "./element-picker.ts";
import { registerBreadcrumbSource } from "./registry.ts";
import {
  MAX_BREADCRUMBS,
  MAX_BREADCRUMB_TEXT_LENGTH,
  type Breadcrumb,
  type BreadcrumbKind,
} from "./report-core.ts";

export type { Breadcrumb, BreadcrumbKind };

export type BreadcrumbsOptions = {
  /** How many breadcrumbs to keep. Oldest are dropped first. Default 30. */
  maxEntries?: number;
  /**
   * Inspect, change or drop each breadcrumb before it is recorded. Return null
   * to drop it. This runs before anything is stored, so it is the right place
   * to redact a path or refuse a whole section of the page.
   */
  beforeBreadcrumb?: (crumb: Breadcrumb) => Breadcrumb | null;
};

/** The bits of History the patch needs, so a fake one is enough to test it. */
type HistoryLike = {
  pushState: (data: unknown, unused: string, url?: string | URL | null) => void;
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
};

/** Everything a listener needs, so `on` can be handed a missing global. */
type Listenable = {
  addEventListener: (type: string, fn: (e: Event) => void, capture?: boolean) => void;
  removeEventListener: (type: string, fn: (e: Event) => void, capture?: boolean) => void;
};

/**
 * An element the reporter can type into. `contenteditable="false"` is the one
 * value that turns editing off, and it nests inside an editable ancestor, so
 * the negation matters.
 */
const EDITABLE_SELECTOR = "[contenteditable]:not([contenteditable=\"false\"])";

let buffer: Breadcrumb[] = [];
let initialised = false;
let maxEntries = MAX_BREADCRUMBS;
let beforeBreadcrumb: ((crumb: Breadcrumb) => Breadcrumb | null) | null = null;

/** One undo per thing `initBreadcrumbs` did, so reset cannot forget one. */
let undo: (() => void)[] = [];

/** Where we last saw the reporter, so a navigation can say what it left. */
let lastPath = "";

/**
 * Path and query only — never the origin, and never the fragment, which is the
 * one part of a URL that applications habitually put identifiers in. The same
 * rule `collectContext` follows.
 */
function pathOf(url?: string | URL | null): string {
  // An empty string resolves to the base, so "where are we now" and "where is
  // this router going" are the same call.
  const base = globalThis.location?.href;
  try {
    const parsed = new URL(String(url ?? ""), base);
    return parsed.pathname + parsed.search;
  } catch {
    return "";
  }
}

function push(entry: Omit<Breadcrumb, "ts">): void {
  const crumb: Breadcrumb = { ts: new Date().toISOString(), ...entry };
  let kept: Breadcrumb | null = crumb;
  if (beforeBreadcrumb) {
    try {
      kept = beforeBreadcrumb(crumb);
    } catch {
      // `push` is reached synchronously from the patched `pushState`, so a hook
      // that throws would surface inside the host router's own navigation call.
      // A hook that cannot decide is read the same way as one that returned
      // null: the crumb is dropped, and the application carries on.
      return;
    }
  }
  if (!kept) return;
  buffer.push(kept);
  if (buffer.length > maxEntries) buffer = buffer.slice(-maxEntries);
}

function on(
  target: Listenable | undefined,
  type: string,
  fn: (e: Event) => void,
  capture?: boolean,
): void {
  if (!target) return;
  target.addEventListener(type, fn, capture);
  undo.push(() => target.removeEventListener(type, fn, capture));
}

function recordNavigation(to: string): void {
  const from = lastPath;
  // A navigation that arrives where it started is not a navigation. Both are
  // common: `hashchange` moves only the fragment, which this module does not
  // record, and query-sync libraries call `replaceState` with the same URL on
  // every keystroke. Recorded, either one fills the ring buffer with noise and
  // evicts the crumbs that would have explained the report.
  if (from === to) return;
  lastPath = to;
  push(from ? { kind: "navigation", from, to } : { kind: "navigation", to });
}

/**
 * A click or a submit: the selector, and for a click the visible label.
 *
 * Form controls contribute no text at all — an input's text is its value, and
 * a value is exactly what must never end up in a breadcrumb. A form is the
 * same case one level up, so a submit records the selector and stops there.
 *
 * A `contenteditable` region is a form control that does not look like one:
 * every rich-text editor is a div, and its text is whatever the reporter has
 * typed. It is masked for the same reason an `<input>` is.
 */
function recordElement(kind: BreadcrumbKind, event: Event): void {
  const el = event.target as Element | null;
  // A target that is not an element (the document, say) has no `closest`.
  if (!el?.closest || el.closest("[data-bugbottle]")) return;
  const crumb: Omit<Breadcrumb, "ts"> = {
    kind,
    target: buildSelector(el as unknown as Parameters<typeof buildSelector>[0], el.ownerDocument),
  };
  if (
    kind === "click" &&
    !el.closest("[data-bugbottle-mask]") &&
    !el.closest(EDITABLE_SELECTOR) &&
    !/^(input|textarea|select|option)$/.test(el.tagName.toLowerCase())
  ) {
    const text = ((el as HTMLElement).innerText ?? el.textContent ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_BREADCRUMB_TEXT_LENGTH);
    if (text) crumb.text = text;
  }
  push(crumb);
}

/**
 * How many entries to keep, given what the caller asked for.
 *
 * `slice(-0)` is the whole array and `slice(-NaN)` is too, so an unchecked 0 or
 * NaN removes the bound instead of tightening it — the opposite of what anyone
 * passing a small number meant. An explicit 0 is the one case where a caller
 * plainly means "record nothing"; everything else that is not a finite positive
 * number falls back to the default rather than to unbounded growth.
 */
function resolveMaxEntries(requested: number | undefined): number {
  if (requested === 0) return 0;
  return typeof requested === "number" && Number.isFinite(requested) && requested > 0
    ? Math.max(1, Math.floor(requested))
    : MAX_BREADCRUMBS;
}

/**
 * Starts recording. Call it as early as your app can manage — anything that
 * happened before this is not in the buffer.
 *
 * Safe to call more than once; only the first call attaches listeners. Nothing
 * here throws in a server-rendered pass: without a `document` there is simply
 * nothing to listen to. `maxEntries: 0` records nothing: no listeners are
 * attached at all, since a buffer that throws every crumb away is pure cost.
 *
 * Returns the stop, `resetBreadcrumbs`, so a caller can undo what it started
 * without importing a second name. Every `init*` in the package returns its
 * own; the one that recorded nothing returns it too, and calling it is
 * harmless.
 */
export function initBreadcrumbs(options: BreadcrumbsOptions = {}): () => void {
  if (initialised) return resetBreadcrumbs;
  const cap = resolveMaxEntries(options.maxEntries);
  if (cap === 0) return resetBreadcrumbs;
  initialised = true;
  maxEntries = cap;
  beforeBreadcrumb = options.beforeBreadcrumb ?? null;
  lastPath = pathOf();

  // `globalThis` is the one global that is always there; the DOM ones are not.
  const doc = globalThis.document as (Listenable & { hidden?: boolean }) | undefined;
  const win = globalThis.window as Listenable | undefined;

  // Capture phase, so a handler that stops propagation does not also erase the
  // record of the click that reached it.
  on(doc, "click", (e) => recordElement("click", e), true);
  on(doc, "submit", (e) => recordElement("submit", e), true);
  on(doc, "visibilitychange", () => {
    push({ kind: "visibility", to: doc?.hidden ? "hidden" : "visible" });
  });

  const navigated = () => recordNavigation(pathOf());
  on(win, "popstate", navigated);
  on(win, "hashchange", navigated);

  // Single-page routers navigate through the History API, which fires no event
  // of its own — so the two methods are wrapped. The originals are always
  // called, and put back on reset.
  const past = globalThis.history as HistoryLike | undefined;
  if (past?.pushState) {
    const target = past;
    for (const name of ["pushState", "replaceState"] as const) {
      const original = target[name];
      target[name] = function (data, unused, url) {
        original.call(this, data, unused, url);
        try {
          recordNavigation(pathOf(url));
        } catch {
          // The navigation has already happened by this point, and recording it
          // is the least important thing on the stack. Nothing this module does
          // may turn a router's `pushState` into a thrown error.
        }
      };
      undo.push(() => {
        target[name] = original;
      });
    }
  }

  registerBreadcrumbSource(getBreadcrumbs);
  return resetBreadcrumbs;
}

/** A copy of what has been recorded so far, oldest first. */
export function getBreadcrumbs(): Breadcrumb[] {
  return [...buffer];
}

/** Whether `initBreadcrumbs` has run and not been reset since. */
export function isBreadcrumbsActive(): boolean {
  return initialised;
}

/** Empties the buffer, removes the listeners and unpatches `history`. */
export function resetBreadcrumbs(): void {
  buffer = [];
  registerBreadcrumbSource(null);
  for (const step of undo) step();
  undo = [];
  beforeBreadcrumb = null;
  lastPath = "";
  maxEntries = MAX_BREADCRUMBS;
  initialised = false;
}
