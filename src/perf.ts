/**
 * Was it slow, and what state was the browser in?
 *
 * Two questions a bug report almost never answers and almost always needs to.
 * "The page hung" is a different report when it arrives with an LCP of 8.4
 * seconds and four long tasks, and "I was logged out" is a different report
 * when it arrives with no `authToken` in `localStorage`.
 *
 * `initPerf` reads the Web Vitals the browser has already measured — LCP, CLS
 * and INP through `PerformanceObserver`, TTFB and the load milestones from the
 * navigation entry, long tasks by count and total, and the JS heap where
 * Chromium exposes it — without bundling `web-vitals`. The observers are
 * created with `buffered: true` so entries from before this ran are delivered
 * anyway, but call it as early as your app can manage: `buffered` covers the
 * browser's own buffer, and that buffer is finite.
 *
 * The storage snapshot is taken when the report is built, not when this runs,
 * because what matters is what was stored when the reporter hit send. It lists
 * key names and value lengths, and cookie names. Never values — except the
 * keys the integrator named in `allowValues`, which is opt-in per key and
 * clipped to 200 characters. Cookie values are never included at all, on any
 * setting: a cookie is where the session lives.
 *
 * This is a separate entry point (`bugbottle/perf`) so an application that
 * does not import it does not carry it, and it stays under 1.3 kB gzipped.
 */

import { registerPerfSource, registerStorageSource } from "./registry.ts";
import {
  MAX_COOKIE_NAMES,
  MAX_STORAGE_KEYS,
  MAX_STORAGE_KEY_LENGTH,
  MAX_STORAGE_VALUE_LENGTH,
  type PerfSnapshot,
  type StorageKeyRef,
  type StorageSnapshot,
} from "./report-core.ts";

export type { PerfSnapshot, StorageKeyRef, StorageSnapshot };

export type PerfOptions = {
  /** Measure the Web Vitals and the load milestones. Default true. */
  vitals?: boolean;
  /** Take the storage snapshot when a report is built. Default true. */
  storage?: boolean;
  /**
   * Keys whose values may travel with the report, by exact name, looked up in
   * `localStorage` first and then `sessionStorage`. Nothing is included
   * without being named here, and a cookie value is never included at all.
   */
  allowValues?: string[];
  /** How many keys of each store to list. Default 50. */
  maxKeys?: number;
};

/**
 * The bits of a performance entry this module reads. Every browser adds more;
 * none of the rest is recorded, and the shapes differ enough between entry
 * types that one loose type is more honest than four exact ones.
 */
type Entry = {
  entryType?: string;
  startTime?: number;
  duration?: number;
  /** `layout-shift` only. */
  value?: number;
  /** `layout-shift` only: a shift the user asked for is not a shift. */
  hadRecentInput?: boolean;
  /** `event` and `first-input`: how long the interaction took to paint. */
  processingEnd?: number;
};

type ObserverLike = { disconnect: () => void };

/** The four numbers the observers accumulate, before rounding. */
let lcp = 0;
let cls = 0;
let inp = 0;
let longTaskCount = 0;
let longTaskMs = 0;

let initialised = false;
let observers: ObserverLike[] = [];
let allowValues: string[] = [];
let maxKeys = MAX_STORAGE_KEYS;
let snapshotStorage = true;

/**
 * Subscribes to one entry type, or does nothing at all when the browser has
 * never heard of it. `buffered` asks for the entries that happened before this
 * ran, which is the only way to see an LCP that was painted while the
 * application was still booting; a browser that rejects the option throws from
 * `observe`, and an unsupported type is not a reason to stop measuring the
 * others.
 */
function observe(type: string, handler: (entry: Entry) => void): void {
  const Observer = globalThis.PerformanceObserver;
  if (typeof Observer !== "function") return;
  try {
    const observer = new Observer((list) => {
      for (const entry of list.getEntries() as unknown as Entry[]) handler(entry);
    });
    observer.observe({ type, buffered: true } as PerformanceObserverInit);
    observers.push(observer);
  } catch {
    // An unsupported entry type, or a runtime that refuses `buffered`. Either
    // way this measurement is simply not available here.
  }
}

/**
 * Starts measuring. Call it as early as your app can manage — ideally in the
 * same module that mounts the panel, before anything else runs.
 *
 * Safe to call more than once; only the first call observes anything. Nothing
 * here throws in a server-rendered pass: without `PerformanceObserver` and
 * without `performance` there is simply nothing to measure, and the storage
 * snapshot is registered anyway so it can still be taken in the browser.
 *
 * Returns the `stop()` that undoes it.
 */
export function initPerf(options: PerfOptions = {}): () => void {
  if (initialised) return resetPerf;
  initialised = true;
  lcp = 0;
  cls = 0;
  inp = 0;
  longTaskCount = 0;
  longTaskMs = 0;
  allowValues = Array.isArray(options.allowValues) ? options.allowValues : [];
  maxKeys =
    typeof options.maxKeys === "number" && Number.isFinite(options.maxKeys) && options.maxKeys >= 0
      ? Math.min(Math.floor(options.maxKeys), MAX_STORAGE_KEYS)
      : MAX_STORAGE_KEYS;
  snapshotStorage = options.storage !== false;

  if (options.vitals !== false) {
    // The last candidate wins: the browser reports a larger element as it
    // finds one, and the final report is the one that counts.
    observe("largest-contentful-paint", (entry) => {
      lcp = Math.max(lcp, entry.startTime ?? 0);
    });
    // Shifts that followed a recent input are the page responding to the
    // reporter, not moving under them, and the Web Vitals definition excludes
    // them. This sums every remaining shift rather than taking the worst
    // session window — the simplification is documented in the README, and it
    // reads high rather than low, which is the safe direction for evidence.
    observe("layout-shift", (entry) => {
      if (!entry.hadRecentInput) cls += entry.value ?? 0;
    });
    // INP proper is the 98th percentile of a page's interactions. This takes
    // the worst one instead: on the handful of interactions a session usually
    // has, the percentile *is* the worst one, and on a long session this
    // over-reports rather than hides. `first-input` is observed too, so a
    // browser without the `event` type still contributes its FID.
    const interaction = (entry: Entry) => {
      inp = Math.max(inp, entry.duration ?? 0);
    };
    observe("event", interaction);
    observe("first-input", interaction);
    observe("longtask", (entry) => {
      longTaskCount += 1;
      longTaskMs += entry.duration ?? 0;
    });
    registerPerfSource(getPerf);
  }

  if (snapshotStorage) registerStorageSource(getStorageSnapshot);
  return resetPerf;
}

/** Whole milliseconds, or nothing when the browser never measured it. */
function ms(value: number): number | undefined {
  return value > 0 ? Math.round(value) : undefined;
}

/**
 * What has been measured so far, or null when nothing has. Called by
 * `buildReport` through the registry, at the moment a report is written.
 */
export function getPerf(): PerfSnapshot | null {
  const out: PerfSnapshot = {};
  const set = (key: "lcp" | "inp" | "ttfb" | "domContentLoaded" | "load", value?: number) => {
    if (value !== undefined) out[key] = value;
  };
  set("lcp", ms(lcp));
  set("inp", ms(inp));
  if (cls > 0) out.cls = Math.round(cls * 1000) / 1000;

  // The navigation entry carries the milestones, and it is read now rather
  // than observed: it is complete long before anybody writes a bug report.
  const nav = (
    globalThis.performance?.getEntriesByType?.("navigation") as unknown as Entry[] | undefined
  )?.[0] as Record<string, unknown> | undefined;
  if (nav) {
    const num = (key: string) => {
      const value = nav[key];
      return typeof value === "number" ? ms(value) : undefined;
    };
    set("ttfb", num("responseStart"));
    set("domContentLoaded", num("domContentLoadedEventEnd"));
    set("load", num("loadEventEnd"));
  }

  if (longTaskCount > 0) {
    out.longTasks = { count: longTaskCount, totalMs: Math.round(longTaskMs) };
  }

  // Chromium only, and non-standard, which is why it is read defensively and
  // reported in megabytes: the byte counts are quantised anyway.
  const memory = (globalThis.performance as { memory?: Record<string, unknown> } | undefined)
    ?.memory;
  if (memory && typeof memory.usedJSHeapSize === "number") {
    const mb = (bytes: unknown) =>
      typeof bytes === "number" && Number.isFinite(bytes) ? Math.round(bytes / 1048576) : 0;
    out.memory = { usedMB: mb(memory.usedJSHeapSize), limitMB: mb(memory.jsHeapSizeLimit) };
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Key names and value lengths for one web storage. A store the browser refuses
 * to open — a blocked third-party context, a disabled setting — throws on
 * access, which is a reason to have no snapshot and never a reason to fail a
 * report.
 */
function listStore(store: Storage | undefined): StorageKeyRef[] {
  const out: StorageKeyRef[] = [];
  try {
    if (!store) return out;
    for (let i = 0; i < store.length && out.length < maxKeys; i += 1) {
      const key = store.key(i);
      if (typeof key !== "string") continue;
      out.push({
        key: key.slice(0, MAX_STORAGE_KEY_LENGTH),
        length: (store.getItem(key) ?? "").length,
      });
    }
  } catch {
    // No storage here. The rest of the report is unaffected.
  }
  return out;
}

/** One store read, guarded the same way. */
function store(name: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return (globalThis as Record<string, unknown>)[name] as Storage | undefined;
  } catch {
    return undefined;
  }
}

/**
 * The stores as they are right now: names and lengths, plus the values of the
 * allow-listed keys and nothing else. Cookie *names* only — a cookie value is
 * never included, whatever the allow-list says, because that is where sessions
 * live and a bug report is not a place to put one.
 */
export function getStorageSnapshot(): StorageSnapshot | null {
  const out: StorageSnapshot = {};
  const local = store("localStorage");
  const session = store("sessionStorage");
  const localKeys = listStore(local);
  if (localKeys.length > 0) out.local = localKeys;
  const sessionKeys = listStore(session);
  if (sessionKeys.length > 0) out.session = sessionKeys;

  try {
    const raw = (globalThis as { document?: { cookie?: string } }).document?.cookie;
    if (typeof raw === "string" && raw) {
      const cookies: string[] = [];
      for (const pair of raw.split(";")) {
        if (cookies.length >= MAX_COOKIE_NAMES) break;
        // Everything before the first `=` is the name; everything after it is
        // the part that never leaves the browser.
        const name = pair.split("=")[0]?.trim();
        if (name) cookies.push(name.slice(0, MAX_STORAGE_KEY_LENGTH));
      }
      if (cookies.length > 0) out.cookies = cookies;
    }
  } catch {
    // A document without cookies, or one that refuses to say.
  }

  if (allowValues.length > 0) {
    const values: Record<string, string> = {};
    for (const key of allowValues) {
      if (typeof key !== "string") continue;
      let value: string | null = null;
      try {
        value = local?.getItem(key) ?? session?.getItem(key) ?? null;
      } catch {
        value = null;
      }
      if (typeof value === "string") {
        values[key.slice(0, MAX_STORAGE_KEY_LENGTH)] = value.slice(0, MAX_STORAGE_VALUE_LENGTH);
      }
    }
    if (Object.keys(values).length > 0) out.values = values;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** Whether `initPerf` has run and not been reset since. */
export function isPerfActive(): boolean {
  return initialised;
}

/**
 * Disconnects the observers, forgets the measurements and unregisters both
 * sources, so a later report carries neither block. This is what `initPerf`
 * returns.
 */
export function resetPerf(): void {
  for (const observer of observers) {
    try {
      observer.disconnect();
    } catch {
      // A disconnected observer disconnecting again is not a failure.
    }
  }
  observers = [];
  registerPerfSource(null);
  registerStorageSource(null);
  lcp = 0;
  cls = 0;
  inp = 0;
  longTaskCount = 0;
  longTaskMs = 0;
  allowValues = [];
  maxKeys = MAX_STORAGE_KEYS;
  snapshotStorage = true;
  initialised = false;
}
