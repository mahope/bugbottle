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
import type { Breadcrumb, NetworkEntry, PerfSnapshot, ReplayCapture, StorageSnapshot } from "./report-core.ts";
/** Called by `initBreadcrumbs`; pass null to unregister. */
export declare function registerBreadcrumbSource(getter: (() => Breadcrumb[]) | null): void;
/** What has been recorded, or null when nothing is recording. */
export declare function readBreadcrumbs(): Breadcrumb[] | null;
/** Called by `initNetwork`; pass null to unregister. */
export declare function registerNetworkSource(getter: (() => NetworkEntry[]) | null): void;
/** The requests recorded so far, or null when nothing is recording. */
export declare function readNetwork(): NetworkEntry[] | null;
/** Called by `initPerf`; pass null to unregister. */
export declare function registerPerfSource(getter: (() => PerfSnapshot | null) | null): void;
/**
 * What has been measured so far, or null when nothing is measuring — and also
 * null when something is measuring but has nothing to show yet, which is the
 * honest answer for a page that never painted.
 */
export declare function readPerf(): PerfSnapshot | null;
/** Called by `initPerf`; pass null to unregister. */
export declare function registerStorageSource(getter: (() => StorageSnapshot | null) | null): void;
/**
 * The stores as they are right now, or null when nothing is looking. Read at
 * report time rather than at init: what mattered is what was stored when the
 * reporter hit send.
 */
export declare function readStorage(): StorageSnapshot | null;
/** Called by `attachRrweb`; pass null to unregister. */
export declare function registerReplaySource(getter: (() => ReplayCapture | null) | null): void;
/**
 * The buffered replay, or null when nothing is recording — and also null when
 * something is recording but has nothing small enough to send, which is the
 * buffer's own judgement rather than this file's.
 */
export declare function readReplay(): ReplayCapture | null;
//# sourceMappingURL=registry.d.ts.map