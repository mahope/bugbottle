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
/** How many stack frames one console entry may carry. */
export declare const MAX_STACK_FRAMES = 10;
/** Longest a file or function name in a stack frame may be. */
export declare const MAX_STACK_STRING_LENGTH = 200;
/**
 * Longest each of the optional context facts may be. They are tokens rather
 * than prose — a locale, an IANA zone, a screen size, a connection type — so
 * anything longer is a mistake or an attempt to smuggle text into a field
 * nobody reads.
 */
export declare const MAX_CONTEXT_LENGTHS: {
    readonly language: 35;
    readonly timezone: 64;
    readonly screen: 32;
    readonly connection: 16;
};
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
/** How many keys of one web storage a report may carry. */
export declare const MAX_STORAGE_KEYS = 50;
/** How many cookie names a report may carry. */
export declare const MAX_COOKIE_NAMES = 100;
/** Longest a storage key or a cookie name may be before it is clipped. */
export declare const MAX_STORAGE_KEY_LENGTH = 100;
/**
 * Longest an allow-listed storage value may be. Short on purpose: the
 * allow-list exists for a feature flag or a tenant id, not for a serialised
 * session that happens to be interesting.
 */
export declare const MAX_STORAGE_VALUE_LENGTH = 200;
/** How many allow-listed values a report may carry. */
export declare const MAX_STORAGE_VALUES = 20;
/**
 * The largest duration any performance figure may claim, in milliseconds. An
 * hour is longer than any real page load and short enough that a row cannot be
 * bloated by a browser — or an attacker — sending 1e300.
 */
export declare const MAX_PERF_MS = 3600000;
export type ConsoleLevel = "error" | "warn";
/**
 * One line of a parsed stack: where the code was, never what it said. Source
 * text is deliberately absent — a frame points at a file and a position, and
 * resolving that to a line of code is the reader's job, with their own maps.
 */
export type StackFrame = {
    /** Script the frame is in: a URL or a path, as the browser wrote it. */
    file: string;
    /** 1-based line number. */
    line: number;
    /** 1-based column number. */
    col: number;
    /** Function name, when the browser named one. */
    fn?: string;
};
export type ConsoleEntry = {
    /** ISO 8601 timestamp. */
    ts: string;
    level: ConsoleLevel;
    message: string;
    /** Frames parsed from an uncaught error or a rejection, innermost first. */
    stack?: StackFrame[];
};
/**
 * Where the reporter was, and in what.
 *
 * Everything after `userAgent` is optional and best-effort: a browser that
 * does not offer a fact simply leaves it out. None of it identifies a person
 * more than the user agent already does.
 */
export type ReportContext = {
    /** Path and query of the page. The origin and the fragment are left out. */
    url: string;
    /** `${innerWidth}x${innerHeight}`. */
    viewport: string;
    userAgent: string;
    /** The browser's preferred language tag, e.g. `en-GB`. */
    language?: string;
    /** IANA time zone the browser resolved, e.g. `Europe/Copenhagen`. */
    timezone?: string;
    /** `${screenWidth}x${screenHeight}@${devicePixelRatio}`. */
    screen?: string;
    /** What `prefers-color-scheme` said at the time of the report. */
    colorScheme?: "dark" | "light";
    /** Whether the browser believed it was online. */
    online?: boolean;
    /** The Network Information API's effective type, e.g. `4g`. */
    connection?: string;
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
/**
 * What the page cost the reporter, measured by `bugbottle/perf`.
 *
 * Every field is optional because every field is a measurement that may not
 * have happened: a browser without `PerformanceObserver`, a page nobody
 * interacted with, a runtime that does not expose the heap. Milliseconds are
 * whole numbers and `cls` is rounded to three decimals — this is evidence for
 * a reader, not a benchmark.
 */
export type PerfSnapshot = {
    /** Largest Contentful Paint, in milliseconds from navigation start. */
    lcp?: number;
    /** Cumulative Layout Shift, excluding shifts that followed a recent input. */
    cls?: number;
    /** Interaction to Next Paint: the worst interaction, in milliseconds. */
    inp?: number;
    /** Time to First Byte, in milliseconds from navigation start. */
    ttfb?: number;
    /** When `DOMContentLoaded` finished, in milliseconds from navigation start. */
    domContentLoaded?: number;
    /** When the load event finished, in milliseconds from navigation start. */
    load?: number;
    /** Tasks that blocked the main thread for over 50 ms. */
    longTasks?: {
        count: number;
        totalMs: number;
    };
    /** The JS heap, where the browser exposes it. Chromium only. */
    memory?: {
        usedMB: number;
        limitMB: number;
    };
};
/** One key of a web storage: its name and how long its value was. Never the value. */
export type StorageKeyRef = {
    /** The key, clipped. */
    key: string;
    /** How many characters the value had. */
    length: number;
};
/**
 * What was in the browser's stores when the report was written.
 *
 * Names and lengths, never values — a key called `authToken` says the state
 * the page was in, and its value says rather more than a bug report should.
 * `values` is the one exception and it is opt-in per key: `initPerf` copies a
 * value in only when the integrator named that key in `allowValues`.
 */
export type StorageSnapshot = {
    /** `localStorage` keys, in the order the browser lists them. */
    local?: StorageKeyRef[];
    /** `sessionStorage` keys, in the order the browser lists them. */
    session?: StorageKeyRef[];
    /** Cookie names. Never cookie values, allow-list or not. */
    cookies?: string[];
    /** Values of the allow-listed keys, clipped. */
    values?: Record<string, string>;
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
    /** What the page cost, when `bugbottle/perf` was measuring. */
    perf?: PerfSnapshot;
    /** What was in the browser's stores, when `bugbottle/perf` was measuring. */
    storage?: StorageSnapshot;
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
 *
 * The three required fields are always present, empty when they were missing.
 * The optional facts are only carried through when they arrived as the right
 * type and were not empty, so a receiver never has to tell "unknown" from
 * "the browser sent an empty string"; anything else in the object is dropped.
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
    maxStackFrames?: number;
    maxStackStringLength?: number;
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
/**
 * Validates the performance snapshot a report arrived with.
 *
 * Every field is optional and every field is a number, so the rule is the same
 * throughout: a finite number in range is kept and rounded, anything else is
 * left out. A snapshot with nothing usable in it is not a snapshot, and null
 * says so — a report carrying `perf: {}` claims a measurement it does not
 * have. Never throws: a malformed section means "not measured", not a failed
 * report.
 */
export declare function normalisePerf(raw: unknown): PerfSnapshot | null;
/**
 * Validates the storage snapshot a report arrived with.
 *
 * The caps are the point of this one: a browser can hold megabytes in
 * `localStorage`, and a report that carried all of it would be a denial of
 * service with a bug attached. Keys are clipped, the lists are cut to
 * `MAX_STORAGE_KEYS` and `MAX_COOKIE_NAMES`, and the allow-listed values are
 * clipped hard. Empty sections are left out rather than sent as empty arrays,
 * so a reader can tell "nothing stored" from "not measured". Never throws.
 */
export declare function normaliseStorage(raw: unknown): StorageSnapshot | null;
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