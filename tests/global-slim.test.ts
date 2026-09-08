import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { build } from "esbuild";

/**
 * The slim script-tag build: the same panel as `dist/bugbottle.js` without the
 * annotator, the timings snapshot, the shake gesture and the network log.
 *
 * The bundle is built here rather than read out of `dist/`, because the tests
 * run before the build in `npm run check` and a committed artefact would only
 * tell us what the last build did. This is the same esbuild call
 * `scripts/build-iife.mjs` makes, so what is asserted below is what ships.
 */
const bundled = await build({
  entryPoints: ["src/global-slim.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  legalComments: "none",
  define: { __BUGBOTTLE_VERSION__: JSON.stringify("0.0.0-test") },
  write: false,
});
const code = bundled.outputFiles[0]!.text;

interface Loaded {
  api: Record<string, unknown>;
  warnings: string[];
  close: () => void;
}

/**
 * Run the bundle in a fresh document as a real script tag, so it reaches its
 * own `document.currentScript` and reads the attributes off it exactly as it
 * would on a page.
 */
function load(attributes: Record<string, string>): Loaded {
  // Evaluation is off by default in happy-dom, and rightly so; the only code
  // this window ever runs is the bundle built above, out of this repository.
  const win = new Window({
    url: "https://example.test/orders",
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
  const doc = win.document;
  const warnings: string[] = [];
  win.console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  const script = doc.createElement("script");
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  script.text = code;
  doc.head.appendChild(script);
  // A script appended after parsing has finished never sees DOMContentLoaded,
  // so the build mounts straight away; this only matters if happy-dom ever
  // reports the document as still loading.
  if (doc.readyState === "loading") {
    doc.dispatchEvent(new win.Event("DOMContentLoaded"));
  }

  const api = (win as unknown as { bugbottle?: Record<string, unknown> }).bugbottle;
  assert.ok(api, "the bundle did not put anything on window.bugbottle");
  return { api, warnings, close: () => void win.close() };
}

test("the slim build leaves the four optional recorders out of the namespace", () => {
  const { api, close } = load({ "data-endpoint": "https://example.test/report" });
  for (const missing of ["createAnnotator", "initPerf", "onShake", "requestShakePermission",
    "initNetwork"]) {
    assert.equal(api[missing], undefined, `${missing} is in the slim build`);
  }
  close();
});

test("the slim build still carries the panel, the recorders it keeps and every locale", () => {
  const { api, close } = load({ "data-endpoint": "https://example.test/report" });
  for (const kept of ["mount", "mountBugbottle", "initConsoleBuffer", "initBreadcrumbs",
    "createQueue", "resolveLocale", "scrubReport", "createSigner", "buildReport", "sendReport",
    "pickElement", "onShortcut", "onUncaughtError"]) {
    assert.equal(typeof api[kept], "function", `${kept} is missing from the slim build`);
  }
  // Locales are data and eight of them cost about three kilobytes: dropping
  // them would save little and break `data-locale` for everyone not in English.
  const locales = api.locales as Record<string, unknown>;
  assert.deepEqual(Object.keys(locales).sort(), ["da", "de", "en", "es", "fr", "nb", "nl", "sv"]);
  close();
});

test("an attribute the slim build ignores is warned about once, in English", () => {
  const { warnings, close } = load({
    "data-endpoint": "https://example.test/report",
    "data-perf": "",
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /^bugbottle: the slim build ignores data-perf\./);
  assert.match(warnings[0]!, /Load dist\/bugbottle\.js instead/);
  close();
});

test("every ignored attribute present is named in the one warning", () => {
  const { warnings, close } = load({
    "data-endpoint": "https://example.test/report",
    "data-annotate": "off",
    "data-network": "",
    "data-shake": "12",
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /data-annotate, data-shake, data-network/);
  close();
});

test("a page that asks for nothing the slim build lacks is not warned at", () => {
  const { warnings, close } = load({
    "data-endpoint": "https://example.test/report",
    "data-locale": "da",
    "data-queue": "",
    "data-scrub": "",
    "data-contact": "required",
  });
  assert.deepEqual(warnings, []);
  close();
});
