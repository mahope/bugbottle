import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_REGION_COORDINATE, normaliseScreenshotRegion } from "../src/report-core.ts";
import { buildReport } from "../src/send.ts";
import { toMarkdown } from "../src/markdown.ts";
import { scrubReport } from "../src/scrub.ts";
import { handleReport, validateReport, type ValidatedReport } from "../src/server/handle.ts";
import { PNG_DATA_URL } from "./report-fixtures.ts";

/**
 * `screenshotRegion`, the part of the page a picture shows: what the browser
 * sends, what the server keeps, and when it is dropped with its picture.
 */

const region = {
  mode: "element",
  rect: { x: 10, y: 1900, width: 200, height: 40 },
  viewport: { x: 10, y: 100, width: 200, height: 40 },
  selector: 'button[aria-label="Save"]',
};

test("a region from the browser survives validation as it was sent", () => {
  assert.deepEqual(normaliseScreenshotRegion(region), region);
  assert.deepEqual(normaliseScreenshotRegion({ ...region, annotated: true }), {
    ...region,
    annotated: true,
  });
});

test("a malformed region is no region, and never a thrown report", () => {
  for (const raw of [
    null,
    "area",
    [],
    { ...region, mode: "page" },
    { ...region, mode: "screen" },
    { ...region, rect: null },
    { ...region, rect: { x: 0, y: 0, width: 0, height: 10 } },
    { ...region, rect: { x: "1", y: 0, width: 10, height: 10 } },
    { ...region, rect: { x: 0, y: 0, width: Number.NaN, height: 10 } },
  ]) {
    assert.equal(normaliseScreenshotRegion(raw), null, JSON.stringify(raw));
  }
});

test("a region's numbers are rounded and bounded, its strings stripped and clipped", () => {
  const nul = String.fromCharCode(0);
  const out = normaliseScreenshotRegion({
    mode: "area",
    rect: { x: 1e300, y: -1e300, width: 12.6, height: 1e9 },
    viewport: "nonsense",
    annotated: "yes",
    selector: `div${nul}`.padEnd(2000, "x"),
    extra: "dropped",
  });
  assert.deepEqual(out?.rect, {
    x: MAX_REGION_COORDINATE,
    y: -MAX_REGION_COORDINATE,
    width: 13,
    height: MAX_REGION_COORDINATE,
  });
  assert.deepEqual(out?.viewport, out?.rect, "a viewport that did not survive is the page one");
  assert.equal(out?.annotated, undefined, "only a real true is true");
  assert.equal(out?.selector?.length, 500);
  assert.ok(!out?.selector?.includes(nul));
  assert.ok(!("extra" in (out ?? {})));
});

test("buildReport sends the region beside a picture and never without one", () => {
  const withPicture = buildReport({
    type: "bug",
    message: "The total is wrong",
    screenshotDataUrl: "data:image/png;base64,AAAA",
    screenshotRegion: normaliseScreenshotRegion(region),
    includeConsole: false,
  });
  assert.equal(withPicture.screenshotRegion?.mode, "element");
  const without = buildReport({
    type: "bug",
    message: "The total is wrong",
    screenshotRegion: normaliseScreenshotRegion(region),
    includeConsole: false,
  });
  assert.equal("screenshotRegion" in without, false);
});

test("the server keeps a valid region and leaves an absent one absent", () => {
  const kept = validateReport({ message: "x", screenshotRegion: region });
  assert.equal(kept?.screenshotRegion?.selector, region.selector);
  assert.equal(kept?.extra.screenshotRegion, undefined, "a known key never lands in extra");
  const none = validateReport({ message: "x" });
  assert.equal(none && "screenshotRegion" in none, false, "a 1.0 report validates as it did");
});

test("the Markdown names the region in one line", () => {
  const md = toMarkdown({
    type: "bug",
    message: "The total is wrong",
    screenshotDataUrl: "data:image/png;base64,AAAA",
    screenshotRegion: { ...region, annotated: true },
  });
  assert.match(
    md,
    /\| Screenshot region \| element, 200×40 at 10, 1900 \(outlined on the whole page\) — `button\[aria-label="Save"\]` \|/,
  );
});

test("a region outlives its picture nowhere: a dropped or broken screenshot takes it along", async () => {
  const stored: ValidatedReport[] = [];
  const send = (body: unknown, screenshot?: "drop") =>
    handleReport(
      new Request("https://app.example.com/api/bug-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      {
        screenshot,
        store: async (report) => {
          stored.push(report);
          return { id: String(stored.length) };
        },
      },
    );
  await send({ message: "kept", screenshotDataUrl: PNG_DATA_URL, screenshotRegion: region });
  await send({ message: "dropped", screenshotDataUrl: PNG_DATA_URL, screenshotRegion: region }, "drop");
  await send({ message: "broken", screenshotDataUrl: "data:image/png;base64,AAAA", screenshotRegion: region });
  await send({ message: "alone", screenshotRegion: region });
  assert.deepEqual(
    stored.map((r) => [r.message, r.screenshotRegion?.mode ?? null]),
    [["kept", "element"], ["dropped", null], ["broken", null], ["alone", null]],
  );
});

test("the scrubber reaches a selector, which can carry an aria-label since 1.1", () => {
  const label = 'button[aria-label="Delete jane@example.com"]';
  const out = scrubReport({
    type: "bug",
    message: "x",
    context: { url: "/", viewport: "", userAgent: "" },
    elements: [{ selector: label, tag: "button", text: "", rect: region.rect, attributes: {} }],
    screenshotRegion: { ...region, selector: label },
  });
  assert.ok(!JSON.stringify(out).includes("jane@example.com"));
});

test("a backtick in a selector cannot close the Markdown code span", () => {
  const md = toMarkdown({
    message: "x",
    screenshotDataUrl: "data:image/png;base64,AAAA",
    screenshotRegion: { ...region, selector: "a[aria-label=\"`x`\"]" },
  });
  assert.match(md, /`a\[aria-label="'x'"\]`/);
});
