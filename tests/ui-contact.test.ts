import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { da, en } from "../src/locales.ts";

/**
 * The optional contact field in the ready-made panel: rendered only when it is
 * asked for, refusing to send when it is required and empty, and travelling as
 * `contact` on the body when it is filled in.
 *
 * As in the other panel tests, happy-dom is installed on `globalThis` before
 * the module under test is imported, and only in this file.
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

/** A fetch stand-in that records the JSON body of every report it is sent. */
function recordingFetch() {
  const bodies: Record<string, unknown>[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: "rep_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { bodies, fetch: fetch as typeof globalThis.fetch };
}

function parts(host: HTMLElement) {
  const root = host.shadowRoot!;
  return {
    root,
    textarea: root.querySelector("textarea")!,
    input: root.querySelector<HTMLInputElement>("#bb-contact")!,
    label: root.querySelector<HTMLElement>('label[for="bb-contact"]')!,
    note: root.querySelector<HTMLElement>("#bb-contact-note")!,
    send: root.querySelector<HTMLButtonElement>(".send")!,
    status: root.querySelector<HTMLElement>(".status")!,
  };
}

/** One turn of the microtask queue, which is all a stubbed fetch needs. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("no contact field is rendered unless it is asked for", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT });
  const { input, label, note } = parts(widget.host);

  assert.equal(input.hidden, true, "the input is there but never reachable");
  assert.equal(label.hidden, true);
  assert.equal(note.hidden, true);
  widget.destroy();
});

test("the field carries a label, a hint and the right input type when asked for", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, contact: true });
  const { input, label, note } = parts(widget.host);

  assert.equal(input.hidden, false);
  // `text` rather than `email`, on purpose: `required` plus `type="email"`
  // makes a phone number `:invalid`, and a screen reader announces that as an
  // error although "call me on 12345678" is an answer the panel accepts.
  assert.equal(input.getAttribute("type"), "text");
  assert.equal(input.getAttribute("inputmode"), "email");
  assert.equal(input.getAttribute("autocomplete"), "email");
  assert.equal(label.textContent, en.ui.contactLabel);
  assert.equal(label.getAttribute("for"), input.id, "the label names the input");
  assert.equal(input.getAttribute("aria-describedby"), note.id);
  assert.equal(note.textContent, en.ui.contactHint);
  assert.equal(input.required, false, "optional unless the application says otherwise");
  widget.destroy();
});

test("the locale supplies the label and the hint", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, contact: true, locale: da });
  const { label, note } = parts(widget.host);

  assert.equal(label.textContent, da.ui.contactLabel);
  assert.equal(note.textContent, da.ui.contactHint);
  widget.destroy();
});

test("what the reporter types reaches the posted body, trimmed", async () => {
  const { bodies, fetch } = recordingFetch();
  const widget = mountBugbottle({ endpoint: ENDPOINT, contact: true, fetch });
  widget.open();
  const { textarea, input, send } = parts(widget.host);

  textarea.value = "The save button does nothing";
  input.value = "  anna@example.com  ";
  send.click();
  await flush();

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.contact, "anna@example.com");
  assert.equal(input.value, "", "the field is cleared with the rest of the form");
  widget.destroy();
});

test("a panel without the field never sends a contact key", async () => {
  const { bodies, fetch } = recordingFetch();
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch });
  widget.open();
  const { textarea, input, send } = parts(widget.host);

  // Even if something reached in and filled the hidden input.
  input.value = "anna@example.com";
  textarea.value = "The save button does nothing";
  send.click();
  await flush();

  assert.equal("contact" in (bodies[0] ?? {}), false);
  widget.destroy();
});

test("a required field refuses the submit through the ordinary inline error", async () => {
  const { bodies, fetch } = recordingFetch();
  const widget = mountBugbottle({ endpoint: ENDPOINT, contact: "required", fetch });
  widget.open();
  const { textarea, input, send, status } = parts(widget.host);

  assert.equal(input.required, true);
  assert.equal(input.getAttribute("aria-required"), "true");

  textarea.value = "The save button does nothing";
  input.value = "   ";
  send.click();
  await flush();

  assert.equal(bodies.length, 0, "nothing was sent");
  assert.equal(status.textContent, en.ui.contactRequired);
  assert.equal(status.dataset.kind, "error");

  input.value = "anna@example.com";
  send.click();
  await flush();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.contact, "anna@example.com");
  widget.destroy();
});

test("the empty message is still refused first, whatever the contact field says", async () => {
  const { bodies, fetch } = recordingFetch();
  const widget = mountBugbottle({ endpoint: ENDPOINT, contact: "required", fetch });
  widget.open();
  const { input, send, status } = parts(widget.host);

  input.value = "anna@example.com";
  send.click();
  await flush();

  assert.equal(bodies.length, 0);
  assert.equal(status.textContent, en.messages.empty);
  widget.destroy();
});

test("a phone number is sent exactly as it was typed", async () => {
  const { bodies, fetch } = recordingFetch();
  const widget = mountBugbottle({ endpoint: ENDPOINT, contact: true, fetch });
  widget.open();
  const { textarea, input, send } = parts(widget.host);

  textarea.value = "The save button does nothing";
  input.value = "call me on 12345678";
  send.click();
  await flush();

  assert.equal(bodies[0]?.contact, "call me on 12345678", "the input type validates nothing");
  widget.destroy();
});
