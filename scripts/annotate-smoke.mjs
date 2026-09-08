/**
 * The smoke test of the annotator, in a browser that actually has a canvas.
 *
 * `node:test` has no 2D context, so `tests/annotate.test.ts` can only prove
 * which drawing calls a drag makes. The claim that matters is about pixels:
 * a blur must destroy the pixels it covers — that is what makes it a privacy
 * control rather than a sticker — and it must leave everything else exactly as
 * it was. That can only be checked by exporting the PNG and reading it back.
 *
 * This serves `dist/` on a scratch page, paints a noisy picture so that any
 * unchanged region is recognisable, drags a blur across part of it with real
 * pointer events, exports, and compares the decoded pixels of the export with
 * the decoded pixels of the original:
 *
 *   - every whole block inside the blurred region is one flat colour,
 *   - the region really changed (a no-op would otherwise pass the first test),
 *   - and every pixel outside it is byte-for-byte what it was.
 *
 * A rectangle is drawn as well, to prove the two tools coexist and that the
 * stroke lands inside the picture rather than on some scaled version of it.
 *
 *     npm run build
 *     node scripts/annotate-smoke.mjs
 *
 * Chrome and `puppeteer-core` are both found by `scripts/chrome.mjs`:
 * CHROME_BIN or CHROME_PATH, then the usual Linux, macOS and Windows
 * locations, and puppeteer-core from this repository or the global root. The same procedure as `scripts/a11y-audit.mjs`.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, loadPuppeteer } from "./chrome.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const chromePath = findChrome();

const TYPES = { ".js": "text/javascript", ".json": "application/json", ".map": "application/json" };

/** The picture and the region the blur will cover, in the picture's own pixels. */
const WIDTH = 240;
const HEIGHT = 180;
const BLOCK = 12;
const REGION = { x: 48, y: 48, w: 96, h: 96 };

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>bugbottle annotate smoke</title></head>
<body>
<canvas id="shot" width="${WIDTH}" height="${HEIGHT}"></canvas>
<script type="module">
  import { createAnnotator } from "/dist/annotate.js";
  window.createAnnotator = createAnnotator;
  window.ready = true;
</script>
</body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE);
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
const browser = await puppeteer.launch({ executablePath: chromePath, headless: "new" });
const tab = await browser.newPage();
await tab.goto(origin, { waitUntil: "networkidle0" });
await tab.waitForFunction(() => window.ready === true);

/**
 * Paints the noisy source picture, sets the annotator on a second canvas, and
 * hands back the geometry the drags need in client coordinates.
 */
const setup = await tab.evaluate(
  async (width, height) => {
    const source = document.getElementById("shot");
    const sctx = source.getContext("2d");
    const noise = sctx.createImageData(width, height);
    // A deterministic pattern rather than random values: every pixel differs
    // from its neighbours, so a flat block is unmistakably the blur's doing,
    // and a rerun compares against the same picture.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        noise.data[p] = (x * 7 + y * 13) % 256;
        noise.data[p + 1] = (x * 31 + y * 3) % 256;
        noise.data[p + 2] = (x * 17 + y * 29) % 256;
        noise.data[p + 3] = 255;
      }
    }
    sctx.putImageData(noise, 0, 0);
    const original = source.toDataURL("image/png");

    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const annotator = window.createAnnotator(canvas, original);
    await annotator.ready;
    // One CSS pixel per picture pixel, so a client coordinate is a pixel and
    // the drag lands where this script says it does.
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    window.annotator = annotator;
    window.original = original;
    const box = canvas.getBoundingClientRect();
    return { left: box.left, top: box.top, width: canvas.width, height: canvas.height };
  },
  WIDTH,
  HEIGHT,
);

if (setup.width !== WIDTH || setup.height !== HEIGHT) {
  throw new Error(`the canvas took ${setup.width}x${setup.height}, not ${WIDTH}x${HEIGHT}`);
}

/** A real pointer drag, through Chrome's input pipeline rather than a synthetic event. */
async function drag(x1, y1, x2, y2) {
  await tab.mouse.move(setup.left + x1, setup.top + y1);
  await tab.mouse.down();
  await tab.mouse.move(setup.left + (x1 + x2) / 2, setup.top + (y1 + y2) / 2);
  await tab.mouse.move(setup.left + x2, setup.top + y2);
  await tab.mouse.up();
}

await tab.evaluate(() => window.annotator.setTool("blur"));
await drag(REGION.x, REGION.y, REGION.x + REGION.w, REGION.y + REGION.h);
await tab.evaluate(() => window.annotator.setTool("rect"));
await drag(8, 8, 40, 40);

const marks = await tab.evaluate(() => window.annotator.count());
if (marks !== 2) throw new Error(`expected two marks, got ${marks}`);

/** Decodes both PNGs and compares them pixel by pixel. */
const result = await tab.evaluate(
  async (region, block) => {
    const decode = async (url) => {
      const image = new Image();
      await new Promise((done, fail) => {
        image.onload = done;
        image.onerror = fail;
        image.src = url;
      });
      const scratch = document.createElement("canvas");
      scratch.width = image.naturalWidth;
      scratch.height = image.naturalHeight;
      const c = scratch.getContext("2d");
      c.drawImage(image, 0, 0);
      return c.getImageData(0, 0, scratch.width, scratch.height);
    };

    const before = await decode(window.original);
    const after = await decode(window.annotator.toDataUrl());
    if (before.width !== after.width || before.height !== after.height) {
      return { error: "the export changed the size of the picture" };
    }

    const width = before.width;
    const inRegion = (x, y) =>
      x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h;
    const at = (data, x, y) => {
      const p = (y * width + x) * 4;
      return [data[p], data[p + 1], data[p + 2], data[p + 3]];
    };

    // Every whole block inside the region is one colour, and no block is the
    // colour the original had there — the pixels are gone, not merely tinted.
    let blocks = 0;
    let ragged = 0;
    let unchanged = 0;
    for (let by = region.y; by + block <= region.y + region.h; by += block) {
      for (let bx = region.x; bx + block <= region.x + region.w; bx += block) {
        blocks++;
        const first = at(after.data, bx, by).join();
        let flat = true;
        let same = true;
        for (let y = by; y < by + block; y++) {
          for (let x = bx; x < bx + block; x++) {
            if (at(after.data, x, y).join() !== first) flat = false;
            if (at(after.data, x, y).join() !== at(before.data, x, y).join()) same = false;
          }
        }
        if (!flat) ragged++;
        if (same) unchanged++;
      }
    }

    // Outside the blur, only the pixels the rectangle was stroked over may
    // differ, and that rectangle is nowhere near the region.
    let outsideChanged = 0;
    let strokeChanged = 0;
    for (let y = 0; y < before.height; y++) {
      for (let x = 0; x < width; x++) {
        if (inRegion(x, y)) continue;
        if (at(after.data, x, y).join() === at(before.data, x, y).join()) continue;
        if (x <= 44 && y <= 44) strokeChanged++;
        else outsideChanged++;
      }
    }
    return { blocks, ragged, unchanged, outsideChanged, strokeChanged };
  },
  REGION,
  BLOCK,
);

await browser.close();
server.close();

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

const failures = [];
console.log(`blur region: ${result.blocks} whole ${BLOCK}px blocks checked`);
console.log(`  ragged blocks (not one flat colour): ${result.ragged}`);
console.log(`  blocks the blur left as they were:   ${result.unchanged}`);
console.log(`outside the region: ${result.outsideChanged} pixels changed`);
console.log(`  under the rectangle stroke:          ${result.strokeChanged} pixels changed`);

if (result.blocks < 4) failures.push("the region was too small to have been blurred at all");
if (result.ragged > 0) failures.push(`${result.ragged} blocks are not a flat colour`);
if (result.unchanged > 0) failures.push(`${result.unchanged} blocks still carry the original pixels`);
if (result.outsideChanged > 0) {
  failures.push(`${result.outsideChanged} pixels outside the region and the stroke changed`);
}
if (result.strokeChanged < 1) failures.push("the rectangle was not drawn");

if (failures.length) {
  for (const line of failures) console.error(line);
  process.exit(1);
}
console.log("the blur destroyed its region and left the rest of the picture alone");
