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
import { isReportType, normaliseBreadcrumbs, normaliseConsole, normaliseContext, normaliseElements, normaliseMessage, } from "./report-core.js";
const TYPE_LABEL = { bug: "Bug", idea: "Idea", other: "Feedback" };
/** Pipes and newlines would break a table cell. */
function cell(value) {
    return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}
function fence(text, lang = "") {
    // A message containing ``` would otherwise close the block early.
    const ticks = /```/.test(text) ? "````" : "```";
    return `${ticks}${lang}\n${text}\n${ticks}`;
}
function elementLine(el) {
    const bits = [`\`${el.selector}\``];
    if (el.text)
        bits.push(`— "${el.text}"`);
    const attrs = Object.entries(el.attributes)
        .filter(([k]) => k !== "id")
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
    if (attrs)
        bits.push(`(${attrs})`);
    bits.push(`at ${el.rect.x},${el.rect.y} ${el.rect.width}×${el.rect.height}`);
    return `- ${bits.join(" ")}`;
}
function breadcrumbLine(crumb) {
    const bits = [];
    if (crumb.ts)
        bits.push(crumb.ts);
    if (crumb.kind === "click" || crumb.kind === "submit") {
        bits.push(crumb.kind === "click" ? "clicked" : "submitted");
        if (crumb.target)
            bits.push(`\`${crumb.target}\``);
        if (crumb.text)
            bits.push(`— "${crumb.text}"`);
    }
    else if (crumb.kind === "navigation") {
        bits.push("navigated");
        if (crumb.from)
            bits.push(`\`${crumb.from}\` →`);
        bits.push(`\`${crumb.to ?? ""}\``);
    }
    else {
        bits.push(`page ${crumb.to ?? "changed"}`);
    }
    return `- ${bits.join(" ")}`;
}
/**
 * Renders a report (raw request body or validated) as Markdown. Never throws
 * on malformed input: missing sections are left out.
 */
export function toMarkdown(raw, options = {}) {
    const r = (typeof raw === "object" && raw !== null ? raw : {});
    const type = isReportType(r.type) ? r.type : "other";
    const message = normaliseMessage(r.message) ?? "";
    const context = normaliseContext(r.context);
    const elements = normaliseElements(r.elements);
    const breadcrumbs = normaliseBreadcrumbs(r.breadcrumbs);
    const consoleEntries = normaliseConsole(r.console, {
        maxEntries: options.maxConsoleEntries,
    });
    const headingLevel = options.headingLevel ?? 2;
    const maxTitle = options.maxTitleLength ?? 80;
    const firstLine = message.split(/\r?\n/)[0]?.trim() ?? "";
    let title = firstLine.length > maxTitle ? `${firstLine.slice(0, maxTitle - 1).trimEnd()}…` : firstLine;
    if (!title)
        title = TYPE_LABEL[type] ?? "Report";
    if (options.typeInTitle ?? true)
        title = `${TYPE_LABEL[type] ?? "Report"}: ${title}`;
    const out = [];
    if (headingLevel > 0)
        out.push(`${"#".repeat(Math.min(headingLevel, 6))} ${title}`, "");
    if (message)
        out.push(message, "");
    const facts = [["Type", TYPE_LABEL[type] ?? type]];
    if (context.url)
        facts.push(["Page", `\`${context.url}\``]);
    if (context.viewport)
        facts.push(["Viewport", context.viewport]);
    if (context.userAgent)
        facts.push(["Browser", context.userAgent]);
    const ts = consoleEntries.at(-1)?.ts;
    if (ts)
        facts.push(["Last console entry", ts]);
    if (options.screenshotUrl)
        facts.push(["Screenshot", options.screenshotUrl]);
    else if (typeof r.screenshotDataUrl === "string" && r.screenshotDataUrl) {
        facts.push(["Screenshot", "attached"]);
    }
    for (const [k, v] of Object.entries(options.facts ?? {})) {
        if (v !== undefined && v !== "")
            facts.push([k, String(v)]);
    }
    out.push("| | |", "|---|---|");
    for (const [k, v] of facts)
        out.push(`| ${cell(k)} | ${cell(v)} |`);
    out.push("");
    if (elements.length > 0) {
        out.push(`### Element${elements.length > 1 ? "s" : ""} pointed at`, "");
        for (const el of elements)
            out.push(elementLine(el));
        out.push("");
    }
    if (breadcrumbs.length > 0) {
        out.push("### What happened before", "");
        for (const crumb of breadcrumbs)
            out.push(breadcrumbLine(crumb));
        out.push("");
    }
    if (consoleEntries.length > 0) {
        const lines = consoleEntries.map((e) => `${e.ts ? `${e.ts} ` : ""}[${e.level}] ${e.message}`);
        const block = fence(lines.join("\n"), "text");
        const label = `Console (${consoleEntries.length} ${consoleEntries.length === 1 ? "entry" : "entries"})`;
        if (options.collapseConsole ?? true) {
            out.push(`<details><summary>${label}</summary>`, "", block, "", "</details>", "");
        }
        else {
            out.push(`### ${label}`, "", block, "");
        }
    }
    return out.join("\n").trimEnd() + "\n";
}
//# sourceMappingURL=markdown.js.map