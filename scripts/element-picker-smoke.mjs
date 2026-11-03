import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { findChrome, loadPuppeteer } from "./chrome.mjs";

const bundle = await build({
  stdin: { contents: `
    import { mountBugbottle } from "./src/ui/index.ts";
    import { pickElement } from "./src/element-picker.ts";
    window.bb = mountBugbottle({ endpoint: "/reports", fetch: async (_, init) => {
      window.report = JSON.parse(init.body);
      return new Response('{}', { status: 201 });
    }});
    window.start = (options = {}) => {
      window.controller = new AbortController();
      window.result = undefined;
      window.pending = pickElement({ ...options, signal: controller.signal,
        onHover: el => window.selected = el?.id ?? null }).then(value => window.result = value);
    };
    window.ready = true;
  `, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "esm", write: false,
});
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Picker</title>
<style>img{width:80px;height:60px} main{padding:20px}</style>
<main id="content"><h1 id="heading">Orders</h1>
<img id="image" alt="Order diagram" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='60'%3E%3Crect width='80' height='60' fill='blue'/%3E%3C/svg%3E">
<h2 hidden id="hidden">Hidden</h2><div inert><h2 id="inert">Inert</h2></div>
<form onsubmit="event.preventDefault();window.submits++"><button id="submit">Submit</button></form>
<a id="link" href="#activated" onclick="window.clicks++">Link</a>
<button id="button" onclick="window.clicks++">Button</button></main>
<script>window.clicks=0;window.submits=0;</script><script type="module" src="/test.js"></script></html>`;
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": req.url === "/test.js" ? "text/javascript" : "text/html" });
  res.end(req.url === "/test.js" ? bundle.outputFiles[0].text : html);
});
let browser;
try {
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  browser = await loadPuppeteer().launch({ executablePath: findChrome(), headless: "new" });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.ready);
  const shadow = selector => page.evaluate(selector =>
    document.querySelector('[data-bugbottle="ui"]').shadowRoot.querySelector(selector)?.textContent, selector);
  const focusPick = () => page.evaluate(() => {
    document.querySelector('[data-bugbottle="ui"]').shadowRoot.querySelector('.pick').focus();
  });
  const select = async id => {
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("ArrowDown");
      const selected = await page.evaluate(() => {
        const box = document.querySelector('[data-bugbottle="highlight"]');
        if (!box || box.style.display === "none") return null;
        return [...document.querySelectorAll('main,main *')].find(el => {
          const r = el.getBoundingClientRect();
          return box.style.left === `${r.left}px` && box.style.top === `${r.top}px`
            && box.style.width === `${r.width}px` && box.style.height === `${r.height}px`;
        })?.id;
      });
      if (selected === id) return;
    }
    assert.fail(`keyboard did not visibly select ${id}`);
  };
  await page.evaluate(() => window.bb.open());
  await page.screenshot({ path: "/tmp/bugbottle-picker-before.png" });
  for (const id of ["heading", "image"]) {
    await focusPick();
    await page.keyboard.press("Enter");
    await select(id);
    assert.match(await page.$eval('[data-bugbottle="picker"]', el => el.textContent),
      id === "heading" ? /Orders/ : /Order diagram/);
    await page.screenshot({ path: `/tmp/bugbottle-picker-${id}.png` });
    await page.keyboard.press("Enter");
    assert.match(await shadow("ul"), new RegExp(`#${id}`));
    assert.equal(await page.evaluate(() => document.querySelector('[data-bugbottle="ui"]').shadowRoot.activeElement?.className), "pick");
  }
  await page.evaluate(() => {
    const root = document.querySelector('[data-bugbottle="ui"]').shadowRoot;
    root.querySelector('textarea').value = 'Keyboard targets';
    root.querySelector('textarea').dispatchEvent(new Event('input'));
    root.querySelector('.send').click();
  });
  await page.waitForFunction(() => window.report);
  assert.deepEqual(await page.evaluate(() => window.report.elements.map(el => [el.selector, el.tag])),
    [["h1#heading", "h1"], ["img#image", "img"]]);
  await page.evaluate(() => { window.bb.close(); window.bb.open(); });
  await focusPick();
  await page.keyboard.press("Space");
  await select("image");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.querySelector('[data-bugbottle="ui"]').shadowRoot.activeElement?.className), "pick");
  assert.equal(await page.$('[data-bugbottle="picker"]'), null);
  await page.evaluate(() => window.bb.close());
  for (const [id, key] of [["submit", "Enter"], ["link", "Enter"], ["button", "Space"]]) {
    await page.evaluate(() => window.start());
    await select(id);
    await page.keyboard.press(key);
    await page.waitForFunction(() => window.result !== undefined);
    assert.equal(await page.evaluate(() => window.result.attributes.id), id);
  }
  assert.deepEqual(await page.evaluate(() => [window.clicks, window.submits, location.hash]), [0, 0, ""]);
  await page.evaluate(() => window.start());
  await page.keyboard.press("Home");
  assert.equal(await page.evaluate(() => window.selected), "content");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => window.selected), "heading");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => window.selected), "content");
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => window.selected), "button");
  await page.evaluate(() => window.controller.abort());
  assert.equal(await page.evaluate(() => window.result), null);
  assert.equal(await page.$('[data-bugbottle="highlight"]'), null);
  assert.equal(await page.$('[data-bugbottle="picker"]'), null);
  assert.equal(await page.$eval('#heading', el => el.hasAttribute('tabindex')), false);
  await page.click('#button');
  assert.equal(await page.evaluate(() => window.clicks), 1, "host events work after abort");
  await page.evaluate(() => window.start());
  await page.hover('#heading');
  await page.click('#heading');
  await page.waitForFunction(() => window.result !== undefined);
  assert.equal(await page.evaluate(() => window.result.selector), "h1#heading");
  console.log("Element picker: keyboard panel attachments, announcements, cancellation, abort, host isolation and pointer selection passed");
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
