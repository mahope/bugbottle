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

import { initBreadcrumbs } from "./breadcrumbs.ts";
import { initConsoleBuffer } from "./console-buffer.ts";
import { pickElement } from "./element-picker.ts";
import { locales, resolveLocale, type Locale } from "./locales.ts";
import { scrubReport } from "./scrub.ts";
import { buildReport, sendReport } from "./send.ts";
import { mountBugbottle, type MountOptions, type Theme } from "./ui/index.ts";

/** Replaced by esbuild with the version in `package.json`. */
declare const __BUGBOTTLE_VERSION__: string;

const api = {
  version: __BUGBOTTLE_VERSION__,
  mount: mountBugbottle,
  mountBugbottle,
  initConsoleBuffer,
  initBreadcrumbs,
  locales,
  resolveLocale,
  scrubReport,
  buildReport,
  sendReport,
  pickElement,
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
  // Masking is on by default, so the attribute only exists to switch it off:
  // a page that wants the screenshot exactly as the reporter sees it says so.
  if (data.mask === "off") options.mask = false;
  // Any value enables the scrubber, including the empty string of a bare
  // `data-scrub` attribute — the point is that ticking it is one word.
  if (data.scrub !== undefined) options.scrub = scrubReport;
  const extra = readExtra(data.extra);
  if (extra) options.extra = extra;

  initConsoleBuffer();
  initBreadcrumbs();
  mountBugbottle(options);
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
