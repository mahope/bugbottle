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
import { toMarkdown } from "../markdown.js";
import { messageFromBody, readBody, SinkError } from "./error.js";
const GITHUB_API = "https://api.github.com";
/** The version this sink was written against; GitHub asks callers to pin one. */
const GITHUB_API_VERSION = "2022-11-28";
/**
 * The rendered title of a report, type label and all — "Bug: The save button
 * does nothing". `toMarkdown` already decides how long a title may be and what
 * to fall back to when the message is empty, so we ask it rather than
 * repeating the rules here.
 */
function titleOf(report, options) {
    const heading = toMarkdown(report, {
        ...options,
        headingLevel: 1,
        typeInTitle: true,
    }).split(/\r?\n/)[0] ?? "";
    return heading.replace(/^#{1,6}\s*/, "").trim();
}
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
export async function createGithubIssue(report, options) {
    // An explicit screenshotUrl wins over one already sitting in the markdown
    // options, so the call site nearest the storage decision is the one heard.
    const markdownOptions = {
        ...options.markdown,
        ...(options.screenshotUrl ? { screenshotUrl: options.screenshotUrl } : {}),
    };
    const payload = {
        title: options.title ?? titleOf(report, markdownOptions),
        body: toMarkdown(report, markdownOptions),
    };
    if (options.labels && options.labels.length > 0)
        payload.labels = options.labels;
    const url = `${GITHUB_API}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/issues`;
    const doFetch = options.fetch ?? globalThis.fetch;
    const response = await doFetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${options.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
            "Content-Type": "application/json",
            // GitHub rejects a request without one, and this names the library in
            // the repository's audit log.
            "User-Agent": "bugbottle",
        },
        body: JSON.stringify(payload),
    });
    const body = await readBody(response);
    if (!response.ok) {
        const fallback = `GitHub refused the issue with status ${response.status}`;
        throw new SinkError(messageFromBody(body, fallback), response.status, body);
    }
    const issue = (body ?? {});
    return {
        number: typeof issue.number === "number" ? issue.number : undefined,
        url: typeof issue.html_url === "string" ? issue.html_url : undefined,
    };
}
//# sourceMappingURL=github.js.map