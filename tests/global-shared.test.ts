import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { DEFAULT_SIGNATURE_HEADER, hmacHex } from "../src/sign.ts";

/**
 * The `data-*` reading both script-tag builds share. It mounts a panel and
 * starts the recorders, so it needs a DOM: happy-dom is installed on
 * `globalThis` before the module is imported, as in `ui-queue.test.ts`, and
 * only in this file.
 */
const win = new Window({ url: "https://example.test/orders" });
const globals = globalThis as unknown as Record<string, unknown>;
const forced = new Set([
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "Element",
  "HTMLElement",
  "Node",
  "Event",
  "CustomEvent",
]);
for (const key of Object.getOwnPropertyNames(win)) {
  if (key.startsWith("_")) continue;
  if (!forced.has(key) && key in globals) continue;
  try {
    globals[key] = (win as unknown as Record<string, unknown>)[key];
  } catch {
    // A few window properties are getter-only; none of them matter here.
  }
}

const { readOptions } = await import("../src/global-shared.ts");

const SIGN_KEY = "the-key-your-server-knows";
const ENDPOINT = "https://example.test/api/bug-reports";

/** A `fetch` that answers 200 and keeps what it was handed. */
function recordingFetch() {
  const calls: { headers: Record<string, string>; body: string }[] = [];
  globals["fetch"] = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      headers: { ...(init?.headers as Record<string, string>) },
      body: String(init?.body),
    });
    return new Response("{}", { status: 200 });
  }) as typeof globalThis.fetch;
  return calls;
}

/** The dataset of a script tag, as `readOptions` reads it. */
function dataset(attributes: Record<string, string>): DOMStringMap {
  return attributes as DOMStringMap;
}

test("the script tag hands its signer to the queue it turns on", async () => {
  win.localStorage.clear();
  const calls = recordingFetch();
  const options = readOptions(
    dataset({ endpoint: ENDPOINT, signKey: SIGN_KEY, queue: "" }),
    ENDPOINT,
  );
  assert.ok(options.queue, "data-queue did not build a queue");
  assert.equal(typeof options.sign, "function");

  options.queue.enqueue({
    type: "bug",
    message: "filed during the outage",
    context: { url: "/orders", viewport: "800x600", userAgent: "test" },
  });
  await options.queue.flush();

  assert.equal(calls.length, 1, "the queued report was not delivered");
  const header = calls[0]?.headers[DEFAULT_SIGNATURE_HEADER];
  assert.ok(header, "data-sign-key was set and the queue still POSTed unsigned");
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  assert.ok(match, `the header is not in the t=…,v1=… shape: ${header}`);
  assert.equal(match[2], await hmacHex(SIGN_KEY, `${match[1]}.${calls[0]?.body}`));
  options.queue.destroy();
});

test("a queue without data-sign-key still POSTs unsigned", async () => {
  win.localStorage.clear();
  const calls = recordingFetch();
  const options = readOptions(dataset({ endpoint: ENDPOINT, queue: "" }), ENDPOINT);
  assert.ok(options.queue);
  assert.equal(options.sign, undefined);

  options.queue.enqueue({
    type: "bug",
    message: "no key on the tag",
    context: { url: "/orders", viewport: "800x600", userAgent: "test" },
  });
  await options.queue.flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.headers[DEFAULT_SIGNATURE_HEADER], undefined);
  options.queue.destroy();
});
