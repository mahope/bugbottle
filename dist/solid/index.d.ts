/**
 * The report form for Solid: the same state machine as the React hook, exposed
 * as accessors.
 *
 * Every value is a function, the way Solid reads reactive state, so `state()`
 * in the JSX tracks it and nothing else has to. The subscription is torn down
 * with the owner the function was called in, which in a component is the
 * component itself; `destroy` is returned for the callers who have no owner.
 */
import { type Accessor } from "solid-js";
import { type BugReportStatus, type UseBugReportOptions } from "../report-state.ts";
export type { BugReportStatus, UseBugReportOptions };
export { type ReportType, type ElementRef, REPORT_TYPES } from "../report-core.ts";
export { type ScreenshotRenderer } from "../capture.ts";
export declare function createBugReport(options: UseBugReportOptions): {
    /** Stops the subscription. Called for you when the owner is disposed. */
    destroy: () => void;
    setType: (next: import("./index.ts").ReportType) => void;
    setMessage: (next: string) => void;
    toggleScreenshot: (checked: boolean) => void;
    recapture: () => Promise<void>;
    pickElement: () => Promise<import("./index.ts").ElementRef | null>;
    cancelPick: () => void;
    removeElement: (index: number) => void;
    open: () => void;
    submit: () => Promise<boolean>;
    reset: () => void;
    types: readonly ["bug", "idea", "other"];
    type: () => "bug" | "idea" | "other";
    message: () => string;
    /** Whether a renderer was supplied, so the form can hide the checkbox. */
    canScreenshot: () => boolean;
    screenshot: () => string | null;
    includeScreenshot: () => boolean;
    /** Elements the reporter has pointed at, in order. */
    elements: () => import("./index.ts").ElementRef[];
    status: Accessor<BugReportStatus>;
    /** Convenience flags, so the JSX does not have to match on the union. */
    isCapturing: () => boolean;
    isPicking: () => boolean;
    isSending: () => boolean;
    statusMessage: () => string;
};
//# sourceMappingURL=index.d.ts.map