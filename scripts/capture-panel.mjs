/**
 * The two pictures in the hero of the landing page.
 *
 * `site/panel.png` is not an illustration and must not become one: it is the
 * real `bugbottle/ui` panel, mounted by `site/demo.js` from the committed
 * `dist/`, open on the real landing page with a message typed in and an
 * element pointed at. This script serves `site/` (with `/dist/` mapped to the
 * repository's own build, exactly as nginx does), drives that panel with the
 * global `puppeteer-core` and Chrome, and clips two frames out of one capture
 * at 2x:
 *
 *   site/panel.png         the panel with a slice of the page behind it, for
 *                          the wide hero, where the frame crops from the left
 *   site/panel-narrow.png  the panel alone, for the hero on a phone, where a
 *                          crop of the wide picture would leave the panel too
 *                          small to read
 *
 * and the same pair again from /da/ as `panel-da.png` and
 * `panel-da-narrow.png`, because the panel on the Danish page is in Danish
 * and a hero that is not would be a picture of a different product.
 *
 *     npm run build          # the demo runs the real dist/
 *     npm run shot:panel
 *
 * Re-run it whenever the panel's own look changes. Nothing keeps the pictures
 * in sync automatically, and a hero that shows a panel the library no longer
 * draws is worse than no hero at all.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, loadPuppeteer } from "./chrome.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const site = join(root, "site");
const chromePath = findChrome();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, "");
  // /dist/ is the library, everywhere else is the site — the same two roots
  // site/nginx.conf serves in the image.
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
const browser = await puppeteer.launch({ executablePath: chromePath, headless: "new" });

const view = { width: 1010, height: 800 };
const air = 18;
const round = (n) => Math.round(n);

/* One pair per language. The Danish page mounts the panel in Danish, so an
   English capture in its hero would be a picture of a different product; the
   message is the one from that page's own opening paragraph, so the picture
   and the sentence above it tell the same story. */
const SHOTS = [
  {
    path: "/",
    wide: "panel.png",
    narrow: "panel-narrow.png",
    message:
      "The save button does nothing. I filled the address in, pressed save, and the page just sat there.",
  },
  {
    path: "/da/",
    wide: "panel-da.png",
    narrow: "panel-da-narrow.png",
    message:
      "Gem-knappen g\u00f8r ingenting. Jeg udfyldte adressen, trykkede gem, og siden stod bare stille.",
  },
];

const made = [];

for (const shot of SHOTS) {
  const tab = await browser.newPage();
  // A viewport with room for the page behind the panel, captured at 2x so the
  // picture holds up on a dense screen. The panel is fixed to the corner.
  await tab.setViewport({ ...view, deviceScaleFactor: 2 });
  await tab.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await tab.goto(origin + shot.path, { waitUntil: "networkidle0" });
  await tab.waitForSelector("[data-bugbottle=ui]");

  /* Stand the panel over the demo section rather than over the hero. The hero
     is where this picture ends up, so capturing there photographs the previous
     copy of itself; the demo section is also the part of the page the panel
     actually belongs to, and its flat plate keeps the file small. */
  await tab.evaluate(async () => {
    document.getElementById("demo").scrollIntoView({ block: "start" });
    await new Promise((r) => setTimeout(r, 400));
  });

  /* Open it, say what went wrong, and point at something — the three things a
     reporter does. */
  await tab.evaluate(async (message) => {
    const shadow = document.querySelector("[data-bugbottle=ui]").shadowRoot;
    shadow.querySelector(".trigger").click();
    await new Promise((r) => setTimeout(r, 120));
    const field = shadow.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(field, message);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    shadow.querySelector(".pick").click();
    await new Promise((r) => setTimeout(r, 80));
    document.getElementById("demo-open").click();
    await new Promise((r) => setTimeout(r, 200));
  }, shot.message);

  /* The panel is fixed to the corner of the viewport, so its rectangle is in
     viewport coordinates — and a screenshot clip is in page coordinates. The
     page is scrolled by the time we get here, so the two differ by exactly the
     scroll offset, and forgetting it clips the top of the document instead. */
  const box = await tab.evaluate(() => {
    const shadow = document.querySelector("[data-bugbottle=ui]").shadowRoot;
    const { x, y, width, height } = shadow.querySelector(".panel").getBoundingClientRect();
    return { x: x + window.scrollX, y: y + window.scrollY, width, height, top: window.scrollY };
  });

  /* The wide picture: the panel at the right edge and about 300 points of the
     page behind it, which is what the frame on a desktop shows once it has
     cropped from the left. */
  const wide = {
    x: round(Math.max(0, box.x - 300)),
    y: round(Math.max(0, box.y - air)),
    width: 0,
    height: round(
      Math.min(box.top + view.height, box.y + box.height + 96) - Math.max(0, box.y - air),
    ),
  };
  wide.width = round(Math.min(view.width, box.x + box.width + air) - wide.x);
  await tab.screenshot({ path: join(site, shot.wide), clip: wide });

  /* The narrow picture: the panel and nothing else. */
  const narrow = {
    x: round(Math.max(0, box.x - air)),
    y: round(Math.max(0, box.y - air)),
    width: round(Math.min(view.width - Math.max(0, box.x - air), box.width + air * 2)),
    height: round(
      Math.min(box.top + view.height - Math.max(0, box.y - air), box.height + air * 2),
    ),
  };
  await tab.screenshot({ path: join(site, shot.narrow), clip: narrow });

  made.push([shot.wide, wide], [shot.narrow, narrow]);
  await tab.close();
}

await browser.close();
server.close();

for (const [name, clip] of made) {
  const { size } = await stat(join(site, name));
  // The hero is the first thing the page paints; every picture is budgeted.
  console.log(`site/${name}: ${clip.width * 2}x${clip.height * 2}, ${(size / 1024).toFixed(1)} kB`);
  if (size > 150 * 1024) {
    console.error(`site/${name} is ${(size / 1024).toFixed(1)} kB; the budget is 150 kB`);
    process.exitCode = 1;
  }
}
