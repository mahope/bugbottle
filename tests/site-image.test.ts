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
 *
 * The fourth is the one this file could not have caught by reading the
 * Dockerfile, because the Dockerfile is *correct* and the two lines disagree
 * with each other: `COPY .dockerignore .git* ./gitdir/` lands `.git` inside
 * `/build/gitdir/`, while `ENV GIT_DIR=/build/gitdir` pointed git at the
 * directory rather than at the `.git` within it. Both lines are plausible in
 * isolation and neither is wrong on its own, so the sitemap's `<lastmod>`
 * dates silently fell back to "today" on every deploy — all 61 URLs claiming
 * to have changed on the day the image was built. The last test below builds
 * the layout in a scratch directory and runs git against it, because the only
 * way to catch this class is to do what the image does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * The value of the `ENV GIT_DIR` in the builder stage, as the image sees it.
 */
function gitDirEnv(): string {
  return builderStageLines()
    .map((line) => /^ENV\s+GIT_DIR=(\S+)\s*$/i.exec(line.trim())?.[1])
    .find((value): value is string => value !== undefined) ?? "";
}

/**
 * The `WORKDIR` of the builder stage, which is what every relative path in it
 * — the `COPY` destinations, and the `ENV GIT_DIR` — is resolved against.
 */
function builderWorkdir(): string {
  return builderStageLines()
    .map((line) => /^WORKDIR\s+(\S+)\s*$/i.exec(line.trim())?.[1])
    .find((value): value is string => value !== undefined) ?? "";
}

/**
 * The path the builder stage copies the history to, which is the last token of
 * the `COPY … .git*` line. Read from the Dockerfile rather than written down,
 * so the two halves of the layout cannot be pinned to each other by a test
 * that restates both. Normalised because Docker writes `./gitdir/` as the image
 * path `/build/gitdir/`, and the two are the same directory.
 */
function gitCopyDestination(): string {
  for (const line of builderStageLines()) {
    const match = /^COPY\s+.*\.git\*\s+(\S+)\s*$/i.exec(line.trim());
    if (match?.[1]) return match[1].replace(/^\.\//, "").replace(/\/+$/, "");
  }
  return "";
}

test("the builder stage's GIT_DIR points at the history the COPY lands", () => {
  /* Built rather than read, because this is the one bug in this file that no
     amount of reading the Dockerfile can find: `COPY .dockerignore .git* ./gitdir/`
     and `ENV GIT_DIR=/build/gitdir` are each individually reasonable, and only
     their disagreement is wrong. The scratch directory reproduces the image's
     layout, and then asks git the same question `lastmod()` asks.

     With GIT_DIR naming the parent, git answers `fatal: not a git repository`
     and `lastmod()` falls back to today. That is invisible: the build succeeds,
     the sitemap is well-formed, and the dates are simply wrong. Live served
     that from at least the deploy that introduced the pages, and the one
     difference between a page that moved and a page that did not had been
     erased for every URL at once.

     The layout is built with Docker's semantics and not a reader's: a `COPY`
     whose source is a *directory* copies that directory's contents into the
     destination, so `.git`'s HEAD, objects and refs land directly in
     `/build/gitdir` and there is no `/build/gitdir/.git`. That is measured,
     not assumed — see the `docker build` in this file's sibling test — and it
     is the whole reason the wrong value looks reasonable. A version of this
     test built the layout the other way round, with the history nested one
     level deeper, and therefore agreed with the assumption it was meant to
     check by construction. */
  const dir = gitDirEnv();
  const destination = gitCopyDestination();
  assert.ok(dir, "site/Dockerfile has no `ENV GIT_DIR` in the builder stage");
  assert.ok(destination, "site/Dockerfile never copies `.git*` into the builder stage");

  const work = mkdtempSync(join(tmpdir(), "bugbottle-gitdir-"));
  try {
    // The working tree the image has at this point: the sources, checked out.
    cpSync(join(root, "README.md"), join(work, "README.md"));
    mkdirSync(join(work, "site"));
    cpSync(join(root, "site/compare.md"), join(work, "site/compare.md"));
    cpSync(join(root, "CHANGELOG.md"), join(work, "CHANGELOG.md"));

    // The layout the COPY leaves behind, at the path it names: the *contents*
    // of `.git` inside the directory, which is what copying a directory means.
    // The Dockerfile writes in image paths, so the scratch root stands in for
    // the WORKDIR and the same prefix is stripped off GIT_DIR below.
    const root_ = builderWorkdir();
    mkdirSync(join(work, destination), { recursive: true });
    for (const entry of readdirSync(join(root, ".git"))) {
      cpSync(join(root, ".git", entry), join(work, destination, entry), { recursive: true });
    }
    writeFileSync(join(work, destination, ".dockerignore"), "");

    // GIT_DIR is absolute in the Dockerfile; rebase it onto the scratch root,
    // which is where WORKDIR is in the image.
    const env = { ...process.env, GIT_DIR: join(work, dir.replace(root_, "")) };
    let out = "";
    let failed = false;
    try {
      out = execFileSync("git", ["log", "-1", "--format=%cs", "--", "site/compare.md"], {
        cwd: work,
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      failed = true;
    }

    const expected = execFileSync("git", ["log", "-1", "--format=%cs", "--", "site/compare.md"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    assert.equal(
      failed,
      false,
      `git cannot read the history in the layout site/Dockerfile builds: GIT_DIR is ` +
        `${dir}, and the COPY writes .git's contents into ${destination} rather than ` +
        `.git itself. Every <lastmod> then falls back to today, so the sitemap claims ` +
        `the whole site changed on every deploy.`,
    );
    assert.equal(
      out,
      expected,
      `the builder stage dates pages from a different commit than the repository does, ` +
        `so the sitemap on the site and the one built here would disagree.`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

/**
 * The dates this file's history is given, both far enough in the past that
 * neither can be mistaken for the day the test happens to run.
 */
const HISTORY_BASE_DATE = "2018-05-06";
const SHALLOW_TIP_DATE = "2019-01-01";

/** Everything the build needs on disk, which is also everything the history
 *  has to have touched for git to have a date to give back. */
const LAYER = ["scripts", "site", "README.md", "package.json", "CHANGELOG.md"];

function git(cwd: string, args: string[], env?: Record<string, string>): void {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function commitAt(cwd: string, date: string, message: string): void {
  git(cwd, ["add", "-A"]);
  git(
    cwd,
    ["-c", "user.email=ci@example.invalid", "-c", "user.name=ci", "commit", "-q", "-m", message],
    { GIT_AUTHOR_DATE: `${date}T00:00:00Z`, GIT_COMMITTER_DATE: `${date}T00:00:00Z` },
  );
}

/**
 * A repository whose history is this file's own, rather than this
 * repository's.
 *
 * The obvious thing is to clone the repository under test and let its history
 * be the history, and that is what the first version of this did — and it is
 * green on a laptop and red in CI, for a reason that has nothing to do with
 * the code. `actions/checkout` hands CI a `--depth 1` clone unless a workflow
 * says otherwise, **and git propagates shallowness to a clone of a shallow
 * repository**: a clone of a one-commit repository has one commit, whatever
 * flags it was given. The "full history" half of this pair was therefore
 * reading a one-commit history on CI, and asserting that a build over it
 * produces more than one date. It cannot, so `main` was red, and no change to
 * `build-docs.mjs` could have made it green.
 *
 * So the history is built here, with the dates written down above. That is the
 * same rule the GIT_DIR test above turned on — a test that *builds* the thing
 * it judges rather than measuring whatever the machine happens to have — and
 * the third time this file has needed it: the shallow test, the full-history
 * test and the `docker build` all now construct their own repository instead
 * of inheriting one.
 */
function repoWithKnownHistory(dir: string): void {
  git(dir, ["init", "-q"]);
  for (const name of LAYER) {
    cpSync(join(root, name), join(dir, name), { recursive: true });
  }
  commitAt(dir, HISTORY_BASE_DATE, "the sources, dated");

  /* A second commit on a second date. Two are needed for the full-history test
     to have anything to distinguish, and the tip is the one a `--depth 1`
     clone keeps: it is dated years back on purpose, so "git answered with the
     tip" and "the build fell back to today" cannot agree on any day this runs.
     An earlier version left the tip on the day of the run and passed against
     the very code it was written to catch. */
  writeFileSync(join(dir, "site", "compare.md"), `${read("site/compare.md")}\n<!-- a later commit -->\n`);
  commitAt(dir, SHALLOW_TIP_DATE, "one page moved later");
}

/**
 * The `<lastmod>` values of a sitemap this test builds, in a clone of the
 * history above, shallow or full.
 *
 * `shallow` is the `--depth 1` history a deploy platform hands the image; it is
 * the case the GIT_DIR test above cannot see, because the history is present
 * and readable, so nothing fails and every answer is still wrong. The full
 * clone is the same repository without the depth limit.
 *
 * Both *build*, and neither reads `site/sitemap.xml`: that file is generated
 * and gitignored, so it is absent in a clean checkout — and `npm test` runs
 * before `npm run build:docs` in CI, which is how a test for a build artefact
 * came to depend on a build step it does not own.
 */
function builtSitemapLastmods(shallow: boolean): string[] {
  const dir = mkdtempSync(join(tmpdir(), shallow ? "bugbottle-shallow-" : "bugbottle-full-"));
  try {
    const history = join(dir, "history");
    mkdirSync(history);
    repoWithKnownHistory(history);

    const repo = join(dir, "repo");
    git(dir, ["clone", "-q", ...(shallow ? ["--depth", "1"] : []), `file://${history}`, repo]);

    /* The clone is here for its history — shallow or full — and for nothing
       else, so the working tree is laid over it. Without this the build would
       run the committed `build-docs.mjs` and the test would quietly measure
       `main` instead of the change in front of it, which is how a test for an
       unfixed bug comes out green. */
    for (const name of LAYER) {
      cpSync(join(root, name), join(repo, name), { recursive: true });
    }
    /* `marked` is the build's only dependency and it is already installed in
       the repository, so a symlink stands in for the `npm ci` the image runs. */
    symlinkSync(join(root, "node_modules"), join(repo, "node_modules"), "dir");
    execFileSync(process.execPath, [join(repo, "scripts", "build-docs.mjs")], {
      cwd: repo,
      stdio: "pipe",
    });
    const xml = readFileSync(join(repo, "site", "sitemap.xml"), "utf8");
    return [...xml.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((m) => m[1] as string);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a shallow clone does not date every page with the deploy's own commit", () => {
  /* The failure this file's other test was written for, fixed and then still
     not fixed. With `GIT_DIR` pointing at the right place, a `--depth 1` clone
     is a perfectly readable repository: `git log -1 -- <file>` exits 0, and it
     answers with **the tip commit's date for every path**, because a shallow
     clone has no history for the path filter to walk. Measured here, in a
     clone of this repository: `git log -1 --format=%cs -- site/compare.md`
     answered the tip's date in the shallow clone and 2026-09-28 in the full
     one, with no error from either.

     The honest answer from a history that cannot answer is `TODAY`, which is
     what the fallback already does and is at least a true statement about the
     build. So every `<lastmod>` in a shallow build has to be the same value,
     and it must not be the tip's — the tip is the deploy, and dating the whole
     site with the deploy's date is the exact thing the element exists to
     prevent. */
  const lastmods = builtSitemapLastmods(true);
  assert.ok(lastmods.length >= 50, `the sitemap should carry one <lastmod> per URL, got ${lastmods.length}`);

  const distinct = new Set(lastmods);
  assert.equal(
    distinct.size,
    1,
    `a --depth 1 clone cannot say when each file changed, and the sitemap answered with ` +
      `${distinct.size} different dates: ${[...distinct].sort().join(", ")}. Git reports the ` +
      `tip commit for every path in a shallow history, so the only way to get more than one ` +
      `date is for lastmod() to be asking a repository that cannot answer.`,
  );

  const today = new Date().toISOString().slice(0, 10);
  assert.equal(
    [...distinct][0],
    today,
    `a build from a shallow clone must fall back to the build's own date. It answered ` +
      `${[...distinct][0]}, which is the tip commit's date and therefore the date of the ` +
      `deploy rather than the date of the change — a more convincing lie than "today", ` +
      `because it is a real commit date.`,
  );
  assert.notEqual(
    [...distinct][0],
    SHALLOW_TIP_DATE,
    `every <lastmod> is the tip commit's date: the sitemap claims the whole site changed on ` +
      `the day of the deploy, which is the one thing <lastmod> must not say.`,
  );
});

test("a full history does date pages separately, so the shallow test above can fail", () => {
  /* The other half of proving the guard: a suite in which every test can only
     pass is a suite that proves nothing. If `lastmod()` ignored every
     repository and always answered "today", the shallow test would be green
     and this one would be the only thing standing between that and a sitemap
     that says the site never changed.

     The history is the one `repoWithKnownHistory` wrote, so the dates are
     known rather than whatever this checkout happens to hold — which is what
     made this test red in CI while green on a laptop, because CI checks out
     `--depth 1` and a clone of a shallow repository is shallow whatever flags
     it is given. The expected values are therefore asserted outright rather
     than "more than one", so a build that answered *some* pages correctly and
     the rest with today would fail here instead of passing on a technicality.

     The sitemap is built rather than read: an earlier version read
     `site/sitemap.xml`, which is generated and gitignored, so it answered from
     whatever a previous `build:docs` had left on the machine and was `ENOENT`
     in CI, where `npm test` runs before `build:docs`. */
  const lastmods = builtSitemapLastmods(false);
  assert.ok(lastmods.length >= 50, `the sitemap should carry one <lastmod> per URL, got ${lastmods.length}`);

  const distinct = new Set(lastmods);
  assert.deepEqual(
    [...distinct].sort(),
    [HISTORY_BASE_DATE, SHALLOW_TIP_DATE],
    `a full history dates each page from the commit that last touched it: ` +
      `everything here should carry one of the two dates this file's history has. It answered ` +
      `${[...distinct].sort().join(", ")} — today's date in the list means lastmod() fell back ` +
      `on a history that could answer, and a single date means it is not reading git at all and ` +
      `the shallow guard above proves nothing.`,
  );
});
