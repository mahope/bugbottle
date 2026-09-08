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

import { toMarkdown, type MarkdownOptions } from "../markdown.ts";
import { readBody, SinkError, type FetchLike } from "./error.ts";
import { clip, resolveUrl, type ChatSinkContext, type UrlFrom } from "./chat.ts";

/** Where the API lives, under whichever host. */
const GITLAB_API_PATH = "/api/v4";

/** gitlab.com, for everyone who is not self-hosting. */
export const DEFAULT_GITLAB_HOST = "https://gitlab.com";

/** The longest description GitLab accepts. Anything past it is a 400. */
export const MAX_GITLAB_DESCRIPTION = 1048576;

/** The longest title GitLab keeps. */
export const MAX_GITLAB_TITLE = 255;

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
export type GitlabSink = (
  report: unknown,
  ctx?: ChatSinkContext,
) => Promise<CreateGitlabIssueResult>;

/**
 * The rendered title of a report, type label and all — "Bug: The save button
 * does nothing". `toMarkdown` already decides how long a title may be and what
 * to fall back to when the message is empty, so we ask it rather than
 * repeating the rules here.
 */
function titleOf(report: unknown, options: MarkdownOptions): string {
  const heading = toMarkdown(report, {
    ...options,
    headingLevel: 1,
    typeInTitle: true,
  }).split(/\r?\n/)[0] ?? "";
  return heading.replace(/^#{1,6}\s*/, "").trim();
}

/**
 * Pulls the reason out of a GitLab error body. A validation failure answers
 * `{ message: { title: ["can't be blank"] } }`, a refusal answers a flat
 * `{ message: "404 Project Not Found" }`, and some endpoints use `error`
 * instead. All three are read, because the useful one differs by failure.
 */
export function messageFromGitlabBody(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 500);
  if (typeof body !== "object" || body === null) return fallback;
  const record = body as Record<string, unknown>;

  for (const key of ["message", "error", "error_description"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
    if (typeof value === "object" && value !== null) {
      const parts: string[] = [];
      for (const [field, reasons] of Object.entries(value as Record<string, unknown>)) {
        const list = Array.isArray(reasons) ? reasons : [reasons];
        const text = list.filter((r) => typeof r === "string" && r.trim()).join(", ");
        if (text) parts.push(`${field}: ${text}`);
      }
      if (parts.length > 0) return parts.join("; ").slice(0, 500);
    }
  }

  return fallback;
}

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
export function gitlabSink(options: GitlabSinkOptions): GitlabSink {
  const host = (options.host ?? DEFAULT_GITLAB_HOST).trim().replace(/\/+$/, "");
  // A numeric id needs no encoding and a namespaced path does: the slash in
  // `acme/app` would otherwise be read as another path segment.
  const project = encodeURIComponent(String(options.projectId));
  const url = `${host}${GITLAB_API_PATH}/projects/${project}/issues`;

  return async (report, ctx = {}) => {
    const screenshotUrl = resolveUrl(
      options.screenshotUrlFrom,
      report,
      options.screenshotUrl ?? ctx.screenshotUrl,
    );
    // An explicit screenshotUrl wins over one already sitting in the markdown
    // options, so the call site nearest the storage decision is the one heard.
    const markdownOptions: MarkdownOptions = {
      ...options.markdown,
      ...(screenshotUrl ? { screenshotUrl } : {}),
    };

    const payload: Record<string, unknown> = {
      title: clip(options.title ?? titleOf(report, markdownOptions), MAX_GITLAB_TITLE),
      description: clip(toMarkdown(report, markdownOptions), MAX_GITLAB_DESCRIPTION),
    };
    // GitLab takes labels as one comma-separated string, not as an array.
    if (options.labels && options.labels.length > 0) payload.labels = options.labels.join(",");

    const doFetch = options.fetch ?? globalThis.fetch;
    const response = await doFetch(url, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": options.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    const body = await readBody(response);
    if (!response.ok) {
      const fallback = `GitLab refused the issue with status ${response.status}`;
      throw new SinkError(messageFromGitlabBody(body, fallback), response.status, body);
    }

    const issue = (body ?? {}) as { id?: unknown; iid?: unknown; web_url?: unknown };
    return {
      id: typeof issue.id === "number" ? issue.id : undefined,
      iid: typeof issue.iid === "number" ? issue.iid : undefined,
      url: typeof issue.web_url === "string" ? issue.web_url : undefined,
    };
  };
}
