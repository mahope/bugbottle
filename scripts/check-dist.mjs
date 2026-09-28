/**
 * Two questions about `dist/`, asked after a build, because the committed copy
 * is what `npm install github:mahope/bugbottle` and jsDelivr hand out — there
 * is no build step on that path, so whatever is missing here is missing for
 * ever there.
 *
 * The first is whether the build agrees with what is committed, which is what
 * `git diff --quiet -- dist` has always answered. The second is whether the
 * build produced a file git does not track at all, and that is the one a diff
 * cannot see: `dist/` is in `.gitignore` on purpose, so a new file lands there
 * untracked and invisible to every diff, and the only thing that adds it is a
 * human remembering `git add -f`.
 *
 * That is not hypothetical. `dist/server/fastify.js` was emitted when
 * `fastifyHandler` landed and never added, while the `index.js` beside it —
 * which is tracked and was rebuilt — has imported `./fastify.js` since. So the
 * published server entry threw `ERR_MODULE_NOT_FOUND` on import: not one
 * export broken, the whole entry, for anybody installing from GitHub. The
 * build was green, `npm test` was green, the diff was clean, and `npm pack`
 * packed a file that was on disk and not in the repository.
 *
 * Run as the last step of `npm run check`, so it runs in CI and locally alike.
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";

/** Git's answer, or `null` when this is not a checkout at all. */
function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    // `git ls-files` fails outside a repository; so does a `git` that is not
    // installed. Either way there is nothing to compare against, and a tarball
    // extracted by a consumer has no history to be out of step with.
    if (err && (err.code === "ENOENT" || /not a git repository/i.test(String(err.stderr)))) {
      return null;
    }
    throw err;
  }
}

const tracked = git(["ls-files", "-z", "--", DIST]);
if (tracked === null) {
  console.log("check-dist: not a git checkout, so there is no committed dist to compare with.");
  process.exit(0);
}

const known = new Set(tracked.split("\0").filter(Boolean));

/** Every file the build left under `dist/`, as repo-relative paths. */
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    found.push(join(entry.parentPath, entry.name).replaceAll("\\", "/"));
  }
  return found;
}

let built;
try {
  built = walk(DIST);
} catch (err) {
  console.error(`check-dist: ${DIST}/ is not there. Run npm run build first.`);
  console.error(err.message);
  process.exit(1);
}

const untracked = built.filter((file) => !known.has(file));
if (untracked.length > 0) {
  // The message names `git add -f` rather than `git add`, because the plain
  // one prints "ignored by one of your .gitignore files" and adds nothing.
  console.error(`check-dist: ${untracked.length} file(s) in ${DIST}/ are not committed:`);
  for (const file of untracked) console.error(`  ${file}`);
  console.error(`Run npm run build && git add -f ${DIST} before pushing.`);
  process.exit(1);
}

// The other half, kept here so there is one command rather than a step in the
// workflow and a script nobody runs: a tracked file the build did not
// reproduce is a stale artefact, and it is the one `npm pack` would ship.
const stat = git(["diff", "--stat", "--", DIST]);
if (stat === null) {
  console.log("check-dist: not a git checkout, so there is no committed dist to compare with.");
  process.exit(0);
}
if (stat.trim() !== "") {
  console.error(`check-dist: ${DIST}/ differs from the build:`);
  console.error(stat.trimEnd());
  console.error(`Run npm run build && git add -f ${DIST} before pushing.`);
  process.exit(1);
}

console.log(`check-dist: ${built.length} files in ${DIST}/, all committed and current.`);
