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
    /** Wrap the storage section in a `<details>` block. Default true. */
    collapseStorage?: boolean;
};
/**
 * Renders a report (raw request body or validated) as Markdown. Never throws
 * on malformed input: missing sections are left out.
 */
export declare function toMarkdown(raw: unknown, options?: MarkdownOptions): string;
//# sourceMappingURL=markdown.d.ts.map