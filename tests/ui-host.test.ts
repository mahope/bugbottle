import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

/**
 * The seams an application needs to put the panel inside its own layout: the
 * offsets as custom properties, the two `part`s, `extra` read at send time and
 * the report handed to `onSent`. The same happy-dom set-up as
 * `ui-reference.test.ts`, installed before the module under test is imported.
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

/** A fetch that answers 201 `{ id }` and keeps every body it was sent. */
function recording(id: string) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  return { bodies, fetch: fetch as typeof globalThis.fetch };
}

async function fileReport(widget: { open(): void; host: HTMLElement }, message: string) {
  widget.open();
  const root = widget.host.shadowRoot!;
  (root.querySelector("textarea") as HTMLTextAreaElement).value = message;
  (root.querySelector(".send") as HTMLButtonElement).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("the corner offsets are custom properties with the old 16px as fallback", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT });
  const style = widget.host.getAttribute("style") ?? "";
  assert.match(style, /right:\s*var\(--bb-offset-x,\s*16px\)/);
  assert.match(style, /bottom:\s*var\(--bb-offset-y,\s*16px\)/);
  widget.destroy();
});

test("theme.offsetX and offsetY set the two properties on the host", () => {
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    theme: { position: "top-left", offsetX: "28px", offsetY: "6rem" },
  });
  assert.equal(widget.host.style.getPropertyValue("--bb-offset-x"), "28px");
  assert.equal(widget.host.style.getPropertyValue("--bb-offset-y"), "6rem");
  assert.match(widget.host.getAttribute("style") ?? "", /top:\s*var\(--bb-offset-y/);
  widget.destroy();
});

test("the trigger and the panel are exposed as parts", () => {
  const widget = mountBugbottle({ endpoint: ENDPOINT });
  const root = widget.host.shadowRoot!;
  assert.equal(root.querySelector(".trigger")!.getAttribute("part"), "trigger");
  assert.equal(root.querySelector(".panel")!.getAttribute("part"), "panel");
  widget.destroy();
});

test("a function given as extra is read when Send is pressed, not at mount", async () => {
  const { bodies, fetch } = recording("B-1");
  let timer = "stopped";
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch, extra: () => ({ appVersion: "2.0", timer }) });
  timer = "running";
  await fileReport(widget, "The total is wrong");
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]!.timer, "running");
  assert.equal(bodies[0]!.appVersion, "2.0");
  widget.destroy();
});

test("an object given as extra is still merged as it was", async () => {
  const { bodies, fetch } = recording("B-2");
  const widget = mountBugbottle({ endpoint: ENDPOINT, fetch, extra: { appVersion: "1.0" } });
  await fileReport(widget, "The total is wrong");
  assert.equal(bodies[0]!.appVersion, "1.0");
  widget.destroy();
});

test("onSent receives the id and the report exactly as it was sent", async () => {
  const { bodies, fetch } = recording("B-3");
  const seen: [string | undefined, Record<string, unknown>][] = [];
  const widget = mountBugbottle({
    endpoint: ENDPOINT,
    fetch,
    initialType: "bug",
    onSent: (id, report) => seen.push([id, report]),
  });
  await fileReport(widget, "Save does nothing");
  assert.equal(seen.length, 1);
  const [id, report] = seen[0]!;
  assert.equal(id, "B-3");
  assert.equal(report.type, "bug");
  assert.equal(report.message, "Save does nothing");
  assert.deepEqual(report, bodies[0]);
  widget.destroy();
});

test("the panel never grows past the viewport: it scrolls inside itself", () => {
  // On a phone the picture editor makes the panel taller than the screen; a
  // fixed box overflowing upwards hid its own title and close button.
  const widget = mountBugbottle({ endpoint: ENDPOINT });
  const css = widget.host.shadowRoot!.querySelector("style")!.textContent!;
  const panelRule = /\.panel\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(panelRule, /max-height:calc\(100dvh - 2 \* var\(--bb-offset-y,16px\) - 64px\)/);
  assert.match(panelRule, /overflow-y:auto/);
  widget.destroy();
});
