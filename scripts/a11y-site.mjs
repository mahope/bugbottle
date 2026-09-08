/**
 * The accessibility audit of the pages, as opposed to the panel.
 *
 * `scripts/a11y-audit.mjs` mounts `bugbottle/ui` on a scratch page and audits
 * the widget. This one audits the site: the two landing pages, the
 * documentation index, one deep documentation page, the English landing page
 * again with the demo's panel open and the picture editor over it, the index
 * again with the search field open on results, the theme playground with a
 * control moved, the two comparison pages, the Danish getting-started page,
 * both halves of the privacy checklist, the changelog, and the landing and
 * documentation pages once more under `prefers-reduced-motion: reduce`, in both
 * colour schemes, with the pinned `axe-core`. Contrast, heading
 * order, landmarks and accessible names are all questions only a layout engine
 * can answer, and a stylesheet is exactly the kind of change that breaks them
 * without breaking a test.
 *
 * The two reduced-motion states are read for movement as well as audited: no
 * element on the page, the demo panel's shadow root included, may have a
 * `transition-duration` or a running `animation-duration` above zero, and the
 * document may not still scroll smoothly. See `scripts/motionless.mjs`.
 *
 * It also fails on a console error, because a page that logs one is a page
 * that is half-working, and there is no other check that would notice. A
 * blocked resource is exactly that kind of message: the server below answers
 * with the same headers `site/security-headers.conf` gives nginx — the
 * Content-Security-Policy included — parsed out of that file rather than
 * copied from it, so a policy that breaks a page breaks this audit and cannot
 * reach a deploy quietly.
 *
 *     npm run build        # the demo on the landing page runs the real dist/
 *     npm run build:docs   # /docs/, /compare/ and /da/sammenlign/ are generated
 *     node scripts/a11y-site.mjs --out <directory>
 *
 * Chrome and `puppeteer-core` are both found by `scripts/chrome.mjs`:
 * CHROME_BIN or CHROME_PATH, then the usual Linux, macOS and Windows
 * locations, and puppeteer-core from this repository or the global root.
 */

import { createServer } from "node:http";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, loadPuppeteer } from "./chrome.mjs";
import { movingElements, reportMotion } from "./motionless.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const site = join(root, "site");
const outFlag = process.argv.indexOf("--out");
const outDir = resolve(
  (outFlag === -1 ? undefined : process.argv[outFlag + 1]) ?? join(root, "a11y-reports"),
);
const chromePath = findChrome();

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

/* The security headers, read from the file nginx is given rather than
   restated here: `add_header Name "value" always;` or `add_header Name value
   always;`, one per line, comments ignored. The whole point is that the audit
   sees the policy that will be served, so there is no second copy to drift. */
const SECURITY_HEADERS = Object.fromEntries(
  (await readFile(join(site, "security-headers.conf"), "utf8"))
    .split("\n")
    .map((line) => /^\s*add_header\s+(\S+)\s+(?:"([^"]*)"|(\S+))\s*(?:always\s*)?;/.exec(line))
    .filter(Boolean)
    .map((m) => [m[1], m[2] ?? m[3]]),
);
if (!SECURITY_HEADERS["Content-Security-Policy"]) {
  console.error("site/security-headers.conf has no Content-Security-Policy — nothing to audit");
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
  if (!file.startsWith(base)) return void res.writeHead(403, SECURITY_HEADERS).end();
  if (path === "" || !extname(file)) file = join(file, "index.html");
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404, SECURITY_HEADERS).end();
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
/* The third item, where there is one, is a state to put the page into before
   axe looks at it: a page with a search field is two pages, and the one with
   results in it is the one nothing else audits. */
const PAGES = [
  ["landing-en", "/"],
  ["landing-da", "/da/"],
  ["landing-annotate", "/", "annotate"],
  ["docs-index", "/docs/"],
  ["docs-panel", "/docs/the-ready-made-panel/"],
  ["docs-search", "/docs/", "search"],
  ["docs-playground", "/docs/languages-and-branding/", "playground"],
  ["compare-en", "/compare/"],
  ["compare-da", "/da/sammenlign/"],
  ["kom-i-gang", "/da/kom-i-gang/"],
  /* Both halves of the privacy checklist: the widest table on the site, in a
     language each, and the page most likely to be read by somebody who is not
     a developer. */
  ["privacy-checklist", "/docs/privacy-checklist/"],
  ["privatliv", "/da/privatliv/"],
  ["changelog", "/docs/changelog/"],
  /* The landing page and a documentation page under
     `prefers-reduced-motion: reduce`. The landing page is the one with the
     reveal, the demo's panel and a scroll a script asks for; the documentation
     page carries the article styles and the sidebar. Both are audited by axe as
     usual and then read for anything still moving. */
  ["landing-still", "/", "reduced"],
  ["docs-still", "/docs/the-ready-made-panel/", "reduced"],
];

let failures = 0;

async function audit(name, path, scheme, state) {
  const tab = await browser.newPage();
  await tab.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: scheme },
    /* "no-preference" rather than nothing, so the other states are audited
       with the reveal running, which is how the page usually arrives. */
    { name: "prefers-reduced-motion", value: state === "reduced" ? "reduce" : "no-preference" },
  ]);
  const noise = [];
  tab.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") noise.push(`${m.type()}: ${m.text()}`);
  });
  tab.on("pageerror", (error) => noise.push(`pageerror: ${error.message}`));
  tab.on("requestfailed", (request) => noise.push(`request failed: ${request.url()}`));

  /* Chrome logs a blocked resource as a console error, so the listener above
     would already catch one, but a violation names the directive it broke and
     that is the line worth reading. Installed before the document runs so the
     stylesheet the panel writes into its shadow root is covered too. */
  await tab.evaluateOnNewDocument(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP: ${e.violatedDirective} blocked ${e.blockedURI || "an inline resource"}`);
    });
  });

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

  /* The search field is built by docs.js and fetches its index on the first
     focus, so this is a click, a word typed, and a wait for the list — the
     state a reader is in when they are reading results. */
  /* The theme playground: a panel mounted into the page and restyled by the
     controls beside it. Audited after a control has moved, because the state
     worth looking at is the one the reader makes. The stage is inert, so what
     axe reads here is the controls; the panel itself is audited by
     scripts/a11y-audit.mjs. */
  if (state === "playground") {
    await tab.waitForSelector(".playground:not([hidden])", { timeout: 5000 });
    await tab.evaluate(() => {
      const set = (id, value) => {
        const field = document.getElementById(id);
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("pg-primary", "#0f766e");
      set("pg-radius", "2");
      set("pg-font", 'Georgia, "Times New Roman", serif');
      set("pg-position", "top-left");
    });
    await tab.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );

    /* The printed call is a thing readers copy, so it must say what they did
       and nothing else. A block that also pinned every colour and `scheme` as
       it happened to be read off the panel would ship a panel that ignores the
       reader's own scheme — the one setting whose default is "follow the
       browser". Not an accessibility question, but this is the only place a
       browser runs the playground. */
    const printed = await tab.evaluate(
      () => document.querySelector("[data-playground-js]")?.textContent ?? "",
    );
    for (const key of ["primary", "radius", "font", "position"]) {
      if (!printed.includes(`${key}:`)) {
        console.error(`  the playground did not print the ${key} the reader changed`);
        failures += 1;
      }
    }
    for (const key of ["scheme", "background", "text"]) {
      if (printed.includes(`${key}:`)) {
        console.error(`  the playground printed ${key}, which the reader never touched`);
        failures += 1;
      }
    }
  }

  if (state === "search") {
    await tab.click(".docs-search-field");
    await tab.type(".docs-search-field", "screenshot");
    await tab.waitForFunction(
      () => document.querySelectorAll(".docs-search-results li a").length > 0,
      { timeout: 5000 },
    );
  }

  /* The panel with the picture editor open over the landing page.
     `scripts/a11y-audit.mjs` audits the same editor on a scratch page, but the
     site wires it differently — the page's own renderer draws the picture and
     the page's colours theme the editor — so the state is worth auditing
     where it actually ships. */
  if (state === "annotate") {
    await tab.evaluate(async () => {
      const panel = document.querySelector("[data-bugbottle=ui]").shadowRoot;
      panel.querySelector(".trigger").click();
      const box = panel.querySelector(".check input");
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await tab.waitForFunction(() => {
      const panel = document.querySelector("[data-bugbottle=ui]").shadowRoot;
      const edit = panel.querySelector(".edit");
      return edit && !edit.hidden;
    });
    await tab.evaluate(() =>
      document.querySelector("[data-bugbottle=ui]").shadowRoot.querySelector(".edit").click(),
    );
    await tab.waitForFunction(() => {
      const panel = document.querySelector("[data-bugbottle=ui]").shadowRoot;
      const editor = panel.querySelector(".editor");
      return editor && !editor.hidden && panel.querySelector("canvas").width > 0;
    });
  }

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
  /* The reduced-motion check, which axe has no rule for. It runs after axe so
     the page has been scrolled through and every section is in its final
     state — a transition that only exists while a section arrives would
     otherwise be missed. */
  if (state === "reduced") failures += reportMotion(label, await movingElements(tab));
  await tab.close();
}

for (const [name, path, state] of PAGES) {
  for (const scheme of ["light", "dark"]) {
    await audit(name, path, scheme, state);
  }
}

await browser.close();
server.close();
console.log(`reports written to ${outDir}`);
if (failures) {
  console.error(`${failures} axe violations or console messages`);
  process.exit(1);
}
