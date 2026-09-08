/**
 * The report form for Svelte: the same state machine as the React hook,
 * exposed as a readable store plus the actions.
 *
 * `const form = createBugReport({ endpoint })` and then `$form.message` in the
 * markup, `form.setMessage(...)` in the handlers. The store contract is
 * implemented here rather than imported from `svelte/store` — it is one
 * function, and this way the adapter has no runtime dependency on Svelte at
 * all, only a type.
 */
import { type ReportType } from "../report-core.ts";
import { type BugReportStatus, type ReportState, type UseBugReportOptions } from "../report-state.ts";
export type { BugReportStatus, UseBugReportOptions };
export { type ReportType, type ElementRef, REPORT_TYPES } from "../report-core.ts";
export { type ScreenshotRenderer } from "../capture.ts";
/** What `$form` holds: the state, plus the values a template would derive. */
export type BugReportView = ReportState & {
    types: readonly ReportType[];
    isCapturing: boolean;
    isPicking: boolean;
    isSending: boolean;
    statusMessage: string;
};
export declare function createBugReport(options: UseBugReportOptions): {
    /** Aborts a pick in progress. Call from `onDestroy` if the form can unmount mid-pick. */
    destroy: () => void;
    setType: (next: ReportType) => void;
    setMessage: (next: string) => void;
    setContact: (next: string) => void;
    toggleScreenshot: (checked: boolean) => void;
    recapture: () => Promise<void>;
    pickElement: () => Promise<import("./index.ts").ElementRef | null>;
    cancelPick: () => void;
    removeElement: (index: number) => void;
    open: () => void;
    submit: () => Promise<boolean>;
    reset: () => void;
    subscribe: (this: void, run: import("svelte/store").Subscriber<BugReportView>, invalidate?: () => void) => import("svelte/store").Unsubscriber;
    types: readonly ["bug", "idea", "other"];
};
//# sourceMappingURL=index.d.ts.map