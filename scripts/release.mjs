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
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const identifier = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const registryVersion = new RegExp(`^${stable.source.slice(1, -1)}(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const parts = (value) => {
  if (typeof value !== "string" || !stable.test(value))
    throw new Error(`Expected a stable x.y.z version: ${value}`);
  return value.split(".").map(BigInt);
};
const compare = (left, right) => {
  const a = parts(left), b = parts(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
};
const next = parts(before);
const component = ["major", "minor", "patch"].indexOf(bump);
if (component !== -1) {
  next[component]++;
  for (let i = component + 1; i < 3; i++) next[i] = 0n;
}
const version = component === -1 ? bump : next.join(".");
if (compare(version, before) <= 0)
  throw new Error(`Release ${version} must exceed current version ${before}.`);
for (const tag of out("git tag --list").split("\n")) {
  const tagged = tag.replace(/^v/, "");
  if (stable.test(tagged) && compare(version, tagged) <= 0)
    throw new Error(`Release ${version} must exceed existing tag ${tag}.`);
}
let published;
try {
  published = JSON.parse(execSync("npm view bugbottle versions --json --prefer-online", {
    stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
  }).toString());
  if (typeof published === "string") published = [published];
  if (!Array.isArray(published) || !published.length ||
      published.some((value) => typeof value !== "string" || !registryVersion.test(value)))
    throw new Error("Missing valid registry versions");
} catch {
  throw new Error("Cannot verify npm registry versions. Check registry access and retry the release; no files have changed.");
}
for (const existing of published) {
  const core = existing.split(/[-+]/)[0];
  const ordering = compare(version, core);
  if (ordering < 0 || (ordering === 0 && existing[core.length] !== "-"))
    throw new Error(`Release ${version} must exceed published version ${existing}.`);
}
sh(`npm version ${version} --no-git-tag-version`);
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
// site/da/kom-i-gang.md pins the same jsDelivr URL the README does, so it has
// to move with the version or the one Danish way in hands out a stale script
// tag.
for (const f of [
  "README.md",
  "site/index.html",
  "site/da/index.html",
  "site/da/kom-i-gang.md",
])
  edit(f, refs);

// The Sentry sink names its version in the envelope header, and a test pins it
// to package.json, so the release stamps it too.
edit("src/sinks/sentry.ts", (t) =>
  t.replace(/export const SENTRY_CLIENT_VERSION = "[^"]+";/, `export const SENTRY_CLIENT_VERSION = "${version}";`));

// check:dist compares the rebuild with the index, including new ignored files.
sh("npm run build");
sh("git add -f dist");
sh("npm run check");
sh("git add -A");
sh(`git commit -q -m "Release ${version}"`);
sh(`git tag v${version}`);
sh(`git push origin main v${version}`);
console.log(`\nReleased ${version}. Watch: gh run list --workflow=release.yml`);
console.log("Remember: the landing-page size table and the release date on the page are hand-maintained; check site/README.md.");
