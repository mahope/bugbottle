import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// This component talks to a real `document` (event listeners, focus,
// querySelector), which react-test-renderer's fake tree can't stand in for
// — unlike tests/use-bug-report.test.ts, this one needs an actual DOM. jsdom
// implements enough of it (events, focus, the tree) even though it can't do
// layout or canvas; capture is disabled below so that gap never matters here.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
const globals: Record<string, unknown> = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  KeyboardEvent: dom.window.KeyboardEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
};
// Node has its own read-only `navigator` global; Object.assign can't
// overwrite it, so each property is defined explicitly instead.
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

const { act } = await import("react");
const { createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { BugBottleBubble } = await import("../src/react/bubble.ts");

function mount(props: { endpoint: string; screenshotFor?: () => boolean }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(BugBottleBubble, props));
  });
  return { container, unmount: () => act(() => root.unmount()) };
}

// No network in these tests — submit is never reached.
const props = { endpoint: "/api/reports", screenshotFor: () => false };

test("opening the panel moves focus into it, onto the checked type", () => {
  const { container, unmount } = mount(props);
  try {
    const trigger = container.querySelector("button") as HTMLButtonElement;
    act(() => trigger.click());

    const checked = container.querySelector('[role="radio"][aria-checked="true"]');
    assert.ok(checked, "a checked radio exists");
    assert.equal(document.activeElement, checked, "focus moved onto the checked type");
  } finally {
    unmount();
  }
});

test("Escape closes the panel and returns focus to the trigger", () => {
  const { container, unmount } = mount(props);
  try {
    const trigger = container.querySelector("button") as HTMLButtonElement;
    act(() => trigger.click());
    assert.ok(container.querySelector('[role="dialog"]'), "the panel is open");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    assert.equal(container.querySelector('[role="dialog"]'), null, "the panel closed");
    const reopenedTrigger = container.querySelector("button");
    assert.equal(document.activeElement, reopenedTrigger, "focus returned to the trigger");
  } finally {
    unmount();
  }
});

test("the type selector is a radiogroup navigable with arrow keys", () => {
  const { container, unmount } = mount(props);
  try {
    const trigger = container.querySelector("button") as HTMLButtonElement;
    act(() => trigger.click());

    const group = container.querySelector('[role="radiogroup"]');
    assert.ok(group, "a radiogroup exists");
    const options = [...container.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    assert.equal(options.length, 3, "one radio per report type");

    const first = options[0]!;
    assert.equal(first.getAttribute("aria-checked"), "true", "bug is selected by default");
    assert.equal(first.tabIndex, 0, "only the checked option is tabbable");
    assert.equal(options[1]!.tabIndex, -1);

    act(() => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    assert.equal(first.getAttribute("aria-checked"), "false");
    assert.equal(options[1]!.getAttribute("aria-checked"), "true", "arrow-right moved to the next type");
    assert.equal(document.activeElement, options[1], "focus followed the selection");
  } finally {
    unmount();
  }
});

test("carries data-bugbottle so it stays out of its own screenshots", () => {
  const { container, unmount } = mount(props);
  try {
    const root = container.firstElementChild;
    assert.ok(root?.hasAttribute("data-bugbottle"));
  } finally {
    unmount();
  }
});
