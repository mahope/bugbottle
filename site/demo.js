/*
 * The live demo. It mounts the real `bugbottle/ui` panel from the copy of
 * `dist/` that ships in the image, and hands it a `fetch` of its own instead
 * of an endpoint: the fake fetch keeps the body it was given, answers 201 with
 * an id, and the page renders `toMarkdown` of that body into the <pre>.
 *
 * Nothing leaves the browser. There is no endpoint on this host, no analytics
 * and no storage — the point is to show the payload, not to collect it.
 */

import { initConsoleBuffer } from "/dist/index.js";
import { da, en } from "/dist/locales.js";
import { toMarkdown } from "/dist/server/index.js";
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

const widget = mountBugbottle({
  endpoint: "/this-endpoint-does-not-exist",
  fetch: demoFetch,
  locale,
  texts: {
    intro: danish
      ? "Det her er en demo. Rapporten forlader ikke din browser — den bliver vist på siden."
      : "This is a demo. The report never leaves your browser — it is rendered on the page.",
  },
  // The seal red the page uses. It carries white text in both schemes.
  theme: { position: "bottom-right", primary: "#a8102b", onPrimary: "#ffffff" },
  onSent() {
    out.textContent = lastReport
      ? toMarkdown(lastReport, { facts: { Demo: "bugbottle.dev" } })
      : "";
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
