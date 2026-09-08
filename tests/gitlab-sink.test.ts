import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gitlabSink,
  messageFromGitlabBody,
  MAX_GITLAB_TITLE,
} from "../src/sinks/gitlab.ts";
import { SinkError } from "../src/sinks/error.ts";

/** A fetch stand-in that records the request and answers with the given body. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** The JSON body of the single recorded request. */
function sentBody(calls: { init: RequestInit }[]): Record<string, unknown> {
  assert.equal(calls.length, 1, "exactly one request was made");
  return JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

const created = {
  id: 4001,
  iid: 41,
  web_url: "https://gitlab.com/acme/app/-/issues/41",
};

const report = {
  type: "bug",
  message: "The save button does nothing",
  context: { url: "/orders/91", viewport: "1440×900", userAgent: "Chrome 141" },
  console: [{ level: "error", message: "save failed", ts: "2026-09-07T10:00:00.000Z" }],
};

test("the issue goes to gitlab.com with a PRIVATE-TOKEN header", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  const result = await gitlabSink({ projectId: 7, token: "glpat-x", fetch })(report);

  assert.deepEqual(result, {
    id: 4001,
    iid: 41,
    url: "https://gitlab.com/acme/app/-/issues/41",
  });
  assert.equal(calls[0]?.url, "https://gitlab.com/api/v4/projects/7/issues");
  assert.equal(calls[0]?.init.method, "POST");
  // GitLab reads the token from its own header, not from Authorization.
  assert.equal(headerOf(calls[0]?.init ?? {}, "PRIVATE-TOKEN"), "glpat-x");
  assert.equal(headerOf(calls[0]?.init ?? {}, "Content-Type"), "application/json");

  const body = sentBody(calls);
  assert.equal(body.title, "Bug: The save button does nothing");
  // The description is the Markdown verbatim, tables and all.
  assert.match(String(body.description), /\| Page \| `\/orders\/91` \|/);
  assert.match(String(body.description), /save failed/);
});

test("a self-hosted host is used as given, trailing slash and all", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await gitlabSink({
    host: "https://gitlab.example.com/",
    projectId: 7,
    token: "t",
    fetch,
  })(report);
  assert.equal(calls[0]?.url, "https://gitlab.example.com/api/v4/projects/7/issues");
});

test("a namespaced project path is URL-encoded into the one segment", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await gitlabSink({ projectId: "acme/app", token: "t", fetch })(report);
  // The slash has to survive as %2F, or GitLab reads `app` as the next segment.
  assert.equal(calls[0]?.url, "https://gitlab.com/api/v4/projects/acme%2Fapp/issues");
});

test("labels travel as one comma-separated string, not an array", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await gitlabSink({
    projectId: 7,
    token: "t",
    labels: ["bug", "from-bugbottle"],
    fetch,
  })(report);
  assert.equal(sentBody(calls).labels, "bug,from-bugbottle");
});

test("no labels means no labels field at all", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await gitlabSink({ projectId: 7, token: "t", labels: [], fetch })(report);
  assert.ok(!("labels" in sentBody(calls)));
});

test("a screenshot url is linked in the description", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await gitlabSink({
    projectId: 7,
    token: "t",
    screenshotUrl: "https://files.example.com/shots/abc.png",
    fetch,
  })(report);
  assert.match(String(sentBody(calls).description), /https:\/\/files\.example\.com\/shots\/abc\.png/);
});

test("the url the handler stored is used when the sink was given none", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await gitlabSink({ projectId: 7, token: "t", fetch })(report, {
    screenshotUrl: "https://files.example.com/shots/def.png",
  });
  assert.match(String(sentBody(calls).description), /shots\/def\.png/);
});

test("a title of your own is used, clipped to what GitLab keeps", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  await gitlabSink({ projectId: 7, token: "t", title: "y".repeat(400), fetch })(report);
  assert.equal(String(sentBody(calls).title).length, MAX_GITLAB_TITLE);
});

test("a malformed report is still filed, with a fallback title", async () => {
  const { fetch, calls } = fakeFetch(201, created);
  const result = await gitlabSink({ projectId: 7, token: "t", fetch })(
    { type: "nonsense", message: 42, console: "not an array" },
  );
  assert.equal(result.iid, 41);
  assert.equal(sentBody(calls).title, "Feedback: Feedback");
});

test("a validation failure becomes a SinkError naming the field", async () => {
  const { fetch } = fakeFetch(400, { message: { title: ["can't be blank"] } });
  await assert.rejects(
    () => gitlabSink({ projectId: 7, token: "t", fetch })(report),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 400);
      assert.equal(err.message, "title: can't be blank");
      return true;
    },
  );
});

test("a project the token cannot see answers 404, and that is the error", async () => {
  // GitLab answers 404 rather than 403 for a private project, so the message
  // is the only thing that says which of the two it was.
  const { fetch } = fakeFetch(404, { message: "404 Project Not Found" });
  await assert.rejects(
    () => gitlabSink({ projectId: 7, token: "t", fetch })(report),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 404);
      assert.equal(err.message, "404 Project Not Found");
      return true;
    },
  );
});

test("a 500 with no usable body falls back to naming the status", async () => {
  const { fetch } = fakeFetch(500, {});
  await assert.rejects(
    () => gitlabSink({ projectId: 7, token: "t", fetch })(report),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.equal(err.status, 500);
      assert.equal(err.message, "GitLab refused the issue with status 500");
      return true;
    },
  );
});

test("the error reader handles the flat, the nested and the neither", () => {
  assert.equal(messageFromGitlabBody({ error: "insufficient_scope" }, "fb"), "insufficient_scope");
  assert.equal(
    messageFromGitlabBody({ message: { labels: ["is invalid", "is too long"] } }, "fb"),
    "labels: is invalid, is too long",
  );
  assert.equal(messageFromGitlabBody({ something: 1 }, "fb"), "fb");
  assert.equal(messageFromGitlabBody("plain text", "fb"), "plain text");
});

test("the sink's deadline reaches fetch as an abort signal", async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    seen = init?.signal ?? undefined;
    if (seen?.aborted) throw new DOMException("This operation was aborted", "AbortError");
    return new Response(JSON.stringify(created), { status: 201 });
  }) as typeof globalThis.fetch;

  await gitlabSink({ projectId: 7, token: "t", fetch })(report, { signal: controller.signal });
  assert.equal(seen, controller.signal);

  controller.abort();
  await assert.rejects(
    () => gitlabSink({ projectId: 7, token: "t", fetch })(report, { signal: controller.signal }),
    (err: unknown) => (err as Error).name === "AbortError",
  );
});
