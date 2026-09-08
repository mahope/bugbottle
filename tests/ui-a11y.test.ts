import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

/**
 * The keyboard and screen-reader half of the panel: the focus loop, the focus
 * return, Escape, the arrow keys on the report types, and the live region that
 * says what happened when the panel gets out of the way.
 *
 * axe-core covers the static markup from a real browser (see
 * `scripts/a11y-audit.mjs`); this file covers the behaviour axe cannot press
 * keys to find. As in the other widget tests, happy-dom goes on `globalThis`
 * before the module under test is imported.
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
const { en } = await import("../src/locales.ts");

const ENDPOINT = "https://example.test/api/bug-reports";

/** A fetch that never leaves the process. */
const fakeFetch = (async () =>
  new Response(JSON.stringify({ id: "rep_1" }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof globalThis.fetch;

function parts(host: HTMLElement) {
  const root = host.shadowRoot;
  assert.ok(root, "the widget mounts an open shadow root");
  return {
    root,
    panel: root.querySelector(".panel") as HTMLElement,
    trigger: root.querySelector(".trigger") as HTMLButtonElement,
    closeBtn: root.querySelector(".close") as HTMLButtonElement,
    typesRow: root.querySelector(".types") as HTMLElement,
    types: [...root.querySelectorAll(".type")] as HTMLElement[],
    textarea: root.querySelector("textarea") as HTMLTextAreaElement,
    shotBox: root.querySelector(".check input") as HTMLInputElement,
    // By id rather than by `.note`: the optional contact field has a note of
    // its own, and it comes first in the panel.
    shotNote: root.querySelector("#bb-shot-note") as HTMLElement,
    pickBtn: root.querySelector(".pick") as HTMLButtonElement,
    list: root.querySelector("ul") as HTMLElement,
    live: root.querySelector(".sr") as HTMLElement,
    sendBtn: root.querySelector(".send") as HTMLButtonElement,
  };
}

/** The focusable controls of the open panel, in the order Tab visits them. */
function tabbable(panel: HTMLElement): HTMLElement[] {
  const nodes = panel.querySelectorAll<HTMLElement>(
    'button:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]),input:not([disabled])',
  );
  return [...nodes].filter((n) => !n.hidden && !n.closest("[hidden]"));
}

/** A key, pressed where a reporter would press it: on the focused control. */
function press(target: HTMLElement, key: string, shiftKey = false): boolean {
  const event = new win.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  // happy-dom's event classes are structurally close to the DOM ones but not
  // identical; the widget only ever reads `key`, `shiftKey` and the target.
  target.dispatchEvent(event as unknown as Event);
  return event.defaultPrevented;
}

test("Tab wraps at both ends, so focus never leaves the open panel", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fakeFetch });
  const { panel, trigger, root } = parts(widget.host);
  trigger.click();

  const items = tabbable(panel);
  const first = items[0];
  const last = items[items.length - 1];
  const middle = items[1];
  assert.ok(first && last && middle && items.length > 2, "the panel has controls to cycle through");

  last.focus();
  assert.equal(press(last, "Tab"), true, "Tab past the last control is the panel's business");
  assert.equal(root.activeElement, first, "and it comes back to the first");

  first.focus();
  assert.equal(press(first, "Tab", true), true);
  assert.equal(root.activeElement, last, "Shift+Tab off the first control goes to the last");

  middle.focus();
  assert.equal(press(middle, "Tab"), false, "in the middle the browser is left to do its job");

  widget.destroy();
});

test("closing the panel gives focus back to the trigger", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fakeFetch });
  const { trigger, closeBtn, root } = parts(widget.host);

  trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  closeBtn.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(root.activeElement, trigger, "focus is back where the reporter left it");

  widget.destroy();
});

test("Escape closes the panel and returns focus", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fakeFetch });
  const { panel, trigger, textarea, root } = parts(widget.host);

  trigger.click();
  assert.equal(panel.hidden, false);
  press(textarea, "Escape");
  assert.equal(panel.hidden, true);
  assert.equal(root.activeElement, trigger);

  widget.destroy();
});

test("the report types are a radio group the arrow keys walk through", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fakeFetch });
  const { typesRow, types, trigger } = parts(widget.host);
  trigger.click();

  assert.equal(typesRow.getAttribute("role"), "radiogroup");
  assert.equal(typesRow.getAttribute("aria-label"), en.ui.typeLabel);
  const checked = () => types.findIndex((t) => t.getAttribute("aria-checked") === "true");
  const inTabOrder = () => types.filter((t) => t.getAttribute("tabindex") === "0").length;

  assert.equal(checked(), 0, "the first type is checked to begin with");
  assert.equal(inTabOrder(), 1, "a radio group is one stop in the tab order");

  assert.equal(press(types[0] as HTMLElement, "ArrowRight"), true);
  assert.equal(checked(), 1);
  assert.equal(inTabOrder(), 1);

  press(types[1] as HTMLElement, "ArrowDown");
  assert.equal(checked(), 2, "Down moves the same way as Right");
  press(types[2] as HTMLElement, "ArrowRight");
  assert.equal(checked(), 0, "the group wraps round");
  press(types[0] as HTMLElement, "ArrowLeft");
  assert.equal(checked(), types.length - 1, "and wraps backwards");

  assert.equal(press(types[0] as HTMLElement, "Home"), false, "other keys are left alone");

  widget.destroy();
});

test("entering and leaving pick mode is announced, with the way out", async () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fakeFetch });
  const { trigger, panel, pickBtn, live } = parts(widget.host);
  trigger.click();

  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.equal(live.textContent, "", "nothing is announced until something happens");

  pickBtn.click();
  assert.equal(panel.hidden, true, "the panel gets out of the way of the page");
  assert.equal(live.textContent, en.ui.pickingAnnounce);
  assert.match(live.textContent ?? "", /Escape/, "the announcement says how to stop");
  assert.equal(pickBtn.getAttribute("aria-pressed"), "true");

  pickBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(live.textContent, en.ui.pickingDone);
  assert.equal(panel.hidden, false, "the panel comes back");
  assert.equal(pickBtn.getAttribute("aria-pressed"), "false");

  widget.destroy();
});

test("a status message lands in a live region rather than only on screen", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fakeFetch });
  const { trigger, sendBtn, root } = parts(widget.host);
  trigger.click();

  const status = root.querySelector(".status") as HTMLElement;
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");

  sendBtn.click();
  assert.equal(status.textContent, en.messages.empty, "an empty message is said, not just shown");
  assert.equal(status.dataset.kind, "error");

  widget.destroy();
});

test("every control the reporter can reach carries a name", () => {
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    fetch: fakeFetch,
    screenshot: async () => "data:image/png;base64,AAAA",
  });
  const host = widget.host;
  const { root, trigger, closeBtn, shotBox, shotNote, panel } = parts(host);

  assert.equal(host.getAttribute("role"), "complementary");
  assert.equal(host.getAttribute("aria-label"), en.ui.title, "the landmark says what it is");
  assert.equal(trigger.getAttribute("aria-label"), en.ui.trigger);
  assert.equal(trigger.getAttribute("aria-haspopup"), "dialog");
  assert.equal(closeBtn.getAttribute("aria-label"), en.ui.closeDialog);
  assert.equal(panel.getAttribute("aria-modal"), "true", "focus really is trapped");
  assert.equal(panel.getAttribute("aria-labelledby"), "bb-title");
  assert.equal(root.querySelector("#bb-title")?.textContent, en.ui.title);
  assert.equal(shotBox.getAttribute("aria-describedby"), shotNote.id);
  assert.equal(shotNote.textContent, en.ui.screenshotNote);

  widget.destroy();
});

test("a remove button is named after the element it removes", async () => {
  const target = win.document.createElement("button");
  target.id = "save-order";
  target.textContent = "Save";
  win.document.body.appendChild(target);

  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fakeFetch });
  const { trigger, pickBtn, list } = parts(widget.host);
  trigger.click();

  pickBtn.click();
  target.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const rm = list.querySelector(".rm") as HTMLElement;
  assert.ok(rm, "the picked element is listed");
  assert.equal(list.getAttribute("aria-label"), en.ui.attached);
  assert.equal(rm.getAttribute("aria-label"), "Remove Save", "not just the word Remove");

  target.remove();
  widget.destroy();
});

test("the forced-colours block is last in the sheet and covers every state", async () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch: fakeFetch });
  const root = widget.host.shadowRoot;
  assert.ok(root);
  const sheet = root.querySelector("style")?.textContent ?? "";

  const at = sheet.indexOf("@media (forced-colors:active)");
  assert.ok(at !== -1, "the panel has a forced-colours block");
  const block = sheet.slice(at);
  for (const [what, rule] of [
    ["the trigger", ".trigger"],
    ["the send button", ".send"],
    ["the selected type", '.type[aria-checked="true"]'],
    ["the active tool", '.tool[aria-checked="true"]'],
    ["the armed picker", '.pick[aria-pressed="true"]'],
    ["the focus ring", ":focus-visible"],
    ["the canvas", "canvas"],
  ] as const) {
    assert.ok(block.includes(rule), `${what} is redrawn in forced colours`);
  }
  // Every rule in the block has the same weight as the one it replaces, so it
  // only wins by coming later. That is the failure this test exists for: with
  // the block near the top of the sheet the selected type kept its accent
  // colour, which axe then read against a Highlight background.
  for (const base of [
    ".trigger{",
    '.type[aria-checked="true"]{',
    '.tool[aria-checked="true"]{',
    '.pick[aria-pressed="true"]{',
  ]) {
    const first = sheet.indexOf(base);
    assert.ok(first !== -1 && first < at, `${base} is declared before the forced block`);
  }
  // Chrome paints a Canvas-coloured backplate behind text in forced colours,
  // so a HighlightText label on a Highlight fill is white on white unless the
  // adjustment is off for that one rule.
  assert.match(
    block,
    /\.type\[aria-checked="true"\][^}]*forced-color-adjust:none/,
    "the selected label suppresses the text backplate",
  );

  widget.destroy();
});
