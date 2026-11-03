/** Real IndexedDB persistence and cross-tab claims. Run after npm run build. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { findChrome, loadPuppeteer } from "./chrome.mjs";

const databaseName = `bugbottle-smoke-${randomUUID()}`;
const deliveries = [];
const diagnostics = [];
let browser;
let context;
let phase = "start server";
const pageHtml = `<!doctype html><title>IndexedDB queue smoke</title>
<script type="module">
import { createQueue } from '/dist/queue.js';
import { createIdbStorage } from '/dist/queue-idb.js';
const databaseName = new URL(location.href).searchParams.get('database');
window.storage = createIdbStorage({ databaseName });
window.readQueue = () => storage.update(items => items);
let allowSend;
const sending = new Promise(resolve => { allowSend = resolve; });
window.allowSend = allowSend;
window.queue = createQueue({
  endpoint: '/reports', storage,
  fetch: async (...args) => { await sending; return fetch(...args); },
});
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 32;
canvas.getContext('2d').fillRect(0, 0, 32, 32);
window.screenshot = canvas.toDataURL('image/png');
window.enqueue = message => queue.enqueue({
  message, screenshotDataUrl: screenshot, timestamp: new Date().toISOString(),
  context: { url: location.origin, userAgent: 'queue-smoke', viewport: { width: 32, height: 32 } },
  console: [],
});
window.ready = true;
</script>`;

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/reports") {
      let body = "";
      for await (const chunk of req) body += chunk;
      deliveries.push(JSON.parse(body));
      // Keep the request in flight while the other tab tries to claim it.
      await new Promise(resolve => setTimeout(resolve, 100));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"id":"accepted"}');
    } else if (req.url === "/cleanup") {
      res.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><title>Cleanup</title>');
    } else if (req.url === "/favicon.ico") {
      res.writeHead(204).end();
    } else if (req.url?.startsWith("/?")) {
      res.writeHead(200, { "Content-Type": "text/html" }).end(pageHtml);
    } else if (["/dist/queue.js", "/dist/queue-idb.js"].includes(req.url)) {
      const body = await readFile(new URL(`..${req.url}`, import.meta.url));
      res.writeHead(200, { "Content-Type": "text/javascript" }).end(body);
    } else res.writeHead(404).end();
  } catch (error) {
    diagnostics.push(`server: ${error.message}`);
    res.writeHead(500).end();
  }
});

async function run() {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/?database=${databaseName}`;
  phase = "launch Chrome";
  browser = await loadPuppeteer().launch({
    executablePath: findChrome(), headless: "new", timeout: 10_000, protocolTimeout: 10_000,
  });
  context = await browser.createBrowserContext();
  async function openPage() {
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", error => diagnostics.push(`pageerror: ${error.message}`));
    page.on("console", message => {
      if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
    });
    await page.goto(url);
    await page.waitForFunction(() => window.ready === true);
    return page;
  }
  async function stored(page, messages) {
    try {
      await page.waitForFunction(async expected => {
        const rows = await window.readQueue();
        return JSON.stringify(rows.map(row => row.body.message).sort()) === JSON.stringify(expected);
      }, {}, [...messages].sort());
    } catch (error) {
      diagnostics.push({ expectedMessages: messages, stored: await page.evaluate(async () =>
        (await readQueue()).map(row => ({ id: row.id, message: row.body.message, screenshotBytes: row.body.screenshotDataUrl?.length ?? 0 }))),
      });
      throw error;
    }
    return page.evaluate(() => window.readQueue());
  }

  phase = "persist screenshot before closing page";
  let first = await openPage();
  await first.evaluate(() => queue.flush());
  const screenshot = await first.evaluate(() => { enqueue('persisted'); return window.screenshot; });
  const before = await stored(first, ["persisted"]);
  assert.equal(before[0].body.screenshotDataUrl, screenshot);
  await first.evaluate(() => queue.destroy());
  await first.close();

  phase = "reopen page and recover screenshot from IndexedDB";
  first = await openPage();
  const after = await stored(first, ["persisted"]);
  assert.equal(after[0].id, before[0].id);
  assert.equal(after[0].at, before[0].at);
  assert.deepEqual(after[0].body, before[0].body);
  console.log("PASS: report and PNG survive closing and reopening a page");

  phase = "enqueue concurrently from two pages";
  const second = await openPage();
  await Promise.all([
    first.evaluate(() => enqueue('tab-one')),
    second.evaluate(() => enqueue('tab-two')),
  ]);
  const rows = await stored(first, ["persisted", "tab-one", "tab-two"]);
  assert.equal(new Set(rows.map(row => row.id)).size, 3);
  for (const row of rows) assert.equal(row.body.screenshotDataUrl, screenshot);
  console.log("PASS: concurrent enqueues retain both reports in IndexedDB");

  phase = "flush concurrently from two pages";
  await Promise.all([first, second].map(page => page.evaluate(async () => {
    allowSend();
    await queue.flush();
  })));
  await stored(first, []);
  assert.deepEqual(deliveries.map(report => report.message).sort(), ["persisted", "tab-one", "tab-two"]);
  for (const report of deliveries) assert.equal(report.screenshotDataUrl, screenshot);
  // Flush again from each page: neither stale in-memory copy may resurrect a report.
  await Promise.all([first, second].map(page => page.evaluate(() => queue.flush())));
  assert.equal(deliveries.length, 3);
  assert.deepEqual(diagnostics, []);
  console.log("PASS: concurrent flushes deliver each report once and drain IndexedDB");
}

async function cleanup() {
  if (context) {
    // Close writers even after a failed assertion; their connections must not block deletion.
    for (const page of await context.pages()) await page.close();
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(10_000);
    await page.goto(`http://127.0.0.1:${server.address().port}/cleanup`);
    await page.evaluate(async name => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('database cleanup blocked'));
      });
      if ((await indexedDB.databases()).some(db => db.name === name)) throw new Error('database still exists after cleanup');
    }, databaseName);
    await context.close();
    console.log("PASS: pages closed and isolated database deleted");
  }
}

// The in-process deadline enters the same cleanup path as an assertion failure.
let deadline;
try {
  await Promise.race([
    run(),
    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('60s deadline exceeded')), 60_000); }),
  ]);
} catch (error) {
  console.error(`FAIL during ${phase}:`, error);
  console.error(JSON.stringify({ databaseName, deliveries: deliveries.map(report => report.message), diagnostics }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  try { await cleanup(); }
  catch (error) { console.error('Cleanup failed:', error); process.exitCode = 1; }
  finally {
    try { await browser?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
}
