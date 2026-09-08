/**
 * What each sink weighs, measured the way CI measures everything else.
 *
 * The README's "Sending it somewhere" table has a column for the gzipped size
 * of a server bundle that imports one sink and nothing more. Numbers written by
 * hand rot, so this script reproduces the column: pack the package as it would
 * be published, install the tarball in a scratch project, bundle one entry per
 * sink with the pinned esbuild, and gzip the result.
 *
 *     npm run build      # the tarball ships dist/, so build first
 *     node scripts/measure-sinks.mjs
 *
 * It is deliberately not part of `npm run check`: it installs from the network
 * and takes about a minute, and the sizes only need refreshing when a sink
 * changes or a release is being prepared. Paste the printed rows into the
 * README table and move the date on the line under it.
 *
 * The recipe is the one in `.github/workflows/ci.yml` — the same esbuild
 * version, `--bundle --minify --format=esm --platform=node`, gzip over the
 * output — so a number here is comparable with the budgets enforced there.
 */

import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Pinned to the version CI installs, so the sizes are the same numbers. */
const ESBUILD = "esbuild@0.24.0";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * One entry per row of the README table, in the order the rows appear. The
 * `exports` are what a bundle imports and what `tests/exports.test.ts` checks
 * the table names; the first of them is enough to pull the sink in.
 */
const SINKS = [
  { row: "Resend", exports: ["sendReportEmail"] },
  { row: "SMTP", exports: ["smtpSink", "sendReportSmtp"] },
  { row: "Webhook", exports: ["sendReportWebhook"] },
  { row: "Slack", exports: ["slackSink"] },
  { row: "Discord", exports: ["discordSink"] },
  { row: "Teams", exports: ["teamsSink"] },
  { row: "GitHub", exports: ["createGithubIssue"] },
  { row: "GitLab", exports: ["gitlabSink"] },
  { row: "Jira", exports: ["jiraSink"] },
  { row: "Linear", exports: ["createLinearIssue"] },
  { row: "Sentry", exports: ["sentrySink"] },
];

const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";
const npx = windows ? "npx.cmd" : "npx";

/**
 * `npm` is a batch file on Windows, and Node refuses to spawn one without a
 * shell, so there the command line is built by hand — which means quoting the
 * arguments that carry a path, because a temporary directory can sit under a
 * user name with a space in it.
 */
const run = (command, args, cwd) => {
  const options = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] };
  if (!windows) return execFileSync(command, args, options);
  const quoted = args.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg));
  // One string rather than a command and an argument array: passing both with
  // `shell: true` is deprecated, because Node concatenates them anyway.
  return execFileSync([command, ...quoted].join(" "), { ...options, shell: true });
};

const dir = mkdtempSync(join(tmpdir(), "bugbottle-sinks-"));

try {
  process.stderr.write("packing…\n");
  run(npm, ["pack", "--pack-destination", dir], root);
  const tarball = readdirSync(dir).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack produced no tarball");

  process.stderr.write("installing the tarball and esbuild…\n");
  run(npm, ["init", "-y"], dir);
  run(npm, ["install", "--silent", join(dir, tarball), ESBUILD], dir);

  const rows = [];
  for (const sink of SINKS) {
    const named = sink.exports.join(", ");
    const entry = `entry-${sink.row.toLowerCase()}.js`;
    // Re-exported rather than merely imported, so nothing the bundler sees is
    // dead code: a bundle that dropped the sink would measure the empty file.
    writeFileSync(
      join(dir, entry),
      `import { ${named} } from "bugbottle/server"; export { ${named} };\n`,
    );
    const out = `out-${sink.row.toLowerCase()}.js`;
    run(
      npx,
      [
        "esbuild",
        entry,
        "--bundle",
        "--minify",
        "--format=esm",
        "--platform=node",
        `--outfile=${out}`,
      ],
      dir,
    );
    const bytes = gzipSync(readFileSync(join(dir, out))).length;
    rows.push({ row: sink.row, bytes });
    process.stderr.write(`${sink.row}: ${bytes} bytes gzipped\n`);
  }

  const date = new Date().toISOString().slice(0, 10);
  process.stdout.write(`\nMeasured ${date} with ${ESBUILD}:\n\n`);
  for (const { row, bytes } of rows) {
    // The README quotes kilobytes to one decimal; the raw byte count is on the
    // same line so a small regression is visible without re-running this.
    process.stdout.write(`| ${row} | ${(bytes / 1024).toFixed(1)} kB | ${bytes} bytes |\n`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
