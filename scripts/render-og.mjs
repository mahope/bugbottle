/**
 * `site/og.png` from `site/og.svg`, at 1200x630, in headless Chrome.
 *
 * The SVG is the source and the PNG is the artefact: the link preview and the
 * page cannot then drift apart, because both are drawn from the same colours.
 * The SVG names the page's two families, so this wraps it in a document that
 * declares them from `site/fonts/` and waits for both to load — a render that
 * did not would quietly ship a picture of the fallback stack.
 *
 *     npm run shot:og
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const site = join(root, "site");
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

/** The faces as data URLs, so the page needs no server and no network. */
async function face(file) {
  return `data:font/woff2;base64,${(await readFile(join(site, "fonts", file))).toString("base64")}`;
}

const svg = await readFile(join(site, "og.svg"), "utf8");
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "Newsreader"; font-weight: 600; src: url("${await face("newsreader-600.woff2")}") format("woff2"); }
@font-face { font-family: "Source Sans 3"; font-weight: 400; src: url("${await face("sourcesans3-400.woff2")}") format("woff2"); }
@font-face { font-family: "Source Sans 3"; font-weight: 600; src: url("${await face("sourcesans3-600.woff2")}") format("woff2"); }
html, body { margin: 0; padding: 0; }
</style>${svg}`;

const puppeteer = loadPuppeteer();
const browser = await puppeteer.launch({ executablePath: chromePath, headless: "new" });
const tab = await browser.newPage();
await tab.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await tab.setContent(html, { waitUntil: "load" });
// document.fonts.ready resolves once every face the document uses has loaded,
// which is the only reliable moment to shoot: a screenshot taken before it
// catches the fallback mid-swap.
await tab.evaluate(async () => {
  await document.fonts.load('600 1em "Newsreader"');
  await document.fonts.load('400 1em "Source Sans 3"');
  await document.fonts.load('600 1em "Source Sans 3"');
  await document.fonts.ready;
});
const png = await tab.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } });
await writeFile(join(site, "og.png"), png);
await browser.close();

const { size } = await stat(join(site, "og.png"));
console.log(`site/og.png: 1200x630, ${(size / 1024).toFixed(1)} kB`);
