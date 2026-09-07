/**
 * The report form for Vue: the same state machine as the React hook, exposed
 * as refs.
 *
 * `type` and `message` are writable computeds, so `v-model` works on them
 * directly; everything else is read-only and changes when the machine does.
 * The subscription is torn down with the effect scope the composable was
 * called in, which in a component is the component itself.
 */
import { type BugReportStatus, type UseBugReportOptions } from "../report-state.ts";
export type { BugReportStatus, UseBugReportOptions };
export { type ReportType, type ElementRef, REPORT_TYPES } from "../report-core.ts";
export { type ScreenshotRenderer } from "../capture.ts";
export declare function useBugReport(options: UseBugReportOptions): {
    /** Stops the subscription. Called for you when the effect scope ends. */
    destroy: () => void;
    toggleScreenshot: (checked: boolean) => void;
    recapture: () => Promise<void>;
    pickElement: () => Promise<import("./index.ts").ElementRef | null>;
    cancelPick: () => void;
    removeElement: (index: number) => void;
    open: () => void;
    submit: () => Promise<boolean>;
    reset: () => void;
    types: readonly ["bug", "idea", "other"];
    type: import("vue").WritableComputedRef<"bug" | "idea" | "other", "bug" | "idea" | "other">;
    setType: (next: import("./index.ts").ReportType) => void;
    message: import("vue").WritableComputedRef<string, string>;
    setMessage: (next: string) => void;
    /** Whether a renderer was supplied, so the form can hide the checkbox. */
    canScreenshot: import("vue").ComputedRef<boolean>;
    screenshot: import("vue").ComputedRef<string | null>;
    includeScreenshot: import("vue").ComputedRef<boolean>;
    /** Elements the reporter has pointed at, in order. */
    elements: import("vue").ComputedRef<import("./index.ts").ElementRef[]>;
    status: import("vue").ComputedRef<BugReportStatus>;
    /** Convenience flags, so templates do not have to match on the union. */
    isCapturing: import("vue").ComputedRef<boolean>;
    isPicking: import("vue").ComputedRef<boolean>;
    isSending: import("vue").ComputedRef<boolean>;
    statusMessage: import("vue").ComputedRef<string>;
};
//# sourceMappingURL=index.d.ts.map