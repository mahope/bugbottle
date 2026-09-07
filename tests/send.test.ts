import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildReport, sendReport, SendFailedError } from "../src/send.ts";
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
