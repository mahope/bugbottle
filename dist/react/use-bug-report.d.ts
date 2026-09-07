import { type ScreenshotRenderer } from "../capture.ts";
import { type ElementRef, type ReportType } from "../report-core.ts";
import { type BuildReportInput, type SendOptions } from "../send.ts";
import { type Messages } from "../locales.ts";
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
    kind: "picking";
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
    /**
     * How to take the picture. Without it, screenshots are off and
     * `canScreenshot` is false. `import { htmlToImage } from "bugbottle/html-to-image"`
     * is the ready-made one.
     */
    screenshot?: ScreenshotRenderer;
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
    /** Extra request headers — an auth token, a CSRF header. */
    headers?: SendOptions["headers"];
    /** Passed to `fetch`. Set to `"include"` for a cross-origin endpoint that needs cookies. */
    credentials?: SendOptions["credentials"];
    /** Give up on the endpoint after this long. Default 15 000 ms. */
    timeoutMs?: SendOptions["timeoutMs"];
    /** Called after a successful submit. */
    onSent?: (id: string | undefined) => void;
    /** Turn a failed response into a message. Defaults to the body's `error`/`message`. */
    parseError?: SendOptions["parseError"];
    /**
     * Redact the assembled report before it is sent. Pass the scrubber:
     * `import { scrubReport } from "bugbottle"; scrub: scrubReport`.
     */
    scrub?: BuildReportInput["scrub"];
    /**
     * Last look at the report. Return it, a changed copy, or `null` to drop it.
     * A dropped report still shows the reporter the ordinary thank-you: they
     * wrote it in good faith, and telling them it was discarded helps nobody.
     */
    beforeSend?: SendOptions["beforeSend"];
    /**
     * Messages shown to the reporter. Pass a bundled locale
     * (`import { da } from "bugbottle/locales"; messages: da.messages`) or
     * your own strings. Defaults to English.
     */
    messages?: Partial<Messages>;
};
export declare function useBugReport(options: UseBugReportOptions): {
    types: readonly ["bug", "idea", "other"];
    type: "bug" | "idea" | "other";
    setType: (next: ReportType) => void;
    message: string;
    setMessage: import("react").Dispatch<import("react").SetStateAction<string>>;
    /** Whether a renderer was supplied, so the form can hide the checkbox. */
    canScreenshot: boolean;
    screenshot: string | null;
    includeScreenshot: boolean;
    toggleScreenshot: (checked: boolean) => void;
    recapture: () => Promise<void>;
    /** Elements the reporter has pointed at, in order. */
    elements: ElementRef[];
    pickElement: () => Promise<ElementRef | null>;
    cancelPick: () => void | undefined;
    removeElement: (index: number) => void;
    open: () => void;
    submit: () => Promise<boolean>;
    reset: () => void;
    status: BugReportStatus;
    /** Convenience flags, so consumers do not have to match on the union. */
    isCapturing: boolean;
    isPicking: boolean;
    isSending: boolean;
    statusMessage: string;
};
//# sourceMappingURL=use-bug-report.d.ts.map