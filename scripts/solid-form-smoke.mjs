import assert from 'node:assert/strict';

export async function checkSolidForm(page, example) {
  const status = () => page.$eval('[role="status"]', el => el.textContent);
  const fill = async (message) => {
    await page.type('textarea', message);
    await page.type('input[name="contact"]', '  solid@example.invalid  ');
    assert.equal(await page.$eval('#message-value', el => el.textContent), message);
    assert.equal(await page.$eval('#contact-value', el => el.textContent), '  solid@example.invalid  ');
  };
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('form').dataset.state === 'error');
  assert.ok((await status()).length);
  assert.equal(example.reports.length, 0);
  await fill('  Synthetic Solid report  ');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('form').dataset.state === 'sending');
  assert.equal(await page.$eval('button[type="submit"]', el => el.disabled), true);
  await page.evaluate(() => window.rejectSubmission());
  await page.waitForFunction(() => document.querySelector('form').dataset.state === 'error');
  assert.match(await status(), /Synthetic send failure/);
  assert.equal(example.reports.length, 0);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('form').dataset.state === 'sending');
  await page.evaluate(() => window.releaseSubmission());
  await page.waitForFunction(() => document.querySelector('form').dataset.state === 'sent');
  assert.match(await status(), /report-1/);
  assert.equal(example.reports.length, 1);
  assert.equal(example.reports[0].message, 'Synthetic Solid report');
  assert.equal(example.reports[0].contact, 'solid@example.invalid');
  assert.equal(example.reports[0].context.url, '/');
  assert.equal(example.screenshots[0], undefined);

  await fill('Pending old owner');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('form').dataset.state === 'sending');
  await page.click('#unmount');
  await page.waitForFunction(() => !document.querySelector('form'));
  await page.click('#mount');
  await page.waitForSelector('form');
  // Disposal does not cancel an already-started send. Complete it after the
  // replacement exists and check that only the old request reaches storage.
  assert.equal(await page.evaluate(async () => window.finishDisposed()), true);
  assert.equal(example.reports.length, 2);
  assert.equal(await page.$eval('form', el => el.dataset.state), 'idle');
  await fill('Replacement owner');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('form').dataset.state === 'sending');
  await page.evaluate(() => window.releaseSubmission());
  await page.waitForFunction(() => document.querySelector('form').dataset.state === 'sent');
  assert.match(await status(), /report-3/);
  assert.deepEqual(example.reports.map(report => report.message), ['Synthetic Solid report', 'Pending old owner', 'Replacement owner']);
  await page.click('#unmount');
  await page.waitForFunction(() => !document.querySelector('form'));
  assert.equal(await page.evaluate(async () => window.finishDisposed()), true);
}
