/**
 * bugbottle.dev sits behind Cloudflare with email obfuscation on, and that
 * feature rewrites anything in a response that reads as an address.
 * `bugbottle@1.0.1` reads as one, so every jsDelivr URL the site published was
 * cut off at the `@` and an anchor spliced into the middle of the code:
 * measured on the live site 28/9 23:0x, `/` and `/da/` had two hits each and
 * `/docs/install/` one, with the sample's `src` ending at `.../npm/`. A reader
 * who copied it got code that cannot load.
 *
 * Nothing in the repository could see it. `npm run build:docs` writes the same
 * bytes either way — the rewrite happens at the edge, on the response, long
 * after the build — so the defect was invisible to every gate in CI and reached
 * the one page whose entire job is to be copied from. The way to hold a defect
 * that lives downstream of the build is to hold the *rule* instead: the HTML we
 * write may not contain a raw `@` inside a jsDelivr URL, and `protectAtIn` is
 * the only thing allowed to put one there.
 *
 * The README deliberately keeps a literal `@`. npm and GitHub render it
 * themselves and print `&#64;` verbatim inside a fenced code block, so encoding
 * it there would show the reader an entity rather than a package name. This
 * test is therefore about server-bound HTML, not about the repository at large.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { hasRawAt, protectAtIn } from "../scripts/protect-at.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function read(path: string): string {
  return readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
}

function htmlFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) out.push(...htmlFilesIn(path));
    else if (name.endsWith(".html")) out.push(path);
  }
  return out;
}

test("a jsDelivr URL is encoded so Cloudflare cannot read it as an address", () => {
  assert.equal(
    protectAtIn(`<script src="https://cdn.jsdelivr.net/npm/bugbottle@1.0.1/dist/bugbottle.js">`),
    `<script src="https://cdn.jsdelivr.net/npm/bugbottle&#64;1.0.1/dist/bugbottle.js">`,
  );
  // The `gh` form carries a `v` before the number, and is just as address-shaped.
  assert.equal(
    protectAtIn(`from "https://cdn.jsdelivr.net/gh/mahope/bugbottle@v1.0.1/dist/index.js"`),
    `from "https://cdn.jsdelivr.net/gh/mahope/bugbottle&#64;v1.0.1/dist/index.js"`,
  );
  // Two URLs on one page, because the install page has an import and a tag.
  assert.equal(
    protectAtIn(
      `https://cdn.jsdelivr.net/npm/bugbottle@1.0.1/dist/bugbottle.js and ` +
        `https://cdn.jsdelivr.net/gh/mahope/bugbottle@v1.0.1/dist/index.js`,
    ),
    `https://cdn.jsdelivr.net/npm/bugbottle&#64;1.0.1/dist/bugbottle.js and ` +
      `https://cdn.jsdelivr.net/gh/mahope/bugbottle&#64;v1.0.1/dist/index.js`,
  );
  // Everything else is left exactly as it was, including a real address: an
  // `@` that is not in a jsDelivr URL is either an address worth printing or a
  // typo, and neither is this function's business.
  assert.equal(protectAtIn("write to hello@example.com"), "write to hello@example.com");
  assert.equal(protectAtIn("a @ b"), "a @ b");
  assert.equal(hasRawAt("https://cdn.jsdelivr.net/npm/bugbottle@1.0.1/x.js"), true);
  assert.equal(hasRawAt(protectAtIn("https://cdn.jsdelivr.net/npm/bugbottle@1.0.1/x.js")), false);
});

test("no hand-written page in site/ publishes a jsDelivr URL with a raw at-sign", () => {
  /* `site/docs/` and the other generated trees are absent from a fresh
     checkout and rebuilt by the next command, so the rule for those is the
     write-site test below. What is checked here is the HTML a human edits,
     which no build step ever revisits. */
  const handWritten = htmlFilesIn("site").filter(
    (path) => !/^site\/(docs|compare|support|self-hosted)\//.test(path) &&
      !/^site\/da\/(kom-i-gang|privatliv|sammenlign)\//.test(path),
  );
  assert.ok(handWritten.length >= 2, `found the landing pages, got ${handWritten.length}`);

  const offenders = handWritten.filter((path) => hasRawAt(read(path)));
  assert.deepEqual(
    offenders,
    [],
    `Cloudflare's email obfuscation rewrites these files into a ` +
      `/cdn-cgi/l/email-protection link, so a copied script tag cannot load: ` +
      `${offenders.map((p) => relative(root, p)).join(", ")}`,
  );
});

test("every page build-docs.mjs writes goes through protectAtIn", () => {
  /* The generated pages are the majority of the ones a reader copies from, and
     a future edit that adds a fourth `writeFile(...index.html...)` would write
     unprotected HTML without touching this test — so the list of writes is read
     out of the script rather than restated here. */
  const script = read("scripts/build-docs.mjs");
  const writes = [...script.matchAll(/writeFile\(\s*join\([^)]*index\.html"\),([\s\S]{0,120}?)"utf8"/g)];

  assert.ok(writes.length >= 4, `found the four page writes, got ${writes.length}`);
  const bare = writes
    .map((m, i) => ({ i: i + 1, body: m[1]! }))
    .filter((w) => !w.body.includes("protectAtIn("));
  assert.deepEqual(
    bare.map((w) => w.i),
    [],
    `these page writes emit HTML without protectAtIn, so they are served ` +
      `with a raw @ that Cloudflare turns into a broken URL.`,
  );
});

test("the Danish way in pins the version the package is on", () => {
  /* Found in the same measurement: `/da/kom-i-gang/` pinned `bugbottle@0.9.0`
     while the package was on 1.0.1 — two releases and a whole major old, on the
     page whose promise is that it is the one Danish route in. `release.mjs`
     rewrites that pin, but only when it is the run that bumps the version, and
     a release made by hand skips it: 1.0.0 and 1.0.1 both did. */
  const version = JSON.parse(read("package.json")).version as string;
  const pins = [...read("site/da/kom-i-gang.md").matchAll(/bugbottle@([\d.]+)/g)].map(
    (m) => m[1]!,
  );

  assert.ok(pins.length > 0, "the Danish getting-started page pins a version");
  assert.deepEqual(
    [...new Set(pins)],
    [version],
    `site/da/kom-i-gang.md pins ${[...new Set(pins)].join(", ")} while the package is on ${version}. ` +
      `A reader copies that tag and loads a build that old.`,
  );
});
