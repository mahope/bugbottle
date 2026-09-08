/*
 * The live demo. It mounts the real `bugbottle/ui` panel from the copy of
 * `dist/` that ships in the image, and hands it a `fetch` of its own instead
 * of an endpoint: the fake fetch keeps the body it was given, answers 201 with
 * an id, and the page renders `toMarkdown` of that body into the <pre>.
 *
 * Nothing leaves the browser. There is no endpoint on this host, no analytics
 * and no storage — the point is to show the payload, not to collect it.
 *
 * The picture is the one part that is not the library doing its usual work. A
 * real capture renders the page through `bugbottle/html-to-image`, and this
 * page has nowhere private to put such a thing, so the demo hands the panel a
 * renderer that *draws* a small picture of the demo section instead: a header
 * band, a few text bars and the button, painted onto a canvas. It is an
 * approximation, not a photograph, and both pages say so. It is enough for the
 * part worth trying — the rectangle, the arrow and the blur from
 * `bugbottle/annotate`, over a picture that never leaves the tab.
 */

import { createAnnotator } from "/dist/annotate.js";
import { initConsoleBuffer } from "/dist/index.js";
import { da, en } from "/dist/locales.js";
import { toMarkdown } from "/dist/markdown.js";
import { mountBugbottle } from "/dist/ui/index.js";

const danish = document.documentElement.lang === "da";
const locale = danish ? da : en;
const out = document.getElementById("payload");

// So the console section of the payload has something honest in it.
initConsoleBuffer();

/** The last body the widget tried to POST, parsed back from the request. */
let lastReport = null;

/**
 * Stands in for the endpoint. `sendReport` only reads the status and the JSON
 * body, so a plain Response is enough.
 */
async function demoFetch(_url, init) {
  try {
    lastReport = JSON.parse(String(init && init.body));
  } catch {
    lastReport = null;
  }
  return new Response(JSON.stringify({ id: "demo" }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

/*
 * The picture the demo marks up.
 *
 * A `ScreenshotRenderer` is `(root, { filter, pixelRatio }) => Promise<dataUrl>`;
 * a real one renders `root` and leaves out the nodes `filter` rejects. This one
 * ignores both. It has no DOM to render — drawing is the honest thing to offer
 * on a public page — and there is nothing in a drawing for a filter to remove.
 * `pixelRatio` is honoured, so the one retry `captureScreenshot` makes at half
 * scale really does produce a smaller picture.
 *
 * The colours come from the page's own tokens, so the drawing follows the page
 * into dark mode rather than being a light rectangle in the middle of it.
 */
const PICTURE_WIDTH = 880;
const PICTURE_HEIGHT = 520;

/** One of the page's colour tokens, with a fallback for a browser that has none. */
function token(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

async function drawDemoPicture(_root, options) {
  const ratio = options && options.pixelRatio > 0 ? options.pixelRatio : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PICTURE_WIDTH * ratio);
  canvas.height = Math.round(PICTURE_HEIGHT * ratio);
  const paint = canvas.getContext("2d");
  if (!paint) throw new Error("This browser has no 2D canvas");
  paint.scale(ratio, ratio);

  const surface = token("--surface", "#ffffff");
  const ink = token("--ink", "#0d2a24");
  const muted = token("--muted", "#4a635d");
  const accent = token("--accent", "#a8102b");
  const accentInk = token("--accent-ink", "#ffffff");

  // The paper, and the plate the demo section sits on.
  paint.fillStyle = token("--paper", "#edf0ec");
  paint.fillRect(0, 0, PICTURE_WIDTH, PICTURE_HEIGHT);
  paint.fillStyle = surface;
  paint.fillRect(40, 40, PICTURE_WIDTH - 80, PICTURE_HEIGHT - 80);
  paint.strokeStyle = token("--rule", "#d3dcd6");
  paint.lineWidth = 2;
  paint.strokeRect(40, 40, PICTURE_WIDTH - 80, PICTURE_HEIGHT - 80);

  // The header band, with the wordmark's square where the bottle stands.
  paint.fillStyle = accent;
  paint.fillRect(40, 40, PICTURE_WIDTH - 80, 56);
  paint.fillStyle = accentInk;
  paint.fillRect(68, 60, 18, 18);
  paint.fillRect(100, 64, 120, 10);

  // The heading, then the paragraph as bars in the section's own text colour.
  paint.fillStyle = ink;
  paint.fillRect(68, 136, 360, 18);
  paint.fillStyle = muted;
  const bars = [520, 486, 540, 300, 512, 448];
  bars.forEach((width, i) => paint.fillRect(68, 184 + i * 26, width, 10));

  // The button, and the slab the Markdown is rendered into beside it.
  paint.fillStyle = accent;
  paint.fillRect(68, 360, 176, 40);
  paint.fillStyle = accentInk;
  paint.fillRect(92, 375, 128, 10);
  paint.fillStyle = token("--slab", "#0d2a24");
  paint.fillRect(620, 136, 192, 264);
  paint.fillStyle = token("--slab-key", "#8fd0bc");
  for (let i = 0; i < 9; i += 1) {
    paint.fillRect(636, 160 + i * 26, i % 3 === 2 ? 96 : 160, 8);
  }

  return canvas.toDataURL("image/png");
}

const widget = mountBugbottle({
  endpoint: "/this-endpoint-does-not-exist",
  fetch: demoFetch,
  locale,
  // The renderer above, and the editor that marks what it drew. Both are handed
  // in rather than imported by the library, so an application that wants
  // neither pays for neither.
  screenshot: drawDemoPicture,
  annotate: createAnnotator,
  texts: {
    intro: danish
      ? "Det her er en demo. Rapporten forlader ikke din browser — den bliver vist på siden."
      : "This is a demo. The report never leaves your browser — it is rendered on the page.",
    // The locale's own wording is "the picture shows this page as you see it
    // now", which is true of a capture and not of this drawing. The demo says
    // what it really attaches.
    screenshot: danish ? "Vedhæft det tegnede billede" : "Attach the drawn picture",
    screenshotNote: danish
      ? "Siden tegner et forenklet billede af sig selv — den er ikke fotograferet."
      : "The page draws a simplified picture of itself. Nothing is photographed.",
  },
  // The seal red the page uses. It carries white text in both schemes.
  theme: { position: "bottom-right", primary: "#a8102b", onPrimary: "#ffffff" },
  onSent() {
    out.textContent = lastReport
      ? toMarkdown(lastReport, { facts: { Demo: "bugbottle.dev" } })
      : "";
    const copyPayload = out.parentElement.querySelector(".copy");
    if (copyPayload) copyPayload.hidden = !out.textContent;
    out.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },
});

const openButton = document.getElementById("demo-open");
if (openButton) {
  openButton.addEventListener("click", () => widget.open());
}

/*
 * The rest of this file is the page, not the library: two small pieces of
 * motion that both degrade to "everything is visible" when they cannot run.
 */

const stillness = window.matchMedia("(prefers-reduced-motion: reduce)");

// Sections arrive as you reach them. The class that hides them is set from
// here, so a page without JavaScript — or with reduced motion asked for —
// never hides anything in the first place.
const sections = document.querySelectorAll(".reveal");
if (sections.length && "IntersectionObserver" in window && !stillness.matches) {
  document.documentElement.classList.add("reveal-ready");
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("seen");
        seen.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  for (const section of sections) seen.observe(section);
}

// While the panel is open the demo section says so, by lifting off the paper.
// The panel keeps `aria-expanded` on its trigger up to date, so that attribute is
// the honest source rather than a guess from our own button.
const host = document.querySelector("[data-bugbottle]");
const trigger = host && host.shadowRoot && host.shadowRoot.querySelector(".trigger");
if (trigger) {
  const sync = () =>
    document.documentElement.classList.toggle(
      "panel-open",
      trigger.getAttribute("aria-expanded") === "true",
    );
  new MutationObserver(sync).observe(trigger, {
    attributes: true,
    attributeFilter: ["aria-expanded"],
  });
  sync();
}

// A copy button on every code slab, including the payload the demo renders.
// It is built here rather than written into the two HTML files so the label
// follows the page language in one place, and so a browser without a
// clipboard never gets a button that cannot do anything.
if (navigator.clipboard && window.isSecureContext) {
  const copyLabel = danish ? "Kopi\u00e9r" : "Copy";
  const copiedLabel = danish ? "Kopieret" : "Copied";
  const failedLabel = danish ? "Kunne ikke kopiere" : "Could not copy";

  for (const slab of document.querySelectorAll(".slab")) {
    const tab = slab.querySelector(".slab-tab");
    const pre = slab.querySelector("pre");
    if (!tab || !pre) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = copyLabel;
    // The slab tab names the file, so the button says which one it copies.
    button.setAttribute("aria-label", `${copyLabel}: ${tab.textContent.trim()}`);
    // The payload starts empty; its button appears when there is a report.
    if (pre.id === "payload" && !pre.textContent) button.hidden = true;
    tab.append(button);

    let restore;
    button.addEventListener("click", async () => {
      clearTimeout(restore);
      try {
        await navigator.clipboard.writeText(pre.textContent);
        button.textContent = copiedLabel;
        button.dataset.copied = "true";
      } catch {
        button.textContent = failedLabel;
      }
      restore = setTimeout(() => {
        button.textContent = copyLabel;
        delete button.dataset.copied;
      }, 2000);
    });
  }
}
