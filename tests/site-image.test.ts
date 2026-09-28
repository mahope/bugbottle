/**
 * The site image is built from the repository root, and its docs stage copies
 * in a hand-written list of files rather than the whole tree. That list is the
 * only thing standing between a new Markdown page and a build that fails, and
 * nothing was watching it: `/support/` was added to the repo on 27/9 23:32
 * without a `COPY` to match, and the site image has not built since. Every
 * page committed after that point — ten of them, plus a changelog and a
 * sitemap that shrank from 57 entries to 47 — was written, committed, gated
 * green and never reached a visitor.
 *
 * `ERR_MODULE_NOT_FOUND` for `page-descriptions.mjs` (28/9 03:22) is the same
 * bug in a different file, and it is the reason a green `npm run build:docs`
 * says nothing about the image: locally the whole repository is present, so
 * the script finds every file it imports. Only the image sees the short list.
 *
 * So the two lists are compared here, in the same spirit as
 * `readme-snippets.test.ts`: read the repository rather than `dist/`, and
 * derive both sides from the sources instead of restating them, so a page
 * added in `STANDALONE` fails the suite until the Dockerfile names it.
 *
 * There are now three families rather than two, and the third arrived on the
 * day the second was fixed. `build-docs.mjs` also reads the *pictures* the
 * README points at, to measure them — and a picture it cannot read is not a
 * failed build but a rendered page without the intrinsic `width`/`height`
 * that keep the text under it from jumping. Same list, same cause, a third of
 * the symptoms, and the quietest of the three.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function read(path: string): string {
  return readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
}

const dockerfile = read("site/Dockerfile");
const buildDocs = read("scripts/build-docs.mjs");
const readme = read("README.md");

/**
 * The source paths of every `COPY` line in the **builder** stage — the one that
 * runs `build-docs.mjs` — the last token on each line being the destination
 * rather than a source. Builder-stage inputs are the lines without `--from`,
 * since that names what the *previous* stage produced rather than something the
 * build has to be given.
 *
 * Scoped to the builder stage on purpose, and that is not tidiness. Both
 * stages copy `site/panel-narrow.png` — the served stage has to, or the picture
 * is a 404, and the builder stage has to, or the docs build cannot measure it —
 * so a set gathered from the whole file answers "yes it is copied" while the
 * stage that needs it is the one missing. The first version of the picture test
 * did exactly that and passed against the bug it was written for.
 */
function copiedSources(): Set<string> {
  const sources = new Set<string>();
  for (const line of builderStageLines()) {
    const match = /^COPY\s+(.*)$/.exec(line.trim());
    if (!match?.[1] || match[1].startsWith("--from=")) continue;
    for (const token of match[1].split(/\s+/).slice(0, -1)) {
      if (token) sources.add(token);
    }
  }
  return sources;
}

/** Everything from the `FROM` that starts the docs stage to the next `FROM`. */
function builderStageLines(): string[] {
  const lines = dockerfile.split("\n");
  const start = lines.findIndex((line) => /^FROM\s+\S+\s+AS\s+docs\s*$/i.test(line.trim()));
  assert.ok(start >= 0, "site/Dockerfile has no `FROM … AS docs` stage to read the inputs of");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^FROM\s/i.test(line.trim()));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The generated directories the served stage copies out of the builder, as
 * paths under `/build/site/`. This is the other half of a `STANDALONE` entry:
 * the entry point above feeds the build, this one is what nginx ends up
 * serving, and a page missing from this list is a 404 that no build failure
 * points at.
 */
function servedOutputs(): Set<string> {
  const sources = new Set<string>();
  for (const line of dockerfile.split("\n")) {
    const match = /^COPY\s+--from=docs\s+(.*)$/.exec(line.trim());
    if (!match?.[1]) continue;
    for (const token of match[1].split(/\s+/).slice(0, -1)) {
      if (token) sources.add(token);
    }
  }
  return sources;
}

/** The `source:` and `out:` of every `STANDALONE` entry, joined as `join()` builds them. */
function standaloneEntries(): { source: string; out: string }[] {
  const block = /^const STANDALONE = \[([\s\S]*?)^\];/m.exec(buildDocs)?.[1] ?? "";
  const join = (args: string): string =>
    args
      .split(",")
      .map((part) => part.trim().replace(/^"|"$/g, ""))
      .join("/");
  return [...block.matchAll(/source:\s*join\(([^)]*)\),[\s\S]*?out:\s*join\(([^)]*)\)/g)].map(
    (m) => ({ source: join(m[1]!), out: join(m[2]!) }),
  );
}

test("every page the docs build reads from site/ is copied into the image", () => {
  const copied = copiedSources();
  const sources = standaloneEntries().map((entry) => entry.source);
  assert.ok(sources.length > 0, "no STANDALONE sources parsed — the test is not reading them");

  const missing = sources.filter((source) => !copied.has(source));
  assert.deepEqual(
    missing,
    [],
    `site/Dockerfile does not copy ${missing.join(", ")}: the docs stage runs ` +
      `build-docs.mjs, which reads each of them, and a source it cannot read is ` +
      `a build that fails. That is what kept the site on a 13-hour-old image.`,
  );
});

test("every page the docs build generates is served by the image", () => {
  const served = servedOutputs();
  const outputs = standaloneEntries().map((entry) => entry.out);
  assert.ok(outputs.length > 0, "no STANDALONE outputs parsed — the test is not reading them");

  const missing = outputs.filter((out) => !served.has(`/build/site/${out}/`));
  assert.deepEqual(
    missing,
    [],
    `site/Dockerfile generates ${missing.join(", ")} and never copies it out ` +
      `of the builder stage, so the image builds and the page is still a 404. ` +
      `Nothing else in the build notices: only a request for the page does.`,
  );
});

test("every script the docs build imports is copied into the image", () => {
  const copied = copiedSources();
  const imported = [...buildDocs.matchAll(/from\s+"(\.\/[\w.-]+\.mjs)"/g)].map((m) =>
    `scripts/${m[1]!.replace(/^\.\//, "")}`,
  );
  assert.ok(imported.length > 0, "no local imports parsed — the test is not reading them");

  const missing = imported.filter((path) => !copied.has(path));
  assert.deepEqual(
    missing,
    [],
    `site/Dockerfile does not copy ${missing.join(", ")}: the entry point is ` +
      `copied but what it imports is not, so the docs stage dies with ` +
      `ERR_MODULE_NOT_FOUND while the same command passes locally.`,
  );
});

test("the files the docs build reads outside site/ are copied into the image", () => {
  const copied = copiedSources();
  // Named in the script's own source rather than derived from it, because
  // these are plain literals in three separate readFile calls rather than a
  // list. Each is a file whose absence fails the build the same way.
  for (const path of ["README.md", "package.json", "CHANGELOG.md"]) {
    assert.ok(copied.has(path), `site/Dockerfile does not copy ${path}, which the docs build reads`);
  }
});

test("every picture the docs build measures is copied into the image", () => {
  const copied = copiedSources();
  /* The same third family as the two tests above, and it is a *quieter* one
     than either. `build-docs.mjs` reads a picture's own PNG header to give the
     `<img>` its intrinsic `width` and `height`, so that the text under it
     cannot jump once the file loads — the layout shift the performance floor in
     CLAUDE.md is about. A picture the docs stage cannot read is not an error:
     `pngSize` catches it and omits the attributes, the page still serves the
     picture, and every page still builds. Nothing in a green build says the
     size is gone, which is how `/docs/install/` served the panel without it
     for a whole deploy window while the repository build had both.

     Read from the README rather than written down, so the second picture on
     this site is covered by the same rule as the first. */
  const own = [...readme.matchAll(/!\[[^\]]*\]\(https:\/\/bugbottle\.dev\/([^)\s]+)\)/g)].map(
    (m) => `site/${m[1]!}`,
  );
  assert.ok(own.length > 0, "the README points at at least one picture on this site");

  const missing = own.filter((path) => !copied.has(path));
  assert.deepEqual(
    missing,
    [],
    `site/Dockerfile does not copy ${missing.join(", ")}, so the docs stage renders ` +
      `those pictures without their intrinsic width and height: the page still ` +
      `serves the picture and the build still passes, so only a request for the ` +
      `page shows it.`,
  );
});
