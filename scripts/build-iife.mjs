/**
 * Builds the two one-script-tag bundles: `dist/bugbottle.js`, which carries
 * everything, and `dist/bugbottle.slim.js`, the same panel without the
 * annotator, the timings snapshot, the shake gesture and the network log.
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

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

/**
 * The same settings for both files, down to the version define: the slim
 * build is a different entry point and nothing else, so anything that makes
 * one of them smaller makes the other smaller too.
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
    define: { __BUGBOTTLE_VERSION__: JSON.stringify(version) },
  });

  const bytes = statSync(outfile).size;
  const gzipped = gzipSync(readFileSync(outfile)).length;
  console.log(`dist/${name}: ${bytes} bytes, ${gzipped} bytes gzipped`);
}

await bundle("global.ts", "bugbottle.js");
await bundle("global-slim.ts", "bugbottle.slim.js");
