import { type ReportContext } from "./report-core.ts";
/**
 * Taking the picture, and describing where it was taken.
 *
 * The screenshot is rendered from the DOM, not from the screen. That is a
 * deliberate limit: it can only ever show the page the reporter is on — never
 * another tab, another window, or the desktop behind it. In an application
 * handling anything confidential that distinction matters, because a
 * screen-capture API cannot make the same promise.
 *
 * The renderer is passed in rather than imported. A bundler resolves every
 * import it can see, optional or not, so importing `html-to-image` here would
 * make it a hard dependency for everyone — including the applications that
 * never take a picture. `bugbottle/html-to-image` exports a ready-made
 * renderer; import it only where you want screenshots.
 */
/**
 * Renders an element to a PNG data URL. `filter` returns false for nodes to
 * leave out; `pixelRatio` is 1 for a first attempt and 0.5 for the retry.
 */
export type ScreenshotRenderer = (root: HTMLElement, options: {
    filter: (node: Node) => boolean;
    pixelRatio: number;
}) => Promise<string>;
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
 * Renders the current page to a PNG data URL using the given renderer.
 *
 * A high-DPI screen can produce more than a server will accept, so an oversized
 * capture is retried at half scale before giving up — the size of someone's
 * monitor should not decide whether their report goes through.
 */
export declare function captureScreenshot(render: ScreenshotRenderer, options?: CaptureOptions): Promise<string>;
/** Where the reporter is, and in what. Safe to call outside a browser. */
export declare function collectContext(): ReportContext;
//# sourceMappingURL=capture.d.ts.map