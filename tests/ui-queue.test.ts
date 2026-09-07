import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { en } from "../src/locales.ts";

/**
 * The widget needs a DOM with shadow roots, which `node:test` does not have.
 * As in `use-bug-report.test.ts`, happy-dom is installed on `globalThis`
 * before the module under test is imported — and only in this file, so every
 * other test keeps the bare Node globals it expects.
 */
const win = new Window({ url: "https://example.test/orders" });
const globals = globalThis as unknown as Record<string, unknown>;
const forced = new Set([
  "window",
  "document",
  "navigator",
  "location",
  "getComputedStyle",
  "Element",
  "HTMLElement",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
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

const { mountBugbottle } = await import("../src/ui/index.ts");

const ENDPOINT = "https://example.test/api/bug-reports";

/** A queue stand-in that only records what it was handed. */
function fakeQueue() {
  const queued: unknown[] = [];
  return {
    queued,
    queue: {
      enqueue: (report: unknown) => void queued.push(report),
      flush: async () => 0,
      size: () => queued.length,
      clear: () => void queued.splice(0),
      destroy: () => {},
    },
  };
}

/** Opens the panel, types a message and presses Send. */
async function fileReport(widget: { open(): void; host: HTMLElement }, message: string) {
  widget.open();
  const root = widget.host.shadowRoot!;
  const textarea = root.querySelector("textarea")!;
  textarea.value = message;
  const send = root.querySelector<HTMLButtonElement>(".send")!;
  send.click();
  // The submit is asynchronous; two turns of the microtask queue is enough for
  // a fetch that rejects immediately.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return root;
}

test("a failed send with a queue thanks the reporter with the queued message", async () => {
  const { queue, queued } = fakeQueue();
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    queue,
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  const root = await fileReport(widget, "The save button does nothing");

  assert.equal(queued.length, 1, "the report went to the queue");
  assert.equal((queued[0] as { message: string }).message, "The save button does nothing");
  const thanks = root.querySelector<HTMLElement>(".thanks")!;
  assert.equal(thanks.hidden, false, "the ordinary thank-you panel is shown");
  assert.equal(thanks.querySelector("p")?.textContent, en.messages.queued);
  widget.destroy();
});

test("a 4xx is shown as an error rather than queued", async () => {
  const { queue, queued } = fakeQueue();
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    queue,
    fetch: async () =>
      new Response(JSON.stringify({ error: "That project is closed" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  });

  const root = await fileReport(widget, "Something is wrong");

  assert.equal(queued.length, 0, "the server refused it, so retrying is pointless");
  assert.equal(root.querySelector<HTMLElement>(".thanks")!.hidden, true);
  assert.equal(root.querySelector(".status")?.textContent, "That project is closed");
  widget.destroy();
});

test("without a queue a failed send is still an error", async () => {
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  const root = await fileReport(widget, "No queue here");

  assert.equal(root.querySelector<HTMLElement>(".thanks")!.hidden, true);
  assert.equal(root.querySelector(".status")?.textContent, en.messages.sendFailed);
  widget.destroy();
});
