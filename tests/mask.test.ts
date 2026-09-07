import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { captureScreenshot } from "../src/capture.ts";
import type { CaptureOptions } from "../src/capture.ts";

/**
 * Masking is the one part of `captureScreenshot` that touches real elements,
 * so this file needs a real DOM — happy-dom, registered the same way
 * `use-bug-report.test.ts` registers it, and only for this file. Everything is
 * asserted from inside the renderer: the whole contract is that the page is
 * masked while the picture is being taken and untouched either side of it.
 */
const win = new Window({ url: "https://example.test/checkout" });
const globals = globalThis as unknown as Record<string, unknown>;
const forced = new Set(["window", "document", "navigator", "getComputedStyle", "Node", "Element"]);
for (const key of Object.getOwnPropertyNames(win)) {
  if (key.startsWith("_")) continue;
  if (!forced.has(key) && key in globals) continue;
  try {
    globals[key] = (win as unknown as Record<string, unknown>)[key];
  } catch {
    // Getter-only properties of the window; none of them matter here.
  }
}

const document = win.document as unknown as Document;

/** Replaces the page with `html` and returns the element to capture. */
function page(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

/**
 * Captures `root`, letting `during` look at the page while the renderer is
 * running. The renderer returns a short data URL, so no scale logic is in play.
 */
async function capture(
  root: HTMLElement,
  during: () => void,
  options: CaptureOptions = {},
): Promise<void> {
  await captureScreenshot(
    async () => {
      during();
      return "data:image/png;base64,AAAA";
    },
    { root, maxDataUrlLength: 1_000_000, ...options },
  );
}

const field = (): HTMLInputElement => document.querySelector("input") as HTMLInputElement;

test("an input value is bulleted during the render and restored after", async () => {
  const root = page(`<input value="4111 1111 1111 1111">`);
  let seen = "";
  await capture(root, () => {
    seen = field().value;
  });
  assert.equal(seen, "•".repeat("4111 1111 1111 1111".length));
  assert.equal(field().value, "4111 1111 1111 1111");
});

test("a placeholder is cleared during the render and restored after", async () => {
  const root = page(`<input placeholder="you@example.com">`);
  let seen = "unset";
  await capture(root, () => {
    seen = field().placeholder;
  });
  assert.equal(seen, "");
  assert.equal(field().placeholder, "you@example.com");
});

test("a textarea value is bulleted too", async () => {
  const root = page(`<textarea>two words</textarea>`);
  const area = () => document.querySelector("textarea") as HTMLTextAreaElement;
  let seen = "";
  await capture(root, () => {
    seen = area().value;
  });
  assert.equal(seen, "•".repeat("two words".length));
  assert.equal(area().value, "two words");
});

test("contenteditable text is bulleted and restored", async () => {
  const root = page(`<div contenteditable="true">secret note</div>`);
  const box = () => document.querySelector("[contenteditable]") as HTMLElement;
  let seen = "";
  await capture(root, () => {
    seen = box().textContent ?? "";
  });
  assert.equal(seen, "•••••• ••••");
  assert.equal(box().textContent, "secret note");
});

test("a checkbox and a submit button are left alone", async () => {
  const root = page(`<input type="checkbox" value="yes"><input type="submit" value="Pay">`);
  const values: string[] = [];
  await capture(root, () => {
    for (const el of document.querySelectorAll("input")) values.push((el as HTMLInputElement).value);
  });
  assert.deepEqual(values, ["yes", "Pay"]);
});

test("marked text is bulleted, keeping its spaces, and restored", async () => {
  const root = page(`<p data-bugbottle-mask>Ada Lovelace</p>`);
  const marked = () => document.querySelector("p") as HTMLElement;
  let seen = "";
  await capture(root, () => {
    seen = marked().textContent ?? "";
  });
  assert.equal(seen, "••• ••••••••");
  assert.equal(marked().textContent, "Ada Lovelace");
});

test("marked text is bulleted inside nested elements", async () => {
  const root = page(`<div data-bugbottle-mask>Total <b>42</b></div>`);
  let seen = "";
  await capture(root, () => {
    seen = (document.querySelector("[data-bugbottle-mask]") as HTMLElement).innerHTML;
  });
  assert.equal(seen, "••••• <b>••</b>");
});

test("a blocked element is covered during the render and bare after", async () => {
  const root = page(`<div data-bugbottle-block>chart</div>`);
  const blocked = () => document.querySelector("[data-bugbottle-block]") as HTMLElement;
  let overlays = 0;
  let colour = "";
  await capture(root, () => {
    const overlay = blocked().querySelector("[data-bugbottle-mask-overlay]") as HTMLElement | null;
    overlays = blocked().querySelectorAll("[data-bugbottle-mask-overlay]").length;
    colour = overlay?.style.backgroundColor ?? "";
  });
  assert.equal(overlays, 1);
  assert.match(colour, /153|#999/);
  assert.equal(blocked().querySelectorAll("[data-bugbottle-mask-overlay]").length, 0);
  assert.equal(blocked().textContent, "chart");
});

test("the overlay colour can be given as an option", async () => {
  const root = page(`<div data-bugbottle-block>chart</div>`);
  let colour = "";
  await capture(
    root,
    () => {
      const overlay = document.querySelector("[data-bugbottle-mask-overlay]") as HTMLElement;
      colour = overlay.style.backgroundColor;
    },
    { mask: { colour: "#000000" } },
  );
  assert.match(colour, /#000000|rgb\(0, 0, 0\)/);
});

test("everything is restored when the renderer throws", async () => {
  const root = page(
    `<input value="hunter2"><p data-bugbottle-mask>Ada</p><div data-bugbottle-block>x</div>`,
  );
  await assert.rejects(
    captureScreenshot(
      async () => {
        throw new Error("renderer is broken");
      },
      { root, maxDataUrlLength: 1_000_000 },
    ),
    /renderer is broken/,
  );
  assert.equal(field().value, "hunter2");
  assert.equal((document.querySelector("p") as HTMLElement).textContent, "Ada");
  assert.equal(document.querySelectorAll("[data-bugbottle-mask-overlay]").length, 0);
});

test("mask: false leaves the page exactly as it is", async () => {
  const root = page(
    `<input value="hunter2"><p data-bugbottle-mask>Ada</p><div data-bugbottle-block>x</div>`,
  );
  let value = "";
  let text = "";
  let overlays = -1;
  await capture(
    root,
    () => {
      value = field().value;
      text = (document.querySelector("p") as HTMLElement).textContent ?? "";
      overlays = document.querySelectorAll("[data-bugbottle-mask-overlay]").length;
    },
    { mask: false },
  );
  assert.equal(value, "hunter2");
  assert.equal(text, "Ada");
  assert.equal(overlays, 0);
});

test("each pass can be switched off on its own", async () => {
  const root = page(`<input value="hunter2"><p data-bugbottle-mask>Ada</p>`);
  let value = "";
  let text = "";
  await capture(
    root,
    () => {
      value = field().value;
      text = (document.querySelector("p") as HTMLElement).textContent ?? "";
    },
    { mask: { inputs: false, selector: false } },
  );
  assert.equal(value, "hunter2");
  assert.equal(text, "Ada");
});

test("the mask is applied once and covers the retry", async () => {
  const root = page(`<input value="hunter2">`);
  const seen: string[] = [];
  let attempt = 0;
  await captureScreenshot(
    async () => {
      seen.push(field().value);
      attempt += 1;
      return attempt === 1 ? "d".repeat(2000) : "d".repeat(10);
    },
    { root, maxDataUrlLength: 1000 },
  );
  assert.deepEqual(seen, ["•••••••", "•••••••"]);
  assert.equal(field().value, "hunter2");
});

test("a nonsense selector costs nothing but its own pass", async () => {
  const root = page(`<input value="hunter2">`);
  let value = "";
  await capture(
    root,
    () => {
      value = field().value;
    },
    { mask: { selector: "[[[" } },
  );
  assert.equal(value, "•••••••");
  assert.equal(field().value, "hunter2");
});

test("a blocked replaced element is hidden and covered from the outside", async () => {
  const root = page(`<div id="frame"><img data-bugbottle-block src="avatar.png"></div>`);
  const image = () => document.querySelector("img") as HTMLElement;
  let children = -1;
  let overlays = -1;
  let visibility = "unset";
  await capture(root, () => {
    // An `img` renders no children, so an overlay appended to it would be in
    // the tree and in nobody's picture.
    children = image().querySelectorAll("[data-bugbottle-mask-overlay]").length;
    overlays = document.querySelectorAll("[data-bugbottle-mask-overlay]").length;
    visibility = image().style.visibility;
  });
  assert.equal(children, 0, "there is nowhere inside a replaced element to put an overlay");
  assert.equal(overlays, 1, "so the overlay is a sibling positioned over its box");
  assert.equal(visibility, "hidden", "and the image itself is out of the picture");
  assert.equal(image().style.visibility, "", "restored afterwards");
  assert.equal(document.querySelectorAll("[data-bugbottle-mask-overlay]").length, 0);
});

test("an input inside an open shadow root is masked too", async () => {
  const root = page(`<div id="host"></div>`);
  const host = document.querySelector("#host") as HTMLElement;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<input value="hunter2"><p data-bugbottle-mask>Ada</p>`;
  const inner = () => shadow.querySelector("input") as HTMLInputElement;
  const marked = () => shadow.querySelector("p") as HTMLElement;
  let value = "";
  let text = "";
  await capture(root, () => {
    value = inner().value;
    text = marked().textContent ?? "";
  });
  assert.equal(value, "•••••••", "querySelectorAll stops at the boundary; the renderer does not");
  assert.equal(text, "•••");
  assert.equal(inner().value, "hunter2");
  assert.equal(marked().textContent, "Ada");
});

test("the overlay outranks positioned content and the block element clips", async () => {
  const root = page(`<div data-bugbottle-block>chart</div>`);
  const blocked = () => document.querySelector("[data-bugbottle-block]") as HTMLElement;
  let zIndex = "";
  let overflow = "";
  await capture(root, () => {
    const overlay = document.querySelector("[data-bugbottle-mask-overlay]") as HTMLElement;
    zIndex = overlay.style.zIndex;
    overflow = blocked().style.overflow;
  });
  assert.equal(zIndex, "2147483647", "a positioned descendant must not paint over the mask");
  assert.equal(overflow, "hidden", "and neither must content spilling out of the box");
  assert.equal(blocked().style.overflow, "", "both restored");
});

test("a mask pass that throws still puts back what it had already changed", async () => {
  const root = page(`<input value="hunter2"><p data-bugbottle-mask>Ada</p>`);
  const text = (document.querySelector("p") as HTMLElement).firstChild as Text;
  Object.defineProperty(text, "data", {
    configurable: true,
    get: () => "Ada",
    set: () => {
      throw new Error("mask is broken");
    },
  });
  await assert.rejects(
    captureScreenshot(async () => "data:image/png;base64,AAAA", {
      root,
      maxDataUrlLength: 1_000_000,
    }),
    /mask is broken/,
    "masking is the one pass that must not fail open",
  );
  assert.equal(field().value, "hunter2", "the input the first pass had already bulleted");
});
