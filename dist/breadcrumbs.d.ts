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
import { type Breadcrumb, type BreadcrumbKind } from "./report-core.ts";
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
/**
 * Starts recording. Call it as early as your app can manage — anything that
 * happened before this is not in the buffer.
 *
 * Safe to call more than once; only the first call attaches listeners. Nothing
 * here throws in a server-rendered pass: without a `document` there is simply
 * nothing to listen to. `maxEntries: 0` records nothing: no listeners are
 * attached at all, since a buffer that throws every crumb away is pure cost.
 */
export declare function initBreadcrumbs(options?: BreadcrumbsOptions): void;
/** A copy of what has been recorded so far, oldest first. */
export declare function getBreadcrumbs(): Breadcrumb[];
/** Whether `initBreadcrumbs` has run and not been reset since. */
export declare function isBreadcrumbsActive(): boolean;
/** Empties the buffer, removes the listeners and unpatches `history`. */
export declare function resetBreadcrumbs(): void;
//# sourceMappingURL=breadcrumbs.d.ts.map