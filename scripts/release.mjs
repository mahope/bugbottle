#!/usr/bin/env node
// Usage: npm run release -- patch|minor|major|<x.y.z>
//
// Everything a release needs, in the order CLAUDE.md lists it, so nothing is
// forgotten by hand: bump package.json, move the Unreleased changelog section
// under a dated heading, point the README install refs and the landing-page
// stamps at the new version, rebuild dist (the CI guard refuses a stale one),
// commit, tag vX.Y.Z and push. CI then publishes to npm through Trusted
// Publishing and creates the GitHub release.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const bump = process.argv[2];
if (!/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(bump ?? "")) {
  console.error("Usage: npm run release -- patch|minor|major|<x.y.z>");
  process.exit(1);
}
const sh = (cmd) => execSync(cmd, { stdio: "inherit" });
const out = (cmd) => execSync(cmd).toString().trim();

if (out("git status --porcelain")) {
  console.error("Working tree is dirty; commit or stash first.");
  process.exit(1);
}
if (out("git branch --show-current") !== "main") {
  console.error("Release from main.");
  process.exit(1);
}

const before = JSON.parse(readFileSync("package.json", "utf8")).version;
sh(`npm version ${bump} --no-git-tag-version`);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const today = new Date().toISOString().slice(0, 10);

function edit(file, fn) {
  const text = readFileSync(file, "utf8");
  const next = fn(text);
  if (next !== text) writeFileSync(file, next);
}

// CHANGELOG: everything under Unreleased becomes this version.
edit("CHANGELOG.md", (t) => {
  if (!/^## Unreleased\r?\n/m.test(t)) return t;
  if (new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m").test(t)) return t;
  return t.replace(/^## Unreleased\r?\n/m, (m) => `${m}\n## ${version} — ${today}\n`);
});

// README and landing pages: tagged install refs, the version stamp, and the
// link from that stamp to the release on /docs/changelog/, whose anchor is the
// version with hyphens for dots (scripts/build-docs.mjs writes them that way).
const anchor = (v) => v.replace(/\./g, "-");
const refs = (t) =>
  t
    .split(`v${before}`).join(`v${version}`)
    .split(`bugbottle@${before}`).join(`bugbottle@${version}`)
    .split(`Version ${before}`).join(`Version ${version}`)
    .split(`measured at ${before}`).join(`measured at ${version}`)
    .split(`målt ved ${before}`).join(`målt ved ${version}`)
    .split(`/docs/changelog/#${anchor(before)}`).join(`/docs/changelog/#${anchor(version)}`);
for (const f of ["README.md", "site/index.html", "site/da/index.html"]) edit(f, refs);

// The Sentry sink names its version in the envelope header, and a test pins it
// to package.json, so the release stamps it too.
edit("src/sinks/sentry.ts", (t) =>
  t.replace(/export const SENTRY_CLIENT_VERSION = "[^"]+";/, `export const SENTRY_CLIENT_VERSION = "${version}";`));

sh("npm run check");
sh("git add -A");
sh("git add -f dist");
sh(`git commit -q -m "Release ${version}"`);
sh(`git tag v${version}`);
sh(`git push origin main v${version}`);
console.log(`\nReleased ${version}. Watch: gh run list --workflow=release.yml`);
console.log("Remember: the landing-page size table and the release date on the page are hand-maintained; check site/README.md.");
