/**
 * Benchmarks src/capture.ts's captureScreenshot against real page sizes —
 * run with `npm run bench:capture`.
 *
 * html-to-image renders the DOM via an SVG foreignObject drawn onto a
 * canvas. That needs real layout and a real canvas, neither of which jsdom
 * provides, so this drives an actual headless Chromium through
 * playwright-core rather than node:test. It reuses the already-cached
 * browser this machine has from other Playwright-based work; if none is
 * cached, playwright-core reports exactly what to run
 * (`npx playwright install chromium`).
 *
 * No behaviour change here — see bench/README.md for the write-up.
 */
import { chromium } from "playwright-core";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const htmlToImagePath = require.resolve("html-to-image/dist/html-to-image.js");

const VIEWPORT = { width: 1280, height: 800 };
const RUNS = 8;

type PageCase = { label: string; html: string };

function longPageHtml(): string {
  const sections = Array.from(
    { length: 400 },
    (_, i) => `<section><h2>Section ${i}</h2><p>${"Lorem ipsum dolor sit amet. ".repeat(20)}</p></section>`,
  ).join("");
  return `<body>${sections}</body>`;
}

function manyImagesHtml(): string {
  // A 1x1 red PNG, reused so this stays offline and disk-cheap while still
  // giving html-to-image the same number of <img> nodes to walk and inline.
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const images = Array.from(
    { length: 300 },
    (_, i) => `<img src="${pixel}" width="80" height="80" alt="img ${i}" />`,
  ).join("");
  return `<body><div style="display:flex;flex-wrap:wrap">${images}</div></body>`;
}

const CASES: PageCase[] = [
  { label: "small page", html: "<body><h1>Report a bug</h1><p>A small form-sized page.</p></body>" },
  { label: "long page (400 sections)", html: longPageHtml() },
  { label: "many images (300 imgs)", html: manyImagesHtml() },
];

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.addScriptTag({ path: htmlToImagePath });

    console.log(`viewport ${VIEWPORT.width}x${VIEWPORT.height}, ${RUNS} runs per case (first run discarded as warmup)\n`);
    console.log(
      ["page".padEnd(26), "primary render (p50)".padStart(22), "retry render (p50)".padStart(20)].join(" "),
    );

    for (const { label, html } of CASES) {
      await page.setContent(`<!doctype html><html><head></head>${html}</html>`);

      const primary: number[] = [];
      const retry: number[] = [];
      for (let i = 0; i < RUNS + 1; i++) {
        const [primaryMs, retryMs] = await page.evaluate(async () => {
          const { toPng } = (window as unknown as { htmlToImage: typeof import("html-to-image") })
            .htmlToImage;
          const root = document.body;

          const t0 = performance.now();
          await toPng(root, { pixelRatio: 1 });
          const t1 = performance.now();
          // Always measured, not just when a real capture would be oversized —
          // the goal is knowing what the retry costs, not reproducing the
          // (data-dependent) decision to take it.
          await toPng(root, { pixelRatio: 0.5 });
          const t2 = performance.now();

          return [t1 - t0, t2 - t1];
        });
        if (i === 0) continue; // warmup
        primary.push(primaryMs);
        retry.push(retryMs);
      }

      primary.sort((a, b) => a - b);
      retry.sort((a, b) => a - b);
      const p50 = (arr: number[]) => arr[Math.floor(arr.length / 2)] ?? 0;

      console.log(
        [label.padEnd(26), `${p50(primary).toFixed(1)} ms`.padStart(22), `${p50(retry).toFixed(1)} ms`.padStart(20)].join(
          " ",
        ),
      );
    }
  } finally {
    await browser.close();
  }
}

await main();
