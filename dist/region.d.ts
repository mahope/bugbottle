/**
 * A screenshot of part of the page: an area the reporter drags, or the box
 * around an element they click.
 *
 * "The total is wrong" is quicker to triage with a picture of the total than
 * with a picture of the whole checkout, and a picture of the total is also a
 * picture of less of everything else on the screen. So this is a privacy
 * feature as much as a convenience: what is not in the rectangle never leaves
 * the browser.
 *
 * It works on the same rendered picture `captureScreenshot` takes — the DOM,
 * never the screen — and cuts the rectangle out of it on a canvas. The page is
 * rendered at the device's pixel ratio when the canvas can afford it, so a
 * small crop is sharp rather than a blurred quarter of a half-scale page.
 *
 * Own entry point (`bugbottle/region`): the overlay, its stylesheet and the
 * canvas work are in a bundle only when the application imports them. The
 * panel and the form adapters take `captureRegion` as a function handed in,
 * the same seam as `annotate`.
 */
import { type CaptureOptions, type ScreenshotRenderer } from "./capture.ts";
import { type ElementRef, type RegionRect, type ScreenshotMode, type ScreenshotRegion } from "./report-core.ts";
/** Smallest area, in CSS pixels on each side, that counts as a selection. */
export declare const DEFAULT_MIN_AREA_SIZE = 8;
/** CSS pixels of page kept around a picked element, so its edge is visible. */
export declare const DEFAULT_ELEMENT_PADDING = 8;
/**
 * The most pixels the full-page render behind a crop may have. Safari on iOS
 * refuses a canvas over 16 777 216 pixels and draws nothing rather than
 * failing, so the scale is chosen to stay under it with a little room.
 */
export declare const MAX_REGION_CANVAS_PIXELS = 16000000;
export type Point = {
    x: number;
    y: number;
};
/**
 * Where a rendered picture sits on the page and how large it came out.
 * `x`/`y`/`width`/`height` are the rendered root's box in page CSS pixels;
 * `pixelWidth`/`pixelHeight` are the picture's own size.
 */
export type PictureGeometry = RegionRect & {
    pixelWidth: number;
    pixelHeight: number;
};
/**
 * The rectangle between two pointer positions, whichever way it was dragged,
 * held inside `bounds` when they are given (a pointer captured by the overlay
 * keeps reporting positions after it leaves the window).
 */
export declare function normaliseDrag(start: Point, end: Point, bounds?: {
    width: number;
    height: number;
}): RegionRect;
/**
 * The pixels of a picture that show `rect`, a page rectangle in CSS pixels,
 * widened by `padding` on every side and clipped to the picture. Null when
 * nothing of it is in the picture.
 *
 * The scale is read off the picture rather than assumed: a renderer that was
 * asked for 2x and had to settle for less — html-to-image shrinks a canvas
 * the browser would refuse — still produces a picture this maps onto
 * correctly, and so does a device pixel ratio of 1.5 or 3.
 */
export declare function computeCropBox(rect: RegionRect, picture: PictureGeometry, padding?: number): RegionRect | null;
/**
 * The scale to render a page of this size at, before a crop: the device's
 * pixel ratio, so the crop is as sharp as what the reporter saw, lowered until
 * the whole render fits `maxPixels`. Never above 3, which is the densest
 * screen there is, and never zero.
 */
export declare function chooseRegionPixelRatio(width: number, height: number, devicePixelRatio: number, maxPixels?: number): number;
export type SelectAreaOptions = {
    /** Cancels the selection. Resolves with null. */
    signal?: AbortSignal;
    /**
     * The line on the overlay that says what to do, and its accessible name.
     * English by default; the panel passes the reporter's language.
     */
    instructions?: string;
    /** Smallest selection, in CSS pixels on each side. Smaller drags are ignored. Default 8. */
    minSize?: number;
};
/** An area the reporter selected, in page and in viewport coordinates. */
export type AreaSelection = {
    rect: RegionRect;
    viewport: RegionRect;
};
/**
 * Covers the page with a dimmed overlay and resolves with the rectangle the
 * reporter drags across it — with a mouse, a pen or a finger. Enter takes the
 * whole visible page, which is the keyboard's way through; Escape, or the
 * signal, resolves with null. A drag smaller than `minSize` is treated as a
 * stray click and ignored, so the overlay stays up.
 *
 * Focus moves to the overlay while it is up and goes back to where it was
 * when it is gone.
 */
export declare function selectArea(options?: SelectAreaOptions): Promise<AreaSelection | null>;
export type RegionCaptureOptions = SelectAreaOptions & {
    /** What to hide in the picture. The same option as `captureScreenshot`'s; on by default. */
    mask?: CaptureOptions["mask"];
    /** Elements to leave out. Defaults to anything carrying `data-bugbottle`. */
    exclude?: CaptureOptions["exclude"];
    /** Root to render. Defaults to `document.body`. */
    root?: HTMLElement;
    /**
     * Draw the rectangle on a picture of the whole page instead of cutting it
     * out. The reader sees where on the page it was, at the cost of the page
     * being in the picture. Default false.
     */
    annotate?: boolean;
    /** CSS pixels of page kept around the region. Default 8 for an element, 0 for an area. */
    padding?: number;
    /** Longest data URL to produce. Defaults to what the server accepts. */
    maxDataUrlLength?: number;
};
/** A screenshot and what it shows. `region` is absent for the whole page. */
export type RegionCapture = {
    dataUrl: string;
    region?: ScreenshotRegion;
    /** For `element`: the element itself, ready for a report's `elements`. */
    element?: ElementRef;
};
/**
 * Lets the reporter drag a rectangle over the page and resolves with a
 * screenshot of it, plus where it was. Null when they cancelled.
 *
 * ```ts
 * import { htmlToImage } from "bugbottle/html-to-image";
 * import { captureArea } from "bugbottle/region";
 * const shot = await captureArea(htmlToImage);
 * if (shot) buildReport({ type, message, screenshotDataUrl: shot.dataUrl, screenshotRegion: shot.region });
 * ```
 */
export declare function captureArea(render: ScreenshotRenderer, options?: RegionCaptureOptions): Promise<RegionCapture | null>;
/**
 * Lets the reporter click an element and resolves with a screenshot of the
 * box around it, its description (selector, tag, text, rectangle) and where
 * it was. Null when they cancelled.
 *
 * The hover box is drawn here rather than by `pickElement`, in a white frame
 * on a dark one so it shows on light and dark pages and survives forced
 * colours. A focused control can be picked from the keyboard: Enter on it is
 * a click, and the click is what is caught.
 */
export declare function captureElement(render: ScreenshotRenderer, options?: RegionCaptureOptions): Promise<RegionCapture | null>;
/**
 * One function for the three modes, which is the shape the panel and the
 * form adapters take it in: `page` is `captureScreenshot` with no region,
 * `area` is `captureArea` and `element` is `captureElement`.
 */
export declare function captureRegion(render: ScreenshotRenderer, mode: ScreenshotMode, options?: RegionCaptureOptions): Promise<RegionCapture | null>;
//# sourceMappingURL=region.d.ts.map