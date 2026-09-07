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
/** Called by `initBreadcrumbs`; pass null to unregister. */
export declare function registerBreadcrumbSource(getter: (() => Breadcrumb[]) | null): void;
/** What has been recorded, or null when nothing is recording. */
export declare function readBreadcrumbs(): Breadcrumb[] | null;
/** Called by `initNetwork`; pass null to unregister. */
export declare function registerNetworkSource(getter: (() => NetworkEntry[]) | null): void;
/** The requests recorded so far, or null when nothing is recording. */
export declare function readNetwork(): NetworkEntry[] | null;
//# sourceMappingURL=registry.d.ts.map