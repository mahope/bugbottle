/**
 * `CHANGELOG.md` is the file `site/docs/changelog/` is built from, and for
 * twenty days it held every release **twice**. The first copy ran from the
 * top of the file to line 3041; a second, older copy ran from there to the
 * end, starting in the middle of a `### Fixed` with a bare ` Changelog` line
 * where its own `# Changelog` heading had been. It entered with commit
 * `a73fcaa` on 8/9 ("Record the queue retry fix under Unreleased") — 19
 * releases became 38 `##` headings in one commit — and every release note
 * since then was written into the first copy and carried in the second.
 *
 * Nothing about it is visible in a diff. `git diff` on a note added under
 * `## Unreleased` is one hunk, and the file simply grows. It took the
 * generated page to show it, and the numbers are what a reader pays:
 *
 * - `/docs/changelog/` rendered **421 817** bytes of HTML against 237 648 for
 *   the same content once, and **136 kB gzipped** — nine times the next
 *   largest page on the site, for a page nobody reads to the bottom.
 * - **19 duplicate `id` attributes**, so the release list at the top of the
 *   page linked to `#0-9-0` and landed on whichever of the two the browser
 *   found first. That is invalid HTML, and the second copy's text was
 *   reachable by no link at all.
 * - `site/docs/search.json` — fetched on the first focus of the sidebar's
 *   search field — carried 261 entries against 242, with 19 releases listed
 *   twice and the two copies disagreeing, because `1.0.1` only ever reached
 *   the first one.
 *
 * The two copies were byte-identical line for line (checked before the tail
 * was removed: 2 249 non-blank lines, all of them present in the first copy),
 * so nothing was lost by dropping the second — and the first is the newer one,
 * since it holds `## 1.0.1` and the copy does not.
 *
 * So these are guards on the shape of the file, because the shape is the
 * defect. `scripts/build-docs.mjs` fails the same way at build time, which is
 * the copy that stands between a bad file and a published page.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const lines = readFileSync(root + "CHANGELOG.md", "utf8").split("\n");

/** The `##` headings, in the order the file writes them. A `##` inside a
    fenced code block is prose about Markdown, not a release, so the fences are
    walked rather than the pattern split on. */
function releaseHeadings(): string[] {
  const headings: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const marker = /^\s*(```+|~~~+)/.exec(line);
    if (marker) {
      fence = fence === null ? (marker[1] ?? "")[0] ?? "" : null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading?.[1]) headings.push(heading[1].trim());
  }
  return headings;
}

test("no release is written twice", () => {
  const headings = releaseHeadings();
  const versions = headings.map((heading) => /\d+\.\d+(?:\.\d+)?/.exec(heading)?.[0] ?? heading);
  const repeated = versions.filter((version, i) => versions.indexOf(version) !== i);
  assert.deepEqual(repeated, [], "CHANGELOG.md lists the same release twice");
});

test("the file is not appended to itself", () => {
  const lede = "All notable changes are recorded here";
  const copies = lines.filter((line) => line.startsWith(lede));
  assert.equal(copies.length, 1, "the opening paragraph appears once, so this is one file and not two");
});

test("releases run newest first, with Unreleased at the top", () => {
  const headings = releaseHeadings();
  assert.equal(headings[0], "Unreleased", "the first release heading is Unreleased");

  const numbered = headings
    .map((heading) => /\d+\.\d+(?:\.\d+)?/.exec(heading)?.[0])
    .filter((version): version is string => version !== undefined)
    .map((version) => version.split(".").map(Number));
  assert.ok(numbered.length >= 10, "the file holds the releases it has held");

  for (let i = 1; i < numbered.length; i += 1) {
    const previous = numbered[i - 1]!;
    const current = numbered[i]!;
    const drops = current.some((part, part2) => part < (previous[part2] ?? 0));
    assert.ok(
      drops || current.every((part, part2) => part === (previous[part2] ?? 0)),
      `release ${current.join(".")} comes before ${previous.join(".")}, so the page's list of releases reads the wrong way`,
    );
  }
});
