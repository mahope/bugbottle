/**
 * A registry of slots so `buildReport` can pick up breadcrumbs, recorded
 * requests, timings and the storage snapshot without importing the modules
 * that produce them.
 *
 * `bugbottle/breadcrumbs`, `bugbottle/network`, `bugbottle/perf` and
 * `bugbottle/rrweb` are separate entries on purpose: an application that never imports one must not
 * pay for it. If `send.ts` imported them directly, every bundle would carry
 * every recorder and its patches. Instead each `init*` registers a getter
 * here, and `send.ts` reads it — this file is a handful of bytes and has no
 * DOM code in it at all.
 */

import type {
  Breadcrumb,
  NetworkEntry,
  PerfSnapshot,
  ReplayCapture,
  StorageSnapshot,
} from "./report-core.ts";

let breadcrumbSource: (() => Breadcrumb[]) | null = null;
let networkSource: (() => NetworkEntry[]) | null = null;
let perfSource: (() => PerfSnapshot | null) | null = null;
let storageSource: (() => StorageSnapshot | null) | null = null;
let replaySource: (() => ReplayCapture | null) | null = null;

/** Called by `initBreadcrumbs`; pass null to unregister. */
export function registerBreadcrumbSource(getter: (() => Breadcrumb[]) | null): void {
  breadcrumbSource = getter;
}

/** What has been recorded, or null when nothing is recording. */
export function readBreadcrumbs(): Breadcrumb[] | null {
  return breadcrumbSource ? breadcrumbSource() : null;
}

/** Called by `initNetwork`; pass null to unregister. */
export function registerNetworkSource(getter: (() => NetworkEntry[]) | null): void {
  networkSource = getter;
}

/** The requests recorded so far, or null when nothing is recording. */
export function readNetwork(): NetworkEntry[] | null {
  return networkSource ? networkSource() : null;
}

/** Called by `initPerf`; pass null to unregister. */
export function registerPerfSource(getter: (() => PerfSnapshot | null) | null): void {
  perfSource = getter;
}

/**
 * What has been measured so far, or null when nothing is measuring — and also
 * null when something is measuring but has nothing to show yet, which is the
 * honest answer for a page that never painted.
 */
export function readPerf(): PerfSnapshot | null {
  return perfSource ? perfSource() : null;
}

/** Called by `initPerf`; pass null to unregister. */
export function registerStorageSource(getter: (() => StorageSnapshot | null) | null): void {
  storageSource = getter;
}

/**
 * The stores as they are right now, or null when nothing is looking. Read at
 * report time rather than at init: what mattered is what was stored when the
 * reporter hit send.
 */
export function readStorage(): StorageSnapshot | null {
  return storageSource ? storageSource() : null;
}

/** Called by `attachRrweb`; pass null to unregister. */
export function registerReplaySource(getter: (() => ReplayCapture | null) | null): void {
  replaySource = getter;
}

/**
 * The buffered replay, or null when nothing is recording — and also null when
 * something is recording but has nothing small enough to send, which is the
 * buffer's own judgement rather than this file's.
 */
export function readReplay(): ReplayCapture | null {
  return replaySource ? replaySource() : null;
}
