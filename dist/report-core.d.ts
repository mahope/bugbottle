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
/** The JSON body a report is sent as. Extra fields may be added by the client. */
export type BugReport = {
    type: ReportType;
    message: string;
    context: ReportContext;
    console?: ConsoleEntry[];
    /** Elements the reporter pointed at, in the order they were attached. */
    elements?: ElementRef[];
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