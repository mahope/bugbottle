/**
 * Filing a report as a GitHub issue.
 *
 * For a small team this is the whole backend: the report lands in the same
 * list as everything else that is broken, with the same labels, assignees and
 * search. One `fetch` and a formatter, like the other sinks, and like them the
 * token is an argument rather than something read from the environment — a
 * sink that reaches for `process.env` on its own hides where the secret came
 * from at the call site.
 *
 * Server-only. A token that reaches the browser is a token that has been given
 * away, and this one can write to your repository.
 *
 * One limitation worth knowing before you design around it: the issues API
 * cannot take an attachment. Pictures in an issue body are uploads made by the
 * web editor, and there is no public endpoint for that. So the screenshot has
 * to be stored by you first; pass its address as `screenshotUrl` and the body
 * links to it. See the privacy note in the README before that address becomes
 * a public one.
 */
import { type MarkdownOptions } from "../markdown.ts";
import { type FetchLike } from "./error.ts";
export type CreateGithubIssueOptions = {
    /** A token with issues write on the repository. Fine-grained is enough. */
    token: string;
    /** Repository owner — a user or an organisation. */
    owner: string;
    /** Repository name, without the owner. */
    repo: string;
    /** Labels to file the issue under. They must already exist on the repo. */
    labels?: string[];
    /** Overrides the title built from the report type and its first line. */
    title?: string;
    /**
     * Where you stored the screenshot. Linked from the body, because the API
     * cannot carry the picture itself.
     */
    screenshotUrl?: string;
    /** Injected `fetch`, for tests or a runtime with its own client. */
    fetch?: FetchLike;
    /** Passed through to `toMarkdown` — extra facts, a heading level. */
    markdown?: MarkdownOptions;
};
export type CreateGithubIssueResult = {
    /** The issue number, as people refer to it: `#41`. */
    number: number | undefined;
    /** The `html_url` of the new issue, for a log line or a redirect. */
    url: string | undefined;
};
/**
 * Opens an issue with the report as its body. Resolves with the issue number
 * and its URL, throws `SinkError` carrying the status and the response body on
 * anything but a 2xx — a 401 for a spent token, a 404 for a repository the
 * token cannot see, a 410 when issues are disabled — and lets network failures
 * from `fetch` propagate as they are.
 *
 * A malformed report is not an error here: `toMarkdown` renders whatever it
 * can, so a half-built report still gets filed where somebody can see that
 * something is wrong.
 */
export declare function createGithubIssue(report: unknown, options: CreateGithubIssueOptions): Promise<CreateGithubIssueResult>;
//# sourceMappingURL=github.d.ts.map