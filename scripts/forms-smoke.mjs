import assert from 'node:assert/strict';
import { createFormExample } from '../examples/forms/server.mjs';
import { findChrome, loadPuppeteer } from './chrome.mjs';

let browser;
try {
  browser = await loadPuppeteer().launch({ executablePath: findChrome(), headless: true });
  for (const framework of ['vue', 'svelte']) {
    const example = await createFormExample(framework);
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(example.url);
      for (const round of [1, 2]) {
        await page.waitForSelector('textarea');
        await page.type('textarea', `Synthetic report ${round}`);
        await page.type('input[name="contact"]', `smoke${round}@example.invalid`);
        await page.click('button[type="submit"]');
        await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('report-'));
        assert.equal(example.reports.length, round);
        const report = example.reports[round - 1];
        assert.equal(report.message, `Synthetic report ${round}`);
        assert.equal(report.contact, `smoke${round}@example.invalid`);
        assert.equal(report.screenshotDataUrl, undefined);
        assert.equal(report.context.url, '/');
        await page.click('#unmount');
        await page.waitForFunction(() => !document.querySelector('form'));
        assert.equal(await page.evaluate(() => window.probeDisposed()), true);
        if (round === 1) await page.click('#mount');
      }
      assert.equal(example.reports.length, 2);
      assert.deepEqual(errors, []);
      console.log(`PASS: compiled ${framework} packed consumer submits, disposes and remounts`);
    } finally {
      await page.close();
      await example.close();
    }
  }
} finally {
  await browser?.close();
}
