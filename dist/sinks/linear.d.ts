/**
 * Filing a report as a Linear issue.
 *
 * Linear is where a lot of small teams already track what is broken, so the
 * argument for this sink is the same as for the GitHub one: the report lands
 * in the list people look at, with their labels and their triage, instead of
 * in a mailbox nobody owns.
 *
 * The API is GraphQL rather than REST, which changes one thing worth knowing:
 * a rejected mutation still answers 200 and puts the reason in an `errors`
 * array. Checking `response.ok` alone would report a silent success, so the
 * body is inspected as well.
 *
 * Server-only, and the key is an argument like every other sink's — a Linear
 * API key can read and write everything the person who issued it can.
 *
 * Linear has no way to attach a picture through this mutation either, so the
 * screenshot has to be stored by you first and travels as `screenshotUrl`.
 */
import { type MarkdownOptions } from "../markdown.ts";
import { type FetchLike } from "./error.ts";
export type CreateLinearIssueOptions = {
    /**
     * A Linear API key. Personal keys and OAuth access tokens both go in the
     * `Authorization` header as they are — Linear does not want a `Bearer`
     * prefix on a personal key.
     */
    apiKey: string;
    /** The team the issue belongs to, as a UUID. Required by Linear. */
    teamId: string;
    /** Optional project UUID, when reports belong in one. */
    projectId?: string;
    /** Label UUIDs to file the issue under. Linear takes ids, not names. */
    labelIds?: string[];
    /** Overrides the title built from the report type and its first line. */
    title?: string;
    /**
     * Where you stored the screenshot. Linked from the description, because the
     * mutation cannot carry the picture itself.
     */
    screenshotUrl?: string;
    /** Injected `fetch`, for tests or a runtime with its own client. */
    fetch?: FetchLike;
    /** Passed through to `toMarkdown` — extra facts, a heading level. */
    markdown?: MarkdownOptions;
};
export type CreateLinearIssueResult = {
    /** The issue UUID, which is what the API takes back. */
    id: string | undefined;
    /** The human identifier, e.g. `ENG-214`. */
    identifier: string | undefined;
    /** The issue URL, for a log line or a redirect. */
    url: string | undefined;
};
/**
 * Opens a Linear issue with the report as its description. Resolves with the
 * issue id, identifier and URL, and throws `SinkError` on anything that is not
 * a created issue: a non-2xx status, a 200 carrying GraphQL `errors`, or a
 * mutation that answers `success: false`. Network failures from `fetch`
 * propagate as they are.
 *
 * A malformed report is not an error here: `toMarkdown` renders whatever it
 * can, so a half-built report still gets filed where somebody can see that
 * something is wrong.
 */
export declare function createLinearIssue(report: unknown, options: CreateLinearIssueOptions): Promise<CreateLinearIssueResult>;
//# sourceMappingURL=linear.d.ts.map