/**
 * `package.json`'s `description` and `keywords` are the only two fields that
 * decide whether anybody finds this package, because they are the only two
 * npm's search index reads. That is measured, not assumed, and the measurement
 * is in `IMPLEMENTATION_PLAN.md` under "Fund fra npm-search-iterationen":
 *
 * - npm's `/-/v1/search` ranks `bugbottle` **1** of 1 155 126 for the phrase
 *   `Your UI your endpoint` and **2** of 20 859 for `evidence attached` — both
 *   sentences out of the *description*. So the description is what finds us.
 * - The same index does **not** read the README. `checkoutEveryNms` occurs
 *   eleven times in our README and the query returns exactly one package, which
 *   is not us; `MAX_MESSAGE_LENGTH` returns three, none of them us. A better
 *   README moves stars and the reader on npmjs.com, but it cannot move this
 *   ranking, and an earlier iteration had assumed it would.
 * - `sentry alternative` is winnable — 24 022 results, not 1.1 million — and
 *   the two packages that rank there, `@mizchi/utels` and `quto-logger`, both
 *   carry the hyphenated keyword `sentry-alternative` *and* the words
 *   "Sentry alternative" in the description. Ours carried neither, which is
 *   the whole of this change.
 *
 * So these tests pin the two fields against the terms the search actually
 * matches. They cannot prove a rank, because a rank is npm's and npm's
 * changes; what they can do is fail when a reword drops a term, which is the
 * failure mode that has actually happened.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(root + "package.json", "utf8")) as {
  description: string;
  keywords: string[];
};

/**
 * The longest description npm demonstrably serves, measured across twenty
 * widely-installed packages on 28/9: `webpack` at 239 characters, and no
 * longer among `eslint`, `typescript`, `react`, `express`, `axios`, `jest`,
 * `vite`, `rollup`, `@babel/core`, `lodash`, `next`, `vue`, `svelte`,
 * `tailwindcss`, `prisma`, `storybook`, `turbo`, `pnpm` and `yarn`. 200 is
 * under the observed maximum with room to spare, so the description below it
 * is served whole and is not clipped into a sentence that ends mid-word.
 */
const MAX_DESCRIPTION = 200;

test("the description is short enough that npm serves it whole", () => {
  assert.ok(
    pkg.description.length <= MAX_DESCRIPTION,
    `the description is ${pkg.description.length} characters, over the ${MAX_DESCRIPTION} npm is known to serve whole; ` +
      "a clipped description ends mid-word on the package page",
  );
});

test("the description says what the package is", () => {
  // A description that only chases terms stops describing the thing, and the
  // reader who arrives is looking at npmjs.com, not at a ranking. These are
  // what a stranger cannot work out from the name `bugbottle`: that it reports
  // bugs, that it runs in the page the reader is already looking at, and what
  // travels with the report.
  for (const phrase of ["bug reporting", "in-app", "console errors", "screenshot", "page context"]) {
    assert.ok(
      pkg.description.toLowerCase().includes(phrase.toLowerCase()),
      `the description no longer says "${phrase}": ${pkg.description}`,
    );
  }
});

test("the description carries the terms the search matches", () => {
  // Each of these is a phrase somebody types, and npm's index matches on the
  // description, so a reword that drops one is a silent loss of a query. The
  // hyphenated forms belong in `keywords` instead and are pinned below.
  for (const phrase of [
    "sentry alternative",
    "self-hosted",
    "bug reporting",
    "user feedback",
  ]) {
    assert.ok(
      pkg.description.toLowerCase().includes(phrase.toLowerCase()),
      `the description no longer carries "${phrase}": ${pkg.description}`,
    );
  }
});

test("the description keeps the tagline that ranks", () => {
  // `Your UI your endpoint` is the one phrase measured at rank 1 of 1 155 126.
  // It is the last sentence because that is where the ranking puts it without
  // costing the terms above it a position, but it is still the sentence a
  // stranger remembers, and losing it is the kind of edit that looks free.
  assert.ok(
    pkg.description.includes("Your UI, your endpoint."),
    `the tagline is gone: ${pkg.description}`,
  );
});

test("the keywords carry the hyphenated terms the description cannot", () => {
  // `sentry-alternative` is the token `@mizchi/utels` and `quto-logger` both
  // hold, and it is the form npm indexes: a query for it has no space in it,
  // so the two-word phrase in the description is not the same match.
  for (const keyword of [
    "sentry-alternative",
    "self-hosted",
    "error-reporting",
    "error-tracking",
  ]) {
    assert.ok(
      pkg.keywords.includes(keyword),
      `the keyword "${keyword}" is gone: ${pkg.keywords.join(", ")}`,
    );
  }
});

test("every keyword is a lowercase token npm can match, and none is repeated", () => {
  // npm lower-cases and de-duplicates the list itself, so a keyword that
  // differs only in case is a slot spent on nothing and a duplicate is a
  // quieter version of the same mistake.
  for (const keyword of pkg.keywords) {
    assert.equal(keyword, keyword.toLowerCase(), `"${keyword}" is not lowercase`);
    assert.match(keyword, /^[a-z0-9]+(-[a-z0-9]+)*$/, `"${keyword}" is not a plain token`);
  }
  assert.equal(
    new Set(pkg.keywords).size,
    pkg.keywords.length,
    `a keyword is repeated: ${pkg.keywords.join(", ")}`,
  );
});
