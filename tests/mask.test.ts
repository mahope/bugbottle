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

test("bugbottle's own panel is never masked: it is never in the picture", async () => {
  const root = page(`<div data-bugbottle="ui"></div><input value="page">`);
  const host = document.querySelector("[data-bugbottle]") as HTMLElement;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<textarea placeholder="What happened?">The save button</textarea>`;
  const panelField = shadow.querySelector("textarea") as HTMLTextAreaElement;
  let seenPanel = "";
  let seenPage = "";
  await capture(root, () => {
    seenPanel = panelField.value;
    seenPage = field().value;
  });
  assert.equal(seenPanel, "The save button");
  assert.equal(panelField.placeholder, "What happened?");
  assert.equal(seenPage, "••••", "the page's own fields are still masked");
});


/** A renderer that waits for `release` before it answers, so a second capture is queued behind it. */
function heldRender(): {
  render: () => Promise<string>;
  started: Promise<void>;
  release: () => void;
  ran: () => boolean;
} {
  let release!: () => void;
  let start!: () => void;
  let ran = false;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    render: async () => {
      ran = true;
      start();
      await gate;
      return "data:image/png;base64,AAAA";
    },
    started,
    release,
    ran: () => ran,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a second capture waits until the first has put the page back", async () => {
  const root = page(
    `<input type="password" value="hunter2"><p data-bugbottle-mask>Ada</p><div data-bugbottle-block>chart</div>`,
  );
  const marked = document.querySelector("p") as HTMLElement;
  const blocked = document.querySelector("div") as HTMLElement;
  const a = heldRender();
  const b = heldRender();
  let secondSaw = "";
  const opts = { root, maxDataUrlLength: 1_000_000 };
  const one = captureScreenshot(a.render, opts);
  const two = captureScreenshot(async () => {
    const shot = b.render();
    secondSaw = `${field().value}|${marked.textContent}`;
    return shot;
  }, opts);
  await a.started;
  // Released before it is reached: the second still runs only after the first.
  b.release();
  await settle();
  assert.equal(b.ran(), false, "the second has not started while the first renders");
  a.release();
  await one;
  await two;
  assert.equal(secondSaw, "•••••••|•••", "the second picture is masked as well");
  assert.equal(field().value, "hunter2");
  assert.equal(marked.textContent, "Ada");
  assert.equal(blocked.querySelectorAll("[data-bugbottle-mask-overlay]").length, 0);
  assert.equal(blocked.style.position, "");
});

test("a field changed while the first capture renders is masked in the second", async () => {
  // The page writes a new value into a field the first capture has bulleted,
  // and swaps a marked text for a new one. Both are private, and the second
  // picture must not show either.
  const root = page(`<input type="password" value="hunter2"><p data-bugbottle-mask>Ada</p>`);
  const marked = document.querySelector("p") as HTMLElement;
  const a = heldRender();
  let secondSaw = "";
  const opts = { root, maxDataUrlLength: 1_000_000 };
  const one = captureScreenshot(a.render, opts);
  await a.started;
  field().value = "s3cr3t!";
  marked.textContent = "Grace Hopper";
  const two = captureScreenshot(async () => {
    secondSaw = `${field().value}|${marked.textContent}`;
    return "data:image/png;base64,AAAA";
  }, opts);
  a.release();
  await one;
  await two;
  assert.doesNotMatch(secondSaw, /[^•|\s]/, `the second picture saw ${secondSaw}`);
  assert.match(secondSaw, /^•+\|•+ •+$/);
  assert.equal(marked.textContent, "Grace Hopper");
});

test("three queued captures with different options each mask for themselves and end on the originals", async () => {
  const root = page(`<input value="hunter2"><p class="secret">Ada</p>`);
  const marked = document.querySelector("p") as HTMLElement;
  const held = [heldRender(), heldRender(), heldRender()];
  const seen: string[] = [];
  const opts = { root, maxDataUrlLength: 1_000_000 };
  const shot = (h: ReturnType<typeof heldRender>) => async () => {
    const out = h.render();
    seen.push(`${field().value}|${marked.textContent}`);
    return out;
  };
  const runs = [
    captureScreenshot(shot(held[0]!), opts),
    captureScreenshot(shot(held[1]!), { ...opts, mask: { selector: ".secret" } }),
    captureScreenshot(shot(held[2]!), opts),
  ];
  // Released out of order: the queue still runs them first to last.
  for (const i of [1, 2, 0]) held[i]!.release();
  await Promise.all(runs);
  assert.deepEqual(seen, ["•••••••|Ada", "•••••••|•••", "•••••••|Ada"]);
  assert.equal(field().value, "hunter2");
  assert.equal(marked.textContent, "Ada");
});

test("a render that throws does not hold up the next capture", async () => {
  const root = page(`<input value="hunter2">`);
  const opts = { root, maxDataUrlLength: 1_000_000 };
  const one = captureScreenshot(async () => {
    throw new Error("renderer broke");
  }, opts);
  let secondSaw = "";
  const two = captureScreenshot(async () => {
    secondSaw = field().value;
    return "data:image/png;base64,AAAA";
  }, opts);
  await assert.rejects(one, /renderer broke/);
  assert.equal(await two, "data:image/png;base64,AAAA");
  assert.equal(secondSaw, "•••••••");
  assert.equal(field().value, "hunter2");
});

test("a render that never answers times out, puts the page back and lets the next one run", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const root = page(`<input value="hunter2">`);
  const opts = { root, maxDataUrlLength: 1_000_000 };
  const hung = new Promise<string>(() => {});
  const one = captureScreenshot(() => hung, opts);
  let secondSaw = "";
  const two = captureScreenshot(async () => {
    secondSaw = field().value;
    return "data:image/png;base64,AAAA";
  }, opts);
  // Let the first capture reach its render, which starts the clock.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(field().value, "•••••••", "masked while the hung render runs");
  t.mock.timers.tick(30_000);
  await assert.rejects(one, /timed out/);
  assert.equal(await two, "data:image/png;base64,AAAA");
  assert.equal(secondSaw, "•••••••");
  assert.equal(field().value, "hunter2");
});
