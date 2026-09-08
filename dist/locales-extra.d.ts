/**
 * Five more languages in the same `Locale` shape, in their own entry point.
 *
 * `bugbottle/locales` is data, and data is carried whole: every bundle that
 * imports it pays for every language in it. Italy, Poland, Portugal, Finland
 * and Ukraine should not cost a Danish site anything, so they live here and are
 * imported on purpose. Merge them into the bundled map and `resolveLocale`
 * reads both:
 *
 *     import { en, locales, resolveLocale } from "bugbottle/locales";
 *     import { localesExtra } from "bugbottle/locales-extra";
 *
 *     const all = { ...locales, ...localesExtra };
 *     mountBugbottle({ endpoint, locale: resolveLocale(navigator.language, en, all) });
 *
 * Or import the one language the site is in — `import { pl }` — and nothing
 * else reaches the bundle.
 *
 * `pt` is European Portuguese. `pt-BR` resolves to it, because a Brazilian
 * reporter is better served by Portuguese than by the English fallback; the
 * two differ in this text mainly in the progressive ("a enviar" against
 * "enviando") and in where a pronoun sits.
 */
import type { Locale } from "./locales.ts";
export declare const it: Locale;
export declare const pl: Locale;
export declare const pt: Locale;
export declare const fi: Locale;
export declare const uk: Locale;
/** The five optional locales, keyed by code, to merge into `locales`. */
export declare const localesExtra: Record<string, Locale>;
//# sourceMappingURL=locales-extra.d.ts.map