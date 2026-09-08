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

import {
  isReportType,
  normaliseConsole,
  normaliseContext,
  normaliseElements,
  normaliseMessage,
  type ReportType,
} from "../report-core.ts";

/**
 * How many console entries travel to chat. The rest is in the stored report:
 * a channel is where somebody notices a problem, not where they read fifty
 * lines of it.
 */
export const MAX_CHAT_CONSOLE_ENTRIES = 5;

/** Human labels, the same ones the Markdown renderer uses. */
const TYPE_LABEL: Record<ReportType, string> = {
  bug: "Bug",
  idea: "Idea",
  other: "Feedback",
};

/** The longest first line a chat title keeps before the ellipsis. */
const MAX_TITLE_LENGTH = 80;

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
  /** Page, Viewport, Browser and whichever optional context facts are set. */
  facts: [string, string][];
  /** The last few console entries, one per line, or nothing. */
  consoleText: string | undefined;
  /** The selector of the first element the reporter pointed at, if any. */
  selector: string | undefined;
  /** When the report was accepted, or the last console entry's time. */
  timestamp: string | undefined;
};

/** Clips to `max` characters, spending the last one on an ellipsis. */
export function clip(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A data URL is the whole picture inline, and neither service will fetch one:
 * Slack rejects the block outright and Discord silently drops the image. Only
 * a URL somebody can GET is worth sending.
 */
export function isFetchableUrl(url: string | undefined): url is string {
  return typeof url === "string" && url !== "" && !url.startsWith("data:");
}

/**
 * Picks the screenshot address: the option function first, because it is the
 * call site nearest the storage decision, then whatever `handleReport` stored.
 */
export function resolveUrl(
  from: UrlFrom | undefined,
  report: unknown,
  fallback?: string,
): string | undefined {
  const chosen = from?.(report) ?? fallback;
  return isFetchableUrl(chosen) ? chosen : undefined;
}

/** Reads an untrusted body into the handful of things a chat message shows. */
export function readReport(raw: unknown): ChatReport {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const type = isReportType(r.type) ? r.type : "other";
  const message = normaliseMessage(r.message) ?? "";
  const context = normaliseContext(r.context);
  const elements = normaliseElements(r.elements);
  const entries = normaliseConsole(r.console, { maxEntries: MAX_CHAT_CONSOLE_ENTRIES });

  const firstLine = message.split(/\r?\n/)[0]?.trim() ?? "";
  const title = `${TYPE_LABEL[type]}: ${clip(firstLine, MAX_TITLE_LENGTH) || TYPE_LABEL[type]}`;

  const facts: [string, string][] = [];
  if (context.url) facts.push(["Page", context.url]);
  if (context.viewport) facts.push(["Viewport", context.viewport]);
  if (context.userAgent) facts.push(["Browser", context.userAgent]);
  if (context.screen) facts.push(["Screen", context.screen]);
  if (context.language) facts.push(["Language", context.language]);
  if (context.timezone) facts.push(["Time zone", context.timezone]);
  if (context.colorScheme) facts.push(["Colour scheme", context.colorScheme]);
  if (typeof context.online === "boolean") facts.push(["Online", context.online ? "yes" : "no"]);
  if (context.connection) facts.push(["Connection", context.connection]);

  const consoleText = entries.length
    ? entries.map((e) => `${e.ts ? `${e.ts} ` : ""}[${e.level}] ${e.message}`).join("\n")
    : undefined;

  // `receivedAt` is what the server wrote down; a raw body has no such field,
  // so the newest console entry is the next best clock.
  const receivedAt = typeof r.receivedAt === "string" ? r.receivedAt : undefined;

  return {
    type,
    title,
    message,
    facts,
    consoleText,
    selector: elements[0]?.selector,
    timestamp: receivedAt ?? entries.at(-1)?.ts,
  };
}
