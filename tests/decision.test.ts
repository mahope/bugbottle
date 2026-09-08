/**
 * What `onDecision` says, once per request.
 *
 * One test per answer the handler can give, because the point of the hook is
 * that a status cannot skip it: a new branch in `handleReport` that forgot to
 * go through `decide` would leave one of these without a decision.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleReport,
  resetDedupe,
  resetRateLimits,
  type HandleReportOptions,
  type ReportDecision,
} from "../src/server/handle.ts";
import { computeSignature } from "../src/sign.ts";
import { reportBody as body } from "./report-fixtures.ts";

/** A POST the way a browser sends one. */
function post(payload: unknown, init: RequestInit = {}): Request {
  return new Request("https://app.example.com/api/bug-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    ...init,
  });
}

/** A request whose body arrives in pieces, for the two body limits. */
function streamed(stream: ReadableStream<Uint8Array>): Request {
  return new Request("https://app.example.com/api/bug-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  } as unknown as RequestInit);
}

/** Runs one request with the hook recording, and answers with both halves. */
async function decisions(
  request: Request,
  options: HandleReportOptions = {},
): Promise<{ response: Response; seen: ReportDecision[] }> {
  const seen: ReportDecision[] = [];
  const response = await handleReport(request, {
    ...options,
    onDecision: (decision) => void seen.push(decision),
  });
  return { response, seen };
}

test("a stored report decides stored, with the id and the fingerprint", async () => {
  const { response, seen } = await decisions(post(body), {
    store: () => ({ id: "rep_1" }),
  });

  assert.equal(response.status, 201);
  assert.equal(seen.length, 1);
  const decision = seen[0]!;
  assert.equal(decision.reason, "stored");
  assert.equal(decision.status, 201);
  assert.equal(decision.id, "rep_1");
  assert.ok(Math.abs(decision.at - Date.now()) < 5000, "at is a timestamp");
  // The identity of the report, and nothing that was written in it.
  assert.equal(typeof decision.fingerprint, "string");
  assert.equal(JSON.stringify(decision).includes("The save button"), false);
});

test("a report nothing named decides accepted", async () => {
  const { response, seen } = await decisions(post(body));

  assert.equal(response.status, 202);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.reason, "accepted");
  assert.equal(seen[0]?.status, 202);
  assert.equal(seen[0]?.id, undefined);
});

test("the second copy of a report decides duplicate, on the first one's id", async () => {
  resetDedupe();
  const options = { dedupe: { windowMs: 60_000 }, store: () => ({ id: "rep_2" }) };
  const first = await decisions(post(body), options);
  const second = await decisions(post(body), options);

  assert.equal(first.seen[0]?.reason, "stored");
  assert.equal(second.response.status, 200);
  assert.equal(second.seen[0]?.reason, "duplicate");
  assert.equal(second.seen[0]?.status, 200);
  assert.equal(second.seen[0]?.id, "rep_2");
  // The same report, so the same identity: two decisions an operator can tie
  // together without either of them carrying the report.
  assert.equal(second.seen[0]?.fingerprint, first.seen[0]?.fingerprint);
  resetDedupe();
});

test("anything but a POST decides not-post", async () => {
  const { response, seen } = await decisions(
    new Request("https://app.example.com/api/bug-report", { method: "GET" }),
  );

  assert.equal(response.status, 405);
  assert.equal(seen[0]?.reason, "not-post");
  assert.equal(seen[0]?.status, 405);
  // Nothing was parsed, so there is no report to be the identity of.
  assert.equal(seen[0]?.fingerprint, undefined);
});

test("a caller over its limit decides rate-limited", async () => {
  resetRateLimits();
  const options = { rateLimit: { limit: 1, windowMs: 60_000, key: () => "one-caller" } };
  const first = await decisions(post(body), options);
  const second = await decisions(post(body), options);

  assert.equal(first.seen[0]?.reason, "accepted");
  assert.equal(second.response.status, 429);
  assert.equal(second.seen[0]?.reason, "rate-limited");
  assert.equal(second.seen[0]?.status, 429);
  resetRateLimits();
});

test("an authorize that says no decides unauthorised", async () => {
  const { response, seen } = await decisions(post(body), { authorize: () => false });

  assert.equal(response.status, 401);
  assert.equal(seen[0]?.reason, "unauthorised");
  assert.equal(seen[0]?.status, 401);
});

test("a body over the ceiling decides too-large", async () => {
  const big = { message: "x".repeat(400) };
  const { response, seen } = await decisions(post(big), { maxBodyBytes: 100 });

  assert.equal(response.status, 413);
  assert.equal(seen[0]?.reason, "too-large");
  assert.equal(seen[0]?.status, 413);
});

test("a body that stops arriving decides timeout", async () => {
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

  const { response, seen } = await decisions(streamed(stream), { bodyTimeoutMs: 40 });

  assert.equal(response.status, 408);
  assert.equal(seen[0]?.reason, "timeout");
  assert.equal(seen[0]?.status, 408);
});

test("a signature that does not verify decides bad-signature", async () => {
  const text = JSON.stringify(body);
  const wrong = await computeSignature("some other key", text);
  const { response, seen } = await decisions(
    post(text, { headers: { "Content-Type": "application/json", "X-Bugbottle-Signature": wrong } }),
    { signature: { key: "the real key" } },
  );

  assert.equal(response.status, 401);
  assert.equal(seen[0]?.reason, "bad-signature");
  assert.equal(seen[0]?.status, 401);
});

test("malformed JSON and a report with no message both decide invalid", async () => {
  const malformed = await decisions(post("{not json"));
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.seen[0]?.reason, "invalid");
  assert.equal(malformed.seen[0]?.status, 400);

  const empty = await decisions(post({ message: "   " }));
  assert.equal(empty.response.status, 400);
  assert.equal(empty.seen[0]?.reason, "invalid");
  // A report that did not validate has no fingerprint to give.
  assert.equal(empty.seen[0]?.fingerprint, undefined);
});

test("a store that throws decides error, beside the 500", async () => {
  const { response, seen } = await decisions(post(body), {
    store: () => {
      throw new Error("the disk is full");
    },
    onError: () => {},
  });

  assert.equal(response.status, 500);
  assert.equal(seen[0]?.reason, "error");
  assert.equal(seen[0]?.status, 500);
  // The message of what broke is ours, and not in the audit line either.
  assert.equal(JSON.stringify(seen[0]).includes("disk"), false);
});

test("a hook that throws reaches onError and changes no answer", async () => {
  const errors: unknown[] = [];
  const response = await handleReport(post(body), {
    store: () => ({ id: "rep_3" }),
    onDecision: () => {
      throw new Error("the audit sink is down");
    },
    onError: (error) => void errors.push(error),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: "rep_3" });
  assert.equal(errors.length, 1);
  assert.match(String((errors[0] as Error).message), /audit sink/);
});

test("the address is the one trustProxy resolves, not the header on its own", async () => {
  const forwarded = { "X-Forwarded-For": "198.51.100.9, 203.0.113.7" };

  const untrusting = await decisions(post(body, { headers: forwarded }), {
    remoteAddress: "10.0.0.4",
  });
  assert.equal(untrusting.seen[0]?.address, "10.0.0.4", "the connection, by default");

  const trusting = await decisions(post(body, { headers: forwarded }), {
    remoteAddress: "10.0.0.4",
    trustProxy: true,
  });
  assert.equal(trusting.seen[0]?.address, "203.0.113.7", "the last hop, when it is trusted");

  const nothing = await decisions(post(body));
  assert.equal(nothing.seen[0]?.address, "unknown", "nothing to go on says so");
});

test("the address a decision names is the key the rate limit counted", async () => {
  resetRateLimits();
  const keys: string[] = [];
  const options = {
    remoteAddress: "10.0.0.5",
    trustProxy: true,
    rateLimit: {
      limit: 5,
      windowMs: 60_000,
      key: (_request: Request, address: string) => {
        keys.push(address);
        return address;
      },
    },
  };
  const { seen } = await decisions(
    post(body, { headers: { "X-Forwarded-For": "203.0.113.7" } }),
    options,
  );

  assert.deepEqual(keys, ["203.0.113.7"]);
  assert.equal(seen[0]?.address, "203.0.113.7");
  resetRateLimits();
});

test("a custom respond is decided on the status it chose", async () => {
  const { response, seen } = await decisions(post(body), {
    store: () => ({ id: "rep_4" }),
    respond: (result) => new Response(result.id, { status: 200 }),
  });

  assert.equal(response.status, 200);
  assert.equal(seen[0]?.status, 200, "the status that went back, not the 201 it replaced");
  assert.equal(seen[0]?.reason, "stored");
  assert.equal(seen[0]?.id, "rep_4");
});

test("the CORS preflight decides nothing: it is not a report", async () => {
  const { response, seen } = await decisions(
    new Request("https://app.example.com/api/bug-report", { method: "OPTIONS" }),
    { cors: true },
  );

  assert.equal(response.status, 204);
  assert.deepEqual(seen, []);
});
