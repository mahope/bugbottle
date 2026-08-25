/**
 * The shape of a report and the rules for validating one — no DOM, no network,
 * no storage. Both ends import this: the browser to build a report, the server
 * to check the one it received.
 *
 * The screenshot is the part that needs real care. It arrives as a data URL
 * from a browser, which means it is attacker-controlled input that a server is
 * about to write to storage, so its shape is checked rather than trusted.
 */
export const REPORT_TYPES = ["bug", "idea", "other"];
/** Decoded ceiling for a screenshot. The client downscales before this. */
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
/** Base64 inflates by about a third; the prefix is the rest of the slack. */
export const MAX_SCREENSHOT_DATA_URL_LENGTH = 2_900_000;
export const MAX_MESSAGE_LENGTH = 4000;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export function isReportType(value) {
    return typeof value === "string" && REPORT_TYPES.includes(value);
}
/**
 * Trims and length-checks the reporter's message.
 * Returns null when there is nothing worth storing.
 */
export function normaliseMessage(raw, maxLength = MAX_MESSAGE_LENGTH) {
    if (typeof raw !== "string")
        return null;
    const text = raw.trim();
    if (text.length === 0)
        return null;
    return text.slice(0, maxLength);
}
/**
 * Clips the context strings. A browser can send a user-agent of any length,
 * and this ends up in your database.
 */
export function normaliseContext(raw) {
    const obj = (raw ?? {});
    const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
    return {
        url: str(obj.url, 500),
        viewport: str(obj.viewport, 32),
        userAgent: str(obj.userAgent, 500),
    };
}
export class InvalidScreenshotError extends Error {
    constructor(message) {
        super(message);
        this.name = "InvalidScreenshotError";
    }
}
/**
 * Turns a PNG data URL into bytes, or throws InvalidScreenshotError.
 *
 * Checks the declared type, the real PNG signature in the decoded bytes, and a
 * size ceiling — so a JPEG wearing a PNG label, a login page returned as HTML,
 * or a 40 MB payload never reaches storage.
 *
 * Treat a failure as "store the report without the picture" rather than as a
 * failed submission: the message is the valuable part.
 */
export function decodeScreenshotDataUrl(dataUrl, options = {}) {
    const maxBytes = options.maxBytes ?? MAX_SCREENSHOT_BYTES;
    const maxLength = options.maxDataUrlLength ?? MAX_SCREENSHOT_DATA_URL_LENGTH;
    if (typeof dataUrl !== "string" || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
        throw new InvalidScreenshotError("Screenshot must be a PNG data URL");
    }
    if (dataUrl.length > maxLength) {
        throw new InvalidScreenshotError("Screenshot is too large");
    }
    const bytes = base64ToBytes(dataUrl.slice(PNG_DATA_URL_PREFIX.length));
    if (bytes.length > maxBytes) {
        throw new InvalidScreenshotError("Screenshot is too large");
    }
    // A short buffer would otherwise pass the signature check by running off the
    // end of the array.
    if (bytes.length < PNG_SIGNATURE.length) {
        throw new InvalidScreenshotError("Screenshot is not a valid PNG");
    }
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (bytes[i] !== PNG_SIGNATURE[i]) {
            throw new InvalidScreenshotError("Screenshot is not a valid PNG");
        }
    }
    return bytes;
}
/** Works in Node and in the browser, without pulling in Buffer types. */
function base64ToBytes(b64) {
    if (typeof atob === "function") {
        const binary = atob(b64);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++)
            out[i] = binary.charCodeAt(i);
        return out;
    }
    // Node without atob (or a stripped runtime).
    const g = globalThis;
    if (g.Buffer)
        return new Uint8Array(g.Buffer.from(b64, "base64"));
    throw new InvalidScreenshotError("No base64 decoder available in this runtime");
}
//# sourceMappingURL=report-core.js.map