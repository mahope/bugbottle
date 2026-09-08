/**
 * Filing a report as a GitLab issue.
 *
 * The simplest of the issue sinks, because GitLab's issue description is
 * Markdown and `toMarkdown` already produces it: the body goes over verbatim,
 * tables, collapsed console block and all. One `fetch`, and the token is an
 * argument like every other sink's rather than something read from the
 * environment.
 *
 * Self-hosted GitLab is the same API on a different host, so `host` is an
 * option rather than a constant. It defaults to gitlab.com.
 *
 * Server-only. A project access token with the `api` scope can write
 * everything in the project it belongs to.
 *
 * No attachments in this version. GitLab takes an upload through a separate
 * `POST /projects/:id/uploads` and then a Markdown reference to what it
 * answers with, which is a second request in a different shape; see the
 * roadmap. Until then the screenshot has to be stored by you first and travels
 * as `screenshotUrl`, linked from the facts table.
 *
 * Checked against the GitLab Issues API documentation ("New issue") on
 * 2026-09-08.
 */
import { type MarkdownOptions } from "../markdown.ts";
import { type FetchLike } from "./error.ts";
import { type ChatSinkContext, type UrlFrom } from "./chat.ts";
/** gitlab.com, for everyone who is not self-hosting. */
export declare const DEFAULT_GITLAB_HOST = "https://gitlab.com";
/** The longest description GitLab accepts. Anything past it is a 400. */
export declare const MAX_GITLAB_DESCRIPTION = 1048576;
/** The longest title GitLab keeps. */
export declare const MAX_GITLAB_TITLE = 255;
export type GitlabSinkOptions = {
    /**
     * The GitLab base URL, for a self-hosted instance:
     * `https://gitlab.example.com`. Default `https://gitlab.com`.
     */
    host?: string;
    /**
     * The project: its numeric id, or its namespaced path (`acme/app`), which is
     * URL-encoded here so the slash survives the path segment.
     */
    projectId: string | number;
    /** A personal, group or project access token with the `api` scope. */
    token: string;
    /** Labels for the new issue. GitLab creates the ones that do not exist. */
    labels?: string[];
    /** Overrides the title built from the report type and its first line. */
    title?: string;
    /**
     * Where you stored the screenshot. Linked from the description, because the
     * create request cannot carry the picture itself.
     */
    screenshotUrl?: string;
    /** Picks the screenshot address out of the report, when it travels there. */
    screenshotUrlFrom?: UrlFrom;
    /** Injected `fetch`, for tests or a runtime with its own client. */
    fetch?: FetchLike;
    /** Passed through to `toMarkdown` — extra facts, a heading level. */
    markdown?: MarkdownOptions;
};
export type CreateGitlabIssueResult = {
    /** The instance-wide issue id. */
    id: number | undefined;
    /** The per-project number people say out loud: `#41`. */
    iid: number | undefined;
    /** The `web_url` of the new issue, for a log line or a redirect. */
    url: string | undefined;
};
/** A sink that files one GitLab issue per report. */
export type GitlabSink = (report: unknown, ctx?: ChatSinkContext) => Promise<CreateGitlabIssueResult>;
/**
 * Pulls the reason out of a GitLab error body. A validation failure answers
 * `{ message: { title: ["can't be blank"] } }`, a refusal answers a flat
 * `{ message: "404 Project Not Found" }`, and some endpoints use `error`
 * instead. All three are read, because the useful one differs by failure.
 */
export declare function messageFromGitlabBody(body: unknown, fallback: string): string;
/**
 * A sink that files one GitLab issue per report, with the Markdown from
 * `toMarkdown` as its description. Resolves with the issue id, its per-project
 * `iid` and its URL; throws `SinkError` carrying the status and the response
 * body on anything but a 2xx — a 401 for a spent token, a 404 for a project
 * the token cannot see, which is what GitLab answers instead of 403 — and lets
 * network failures from `fetch` propagate as they are.
 *
 * A malformed report is not an error here: `toMarkdown` renders whatever it
 * can, so a half-built report still gets filed where somebody can see that
 * something is wrong.
 *
 * ```ts
 * handleReport(req, {
 *   sinks: [gitlabSink({ projectId: "acme/app", token: process.env.GITLAB_TOKEN! })],
 * });
 * ```
 */
export declare function gitlabSink(options: GitlabSinkOptions): GitlabSink;
//# sourceMappingURL=gitlab.d.ts.map