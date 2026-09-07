import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { computeSignature, createSigner, hmacHex, DEFAULT_SIGNATURE_HEADER } from "../src/sign.ts";
import { sendReport } from "../src/send.ts";
import { handleReport, resetSignatures } from "../src/server/handle.ts";
import { expressHandler } from "../src/server/express.ts";
import { reportBody as body } from "./report-fixtures.ts";

const KEY = "shh-this-is-public-anyway";
const TEXT = JSON.stringify(body);

afterEach(() => resetSignatures());

/** A POST carrying the given text and, when there is one, a signature header. */
function post(text: string, signature?: string, header = DEFAULT_SIGNATURE_HEADER): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== undefined) headers[header] = signature;
  return new Request("https://app.example.com/api/bug-report", {
    method: "POST",
    headers,
    body: text,
  });
}

test("the digest is a plain HMAC-SHA-256, so any language can verify it", async () => {
  const ours = await hmacHex(KEY, "1700000000000.{}");
  const theirs = createHmac("sha256", KEY).update("1700000000000.{}").digest("hex");
  assert.equal(ours, theirs, "the same bytes Node, PHP and Python compute");
});

test("the header value carries the timestamp it signed", async () => {
  const value = await computeSignature(KEY, TEXT, 1_700_000_000_000);
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(value);
  assert.ok(match, `unexpected header value: ${value}`);
  assert.equal(match[1], "1700000000000");
  assert.equal(match[2], await hmacHex(KEY, `1700000000000.${TEXT}`));
});

test("the signer names the default header, or the one it was given", async () => {
  const headers = await createSigner({ key: KEY })(TEXT);
  assert.deepEqual(Object.keys(headers), [DEFAULT_SIGNATURE_HEADER]);
  const custom = await createSigner({ key: KEY, header: "X-Sig" })(TEXT);
  assert.deepEqual(Object.keys(custom), ["X-Sig"]);
});

test("without crypto.subtle the report is sent unsigned rather than not at all", async () => {
  const real = globalThis.crypto;
  // What an insecure origin looks like: `crypto` exists, `subtle` does not.
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
  try {
    assert.deepEqual(await createSigner({ key: KEY })(TEXT), {});
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
  }
});

test("sendReport signs the exact bytes it posts", async () => {
  let seen: { body: string; signature: string } | undefined;
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen = {
      body: String(init?.body),
      signature: headers.get(DEFAULT_SIGNATURE_HEADER) ?? "",
    };
    return new Response("{}", { status: 202, headers: { "Content-Type": "application/json" } });
  }) as typeof globalThis.fetch;

  const report = {
    type: "bug" as const,
    message: "hi",
    context: { url: "/", viewport: "800x600", userAgent: "test" },
  };
  await sendReport("/api/bug-report", report, { fetch, sign: createSigner({ key: KEY }) });

  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(seen?.signature ?? "");
  assert.ok(match, `no signature header: ${seen?.signature}`);
  assert.equal(match[2], await hmacHex(KEY, `${match[1]}.${seen?.body}`));
});

test("a valid signature is accepted", async () => {
  const response = await handleReport(post(TEXT, await computeSignature(KEY, TEXT)), {
    signature: { key: KEY },
    store: async () => ({ id: "rep_1" }),
  });
  assert.equal(response.status, 201);
});

test("a tampered body is rejected", async () => {
  const signature = await computeSignature(KEY, TEXT);
  const tampered = JSON.stringify({ ...body, message: "a different sentence entirely" });
  const response = await handleReport(post(tampered, signature), { signature: { key: KEY } });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Bad signature" });
});

test("a signature from another key is rejected", async () => {
  const signature = await computeSignature("some other key", TEXT);
  const response = await handleReport(post(TEXT, signature), { signature: { key: KEY } });
  assert.equal(response.status, 401);
});

test("a signature older than the skew window is rejected", async () => {
  const stale = await computeSignature(KEY, TEXT, Date.now() - 6 * 60_000);
  const response = await handleReport(post(TEXT, stale), { signature: { key: KEY } });
  assert.equal(response.status, 401);
  // A clock ahead of ours opens the same window and is refused the same way.
  const ahead = await computeSignature(KEY, TEXT, Date.now() + 6 * 60_000);
  assert.equal(
    (await handleReport(post(TEXT, ahead), { signature: { key: KEY } })).status,
    401,
  );
});

test("the same signature is only accepted once", async () => {
  const signature = await computeSignature(KEY, TEXT);
  const options = { signature: { key: KEY } };
  assert.equal((await handleReport(post(TEXT, signature), options)).status, 202);
  const replay = await handleReport(post(TEXT, signature), options);
  assert.equal(replay.status, 401);
  assert.deepEqual(await replay.json(), { error: "Bad signature" });
});

test("a rejected signature is not remembered, so the honest retry still works", async () => {
  const signature = await computeSignature("some other key", TEXT);
  const options = { signature: { key: KEY } };
  assert.equal((await handleReport(post(TEXT, signature), options)).status, 401);
  // The digest above was refused, so it never entered the replay cache: an
  // attacker cannot fill it with digests of their own choosing.
  const honest = await computeSignature(KEY, TEXT);
  assert.equal((await handleReport(post(TEXT, honest), options)).status, 202);
});

test("any key in the list is accepted, which is what makes rotation possible", async () => {
  const options = { signature: { key: ["old-key", "new-key"] } };
  assert.equal(
    (await handleReport(post(TEXT, await computeSignature("old-key", TEXT)), options)).status,
    202,
  );
  assert.equal(
    (await handleReport(post(TEXT, await computeSignature("new-key", TEXT)), options)).status,
    202,
  );
});

test("a missing signature is refused by default, and let through when optional", async () => {
  assert.equal((await handleReport(post(TEXT), { signature: { key: KEY } })).status, 401);
  const optional = await handleReport(post(TEXT), { signature: { key: KEY, require: false } });
  assert.equal(optional.status, 202);
});

test("a wrong signature is refused even when signing is not required", async () => {
  const signature = await computeSignature("some other key", TEXT);
  const response = await handleReport(post(TEXT, signature), {
    signature: { key: KEY, require: false },
  });
  assert.equal(response.status, 401, "present but wrong is a claim, not an omission");
});

test("a header that is not a signature at all is refused", async () => {
  for (const value of ["", "nonsense", "t=abc,v1=" + "a".repeat(64), "t=1,v1=zz"]) {
    const response = await handleReport(post(TEXT, value), { signature: { key: KEY } });
    assert.equal(response.status, 401, `accepted ${JSON.stringify(value)}`);
  }
});

test("a custom header is where the signature is looked for", async () => {
  const signature = await computeSignature(KEY, TEXT);
  const options = { signature: { key: KEY, header: "X-Sig" } };
  assert.equal((await handleReport(post(TEXT, signature, "X-Sig"), options)).status, 202);
  resetSignatures();
  assert.equal((await handleReport(post(TEXT, signature), options)).status, 401);
});

/** The smallest Express response that records what the adapter wrote. */
function fakeRes() {
  const state = { status: 0, body: "" };
  return {
    state,
    res: {
      status(code: number) {
        state.status = code;
        return this;
      },
      setHeader() {},
      send(payload?: unknown) {
        state.body = String(payload ?? "");
      },
    },
  };
}

test("the Express adapter verifies over the raw body it read", async () => {
  const { state, res } = fakeRes();
  const signature = await computeSignature(KEY, TEXT);
  expressHandler({ signature: { key: KEY }, store: async () => ({ id: "rep_9" }) })(
    {
      method: "POST",
      url: "/api/bug-report",
      headers: { host: "app.example.com", [DEFAULT_SIGNATURE_HEADER.toLowerCase()]: signature },
      [Symbol.asyncIterator]: async function* () {
        yield new TextEncoder().encode(TEXT);
      },
    },
    res,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(state.status, 201);
  assert.deepEqual(JSON.parse(state.body), { id: "rep_9" });
});

test("a body express.json() already parsed cannot be verified, so it is a 401", async () => {
  const { state, res } = fakeRes();
  // The caveat in the adapter, pinned: re-serialising a parsed object gives a
  // different string, so the signed route must be mounted without a parser.
  const signature = await computeSignature(KEY, JSON.stringify({ ...body, extraKey: "x" }));
  expressHandler({ signature: { key: KEY } })(
    {
      method: "POST",
      url: "/api/bug-report",
      headers: { host: "app.example.com", [DEFAULT_SIGNATURE_HEADER.toLowerCase()]: signature },
      body: { extraKey: "x", ...body },
    },
    res,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(state.status, 401);
  assert.deepEqual(JSON.parse(state.body), { error: "Bad signature" });
});
