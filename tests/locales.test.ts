import { test } from "node:test";
import assert from "node:assert/strict";
import { locales, en, da, resolveLocale } from "../src/locales.ts";

/** Flattens `{ a: { b: "x" } }` to `["a.b"]`, so two locales can be compared by shape. */
function keys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

test("every bundled locale has exactly the same keys as English", () => {
  const reference = keys(en).sort();
  for (const [code, locale] of Object.entries(locales)) {
    assert.deepEqual(keys(locale).sort(), reference, `${code} matches the English shape`);
    assert.equal(locale.code, code, `${code} carries its own code`);
  }
});

test("no bundled string is empty except intro, which may be", () => {
  for (const [code, locale] of Object.entries(locales)) {
    for (const path of keys(locale)) {
      if (path === "intro" || path === "ui.intro" || path === "dir") continue;
      const value = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], locale);
      assert.ok(typeof value === "string" && value.trim().length > 0, `${code}: ${path} is set`);
    }
  }
});

test("a language tag resolves to the bundled locale or falls back", () => {
  assert.equal(resolveLocale("da-DK"), da);
  assert.equal(resolveLocale("DA"), da);
  assert.equal(resolveLocale("pt-BR"), en);
  assert.equal(resolveLocale(undefined), en);
  assert.equal(resolveLocale(null, da), da);
  assert.equal(resolveLocale("xx", da), da);
});
