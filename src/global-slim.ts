/**
 * The entry point for the slim script-tag build: `dist/bugbottle.slim.js`.
 *
 * The full build is the "everything" build: a `data-*` attribute has to be
 * able to switch on the annotator, the timings snapshot, the shake gesture and
 * the network log, so every page that loads it carries all four whether it
 * asks for them or not. This entry is the same panel without those four. It is
 * the console, the breadcrumbs, the element picker, the queue, the scrubber,
 * the signer and all eight locales — locales are data, `data-locale` keeps
 * working, and dropping them would save a few kilobytes at the cost of every
 * page that is not in English.
 *
 * Nothing here is a second implementation of anything: the shared `data-*`
 * reading is `src/global-shared.ts`, the same module the full build uses.
 *
 * Like `src/global.ts` it is excluded from the tsc emit and only ever built by
 * esbuild, which replaces the version constant.
 */

import { initBreadcrumbs } from "./breadcrumbs.ts";
import { initConsoleBuffer } from "./console-buffer.ts";
import { pickElement } from "./element-picker.ts";
import { bootstrap, readOptions } from "./global-shared.ts";
import { locales, resolveLocale } from "./locales.ts";
import { createQueue } from "./queue.ts";
import { scrubReport } from "./scrub.ts";
import { buildReport, sendReport } from "./send.ts";
import { createSigner } from "./sign.ts";
import { onShortcut, onUncaughtError } from "./triggers.ts";
import { mountBugbottle } from "./ui/index.ts";

/** Replaced by esbuild with the version in `package.json`. */
declare const __BUGBOTTLE_VERSION__: string;

const api = {
  version: __BUGBOTTLE_VERSION__,
  mount: mountBugbottle,
  mountBugbottle,
  initConsoleBuffer,
  initBreadcrumbs,
  createQueue,
  locales,
  resolveLocale,
  scrubReport,
  createSigner,
  buildReport,
  sendReport,
  pickElement,
  onShortcut,
  onUncaughtError,
};

// `src/global.ts` is the one that augments `Window`, and the two entries are in
// the same typecheck: a second augmentation of the same property would be a
// conflicting declaration. The namespace is the same shape minus what this
// build leaves out, so a cast says it without the clash.
(window as unknown as { bugbottle: typeof api }).bugbottle = api;

/**
 * The attributes this build reads and then does nothing with, because the code
 * behind them is not in it. A page that writes one has asked for something it
 * is not getting, and silence would leave it wondering why the button never
 * appeared, so say so — once, in English, because it is a message to whoever
 * wrote the script tag and not to the reporter.
 */
const IGNORED = ["annotate", "perf", "shake", "network"] as const;

function warnIgnored(data: DOMStringMap): void {
  const present = IGNORED.filter((name) => data[name] !== undefined);
  if (present.length === 0) return;
  console.warn(
    `bugbottle: the slim build ignores ${present.map((name) => `data-${name}`).join(", ")}. ` +
      "Load dist/bugbottle.js instead for the annotator, the timings snapshot, " +
      "the shake gesture and the network log.",
  );
}

function autoMount(data: DOMStringMap): void {
  const endpoint = data.endpoint;
  if (!endpoint) return;
  mountBugbottle(readOptions(data, endpoint));
}

bootstrap(autoMount, warnIgnored);
