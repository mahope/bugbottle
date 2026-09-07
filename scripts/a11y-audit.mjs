/**
 * The accessibility audit of the ready-made panel.
 *
 * `node:test` has no layout engine, so colour contrast, computed target sizes
 * and the accessibility tree can only be checked in a real browser. This
 * serves `dist/` on a scratch page, mounts the panel with everything showing —
 * the screenshot row, an attached element and its remove button — and runs
 * axe-core over three states: closed, open in the light scheme, open in the
 * dark one. It exits non-zero on any violation.
 *
 *     npm run build
 *     node scripts/a11y-audit.mjs --out <directory>
 *
 * Chrome is found at CHROME_PATH or the usual Windows location; puppeteer-core
 * may be installed globally rather than in this repository, which is why it is
 * resolved by hand.
 */

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = resolve(process.argv[process.argv.indexOf("--out") + 1] ?? join(root, "a11y-reports"));
const chromePath =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

function loadPuppeteer() {
  const here = createRequire(import.meta.url);
  try {
    return here("puppeteer-core");
  } catch {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(join(globalRoot, "noop.js"))("puppeteer-core");
  }
}

const TYPES = { ".js": "text/javascript", ".json": "application/json", ".map": "application/json" };

/** The scratch page: a landmarked document with the panel mounted into it. */
function page(scheme) {
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
  window.bb = mountBugbottle({
    endpoint: "/api/reports",
    theme: { scheme: ${JSON.stringify(scheme)} },
    // A renderer that takes no picture: the screenshot row and its note have
    // to be on the page to be audited, but nothing needs to be photographed.
    screenshot: async () => "data:image/png;base64,iVBORw0KGgo=",
    screenshotFor: () => false,
    fetch: async () => new Response("{}", { status: 201 }),
  });
</script>
</body></html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(url.searchParams.get("scheme") ?? "light"));
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
async function audit(name, scheme, prepare) {
  const tab = await browser.newPage();
  await tab.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  await tab.goto(`${origin}/?scheme=${scheme}`, { waitUntil: "networkidle0" });
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

let failures = 0;
failures += await audit("closed-light", "light");
failures += await audit("open-light", "light", openWithEverything);
failures += await audit("open-dark", "dark", openWithEverything);

await browser.close();
server.close();
console.log(`reports written to ${outDir}`);
if (failures) {
  console.error(`${failures} axe violations`);
  process.exit(1);
}
