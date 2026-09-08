/**
 * What the two script-tag entries have in common: the `data-*` reading and the
 * boot.
 *
 * There are two IIFEs — `dist/bugbottle.js` carries everything,
 * `dist/bugbottle.slim.js` leaves out the annotator, the timings snapshot, the
 * shake gesture and the network log — and they must read the same attributes
 * the same way. This module is that reading, written once. Only the attributes
 * both builds honour live here; each entry adds its own on top.
 *
 * Like `src/global.ts` it is excluded from the tsc emit: it is only ever
 * consumed through esbuild.
 */

import { initBreadcrumbs } from "./breadcrumbs.ts";
import { initConsoleBuffer } from "./console-buffer.ts";
import { resolveLocale, type Locale } from "./locales.ts";
import { createQueue } from "./queue.ts";
import { scrubReport } from "./scrub.ts";
import { createSigner } from "./sign.ts";
import type { MountOptions, Theme } from "./ui/index.ts";

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

/**
 * The mount options both builds read out of the script tag, and the two
 * recorders both of them start. The caller has already established that
 * `data-endpoint` is there; what it adds afterwards is the difference between
 * the builds.
 */
export function readOptions(data: DOMStringMap, endpoint: string): MountOptions {
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
  // Any value turns the offline queue on, the same way `data-scrub` does. The
  // queue also flushes whatever an earlier visit left behind as it is created.
  // The signer goes with it, because the queue POSTs with a `fetch` of its own
  // and would otherwise deliver unsigned to an endpoint that requires a
  // signature — losing precisely the reports the queue was turned on for.
  if (data.queue !== undefined) {
    options.queue = createQueue({ endpoint, ...(options.sign ? { sign: options.sign } : {}) });
  }
  return options;
}

/**
 * The boot: find the script element that is running us, and hand its dataset
 * to `autoMount` once the document has a body to mount into.
 *
 * `document.currentScript` is only set while the script evaluates, so this has
 * to be called at the top level of an entry, not later.
 *
 * `preflight` runs before the console is patched. Anything a build has to say
 * about the page's attributes is a message to the developer, and saying it
 * first keeps it out of the ring buffer and so out of every report.
 */
export function bootstrap(
  autoMount: (data: DOMStringMap) => void,
  preflight?: (data: DOMStringMap) => void,
): void {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script?.dataset.endpoint) return;
  const data = script.dataset;
  preflight?.(data);
  // The console is patched now rather than on DOMContentLoaded, so an error
  // thrown while the rest of the page is still parsing is in the buffer too.
  // The call inside `readOptions` then does nothing; it is idempotent.
  initConsoleBuffer();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => autoMount(data), { once: true });
  } else {
    autoMount(data);
  }
}
