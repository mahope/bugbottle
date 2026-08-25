/**
 * The shape of a report and the rules for validating one — no DOM, no network,
 * no storage. Both ends import this: the browser to build a report, the server
 * to check the one it received.
 *
 * The screenshot is the part that needs real care. It arrives as a data URL
 * from a browser, which means it is attacker-controlled input that a server is
 * about to write to storage, so its shape is checked rather than trusted.
 */
export declare const REPORT_TYPES: readonly ["bug", "idea", "other"];
export type ReportType = (typeof REPORT_TYPES)[number];
/** Decoded ceiling for a screenshot. The client downscales before this. */
export declare const MAX_SCREENSHOT_BYTES: number;
/** Base64 inflates by about a third; the prefix is the rest of the slack. */
export declare const MAX_SCREENSHOT_DATA_URL_LENGTH = 2900000;
export declare const MAX_MESSAGE_LENGTH = 4000;
/** Where the reporter was, and in what. */
export type ReportContext = {
    url: string;
    viewport: string;
    userAgent: string;
};
export type BugReport = {
    type: ReportType;
    message: string;
    context: ReportContext;
    console?: {
        ts: string;
        level: string;
        message: string;
    }[];
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