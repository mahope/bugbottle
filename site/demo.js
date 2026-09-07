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
  theme: { position: "bottom-right" },
  onSent() {
    out.textContent = lastReport
      ? toMarkdown(lastReport, { facts: { Demo: "bugbottle.mahoje.dk" } })
      : "";
    out.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },
});

const openButton = document.getElementById("demo-open");
if (openButton) {
  openButton.addEventListener("click", () => widget.open());
}
