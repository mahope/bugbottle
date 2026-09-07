import { MAX_SCREENSHOT_DATA_URL_LENGTH } from "./report-core.js";
export class ScreenshotTooLargeError extends Error {
    constructor() {
        super("Screenshot is too large even at reduced scale");
        this.name = "ScreenshotTooLargeError";
    }
}
const defaultExclude = (node) => node instanceof HTMLElement && node.dataset.bugbottle !== undefined;
/**
 * Renders the current page to a PNG data URL using the given renderer.
 *
 * A high-DPI screen can produce more than a server will accept, so an oversized
 * capture is retried at half scale before giving up — the size of someone's
 * monitor should not decide whether their report goes through.
 */
export async function captureScreenshot(render, options = {}) {
    if (typeof document === "undefined") {
        throw new Error("captureScreenshot requires a browser environment");
    }
    const maxLength = options.maxDataUrlLength ?? MAX_SCREENSHOT_DATA_URL_LENGTH;
    const exclude = options.exclude ?? defaultExclude;
    const root = options.root ?? document.body;
    const filter = (node) => !exclude(node);
    let dataUrl = await render(root, { filter, pixelRatio: 1 });
    if (dataUrl.length > maxLength) {
        dataUrl = await render(root, { filter, pixelRatio: 0.5 });
    }
    if (dataUrl.length > maxLength) {
        throw new ScreenshotTooLargeError();
    }
    return dataUrl;
}
/** Where the reporter is, and in what. Safe to call outside a browser. */
export function collectContext() {
    if (typeof window === "undefined") {
        return { url: "", viewport: "", userAgent: "" };
    }
    return {
        url: window.location.pathname + window.location.search,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        userAgent: navigator.userAgent,
    };
}
//# sourceMappingURL=capture.js.map