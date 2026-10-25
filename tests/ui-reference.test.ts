import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { en, da } from "../src/locales.ts";

/**
 * The panel needs a DOM with shadow roots, which `node:test` does not have. As
 * in `use-bug-report.test.ts`, happy-dom is installed on `globalThis` before
 * the module under test is imported — and only in this file, so every other
 * test keeps the bare Node globals it expects.
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

/** A fetch that answers 201 with an `id`, the way `handleReport` does. */
function accepts(id: unknown) {
  return async () =>
    new Response(JSON.stringify(id === undefined ? {} : { id }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
}

/** Opens the panel, types a message, presses Send, and returns the shadow root. */
async function fileReport(widget: { open(): void; host: HTMLElement }, message: string) {
  widget.open();
  const root = widget.host.shadowRoot!;
  (root.querySelector("textarea") as HTMLTextAreaElement).value = message;
  (root.querySelector(".send") as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return root;
}

test("the confirmation names the report the server stored", async () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: accepts("B-4711") });
  const root = await fileReport(widget, "The save button does nothing");
  const thanks = root.querySelector<HTMLElement>(".thanks")!;
  assert.equal(thanks.hidden, false, "the thank-you panel is shown");
  const said = thanks.querySelector("p")!.textContent!;
  assert.equal(said, en.messages.sentWithId!.replace("{id}", "B-4711"));
  widget.destroy();
});

test("formatReportId writes the reference shorter, and onSent keeps the whole id", async () => {
  const uuid = "731cf28b-5b0e-4c3a-9f1d-2a6b7c8d9e0f";
  const seen: (string | undefined)[] = [];
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    locale: da,
    fetch: accepts(uuid),
    formatReportId: (id) => id.slice(0, 8),
    onSent: (id) => seen.push(id),
  });
  const root = await fileReport(widget, "Gem-knappen gør ingenting");
  assert.equal(
    root.querySelector<HTMLElement>(".thanks p")!.textContent,
    "Tak. Rapporten er sendt. Dit nummer: 731cf28b",
  );
  assert.deepEqual(seen, [uuid]);
  widget.destroy();
});

test("a formatReportId that throws shows the whole id and still counts as sent", async () => {
  const errors: unknown[] = [];
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    fetch: accepts("B-4711"),
    formatReportId: () => {
      throw new Error("host bug");
    },
    onError: (e) => errors.push(e),
  });
  const root = await fileReport(widget, "The save button does nothing");
  assert.equal(
    root.querySelector<HTMLElement>(".thanks p")!.textContent,
    en.messages.sentWithId!.replace("{id}", "B-4711"),
  );
  assert.deepEqual(errors, []);
  widget.destroy();
});

test("an endpoint that names no report is thanked without a reference", async () => {
  // The honest default: the report arrived, and the server had nothing to
  // call it by. A confirmation that is otherwise the same sentence is the
  // point — no empty "Reference:" and no `undefined` in the text.
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: accepts(undefined) });
  const root = await fileReport(widget, "The save button does nothing");
  const said = root.querySelector<HTMLElement>(".thanks p")!.textContent!;
  assert.equal(said, en.ui.thanks);
  widget.destroy();
});

test("a reference the reporter can read is said in their own language", async () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: accepts("B-4711"), locale: da });
  const root = await fileReport(widget, "Gem-knappen gør intet");
  const said = root.querySelector<HTMLElement>(".thanks p")!.textContent!;
  assert.ok(said.includes("B-4711"), `the reference is in the sentence: ${said}`);
  assert.ok(!said.includes(en.messages.sentWithId!.split(".")[1]!.trim()), "not the English wording");
  assert.ok(said.startsWith(da.messages.sent.split("—")[0]!.trim()), "the Danish sentence, not the English one");
  widget.destroy();
});

test("the confirmation is announced, not only shown", async () => {
  // The status line lives inside the form, which is hidden the moment the
  // report is sent, so the thank-you sentence carries its own live region.
  // Without it the confirmation reached sighted reporters and no one else.
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: accepts("B-4711") });
  const root = await fileReport(widget, "The save button does nothing");
  const said = root.querySelector<HTMLElement>(".thanks p")!;
  assert.equal(said.getAttribute("role"), "status");
  assert.equal(said.getAttribute("aria-live"), "polite");
  widget.destroy();
});
