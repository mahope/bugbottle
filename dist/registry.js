/**
 * A registry of slots so `buildReport` can pick up breadcrumbs, recorded
 * requests, timings and the storage snapshot without importing the modules
 * that produce them.
 *
 * `bugbottle/breadcrumbs`, `bugbottle/network` and `bugbottle/perf` are
 * separate entries on purpose: an application that never imports one must not
 * pay for it. If `send.ts` imported them directly, every bundle would carry
 * every recorder and its patches. Instead each `init*` registers a getter
 * here, and `send.ts` reads it — this file is a handful of bytes and has no
 * DOM code in it at all.
 */
let breadcrumbSource = null;
let networkSource = null;
let perfSource = null;
let storageSource = null;
/** Called by `initBreadcrumbs`; pass null to unregister. */
export function registerBreadcrumbSource(getter) {
    breadcrumbSource = getter;
}
/** What has been recorded, or null when nothing is recording. */
export function readBreadcrumbs() {
    return breadcrumbSource ? breadcrumbSource() : null;
}
/** Called by `initNetwork`; pass null to unregister. */
export function registerNetworkSource(getter) {
    networkSource = getter;
}
/** The requests recorded so far, or null when nothing is recording. */
export function readNetwork() {
    return networkSource ? networkSource() : null;
}
/** Called by `initPerf`; pass null to unregister. */
export function registerPerfSource(getter) {
    perfSource = getter;
}
/**
 * What has been measured so far, or null when nothing is measuring — and also
 * null when something is measuring but has nothing to show yet, which is the
 * honest answer for a page that never painted.
 */
export function readPerf() {
    return perfSource ? perfSource() : null;
}
/** Called by `initPerf`; pass null to unregister. */
export function registerStorageSource(getter) {
    storageSource = getter;
}
/**
 * The stores as they are right now, or null when nothing is looking. Read at
 * report time rather than at init: what mattered is what was stored when the
 * reporter hit send.
 */
export function readStorage() {
    return storageSource ? storageSource() : null;
}
//# sourceMappingURL=registry.js.map