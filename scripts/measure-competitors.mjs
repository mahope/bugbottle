/**
 * What a competing SDK weighs, measured the way CI measures ours.
 *
 * `/compare/` used to say "not published" in the size column for every row that
 * was not bugbottle, which is true and useless: a reader comparing a 12 kB panel
 * against an SDK whose size they have never seen cannot make the decision the
 * page exists to help them make. The one row where we quote a number for
 * somebody else's code is `@sentry/react`, and it is measured here rather than
 * copied from a bundle-size site, so the recipe is in the repository next to the
 * claim and the same esbuild version CI uses for our own budgets.
 *
 *     node scripts/measure-competitors.mjs
 *
 * It is deliberately not part of `npm run check`: it installs from the network,
 * it downloads about a megabyte of somebody else's package, and the number only
 * needs refreshing when a major lands. Paste the printed row into the
 * `site/compare.md` table and move the date on the figure in it.
 *
 * Two entries, because one number would hide the decision. The bare `init` is
 * what an application pays for the moment it adds Sentry; the second adds the
 * two integrations a bug-reporting comparison actually turns on — session
 * replay and `captureFeedback` — which is the bundle that a Sentry user's
 * feedback widget sits on top of.
 */

import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Pinned to the version CI installs, so the numbers are comparable. */
const ESBUILD = "esbuild@0.24.0";

/** The package the compare table's row is about, unversioned so it is the latest. */
const PACKAGE = "@sentry/react";

/**
 * The row label is what the compare page says, so a row printed here can be
 * pasted without editing. The entries are the two numbers the cell quotes, and
 * `import * as` plus a real call keeps the bundler from tree-shaking the SDK
 * away into an empty file.
 */
const ENTRIES = [
  {
    row: "init",
    code: `import * as Sentry from "${PACKAGE}";
Sentry.init({ dsn: "https://example@example.ingest.sentry.io/1", tracesSampleRate: 0 });
`,
  },
  {
    row: "init + replay + captureFeedback",
    code: `import * as Sentry from "${PACKAGE}";
Sentry.init({
  dsn: "https://example@example.ingest.sentry.io/1",
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
});
Sentry.captureFeedback({ message: "it broke", name: "reporter" });
`,
  },
];

const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";
const npx = windows ? "npx.cmd" : "npx";

/**
 * `npm` is a batch file on Windows, and Node refuses to spawn one without a
 * shell, so there the command line is built by hand — which means quoting the
 * arguments that carry a path, because a temporary directory can sit under a
 * user name with a space in it. Copied from `measure-sinks.mjs` deliberately:
 * two copies of this helper is cheaper than a shared module for two callers.
 */
const run = (command, args, cwd) => {
  const options = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] };
  if (!windows) return execFileSync(command, args, options);
  const quoted = args.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg));
  return execFileSync([command, ...quoted].join(" "), { ...options, shell: true });
};

const dir = mkdtempSync(join(tmpdir(), "bugbottle-competitors-"));

try {
  process.stderr.write(`installing ${PACKAGE} and ${ESBUILD}…\n`);
  run(npm, ["init", "-y"], dir);
  run(npm, ["install", "--silent", PACKAGE, ESBUILD], dir);

  // The installed version is quoted in the output, because a figure without one
  // is a figure nobody can tell is still true after the next major.
  const installed = JSON.parse(
    readFileSync(join(dir, "node_modules", ...PACKAGE.split("/"), "package.json"), "utf8"),
  ).version;
  process.stderr.write(`${PACKAGE}@${installed}\n`);

  const rows = [];
  for (const entry of ENTRIES) {
    const file = `entry-${rows.length}.js`;
    writeFileSync(join(dir, file), entry.code);
    const out = `out-${rows.length}.js`;
    run(
      npx,
      [
        "esbuild",
        file,
        "--bundle",
        "--minify",
        "--format=esm",
        "--platform=browser",
        `--outfile=${out}`,
      ],
      dir,
    );
    const bytes = gzipSync(readFileSync(join(dir, out))).length;
    rows.push({ row: entry.row, bytes });
    process.stderr.write(`${entry.row}: ${bytes} bytes gzipped\n`);
  }

  const date = new Date().toISOString().slice(0, 10);
  process.stdout.write(`\n${PACKAGE}@${installed}, measured ${date} with ${ESBUILD}:\n\n`);
  for (const { row, bytes } of rows) {
    process.stdout.write(`| ${row} | ${(bytes / 1024).toFixed(1)} kB | ${bytes} bytes |\n`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
