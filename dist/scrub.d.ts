/**
 * Redacting the things a reporter never meant to send.
 *
 * A bug report is written in a hurry. People paste the request that failed,
 * the token they were debugging with, the customer's email address — and the
 * page URL carries a `?token=` of its own. This module walks a report and
 * replaces those with `[redacted]`.
 *
 * It is a separate module on purpose, and nothing in the core imports it. The
 * bare `bugbottle` entry has to stay under a kilobyte gzipped, so an
 * integrator who does not scrub must not pay for the patterns. Wire it in
 * yourself — `buildReport({ scrub: scrubReport })` in the browser, or call
 * `scrubReport` in the route handler before the row is written.
 *
 * Nothing here throws. It is handed browser input, sometimes malformed, and a
 * report that cannot be scrubbed is still a report worth keeping, so anything
 * unexpected is left exactly as it was found.
 */
/** The built-in patterns, by the name `keep` uses to switch one off. */
export type ScrubberName = "email" | "bearer" | "jwt" | "card" | "iban" | "query";
/**
 * How one pattern redacts. `replace` decides what a single match becomes,
 * which is how the card scrubber lets a 16-digit order number through and how
 * `query` keeps the key it found the value under.
 */
export type Scrubber = {
    /** Matched against every scrubbed string. Must be global. */
    pattern: RegExp;
    /** Returns the text for one match. Returning the match keeps it. */
    replace?: (match: string, groups: (string | undefined)[], replacement: string) => string;
    /**
     * Only applied to fields that hold a URL — `context.url` and an `href`
     * attribute. A message that happens to say `key=value` is prose, not a
     * credential, and redacting it would be worse than leaving it.
     */
    urlsOnly?: boolean;
};
export type ScrubOptions = {
    /**
     * Extra patterns, redacted whole. Global regexes, please: a non-global one
     * only ever replaces the first match on a line.
     */
    patterns?: RegExp[];
    /** Built-in patterns to switch off, by name. */
    keep?: ScrubberName[];
    /** What redacted text becomes. Default `[redacted]`. */
    replacement?: string;
};
export declare const DEFAULT_REPLACEMENT = "[redacted]";
/**
 * The patterns that are on by default, in the order they are applied. Order
 * matters: the query scrubber runs before the ones that would match the value
 * it is about to redact, and the card scrubber runs last so it never eats the
 * digits inside an IBAN.
 */
export declare const BUILTIN_SCRUBBERS: Record<ScrubberName, Scrubber>;
/**
 * Returns a copy of the report with matched substrings replaced.
 *
 * Pure: the report handed in is not modified. `screenshotDataUrl` is passed
 * through untouched — a picture is pixels, and masking it is a different job
 * with different trade-offs.
 */
export declare function scrubReport<T>(report: T, options?: ScrubOptions): T;
//# sourceMappingURL=scrub.d.ts.map