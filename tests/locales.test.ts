import { test } from "node:test";
import assert from "node:assert/strict";
import { locales, en, da, resolveLocale, sentLine } from "../src/locales.ts";
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

test("a language tag naming an inherited property falls back", () => {
  // `resolveLocale(new URLSearchParams(location.search).get("lang"))` is the
  // ordinary way to call this, so the tag is whatever was in the URL. A plain
  // bracket read finds `Object.prototype` for `__proto__`, and the panel then
  // throws on `locale.ui.title` at mount rather than showing English.
  for (const tag of ["__proto__", "constructor", "prototype", "hasOwnProperty"]) {
    assert.equal(resolveLocale(tag), en, `${tag} is not a language`);
    assert.equal(resolveLocale(tag, da), da, `${tag} is not a language`);
    assert.equal(resolveLocale(tag, en, all), en, `${tag} is not a language`);
  }
  // The region is dropped from one of these too, and finds nothing either.
  assert.equal(resolveLocale("__proto__-DK"), en);
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

test("the confirmation carries the reference the server answered with", () => {
  assert.equal(sentLine(en.messages, "rep_42"), `${en.messages.sent}. Reference: rep_42`);
  // In the reporter's own language, in all thirteen, since every locale
  // defines it — the parity test above is what holds them to that.
  for (const [code, locale] of Object.entries(all)) {
    const line = sentLine(locale.messages, "rep_42");
    assert.ok(line.includes("rep_42"), `${code} names the reference`);
    assert.ok(line.length > locale.messages.sent.length, `${code} says more than the plain line`);
  }
});

test("no reference to show leaves the plain sentence rather than a blank", () => {
  // An endpoint that answers no id, which is the honest default: the report
  // arrived and the server had nothing to call it.
  assert.equal(sentLine(en.messages, undefined), en.messages.sent);
  assert.equal(sentLine(en.messages, ""), en.messages.sent);
  assert.equal(sentLine(en.messages, "   "), en.messages.sent);
  // A hand-written `Messages` from before `sentWithId` existed. The key is
  // optional for exactly this, so such a locale keeps working and simply
  // confirms without a reference.
  assert.equal(sentLine({ ...en.messages, sentWithId: undefined }, "rep_42"), en.messages.sent);
});

test("an id too long to be a reference is left out, not shown clipped", () => {
  // Half a reference finds nothing and still reads as though the real one is
  // in hand, which is worse than showing nothing.
  assert.equal(sentLine(en.messages, "r".repeat(64)), `${en.messages.sent}. Reference: ${"r".repeat(64)}`);
  assert.equal(sentLine(en.messages, "r".repeat(65)), en.messages.sent);
});

test("a null byte in the id is dropped rather than read out", () => {
  // The id is the response body of somebody's endpoint, so it is untrusted
  // text that is about to be spoken by a screen reader.
  assert.equal(
    sentLine(en.messages, `rep${String.fromCharCode(0)}_42`),
    `${en.messages.sent}. Reference: rep_42`,
  );
});
