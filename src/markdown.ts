/**
 * A report rendered as Markdown — for an issue body, a Slack message, an
 * email, or the morning digest a coding agent reads.
 *
 * The layout is deliberately boring: heading, message, a small table of
 * facts, then the evidence sections in the order a reader wants them
 * (elements first, because they say where; console last, because it is
 * long). Every value goes through `normalise*` first, so this accepts the raw
 * body from the request as well as a validated report.
 */

import {
  isReportType,
  normaliseConsole,
  normaliseContext,
  normaliseElements,
  normaliseMessage,
  type ElementRef,
} from "./report-core.ts";

export type MarkdownOptions = {
  /** Heading level for the title. Default 2 (`##`). 0 omits the heading. */
  headingLevel?: number;
  /** Prefix the title with the report type, e.g. "Bug: …". Default true. */
  typeInTitle?: boolean;
  /** Longest title, taken from the first line of the message. Default 80. */
  maxTitleLength?: number;
  /** How many console entries to include, newest kept. Default all (max 50). */
  maxConsoleEntries?: number;
  /** Extra rows for the facts table, e.g. `{ App: "checkout 1.4.2", User: "u_9" }`. */
  facts?: Record<string, string | number | undefined>;
  /** Mention where the screenshot was stored, if there was one. */
  screenshotUrl?: string;
  /** Wrap the console section in a `<details>` block. Default true. */
  collapseConsole?: boolean;
};

const TYPE_LABEL: Record<string, string> = { bug: "Bug", idea: "Idea", other: "Feedback" };

/** Pipes and newlines would break a table cell. */
function cell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function fence(text: string, lang = ""): string {
  // A message containing ``` would otherwise close the block early.
  const ticks = /```/.test(text) ? "````" : "```";
  return `${ticks}${lang}\n${text}\n${ticks}`;
}

function elementLine(el: ElementRef): string {
  const bits = [`\`${el.selector}\``];
  if (el.text) bits.push(`— "${el.text}"`);
  const attrs = Object.entries(el.attributes)
    .filter(([k]) => k !== "id")
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  if (attrs) bits.push(`(${attrs})`);
  bits.push(`at ${el.rect.x},${el.rect.y} ${el.rect.width}×${el.rect.height}`);
  return `- ${bits.join(" ")}`;
}

/**
 * Renders a report (raw request body or validated) as Markdown. Never throws
 * on malformed input: missing sections are left out.
 */
export function toMarkdown(raw: unknown, options: MarkdownOptions = {}): string {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const type = isReportType(r.type) ? r.type : "other";
  const message = normaliseMessage(r.message) ?? "";
  const context = normaliseContext(r.context);
  const elements = normaliseElements(r.elements);
  const consoleEntries = normaliseConsole(r.console, {
    maxEntries: options.maxConsoleEntries,
  });
  const headingLevel = options.headingLevel ?? 2;
  const maxTitle = options.maxTitleLength ?? 80;

  const firstLine = message.split(/\r?\n/)[0]?.trim() ?? "";
  let title = firstLine.length > maxTitle ? `${firstLine.slice(0, maxTitle - 1).trimEnd()}…` : firstLine;
  if (!title) title = TYPE_LABEL[type] ?? "Report";
  if (options.typeInTitle ?? true) title = `${TYPE_LABEL[type] ?? "Report"}: ${title}`;

  const out: string[] = [];
  if (headingLevel > 0) out.push(`${"#".repeat(Math.min(headingLevel, 6))} ${title}`, "");
  if (message) out.push(message, "");

  const facts: [string, string][] = [["Type", TYPE_LABEL[type] ?? type]];
  if (context.url) facts.push(["Page", `\`${context.url}\``]);
  if (context.viewport) facts.push(["Viewport", context.viewport]);
  if (context.userAgent) facts.push(["Browser", context.userAgent]);
  const ts = consoleEntries.at(-1)?.ts;
  if (ts) facts.push(["Last console entry", ts]);
  if (options.screenshotUrl) facts.push(["Screenshot", options.screenshotUrl]);
  else if (typeof r.screenshotDataUrl === "string" && r.screenshotDataUrl) {
    facts.push(["Screenshot", "attached"]);
  }
  for (const [k, v] of Object.entries(options.facts ?? {})) {
    if (v !== undefined && v !== "") facts.push([k, String(v)]);
  }
  out.push("| | |", "|---|---|");
  for (const [k, v] of facts) out.push(`| ${cell(k)} | ${cell(v)} |`);
  out.push("");

  if (elements.length > 0) {
    out.push(`### Element${elements.length > 1 ? "s" : ""} pointed at`, "");
    for (const el of elements) out.push(elementLine(el));
    out.push("");
  }

  if (consoleEntries.length > 0) {
    const lines = consoleEntries.map((e) => `${e.ts ? `${e.ts} ` : ""}[${e.level}] ${e.message}`);
    const block = fence(lines.join("\n"), "text");
    const label = `Console (${consoleEntries.length} ${consoleEntries.length === 1 ? "entry" : "entries"})`;
    if (options.collapseConsole ?? true) {
      out.push(`<details><summary>${label}</summary>`, "", block, "", "</details>", "");
    } else {
      out.push(`### ${label}`, "", block, "");
    }
  }

  return out.join("\n").trimEnd() + "\n";
}
