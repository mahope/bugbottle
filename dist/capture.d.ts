import { type MaskOptions } from "./mask.ts";
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
 * leave out; `pixelRatio` is the scale to render at — 1 for a full-scale
 * capture and 0.5 for the reduced one.
 */
export type ScreenshotRenderer = (root: HTMLElement, options: {
    filter: (node: Node) => boolean;
    pixelRatio: number;
}) => Promise<string>;
/** What one call to `captureScreenshot` cost, and what it settled on. */
export type CaptureInfo = {
    /** The scale the returned picture was rendered at. */
    pixelRatio: number;
    /** Length of the resulting data URL, in characters. */
    length: number;
    /** Renders performed: 1 when the scale was right the first time, 2 after a retry. */
    attempts: number;
    /** Wall-clock milliseconds spent rendering. */
    ms: number;
};
export type CaptureOptions = {
    /**
     * Elements to leave out of the picture. Defaults to anything carrying
     * `data-bugbottle`, so the report panel does not photograph itself.
     */
    exclude?: (node: Node) => boolean;
    /**
     * What to hide before the picture is taken. On by default: input and
     * textarea values, `contenteditable` text, the text of anything marked
     * `data-bugbottle-mask`, and a solid overlay over anything marked
     * `data-bugbottle-block`. The elements stay where they are, so the layout of
     * the screenshot is unchanged — unlike `exclude`, which removes the node.
     *
     * Pass an object to narrow it, or `false` to photograph the page as it is.
     * Everything is restored the moment the renderer returns, including when it
     * throws.
     */
    mask?: MaskOptions | false;
    /** Longest data URL to produce. Larger captures are retried at half scale. */
    maxDataUrlLength?: number;
    /** Root to render. Defaults to `document.body`. */
    root?: HTMLElement;
    /**
     * Force a scale instead of estimating one. A value above the reduced scale
     * still gets the one retry; anything at or below it is taken as final.
     * Ignored unless it is a finite number greater than zero.
     */
    pixelRatio?: number;
    /**
     * Bytes of PNG assumed per CSS pixel when estimating whether a full-scale
     * capture would fit. See `DEFAULT_BYTES_PER_PIXEL_ESTIMATE`.
     */
    bytesPerPixelEstimate?: number;
    /**
     * Called once per capture with the scale used, the size produced, how many
     * renders it took and how long they took. Called for a rejected capture too,
     * just before `ScreenshotTooLargeError` is thrown, so a caller measuring
     * capture time sees the expensive cases as well as the cheap ones. Anything
     * it throws is ignored: reporting must never break the picture.
     */
    onCapture?: (info: CaptureInfo) => void;
};
export declare class ScreenshotTooLargeError extends Error {
    constructor();
}
/**
 * Bytes of encoded PNG assumed per CSS pixel of capture area.
 *
 * A typical application UI is flat colour, straight edges and text, which is
 * exactly what PNG's filtering and DEFLATE compress well: measured captures of
 * ordinary pages land well under half a byte per pixel, and only pages that are
 * mostly photographs approach one. Half a byte is therefore a deliberately
 * pessimistic first guess — it over-estimates the common case, so the estimate
 * errs towards the reduced scale rather than towards a wasted full-scale
 * render. The retry still exists for when it guesses low; this only decides
 * which scale we try first. Applications that know their own pages can pass
 * `bytesPerPixelEstimate`.
 */
export declare const DEFAULT_BYTES_PER_PIXEL_ESTIMATE = 0.5;
/**
 * Renders the current page to a PNG data URL using the given renderer.
 *
 * Rendering is expensive and the cost is almost all in walking the live DOM and
 * inlining its styles; the scale only affects the final raster step, so a retry
 * costs about as much as the first attempt did. On a page that was never going
 * to fit, that doubles the reporter's wait for nothing. So the scale is chosen
 * up front from the capture area — cheap to read, and roughly what decides the
 * size — and the retry is kept only as the safety net for when that guess is
 * wrong.
 */
export declare function captureScreenshot(render: ScreenshotRenderer, options?: CaptureOptions): Promise<string>;
/**
 * Where the reporter is, and in what. Safe to call outside a browser.
 *
 * Everything past the first three fields is best-effort: each is read behind a
 * guard and left out when the browser does not offer it, because a missing
 * fact is not worth a thrown context. None of it says more about the person
 * than the user agent already does — no fingerprinting beyond these fields.
 */
export declare function collectContext(): ReportContext;
//# sourceMappingURL=capture.d.ts.map