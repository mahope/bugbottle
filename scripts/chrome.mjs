/**
 * Where Chrome is, and where `puppeteer-core` is.
 *
 * The browser scripts — `a11y-audit.mjs`, `a11y-site.mjs`,
 * `annotate-smoke.mjs`, `capture-panel.mjs` and `render-og.mjs` — all need the
 * same two answers, and each used to carry its own copy of them: one Windows
 * path and a `require` that falls back to the global root. That was fine while
 * the only machine running them was one desktop, and wrong the moment CI did,
 * because a GitHub runner has neither that path nor a local `puppeteer-core`.
 *
 * Nothing here downloads a browser. `puppeteer-core` never does; that it uses
 * the machine's own browser is the whole reason it is preferred to `puppeteer`.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";

/* The GitHub `ubuntu-latest` image ships Chrome and sets CHROME_BIN; other
 * images and containers set one or the other, so both are honoured, CHROME_BIN
 * first because it is the one an image is most likely to have set on purpose. */
const ENV_VARS = ["CHROME_BIN", "CHROME_PATH"];

/* Ordered by how likely each is to be the browser the caller meant: a runner's
 * Chrome first, then a distribution Chromium, then the two desktops. */
const CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

/* The names to look for on PATH when none of the fixed paths exists — a
 * Chrome installed somewhere unusual is still findable if it is on the path. */
const PATH_NAMES = ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"];

/* The Windows default, which is where this repository's browser work is
 * usually done, and so the most useful thing for a "no such file" message to
 * name when nothing at all was found. */
const FALLBACK = "C:/Program Files/Google/Chrome/Application/chrome.exe";

/**
 * The executable to hand `puppeteer.launch`. An environment variable wins over
 * everything and is returned unchecked: a caller who names a path deserves
 * puppeteer's own error about that path rather than a silent guess of ours.
 * Otherwise the first candidate that exists on disk wins, then the first name
 * found on PATH.
 */
export function findChrome() {
  for (const name of ENV_VARS) {
    const value = process.env[name];
    if (value) return value;
  }
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of PATH_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return FALLBACK;
}

/**
 * `puppeteer-core` may be installed globally rather than in this repository —
 * it is not a dependency of the package, because nothing that ships needs it —
 * so it is resolved by hand: locally first, then from the global root.
 */
export function loadPuppeteer() {
  const here = createRequire(import.meta.url);
  try {
    return here("puppeteer-core");
  } catch {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(join(globalRoot, "noop.js"))("puppeteer-core");
  }
}
