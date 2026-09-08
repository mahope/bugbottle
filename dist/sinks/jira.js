/**
 * Filing a report as a Jira Cloud issue.
 *
 * The argument is the same as for the GitHub and Linear sinks: the report
 * lands in the list the team already triages, rather than in a mailbox nobody
 * owns. What is different is the body. Jira Cloud's REST v3 does not take
 * Markdown or wiki markup in `description` — it takes the Atlassian Document
 * Format, a JSON document tree. So this sink is the one place in the library
 * that renders a report as something other than Markdown.
 *
 * The conversion is deliberately minimal, and built from the report rather
 * than from `toMarkdown`'s output: parsing Markdown back into a node tree
 * would be a second renderer to keep correct. Three shapes carry everything a
 * reader needs — a paragraph for the reporter's own words, a bullet list for
 * the facts, and a code block for the console. ADF has tables and panels; none
 * of them is worth the schema risk of a rejected create.
 *
 * Server-only. A Jira API token is the person who issued it: it can read and
 * write every project they can.
 *
 * No attachments in this version. Jira takes them through a second request to
 * `/rest/api/3/issue/{key}/attachments` with a multipart body and an
 * `X-Atlassian-Token: no-check` header, which is a different shape from every
 * other sink here; see the roadmap. Until then the screenshot has to be stored
 * by you first and travels as `screenshotUrl`, linked from the facts.
 *
 * Checked against the Jira Cloud platform REST API v3 documentation for
 * "Create issue" and the Atlassian Document Format structure reference on
 * 2026-09-08.
 */
import { isReportType, normaliseConsole, normaliseContact, normaliseContext, normaliseElements, normaliseMessage, } from "../report-core.js";
import { messageFromBody, readBody, SinkError } from "./error.js";
import { clip, resolveUrl } from "./chat.js";
/** The v3 path, appended to the site's base URL. */
const JIRA_ISSUE_PATH = "/rest/api/3/issue";
/** The issue type used when the project's own name for a defect is not given. */
export const DEFAULT_JIRA_ISSUE_TYPE = "Bug";
/**
 * How many console entries reach the code block. Jira renders a code block in
 * full with no way to collapse it, so an issue is not the place for fifty
 * lines; the whole console is in the report you stored.
 */
export const MAX_JIRA_CONSOLE_ENTRIES = 20;
/** Jira accepts a longer summary than this, but truncates it in every list. */
export const MAX_JIRA_SUMMARY = 255;
/** The longest first line the generated summary keeps before the ellipsis. */
const MAX_TITLE_LENGTH = 80;
/** Human labels, the same ones the Markdown renderer uses. */
const TYPE_LABEL = {
    bug: "Bug",
    idea: "Idea",
    other: "Feedback",
};
/**
 * `acme`, `acme.atlassian.net` and `https://acme.atlassian.net/` all name the
 * same site, and all three get typed. The trailing slash goes so the path
 * below can be appended without doubling it.
 */
export function jiraBaseUrl(site) {
    const trimmed = site.trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(trimmed))
        return trimmed;
    if (trimmed.includes("."))
        return `https://${trimmed}`;
    return `https://${trimmed}.atlassian.net`;
}
/**
 * Basic auth, UTF-8 safe. `btoa` takes code units rather than characters, so
 * an email or a token with a non-ASCII character in it has to be encoded
 * first — otherwise `btoa` throws and the report is lost to a formatting bug.
 */
export function jiraAuthHeader(email, apiToken) {
    const bytes = new TextEncoder().encode(`${email}:${apiToken}`);
    return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}
/** A paragraph of plain text. Empty text is dropped: ADF rejects an empty node. */
function paragraph(text) {
    if (!text)
        return undefined;
    return { type: "paragraph", content: [{ type: "text", text }] };
}
/** One bullet per fact. A `listItem` must hold a block, so each holds a paragraph. */
function bulletList(lines) {
    const items = lines
        .map((line) => paragraph(line))
        .filter((node) => node !== undefined)
        .map((node) => ({ type: "listItem", content: [node] }));
    if (items.length === 0)
        return undefined;
    return { type: "bulletList", content: items };
}
/** A fenced block. `language` is an attribute rather than part of the text. */
function codeBlock(text, language) {
    if (!text)
        return undefined;
    return { type: "codeBlock", attrs: { language }, content: [{ type: "text", text }] };
}
/**
 * The report as an ADF document. Never throws on a malformed body: every field
 * goes through the `normalise*` functions first, so a half-built report still
 * gets filed where somebody can see that something is wrong.
 */
export function buildJiraDescription(report, options = {}, ctx = {}) {
    const r = (typeof report === "object" && report !== null ? report : {});
    const type = isReportType(r.type) ? r.type : "other";
    const message = normaliseMessage(r.message) ?? "";
    const context = normaliseContext(r.context);
    const elements = normaliseElements(r.elements);
    const entries = normaliseConsole(r.console, {
        maxEntries: options.maxConsoleEntries ?? MAX_JIRA_CONSOLE_ENTRIES,
    });
    const facts = [`Type: ${TYPE_LABEL[type]}`];
    // Directly under the type, exactly where `toMarkdown` puts it: a triager
    // deciding what to do with a report wants to know whether they can answer it
    // before anything else. This sink builds its own facts rather than rendering
    // Markdown, so the line has to be added here as well or a team on Jira is
    // the one team that asked for a contact and never sees it.
    const contact = normaliseContact(r.contact);
    if (contact)
        facts.push(`Contact: ${contact}`);
    if (context.url)
        facts.push(`Page: ${context.url}`);
    if (context.viewport)
        facts.push(`Viewport: ${context.viewport}`);
    if (context.screen)
        facts.push(`Screen: ${context.screen}`);
    if (context.userAgent)
        facts.push(`Browser: ${context.userAgent}`);
    if (context.language)
        facts.push(`Language: ${context.language}`);
    if (context.timezone)
        facts.push(`Time zone: ${context.timezone}`);
    if (context.colorScheme)
        facts.push(`Colour scheme: ${context.colorScheme}`);
    if (typeof context.online === "boolean")
        facts.push(`Online: ${context.online ? "yes" : "no"}`);
    if (context.connection)
        facts.push(`Connection: ${context.connection}`);
    const screenshot = resolveUrl(options.screenshotUrlFrom, report, options.screenshotUrl ?? ctx.screenshotUrl);
    if (screenshot)
        facts.push(`Screenshot: ${screenshot}`);
    for (const [key, value] of Object.entries(options.facts ?? {})) {
        if (value !== undefined && value !== "")
            facts.push(`${key}: ${value}`);
    }
    const content = [];
    const words = paragraph(message);
    if (words)
        content.push(words);
    const list = bulletList(facts);
    if (list)
        content.push(list);
    if (elements.length > 0) {
        const heading = paragraph(elements.length > 1 ? "Elements pointed at" : "Element pointed at");
        if (heading)
            content.push(heading);
        const lines = elements.map((el) => {
            const bits = [el.selector];
            if (el.text)
                bits.push(`— "${el.text}"`);
            bits.push(`at ${el.rect.x},${el.rect.y} ${el.rect.width}×${el.rect.height}`);
            return bits.join(" ");
        });
        const elementList = bulletList(lines);
        if (elementList)
            content.push(elementList);
    }
    if (entries.length > 0) {
        const heading = paragraph(`Console (${entries.length} ${entries.length === 1 ? "entry" : "entries"})`);
        if (heading)
            content.push(heading);
        const text = entries
            .map((e) => `${e.ts ? `${e.ts} ` : ""}[${e.level}] ${e.message}`)
            .join("\n");
        const block = codeBlock(text, "text");
        if (block)
            content.push(block);
    }
    // A doc with no content at all is rejected, and a report with neither a
    // message nor any context is still worth filing.
    if (content.length === 0) {
        content.push({ type: "paragraph", content: [{ type: "text", text: TYPE_LABEL[type] }] });
    }
    return { type: "doc", version: 1, content };
}
/** The summary: the report's type and its first line, clipped to Jira's limit. */
function summaryOf(report) {
    const r = (typeof report === "object" && report !== null ? report : {});
    const type = isReportType(r.type) ? r.type : "other";
    const message = normaliseMessage(r.message) ?? "";
    const firstLine = message.split(/\r?\n/)[0]?.trim() ?? "";
    return clip(`${TYPE_LABEL[type]}: ${clip(firstLine, MAX_TITLE_LENGTH) || TYPE_LABEL[type]}`, MAX_JIRA_SUMMARY);
}
/**
 * Pulls the reason out of a Jira error body, which carries two lists: the
 * general `errorMessages` and the per-field `errors` — "issuetype: Specify an
 * issue type" is the one you get for a type the project does not have. Both
 * are joined, because either can be the empty one.
 */
export function messageFromJiraBody(body, fallback) {
    if (typeof body !== "object" || body === null)
        return messageFromBody(body, fallback);
    const record = body;
    const parts = [];
    if (Array.isArray(record.errorMessages)) {
        for (const entry of record.errorMessages) {
            if (typeof entry === "string" && entry.trim())
                parts.push(entry.trim());
        }
    }
    if (typeof record.errors === "object" && record.errors !== null) {
        for (const [field, value] of Object.entries(record.errors)) {
            if (typeof value === "string" && value.trim())
                parts.push(`${field}: ${value.trim()}`);
        }
    }
    return parts.length > 0 ? parts.join("; ").slice(0, 500) : messageFromBody(body, fallback);
}
/**
 * A sink that files one Jira Cloud issue per report. Resolves with the issue
 * id, key and `self` link; throws `SinkError` carrying the status and the
 * response body on anything but a 2xx — a 401 for a spent token, a 403 for an
 * account without Create Issues, a 400 naming the field Jira did not like —
 * and lets network failures from `fetch` propagate as they are.
 *
 * ```ts
 * handleReport(req, {
 *   sinks: [
 *     jiraSink({
 *       site: "acme",
 *       email: process.env.JIRA_EMAIL!,
 *       apiToken: process.env.JIRA_API_TOKEN!,
 *       projectKey: "SUP",
 *     }),
 *   ],
 * });
 * ```
 */
export function jiraSink(options) {
    const url = `${jiraBaseUrl(options.site)}${JIRA_ISSUE_PATH}`;
    return async (report, ctx = {}) => {
        const payload = {
            fields: {
                project: { key: options.projectKey },
                issuetype: { name: options.issueType ?? DEFAULT_JIRA_ISSUE_TYPE },
                summary: options.title ? clip(options.title, MAX_JIRA_SUMMARY) : summaryOf(report),
                description: buildJiraDescription(report, options, ctx),
            },
        };
        const doFetch = options.fetch ?? globalThis.fetch;
        const response = await doFetch(url, {
            method: "POST",
            headers: {
                Authorization: jiraAuthHeader(options.email, options.apiToken),
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        const body = await readBody(response);
        if (!response.ok) {
            const fallback = `Jira refused the issue with status ${response.status}`;
            throw new SinkError(messageFromJiraBody(body, fallback), response.status, body);
        }
        const issue = (body ?? {});
        return {
            id: typeof issue.id === "string" ? issue.id : undefined,
            key: typeof issue.key === "string" ? issue.key : undefined,
            url: typeof issue.self === "string" ? issue.self : undefined,
        };
    };
}
//# sourceMappingURL=jira.js.map