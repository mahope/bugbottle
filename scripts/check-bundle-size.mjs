#!/usr/bin/env node
/**
 * Guards the shipped size of the main "bugbottle" entry point — the browser
 * widget bundle. There is no bundler step here: dist/ ships the ESM files
 * tsc emits, so "the bundle" a consumer's own bundler pulls in is dist/index.js
 * plus everything it statically imports. html-to-image must never join that
 * graph — it is meant to load only when a screenshot is actually taken (see
 * src/capture.ts), which is why capture.ts loads it with a dynamic import().
 *
 * Run after `npm run build`. Exits non-zero if the graph exceeds the byte
 * budget, or if html-to-image is found as a static import anywhere in it.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "..", "dist");
const entry = join(distDir, "index.js");

// Recorded here and in the README so a change to this number is a deliberate,
// reviewable decision rather than a silent creep. Current graph size is
// ~10.2 KB; this leaves roughly 50% headroom before CI objects.
const BUDGET_BYTES = 16 * 1024;

const STATIC_IMPORT = /^\s*(?:import|export)\s[^;]*?\bfrom\s+["']([^"']+)["']/gm;

function staticImportSpecifiers(source) {
  return [...source.matchAll(STATIC_IMPORT)].map((match) => match[1]);
}

function walk(file, visited, total) {
  if (visited.has(file)) return;
  visited.add(file);
  const source = readFileSync(file, "utf8");
  total.bytes += Buffer.byteLength(source);

  for (const specifier of staticImportSpecifiers(source)) {
    if (!specifier.startsWith(".")) {
      if (specifier === "html-to-image") {
        console.error(
          `bundle-size: ${file} statically imports "html-to-image" — it must stay a dynamic import() so it does not ship to every consumer.`,
        );
        process.exitCode = 1;
      }
      continue; // bare specifiers (peer deps) never ship as part of this graph
    }
    walk(resolve(dirname(file), specifier), visited, total);
  }
}

const total = { bytes: 0 };
walk(entry, new Set(), total);

console.log(`bundle-size: dist/index.js + static imports = ${total.bytes} bytes (budget ${BUDGET_BYTES})`);

if (total.bytes > BUDGET_BYTES) {
  console.error(
    `bundle-size: ${total.bytes} bytes exceeds the ${BUDGET_BYTES} byte budget. If the growth is intentional, raise BUDGET_BYTES in scripts/check-bundle-size.mjs and update the size recorded in the README.`,
  );
  process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
