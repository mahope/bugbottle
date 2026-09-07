import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { collectContext } from "../src/capture.ts";

/**
 * `collectContext` reads a handful of facts off the browser, and every one of
 * them past the user agent is optional: a browser that does not offer it must
 * leave the key out rather than send an empty string. That needs a real
 * `window` to read from, so happy-dom is installed on `globalThis` the same way
 * `mask.test.ts` installs it, and the individual facts are stubbed on top of it
 * — happy-dom has no Network Information API, and its `matchMedia` answers for
 * a light theme.
 */
const win = new Window({ url: "https://example.test/orders/42?tab=notes#internal" });
const globals = globalThis as unknown as Record<string, unknown>;
const forced = new Set(["window", "document"]);
for (const key of Object.getOwnPropertyNames(win)) {
  if (key.startsWith("_")) continue;
  if (!forced.has(key) && key in globals) continue;
  try {
    globals[key] = (win as unknown as Record<string, unknown>)[key];
  } catch {
    // Getter-only properties of the window; none of them matter here.
  }
}

after(() => {
  for (const key of ["window", "document"]) delete globals[key];
});

const windowUnderTest = globals.window as unknown as Record<string, unknown>;

/**
 * Replaces properties of the fake window for one call and puts them back.
 * Several of them are getter-only on a happy-dom window, so each is redefined
 * rather than assigned, and the original descriptor is restored afterwards.
 */
function withWindow<T>(patch: Record<string, unknown>, fn: () => T): T {
  const before = Object.keys(patch).map(
    (key) => [key, Object.getOwnPropertyDescriptor(windowUnderTest, key)] as const,
  );
  for (const [key, value] of Object.entries(patch)) {
    Object.defineProperty(windowUnderTest, key, { value, configurable: true, writable: true });
  }
  try {
    return fn();
  } finally {
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(windowUnderTest, key, descriptor);
      else delete windowUnderTest[key];
    }
  }
}

test("the page is the path and query, never the origin or the fragment", () => {
  const context = collectContext();
  assert.equal(context.url, "/orders/42?tab=notes");
  assert.match(context.viewport, /^\d+x\d+$/);
  assert.ok(context.userAgent.length > 0);
});

test("the optional facts are collected when the browser offers them", () => {
  const context = withWindow(
    {
      devicePixelRatio: 2,
      screen: { width: 2560, height: 1440 },
      matchMedia: (query: string) => ({ matches: query.includes("dark") }),
    },
    () => collectContext(),
  );
  assert.equal(context.screen, "2560x1440@2");
  assert.equal(context.colorScheme, "dark");
  assert.equal(context.online, true, "happy-dom reports a browser that believes it is online");
  assert.ok(context.language && context.language.length > 0);
  // The zone comes from the runtime rather than the DOM, so only its shape is
  // asserted: a test that pinned it would fail on a machine set to another one.
  assert.match(String(context.timezone), /^[A-Za-z]+(\/[A-Za-z_+\-0-9]+)*$/);
  assert.equal(context.connection, undefined, "happy-dom has no Network Information API");
});

test("a light theme is recorded as such, not left out", () => {
  const context = withWindow(
    { matchMedia: (query: string) => ({ matches: !query.includes("dark") }) },
    () => collectContext(),
  );
  assert.equal(context.colorScheme, "light");
});

test("the effective connection type is carried through when there is one", () => {
  const nav = windowUnderTest.navigator as Record<string, unknown>;
  Object.defineProperty(nav, "connection", {
    value: { effectiveType: "4g" },
    configurable: true,
  });
  try {
    assert.equal(collectContext().connection, "4g");
  } finally {
    delete nav.connection;
  }
});

test("a browser that offers nothing optional still gives the three required fields", () => {
  const context = withWindow(
    {
      screen: undefined,
      matchMedia: undefined,
      devicePixelRatio: undefined,
    },
    () => collectContext(),
  );
  assert.equal(context.screen, undefined);
  assert.equal(context.colorScheme, undefined);
  assert.equal(context.url, "/orders/42?tab=notes");
  assert.ok(context.userAgent.length > 0);
});

test("a matchMedia that throws does not cost the rest of the context", () => {
  const context = withWindow(
    {
      matchMedia: () => {
        throw new Error("unsupported media query");
      },
    },
    () => collectContext(),
  );
  assert.equal(context.colorScheme, undefined);
  assert.equal(context.online, true, "the facts after it are still collected");
});

test("outside a browser the context is empty rather than a throw", () => {
  const realWindow = globals.window;
  delete globals.window;
  try {
    assert.deepEqual(collectContext(), { url: "", viewport: "", userAgent: "" });
  } finally {
    globals.window = realWindow;
  }
});
