/**
 * The entry point for the one-script-tag build: `dist/bugbottle.js`, an IIFE
 * bundled by `scripts/build-iife.mjs` and served from a CDN.
 *
 * It exists for the pages that have no bundler at all — a WordPress theme, a
 * static site, a client site somebody else deploys. Everything it exposes is
 * the same code the ESM entry points export; nothing here is a second
 * implementation. The only additions are the `window.bugbottle` namespace and
 * the `data-*` reading, which lives in `src/global-shared.ts` because
 * `src/global-slim.ts` reads the same attributes the same way.
 *
 * This is the build that carries everything. The slim one is the same panel
 * without the annotator, the timings snapshot, the shake gesture and the
 * network log.
 *
 * Screenshots are deliberately absent from both. A renderer means
 * `html-to-image`, and that is a large dependency to force on every page that
 * only wants the panel; a site that needs pictures should install the package
 * and pass its own renderer to `window.bugbottle.mount`.
 *
 * This module is excluded from the tsc build (see `tsconfig.build.json`): it
 * is only ever consumed through esbuild, which replaces the version constant.
 */

import { createAnnotator } from "./annotate.ts";
import { initBreadcrumbs } from "./breadcrumbs.ts";
import { initConsoleBuffer } from "./console-buffer.ts";
import { pickElement } from "./element-picker.ts";
import { bootstrap, readOptions } from "./global-shared.ts";
import { locales, resolveLocale } from "./locales.ts";
import { initNetwork } from "./network.ts";
import { initPerf } from "./perf.ts";
import { createQueue } from "./queue.ts";
import { scrubReport } from "./scrub.ts";
import { onShake, requestShakePermission } from "./shake.ts";
import { buildReport, sendReport } from "./send.ts";
import { createSigner } from "./sign.ts";
import { onShortcut, onUncaughtError } from "./triggers.ts";
import { mountBugbottle, type MountOptions } from "./ui/index.ts";

/** Replaced by esbuild with the version in `package.json`. */
declare const __BUGBOTTLE_VERSION__: string;

/**
 * `mountBugbottle` with the annotator already handed in. The panel takes the
 * annotator as a function now, so nobody pays for a canvas editor they never
 * open; this build is the one that carries everything, so it wires it up and
 * `annotate: false` is still the way to leave the button out.
 */
function mount(options: MountOptions): ReturnType<typeof mountBugbottle> {
  return mountBugbottle({ annotate: createAnnotator, ...options });
}

const api = {
  version: __BUGBOTTLE_VERSION__,
  mount,
  mountBugbottle: mount,
  initConsoleBuffer,
  initBreadcrumbs,
  initNetwork,
  initPerf,
  createQueue,
  locales,
  resolveLocale,
  scrubReport,
  createSigner,
  buildReport,
  sendReport,
  pickElement,
  // This build carries the annotator for the panel, so exposing it costs
  // nothing and lets a page with its own form mark a picture the same way.
  createAnnotator,
  // The panel wires both of these itself; they are exposed for the page that
  // wants a shortcut without the panel, and they cost nothing extra here.
  onShortcut,
  onUncaughtError,
  // The gesture and the permission call that goes with it. A page that wires
  // its own form gets both; `data-shake` below is the no-JavaScript way in.
  onShake,
  requestShakePermission,
};

declare global {
  interface Window {
    bugbottle: typeof api;
  }
}

window.bugbottle = api;

function autoMount(data: DOMStringMap): void {
  const endpoint = data.endpoint;
  if (!endpoint) return;

  const options = readOptions(data, endpoint);
  // Marking the picture is on by default wherever there is a picture — `mount`
  // above hands the annotator in — so, like masking, the attribute exists only
  // to switch it off. This build ships no renderer, so it matters only once a
  // page passes one to `mount` itself.
  if (data.annotate === "off") options.annotate = false;
  // Presence enables the shake gesture, the same way `data-scrub` does, and an
  // acceleration in m/s² tunes the threshold: `data-shake="12"` is a lighter
  // flick. On iOS nothing arrives until the page has called
  // `window.bugbottle.requestShakePermission()` from a button of its own.
  if (data.shake !== undefined) {
    const threshold = Number(data.shake);
    options.shake = threshold > 0 ? { on: onShake, threshold } : onShake;
  }
  // Any value enables the network log, the same way `data-scrub` does. It is
  // opt-in rather than on: patching fetch is a bigger promise than listening.
  if (data.network !== undefined) initNetwork({ endpoint });
  // Same shape again: any value turns the timings and the storage snapshot
  // on. Opt-in rather than on, because listing what a page has stored is a
  // bigger promise than timing it, and a script tag cannot ask first.
  if (data.perf !== undefined) initPerf();
  mount(options);
}

bootstrap(autoMount);
