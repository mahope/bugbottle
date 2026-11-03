/** Real region PNG pixels. Run after npm run build; --shift-crop must fail. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import { findChrome, loadPuppeteer } from "./chrome.mjs";

const shifted = process.argv.includes("--shift-crop");
const bundle = await build({
  stdin: {
    contents: `import { captureArea, captureElement } from './dist/region.js';
import { htmlToImage } from './dist/html-to-image.js';
window.start = (mode, mask) => { window.pending = (mode === 'area' ? captureArea : captureElement)(htmlToImage, { padding: 0, mask }); };
window.ready = true;`,
    resolveDir: process.cwd(),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
  plugins: shifted ? [{
    name: "shift-crop",
    setup(builder) {
      builder.onLoad({ filter: /dist\/region\.js$/ }, async ({ path }) => {
        const contents = await readFile(path, "utf8");
        const original = "ctx.drawImage(img, crop.x, crop.y,";
        assert.ok(contents.includes(original), "crop mutation must match the built implementation");
        return { contents: contents.replace(original, "ctx.drawImage(img, crop.x + 24, crop.y,"), loader: "js" };
      });
    },
  }] : [],
});
const html = `<!doctype html><meta charset="utf-8"><title>Region pixels</title>
<style>
* { box-sizing: border-box } body { margin:0; width:800px; height:1600px; background:#123456 }
#target { position:absolute; left:120px; top:900px; width:200px; height:160px; background:#e02030 }
#stripe { position:absolute; left:80px; top:0; width:40px; height:160px; background:#20c060 }
input { position:absolute; left:10px; top:90px; width:180px; height:50px; border:0; padding:0; border-radius:0; background:white; color:black; font:28px monospace }
</style><div id="target"><div id="stripe"></div><input value="MMMMMMMM"></div>
<script type="module" src="/smoke.js"></script>`;
let browser;
const server = createServer((req, res) => {
  if (req.url === "/") res.writeHead(200, { "Content-Type": "text/html" }).end(html);
  else if (req.url === "/smoke.js") res.writeHead(200, { "Content-Type": "text/javascript" }).end(bundle.outputFiles[0].text);
  else res.writeHead(404).end();
});

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  browser = await loadPuppeteer().launch({
    executablePath: findChrome(), headless: "new", timeout: 10_000, protocolTimeout: 15_000,
  });
  for (const dpr of [1, 2]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: dpr });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => window.scrollTo(0, 700));
    assert.equal(await page.evaluate(() => window.scrollY), 700);

    async function capture(mode, mask) {
      await page.evaluate((mode, mask) => window.start(mode, mask), mode, mask);
      await page.waitForSelector('[data-bugbottle="region"]');
      if (mode === "area") {
        await page.mouse.move(120, 200);
        await page.mouse.down();
        await page.mouse.move(320, 360, { steps: 4 });
        await page.mouse.up();
      } else await page.mouse.click(130, 210);
      return page.evaluate(async () => {
        const shot = await window.pending;
        const image = new Image();
        image.src = shot.dataUrl;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return { ...shot, dataUrl: undefined, width: canvas.width, height: canvas.height,
          pixels: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data) };
      });
    }
    function check(shot, mode) {
      assert.equal(shot.width, 200 * dpr);
      assert.equal(shot.height, 160 * dpr);
      assert.deepEqual(shot.region.rect, { x: 120, y: 900, width: 200, height: 160 });
      assert.deepEqual(shot.region.viewport, { x: 120, y: 200, width: 200, height: 160 });
      assert.equal(shot.region.mode, mode);
      for (const [x, colour] of [[10, [224, 32, 48, 255]], [110, [32, 192, 96, 255]], [130, [224, 32, 48, 255]]]) {
        const offset = ((20 * dpr) * shot.width + x * dpr) * 4;
        assert.deepEqual(shot.pixels.slice(offset, offset + 4), colour, `${mode} DPR ${dpr}: interior pixel x=${x}`);
      }
    }
    const area = await capture("area");
    check(area, "area");
    const element = await capture("element");
    check(element, "element");
    assert.equal(element.region.selector, "div#target");
    assert.equal(element.element.selector, element.region.selector);
    assert.deepEqual(element.element.rect, element.region.rect);
    assert.deepEqual(element.pixels, area.pixels);
    await page.evaluate(() => { document.querySelector("input").value = "WWWWWWWW"; });
    const masked = await capture("area");
    assert.deepEqual(masked.pixels, area.pixels, "different input content must produce identical masked pixels");
    assert.equal(await page.$eval("input", input => input.value), "WWWWWWWW");
    // Positive control: the input is visible to the real renderer, and our
    // pixel comparison detects its content when masking is disabled.
    const unmasked = await capture("area", false);
    assert.notDeepEqual(unmasked.pixels, masked.pixels, "masking must change rendered input pixels");
    for (const mode of ["area", "element"]) {
      await page.evaluate(mode => window.start(mode), mode);
      await page.waitForSelector('[data-bugbottle="region"]');
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => window.pending), null);
      assert.equal(await page.$('[data-bugbottle="region"]'), null);
    }
    await page.close();
    console.log(`region DPR ${dpr}: scrolled area, element metadata, masked pixels and cancellation passed`);
  }
} finally {
  try { await browser?.close(); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
