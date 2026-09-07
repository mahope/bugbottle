import { applyMask } from "./mask.js";
import { MAX_SCREENSHOT_DATA_URL_LENGTH } from "./report-core.js";
export class ScreenshotTooLargeError extends Error {
    constructor() {
        super("Screenshot is too large even at reduced scale");
        this.name = "ScreenshotTooLargeError";
    }
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
export const DEFAULT_BYTES_PER_PIXEL_ESTIMATE = 0.5;
/** The scale an oversized capture falls back to. */
const REDUCED_PIXEL_RATIO = 0.5;
/** `data:image/png;base64,` — the part of the data URL that is not payload. */
const DATA_URL_PREFIX_LENGTH = 22;
const defaultExclude = (node) => node instanceof HTMLElement && node.dataset.bugbottle !== undefined;
const now = () => typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
/**
 * Estimated length of the data URL a full-scale capture of `root` would
 * produce, or `undefined` when the root does not report a usable size.
 *
 * Base64 turns three bytes into four characters, so the encoded length is the
 * byte estimate times 4/3 plus the `data:` prefix.
 */
function estimateDataUrlLength(root, bytesPerPixel) {
    const width = root.scrollWidth;
    const height = root.scrollHeight;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return undefined;
    }
    return Math.ceil((width * height * bytesPerPixel * 4) / 3) + DATA_URL_PREFIX_LENGTH;
}
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
export async function captureScreenshot(render, options = {}) {
    if (typeof document === "undefined") {
        throw new Error("captureScreenshot requires a browser environment");
    }
    const maxLength = options.maxDataUrlLength ?? MAX_SCREENSHOT_DATA_URL_LENGTH;
    const exclude = options.exclude ?? defaultExclude;
    const root = options.root ?? document.body;
    const filter = (node) => !exclude(node);
    const forced = options.pixelRatio;
    const bytesPerPixel = typeof options.bytesPerPixelEstimate === "number" &&
        Number.isFinite(options.bytesPerPixelEstimate) &&
        options.bytesPerPixelEstimate > 0
        ? options.bytesPerPixelEstimate
        : DEFAULT_BYTES_PER_PIXEL_ESTIMATE;
    let pixelRatio;
    if (typeof forced === "number" && Number.isFinite(forced) && forced > 0) {
        pixelRatio = forced;
    }
    else {
        const estimate = estimateDataUrlLength(root, bytesPerPixel);
        // An unknown size is treated as small: full scale is the better picture,
        // and the retry covers us if it turns out not to fit.
        pixelRatio = estimate !== undefined && estimate > maxLength ? REDUCED_PIXEL_RATIO : 1;
    }
    const started = now();
    let attempts = 1;
    let dataUrl;
    let restore;
    try {
        // Masking is applied once and covers the retry too: the second render is
        // the same picture at a different scale, and unmasking between the two
        // would put the reporter's data in the very capture we keep. It is applied
        // inside the `try` so that a mask pass which throws part way through is
        // covered by the same `finally` as a renderer that throws.
        restore = options.mask === false ? undefined : applyMask(root, options.mask ?? {});
        dataUrl = await render(root, { filter, pixelRatio });
        if (dataUrl.length > maxLength && pixelRatio > REDUCED_PIXEL_RATIO) {
            pixelRatio = REDUCED_PIXEL_RATIO;
            attempts += 1;
            dataUrl = await render(root, { filter, pixelRatio });
        }
    }
    finally {
        // A renderer that throws leaves the page masked otherwise, and a form full
        // of bullets is worse than a missing screenshot.
        restore?.();
    }
    const ms = now() - started;
    if (options.onCapture) {
        try {
            options.onCapture({ pixelRatio, length: dataUrl.length, attempts, ms });
        }
        catch {
            // A misbehaving callback is not a reason to lose the screenshot.
        }
    }
    if (dataUrl.length > maxLength) {
        throw new ScreenshotTooLargeError();
    }
    return dataUrl;
}
/**
 * Where the reporter is, and in what. Safe to call outside a browser.
 *
 * Everything past the first three fields is best-effort: each is read behind a
 * guard and left out when the browser does not offer it, because a missing
 * fact is not worth a thrown context. None of it says more about the person
 * than the user agent already does — no fingerprinting beyond these fields.
 */
export function collectContext() {
    if (typeof window === "undefined") {
        return { url: "", viewport: "", userAgent: "" };
    }
    // Read through `window` rather than the bare globals: they are the same
    // object in a browser, and it keeps the whole context readable from one
    // place — including in a test that stands a fake window up.
    const nav = window.navigator;
    const context = {
        url: window.location.pathname + window.location.search,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        userAgent: nav.userAgent,
    };
    if (nav.language)
        context.language = nav.language;
    try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (zone)
            context.timezone = zone;
    }
    catch {
        // A runtime without a full ICU build has no zone to give.
    }
    const screen = window.screen;
    if (screen)
        context.screen = `${screen.width}x${screen.height}@${window.devicePixelRatio ?? 1}`;
    try {
        if (typeof window.matchMedia === "function") {
            context.colorScheme = window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light";
        }
    }
    catch {
        // An unsupported media query throws in some embedded browsers.
    }
    if (typeof nav.onLine === "boolean")
        context.online = nav.onLine;
    const connection = nav.connection;
    if (connection && typeof connection.effectiveType === "string") {
        context.connection = connection.effectiveType;
    }
    return context;
}
//# sourceMappingURL=capture.js.map