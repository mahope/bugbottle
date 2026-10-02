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
import { captureScreenshot, ScreenshotTooLargeError, } from "./capture.js";
import { pickElement } from "./element-picker.js";
import { MAX_SCREENSHOT_DATA_URL_LENGTH, } from "./report-core.js";
/** Smallest area, in CSS pixels on each side, that counts as a selection. */
export const DEFAULT_MIN_AREA_SIZE = 8;
/** CSS pixels of page kept around a picked element, so its edge is visible. */
export const DEFAULT_ELEMENT_PADDING = 8;
/**
 * The most pixels the full-page render behind a crop may have. Safari on iOS
 * refuses a canvas over 16 777 216 pixels and draws nothing rather than
 * failing, so the scale is chosen to stay under it with a little room.
 */
export const MAX_REGION_CANVAS_PIXELS = 16_000_000;
const AREA_INSTRUCTIONS = "Drag to select an area. Enter takes the visible page, Escape cancels.";
const ELEMENT_INSTRUCTIONS = "Click an element, or Tab to it and press Enter. Escape cancels.";
/**
 * The rectangle between two pointer positions, whichever way it was dragged,
 * held inside `bounds` when they are given (a pointer captured by the overlay
 * keeps reporting positions after it leaves the window).
 */
export function normaliseDrag(start, end, bounds) {
    const clampX = (v) => (bounds ? Math.min(Math.max(v, 0), bounds.width) : v);
    const clampY = (v) => (bounds ? Math.min(Math.max(v, 0), bounds.height) : v);
    const x1 = clampX(Math.min(start.x, end.x));
    const y1 = clampY(Math.min(start.y, end.y));
    const x2 = clampX(Math.max(start.x, end.x));
    const y2 = clampY(Math.max(start.y, end.y));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
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
export function computeCropBox(rect, picture, padding = 0) {
    if (!(picture.width > 0) || !(picture.height > 0))
        return null;
    const sx = picture.pixelWidth / picture.width;
    const sy = picture.pixelHeight / picture.height;
    const left = Math.max(0, Math.floor((rect.x - padding - picture.x) * sx));
    const top = Math.max(0, Math.floor((rect.y - padding - picture.y) * sy));
    const right = Math.min(picture.pixelWidth, Math.ceil((rect.x + rect.width + padding - picture.x) * sx));
    const bottom = Math.min(picture.pixelHeight, Math.ceil((rect.y + rect.height + padding - picture.y) * sy));
    if (!(right > left) || !(bottom > top))
        return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
}
/**
 * The scale to render a page of this size at, before a crop: the device's
 * pixel ratio, so the crop is as sharp as what the reporter saw, lowered until
 * the whole render fits `maxPixels`. Never above 3, which is the densest
 * screen there is, and never zero.
 */
export function chooseRegionPixelRatio(width, height, devicePixelRatio, maxPixels = MAX_REGION_CANVAS_PIXELS) {
    const wanted = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.min(devicePixelRatio, 3) : 1;
    const area = width * height;
    if (!(area > 0))
        return wanted;
    const fits = Math.sqrt(maxPixels / area);
    return Math.max(0.1, Math.min(wanted, fits));
}
/*
 * The overlay's own sheet. The essentials are also set inline, so the overlay
 * still works under a policy that refuses inline `<style>`; what lives only
 * here is the forced-colours redraw, where a dim and a white edge are both
 * replaced with the reporter's palette and would otherwise disappear. Nothing
 * moves, so `prefers-reduced-motion` has nothing to turn off.
 */
const CSS = ".hint{position:fixed;left:50%;top:12px;transform:translateX(-50%);margin:0;padding:8px 14px;" +
    "max-width:calc(100vw - 32px);background:#111827;color:#fff;border:1px solid #fff;border-radius:8px;" +
    "font:600 14px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;pointer-events:none}" +
    ".box{position:fixed;pointer-events:none;border:2px solid #fff;outline:2px solid #111827;" +
    "box-shadow:0 0 0 9999px rgba(17,24,39,.35)}" +
    "@media (forced-colors:active){.hint{border-color:CanvasText}" +
    ".box{border-color:Highlight;outline-color:CanvasText;box-shadow:none}}";
const DIM = "rgba(17,24,39,.35)";
/**
 * The layer the two modes draw on: a hint saying what to do and a box over
 * the selection. It carries `data-bugbottle`, so it is never in a screenshot
 * and never pickable. In area mode it covers the page and takes the pointer;
 * in element mode it lets the pointer through to the page underneath.
 */
function mountOverlay(text, interactive) {
    const host = document.createElement("div");
    host.dataset.bugbottle = "region";
    host.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;" +
            (interactive
                ? `cursor:crosshair;touch-action:none;background:${DIM};outline:none`
                : "pointer-events:none");
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = text;
    // `role="status"` so the instruction is read out when it appears, which is
    // the only way a screen reader learns the page just changed mode.
    hint.setAttribute("role", "status");
    const box = document.createElement("div");
    box.className = "box";
    box.style.cssText = "position:fixed;pointer-events:none;border:2px solid #fff;display:none";
    root.append(style, hint, box);
    if (interactive) {
        // A dialog with nothing in it but a gesture: named by the instruction so
        // focus landing on it says what it is for.
        host.setAttribute("role", "dialog");
        host.setAttribute("aria-modal", "true");
        host.setAttribute("aria-label", text);
        host.tabIndex = -1;
    }
    document.body.appendChild(host);
    return {
        host,
        box,
        show(rect) {
            // While a box is up its own shadow does the dimming, so the inside of
            // the selection is the page as it is rather than dimmed twice over.
            if (interactive)
                host.style.background = rect ? "transparent" : DIM;
            if (!rect) {
                box.style.display = "none";
                return;
            }
            box.style.display = "block";
            box.style.left = `${rect.x}px`;
            box.style.top = `${rect.y}px`;
            box.style.width = `${rect.width}px`;
            box.style.height = `${rect.height}px`;
        },
        remove() {
            host.remove();
        },
    };
}
const scroll = () => ({ x: window.scrollX || 0, y: window.scrollY || 0 });
const viewportSize = () => ({ width: window.innerWidth, height: window.innerHeight });
/** A page rectangle and the viewport one beside it, both rounded. */
function bothRects(page) {
    const at = scroll();
    const round = (r) => ({
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
    });
    return {
        rect: round(page),
        viewport: round({ ...page, x: page.x - at.x, y: page.y - at.y }),
    };
}
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
export function selectArea(options = {}) {
    if (typeof document === "undefined") {
        return Promise.reject(new Error("selectArea requires a browser environment"));
    }
    const asked = options.minSize;
    const minSize = typeof asked === "number" && Number.isFinite(asked) ? Math.max(1, asked) : DEFAULT_MIN_AREA_SIZE;
    return new Promise((resolve) => {
        if (options.signal?.aborted) {
            resolve(null);
            return;
        }
        const layer = mountOverlay(options.instructions ?? AREA_INSTRUCTIONS, true);
        const { host } = layer;
        const previous = document.activeElement;
        // Page coordinates at the press, so a wheel scroll in the middle of a drag
        // still selects what the reporter swept across.
        let start = null;
        let pointer = -1;
        const pageAt = (e) => {
            const at = scroll();
            const v = viewportSize();
            return {
                x: Math.min(Math.max(e.clientX, 0), v.width) + at.x,
                y: Math.min(Math.max(e.clientY, 0), v.height) + at.y,
            };
        };
        const current = (e) => {
            if (!start)
                return null;
            return normaliseDrag(start, pageAt(e));
        };
        const finish = (result) => {
            host.removeEventListener("pointerdown", onDown);
            host.removeEventListener("pointermove", onMove);
            host.removeEventListener("pointerup", onUp);
            host.removeEventListener("pointercancel", onCancel);
            document.removeEventListener("keydown", onKey, true);
            options.signal?.removeEventListener("abort", onAbort);
            layer.remove();
            previous?.focus?.();
            resolve(result);
        };
        const onDown = (e) => {
            if (e.button > 0)
                return;
            e.preventDefault();
            pointer = e.pointerId;
            start = pageAt(e);
            try {
                host.setPointerCapture(e.pointerId);
            }
            catch {
                // A synthetic event has no pointer to capture; the drag still works
                // while it stays over the overlay, which is all of the window.
            }
        };
        const onMove = (e) => {
            if (e.pointerId !== pointer)
                return;
            const page = current(e);
            if (!page)
                return;
            const at = scroll();
            layer.show({ ...page, x: page.x - at.x, y: page.y - at.y });
        };
        const onUp = (e) => {
            if (e.pointerId !== pointer)
                return;
            const page = current(e);
            start = null;
            pointer = -1;
            if (!page || page.width < minSize || page.height < minSize) {
                layer.show(null);
                return;
            }
            finish(bothRects(page));
        };
        const onCancel = () => {
            // The browser took the gesture over — a system swipe, a palm. Start again.
            start = null;
            pointer = -1;
            layer.show(null);
        };
        const onKey = (e) => {
            // A held Enter from the button that opened the overlay is not a choice.
            if (e.repeat)
                return;
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                finish(null);
            }
            else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                const at = scroll();
                finish(bothRects({ x: at.x, y: at.y, ...viewportSize() }));
            }
        };
        const onAbort = () => finish(null);
        host.addEventListener("pointerdown", onDown);
        host.addEventListener("pointermove", onMove);
        host.addEventListener("pointerup", onUp);
        host.addEventListener("pointercancel", onCancel);
        document.addEventListener("keydown", onKey, true);
        options.signal?.addEventListener("abort", onAbort);
        host.focus();
    });
}
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("The screenshot could not be decoded"));
        img.src = src;
    });
}
function canvas2d(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("A 2D canvas is not available");
    return { canvas, ctx };
}
/** Where the rendered root is on the page, in CSS pixels. */
function rootBox(root) {
    const r = root.getBoundingClientRect();
    const at = scroll();
    return { x: r.left + at.x, y: r.top + at.y, width: r.width, height: r.height };
}
/**
 * Renders the page and turns it into the picture of one region: cut out, or
 * outlined on the whole page when `annotate` is set. Fails like
 * `captureScreenshot` does — `ScreenshotTooLargeError` when even half the
 * scale will not fit — so a caller handles both the same way.
 */
async function shoot(render, selection, mode, options, selector) {
    const root = options.root ?? document.body;
    const maxLength = options.maxDataUrlLength ?? MAX_SCREENSHOT_DATA_URL_LENGTH;
    const padding = options.padding ?? (mode === "element" ? DEFAULT_ELEMENT_PADDING : 0);
    const box = rootBox(root);
    const region = { mode, rect: selection.rect, viewport: selection.viewport };
    if (selector)
        region.selector = selector;
    const base = { mask: options.mask, exclude: options.exclude, root };
    if (options.annotate) {
        // The whole page under the usual size rules, then a frame drawn on it.
        const source = await captureScreenshot(render, { ...base, maxDataUrlLength: maxLength });
        const img = await loadImage(source);
        const at = computeCropBox(selection.rect, { ...box, pixelWidth: img.naturalWidth, pixelHeight: img.naturalHeight }, padding);
        region.annotated = true;
        // The frame adds a little to a picture that only just fitted, so it steps
        // down the way a crop does rather than failing on the last few bytes.
        for (const scale of [1, 0.5, 0.25]) {
            const { canvas, ctx } = canvas2d(img.naturalWidth * scale, img.naturalHeight * scale);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            if (at) {
                // Two strokes, dark under light, so the frame reads on any page colour.
                const line = Math.max(2, Math.round((canvas.width / box.width) * 2));
                for (const [colour, width] of [["#111827", line * 2], ["#facc15", line]]) {
                    ctx.strokeStyle = colour;
                    ctx.lineWidth = width;
                    ctx.strokeRect(at.x * scale, at.y * scale, at.width * scale, at.height * scale);
                }
            }
            const dataUrl = canvas.toDataURL("image/png");
            if (dataUrl.length <= maxLength)
                return { dataUrl, region };
        }
        throw new ScreenshotTooLargeError();
    }
    const pixelRatio = chooseRegionPixelRatio(box.width, box.height, window.devicePixelRatio || 1);
    // The full render is a means, not the result, so it is not held to the
    // report's size limit — the crop is, below.
    const source = await captureScreenshot(render, {
        ...base,
        pixelRatio,
        maxDataUrlLength: Number.MAX_SAFE_INTEGER,
    });
    const img = await loadImage(source);
    const crop = computeCropBox(selection.rect, { ...box, pixelWidth: img.naturalWidth, pixelHeight: img.naturalHeight }, padding);
    if (!crop)
        throw new Error("The selected region is outside the rendered page");
    // Full size first, then half, then a quarter: a crop of a dense screen can
    // still be larger than the server takes, and a smaller picture of the right
    // place beats none.
    for (const scale of [1, 0.5, 0.25]) {
        const { canvas, ctx } = canvas2d(crop.width * scale, crop.height * scale);
        ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        if (dataUrl.length <= maxLength)
            return { dataUrl, region };
    }
    throw new ScreenshotTooLargeError();
}
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
export async function captureArea(render, options = {}) {
    const selection = await selectArea(options);
    if (!selection)
        return null;
    return shoot(render, selection, "area", options);
}
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
export async function captureElement(render, options = {}) {
    if (typeof document === "undefined") {
        throw new Error("captureElement requires a browser environment");
    }
    const layer = mountOverlay(options.instructions ?? ELEMENT_INSTRUCTIONS, false);
    let element;
    try {
        element = await pickElement({
            signal: options.signal,
            highlight: false,
            onHover(el) {
                if (!el)
                    return layer.show(null);
                const r = el.getBoundingClientRect();
                layer.show({ x: r.left, y: r.top, width: r.width, height: r.height });
            },
        });
    }
    finally {
        layer.remove();
    }
    if (!element)
        return null;
    const capture = await shoot(render, bothRects(element.rect), "element", options, element.selector);
    return { ...capture, element };
}
/**
 * One function for the three modes, which is the shape the panel and the
 * form adapters take it in: `page` is `captureScreenshot` with no region,
 * `area` is `captureArea` and `element` is `captureElement`.
 */
export async function captureRegion(render, mode, options = {}) {
    if (mode === "area")
        return captureArea(render, options);
    if (mode === "element")
        return captureElement(render, options);
    return {
        dataUrl: await captureScreenshot(render, {
            mask: options.mask,
            exclude: options.exclude,
            root: options.root,
            maxDataUrlLength: options.maxDataUrlLength,
        }),
    };
}
//# sourceMappingURL=region.js.map