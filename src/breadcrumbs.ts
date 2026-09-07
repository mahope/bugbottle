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
 * entirely, anything inside `[data-bugbottle-mask]` records its selector with
 * no text, and `beforeBreadcrumb` has the last word: return null and the
 * breadcrumb is dropped.
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
  const kept = beforeBreadcrumb ? beforeBreadcrumb(crumb) : crumb;
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
  lastPath = to;
  push(from && from !== to ? { kind: "navigation", from, to } : { kind: "navigation", to });
}

/**
 * A click or a submit: the selector, and for a click the visible label.
 *
 * Form controls contribute no text at all — an input's text is its value, and
 * a value is exactly what must never end up in a breadcrumb. A form is the
 * same case one level up, so a submit records the selector and stops there.
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
    !/^(input|textarea|select)$/.test(el.tagName.toLowerCase())
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
 * Starts recording. Call it as early as your app can manage — anything that
 * happened before this is not in the buffer.
 *
 * Safe to call more than once; only the first call attaches listeners. Nothing
 * here throws in a server-rendered pass: without a `document` there is simply
 * nothing to listen to.
 */
export function initBreadcrumbs(options: BreadcrumbsOptions = {}): void {
  if (initialised) return;
  initialised = true;
  maxEntries = options.maxEntries ?? MAX_BREADCRUMBS;
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
        recordNavigation(pathOf(url));
      };
      undo.push(() => {
        target[name] = original;
      });
    }
  }

  registerBreadcrumbSource(getBreadcrumbs);
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
