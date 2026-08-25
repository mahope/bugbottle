import { type ReportType } from "../report-core.ts";
/**
 * Everything a report form needs, and none of its markup.
 *
 * The hook is headless on purpose. The chrome around a feedback form is exactly
 * the part that differs between applications — one has a toast layer, the next
 * announces inline; one has a Button component, the next has three. Shipping
 * opinionated markup means every consumer fights it. So this owns the state
 * machine, the capture, and the submit, and you render whatever fits.
 */
export type BugReportStatus = {
    kind: "idle";
} | {
    kind: "capturing";
} | {
    kind: "sending";
} | {
    kind: "sent";
    id?: string;
} | {
    kind: "error";
    reason: "empty" | "screenshot-too-large" | "screenshot-failed" | "send-failed";
    message: string;
};
export type UseBugReportOptions = {
    /** Endpoint that receives the report. Required. */
    endpoint: string;
    /** Type selected when the form opens. Defaults to "bug". */
    initialType?: ReportType;
    /**
     * Whether to arm the screenshot for this type. Defaults to arming it for
     * bugs only, where the picture nearly always helps.
     */
    screenshotFor?: (type: ReportType) => boolean;
    /** Attach the recorded console errors for this type. Defaults to bugs only. */
    consoleFor?: (type: ReportType) => boolean;
    /** Extra fields to send alongside the report. */
    extra?: Record<string, unknown>;
    /** Called after a successful submit. */
    onSent?: (id: string | undefined) => void;
    /** Turn a failed response into a message. Defaults to the body's `error`/`message`. */
    parseError?: (response: Response, body: unknown) => string;
    /** Messages shown to the reporter. Supply translated strings here. */
    messages?: Partial<Record<"empty" | "screenshotTooLarge" | "screenshotFailed" | "sendFailed" | "sent", string>>;
};
export declare function useBugReport(options: UseBugReportOptions): {
    types: readonly ["bug", "idea", "other"];
    type: "bug" | "idea" | "other";
    setType: (next: ReportType) => void;
    message: string;
    setMessage: import("react").Dispatch<import("react").SetStateAction<string>>;
    screenshot: string | null;
    includeScreenshot: boolean;
    toggleScreenshot: (checked: boolean) => void;
    recapture: () => Promise<void>;
    open: () => void;
    submit: () => Promise<boolean>;
    status: BugReportStatus;
    /** Convenience flags, so consumers do not have to match on the union. */
    isCapturing: boolean;
    isSending: boolean;
    statusMessage: string;
};
//# sourceMappingURL=use-bug-report.d.ts.map