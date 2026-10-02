import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseRegionPixelRatio,
  computeCropBox,
  MAX_REGION_CANVAS_PIXELS,
  normaliseDrag,
} from "../src/region.ts";

/**
 * The geometry under the area and element modes, without a DOM: which pixels
 * of a rendered page a rectangle on the page is, at every pixel ratio a
 * device has. The report field these produce is tested in
 * `tests/screenshot-region.test.ts`.
 */

/** A page rendered from `body` at the origin, 1000 x 3000 CSS pixels, at `ratio`. */
const page = (ratio: number, offset = { x: 0, y: 0 }) => ({
  x: offset.x,
  y: offset.y,
  width: 1000,
  height: 3000,
  pixelWidth: 1000 * ratio,
  pixelHeight: 3000 * ratio,
});

test("a drag is the same rectangle whichever way it went", () => {
  const down = normaliseDrag({ x: 10, y: 20 }, { x: 110, y: 70 });
  const up = normaliseDrag({ x: 110, y: 70 }, { x: 10, y: 20 });
  assert.deepEqual(down, { x: 10, y: 20, width: 100, height: 50 });
  assert.deepEqual(up, down);
});

test("a drag past the edge of the window is held inside it", () => {
  const rect = normaliseDrag({ x: -40, y: 30 }, { x: 900, y: 9000 }, { width: 800, height: 600 });
  assert.deepEqual(rect, { x: 0, y: 30, width: 800, height: 570 });
});

test("at a pixel ratio of 1 the crop is the rectangle itself", () => {
  const crop = computeCropBox({ x: 100, y: 200, width: 300, height: 150 }, page(1));
  assert.deepEqual(crop, { x: 100, y: 200, width: 300, height: 150 });
});

test("at a device pixel ratio of 2 every edge doubles", () => {
  const crop = computeCropBox({ x: 100, y: 200, width: 300, height: 150 }, page(2));
  assert.deepEqual(crop, { x: 200, y: 400, width: 600, height: 300 });
});

test("a fractional ratio rounds outwards, so no edge of the selection is lost", () => {
  const crop = computeCropBox({ x: 101, y: 33, width: 11, height: 7 }, page(1.5));
  // 151.5 -> 151 on the near edges, 168 and 60 exactly on the far ones.
  assert.deepEqual(crop, { x: 151, y: 49, width: 17, height: 11 });
});

test("the scale is read off the picture, not assumed", () => {
  // Asked for 2x, the renderer had to settle for a canvas half that size.
  const shrunk = { ...page(2), pixelWidth: 1000, pixelHeight: 3000 };
  const crop = computeCropBox({ x: 100, y: 200, width: 300, height: 150 }, shrunk);
  assert.deepEqual(crop, { x: 100, y: 200, width: 300, height: 150 });
});

test("a rendered root that does not start at the page origin is offset", () => {
  // `body` with the browser's default 8px margin.
  const crop = computeCropBox(
    { x: 108, y: 208, width: 50, height: 50 },
    page(2, { x: 8, y: 8 }),
  );
  assert.deepEqual(crop, { x: 200, y: 400, width: 100, height: 100 });
});

test("a scrolled-to region is found by its page coordinates", () => {
  // Selected 100px from the top of a viewport scrolled 1800px down.
  const crop = computeCropBox({ x: 0, y: 1900, width: 1000, height: 100 }, page(1));
  assert.deepEqual(crop, { x: 0, y: 1900, width: 1000, height: 100 });
});

test("padding widens the crop and stops at the edge of the picture", () => {
  const crop = computeCropBox({ x: 4, y: 100, width: 20, height: 20 }, page(2), 8);
  assert.deepEqual(crop, { x: 0, y: 184, width: 64, height: 72 });
  const corner = computeCropBox({ x: 990, y: 2990, width: 50, height: 50 }, page(1), 8);
  assert.deepEqual(corner, { x: 982, y: 2982, width: 18, height: 18 });
});

test("a region outside the picture, or a picture with no size, crops to nothing", () => {
  assert.equal(computeCropBox({ x: 2000, y: 0, width: 10, height: 10 }, page(1)), null);
  assert.equal(computeCropBox({ x: 0, y: -50, width: 10, height: 10 }, page(1)), null);
  assert.equal(
    computeCropBox({ x: 0, y: 0, width: 10, height: 10 }, { ...page(1), width: 0 }),
    null,
  );
  assert.equal(
    computeCropBox({ x: 0, y: 0, width: 10, height: 10 }, { ...page(1), width: Number.NaN }),
    null,
  );
});

test("the render scale follows the device until the canvas would be refused", () => {
  assert.equal(chooseRegionPixelRatio(1280, 2000, 2), 2);
  assert.equal(chooseRegionPixelRatio(1280, 2000, 1.5), 1.5);
  // A phone at 3x on a long page: lowered until it fits.
  const ratio = chooseRegionPixelRatio(390, 20000, 3);
  assert.ok(ratio < 3);
  assert.ok(390 * 20000 * ratio * ratio <= MAX_REGION_CANVAS_PIXELS + 1);
});

test("a nonsense device pixel ratio is read as 1, and a huge one is capped at 3", () => {
  assert.equal(chooseRegionPixelRatio(100, 100, Number.NaN), 1);
  assert.equal(chooseRegionPixelRatio(100, 100, 0), 1);
  assert.equal(chooseRegionPixelRatio(100, 100, 8), 3);
  assert.equal(chooseRegionPixelRatio(0, 0, 2), 2, "an unknown size keeps the device's ratio");
  assert.ok(chooseRegionPixelRatio(1e6, 1e6, 2) >= 0.1, "never zero, however large the page");
});

