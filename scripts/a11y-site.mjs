/**
 * The accessibility audit of the pages, as opposed to the panel.
 *
 * `scripts/a11y-audit.mjs` mounts `bugbottle/ui` on a scratch page and audits
 * the widget. This one audits the site: the two landing pages, the
 * documentation index, one deep documentation page and the two comparison
 * pages, in both colour schemes, with the pinned `axe-core`. Contrast, heading
 * order, landmarks and accessible names are all questions only a layout engine
 * can answer, and a stylesheet is exactly the kind of change that breaks them
 * without breaking a test.
 *
 * It also fails on a console error, because a page that logs one is a page
 * that is half-working, and there is no other check that would notice.
 *
 *     npm run build        # the demo on the landing page runs the real dist/
 *     npm run build:docs   # /docs/, /compare/ and /da/sammenlign/ are generated
 *     node scripts/a11y-site.mjs --out <directory>
 *
 * Chrome is found at CHROME_PATH or the usual Windows location; puppeteer-core
 * may be installed globally rather than in this repository, which is why it is
 * resolved by hand.
 */

import { createServer } from "node:http";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const site = join(root, "site");
const outFlag = process.argv.indexOf("--out");
const outDir = resolve(
  (outFlag === -1 ? undefined : process.argv[outFlag + 1]) ?? join(root, "a11y-reports"),
);
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

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/* The documentation is generated, so it may simply not be there. Say so
   rather than auditing four pages and reporting success. */
try {
  await access(join(site, "docs", "index.html"));
} catch {
  console.error("site/docs/ is missing — run `npm run build:docs` first");
  process.exit(1);
}

/* site/ at the root and dist/ under /dist/, which is the pair site/nginx.conf
   serves in the image. Directories resolve to index.html, as `try_files
   $uri $uri/` does there. */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, "");
  const base = path === "dist" || path.startsWith("dist/") || path.startsWith("dist\\") ? root : site;
  let file = join(base, path);
  if (!file.startsWith(base)) return void res.writeHead(403).end();
  if (path === "" || !extname(file)) file = join(file, "index.html");
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

/* One deep documentation page as well as the index: the index is a list of
   links and exercises almost none of the article styles. "The ready-made
   panel" has headings, a table, code blocks and the heading list beside them,
   so it is the page that would break first. */
const PAGES = [
  ["landing-en", "/"],
  ["landing-da", "/da/"],
  ["docs-index", "/docs/"],
  ["docs-panel", "/docs/the-ready-made-panel/"],
  ["compare-en", "/compare/"],
  ["compare-da", "/da/sammenlign/"],
];

let failures = 0;

async function audit(name, path, scheme) {
  const tab = await browser.newPage();
  await tab.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
  const noise = [];
  tab.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") noise.push(`${m.type()}: ${m.text()}`);
  });
  tab.on("pageerror", (error) => noise.push(`pageerror: ${error.message}`));
  tab.on("requestfailed", (request) => noise.push(`request failed: ${request.url()}`));

  const response = await tab.goto(origin + path, { waitUntil: "networkidle0" });
  if (!response || response.status() !== 200) {
    console.error(`${name}: ${path} answered ${response ? response.status() : "nothing"}`);
    failures += 1;
    await tab.close();
    return;
  }

  /* The sections of the landing page are revealed as the reader arrives at
     them, and axe does not audit what is not visible. Scroll the page first
     or two thirds of it is never looked at. */
  await tab.evaluate(async () => {
    const step = Math.round(window.innerHeight / 2);
    for (let y = 0; y < document.body.scrollHeight + step; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });

  await tab.evaluate(axeSource);
  const report = await tab.evaluate(async () => await window.axe.run(document));
  const label = `${name}-${scheme}`;
  await writeFile(join(outDir, `site-${label}.json`), JSON.stringify(report, null, 2));
  const rules = report.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`);
  console.log(
    `${label}: ${report.violations.length} violations, ${report.passes.length} passes, ` +
      `${report.incomplete.length} incomplete${rules.length ? ` — ${rules.join(", ")}` : ""}` +
      `${noise.length ? `; ${noise.length} console messages` : ""}`,
  );
  for (const line of noise) console.error(`  ${label}: ${line}`);
  failures += report.violations.length + noise.length;
  await tab.close();
}

for (const [name, path] of PAGES) {
  for (const scheme of ["light", "dark"]) {
    await audit(name, path, scheme);
  }
}

await browser.close();
server.close();
console.log(`reports written to ${outDir}`);
if (failures) {
  console.error(`${failures} axe violations or console messages`);
  process.exit(1);
}
