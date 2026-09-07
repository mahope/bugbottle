import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  captureScreenshot,
  DEFAULT_BYTES_PER_PIXEL_ESTIMATE,
  ScreenshotTooLargeError,
  type CaptureInfo,
  type CaptureOptions,
} from "../src/capture.ts";

/**
 * `captureScreenshot` needs two things from a browser: a `document` to prove it
 * is in one, and a root with a size. Neither has to be real. The environment
 * check only looks for the global, and the estimate only reads `scrollWidth`
 * and `scrollHeight` off the root — so a bare object stands in for both, and no
 * DOM implementation is loaded here. The renderer is faked too: these tests are
 * about which scale gets asked for, not about rasterising anything.
 */
const globals = globalThis as unknown as Record<string, unknown>;
globals.document = {};

// One test removes the global to check the environment guard; put it back so
// the order of the tests never matters, and take it away again at the end.
afterEach(() => {
  globals.document = {};
});

after(() => {
  delete globals.document;
});

/** A root of the given CSS size, which is all the estimate reads. */
const fakeRoot = (width: number, height: number) =>
  ({ scrollWidth: width, scrollHeight: height }) as unknown as HTMLElement;

/**
 * A renderer that records the scales it was asked for and returns a data URL
 * of `length(pixelRatio)` characters, so a test can decide what "too large"
 * means per scale.
 */
function fakeRenderer(length: (pixelRatio: number) => number) {
  const scales: number[] = [];
  const render = async (_root: HTMLElement, options: { pixelRatio: number }) => {
    scales.push(options.pixelRatio);
    return "d".repeat(length(options.pixelRatio));
  };
  return { render, scales };
}

const capture = (
  length: (pixelRatio: number) => number,
  options: CaptureOptions,
): { promise: Promise<string>; scales: number[] } => {
  const { render, scales } = fakeRenderer(length);
  return { promise: captureScreenshot(render, options), scales };
};

test("a small page is rendered at full scale on the first attempt", async () => {
  const { promise, scales } = capture(() => 100, {
    root: fakeRoot(400, 300),
    maxDataUrlLength: 1_000_000,
  });
  await promise;
  assert.deepEqual(scales, [1]);
});

test("a page whose estimate exceeds the ceiling starts at half scale", async () => {
  // 2000x2000 CSS pixels at half a byte each is two million bytes, or about
  // 2.7 million base64 characters — comfortably over the ceiling below.
  const { promise, scales } = capture(() => 100, {
    root: fakeRoot(2000, 2000),
    maxDataUrlLength: 1_000_000,
  });
  await promise;
  assert.deepEqual(scales, [0.5]);
});

test("a generous bytes-per-pixel estimate pushes a page under the ceiling", async () => {
  // The same root as the previous test: only the assumed compression changes.
  const { promise, scales } = capture(() => 100, {
    root: fakeRoot(2000, 2000),
    maxDataUrlLength: 1_000_000,
    bytesPerPixelEstimate: 0.0001,
  });
  await promise;
  assert.deepEqual(scales, [1]);
});

test("a forced pixel ratio is used instead of the estimate", async () => {
  const { promise, scales } = capture(() => 100, {
    root: fakeRoot(2000, 2000),
    maxDataUrlLength: 1_000_000,
    pixelRatio: 0.25,
  });
  await promise;
  assert.deepEqual(scales, [0.25]);
});

test("an oversized first attempt is retried at half scale", async () => {
  const { promise, scales } = capture((ratio) => (ratio === 1 ? 5_000_000 : 100), {
    root: fakeRoot(400, 300),
    maxDataUrlLength: 1_000_000,
  });
  assert.equal(await promise, "d".repeat(100));
  assert.deepEqual(scales, [1, 0.5]);
});

test("a picture that is still too large after the retry throws", async () => {
  const { promise, scales } = capture(() => 5_000_000, {
    root: fakeRoot(400, 300),
    maxDataUrlLength: 1_000_000,
  });
  await assert.rejects(promise, ScreenshotTooLargeError);
  assert.deepEqual(scales, [1, 0.5]);
});

test("a first attempt already at half scale is not retried", async () => {
  const { promise, scales } = capture(() => 5_000_000, {
    root: fakeRoot(2000, 2000),
    maxDataUrlLength: 1_000_000,
  });
  await assert.rejects(promise, ScreenshotTooLargeError);
  assert.deepEqual(scales, [0.5]);
});

test("onCapture reports the scale, size, attempts and timing", async () => {
  const seen: CaptureInfo[] = [];
  const { promise } = capture((ratio) => (ratio === 1 ? 5_000_000 : 100), {
    root: fakeRoot(400, 300),
    maxDataUrlLength: 1_000_000,
    onCapture: (info) => seen.push(info),
  });
  await promise;
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.attempts, 2);
  assert.equal(seen[0]?.pixelRatio, 0.5);
  assert.equal(seen[0]?.length, 100);
  assert.ok(typeof seen[0]?.ms === "number" && seen[0].ms >= 0);
});

test("onCapture is told about a capture that ends up rejected", async () => {
  const seen: CaptureInfo[] = [];
  const { promise } = capture(() => 5_000_000, {
    root: fakeRoot(400, 300),
    maxDataUrlLength: 1_000_000,
    onCapture: (info) => seen.push(info),
  });
  await assert.rejects(promise, ScreenshotTooLargeError);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.attempts, 2);
  assert.equal(seen[0]?.length, 5_000_000);
});

test("a throwing onCapture does not lose the screenshot", async () => {
  const { promise } = capture(() => 100, {
    root: fakeRoot(400, 300),
    maxDataUrlLength: 1_000_000,
    onCapture: () => {
      throw new Error("callback is broken");
    },
  });
  assert.equal(await promise, "d".repeat(100));
});

test("a nonsensical pixel ratio falls back to the estimate", async () => {
  for (const pixelRatio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { promise, scales } = capture(() => 100, {
      root: fakeRoot(2000, 2000),
      maxDataUrlLength: 1_000_000,
      pixelRatio,
    });
    await promise;
    assert.deepEqual(scales, [0.5], `pixelRatio ${String(pixelRatio)}`);
  }
});

test("a nonsensical bytes-per-pixel estimate falls back to the default", async () => {
  for (const bytesPerPixelEstimate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { promise, scales } = capture(() => 100, {
      root: fakeRoot(2000, 2000),
      maxDataUrlLength: 1_000_000,
      bytesPerPixelEstimate,
    });
    await promise;
    assert.deepEqual(scales, [0.5], `bytesPerPixelEstimate ${String(bytesPerPixelEstimate)}`);
  }
});

test("a root with no usable size is treated as small", async () => {
  for (const [width, height] of [
    [0, 0],
    [Number.NaN, 100],
    [100, Number.NaN],
  ] as const) {
    const { promise, scales } = capture(() => 100, {
      root: fakeRoot(width, height),
      maxDataUrlLength: 1_000_000,
    });
    await promise;
    assert.deepEqual(scales, [1], `${String(width)}x${String(height)}`);
  }
});

test("the default estimate is documented as half a byte per pixel", () => {
  assert.equal(DEFAULT_BYTES_PER_PIXEL_ESTIMATE, 0.5);
});

test("captureScreenshot refuses to run outside a browser", async () => {
  delete globals.document;
  await assert.rejects(
    captureScreenshot(async () => "d", { root: fakeRoot(10, 10) }),
    /browser environment/,
  );
});
