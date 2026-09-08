import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleReport,
  resetDedupe,
  resetRateLimits,
  toGithub,
  toLinear,
  toResend,
  toWebhook,
  type SinkContext,
  type ValidatedReport,
} from "../src/server/handle.ts";
import { expressHandler } from "../src/server/express.ts";
import { MAX_CONTACT_LENGTH } from "../src/report-core.ts";
import {
  PNG_BYTES,
  PNG_DATA_URL,
  fullReportBody,
  reportBody as body,
} from "./report-fixtures.ts";

/** A POST the way a browser sends one. */
function post(payload: unknown, init: RequestInit = {}): Request {
  return new Request("https://app.example.com/api/bug-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    ...init,
  });
}

test("a valid report is stored and answered with 201 and the id", async () => {
  let stored: ValidatedReport | undefined;
  const response = await handleReport(post(body), {
    store: async (report) => {
      stored = report;
      return { id: "rep_1" };
    },
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: "rep_1" });
  assert.equal(stored?.message, "The save button does nothing");
  assert.equal(stored?.type, "bug");
  assert.equal(stored?.console.length, 1);
  assert.equal(stored?.context.url, "/orders/91");
  assert.ok(!Number.isNaN(Date.parse(stored?.receivedAt ?? "")));
});

test("without a store there is nothing to identify, so the answer is 202", async () => {
  const response = await handleReport(post(body), {});
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {});
});

test("an unknown type falls back to other and malformed sections are dropped", async () => {
  let stored: ValidatedReport | undefined;
  await handleReport(
    post({
      ...body,
      type: "catastrophe",
      console: "not an array",
      elements: [{ nothing: true }],
      breadcrumbs: [{ kind: "teleport" }],
      network: [{ status: 500 }],
    }),
    { store: async (report) => void (stored = report) },
  );

  assert.equal(stored?.type, "other");
  assert.deepEqual(stored?.console, []);
  assert.deepEqual(stored?.elements, []);
  assert.deepEqual(stored?.breadcrumbs, []);
  assert.deepEqual(stored?.network, []);
});

test("authorize returning false answers 401 and never reads the body", async () => {
  let stored = false;
  const response = await handleReport(post(body), {
    authorize: () => false,
    store: async () => void (stored = true),
  });

  assert.equal(response.status, 401);
  assert.equal(stored, false);
});

test("authorize may be asynchronous and sees the request headers", async () => {
  const request = post(body, { headers: { "Content-Type": "application/json", "X-Key": "s3cret" } });
  const response = await handleReport(request, {
    authorize: async (req) => req.headers.get("x-key") === "s3cret",
  });
  assert.equal(response.status, 202);
});

test("malformed JSON answers 400 rather than throwing", async () => {
  const response = await handleReport(post("{not json"), {});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Malformed JSON" });
});

test("an empty message answers 400 with the locale-neutral text", async () => {
  const response = await handleReport(post({ ...body, message: "   " }), {});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Write a message first" });
});

test("a body over the ceiling answers 413", async () => {
  const big = { ...body, message: "x".repeat(5000) };
  const response = await handleReport(post(big), { maxBodyBytes: 100 });
  assert.equal(response.status, 413);
});

test("a lying content-length is caught by counting the stream", async () => {
  const request = new Request("https://app.example.com/api/bug-report", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "10" },
    body: JSON.stringify({ ...body, message: "y".repeat(4000) }),
  });
  const response = await handleReport(request, { maxBodyBytes: 500 });
  assert.equal(response.status, 413);
});

test("a screenshot is kept by default and reaches store and the sink context", async () => {
  let storedBytes: Uint8Array | undefined;
  let ctx: SinkContext | undefined;
  await handleReport(post({ ...body, screenshotDataUrl: PNG_DATA_URL }), {
    store: async (_report, screenshot) => void (storedBytes = screenshot),
    sinks: [
      async (_report, c) => {
        ctx = c;
      },
    ],
  });

  assert.equal(storedBytes?.length, PNG_BYTES.length);
  assert.equal(ctx?.screenshot?.length, PNG_BYTES.length);
  assert.equal(ctx?.screenshotUrl, undefined);
});

test("screenshot: drop throws the picture away without decoding it", async () => {
  let storedBytes: Uint8Array | undefined = new Uint8Array(1);
  let ctx: SinkContext | undefined;
  const response = await handleReport(post({ ...body, screenshotDataUrl: PNG_DATA_URL }), {
    screenshot: "drop",
    store: async (_report, screenshot) => void (storedBytes = screenshot),
    sinks: [
      async (_report, c) => {
        ctx = c;
      },
    ],
  });

  assert.equal(response.status, 202);
  assert.equal(storedBytes, undefined);
  assert.equal(ctx?.screenshot, undefined);
});

test("a screenshot function stores the picture and its URL reaches markdown and the sink", async () => {
  let seenBytes: Uint8Array | undefined;
  let ctx: SinkContext | undefined;
  await handleReport(post({ ...body, screenshotDataUrl: PNG_DATA_URL }), {
    screenshot: async (bytes) => {
      seenBytes = bytes;
      return "https://private.example.com/shots/1.png";
    },
    sinks: [
      async (_report, c) => {
        ctx = c;
      },
    ],
  });

  assert.equal(seenBytes?.length, PNG_BYTES.length);
  assert.equal(ctx?.screenshotUrl, "https://private.example.com/shots/1.png");
  // The bytes are not handed on as well: the picture would then be attached
  // twice, once inline and once by link.
  assert.equal(ctx?.screenshot, undefined);
  assert.match(ctx?.markdown ?? "", /https:\/\/private\.example\.com\/shots\/1\.png/);
});

test("a rejected screenshot still stores the report", async () => {
  let stored: ValidatedReport | undefined;
  let storedBytes: Uint8Array | undefined = new Uint8Array(1);
  const response = await handleReport(
    post({ ...body, screenshotDataUrl: "data:image/png;base64,bm90IGEgcG5n" }),
    {
      store: async (report, screenshot) => {
        stored = report;
        storedBytes = screenshot;
        return { id: "rep_2" };
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(stored?.message, "The save button does nothing");
  assert.equal(storedBytes, undefined);
});

test("scrub: true redacts the report before it is stored", async () => {
  let stored: ValidatedReport | undefined;
  await handleReport(post({ ...body, message: "mail me at ada@example.com" }), {
    scrub: true,
    store: async (report) => void (stored = report),
  });

  assert.equal(stored?.message, "mail me at [redacted]");
});

test("scrub options are passed through to scrubReport", async () => {
  let stored: ValidatedReport | undefined;
  await handleReport(post({ ...body, message: "mail me at ada@example.com" }), {
    scrub: { replacement: "[gone]" },
    store: async (report) => void (stored = report),
  });

  assert.equal(stored?.message, "mail me at [gone]");
});

test("sinks run in order after store, and one failing does not fail the response", async () => {
  const order: string[] = [];
  const errors: { error: unknown; index: number }[] = [];
  const response = await handleReport(post(body), {
    store: async () => {
      order.push("store");
      return { id: "rep_3" };
    },
    sinks: [
      async () => void order.push("first"),
      async () => {
        order.push("second");
        throw new Error("webhook revoked");
      },
      async () => void order.push("third"),
    ],
    onSinkError: (error, index) => errors.push({ error, index }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(order, ["store", "first", "second", "third"]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.index, 1);
  assert.equal((errors[0]?.error as Error).message, "webhook revoked");
});

test("an unexpected error answers 500 without leaking the message, and calls onError", async () => {
  let seen: unknown;
  const response = await handleReport(post(body), {
    store: async () => {
      throw new Error("the database is on fire");
    },
    onError: (err) => void (seen = err),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Could not store the report" });
  assert.equal((seen as Error).message, "the database is on fire");
});

test("respond replaces the reply and still gets the CORS header", async () => {
  const response = await handleReport(post(body), {
    cors: "https://app.example.com",
    store: async () => ({ id: "rep_4" }),
    respond: (result) => new Response(result.report.message, { status: 200 }),
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "The save button does nothing");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
});

test("a CORS preflight is answered without touching the body", async () => {
  const request = new Request("https://app.example.com/api/bug-report", { method: "OPTIONS" });
  const response = await handleReport(request, { cors: true });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(response.headers.get("Access-Control-Allow-Methods") ?? "", /POST/);
});

test("cors adds the header to a normal answer too", async () => {
  const response = await handleReport(post(body), { cors: true });
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
});

test("every answer that allows an origin says it varies on one", async () => {
  // A shared cache in front of the endpoint must not hand one origin's answer
  // to another, so the allow header never travels alone.
  const preflight = await handleReport(
    new Request("https://app.example.com/api/bug-report", { method: "OPTIONS" }),
    { cors: "https://app.example.com" },
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Vary"), "Origin");

  const accepted = await handleReport(post(body), { cors: true });
  assert.equal(accepted.headers.get("Vary"), "Origin");

  const refused = await handleReport(post({ message: "   " }), { cors: true });
  assert.equal(refused.status, 400);
  assert.equal(refused.headers.get("Vary"), "Origin");
});

test("without cors nothing varies on the origin", async () => {
  const response = await handleReport(post(body), {});
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Vary"), null);
});

test("a respond of your own keeps whatever it already varied on", async () => {
  const response = await handleReport(post(body), {
    cors: true,
    respond: () =>
      new Response("ok", { status: 200, headers: { Vary: "Accept-Encoding" } }),
  });

  assert.equal(response.headers.get("Vary"), "Accept-Encoding, Origin");
});

test("the rate limit answers 429 once the window is full", async () => {
  resetRateLimits();
  const options = { rateLimit: { limit: 2, windowMs: 60_000, key: () => "one-caller" } };

  assert.equal((await handleReport(post(body), options)).status, 202);
  assert.equal((await handleReport(post(body), options)).status, 202);
  const third = await handleReport(post(body), options);

  assert.equal(third.status, 429);
  assert.deepEqual(await third.json(), { error: "Too many reports" });
  resetRateLimits();
});

test("the rate limit counts callers separately", async () => {
  resetRateLimits();
  let caller = "a";
  const options = { rateLimit: { limit: 1, windowMs: 60_000, key: () => caller } };

  assert.equal((await handleReport(post(body), options)).status, 202);
  assert.equal((await handleReport(post(body), options)).status, 429);
  caller = "b";
  assert.equal((await handleReport(post(body), options)).status, 202);
  resetRateLimits();
});

test("a duplicate is answered 200 without storing or delivering it again", async () => {
  resetDedupe();
  const stored: string[] = [];
  const delivered: string[] = [];
  const options = {
    dedupe: { windowMs: 60_000 },
    store: async () => {
      stored.push("row");
      return { id: "rep_7" };
    },
    sinks: [
      async () => {
        delivered.push("sink");
      },
    ],
  };

  const first = await handleReport(post(body), options);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { id: "rep_7" });

  const second = await handleReport(post(body), options);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { id: "rep_7", duplicate: true });
  assert.deepEqual(stored, ["row"], "the second copy is not written");
  assert.deepEqual(delivered, ["sink"], "and nobody is emailed about it twice");
  resetDedupe();
});

test("a different report is not a duplicate, and a short window lets one through", async () => {
  resetDedupe();
  const options = { dedupe: { windowMs: 20 } };

  assert.equal((await handleReport(post(body), options)).status, 202);
  assert.equal((await handleReport(post(body), options)).status, 200);

  const other = await handleReport(post({ ...body, message: "Something else entirely" }), options);
  assert.equal(other.status, 202, "a different message is a different report");

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await handleReport(post(body), options)).status, 202, "the window has passed");
  resetDedupe();
});

test("a duplicate without a stored id says so without inventing one", async () => {
  resetDedupe();
  const options = { dedupe: { windowMs: 60_000 } };
  assert.equal((await handleReport(post(body), options)).status, 202);
  const second = await handleReport(post(body), options);
  assert.deepEqual(await second.json(), { duplicate: true });
  resetDedupe();
});

test("a custom dedupe key decides what counts as the same report", async () => {
  resetDedupe();
  const options = {
    dedupe: { windowMs: 60_000, key: (report: ValidatedReport) => report.type },
    store: async () => ({ id: "rep_8" }),
  };
  assert.equal((await handleReport(post(body), options)).status, 201);
  // Same type, entirely different message: this key says they are one report.
  const second = await handleReport(post({ ...body, message: "Nothing alike" }), options);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { id: "rep_8", duplicate: true });
  resetDedupe();
});

test("a contact line is validated onto the report and never lands in extra", async () => {
  let stored: ValidatedReport | undefined;
  await handleReport(
    post({ ...body, contact: `  an${String.fromCharCode(0)}na@example.com  ` }),
    { store: async (report) => void (stored = report) },
  );
  assert.equal(stored?.contact, "anna@example.com");
  assert.equal("contact" in (stored?.extra ?? {}), false, "it is a known field, not an extra");
});

test("a contact line is clipped, and an empty one leaves no key behind", async () => {
  let stored: ValidatedReport | undefined;
  await handleReport(post({ ...body, contact: "x".repeat(MAX_CONTACT_LENGTH + 40) }), {
    store: async (report) => void (stored = report),
  });
  assert.equal(stored?.contact?.length, MAX_CONTACT_LENGTH);

  for (const contact of ["   ", 42, null]) {
    let empty: ValidatedReport | undefined;
    await handleReport(post({ ...body, contact }), {
      store: async (report) => void (empty = report),
    });
    assert.equal("contact" in (empty ?? {}), false, `${JSON.stringify(contact)} adds no key`);
  }
});

test("the contact line reaches the markdown a sink is handed", async () => {
  let markdown = "";
  await handleReport(post({ ...body, contact: "anna@example.com" }), {
    sinks: [
      async (_report, ctx) => {
        markdown = ctx.markdown;
      },
    ],
  });
  assert.match(markdown, /\| Contact \| anna@example\.com \|/);
});

test("extra keeps unknown scalars, clips strings and drops nested objects", async () => {
  let stored: ValidatedReport | undefined;
  await handleReport(
    post({
      ...body,
      tenant: "acme",
      build: 1421,
      beta: true,
      long: "z".repeat(900),
      nested: { user: "ada" },
      list: [1, 2, 3],
      "bad key": "dropped",
    }),
    { store: async (report) => void (stored = report) },
  );

  assert.equal(stored?.extra.tenant, "acme");
  assert.equal(stored?.extra.build, 1421);
  assert.equal(stored?.extra.beta, true);
  assert.equal((stored?.extra.long as string).length, 500);
  assert.equal("nested" in (stored?.extra ?? {}), false);
  assert.equal("list" in (stored?.extra ?? {}), false);
  assert.equal("bad key" in (stored?.extra ?? {}), false);
  // The known fields are not repeated in extra.
  assert.equal("message" in (stored?.extra ?? {}), false);
});

test("extra keeps at most twenty keys", async () => {
  let stored: ValidatedReport | undefined;
  const many: Record<string, unknown> = { ...body };
  for (let i = 0; i < 40; i += 1) many[`k${i}`] = i;
  await handleReport(post(many), { store: async (report) => void (stored = report) });

  assert.equal(Object.keys(stored?.extra ?? {}).length, 20);
});

test("a null byte in an extra value is stripped, as everywhere else", async () => {
  let stored: ValidatedReport | undefined;
  await handleReport(post({ ...body, tenant: `ac${String.fromCharCode(0)}me` }), {
    store: async (report) => void (stored = report),
  });

  assert.equal(stored?.extra.tenant, "acme");
});

test("toResend, toWebhook and toGithub hand the sink context to the sinks", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ id: "x", number: 7, html_url: "u" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  const response = await handleReport(post({ ...body, screenshotDataUrl: PNG_DATA_URL }), {
    screenshot: async () => "https://private.example.com/shots/2.png",
    sinks: [
      toResend({ apiKey: "re_key", from: "bugs@example.com", to: "team@example.com", fetch }),
      toWebhook({ endpoint: "https://hooks.example.com/x", format: "slack", fetch }),
      toGithub({ token: "gh_token", owner: "acme", repo: "app", fetch }),
    ],
  });

  assert.equal(response.status, 202);
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.url, "https://api.resend.com/emails");
  assert.match(String(calls[0]?.body.text), /shots\/2\.png/);
  assert.equal(calls[1]?.url, "https://hooks.example.com/x");
  assert.match(String(calls[1]?.body.text), /shots\/2\.png/);
  assert.equal(calls[2]?.url, "https://api.github.com/repos/acme/app/issues");
  assert.match(String(calls[2]?.body.body), /shots\/2\.png/);
});

test("toLinear files the report and links the stored screenshot", async () => {
  let sent: Record<string, unknown> = {};
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ data: { issueCreate: { success: true, issue: { id: "i1" } } } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof globalThis.fetch;

  const response = await handleReport(post({ ...body, screenshotDataUrl: PNG_DATA_URL }), {
    screenshot: async () => "https://private.example.com/shots/3.png",
    sinks: [toLinear({ apiKey: "lin_key", teamId: "team-uuid", fetch })],
  });

  assert.equal(response.status, 202);
  const input = (sent.variables as { input: Record<string, unknown> }).input;
  assert.equal(input.teamId, "team-uuid");
  assert.match(String(input.description), /shots\/3\.png/);
});

test("toResend attaches the kept screenshot bytes", async () => {
  let sent: Record<string, unknown> = {};
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "re_1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;

  await handleReport(post({ ...body, screenshotDataUrl: PNG_DATA_URL }), {
    sinks: [toResend({ apiKey: "re_key", from: "a@example.com", to: "b@example.com", fetch })],
  });

  const attachments = sent.attachments as { filename: string }[] | undefined;
  assert.equal(attachments?.length, 1);
  assert.equal(attachments?.[0]?.filename, "screenshot.png");
});

/**
 * The smallest Express response that records what the adapter wrote.
 *
 * `finished` resolves when the adapter sends, which is the only moment the
 * recorded status, headers and body are the ones it meant to write. The
 * handler returns before its work is done — Express is given a response to
 * write, not a promise to await — so a test that sleeps instead is betting
 * that the work fits in the nap, and a loaded machine wins that bet.
 */
function fakeRes() {
  const state: { status: number; headers: Record<string, string>; body: string } = {
    status: 0,
    headers: {},
    body: "",
  };
  let settle!: () => void;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    state,
    finished,
    res: {
      status(code: number) {
        state.status = code;
        return this;
      },
      setHeader(name: string, value: string) {
        state.headers[name.toLowerCase()] = value;
      },
      send(payload?: unknown) {
        state.body = String(payload ?? "");
        settle();
      },
    },
  };
}

test("the Express adapter round-trips a parsed body", async () => {
  const { state, res, finished } = fakeRes();
  let stored: ValidatedReport | undefined;
  const handler = expressHandler({
    cors: true,
    store: async (report) => {
      stored = report;
      return { id: "rep_5" };
    },
  });

  handler(
    {
      method: "POST",
      originalUrl: "/api/bug-report",
      headers: { host: "app.example.com", "content-type": "application/json" },
      body,
    },
    res,
  );
  // The handler is deliberately synchronous in the Express sense; wait for the
  // write it eventually makes rather than for a fixed stretch of time.
  await finished;

  assert.equal(state.status, 201);
  assert.deepEqual(JSON.parse(state.body), { id: "rep_5" });
  assert.equal(state.headers["access-control-allow-origin"], "*");
  assert.equal(stored?.message, "The save button does nothing");
});

test("the Express adapter reads a raw body when no parser ran", async () => {
  const { state, res, finished } = fakeRes();
  const text = JSON.stringify(body);
  const req = {
    method: "POST",
    url: "/api/bug-report",
    headers: { host: "app.example.com", "content-length": "999" },
    [Symbol.asyncIterator]: async function* () {
      yield new TextEncoder().encode(text);
    },
  };

  expressHandler({ store: async () => ({ id: "rep_6" }) })(req, res);
  await finished;

  assert.equal(state.status, 201);
  assert.deepEqual(JSON.parse(state.body), { id: "rep_6" });
});

test("the Express adapter answers 400 for an empty body", async () => {
  const { state, res, finished } = fakeRes();
  // What `express.json()` actually leaves behind: an empty object, and a
  // stream it has already drained, which iterates zero chunks and reads as "".
  expressHandler({})(
    {
      method: "POST",
      url: "/api/bug-report",
      headers: { host: "app.example.com" },
      body: {},
      [Symbol.asyncIterator]: async function* () {},
    },
    res,
  );
  await finished;

  assert.equal(state.status, 400);
  assert.deepEqual(JSON.parse(state.body), { error: "Write a message first" });
});

test("the Express adapter answers a CORS preflight", async () => {
  const { state, res, finished } = fakeRes();
  expressHandler({ cors: true })(
    { method: "OPTIONS", url: "/api/bug-report", headers: { host: "app.example.com" } },
    res,
  );
  await finished;

  assert.equal(state.status, 204);
  assert.equal(state.headers["access-control-allow-origin"], "*");
});

/** A `Request` whose body is a stream, the way a chunked upload arrives. */
function streamed(
  stream: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://app.example.com/api/bug-report", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: stream,
    duplex: "half",
  } as unknown as RequestInit);
}

test("anything that is not a POST is answered with 405", async () => {
  const request = new Request("https://app.example.com/api/bug-report", { method: "GET" });
  const response = await handleReport(request, { store: async () => ({ id: "never" }) });

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "Method not allowed" });
});

test("a preflight reflects the headers the client asked to send", async () => {
  const request = new Request("https://app.example.com/api/bug-report", {
    method: "OPTIONS",
    headers: { "Access-Control-Request-Headers": "content-type, x-csrf-token" },
  });
  const response = await handleReport(request, { cors: true });

  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get("Access-Control-Allow-Headers"),
    "content-type, x-csrf-token",
  );
});

test("a preflight that asks for nothing still lists the usual headers", async () => {
  const request = new Request("https://app.example.com/api/bug-report", { method: "OPTIONS" });
  const response = await handleReport(request, { cors: true });

  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type, Authorization");
});

test("an authorize that throws answers 500 rather than escaping the handler", async () => {
  let seen: unknown;
  let stored = false;
  const response = await handleReport(post(body), {
    authorize: () => {
      throw new Error("the session store is down");
    },
    store: async () => void (stored = true),
    onError: (err) => void (seen = err),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Could not store the report" });
  assert.equal((seen as Error).message, "the session store is down");
  assert.equal(stored, false);
});

test("__proto__ and constructor in extra are ignored rather than assigned", async () => {
  let stored: ValidatedReport | undefined;
  const payload =
    '{"message":"The save button does nothing","tenant":"acme",' +
    '"__proto__":"polluted","constructor":"replaced"}';
  await handleReport(post(payload), { store: async (report) => void (stored = report) });

  const extra = stored?.extra ?? {};
  assert.equal(extra.tenant, "acme");
  assert.equal(Object.hasOwn(extra, "__proto__"), false);
  assert.equal(Object.hasOwn(extra, "constructor"), false);
  // Nothing reached Object.prototype on the way past either.
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("a chunked body with no content-length is capped, and the stream is cancelled", async () => {
  let cancelled = false;
  const chunk = new TextEncoder().encode("x".repeat(100));
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });

  const response = await handleReport(streamed(stream), { maxBodyBytes: 500 });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Report is too large" });
  assert.equal(cancelled, true);
});

test("a body that dribbles in for ever is answered with 408", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (cancelled) return;
      try {
        controller.enqueue(new TextEncoder().encode(" "));
      } catch {
        // The reader gave up between the wait and the enqueue.
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  const response = await handleReport(streamed(stream), { bodyTimeoutMs: 40 });

  assert.equal(response.status, 408);
  assert.deepEqual(await response.json(), { error: "Report took too long to arrive" });
  assert.equal(cancelled, true);
});

test("a sink that never answers is abandoned and counted like one that threw", async () => {
  const order: string[] = [];
  const errors: { error: unknown; index: number }[] = [];
  const response = await handleReport(post(body), {
    sinkTimeoutMs: 20,
    store: async () => ({ id: "rep_8" }),
    sinks: [
      () => new Promise<void>(() => order.push("hung")),
      async () => void order.push("second"),
    ],
    onSinkError: (error, index) => errors.push({ error, index }),
  });

  assert.equal(response.status, 201);
  // The one that hung did not stop the one after it.
  assert.deepEqual(order, ["hung", "second"]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.index, 0);
  assert.equal((errors[0]?.error as Error).name, "SinkTimeoutError");
});

test("a sink is handed a signal it can pass to fetch", async () => {
  let signal: AbortSignal | undefined;
  await handleReport(post(body), {
    sinkTimeoutMs: 50,
    sinks: [
      async (_report, ctx) => {
        signal = ctx.signal;
      },
    ],
  });

  assert.ok(signal instanceof AbortSignal);
  assert.equal(signal?.aborted, false);
});

test("a screenshot store that throws still stores the report and runs the sinks", async () => {
  let stored: ValidatedReport | undefined;
  let ctx: SinkContext | undefined;
  let seen: unknown;
  const response = await handleReport(post({ ...body, screenshotDataUrl: PNG_DATA_URL }), {
    screenshot: async () => {
      throw new Error("the bucket is gone");
    },
    store: async (report) => {
      stored = report;
      return { id: "rep_9" };
    },
    sinks: [
      async (_report, c) => {
        ctx = c;
      },
    ],
    onError: (err) => void (seen = err),
  });

  assert.equal(response.status, 201);
  assert.equal(stored?.message, "The save button does nothing");
  assert.equal(ctx?.screenshotUrl, undefined);
  assert.equal((seen as Error).message, "the bucket is gone");
});

test("a screenshot function keeps the bytes: store is handed undefined", async () => {
  let storedBytes: Uint8Array | undefined = new Uint8Array(1);
  await handleReport(post({ ...body, screenshotDataUrl: PNG_DATA_URL }), {
    screenshot: async () => "https://private.example.com/shots/3.png",
    store: async (_report, screenshot) => void (storedBytes = screenshot),
  });

  assert.equal(storedBytes, undefined);
});

test("a rate-limit key longer than 64 characters is clipped", async () => {
  resetRateLimits();
  let caller = `${"a".repeat(64)}-one`;
  const options = { rateLimit: { limit: 1, windowMs: 60_000, key: () => caller } };

  assert.equal((await handleReport(post(body), options)).status, 202);
  // Two keys that differ only past the clip are one caller, so a long header
  // cannot be varied into an unbounded number of buckets.
  caller = `${"a".repeat(64)}-two`;
  assert.equal((await handleReport(post(body), options)).status, 429);
  resetRateLimits();
});

test("the bucket map is capped, and the oldest key is evicted to make room", async () => {
  resetRateLimits();
  let caller = "first";
  const options = { rateLimit: { limit: 1, windowMs: 60_000, key: () => caller } };

  assert.equal((await handleReport(post(body), options)).status, 202);
  assert.equal((await handleReport(post(body), options)).status, 429);

  // Ten thousand fresh, unexpired keys: nothing can be pruned by age, so the
  // ceiling has to evict the oldest entry, which is the caller above.
  for (let i = 0; i < 10_000; i += 1) {
    caller = `k${i}`;
    await handleReport(post("{}"), options);
  }

  caller = "first";
  assert.equal((await handleReport(post(body), options)).status, 202);
  resetRateLimits();
});

test("the Express adapter caps a raw stream, hangs up, and answers 413", async () => {
  const { state, res, finished } = fakeRes();
  let destroyed = false;
  let yielded = 0;
  const req = {
    method: "POST",
    url: "/api/bug-report",
    headers: { host: "app.example.com" },
    destroy() {
      destroyed = true;
    },
    [Symbol.asyncIterator]: async function* () {
      for (let i = 0; i < 1000; i += 1) {
        yielded += 1;
        yield new TextEncoder().encode("x".repeat(100));
      }
    },
  };

  expressHandler({ maxBodyBytes: 500 })(req, res);
  await finished;

  assert.equal(state.status, 413);
  assert.deepEqual(JSON.parse(state.body), { error: "Report is too large" });
  assert.equal(destroyed, true);
  // The rest of the body was never read, which is the point of the cap.
  assert.ok(yielded < 20, `read ${yielded} chunks`);
});

test("a multi-byte character split across two chunks survives the raw read", async () => {
  const { state, res, finished } = fakeRes();
  let stored: ValidatedReport | undefined;
  const message = "den grønne knap gør ingenting (æøå)";
  const bytes = new TextEncoder().encode(JSON.stringify({ ...body, message }));
  // Split immediately after the lead byte of the first two-byte character, so
  // the boundary falls inside it.
  const cut = bytes.indexOf(0xc3) + 1;
  assert.ok(cut > 0);

  const req = {
    method: "POST",
    url: "/api/bug-report",
    headers: { host: "app.example.com" },
    [Symbol.asyncIterator]: async function* () {
      yield bytes.slice(0, cut);
      yield bytes.slice(cut);
    },
  };

  expressHandler({ store: async (report) => void (stored = report) })(req, res);
  await finished;

  assert.equal(state.status, 202);
  assert.equal(stored?.message, message);
});

test("the perf and storage blocks are validated and reach the row", async () => {
  let stored: ValidatedReport | undefined;
  resetDedupe();
  const response = await handleReport(post({ ...fullReportBody, message: "Perf and storage" }), {
    store: async (report) => {
      stored = report;
      return { id: "r_perf" };
    },
    screenshot: "drop",
  });
  assert.equal(response.status, 201);
  assert.equal(stored?.perf?.lcp, 3412);
  assert.deepEqual(stored?.perf?.longTasks, { count: 3, totalMs: 480 });
  assert.deepEqual(stored?.storage?.cookies, ["session", "consent"]);
  assert.deepEqual(stored?.storage?.values, { tenant: "acme" });
  // Neither is `extra`: both are known top-level fields now.
  assert.equal("perf" in (stored?.extra ?? {}), false);
  assert.equal("storage" in (stored?.extra ?? {}), false);
});

test("a malformed perf or storage block is dropped, not a reason to refuse the report", async () => {
  let stored: ValidatedReport | undefined;
  const response = await handleReport(
    post({ ...body, message: "Nonsense blocks", perf: "very slow", storage: [1, 2, 3] }),
    {
      store: async (report) => {
        stored = report;
        return { id: "r_bad" };
      },
    },
  );
  assert.equal(response.status, 201);
  assert.equal(stored?.perf, null);
  assert.equal(stored?.storage, null);
});

test("the server scrubber redacts an allow-listed storage value", async () => {
  let stored: ValidatedReport | undefined;
  await handleReport(
    post({
      ...body,
      message: "Redacted storage",
      storage: { cookies: ["session"], values: { profile: "ada@example.com" } },
    }),
    {
      scrub: true,
      store: async (report) => {
        stored = report;
        return { id: "r_scrub" };
      },
    },
  );
  assert.equal(stored?.storage?.values?.profile, "[redacted]");
});

test("the markdown a sink is handed carries the performance figures", async () => {
  let markdown = "";
  await handleReport(post({ ...fullReportBody, message: "Markdown for a sink" }), {
    store: async () => ({ id: "r_md" }),
    screenshot: "drop",
    sinks: [
      async (_report, ctx) => {
        markdown = ctx.markdown;
      },
    ],
  });
  assert.match(markdown, /### Performance/);
  assert.match(markdown, /Largest contentful paint/);
  assert.match(markdown, /<details><summary>Storage<\/summary>/);
});

test("an injected rate-limit store is counted instead of the buckets", async () => {
  resetRateLimits();
  const asked: [string, number][] = [];
  const counts = new Map<string, number>();
  const options = {
    rateLimit: {
      limit: 2,
      windowMs: 60_000,
      key: () => "one-caller",
      store: {
        hit: async (key: string, windowMs: number) => {
          asked.push([key, windowMs]);
          const count = (counts.get(key) ?? 0) + 1;
          counts.set(key, count);
          return count;
        },
      },
    },
  };

  assert.equal((await handleReport(post(body), options)).status, 202);
  assert.equal((await handleReport(post(body), options)).status, 202);
  const third = await handleReport(post(body), options);
  assert.equal(third.status, 429);
  assert.deepEqual(await third.json(), { error: "Too many reports" });
  assert.deepEqual(asked, [
    ["one-caller", 60_000],
    ["one-caller", 60_000],
    ["one-caller", 60_000],
  ]);

  // Nothing was counted in the in-memory buckets while the store was in
  // charge: the same caller has its whole allowance at a handler without one.
  const local = { rateLimit: { limit: 1, windowMs: 60_000, key: () => "one-caller" } };
  assert.equal((await handleReport(post(body), local)).status, 202);
  resetRateLimits();
});

test("a rate-limit store that throws does not refuse an honest report", async () => {
  resetRateLimits();
  const errors: unknown[] = [];
  const options = {
    rateLimit: {
      limit: 1,
      windowMs: 60_000,
      key: () => "one-caller",
      store: {
        hit: async () => {
          throw new Error("redis is down");
        },
      },
    },
    onError: (err: unknown) => errors.push(err),
  };

  // Twice, so this is not the first request happening to be under the limit.
  assert.equal((await handleReport(post(body), options)).status, 202);
  assert.equal((await handleReport(post(body), options)).status, 202);
  assert.equal(errors.length, 2, "and the operator is told each time");
  resetRateLimits();
});

test("a rate-limit store that answers with a string is reported and fails open", async () => {
  // `"3" > 30` is false, and so is `NaN > 30`, so a store handing back
  // anything but a number would switch the limit off and never say a word.
  // Same shape as the dedupe store's answer being checked before it is
  // believed: fail open, but tell the operator every time.
  resetRateLimits();
  const errors: unknown[] = [];
  const options = {
    rateLimit: {
      limit: 1,
      windowMs: 60_000,
      key: () => "one-caller",
      store: { hit: async () => "3" as unknown as number },
    },
    onError: (err: unknown) => errors.push(err),
  };

  assert.equal((await handleReport(post(body), options)).status, 202);
  assert.equal((await handleReport(post(body), options)).status, 202);
  assert.equal(errors.length, 2);
  assert.ok(errors[0] instanceof TypeError);
  assert.match(String(errors[0]), /rateLimit\.store\.hit did not answer with a number/);
  resetRateLimits();
});

test("a rate-limit store answering with nothing is reported too, not read as zero", async () => {
  resetRateLimits();
  const errors: unknown[] = [];
  const options = {
    rateLimit: {
      limit: 1,
      windowMs: 60_000,
      key: () => "one-caller",
      store: { hit: () => undefined as unknown as number },
    },
    onError: (err: unknown) => errors.push(err),
  };

  assert.equal((await handleReport(post(body), options)).status, 202);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof TypeError);
  resetRateLimits();
});

test("an injected dedupe store is consulted and written with an expiry", async () => {
  resetDedupe();
  const asked: string[] = [];
  const written: [string, { id?: string }, number][] = [];
  const kept = new Map<string, { id?: string }>();
  const windowMs = 60_000;
  const stored: string[] = [];
  const options = {
    dedupe: {
      windowMs,
      store: {
        get: async (key: string) => {
          asked.push(key);
          return kept.get(key);
        },
        set: async (key: string, entry: { id?: string }, expiresAt: number) => {
          written.push([key, entry, expiresAt]);
          kept.set(key, entry);
        },
      },
    },
    store: async () => {
      stored.push("row");
      return { id: "rep_9" };
    },
  };

  const before = Date.now();
  const first = await handleReport(post(body), options);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { id: "rep_9" });
  assert.equal(asked.length, 1);
  assert.equal(written.length, 1);
  const [key, entry, expiresAt] = written[0]!;
  assert.equal(key, asked[0]);
  assert.deepEqual(entry, { id: "rep_9" });
  // The expiry is the end of the window, which is exactly how long a shared
  // store has to keep the answer.
  assert.ok(expiresAt >= before + windowMs && expiresAt <= Date.now() + windowMs);

  const second = await handleReport(post(body), options);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { id: "rep_9", duplicate: true });
  assert.deepEqual(stored, ["row"], "the second copy is not written");
  assert.equal(written.length, 1, "and a duplicate is not remembered again");

  // Nothing reached the in-memory map while the store was in charge.
  const local = { dedupe: { windowMs } };
  assert.equal((await handleReport(post(body), local)).status, 202);
  resetDedupe();
});

test("a dedupe store that throws lets the report through", async () => {
  resetDedupe();
  const errors: unknown[] = [];
  const stored: string[] = [];
  const delivered: string[] = [];
  const options = {
    dedupe: {
      windowMs: 60_000,
      store: {
        get: async () => {
          throw new Error("redis is down");
        },
        set: async () => {
          throw new Error("redis is still down");
        },
      },
    },
    store: async () => {
      stored.push("row");
      return { id: "rep_10" };
    },
    sinks: [
      async () => {
        delivered.push("sink");
      },
    ],
    onError: (err: unknown) => errors.push(err),
  };

  // A duplicate costs a row; a refusal costs the report. Both throws are
  // survived, and the second copy is answered as new rather than lost.
  const first = await handleReport(post(body), options);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { id: "rep_10" });
  const second = await handleReport(post(body), options);
  assert.equal(second.status, 201);
  assert.deepEqual(stored, ["row", "row"]);
  assert.deepEqual(delivered, ["sink", "sink"]);
  assert.equal(errors.length, 4, "each failed get and set reaches onError");
  resetDedupe();
});

test("a dedupe store answering with something that is not an entry is not believed", async () => {
  resetDedupe();
  const errors: unknown[] = [];
  const stored: string[] = [];
  const options = {
    dedupe: {
      windowMs: 60_000,
      store: {
        // A raw Redis value that was never JSON-parsed, or a store that
        // answers `true` for "present". Believing it makes every report a
        // duplicate and nothing is ever stored again.
        get: async () => "yes" as unknown as { id?: string },
        set: async () => {},
      },
    },
    store: async () => {
      stored.push("row");
      return { id: "rep_11" };
    },
    onError: (err: unknown) => errors.push(err),
  };

  const first = await handleReport(post(body), options);
  assert.equal(first.status, 201);
  const second = await handleReport(post(body), options);
  assert.equal(second.status, 201, "still a new report, not a duplicate");
  assert.deepEqual(stored, ["row", "row"]);
  assert.equal(errors.length, 2, "and the operator hears about it, once per report");
  resetDedupe();
});

test("the deprecated store names still work, and `store` wins over them", async () => {
  resetRateLimits();
  const asked: string[] = [];
  const deprecated = {
    rateLimit: {
      limit: 10,
      windowMs: 60_000,
      key: () => "one-caller",
      rateLimitStore: {
        hit: () => {
          asked.push("rateLimitStore");
          return 1;
        },
      },
    },
  };
  assert.equal((await handleReport(post(body), deprecated)).status, 202);
  assert.deepEqual(asked, ["rateLimitStore"], "the old name is still asked");

  const both = {
    rateLimit: {
      limit: 10,
      windowMs: 60_000,
      key: () => "one-caller",
      store: {
        hit: () => {
          asked.push("store");
          return 1;
        },
      },
      rateLimitStore: {
        hit: () => {
          asked.push("rateLimitStore again");
          return 1;
        },
      },
    },
  };
  assert.equal((await handleReport(post(body), both)).status, 202);
  assert.deepEqual(asked, ["rateLimitStore", "store"], "one store is asked, never both");
  resetRateLimits();
});

test("the deprecated dedupeStore is still asked and still answers", async () => {
  resetDedupe();
  const seen = new Map<string, { id?: string }>();
  const options = {
    dedupe: {
      windowMs: 60_000,
      dedupeStore: {
        get: (key: string) => seen.get(key),
        set: (key: string, entry: { id?: string }) => void seen.set(key, entry),
      },
    },
    store: () => ({ id: "stored-once" }),
  };
  assert.equal((await handleReport(post(body), options)).status, 201);
  const second = await handleReport(post(body), options);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { id: "stored-once", duplicate: true });
  resetDedupe();
});
