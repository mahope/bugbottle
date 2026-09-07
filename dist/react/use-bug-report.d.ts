import { type BugReportStatus, type UseBugReportOptions } from "../report-state.ts";
/**
 * Everything a report form needs, and none of its markup.
 *
 * The hook is headless on purpose. The chrome around a feedback form is exactly
 * the part that differs between applications — one has a toast layer, the next
 * announces inline; one has a Button component, the next has three. Shipping
 * opinionated markup means every consumer fights it. So this owns the state
 * machine, the capture, and the submit, and you render whatever fits.
 *
 * The machine itself lives in `../report-state.ts`, which knows nothing about
 * React; this file is the subscription and the render values. The Vue and
 * Svelte adapters are the same few lines against their own primitives.
 */
export type { BugReportStatus, UseBugReportOptions };
export declare function useBugReport(options: UseBugReportOptions): {
    /** Convenience flags, so consumers do not have to match on the union. */
    isCapturing: boolean;
    isPicking: boolean;
    isSending: boolean;
    statusMessage: string;
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
    type: import("./index.ts").ReportType;
    message: string;
    screenshot: string | null;
    includeScreenshot: boolean;
    canScreenshot: boolean;
    elements: import("./index.ts").ElementRef[];
    status: BugReportStatus;
    types: readonly ["bug", "idea", "other"];
};
//# sourceMappingURL=use-bug-report.d.ts.map