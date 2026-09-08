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

import { toMarkdown, type MarkdownOptions } from "../markdown.ts";
import { messageFromBody, readBody, SinkError, type FetchLike } from "./error.ts";
import { resolveUrl, type UrlFrom } from "./chat.ts";

const LINEAR_API = "https://api.linear.app/graphql";

/**
 * Asking for the issue back rather than only `success` costs nothing and gives
 * the caller something to log: the identifier is what people say out loud.
 */
const ISSUE_CREATE = `mutation BugbottleIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier url }
  }
}`;

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
  /** Picks the screenshot address out of the report, when it travels there. */
  screenshotUrlFrom?: UrlFrom;
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

/** Everything GraphQL might hand back, before any of it is trusted. */
type GraphqlBody = {
  data?: { issueCreate?: { success?: unknown; issue?: unknown } };
  errors?: unknown;
};

/**
 * Pulls a reason out of the `errors` array. GraphQL entries are objects with a
 * `message`, but a proxy in front of the API can answer with anything, so this
 * only reads what it recognises.
 */
function messageFromGraphqlErrors(errors: unknown): string | undefined {
  if (!Array.isArray(errors) || errors.length === 0) return undefined;
  const messages: string[] = [];
  for (const entry of errors) {
    if (typeof entry === "string" && entry.trim()) messages.push(entry.trim());
    else if (typeof entry === "object" && entry !== null) {
      const message = (entry as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) messages.push(message.trim());
    }
  }
  return messages.length > 0 ? messages.join("; ").slice(0, 500) : undefined;
}

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
export async function createLinearIssue(
  report: unknown,
  options: CreateLinearIssueOptions,
): Promise<CreateLinearIssueResult> {
  // An explicit screenshotUrl wins over one already sitting in the markdown
  // options, so the call site nearest the storage decision is the one heard,
  // and `screenshotUrlFrom` wins over both because it reads the report itself.
  const screenshotUrl = resolveUrl(options.screenshotUrlFrom, report, options.screenshotUrl);
  const markdownOptions: MarkdownOptions = {
    ...options.markdown,
    ...(screenshotUrl ? { screenshotUrl } : {}),
  };

  const input: Record<string, unknown> = {
    teamId: options.teamId,
    title: options.title ?? titleOf(report, markdownOptions),
    description: toMarkdown(report, markdownOptions),
  };
  if (options.projectId) input.projectId = options.projectId;
  if (options.labelIds && options.labelIds.length > 0) input.labelIds = options.labelIds;

  const doFetch = options.fetch ?? globalThis.fetch;
  const response = await doFetch(LINEAR_API, {
    method: "POST",
    headers: {
      Authorization: options.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: ISSUE_CREATE, variables: { input } }),
  });

  const body = await readBody(response);
  if (!response.ok) {
    const fallback = `Linear refused the issue with status ${response.status}`;
    throw new SinkError(messageFromBody(body, fallback), response.status, body);
  }

  const graphql = (body ?? {}) as GraphqlBody;
  const graphqlError = messageFromGraphqlErrors(graphql.errors);
  if (graphqlError !== undefined) {
    // A GraphQL failure arrives with a 200, so the status kept on the error is
    // the transport's and not the outcome's. It is still the honest number to
    // log next to the body.
    throw new SinkError(graphqlError, response.status, body);
  }

  const result = graphql.data?.issueCreate;
  if (!result || result.success === false) {
    throw new SinkError("Linear did not create the issue", response.status, body);
  }

  const issue = (result.issue ?? {}) as { id?: unknown; identifier?: unknown; url?: unknown };
  return {
    id: typeof issue.id === "string" ? issue.id : undefined,
    identifier: typeof issue.identifier === "string" ? issue.identifier : undefined,
    url: typeof issue.url === "string" ? issue.url : undefined,
  };
}
