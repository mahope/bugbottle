/**
 * The shaping the Slack and Discord sinks share.
 *
 * Both services take one message per report, both cap every string they are
 * given, and both want the same four facts up front. What differs is the
 * envelope — Block Kit against an embed — so the reading of a report lives
 * here and the two sinks are left with the part that is actually theirs.
 *
 * Nothing here throws on a malformed report: every field goes through the
 * `normalise*` functions in report-core first, so a half-built body still
 * reaches the channel where somebody can see that something is wrong.
 */
import { type ReportType } from "../report-core.ts";
/**
 * How many console entries travel to chat. The rest is in the stored report:
 * a channel is where somebody notices a problem, not where they read fifty
 * lines of it.
 */
export declare const MAX_CHAT_CONSOLE_ENTRIES = 5;
/** What a sink is handed beside the report by `handleReport`. */
export type ChatSinkContext = {
    /** Where the screenshot was stored, when a `screenshot` function stored it. */
    screenshotUrl?: string;
    /** Aborts when the sink runs out of its deadline. Handed to `fetch`. */
    signal?: AbortSignal;
};
/** A chat sink: the shape `handleReport` runs, and `ReportSink` accepts. */
export type ChatSink = (report: unknown, ctx?: ChatSinkContext) => Promise<void>;
/** Resolves a URL from the report, or returns nothing when there is none. */
export type UrlFrom = (report: unknown) => string | undefined;
/** Everything either sink needs, read once out of an untrusted body. */
export type ChatReport = {
    type: ReportType;
    /** "Bug: The save button does nothing", clipped. */
    title: string;
    /** The reporter's own words, unescaped. */
    message: string;
    /** Contact, Page, Viewport, Browser and whichever optional context facts are set. */
    facts: [string, string][];
    /** The last few console entries, one per line, or nothing. */
    consoleText: string | undefined;
    /** The selector of the first element the reporter pointed at, if any. */
    selector: string | undefined;
    /** When the report was accepted, or the last console entry's time. */
    timestamp: string | undefined;
};
/**
 * Clips to `max` characters, spending the last one on an ellipsis.
 *
 * Characters, not UTF-16 units: an emoji or an ideograph outside the basic
 * plane is two units, and cutting between them leaves a lone surrogate that
 * every client draws as U+FFFD. The fast path is still `text.length`, which
 * can only overcount, so nothing short is walked twice.
 */
export declare function clip(text: string, max: number): string;
/**
 * A data URL is the whole picture inline, and neither service will fetch one:
 * Slack rejects the block outright and Discord silently drops the image. Only
 * a URL somebody can GET is worth sending.
 */
export declare function isFetchableUrl(url: string | undefined): url is string;
/**
 * Picks the screenshot address: the option function first, because it is the
 * call site nearest the storage decision, then whatever `handleReport` stored.
 */
export declare function resolveUrl(from: UrlFrom | undefined, report: unknown, fallback?: string): string | undefined;
/** Reads an untrusted body into the handful of things a chat message shows. */
export declare function readReport(raw: unknown): ChatReport;
//# sourceMappingURL=chat.d.ts.map