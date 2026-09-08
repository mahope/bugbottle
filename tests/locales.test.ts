import { test } from "node:test";
import assert from "node:assert/strict";
import { locales, en, da, resolveLocale } from "../src/locales.ts";
import { localesExtra, pt } from "../src/locales-extra.ts";

/** The eight bundled languages and the five optional ones, in one map. */
const all = { ...locales, ...localesExtra };

/** Flattens `{ a: { b: "x" } }` to `["a.b"]`, so two locales can be compared by shape. */
function keys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

test("every locale, bundled or optional, has exactly the same keys as English", () => {
  const reference = keys(en).sort();
  for (const [code, locale] of Object.entries(all)) {
    assert.deepEqual(keys(locale).sort(), reference, `${code} matches the English shape`);
    assert.equal(locale.code, code, `${code} carries its own code`);
  }
});

test("no string is empty except intro, which may be", () => {
  for (const [code, locale] of Object.entries(all)) {
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

test("a merged map reaches the optional languages, and pt-BR lands on pt", () => {
  assert.equal(resolveLocale("pt", en, all), pt);
  assert.equal(resolveLocale("pt-BR", en, all), pt);
  assert.equal(resolveLocale("PT-br", en, all), pt);
  assert.equal(resolveLocale("uk-UA", en, all), all["uk"]);
  // One language on its own is a map too, and everything else falls back.
  assert.equal(resolveLocale("fi", en, { fi: all["fi"]! }), all["fi"]);
  assert.equal(resolveLocale("pl", en, { fi: all["fi"]! }), en);
  // The default map is untouched: nothing here reaches `bugbottle/locales`.
  assert.equal(resolveLocale("pt-BR"), en);
});
