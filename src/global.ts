/**
 * The entry point for the one-script-tag build: `dist/bugbottle.js`, an IIFE
 * bundled by `scripts/build-iife.mjs` and served from a CDN.
 *
 * It exists for the pages that have no bundler at all — a WordPress theme, a
 * static site, a client site somebody else deploys. Everything it exposes is
 * the same code the ESM entry points export; nothing here is a second
 * implementation. The only additions are the `window.bugbottle` namespace and
 * the `data-*` reading below, so a site can be wired without writing a line of
 * JavaScript.
 *
 * Screenshots are deliberately absent. A renderer means `html-to-image`, and
 * that is a large dependency to force on every page that only wants the panel;
 * a site that needs pictures should install the package and pass its own
 * renderer to `window.bugbottle.mount`.
 *
 * This module is excluded from the tsc build (see `tsconfig.build.json`): it
 * is only ever consumed through esbuild, which replaces the version constant.
 */

import { createAnnotator } from "./annotate.ts";
import { initBreadcrumbs } from "./breadcrumbs.ts";
import { initConsoleBuffer } from "./console-buffer.ts";
import { pickElement } from "./element-picker.ts";
import { locales, resolveLocale, type Locale } from "./locales.ts";
import { initNetwork } from "./network.ts";
import { initPerf } from "./perf.ts";
import { createQueue } from "./queue.ts";
import { scrubReport } from "./scrub.ts";
import { onShake, requestShakePermission } from "./shake.ts";
import { buildReport, sendReport } from "./send.ts";
import { createSigner } from "./sign.ts";
import { onShortcut, onUncaughtError } from "./triggers.ts";
import { mountBugbottle, type MountOptions, type Theme } from "./ui/index.ts";

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

/**
 * The script element that is running us. Read it now: `document.currentScript`
 * is only set while the script evaluates, and the auto-mount happens later.
 */
const script = document.currentScript as HTMLScriptElement | null;

function readTheme(data: DOMStringMap): Theme | undefined {
  const theme: Theme = {};
  if (data.primary) theme.primary = data.primary;
  if (data.position) theme.position = data.position as Theme["position"];
  return Object.keys(theme).length > 0 ? theme : undefined;
}

function readExtra(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    // Anything but an object would be dropped by the report builder anyway,
    // and a typo in an attribute must not stop the panel from mounting.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // A malformed attribute is a mistake on the page, not the reporter's
    // problem. Mount without the extras rather than not at all.
  }
  return undefined;
}

function autoMount(data: DOMStringMap): void {
  const endpoint = data.endpoint;
  if (!endpoint) return;

  const locale: Locale = resolveLocale(data.locale ?? document.documentElement.lang);
  const options: MountOptions = { endpoint, locale };

  const theme = readTheme(data);
  if (theme) options.theme = theme;
  if (data.brand || data.logo) {
    options.brand = {};
    if (data.brand) options.brand.name = data.brand;
    if (data.logo) options.brand.logo = data.logo;
  }
  if (data.trigger) options.trigger = data.trigger;
  // `data-shortcut="off"` is the only way to have none: the combination is on
  // by default, so an attribute that merely set it would never be written.
  if (data.shortcut) options.shortcut = data.shortcut === "off" ? false : data.shortcut;
  // Any value opens the panel on an uncaught error; `"prefill"` also puts the
  // error message in the box.
  if (data.openOnError !== undefined) {
    options.openOnError = data.openOnError === "prefill" ? { prefill: true } : true;
  }
  // Off by default like everywhere else, so any value asks for the field and
  // `data-contact="required"` is the one value that also refuses to send
  // without it.
  if (data.contact !== undefined) {
    options.contact = data.contact === "required" ? "required" : true;
  }
  // Masking is on by default, so the attribute only exists to switch it off:
  // a page that wants the screenshot exactly as the reporter sees it says so.
  if (data.mask === "off") options.mask = false;
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
  // Any value enables the scrubber, including the empty string of a bare
  // `data-scrub` attribute — the point is that ticking it is one word.
  if (data.scrub !== undefined) options.scrub = scrubReport;
  // The key is in the page source for anyone who looks — that is the honest
  // shape of signing from a browser, and the README says so. It raises the
  // cost of a script posting to the endpoint; it authenticates nobody.
  if (data.signKey) options.sign = createSigner({ key: data.signKey });
  const extra = readExtra(data.extra);
  if (extra) options.extra = extra;

  initConsoleBuffer();
  initBreadcrumbs();
  // Any value enables the network log, the same way `data-scrub` does. It is
  // opt-in rather than on: patching fetch is a bigger promise than listening.
  if (data.network !== undefined) initNetwork({ endpoint });
  // Same shape again: any value turns the timings and the storage snapshot
  // on. Opt-in rather than on, because listing what a page has stored is a
  // bigger promise than timing it, and a script tag cannot ask first.
  if (data.perf !== undefined) initPerf();
  // Any value turns the offline queue on, the same way `data-scrub` does. The
  // queue also flushes whatever an earlier visit left behind as it is created.
  if (data.queue !== undefined) options.queue = createQueue({ endpoint });
  mount(options);
}

if (script?.dataset.endpoint) {
  const data = script.dataset;
  // The console is patched now rather than on DOMContentLoaded, so an error
  // thrown while the rest of the page is still parsing is in the buffer too.
  // The call inside `autoMount` then does nothing; it is idempotent.
  initConsoleBuffer();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => autoMount(data), { once: true });
  } else {
    autoMount(data);
  }
}
