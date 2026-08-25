import { type ReportContext } from "./report-core.ts";
/**
 * Taking the picture, and describing where it was taken.
 *
 * The screenshot is rendered from the DOM, not from the screen. That is a
 * deliberate limit: it can only ever show the page the reporter is on — never
 * another tab, another window, or the desktop behind it. In an application
 * handling anything confidential that distinction matters, because a
 * screen-capture API cannot make the same promise.
 */
export type CaptureOptions = {
    /**
     * Elements to leave out of the picture. Defaults to anything carrying
     * `data-bugbottle`, so the report panel does not photograph itself.
     */
    exclude?: (node: Node) => boolean;
    /** Longest data URL to produce. Larger captures are retried at half scale. */
    maxDataUrlLength?: number;
    /** Root to render. Defaults to `document.body`. */
    root?: HTMLElement;
};
export declare class ScreenshotTooLargeError extends Error {
    constructor();
}
/**
 * Renders the current page to a PNG data URL.
 *
 * Requires `html-to-image` to be installed; it is loaded on demand, so it stays
 * out of your bundle until someone actually reports something.
 *
 * A high-DPI screen can produce more than a server will accept, so an oversized
 * capture is retried at half scale before giving up — the size of someone's
 * monitor should not decide whether their report goes through.
 */
export declare function captureScreenshot(options?: CaptureOptions): Promise<string>;
/** Where the reporter is, and in what. Safe to call outside a browser. */
export declare function collectContext(): ReportContext;
//# sourceMappingURL=capture.d.ts.map