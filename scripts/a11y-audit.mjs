/**
 * The accessibility audit of the ready-made panel.
 *
 * `node:test` has no layout engine, so colour contrast, computed target sizes
 * and the accessibility tree can only be checked in a real browser. This
 * serves `dist/` on a scratch page, mounts the panel with everything showing —
 * the screenshot row, an attached element and its remove button — and runs
 * axe-core over nine states: closed, open in the light scheme, open in the
 * dark one, the picture annotator open in each scheme, the panel with the
 * optional contact field on in each scheme, and the panel and the annotator
 * again under `forced-colors: active`, which is Windows High Contrast. It
 * exits non-zero on any violation.
 *
 * Forced colours also get a check axe cannot make. axe reads the accessibility
 * tree and computes contrast from the stylesheet; it cannot tell that the
 * selected type button lost the accent that said it was selected, because in
 * forced colours the browser threw that colour away. So the run ends by
 * photographing the panel with the palette forced and sampling a handful of
 * pixels: the trigger has to have an edge against the page, the selected type
 * button has to differ from the two beside it, the focus ring has to differ
 * from the panel behind it, and the selected label has to still read as a word
 * — Chrome paints a backplate behind text in forced colours, and a label that
 * lost to one is a blank block that axe reports as passing.
 *
 *     npm run build
 *     node scripts/a11y-audit.mjs --out <directory>
 *
 * Chrome and `puppeteer-core` are both found by `scripts/chrome.mjs`:
 * CHROME_BIN or CHROME_PATH, then the usual Linux, macOS and Windows
 * locations, and puppeteer-core from this repository or the global root.
 */

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, loadPuppeteer } from "./chrome.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
// `indexOf` returns -1 when the flag is absent, and argv[-1 + 1] is the path to
// node itself, so the flag has to be found before its value is read.
const outFlag = process.argv.indexOf("--out");
const outDir = resolve(
  (outFlag === -1 ? undefined : process.argv[outFlag + 1]) ?? join(root, "a11y-reports"),
);
const chromePath = findChrome();

const TYPES = { ".js": "text/javascript", ".json": "application/json", ".map": "application/json" };

/** The scratch page: a landmarked document with the panel mounted into it. */
function page(scheme, contact) {
  const dark = scheme === "dark";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>bugbottle accessibility scratch page</title>
<style>
  body{margin:0;font:16px/1.5 system-ui,sans-serif;
    background:${dark ? "#0b1020" : "#ffffff"};color:${dark ? "#e5e7eb" : "#1f2937"}}
  main{padding:24px;max-width:40em}
</style></head>
<body>
<main>
  <h1>Orders</h1>
  <p>A page with some content on it, so the panel is audited where it lives.</p>
  <button type="button" id="save-order">Save the order</button>
</main>
<script type="module">
  import { mountBugbottle } from "/dist/ui/index.js";
  import { createAnnotator } from "/dist/annotate.js";
  // A picture rather than a photograph of the page: the screenshot row, its
  // note and the annotator all have to be on the page to be audited, and the
  // annotator needs a PNG that really decodes. Nothing here renders the DOM.
  const shot = document.createElement("canvas");
  shot.width = 320;
  shot.height = 200;
  const paint = shot.getContext("2d");
  paint.fillStyle = "#94a3b8";
  paint.fillRect(0, 0, 320, 200);
  const picture = shot.toDataURL("image/png");
  window.bb = mountBugbottle({
    endpoint: "/api/reports",
    theme: { scheme: ${JSON.stringify(scheme)} },
    screenshot: async () => picture,
    screenshotFor: () => false,
    // Off unless the state under audit asked for it, exactly as an application
    // has to. "required" audits the label, the hint and the required marking.
    contact: ${contact ? '"required"' : "false"},
    // The panel takes the annotator as a function, so the audit has to ask for
    // it: without this the editor is not on the page to be audited at all.
    annotate: createAnnotator,
    fetch: async () => new Response("{}", { status: 201 }),
  });
</script>
</body></html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(url.searchParams.get("scheme") ?? "light", url.searchParams.has("contact")));
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
const axeSource = await readFile(join(root, "node_modules", "axe-core", "axe.min.js"), "utf8");
const browser = await puppeteer.launch({ executablePath: chromePath, headless: "new" });
await mkdir(outDir, { recursive: true });

/**
 * Puts one tab into the media features a state is audited under.
 *
 * This goes through CDP rather than through `page.emulateMediaFeatures`,
 * which keeps an allowlist of feature names and refuses `forced-colors`.
 * Chrome itself has emulated it for years — it is what the DevTools rendering
 * panel switches — so the message is the wrapper's, not the browser's. The
 * palette is forced per tab rather than for the whole browser because the
 * other seven states have to stay in their own colours.
 */
const emulate = async (tab, scheme, forced) => {
  const session = await tab.createCDPSession();
  await session.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: scheme },
      { name: "forced-colors", value: forced ? "active" : "none" },
    ],
  });
};

/** Runs axe over the whole document, shadow roots included, and saves the report. */
async function audit(name, scheme, prepare, query = "", forced = false) {
  const tab = await browser.newPage();
  await emulate(tab, scheme, forced);
  await tab.goto(`${origin}/?scheme=${scheme}${query}`, { waitUntil: "networkidle0" });
  await tab.waitForSelector("[data-bugbottle=ui]");
  if (prepare) await prepare(tab);
  await tab.evaluate(axeSource);
  const report = await tab.evaluate(async () => await window.axe.run(document));
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(report, null, 2));
  const rules = report.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`);
  console.log(
    `${name}: ${report.violations.length} violations, ${report.passes.length} passes, ` +
      `${report.incomplete.length} incomplete${rules.length ? ` — ${rules.join(", ")}` : ""}`,
  );
  await tab.close();
  return report.violations.length;
}

/** Opens the panel and attaches an element, so every control is on the page. */
const openWithEverything = async (tab) => {
  await tab.evaluate(async () => {
    const root = document.querySelector("[data-bugbottle=ui]").shadowRoot;
    root.querySelector(".trigger").click();
    root.querySelector(".pick").click();
    await new Promise((r) => setTimeout(r, 50));
    document.getElementById("save-order").click();
    await new Promise((r) => setTimeout(r, 50));
  });
};

/** Opens the panel, attaches the picture and opens the annotator over it. */
const openAnnotator = async (tab) => {
  await tab.evaluate(async () => {
    const root = document.querySelector("[data-bugbottle=ui]").shadowRoot;
    root.querySelector(".trigger").click();
    const box = root.querySelector(".check input");
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    root.querySelector(".edit").click();
    await new Promise((r) => setTimeout(r, 100));
  });
  // The toolbar, the canvas and the two actions are all inside the panel, so a
  // state that stops short of them audits the wrong thing.
  await tab.waitForFunction(() => {
    const root = document.querySelector("[data-bugbottle=ui]").shadowRoot;
    const editor = root.querySelector(".editor");
    return editor && !editor.hidden && root.querySelector("canvas").width > 0;
  });
};

/**
 * The pixel proof of the forced-colours block.
 *
 * Everything here is sampled from a real screenshot with the palette forced,
 * because the question is not what the stylesheet says but what a reporter
 * would see. Two colours count as different when a channel differs by more
 * than a quarter of its range: forced palettes are made of flat, far-apart
 * colours, so anything smaller is antialiasing.
 */
const differs = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > 64);
const rgb = (c) => `rgb(${c.join(",")})`;

/** Photographs the tab and reads back the colour at each viewport point. */
async function samples(tab, points) {
  const shot = await tab.screenshot();
  const data = Buffer.from(shot).toString("base64");
  return await tab.evaluate(
    async (png, pts) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const surface = document.createElement("canvas");
      surface.width = img.width;
      surface.height = img.height;
      const paint = surface.getContext("2d");
      paint.drawImage(img, 0, 0);
      // The screenshot is the viewport at a scale factor of one, so a point
      // from `getBoundingClientRect` is a pixel in it without conversion.
      return pts.map((p) => [...paint.getImageData(p.x, p.y, 1, 1).data].slice(0, 3));
    },
    data,
    points,
  );
}

/**
 * Opens the panel with the palette forced and reads the three things the axe
 * run cannot see: that the trigger has an edge, that the selected type button
 * differs from the two beside it, and that the focus ring differs from the
 * panel behind it. Returns the number of those that failed.
 */
async function forcedColourPixels() {
  const problems = [];
  const tab = await browser.newPage();
  await emulate(tab, "light", true);
  await tab.goto(`${origin}/?scheme=light`, { waitUntil: "networkidle0" });
  await tab.waitForSelector("[data-bugbottle=ui]");

  // The trigger first, while it is still the only thing on screen. Its
  // background is its whole shape in normal colours; in forced ones it is
  // ButtonFace, which can be the page's own colour, so the edge has to come
  // from the border the media block adds.
  const edge = await tab.evaluate(() => {
    const box = document
      .querySelector("[data-bugbottle=ui]")
      .shadowRoot.querySelector(".trigger")
      .getBoundingClientRect();
    const x = Math.round(box.left + box.width / 2);
    const top = Math.round(box.top);
    return [-8, -2, -1, 0, 1, 2].map((d) => ({ x, y: top + d }));
  });
  const edges = await samples(tab, edge);
  const behindTrigger = edges[0];
  const edgePixel = edges.slice(1).find((c) => differs(c, behindTrigger));
  if (!edgePixel) {
    problems.push(`the trigger has no edge against the page: every pixel is ${rgb(behindTrigger)}`);
  } else {
    console.log(`forced-colors: trigger edge ${rgb(edgePixel)} on ${rgb(behindTrigger)}`);
  }

  await openWithEverything(tab);
  // A real key press, so the browser counts the interaction as a keyboard one
  // and `:focus-visible` matches. The send button is the target because it sits
  // over the panel's own background, where a ring either shows or does not.
  for (let i = 0; i < 25; i += 1) {
    const there = await tab.evaluate(() => {
      const root = document.querySelector("[data-bugbottle=ui]").shadowRoot;
      return root.activeElement?.classList?.contains("send") ?? false;
    });
    if (there) break;
    await tab.keyboard.press("Tab");
  }

  const spots = await tab.evaluate(() => {
    const root = document.querySelector("[data-bugbottle=ui]").shadowRoot;
    const types = [...root.querySelectorAll(".type")];
    // Six pixels in from the left edge: inside the padding, clear of the border
    // and clear of the label, so what is read is the button's own surface.
    const surface = (el) => {
      const box = el.getBoundingClientRect();
      return { x: Math.round(box.left + 6), y: Math.round(box.top + box.height / 2) };
    };
    const send = root.querySelector(".send").getBoundingClientRect();
    const x = Math.round(send.left + send.width / 2);
    const checked = types.findIndex((t) => t.getAttribute("aria-checked") === "true");
    // A row of pixels straight through the selected label, edge to edge. Its
    // letters have to show up as letters: Chrome paints a Canvas backplate
    // behind text in forced colours, and a label that lost to one is a solid
    // block rather than a word.
    const label = [];
    if (checked !== -1) {
      const box = types[checked].getBoundingClientRect();
      const row = Math.round(box.top + box.height / 2);
      for (let px = Math.round(box.left) + 2; px < Math.round(box.right) - 2; px += 1) {
        label.push({ x: px, y: row });
      }
    }
    return {
      checked,
      focused: root.activeElement?.className ?? "none",
      types: types.map(surface),
      label,
      // The outline is two pixels wide and two outside the border box, so three
      // above the button is in the ring and eight above it is the panel.
      ring: { x, y: Math.round(send.top - 3) },
      behind: { x, y: Math.round(send.top - 8) },
    };
  });
  if (spots.checked === -1) problems.push("no type button is selected, so nothing was compared");
  if (spots.focused !== "send") {
    problems.push(`the focus never reached the send button (${spots.focused})`);
  }
  const read = await samples(tab, [...spots.types, spots.ring, spots.behind, ...spots.label]);
  const surfaces = read.slice(0, spots.types.length);
  const [ring, behind] = read.slice(spots.types.length, spots.types.length + 2);
  const row = read.slice(spots.types.length + 2);
  const selected = surfaces[spots.checked];
  const others = surfaces.filter((_, i) => i !== spots.checked);
  if (!selected || !others.every((c) => differs(c, selected))) {
    problems.push(`the selected type button is not distinguishable: ${surfaces.map(rgb).join(" ")}`);
  } else {
    console.log(
      `forced-colors: selected type ${rgb(selected)} against ${others.map(rgb).join(" ")}`,
    );
  }
  if (!differs(ring, behind)) {
    problems.push(`the focus ring is invisible: ${rgb(ring)} on ${rgb(behind)}`);
  } else {
    console.log(`forced-colors: focus ring ${rgb(ring)} on ${rgb(behind)}`);
  }
  // Four edges is two letters at their thinnest; a backplate has exactly two.
  const crossings = row.filter((c, i) => i && differs(c, row[i - 1])).length;
  if (crossings < 4) {
    problems.push(`the selected label reads as a block, not a word: ${crossings} colour edges`);
  } else {
    console.log(`forced-colors: selected label has ${crossings} colour edges across it`);
  }

  await writeFile(join(outDir, "forced-colors-panel.png"), await tab.screenshot());
  await tab.close();
  for (const problem of problems) console.error(`forced-colors: ${problem}`);
  return problems.length;
}

let failures = 0;
failures += await audit("closed-light", "light");
failures += await audit("open-light", "light", openWithEverything);
failures += await audit("open-dark", "dark", openWithEverything);
failures += await audit("annotate-light", "light", openAnnotator);
failures += await audit("annotate-dark", "dark", openAnnotator);
// The optional contact field, which is a labelled input with a hint of its own
// and is rendered nowhere else.
failures += await audit("contact-light", "light", openWithEverything, "&contact=1");
failures += await audit("contact-dark", "dark", openWithEverything, "&contact=1");
// Windows High Contrast: the browser throws every `--bb-*` colour away, so the
// panel and the annotator are audited again under the palette it substitutes,
// and then photographed, because axe reads a stylesheet the browser overrode.
failures += await audit("forced-open", "light", openWithEverything, "", true);
failures += await audit("forced-annotate", "light", openAnnotator, "", true);
failures += await forcedColourPixels();

await browser.close();
server.close();
console.log(`reports written to ${outDir}`);
if (failures) {
  console.error(`${failures} failures`);
  process.exit(1);
}
