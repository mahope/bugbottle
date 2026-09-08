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
import { type FetchLike } from "./error.ts";
import { type ChatSinkContext, type UrlFrom } from "./chat.ts";
/** The issue type used when the project's own name for a defect is not given. */
export declare const DEFAULT_JIRA_ISSUE_TYPE = "Bug";
/**
 * How many console entries reach the code block. Jira renders a code block in
 * full with no way to collapse it, so an issue is not the place for fifty
 * lines; the whole console is in the report you stored.
 */
export declare const MAX_JIRA_CONSOLE_ENTRIES = 20;
/** Jira accepts a longer summary than this, but truncates it in every list. */
export declare const MAX_JIRA_SUMMARY = 255;
/** A node in an Atlassian Document Format tree. Only the four kinds used here. */
export type AdfNode = {
    type: string;
    attrs?: Record<string, unknown>;
    text?: string;
    content?: AdfNode[];
};
/** The top-level ADF document, which is what `description` must be. */
export type AdfDoc = {
    type: "doc";
    /** ADF's own schema version. 1 is the only one Jira Cloud accepts. */
    version: 1;
    content: AdfNode[];
};
export type JiraSinkOptions = {
    /**
     * The Atlassian site. A bare name (`acme`), a host (`acme.atlassian.net`) or
     * a full base URL all work; the first two are completed to
     * `https://<name>.atlassian.net`.
     */
    site: string;
    /** The Atlassian account the token belongs to. Half of the basic auth pair. */
    email: string;
    /**
     * An API token from id.atlassian.com. Sent as the password half of basic
     * auth — an argument, never something this sink reads from the environment.
     */
    apiToken: string;
    /** The project key reports are filed under, e.g. `SUP`. */
    projectKey: string;
    /** The issue type by name. Default `Bug`; it must exist in the project. */
    issueType?: string;
    /** Overrides the summary built from the report type and its first line. */
    title?: string;
    /**
     * Where you stored the screenshot. Listed among the facts, because the
     * create request cannot carry the picture itself.
     */
    screenshotUrl?: string;
    /** Picks the screenshot address out of the report, when it travels there. */
    screenshotUrlFrom?: UrlFrom;
    /** Extra facts for the bullet list, e.g. `{ App: "checkout 1.4.2" }`. */
    facts?: Record<string, string | number | undefined>;
    /** How many console entries reach the code block. Default 20. */
    maxConsoleEntries?: number;
    /** Injected `fetch`, for tests or a runtime with its own client. */
    fetch?: FetchLike;
};
export type CreateJiraIssueResult = {
    /** The issue id, which is what the rest of the API takes back. */
    id: string | undefined;
    /** The human key, e.g. `SUP-214`. */
    key: string | undefined;
    /** The `self` link Jira answered with, for a log line. */
    url: string | undefined;
};
/** A sink that files one Jira issue per report. */
export type JiraSink = (report: unknown, ctx?: ChatSinkContext) => Promise<CreateJiraIssueResult>;
/**
 * `acme`, `acme.atlassian.net` and `https://acme.atlassian.net/` all name the
 * same site, and all three get typed. The trailing slash goes so the path
 * below can be appended without doubling it.
 */
export declare function jiraBaseUrl(site: string): string;
/**
 * Basic auth, UTF-8 safe. `btoa` takes code units rather than characters, so
 * an email or a token with a non-ASCII character in it has to be encoded
 * first — otherwise `btoa` throws and the report is lost to a formatting bug.
 */
export declare function jiraAuthHeader(email: string, apiToken: string): string;
/**
 * The report as an ADF document. Never throws on a malformed body: every field
 * goes through the `normalise*` functions first, so a half-built report still
 * gets filed where somebody can see that something is wrong.
 */
export declare function buildJiraDescription(report: unknown, options?: Pick<JiraSinkOptions, "facts" | "maxConsoleEntries" | "screenshotUrl" | "screenshotUrlFrom">, ctx?: ChatSinkContext): AdfDoc;
/**
 * Pulls the reason out of a Jira error body, which carries two lists: the
 * general `errorMessages` and the per-field `errors` — "issuetype: Specify an
 * issue type" is the one you get for a type the project does not have. Both
 * are joined, because either can be the empty one.
 */
export declare function messageFromJiraBody(body: unknown, fallback: string): string;
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
export declare function jiraSink(options: JiraSinkOptions): JiraSink;
//# sourceMappingURL=jira.d.ts.map