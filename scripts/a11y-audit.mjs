/**
 * The accessibility audit of the ready-made panel.
 *
 * `node:test` has no layout engine, so colour contrast, computed target sizes
 * and the accessibility tree can only be checked in a real browser. This
 * serves `dist/` on a scratch page, mounts the panel with everything showing —
 * the screenshot row, an attached element and its remove button — and runs
 * axe-core over seven states: closed, open in the light scheme, open in the
 * dark one, the picture annotator open in each scheme, and the panel with the
 * optional contact field on in each scheme. It exits non-zero on any
 * violation.
 *
 *     npm run build
 *     node scripts/a11y-audit.mjs --out <directory>
 *
 * Chrome and `puppeteer-core` are both found by `scripts/chrome.mjs`:
 * CHROME_BIN or CHROME_PATH, then the usual Linux, macOS and Windows
 * locations, and puppeteer-core from this repository or the global root.
 */

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, loadPuppeteer } from "./chrome.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
// `indexOf` returns -1 when the flag is absent, and argv[-1 + 1] is the path to
// node itself, so the flag has to be found before its value is read.
const outFlag = process.argv.indexOf("--out");
const outDir = resolve(
  (outFlag === -1 ? undefined : process.argv[outFlag + 1]) ?? join(root, "a11y-reports"),
);
const chromePath = findChrome();

const TYPES = { ".js": "text/javascript", ".json": "application/json", ".map": "application/json" };

/** The scratch page: a landmarked document with the panel mounted into it. */
function page(scheme, contact) {
  const dark = scheme === "dark";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>bugbottle accessibility scratch page</title>
<style>
  body{margin:0;font:16px/1.5 system-ui,sans-serif;
    background:${dark ? "#0b1020" : "#ffffff"};color:${dark ? "#e5e7eb" : "#1f2937"}}
  main{padding:24px;max-width:40em}
</style></head>
<body>
<main>
  <h1>Orders</h1>
  <p>A page with some content on it, so the panel is audited where it lives.</p>
  <button type="button" id="save-order">Save the order</button>
</main>
<script type="module">
  import { mountBugbottle } from "/dist/ui/index.js";
  import { createAnnotator } from "/dist/annotate.js";
  // A picture rather than a photograph of the page: the screenshot row, its
  // note and the annotator all have to be on the page to be audited, and the
  // annotator needs a PNG that really decodes. Nothing here renders the DOM.
  const shot = document.createElement("canvas");
  shot.width = 320;
  shot.height = 200;
  const paint = shot.getContext("2d");
  paint.fillStyle = "#94a3b8";
  paint.fillRect(0, 0, 320, 200);
  const picture = shot.toDataURL("image/png");
  window.bb = mountBugbottle({
    endpoint: "/api/reports",
    theme: { scheme: ${JSON.stringify(scheme)} },
    screenshot: async () => picture,
    screenshotFor: () => false,
    // Off unless the state under audit asked for it, exactly as an application
    // has to. "required" audits the label, the hint and the required marking.
    contact: ${contact ? '"required"' : "false"},
    // The panel takes the annotator as a function, so the audit has to ask for
    // it: without this the editor is not on the page to be audited at all.
    annotate: createAnnotator,
    fetch: async () => new Response("{}", { status: 201 }),
  });
</script>
</body></html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(url.searchParams.get("scheme") ?? "light", url.searchParams.has("contact")));
    return;
  }
  const file = join(root, normalize(url.pathname).replace(/^[\\/]+/, ""));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;

const puppeteer = loadPuppeteer();
const axeSource = await readFile(join(root, "node_modules", "axe-core", "axe.min.js"), "utf8");
const browser = await puppeteer.launch({ executablePath: chromePath, headless: "new" });
await mkdir(outDir, { recursive: true });

/** Runs axe over the whole document, shadow roots included, and saves the report. */
async function audit(name, scheme, prepare, query = "") {
  const tab = await browser.newPage();
  await tab.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  await tab.goto(`${origin}/?scheme=${scheme}${query}`, { waitUntil: "networkidle0" });
  await tab.waitForSelector("[data-bugbottle=ui]");
  if (prepare) await prepare(tab);
  await tab.evaluate(axeSource);
  const report = await tab.evaluate(async () => await window.axe.run(document));
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(report, null, 2));
  const rules = report.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`);
  console.log(
    `${name}: ${report.violations.length} violations, ${report.passes.length} passes, ` +
      `${report.incomplete.length} incomplete${rules.length ? ` — ${rules.join(", ")}` : ""}`,
  );
  await tab.close();
  return report.violations.length;
}

/** Opens the panel and attaches an element, so every control is on the page. */
const openWithEverything = async (tab) => {
  await tab.evaluate(async () => {
    const root = document.querySelector("[data-bugbottle=ui]").shadowRoot;
    root.querySelector(".trigger").click();
    root.querySelector(".pick").click();
    await new Promise((r) => setTimeout(r, 50));
    document.getElementById("save-order").click();
    await new Promise((r) => setTimeout(r, 50));
  });
};

/** Opens the panel, attaches the picture and opens the annotator over it. */
const openAnnotator = async (tab) => {
  await tab.evaluate(async () => {
    const root = document.querySelector("[data-bugbottle=ui]").shadowRoot;
    root.querySelector(".trigger").click();
    const box = root.querySelector(".check input");
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    root.querySelector(".edit").click();
    await new Promise((r) => setTimeout(r, 100));
  });
  // The toolbar, the canvas and the two actions are all inside the panel, so a
  // state that stops short of them audits the wrong thing.
  await tab.waitForFunction(() => {
    const root = document.querySelector("[data-bugbottle=ui]").shadowRoot;
    const editor = root.querySelector(".editor");
    return editor && !editor.hidden && root.querySelector("canvas").width > 0;
  });
};

let failures = 0;
failures += await audit("closed-light", "light");
failures += await audit("open-light", "light", openWithEverything);
failures += await audit("open-dark", "dark", openWithEverything);
failures += await audit("annotate-light", "light", openAnnotator);
failures += await audit("annotate-dark", "dark", openAnnotator);
// The optional contact field, which is a labelled input with a hint of its own
// and is rendered nowhere else.
failures += await audit("contact-light", "light", openWithEverything, "&contact=1");
failures += await audit("contact-dark", "dark", openWithEverything, "&contact=1");

await browser.close();
server.close();
console.log(`reports written to ${outDir}`);
if (failures) {
  console.error(`${failures} axe violations`);
  process.exit(1);
}
