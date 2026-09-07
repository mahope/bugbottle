/**
 * A two-slot registry so `buildReport` can pick up breadcrumbs and recorded
 * requests without importing the modules that record them.
 *
 * `bugbottle/breadcrumbs` and `bugbottle/network` are separate entries on
 * purpose: an application that never imports one must not pay for it. If
 * `send.ts` imported them directly, every bundle would carry both recorders
 * and their patches. Instead each `init*` registers a getter here, and
 * `send.ts` reads it — this file is a handful of bytes and has no DOM code in
 * it at all.
 */

import type { Breadcrumb, NetworkEntry } from "./report-core.ts";

let breadcrumbSource: (() => Breadcrumb[]) | null = null;
let networkSource: (() => NetworkEntry[]) | null = null;

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
