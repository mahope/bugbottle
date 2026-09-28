/**
 * The README's code is the code people paste, and nothing in the build can
 * tell a snippet that runs from a snippet that 500s. This file pins the two
 * kinds of snippet that have actually been wrong.
 *
 * The first is `fileStore` (#33). It answers an *object* — `store`, `list`,
 * `read`, `remove`, `prune`, `refresh` — while `handleReport`'s `store` option
 * is a function it calls. Six snippets passed the object straight in, on the
 * Hono, Express, Fastify, NestJS and GitLab pages and in the opening, and a
 * reader who pasted one got a `TypeError` and a 500 with no report. The API
 * section said "whose store answers `store`", so the type was documented and
 * the examples were not; the first test below is the trap itself, and the
 * second is the six.
 *
 * The second is the opening (#33), which is also `/docs/install/`. It is the
 * one part of the README a reader arrives at *instead* of reading the rest,
 * and it had no line in it that sent a report: the first snippet that built
 * one was 3 700 lines down and the first complete round trip 7 800. So the
 * third test asks that it names the whole round trip, and the fourth asks
 * that every `bugbottle` import in it is a name the package still exports —
 * a rename cannot leave the quickstart naming a function that is gone.
 *
 * It reads the repository rather than `dist/`, like `exports.test.ts`: the
 * README is changed in the same commit as the code it documents.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = readFileSync(root + "README.md", "utf8");

/** The fenced code blocks, the way a reader meets them: one page of code at a time. */
function fences(markdown: string): string[] {
  const blocks: string[] = [];
  let open: string | null = null;
  let body: string[] = [];
  for (const line of markdown.split("\n")) {
    const marker = /^\s*(```+|~~~+)/.exec(line);
    if (!marker) {
      if (open !== null) body.push(line);
      continue;
    }
    if (open === null) {
      open = marker[1]!;
      body = [];
      continue;
    }
    if (marker[1]![0] === open[0]) {
      blocks.push(body.join("\n"));
      open = null;
    }
  }
  return blocks;
}

/** The index just past the `)` that closes the call starting at `from`. */
function callEnd(fence: string, from: number): number {
  let depth = 0;
  for (let i = from; i < fence.length; i += 1) {
    if (fence[i] === "(") depth += 1;
    else if (fence[i] === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return fence.length;
}

test("fileStore answers an object, so a store option is its .store", async () => {
  const { fileStore } = await import("../src/server/index.ts");
  /* No I/O: the directory is walked on the first call that needs it, not here,
     so a temporary path that does not exist is safe to construct against. */
  const store = fileStore({ dir: `${tmpdir()}/bugbottle-readme-test` });
  assert.notEqual(typeof store, "function", "if this changed, every snippet changed with it");
  assert.equal(typeof store.store, "function", "handleReport calls this one");
  assert.equal(typeof store.list, "function", "and the inbox reads through this one");
});

test("every README snippet that stores a report reaches fileStore's .store", () => {
  /* The three names that take a `store`. A fence that only *reads* the
     directory — the retention example calls `prune()` and never hands the
     object anywhere — is not a fence that can be wrong this way. */
  const receivers = /\b(handleReport|expressHandler|fastifyHandler)\s*\(/;
  const wrong: string[] = [];
  for (const fence of fences(readme)) {
    if (!fence.includes("fileStore(") || !receivers.test(fence)) continue;
    for (const match of fence.matchAll(/fileStore\(/g)) {
      /* Everything after the call: `.store` on the same expression, or a
         variable the rest of the block then reaches through (the shape
         "Storing it" uses, because it also calls list() and prune()). */
      const after = fence.slice(callEnd(fence, match.index!));
      if (!after.includes(".store")) {
        wrong.push(fence.split("\n").find((line) => line.includes("fileStore("))!.trim());
      }
    }
  }
  assert.deepEqual(
    wrong,
    [],
    "fileStore() answers an object; a store option is a function handleReport calls. " +
      "Write `.store` — a pasted object throws and the reader gets a 500 instead of a report.",
  );
});

/** The opening: everything above the first `##`, which is also /docs/install/. */
const intro = readme.slice(0, readme.indexOf("\n## "));

test("the opening carries a whole report, both halves of it", () => {
  for (const [what, needle] of [
    ["the browser half's import", 'from "bugbottle"'],
    ["the receiving half's import", 'from "bugbottle/server"'],
    ["the console buffer, or the report arrives empty", "initConsoleBuffer("],
    ["the builder", "buildReport("],
    ["the send", "sendReport("],
    ["the endpoint", "handleReport("],
    ["the store that makes it 201 rather than 202", "fileStore("],
  ] as const) {
    assert.ok(intro.includes(needle), `the opening is missing ${what}: ${needle}`);
  }
});

test("every bugbottle import in the opening is a name the package still exports", async () => {
  const core = await import("../src/index.ts");
  const server = await import("../src/server/index.ts");
  for (const fence of fences(intro)) {
    for (const match of fence.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(bugbottle[^"]*)"/g)) {
      const [, names, from] = match;
      const entry = from === "bugbottle" ? core : server;
      for (const name of names!.split(",")) {
        const bare = name.trim().split(/\s+as\s+/)[0]!.trim();
        if (!bare || bare.startsWith("type ")) continue;
        assert.ok(
          bare in entry,
          `the opening imports ${bare} from ${from}, which no longer exports it — ` +
            `the first thing a reader pastes would not resolve`,
        );
      }
    }
  }
});

/**
 * The opening is one text with three readers, and only one of them can
 * resolve a relative link. GitHub serves it from `github.com/mahope/bugbottle`,
 * npm serves it from `npmjs.com/package/bugbottle`, and `scripts/build-docs.mjs`
 * serves it again as `/docs/install/`. A link written `./LICENSE` or
 * `/docs/svelte/` is correct for the third and dead for the first two: on
 * GitHub it asks `github.com` for a path it does not have, and on npm it asks
 * `npmjs.com` for one it certainly does not. Six of the seven were written
 * that way, and they were invisible from here, because the only place they
 * were ever followed was the site — which is also where they work.
 */
test("no link in the README is relative, because two of its three readers cannot resolve one", () => {
  const relative = [...readme.matchAll(/\]\((\.[^)]*|\/[^)]*)\)/g)].map((m) => m[1]!);
  assert.deepEqual(
    [...new Set(relative)],
    [],
    "A relative or root-relative link works on the docs site and 404s on GitHub " +
      "and on npmjs.com, which serve the same text from their own host. Write the " +
      "whole address: https://bugbottle.dev/docs/… and the blob URL for a file in the repo.",
  );
});

/**
 * The two ways in are one sentence apart and neither used to point at the
 * other. A reader who lands on npmjs.com/package/bugbottle had the landing
 * page and nothing else — the reference, the frameworks, the server side, all
 * of it one click away and not linked — and a reader on `/docs/install/` had
 * the footer, which has carried the npm link since the site first shipped.
 * Both directions are pinned here, so dropping either is a red test rather
 * than a quiet loss of a funnel.
 */
test("the npm page's opening points at the docs, and the docs point back at npm", () => {
  const install = "https://bugbottle.dev/docs/install/";
  assert.ok(
    intro.includes(`](${install})`),
    "the opening must link the reference, or a reader on npmjs.com has no way to it",
  );

  /* The reference is the page the build makes out of this same opening, so the
     link to it cannot live in the prose the build keeps — it has to travel in
     the navigation paragraph, which the build drops. That is a rule in
     `scripts/build-docs.mjs` rather than a convention, so it is read from
     there: a build that stopped dropping the paragraph would put a link from
     `/docs/install/` to itself on the page. */
  const generator = readFileSync(root + "scripts/build-docs.mjs", "utf8");
  const navStart = intro.split("\n").find((line) => line.startsWith("[bugbottle.dev]"));
  assert.ok(navStart, "the opening's navigation paragraph has moved, so this test cannot find it");
  assert.ok(
    generator.includes("/^\\[bugbottle\\.dev\\]/"),
    "scripts/build-docs.mjs must go on dropping the navigation paragraph, " +
      "or /docs/install/ links to itself and the opening's own link is a loop",
  );

  /* The other direction, from every page on the site. */
  assert.ok(
    generator.includes('<a href="https://www.npmjs.com/package/bugbottle">'),
    "the docs footer must go on linking npm, which is how a reader who found the " +
      "reference gets to the package",
  );
});

/**
 * The opening pins the version twice, in two fences a reader pastes rather
 * than reads: the GitHub install and the jsDelivr import. A release moves both
 * with one string replacement in `scripts/release.mjs`, so the only way they
 * can disagree is a hand edit — and then one of the two addresses 404s while
 * the README still looks right. `npm run release` is the supported way to
 * bump, and this is what says so out loud.
 */
test("both pinned install snippets in the opening name the version this build is", () => {
  const { version } = JSON.parse(readFileSync(root + "package.json", "utf8")) as { version: string };
  const pins = new Set(
    [...intro.matchAll(/(?:github:mahope\/bugbottle#|bugbottle@)(v[\d.]+)/g)].map((m) => m[1]!),
  );
  assert.deepEqual(
    [...pins],
    [`v${version}`],
    `the opening pins ${[...pins].join(" and ")} but package.json is ${version}. ` +
      "A pasted snippet that names a tag that does not exist is a 404 with no " +
      "explanation; scripts/release.mjs moves every pin at once, and this fails " +
      "if one was edited by hand.",
  );
});

/**
 * The one thing in the README a reader can *run* pointed at a directory the
 * tarball does not contain. `examples/vanilla-js` and `examples/inbox` are in
 * the repository and not in the package, and `npm pack` ships `dist/` and
 * nothing else, so the reader who arrived from npmjs.com — which is the only
 * channel that measurably finds this package, its description ranking first
 * for its own phrase — read `cd examples/vanilla-js` and had no such
 * directory. The three commands are correct for a clone and were verified as
 * such; what was missing is the sentence that says which reader they are for.
 *
 * So the two ways to see a report point at each other: the example names the
 * two files in the reader's own app, and the opening names the example. The
 * anchors are read out of the headings rather than written here, because a
 * renamed heading would otherwise leave a dead link that still looks right on
 * all three readers — the docs site, GitHub and npm all render these anchors
 * from the same text, and none of them 404s a link they cannot check.
 */
test("the two ways to see a report find each other, and the example says it is not in the tarball", () => {
  const slug = (heading: string): string =>
    heading
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");

  const exampleSection = readme.slice(readme.indexOf("## A working example"));
  const opening = readme.slice(0, readme.indexOf("## Recording console errors"));
  const exampleSlug = slug(
    /^## (.+)$/m.exec(readme.slice(readme.indexOf("## A working example")))![1]!,
  );
  const firstReportSlug = slug(
    /^### (.+)$/m.exec(opening.slice(opening.indexOf("### A first report")))![1]!,
  );

  assert.match(
    exampleSection.slice(0, 900),
    new RegExp(`\\(#${firstReportSlug}\\)`),
    `the example section must link #${firstReportSlug}, the two-file round trip a ` +
      "reader with only the installed package can actually follow. It is the " +
      "only runnable proof in the README and it is 8 000 lines further down.",
  );
  assert.match(
    opening,
    new RegExp(`\\(#${exampleSlug}\\)`),
    `the opening must link #${exampleSlug}, or a reader who arrived to be ` +
      "convinced is never told that the repository has something they can run.",
  );

  const { files } = JSON.parse(readFileSync(root + "package.json", "utf8")) as { files: string[] };
  assert.deepEqual(
    files,
    ["dist"],
    "the paragraph that says the examples are not in the tarball is only true " +
      `while files is ["dist"]; it now is ${JSON.stringify(files)}. Either the ` +
      "sentence is wrong or the package grew — do not change one without the other.",
  );
});
