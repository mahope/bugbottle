/**
 * The report form as a state machine, with no framework in it.
 *
 * Every adapter — the React hook, the Vue composable, the Svelte store — is a
 * few lines of binding over this: `getState` for the current values,
 * `subscribe` for the changes, `actions` for everything the reporter can do.
 * Keeping the machine here means the three of them cannot drift apart, and
 * that a framework we have not written an adapter for is still one `subscribe`
 * away from a working form.
 *
 * The store owns its options rather than closing over them, so an adapter that
 * re-renders with fresh callbacks (React does, on every render) can hand the
 * new ones over with `setOptions` without disturbing the state.
 */
import { type CaptureOptions, type ScreenshotRenderer } from "./capture.ts";
import { type ElementRef, type ReportType } from "./report-core.ts";
import { type BuildReportInput, type SendOptions } from "./send.ts";
import type { Queue } from "./queue.ts";
import { type Messages } from "./locales.ts";
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
    kind: "queued";
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
    /**
     * What to hide in the screenshot. Field values, `contenteditable` text and
     * the `data-bugbottle-mask` / `data-bugbottle-block` regions are masked by
     * default; pass an object to narrow it, or `false` to photograph the page as
     * the reporter sees it. See `CaptureOptions["mask"]`.
     */
    mask?: CaptureOptions["mask"];
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
     * Signs the body before it is sent. Pass the signer:
     * `import { createSigner } from "bugbottle/sign"; sign: createSigner({ key })`.
     * A key in the browser is public, so this deters spam rather than
     * authenticating anybody. See the README.
     */
    sign?: SendOptions["sign"];
    /**
     * Messages shown to the reporter. Pass a bundled locale
     * (`import { da } from "bugbottle/locales"; messages: da.messages`) or
     * your own strings. Defaults to English.
     */
    messages?: Partial<Messages>;
    /**
     * Where a report goes when the send fails. Pass a queue from
     * `bugbottle/queue` and a report written during an outage is kept and
     * delivered later; the reporter sees `status.kind === "queued"` and the
     * `queued` message instead of an error they can do nothing about.
     *
     * A 4xx is never queued: the server has already said this report is not
     * acceptable, and retrying it would only fail again more quietly.
     */
    queue?: Queue;
};
/** Everything a form renders. Replaced wholesale on every change, never mutated. */
export type ReportState = {
    type: ReportType;
    message: string;
    screenshot: string | null;
    includeScreenshot: boolean;
    /** Whether a renderer was supplied, so the form can hide the checkbox. */
    canScreenshot: boolean;
    /** Elements the reporter has pointed at, in order. */
    elements: ElementRef[];
    status: BugReportStatus;
};
export type ReportActions = {
    setType: (next: ReportType) => void;
    setMessage: (next: string) => void;
    toggleScreenshot: (checked: boolean) => void;
    recapture: () => Promise<void>;
    pickElement: () => Promise<ElementRef | null>;
    cancelPick: () => void;
    removeElement: (index: number) => void;
    open: () => void;
    submit: () => Promise<boolean>;
    reset: () => void;
};
export type ReportStateStore = {
    getState: () => ReportState;
    subscribe: (listener: () => void) => () => void;
    actions: ReportActions;
    /** Hand the store the current options. Adapters that re-render call it every time. */
    setOptions: (next: UseBugReportOptions) => void;
    /** Aborts a pick in progress. Call when the form goes away. */
    destroy: () => void;
};
/**
 * The one line of the form that is not in the state: a sent or queued report
 * is announced with the reporter's own language, and an error carries the
 * message it failed with.
 */
export declare function statusText(status: BugReportStatus, messages?: Partial<Messages>): string;
export declare function createReportState(options: UseBugReportOptions): ReportStateStore;
//# sourceMappingURL=report-state.d.ts.map