import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildReport, sendReport, SendFailedError, SendTimeoutError } from "../src/send.ts";
import { initConsoleBuffer, resetConsoleBuffer } from "../src/console-buffer.ts";

afterEach(() => resetConsoleBuffer());

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

test("a report carries the message, type, context and console", () => {
  const realError = console.error;
  console.error = () => {};
  try {
    initConsoleBuffer();
    console.error("save failed");
  } finally {
    console.error = realError;
  }
  const report = buildReport({ type: "bug", message: "  it broke  " });
  assert.equal(report.type, "bug");
  assert.equal(report.message, "it broke", "the message is trimmed");
  assert.deepEqual(Object.keys(report.context), ["url", "viewport", "userAgent"]);
  assert.equal(report.console?.length, 1);
  assert.equal("screenshotDataUrl" in report, false, "no screenshot key when there is no picture");
});

test("console and screenshot are left out when asked, and extras cannot override the report", () => {
  const report = buildReport({
    type: "idea",
    message: "x",
    includeConsole: false,
    screenshotDataUrl: "data:image/png;base64,AAAA",
    extra: { appVersion: "1.2.3", type: "spam", message: "overwritten?" },
  });
  assert.equal(report.console, undefined);
  assert.equal(report.screenshotDataUrl, "data:image/png;base64,AAAA");
  assert.equal(report.appVersion, "1.2.3");
  assert.equal(report.type, "idea", "the report type wins over extras");
  assert.equal(report.message, "x");
});

test("a successful send returns the server id and posts JSON", async () => {
  const { fetch, calls } = fakeFetch(201, { id: "r_1" });
  const report = buildReport({ type: "bug", message: "hi", includeConsole: false });
  const result = await sendReport("/api/feedback", report, {
    fetch,
    headers: { Authorization: "Bearer t" },
    credentials: "include",
  });
  assert.equal(result.id, "r_1");
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.url, "/api/feedback");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.credentials, "include");
  assert.deepEqual(call.init.headers, {
    "Content-Type": "application/json",
    Authorization: "Bearer t",
  });
  assert.equal(JSON.parse(String(call.init.body)).message, "hi");
});

test("a non-string id is ignored and a non-JSON body is tolerated", async () => {
  const numeric = await sendReport("/x", buildReport({ type: "bug", message: "a" }), {
    fetch: fakeFetch(200, { id: 42 }).fetch,
  });
  assert.equal(numeric.id, undefined);
  const empty = await sendReport("/x", buildReport({ type: "bug", message: "a" }), {
    fetch: fakeFetch(200, "").fetch,
  });
  assert.equal(empty.body, null);
});

test("a failed response becomes a SendFailedError with the server message", async () => {
  const report = buildReport({ type: "bug", message: "a" });
  await assert.rejects(
    sendReport("/x", report, { fetch: fakeFetch(400, { error: "Write a message first" }).fetch }),
    (err: unknown) =>
      err instanceof SendFailedError &&
      err.status === 400 &&
      err.message === "Write a message first",
  );
  await assert.rejects(
    sendReport("/x", report, { fetch: fakeFetch(500, "<html>oops</html>").fetch }),
    (err: unknown) =>
      err instanceof SendFailedError && err.message === "Request failed with status 500",
  );
  await assert.rejects(
    sendReport("/x", report, {
      fetch: fakeFetch(403, { code: "forbidden" }).fetch,
      parseError: (_res, body) => `Custom: ${(body as { code: string }).code}`,
    }),
    (err: unknown) => err instanceof SendFailedError && err.message === "Custom: forbidden",
  );
});

test("a hung endpoint is abandoned after timeoutMs with a SendTimeoutError", async () => {
  const hangingFetch = ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof globalThis.fetch;
  await assert.rejects(
    sendReport("/x", buildReport({ type: "bug", message: "a" }), { fetch: hangingFetch, timeoutMs: 20 }),
    (err: unknown) => err instanceof SendTimeoutError && /20 ms/.test(err.message),
  );
});

test("a beforeSend that never settles times out too", async () => {
  const neverFetch = (() => new Promise<Response>(() => {})) as typeof globalThis.fetch;
  await assert.rejects(
    sendReport("/x", buildReport({ type: "bug", message: "a" }), {
      fetch: neverFetch,
      timeoutMs: 20,
      beforeSend: () => new Promise(() => {}),
    }),
    (err: unknown) => err instanceof SendTimeoutError && /20 ms/.test(err.message),
  );
});

test("a caller-supplied signal aborts the request as itself, not as a timeout", async () => {
  const hangingFetch = ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof globalThis.fetch;
  const outer = new AbortController();
  const pending = sendReport("/x", buildReport({ type: "bug", message: "a" }), {
    fetch: hangingFetch,
    signal: outer.signal,
    timeoutMs: 5000,
  });
  outer.abort();
  await assert.rejects(pending, (err: unknown) => !(err instanceof SendTimeoutError));
});

test("beforeSend returning null drops the report without a request", async () => {
  const { fetch, calls } = fakeFetch(201, { id: "r_1" });
  const seen: string[] = [];
  const result = await sendReport("/x", buildReport({ type: "bug", message: "drop me" }), {
    fetch,
    beforeSend: (report) => {
      seen.push(report.message);
      return null;
    },
  });
  assert.equal(calls.length, 0, "no fetch call was made");
  assert.equal(result.dropped, true);
  assert.equal(result.body, null);
  assert.equal(result.response, null);
  assert.equal(result.id, undefined);
  assert.deepEqual(seen, ["drop me"], "the hook saw the assembled report");
});

test("beforeSend can change the report, and what it returns is what is posted", async () => {
  const { fetch, calls } = fakeFetch(200, { id: "r_2" });
  const result = await sendReport("/x", buildReport({ type: "bug", message: "call me on 12345" }), {
    fetch,
    beforeSend: async (report) => ({ ...report, message: report.message.replace(/\d+/g, "n") }),
  });
  assert.equal(result.dropped, undefined);
  assert.equal(result.id, "r_2");
  const posted = JSON.parse(String(calls[0]?.init.body)) as { message: string };
  assert.equal(posted.message, "call me on n");
});

test("a scrub function passed to buildReport is the last thing to touch the body", () => {
  const report = buildReport({
    type: "bug",
    message: "x",
    includeConsole: false,
    extra: { appVersion: "1.2.3" },
    scrub: (r) => ({ ...r, message: "scrubbed" }),
  });
  assert.equal(report.message, "scrubbed");
  assert.equal(report.appVersion, "1.2.3", "extras survive the scrub");
});
