#!/usr/bin/env node
/**
 * Guards the shipped size of the "bugbottle" browser entry points, and two
 * couplings that must never happen. There is no bundler step here: dist/
 * ships the ESM files tsc emits, so "the bundle" a consumer's own bundler
 * pulls in is an entry file plus everything it statically imports.
 *
 * - html-to-image must never be a static import anywhere in the main entry's
 *   graph — it is meant to load only when a screenshot is actually taken
 *   (see src/capture.ts), which is why capture.ts uses a dynamic import().
 * - dist/react/bubble.js (the optional prebuilt trigger + panel, issue #6)
 *   must never be part of the react entry's graph — importing only
 *   `useBugReport` must not pull its markup or styling along for the ride.
 *
 * Run after `npm run build`. Exits non-zero if a graph exceeds its byte
 * budget, or if either forbidden coupling is found.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "..", "dist");

const STATIC_IMPORT = /^\s*(?:import|export)\s[^;]*?\bfrom\s+["']([^"']+)["']/gm;

function staticImportSpecifiers(source) {
  return [...source.matchAll(STATIC_IMPORT)].map((match) => match[1]);
}

/** Walks the static-import graph from `entry`, following only relative specifiers. */
function walk(entry, onBareSpecifier) {
  const visited = new Set();
  let bytes = 0;

  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    bytes += Buffer.byteLength(source);

    for (const specifier of staticImportSpecifiers(source)) {
      if (!specifier.startsWith(".")) {
        onBareSpecifier?.(file, specifier);
        continue; // bare specifiers (peer deps) never ship as part of this graph
      }
      visit(resolve(dirname(file), specifier));
    }
  }

  visit(entry);
  return { bytes, visited };
}

function checkBudget(label, entry, budgetBytes, onBareSpecifier) {
  const { bytes, visited } = walk(entry, onBareSpecifier);
  console.log(`bundle-size: ${label} = ${bytes} bytes (budget ${budgetBytes})`);
  if (bytes > budgetBytes) {
    console.error(
      `bundle-size: ${label} exceeds its ${budgetBytes} byte budget. If the growth is intentional, ` +
        `raise the budget in scripts/check-bundle-size.mjs and update the size recorded in the README.`,
    );
    process.exitCode = 1;
  }
  return { bytes, visited };
}

// Recorded here and in the README so a change to either number is a
// deliberate, reviewable decision rather than a silent creep.
const MAIN_BUDGET_BYTES = 16 * 1024; // current graph is ~10.2 KB
const REACT_BUDGET_BYTES = 24 * 1024; // current graph is ~14.6 KB — useBugReport pulls in capture, console-buffer and report-core too

checkBudget("dist/index.js + static imports", join(distDir, "index.js"), MAIN_BUDGET_BYTES, (file, specifier) => {
  if (specifier === "html-to-image") {
    console.error(
      `bundle-size: ${file} statically imports "html-to-image" — it must stay a dynamic import() so it does not ship to every consumer.`,
    );
    process.exitCode = 1;
  }
});

const bubbleFile = join(distDir, "react", "bubble.js");
const { visited: reactGraph } = checkBudget(
  "dist/react/index.js + static imports",
  join(distDir, "react", "index.js"),
  REACT_BUDGET_BYTES,
);
if (reactGraph.has(bubbleFile)) {
  console.error(
    `bundle-size: dist/react/index.js statically imports dist/react/bubble.js — importing useBugReport ` +
      `must not pull the prebuilt bubble's markup and styling into a headless consumer's bundle.`,
  );
  process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
