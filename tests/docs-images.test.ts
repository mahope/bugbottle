/**
 * A docs page that shows a bare sentence where a picture belongs reads as a
 * broken page, and the picture in question is the panel — the product. The
 * renderer used to answer *every* `![]()` with its alt text, on the strength
 * of the promise in the footer that the site makes no external request. That
 * promise is about the host, not about images: a picture served from
 * bugbottle.dev is this site asking itself for a file, which is exactly what
 * the landing page's own panel shot already does.
 *
 * So the rule is now "no *foreign* request". These tests drive the **real**
 * build — the same `scripts/build-docs.mjs`, in a throwaway copy of the
 * repository — because the renderer is not exported and a test that restated
 * its condition would only prove the restatement. What each test changes is
 * one line of the README in the copy: the line under test is the only
 * difference between a run that renders and a run that does not.
 *
 * The foreign half matters more than it looks. The README's badges are three
 * shields.io images, and a renderer that let those through would put three
 * third-party requests on every one of the fifty-one pages — so the test adds
 * a fourth badge to the copy and asks that no `<img>` on a foreign host
 * survives. The last test then pins the other half of the same risk: a src the
 * renderer *will* render must be a file that is actually committed, because a
 * picture nobody committed is a 404 on every page the line was pasted into.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, existsSync, writeFileSync, symlinkSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = readFileSync(root + "README.md", "utf8");

/** The panel shot is the one picture the README points at, and the one the
 *  docs pages get. Read from the repository so the test names a file rather
 *  than repeating its path. */
const PANEL = /!\[[^\]]+\]\(https:\/\/bugbottle\.dev\/([a-z-]+\.png)\)/.exec(readme)?.[1];
assert.ok(PANEL, "the README points at a panel shot on bugbottle.dev");

/**
 * Build the site from a copy of the repository whose README has been altered
 * by `edit`, and answer the HTML of the page named `slug`.
 *
 * Only the files `build-docs.mjs` reads are copied, and `node_modules` is
 * symlinked rather than copied, so this stays well under a second — cheap
 * enough to run three times.
 */
function build(slug: string, edit: (markdown: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), "bugbottle-docs-"));
  const repo = join(dir, "repo");
  cpSync(join(root, "scripts"), join(repo, "scripts"), { recursive: true });
  cpSync(join(root, "site"), join(repo, "site"), { recursive: true });
  for (const name of ["README.md", "package.json", "CHANGELOG.md"]) {
    cpSync(join(root, name), join(repo, name));
  }
  /* `marked` is the one dependency the build has, and it is already installed
     in the repository; a symlink keeps the copy from duplicating it. */
  symlinkSync(join(root, "node_modules"), join(repo, "node_modules"), "dir");

  const path = join(repo, "README.md");
  writeFileSync(path, edit(readFileSync(path, "utf8")));
  execFileSync(process.execPath, [join(repo, "scripts", "build-docs.mjs")], { cwd: repo, stdio: "pipe" });

  const html = readFileSync(join(repo, "site", "docs", slug, "index.html"), "utf8");
  /* The whole site, because the promise is about every page and not about the
     one the reader happened to be on. */
  const pages = readdirSync(join(repo, "site", "docs"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => readFileSync(join(repo, "site", "docs", e.name, "index.html"), "utf8"))
    .join("\n");
  return html + "\n<!--SITE-->\n" + pages;
}

/** The opening is the one part of the README a reader arrives at instead of
 *  reading the rest — it is what npm shows and what `/docs/install/` is. */
const opening = (markdown: string) => markdown.slice(0, markdown.search(/^## /m));

test("a picture on the site's own host renders on a docs page", () => {
  /* The opening is where the panel shot has to be: it is the part that is
     both the npm package page and `/docs/install/`. */
  assert.match(opening(readme), new RegExp(`!\\[[^\\]]+\\]\\(https://bugbottle\\.dev/${PANEL}\\)`));

  const html = build("install", (m) => m);
  const tag = new RegExp(`<img src="https://bugbottle\\.dev/${PANEL}"[^>]*>`).exec(html);
  assert.ok(tag, `the panel shot rendered on /docs/install/:\n${tag?.[0] ?? html.slice(0, 400)}`);

  /* Alt text is not decoration: it is what a screen reader says, and what the
     page shows if the picture does not load. */
  const alt = /alt="([^"]*)"/.exec(tag[0]);
  assert.ok(alt, "the rendered picture carries an alt attribute");
  assert.ok(alt[1]!.length > 20, `the alt text describes the picture, got ${alt[1]!.length} characters`);

  /* `loading="lazy"` because a docs page is read top to bottom and nobody
     arrived for the picture. */
  assert.match(tag[0], /loading="lazy"/);

  /* The intrinsic size, read out of the PNG rather than written down in the
     renderer, because an `<img>` without it has no size until it loads and the
     text under it jumps when it does. The numbers are compared against the
     file itself, so a re-captured shot cannot make this test lie. */
  const dims = /width="(\d+)" height="(\d+)"/.exec(tag[0]);
  assert.ok(dims, "the rendered picture carries its intrinsic size, so it cannot shift the text under it");
  const head = readFileSync(join(root, "site", PANEL!)).subarray(0, 24);
  assert.equal(dims[1], String(head.readUInt32BE(16)), "the rendered width is the file's width");
  assert.equal(dims[2], String(head.readUInt32BE(20)), "the rendered height is the file's height");
});

test("a picture on somebody else's host does not render", () => {
  /* The README's badges are shields.io images, and the intro drops them before
     the renderer ever sees them — so a badge in the opening would prove
     nothing about the image rule. This one goes into a section *body*, which
     is where a foreign image would actually reach the renderer: an outside
     screenshot in the API section, say. The foreign image is answered with its
     alt text, so the sentence survives and the third-party request does not. */
  const foreignImage = "![An outside screenshot](https://img.shields.io/badge/x-y-green/screenshot)\n";
  const html = build("api", (m) => m.replace(/^## API$/m, `## API\n\n${foreignImage}`));

  assert.doesNotMatch(html, /<img[^>]+src="https:\/\/img\.shields\.io/);
  /* The alt text is still on the page, so a foreign image is not lost — it
     reads as the sentence it always did. */
  assert.match(html, /An outside screenshot/);
  /* And nothing on any page is served by a host that is not this site. */
  const elsewhere = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((src) => !src.startsWith("https://bugbottle.dev/") && !src.startsWith("/"));
  assert.deepEqual(elsewhere, [], "every rendered picture is served by this site");
});

test("every picture the README points at on this site is a file that exists", () => {
  /* The build is the only place that knows both halves — a src it will render
     and a path in the repository — so a src that is not a committed file is a
     404 on every page the line was pasted into. `site/` is the docroot, so the
     path under the origin is the path in the repository. */
  const own = [...readme.matchAll(/!\[[^\]]*\]\(https:\/\/bugbottle\.dev\/([^)\s]+)\)/g)].map((m) => m[1]!);
  assert.ok(own.length > 0, "the README points at at least one picture on this site");
  for (const path of own) {
    assert.ok(
      existsSync(join(root, "site", path)),
      `the README points at https://bugbottle.dev/${path}, and site/${path} is not in the repository`,
    );
  }
});
