/**
 * A one-slot registry so `buildReport` can pick up breadcrumbs without
 * importing the module that records them.
 *
 * `bugbottle/breadcrumbs` is a separate entry on purpose: an application that
 * never imports it must not pay for it. If `send.ts` imported `breadcrumbs.ts`
 * directly, every bundle would carry the recorder and its listeners. Instead
 * `initBreadcrumbs` registers a getter here, and `send.ts` reads it — this
 * file is a handful of bytes and has no DOM code in it at all.
 */
import type { Breadcrumb } from "./report-core.ts";
/** Called by `initBreadcrumbs`; pass null to unregister. */
export declare function registerBreadcrumbSource(getter: (() => Breadcrumb[]) | null): void;
/** What has been recorded, or null when nothing is recording. */
export declare function readBreadcrumbs(): Breadcrumb[] | null;
//# sourceMappingURL=registry.d.ts.map