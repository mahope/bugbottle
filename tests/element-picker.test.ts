import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelector } from "../src/element-picker.ts";
import { normaliseElements, MAX_ELEMENTS, MAX_ELEMENT_TEXT_LENGTH } from "../src/report-core.ts";

/** A tiny DOM stand-in: just enough tree for the selector builder. */
type Fake = {
  tagName: string;
  id: string;
  attrs: Record<string, string>;
  parentElement: Fake | null;
  previousElementSibling: Fake | null;
  getAttribute(name: string): string | null;
};
function el(tag: string, opts: { id?: string; attrs?: Record<string, string> } = {}): Fake {
  const node: Fake = {
    tagName: tag.toUpperCase(),
    id: opts.id ?? "",
    attrs: opts.attrs ?? {},
    parentElement: null,
    previousElementSibling: null,
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
  };
  return node;
}
function children(parent: Fake, ...kids: Fake[]) {
  kids.forEach((k, i) => {
    k.parentElement = parent;
    k.previousElementSibling = i > 0 ? (kids[i - 1] ?? null) : null;
  });
  return parent;
}

test("an id ends the selector, so it stays short", () => {
  const form = el("form", { id: "checkout" });
  const a = el("button");
  const b = el("button");
  children(form, a, b);
  assert.equal(buildSelector(b), "form#checkout > button:nth-of-type(2)");
  assert.equal(buildSelector(a), "form#checkout > button");
});

test("data-testid is preferred over positional steps", () => {
  const div = el("div", { attrs: { "data-testid": "order-row" } });
  const span = el("span");
  children(div, el("span"), span);
  assert.equal(buildSelector(span), 'div[data-testid="order-row"] > span:nth-of-type(2)');
});

test("without anchors the selector walks up at most five levels and stops at body", () => {
  const body = el("body");
  let parent = body;
  for (let i = 0; i < 8; i++) {
    const d = el("div");
    children(parent, d);
    parent = d;
  }
  const sel = buildSelector(parent);
  assert.equal(sel.split(" > ").length, 5);
  assert.ok(!sel.includes("body"));
});

test("a root that can answer uniqueness stops the walk early", () => {
  const section = el("section");
  const p = el("p");
  children(section, p);
  const root = { querySelectorAll: (s: string) => (s === "p" ? [1] : [1, 2]) };
  assert.equal(buildSelector(p, root), "p");
});

test("elements from the browser are validated, clipped and capped", () => {
  const good = {
    selector: "form#checkout > button",
    tag: "button",
    text: "Save",
    rect: { x: 10.4, y: 20, width: 100, height: 32 },
    attributes: { id: "save", "data-bugbottle": "x", "Bad Name": "y", "aria-label": 5 },
  };
  const out = normaliseElements([good, { tag: "div" }, { selector: "x" }, null, "str"]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    selector: "form#checkout > button",
    tag: "button",
    text: "Save",
    rect: { x: 10, y: 20, width: 100, height: 32 },
    attributes: { id: "save" },
  });

  const many = Array.from({ length: 30 }, () => ({ ...good }));
  assert.equal(normaliseElements(many).length, MAX_ELEMENTS);
  const long = normaliseElements([{ ...good, text: "t".repeat(1000), rect: { x: "no" } }]);
  assert.equal(long[0]?.text.length, MAX_ELEMENT_TEXT_LENGTH);
  assert.deepEqual(long[0]?.rect, { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(normaliseElements(undefined), []);
  assert.deepEqual(normaliseElements({}), []);
});

test("an aria-label names the step when there is no id or test id", () => {
  const nav = el("nav");
  const close = el("button", { attrs: { "aria-label": "Close menu" } });
  children(nav, el("button"), close);
  const root = { querySelectorAll: () => [1] };
  // The label is in the selector, escaped, and unique here, so the walk stops.
  assert.equal(buildSelector(close, root), String.raw`button[aria-label="Close\ menu"]`);
});

test("a shared aria-label does not end the walk the way an id does", () => {
  const row = el("li", { id: "row-7" });
  const del = el("button", { attrs: { "aria-label": "Delete" } });
  children(row, del);
  // Every row has a "Delete": without uniqueness the walk goes on to the row.
  assert.equal(buildSelector(del), 'li#row-7 > button[aria-label="Delete"]');
});

test("the id wins over a test id, and the test id over a label", () => {
  const both = el("input", { id: "email", attrs: { "data-testid": "x", "aria-label": "Email" } });
  assert.equal(buildSelector(both), "input#email");
  const testId = el("input", { attrs: { "data-testid": "email-field", "aria-label": "Email" } });
  assert.equal(buildSelector(testId), 'input[data-testid="email-field"]');
});

test("a generated-looking id that is too long falls back to position", () => {
  const form = el("form", { id: "checkout" });
  const input = el("input", { id: "f".repeat(65) });
  children(form, el("input"), input);
  assert.equal(buildSelector(input), "form#checkout > input:nth-of-type(2)");
});

test("the selector stops before it passes 200 characters, keeping the nearest steps", () => {
  const body = el("body");
  let parent = body;
  // Five levels of 60-character labels: the whole path would be over 300.
  for (let i = 0; i < 5; i++) {
    const d = el("div", { attrs: { "aria-label": String(i).repeat(60) } });
    children(parent, d);
    parent = d;
  }
  const sel = buildSelector(parent);
  assert.ok(sel.length <= 200, `${sel.length} characters`);
  assert.ok(sel.endsWith(`div[aria-label="${"4".repeat(60)}"]`), "the element itself is kept");
  assert.ok(sel.split(" > ").length >= 2, "and as much of the path as fits");
});
