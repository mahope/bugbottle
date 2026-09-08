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

test("a signature is remembered for as long as it would still be accepted", async () => {
  // The skew window runs in both directions, so a signature dated ahead of our
  // clock stays valid for nearly twice the window after it first arrives.
  // Remembering it only from the moment it arrived lets it be replayed for the
  // remainder — the cache forgets it while the window is still open. Small
  // numbers here so the test is a third of a second rather than ten minutes.
  const maxSkewMs = 400;
  const signature = await computeSignature(KEY, TEXT, Date.now() + 300);
  const options = { signature: { key: KEY, maxSkewMs }, store: async () => ({ id: "rep_1" }) };
  assert.equal((await handleReport(post(TEXT, signature), options)).status, 201);

  await new Promise((resolve) => setTimeout(resolve, 500));
  // Any other honest report prunes the cache on its way through, which is what
  // drops the entry above while its signature is still inside the window.
  const other = JSON.stringify({ ...body, message: "an unrelated report" });
  assert.equal((await handleReport(post(other, await computeSignature(KEY, other)), options)).status, 201);

  // Still inside the window — 200 ms past a timestamp 400 ms wide either way —
  // so this is a replay of a captured body, not an expired signature.
  const replay = await handleReport(post(TEXT, signature), options);
  assert.equal(replay.status, 401, "the captured body was replayed after the cache forgot it");
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

/**
 * The smallest Express response that records what the adapter wrote.
 *
 * `finished` resolves when the adapter sends, which is the only moment the
 * recorded status and body are the ones it meant to write. The handler returns
 * before its work is done — Express is given a response to write, not a
 * promise to await — so a test that sleeps instead is betting that the work
 * fits in the nap, and a loaded machine wins that bet.
 */
function fakeRes() {
  const state = { status: 0, body: "" };
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
      setHeader() {},
      send(payload?: unknown) {
        state.body = String(payload ?? "");
        settle();
      },
    },
  };
}

test("the Express adapter verifies over the raw body it read", async () => {
  const { state, res, finished } = fakeRes();
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
  await finished;

  assert.equal(state.status, 201);
  assert.deepEqual(JSON.parse(state.body), { id: "rep_9" });
});

test("a body express.json() already parsed cannot be verified, so it is a 401", async () => {
  const { state, res, finished } = fakeRes();
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
  await finished;

  assert.equal(state.status, 401);
  assert.deepEqual(JSON.parse(state.body), { error: "Bad signature" });
});

test("a flood of valid signatures only evicts the second it floods", async () => {
  // The key ships to the browser, so anybody can mint valid signatures in
  // bulk. Against one global ceiling that was a way to push an honest digest
  // out of the cache and then replay the body it stood for. The flood is dated
  // one second away from the honest report, which is the whole defence.
  const honestAt = Date.now();
  const floodAt = honestAt + 1000;
  const options = { signature: { key: KEY }, store: () => ({ id: "rep_1" }) };

  const honest = await computeSignature(KEY, TEXT, honestAt);
  assert.equal((await handleReport(post(TEXT, honest), options)).status, 201);

  // Distinct bodies, because a distinct digest is what fills the cache; the
  // timestamp is fixed, so every one of them lands in the same bucket.
  for (let i = 0; i < 10_001; i += 1) {
    const text = JSON.stringify({ type: "bug", message: `flood ${i}` });
    const signature = await computeSignature(KEY, text, floodAt);
    assert.equal((await handleReport(post(text, signature), options)).status, 201);
  }

  const replay = await handleReport(post(TEXT, honest), options);
  assert.equal(replay.status, 401, "the honest digest was evicted by the flood");
  assert.deepEqual(await replay.json(), { error: "Bad signature" });
});

test("an injected replay store is consulted and written with an expiry", async () => {
  const asked: string[] = [];
  const written: [string, number][] = [];
  const kept = new Set<string>();
  const replayStore = {
    has: async (digest: string) => {
      asked.push(digest);
      return kept.has(digest);
    },
    add: async (digest: string, expiresAt: number) => {
      written.push([digest, expiresAt]);
      kept.add(digest);
    },
  };
  const maxSkewMs = 60_000;
  const timestamp = Date.now();
  const signature = await computeSignature(KEY, TEXT, timestamp);
  const digest = signature.slice(signature.indexOf("v1=") + 3);
  const options = {
    signature: { key: KEY, maxSkewMs, replayStore },
    store: () => ({ id: "rep_1" }),
  };

  assert.equal((await handleReport(post(TEXT, signature), options)).status, 201);
  assert.deepEqual(asked, [digest]);
  // The expiry is the moment the signature would be refused for its age
  // anyway, which is exactly how long a shared store needs to keep it.
  assert.deepEqual(written, [[digest, timestamp + maxSkewMs]]);

  const replay = await handleReport(post(TEXT, signature), options);
  assert.equal(replay.status, 401, "the store said it had seen this digest");
  assert.equal(written.length, 1, "a refused replay is not written again");

  // Nothing went into the in-memory cache while the store was in charge: the
  // same signature is new to a handler configured without one.
  const local = { signature: { key: KEY, maxSkewMs }, store: () => ({ id: "rep_2" }) };
  assert.equal((await handleReport(post(TEXT, signature), local)).status, 201);
});

test("t= is digits or it is a bad signature", async () => {
  const now = Date.now();
  // The window is opened wide so that nothing here can be rejected for its
  // age: every 401 below is the parser refusing a spelling, which is what this
  // is about. `Number()` took all four and canonicalised them into the message
  // we verified.
  const options = {
    signature: { key: KEY, maxSkewMs: Number.MAX_SAFE_INTEGER },
    store: () => ({ id: "rep_1" }),
  };
  const forms = [`0x${now.toString(16)}`, ` ${now}`, "1e12", `${now}0000`];

  for (const sent of forms) {
    // Signed the way the old parser would have read it, so the digest itself
    // is right and only the spelling of `t` is wrong.
    const digest = await hmacHex(KEY, `${Number(sent)}.${TEXT}`);
    const response = await handleReport(post(TEXT, `t=${sent},v1=${digest}`), options);
    assert.equal(response.status, 401, `t=${sent} was accepted`);
    assert.deepEqual(await response.json(), { error: "Bad signature" });
  }

  // The control: the same key and the same body, spelled as the format says.
  const canonical = await computeSignature(KEY, TEXT, now);
  assert.equal((await handleReport(post(TEXT, canonical), options)).status, 201);
});

test("express.json() in front of a signed route says so once, and still answers 401", async () => {
  const errors: unknown[] = [];
  const handler = expressHandler({ signature: { key: KEY }, onError: (err) => errors.push(err) });
  const signature = await computeSignature(KEY, TEXT);
  const request = () => ({
    method: "POST",
    url: "/api/bug-report",
    headers: { host: "app.example.com", [DEFAULT_SIGNATURE_HEADER.toLowerCase()]: signature },
    body: { ...body },
  });

  const first = fakeRes();
  handler(request(), first.res);
  await first.finished;
  assert.equal(first.state.status, 401);
  assert.deepEqual(JSON.parse(first.state.body), { error: "Bad signature" });
  assert.equal(errors.length, 1, "the mounting mistake was not reported");
  assert.match(String((errors[0] as Error).message), /express\.json\(\)/);

  // A mounting mistake is not an event: the second report is refused the same
  // way and the log is not told twice.
  const second = fakeRes();
  handler(request(), second.res);
  await second.finished;
  assert.equal(second.state.status, 401);
  assert.equal(errors.length, 1, "the diagnostic repeated itself");
});

test("an unsigned report during a rollout is not mistaken for the parser mistake", async () => {
  // `require: false` is the documented way to deploy the server before the
  // browsers have the key, and it accepts a report carrying no signature at
  // all — parsed body or not. Only a request that would have been verified is
  // refused for arriving as an object.
  const errors: unknown[] = [];
  const { state, res, finished } = fakeRes();
  expressHandler({
    signature: { key: KEY, require: false },
    onError: (err) => errors.push(err),
    store: () => ({ id: "rep_3" }),
  })(
    {
      method: "POST",
      url: "/api/bug-report",
      headers: { host: "app.example.com" },
      body: { ...body },
    },
    res,
  );
  await finished;

  assert.equal(state.status, 201);
  assert.deepEqual(errors, []);
});
