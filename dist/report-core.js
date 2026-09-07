/**
 * The shape of a report and the rules for validating one — no DOM, no network,
 * no storage. Both ends import this: the browser to build a report, the server
 * to check the one it received.
 *
 * Everything that arrives at the server is attacker-controlled input that is
 * about to be written to storage, so its shape is checked rather than trusted.
 * The screenshot needs the most care, but a message or a console entry can
 * carry a null byte that a database refuses, or be long enough to bloat a row.
 */
export const REPORT_TYPES = ["bug", "idea", "other"];
/** Decoded ceiling for a screenshot. The client downscales before this. */
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
/** Base64 inflates by about a third; the prefix is the rest of the slack. */
export const MAX_SCREENSHOT_DATA_URL_LENGTH = 2_900_000;
export const MAX_MESSAGE_LENGTH = 4000;
/** How many console entries a report may carry. Oldest are dropped first. */
export const MAX_CONSOLE_ENTRIES = 50;
/** Longest a single console message may be before it is clipped. */
export const MAX_CONSOLE_MESSAGE_LENGTH = 500;
/** How many pointed-at elements a report may carry. */
export const MAX_ELEMENTS = 10;
/** Longest text kept for a pointed-at element. */
export const MAX_ELEMENT_TEXT_LENGTH = 200;
/** How many breadcrumbs a report may carry. Oldest are dropped first. */
export const MAX_BREADCRUMBS = 30;
/** Longest text kept for a clicked element. Short on purpose: a label, not a paragraph. */
export const MAX_BREADCRUMB_TEXT_LENGTH = 40;
/** How many recorded requests a report may carry. Oldest are dropped first. */
export const MAX_NETWORK_ENTRIES = 30;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const BREADCRUMB_KINDS = ["click", "navigation", "submit", "visibility"];
export function isReportType(value) {
    return typeof value === "string" && REPORT_TYPES.includes(value);
}
/**
 * Postgres (and others) refuse a text value containing a null byte, so one
 * arriving from a browser would fail the whole insert.
 */
function stripNullBytes(text) {
    return text.replace(/\u0000/g, "");
}
/**
 * Trims and length-checks the reporter's message.
 * Returns null when there is nothing worth storing.
 */
export function normaliseMessage(raw, maxLength = MAX_MESSAGE_LENGTH) {
    if (typeof raw !== "string")
        return null;
    const text = stripNullBytes(raw).trim();
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
    const str = (v, max) => typeof v === "string" ? stripNullBytes(v).slice(0, max) : "";
    return {
        url: str(obj.url, 500),
        viewport: str(obj.viewport, 32),
        userAgent: str(obj.userAgent, 500),
    };
}
/**
 * Validates the console entries a report arrived with.
 *
 * Anything that is not an array of `{ ts, level, message }` with a known level
 * is dropped, messages are clipped, and only the most recent entries are kept.
 * Never throws: a malformed console section means "no console", not a failed
 * report.
 */
export function normaliseConsole(raw, options = {}) {
    const maxEntries = options.maxEntries ?? MAX_CONSOLE_ENTRIES;
    const maxMessageLength = options.maxMessageLength ?? MAX_CONSOLE_MESSAGE_LENGTH;
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null)
            continue;
        const { ts, level, message } = item;
        if (level !== "error" && level !== "warn")
            continue;
        if (typeof message !== "string")
            continue;
        out.push({
            ts: typeof ts === "string" && !Number.isNaN(Date.parse(ts)) ? ts : "",
            level,
            message: stripNullBytes(message).slice(0, maxMessageLength),
        });
    }
    return out.length > maxEntries ? out.slice(-maxEntries) : out;
}
/**
 * Validates the elements a report arrived with. Malformed entries are dropped,
 * strings are clipped, attribute names are limited to a safe pattern, and at
 * most `maxElements` are kept. Never throws.
 */
export function normaliseElements(raw, options = {}) {
    const maxElements = options.maxElements ?? MAX_ELEMENTS;
    if (!Array.isArray(raw))
        return [];
    const str = (v, max) => typeof v === "string" ? stripNullBytes(v).slice(0, max) : "";
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
    const out = [];
    for (const item of raw) {
        if (out.length >= maxElements)
            break;
        if (typeof item !== "object" || item === null)
            continue;
        const o = item;
        const selector = str(o.selector, 500);
        const tag = str(o.tag, 32);
        if (!selector || !tag)
            continue;
        const rect = (o.rect ?? {});
        const attributes = {};
        if (typeof o.attributes === "object" && o.attributes !== null) {
            for (const [k, v] of Object.entries(o.attributes)) {
                if (Object.keys(attributes).length >= 20)
                    break;
                if (!/^[a-z][a-z0-9-]{0,63}$/.test(k) || k.startsWith("data-bugbottle"))
                    continue;
                if (typeof v === "string")
                    attributes[k] = stripNullBytes(v).slice(0, 200);
            }
        }
        out.push({
            selector,
            tag,
            text: str(o.text, MAX_ELEMENT_TEXT_LENGTH),
            rect: { x: num(rect.x), y: num(rect.y), width: num(rect.width), height: num(rect.height) },
            attributes,
        });
    }
    return out;
}
/**
 * Validates the breadcrumbs a report arrived with. Entries with an unknown
 * kind are dropped, strings are clipped, fields that are not strings are left
 * out entirely, and at most `maxBreadcrumbs` are kept — the most recent ones,
 * since the end of the timeline is the interesting end. Never throws: a
 * malformed section means "no breadcrumbs", not a failed report.
 */
export function normaliseBreadcrumbs(raw, options = {}) {
    const maxBreadcrumbs = options.maxBreadcrumbs ?? MAX_BREADCRUMBS;
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null)
            continue;
        const o = item;
        const kind = o.kind;
        if (typeof kind !== "string" || !BREADCRUMB_KINDS.includes(kind)) {
            continue;
        }
        const crumb = {
            ts: typeof o.ts === "string" && !Number.isNaN(Date.parse(o.ts)) ? o.ts : "",
            kind: kind,
        };
        if (typeof o.target === "string")
            crumb.target = stripNullBytes(o.target).slice(0, 500);
        if (typeof o.text === "string") {
            crumb.text = stripNullBytes(o.text).slice(0, MAX_BREADCRUMB_TEXT_LENGTH);
        }
        if (typeof o.from === "string")
            crumb.from = stripNullBytes(o.from).slice(0, 500);
        if (typeof o.to === "string")
            crumb.to = stripNullBytes(o.to).slice(0, 500);
        out.push(crumb);
    }
    return out.length > maxBreadcrumbs ? out.slice(-maxBreadcrumbs) : out;
}
/**
 * Validates the recorded requests a report arrived with. An entry without a
 * string `url` is not a request and is dropped; everything else is clipped,
 * rounded or defaulted rather than rejected, and at most `maxEntries` are
 * kept — the most recent ones. Never throws: a malformed section means "no
 * requests", not a failed report.
 */
export function normaliseNetwork(raw, options = {}) {
    const maxEntries = options.maxEntries ?? MAX_NETWORK_ENTRIES;
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null)
            continue;
        const o = item;
        if (typeof o.url !== "string")
            continue;
        const status = typeof o.status === "number" && Number.isFinite(o.status) ? o.status : 0;
        const ms = typeof o.ms === "number" && Number.isFinite(o.ms) ? o.ms : 0;
        const entry = {
            ts: typeof o.ts === "string" && !Number.isNaN(Date.parse(o.ts)) ? o.ts : "",
            // A method is a short token by definition, so anything longer is either
            // a mistake or an attempt to smuggle text through a field nobody reads.
            method: typeof o.method === "string" ? stripNullBytes(o.method).slice(0, 20) : "GET",
            url: stripNullBytes(o.url).slice(0, 500),
            status: Math.min(Math.max(Math.trunc(status), 0), 999),
            ms: Math.min(Math.max(Math.round(ms), 0), 3_600_000),
        };
        if (o.error === true)
            entry.error = true;
        out.push(entry);
    }
    return out.length > maxEntries ? out.slice(-maxEntries) : out;
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
/**
 * Works in Node and in the browser, without pulling in Buffer types.
 *
 * `atob` throws a DOMException on malformed input; that is wrapped so a caller
 * only ever has to catch InvalidScreenshotError.
 */
function base64ToBytes(b64) {
    if (typeof atob === "function") {
        let binary;
        try {
            binary = atob(b64);
        }
        catch {
            throw new InvalidScreenshotError("Screenshot is not valid base64");
        }
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