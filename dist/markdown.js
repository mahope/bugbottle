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
import { isReportType, normaliseBreadcrumbs, normaliseConsole, normaliseContext, normaliseElements, normaliseMessage, normaliseNetwork, normalisePerf, normaliseReplay, normaliseStorage, } from "./report-core.js";
const TYPE_LABEL = { bug: "Bug", idea: "Idea", other: "Feedback" };
/**
 * How many frames of a stack are printed under a console entry. Ten are kept
 * in the report, but a reader scanning an issue wants the innermost few; the
 * whole stack is in the JSON for anyone who needs it.
 */
const MAX_RENDERED_STACK_FRAMES = 3;
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
 * One row of the Requests table. A request that never got a status shows the
 * failure instead of a bare 0, which reads as a status nobody recognises.
 */
function requestRow(entry) {
    const status = entry.status > 0 ? String(entry.status) : entry.error ? "failed" : "";
    return `| ${cell(entry.method)} | \`${cell(entry.url)}\` | ${status} | ${entry.ms} |`;
}
/**
 * The performance facts that are present, in the order a reader wants them:
 * what the page felt like first, then what it cost. A figure the browser never
 * measured is left out rather than printed as a zero, which would read as
 * "instant" instead of "unknown".
 */
function perfRows(perf) {
    const rows = [];
    if (perf.lcp !== undefined)
        rows.push(["Largest contentful paint", `${perf.lcp} ms`]);
    if (perf.cls !== undefined)
        rows.push(["Cumulative layout shift", String(perf.cls)]);
    if (perf.inp !== undefined)
        rows.push(["Interaction to next paint", `${perf.inp} ms`]);
    if (perf.ttfb !== undefined)
        rows.push(["Time to first byte", `${perf.ttfb} ms`]);
    if (perf.domContentLoaded !== undefined) {
        rows.push(["DOM content loaded", `${perf.domContentLoaded} ms`]);
    }
    if (perf.load !== undefined)
        rows.push(["Load", `${perf.load} ms`]);
    if (perf.longTasks) {
        rows.push([
            "Long tasks",
            `${perf.longTasks.count} (${perf.longTasks.totalMs} ms total)`,
        ]);
    }
    if (perf.memory) {
        rows.push(["JS heap", `${perf.memory.usedMB} MB of ${perf.memory.limitMB} MB`]);
    }
    return rows;
}
/**
 * The storage snapshot as lines. Key names with their value lengths, cookie
 * names, and the allow-listed values — which are the only values here, and are
 * only ever the ones an integrator named.
 */
function storageLines(storage) {
    const lines = [];
    const keys = (label, list) => {
        if (!list || list.length === 0)
            return;
        lines.push(`${label}: ${list.map((e) => `\`${e.key}\` (${e.length})`).join(", ")}`);
    };
    keys("localStorage", storage.local);
    keys("sessionStorage", storage.session);
    if (storage.cookies && storage.cookies.length > 0) {
        lines.push(`Cookies: ${storage.cookies.map((name) => `\`${name}\``).join(", ")}`);
    }
    for (const [key, value] of Object.entries(storage.values ?? {})) {
        lines.push(`\`${key}\` = ${value}`);
    }
    return lines;
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
    const network = normaliseNetwork(r.network);
    const perf = normalisePerf(r.perf);
    const storage = normaliseStorage(r.storage);
    const replay = normaliseReplay(r.replay);
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
    if (context.screen)
        facts.push(["Screen", context.screen]);
    if (context.userAgent)
        facts.push(["Browser", context.userAgent]);
    if (context.language)
        facts.push(["Language", context.language]);
    if (context.timezone)
        facts.push(["Time zone", context.timezone]);
    if (context.colorScheme)
        facts.push(["Colour scheme", context.colorScheme]);
    if (typeof context.online === "boolean")
        facts.push(["Online", context.online ? "yes" : "no"]);
    if (context.connection)
        facts.push(["Connection", context.connection]);
    const ts = consoleEntries.at(-1)?.ts;
    if (ts)
        facts.push(["Last console entry", ts]);
    // One line rather than a section: the events themselves are for a player,
    // not for a reader, so what a reader wants here is that there is a recording
    // and roughly how much of one.
    if (replay) {
        const count = `${replay.events.length} event${replay.events.length === 1 ? "" : "s"}`;
        facts.push(["Replay", `${count} over ${replay.seconds} s (attached)`]);
    }
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
    if (network.length > 0) {
        out.push("### Requests", "");
        out.push("| Method | URL | Status | ms |", "|---|---|---|---|");
        for (const entry of network)
            out.push(requestRow(entry));
        out.push("");
    }
    if (perf) {
        const rows = perfRows(perf);
        if (rows.length > 0) {
            out.push("### Performance", "", "| | |", "|---|---|");
            for (const [k, v] of rows)
                out.push(`| ${cell(k)} | ${cell(v)} |`);
            out.push("");
        }
    }
    if (storage) {
        const lines = storageLines(storage);
        if (lines.length > 0) {
            const body = lines.map((line) => `- ${line}`);
            if (options.collapseStorage ?? true) {
                out.push("<details><summary>Storage</summary>", "", ...body, "", "</details>", "");
            }
            else {
                out.push("### Storage", "", ...body, "");
            }
        }
    }
    if (consoleEntries.length > 0) {
        const lines = [];
        for (const e of consoleEntries) {
            lines.push(`${e.ts ? `${e.ts} ` : ""}[${e.level}] ${e.message}`);
            // The top of the stack is where the fault is; the rest is framework.
            for (const f of (e.stack ?? []).slice(0, MAX_RENDERED_STACK_FRAMES)) {
                lines.push(`    at ${f.fn ? `${f.fn} ` : ""}${f.file}:${f.line}:${f.col}`);
            }
        }
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