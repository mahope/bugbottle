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
export declare const REPORT_TYPES: readonly ["bug", "idea", "other"];
export type ReportType = (typeof REPORT_TYPES)[number];
/** Decoded ceiling for a screenshot. The client downscales before this. */
export declare const MAX_SCREENSHOT_BYTES: number;
/** Base64 inflates by about a third; the prefix is the rest of the slack. */
export declare const MAX_SCREENSHOT_DATA_URL_LENGTH = 2900000;
export declare const MAX_MESSAGE_LENGTH = 4000;
/** How many console entries a report may carry. Oldest are dropped first. */
export declare const MAX_CONSOLE_ENTRIES = 50;
/** Longest a single console message may be before it is clipped. */
export declare const MAX_CONSOLE_MESSAGE_LENGTH = 500;
/** How many pointed-at elements a report may carry. */
export declare const MAX_ELEMENTS = 10;
/** Longest text kept for a pointed-at element. */
export declare const MAX_ELEMENT_TEXT_LENGTH = 200;
/** How many breadcrumbs a report may carry. Oldest are dropped first. */
export declare const MAX_BREADCRUMBS = 30;
/** Longest text kept for a clicked element. Short on purpose: a label, not a paragraph. */
export declare const MAX_BREADCRUMB_TEXT_LENGTH = 40;
/** How many recorded requests a report may carry. Oldest are dropped first. */
export declare const MAX_NETWORK_ENTRIES = 30;
export type ConsoleLevel = "error" | "warn";
export type ConsoleEntry = {
    /** ISO 8601 timestamp. */
    ts: string;
    level: ConsoleLevel;
    message: string;
};
/** Where the reporter was, and in what. */
export type ReportContext = {
    /** Path and query of the page. The origin and the fragment are left out. */
    url: string;
    /** `${innerWidth}x${innerHeight}`. */
    viewport: string;
    userAgent: string;
};
/** An element the reporter pointed at: what it is, what it says, where it is. */
export type ElementRef = {
    /** A short CSS selector, e.g. `form#checkout > button:nth-of-type(2)`. */
    selector: string;
    tag: string;
    /** Visible text, whitespace-collapsed and clipped. */
    text: string;
    /** Page coordinates in CSS pixels. */
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** id, name, role, type, href, aria-label, placeholder, title and data-* — never data-bugbottle*. */
    attributes: Record<string, string>;
};
export declare const BREADCRUMB_KINDS: readonly ["click", "navigation", "submit", "visibility"];
export type BreadcrumbKind = (typeof BREADCRUMB_KINDS)[number];
/**
 * One thing the reporter did before they reported. A short timeline of these
 * turns "it broke after I clicked save" into something reproducible.
 *
 * Which fields are set depends on the kind: a click or a submit carries the
 * `target` selector (and, for a click, the visible `text`), a navigation
 * carries `from` and `to`, and a visibility change carries `to`.
 */
export type Breadcrumb = {
    /** ISO 8601 timestamp. */
    ts: string;
    kind: BreadcrumbKind;
    /** A short CSS selector for the element involved. */
    target?: string;
    /** Visible text of the clicked element, whitespace-collapsed and clipped. */
    text?: string;
    /** Path and query the navigation left, or nothing when it is not known. */
    from?: string;
    /** Path and query navigated to, or `hidden`/`visible` for a visibility change. */
    to?: string;
};
/**
 * One request the browser made before the report. Recorded by
 * `bugbottle/network`, which keeps the failed and the slow ones.
 *
 * Bodies and headers are never part of this, in either direction: that is
 * where tokens and personal data live. What is left says which call failed and
 * how long it took, which is the part that explains the report.
 */
export type NetworkEntry = {
    /** ISO 8601 timestamp of when the request finished. */
    ts: string;
    /** The HTTP method, upper case. */
    method: string;
    /** Path and query, with sensitive query values redacted. Cross-origin URLs keep their origin. */
    url: string;
    /** The response status, or 0 when the request never got one. */
    status: number;
    /** How long the request took, in milliseconds. */
    ms: number;
    /** True when the request failed before a status — offline, CORS, aborted. */
    error?: boolean;
};
/** The JSON body a report is sent as. Extra fields may be added by the client. */
export type BugReport = {
    type: ReportType;
    message: string;
    context: ReportContext;
    console?: ConsoleEntry[];
    /** Elements the reporter pointed at, in the order they were attached. */
    elements?: ElementRef[];
    /** What the reporter did before reporting, oldest first. */
    breadcrumbs?: Breadcrumb[];
    /** Requests that failed or were slow before the report, oldest first. */
    network?: NetworkEntry[];
    screenshotDataUrl?: string;
};
export declare function isReportType(value: unknown): value is ReportType;
/**
 * Trims and length-checks the reporter's message.
 * Returns null when there is nothing worth storing.
 */
export declare function normaliseMessage(raw: unknown, maxLength?: number): string | null;
/**
 * Clips the context strings. A browser can send a user-agent of any length,
 * and this ends up in your database.
 */
export declare function normaliseContext(raw: unknown): ReportContext;
/**
 * Validates the console entries a report arrived with.
 *
 * Anything that is not an array of `{ ts, level, message }` with a known level
 * is dropped, messages are clipped, and only the most recent entries are kept.
 * Never throws: a malformed console section means "no console", not a failed
 * report.
 */
export declare function normaliseConsole(raw: unknown, options?: {
    maxEntries?: number;
    maxMessageLength?: number;
}): ConsoleEntry[];
/**
 * Validates the elements a report arrived with. Malformed entries are dropped,
 * strings are clipped, attribute names are limited to a safe pattern, and at
 * most `maxElements` are kept. Never throws.
 */
export declare function normaliseElements(raw: unknown, options?: {
    maxElements?: number;
}): ElementRef[];
/**
 * Validates the breadcrumbs a report arrived with. Entries with an unknown
 * kind are dropped, strings are clipped, fields that are not strings are left
 * out entirely, and at most `maxBreadcrumbs` are kept — the most recent ones,
 * since the end of the timeline is the interesting end. Never throws: a
 * malformed section means "no breadcrumbs", not a failed report.
 */
export declare function normaliseBreadcrumbs(raw: unknown, options?: {
    maxBreadcrumbs?: number;
}): Breadcrumb[];
/**
 * Validates the recorded requests a report arrived with. An entry without a
 * string `url` is not a request and is dropped; everything else is clipped,
 * rounded or defaulted rather than rejected, and at most `maxEntries` are
 * kept — the most recent ones. Never throws: a malformed section means "no
 * requests", not a failed report.
 */
export declare function normaliseNetwork(raw: unknown, options?: {
    maxEntries?: number;
}): NetworkEntry[];
export declare class InvalidScreenshotError extends Error {
    constructor(message: string);
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
export declare function decodeScreenshotDataUrl(dataUrl: unknown, options?: {
    maxBytes?: number;
    maxDataUrlLength?: number;
}): Uint8Array;
//# sourceMappingURL=report-core.d.ts.map