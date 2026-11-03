/**
 * Builds the two one-script-tag bundles: `dist/bugbottle.js`, which carries
 * everything, and `dist/bugbottle.slim.js`, the same panel without the
 * annotator, the timings snapshot, the shake gesture, the network log and
 * keyboard element selection. The full build loads its keyboard picker as an
 * ESM chunk on first use; the ESM package keeps its synchronous setup.
 *
 * The ESM output in `dist/` is tsc's; this is a second artefact for pages with
 * no bundler, so it is bundled and minified here rather than shipped as
 * modules. It reads `src/global.ts` directly — esbuild does its own
 * TypeScript stripping, and going through `dist/` would only add a step.
 *
 * The gzipped size is printed at the end because that is the number the CDN
 * user actually pays, and CI holds it to a budget.
 */

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { scriptTagPicker } from "./script-tag-picker.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

/**
 * The same settings for both files, down to the version define: the slim
 * build also disables keyboard element selection at build time so its picker
 * and locale instructions remain pointer-only.
 */
async function bundle(entry, name) {
  const outfile = `${root}dist/${name}`;
  await build({
    entryPoints: [`${root}src/${entry}`],
    outfile,
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    legalComments: "none",
    // A dynamic import resolves beside the script, including cross-origin CDNs.
    banner: entry === "global.ts" ? { js:
      'var __bugbottlePickerUrl = new URL("bugbottle-picker.js", document.currentScript?.src || location.href).href;'
    } : {},
    plugins: [scriptTagPicker(entry !== "global-slim.ts")],
    define: {
      __BUGBOTTLE_VERSION__: JSON.stringify(version),
      __BUGBOTTLE_KEYBOARD_PICKER__: String(entry !== "global-slim.ts"),
    },
  });

  const bytes = statSync(outfile).size;
  const gzipped = gzipSync(readFileSync(outfile)).length;
  console.log(`dist/${name}: ${bytes} bytes, ${gzipped} bytes gzipped`);
}

await bundle("global.ts", "bugbottle.js");
await bundle("global-slim.ts", "bugbottle.slim.js");

await build({
  entryPoints: [`${root}src/element-picker-keyboard.ts`],
  outfile: `${root}dist/bugbottle-picker.js`,
  bundle: true, minify: true, format: "esm", platform: "browser",
  target: ["es2020"], legalComments: "none",
});

const picker = `${root}dist/bugbottle-picker.js`;
console.log(`dist/bugbottle-picker.js: ${statSync(picker).size} bytes, ${gzipSync(readFileSync(picker)).length} bytes gzipped`);
