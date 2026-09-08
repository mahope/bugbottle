/**
 * The entry points are the public API, and three files have to agree about
 * them: `package.json#exports` is the truth, the README's "API" section is what
 * a reader is told, and CLAUDE.md's count is what the next contributor works
 * from. They drifted apart once — a subpath shipped that the README never
 * named — so this test is the pin, written after the pre-1.0 audit
 * (`docs/api-audit-1.0.md`).
 *
 * It reads the repository rather than `dist/`: a new entry is added to
 * `package.json` and the documentation in the same change, and the build comes
 * afterwards.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (name: string): string => readFileSync(root + name, "utf8");

const pkg = JSON.parse(read("package.json")) as {
  exports: Record<string, unknown>;
};
const entries = Object.entries(pkg.exports);
/** The subpaths that resolve to code, so `./report.schema.json` is not one. */
const code = entries.filter(([, value]) => typeof value === "object");

/** English for the numbers an entry-point count is ever going to reach. */
const WORDS = [
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
  "Twenty",
];

/**
 * The exports map itself, written out. From 1.0 this is the API contract: a
 * subpath removed from here needs a major version and a subpath added needs a
 * minor one, so neither can happen without this list being edited on purpose.
 * The order is `package.json`'s, because a reader compares the two.
 */
const SUBPATHS = [
  ".",
  "./react",
  "./vue",
  "./svelte",
  "./solid",
  "./server",
  "./html-to-image",
  "./annotate",
  "./breadcrumbs",
  "./network",
  "./perf",
  "./rrweb",
  "./sign",
  "./queue",
  "./queue-idb",
  "./triggers",
  "./shake",
  "./locales",
  "./locales-extra",
  "./ui",
  "./report.schema.json",
  "./openapi.json",
  "./package.json",
];

test("the exports map is exactly the twenty-three subpaths 1.0 promises", () => {
  assert.deepEqual(
    entries.map(([name]) => name),
    SUBPATHS,
    "adding or removing a subpath is a version decision: minor to add, major to remove",
  );
});

test("the frozen API table names every entry point", () => {
  const audit = read("docs/api-audit-1.0.md");
  for (const [name] of code) {
    const heading = "### `bugbottle" + (name === "." ? "" : name.slice(1)) + "`";
    assert.ok(audit.includes(heading), `docs/api-audit-1.0.md has no section ${heading}`);
  }
});

test("every entry point points at a file that the build emits", () => {
  for (const [name, value] of code) {
    const target = value as { types?: string; default?: string };
    assert.ok(target.types, `${name} declares no types`);
    assert.ok(target.default, `${name} declares no default`);
    assert.match(target.types!, /^\.\/dist\/.+\.d\.ts$/, `${name} types`);
    assert.match(target.default!, /^\.\/dist\/.+\.js$/, `${name} default`);
    assert.equal(
      target.default!.replace(/\.js$/, ".d.ts"),
      target.types,
      `${name} declares types for a different file than it loads`,
    );
  }
});

test("the README's API section names every entry point", () => {
  const readme = read("README.md");
  const api = readme.slice(readme.indexOf("\n## API"), readme.indexOf("\n## Releasing"));
  assert.ok(api.length > 0, "the API section is where it was");
  for (const [name] of code) {
    const named = name === "." ? "**`bugbottle`**" : "**`bugbottle" + name.slice(1) + "`**";
    assert.ok(api.includes(named), `the API section never mentions ${named}`);
  }
  assert.ok(api.includes("`bugbottle/report.schema.json`"), "the schema is an entry too");
  assert.ok(api.includes("`bugbottle/openapi.json`"), "so is the OpenAPI document");
});

/**
 * The other thing that drifts is the sinks table at the top of "Sending it
 * somewhere" (#83): a twelfth sink lands, the prose gets a subsection, and the
 * table quietly describes eleven. So the table is read back and matched against
 * the sink-shaped exports of `src/server/index.ts`, in both directions.
 */

/** The exports the table is about: a factory, a send function, an issue call. */
const isSink = (name: string): boolean =>
  /^[a-z]/.test(name) &&
  (/Sink$/.test(name) || /^sendReport/.test(name) || /^create[A-Z].*Issue$/.test(name));

/** Every value the server entry re-exports from `src/sinks/`, types dropped. */
function sinkExports(): string[] {
  const source = read("src/server/index.ts");
  const names: string[] = [];
  for (const block of source.matchAll(/export\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    if (!block[2]!.startsWith("../sinks/")) continue;
    for (const entry of block[1]!.split(",")) {
      const name = entry.trim().split(/\s+as\s+/)[0]!.trim();
      if (!name || name.startsWith("type ")) continue;
      if (isSink(name)) names.push(name);
    }
  }
  return names;
}

/** The rows of the one table in the "Sending it somewhere" section. */
function sinkTableRows(): string[][] {
  const readme = read("README.md");
  const start = readme.indexOf("\n## Sending it somewhere");
  const section = readme.slice(start, readme.indexOf("\n## ", start + 4));
  return section
    .split("\n")
    // Trimmed first, because a checkout with CRLF endings leaves a carriage
    // return where the closing pipe is expected.
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|$/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
}

test("the README's sinks table has a row for every sink and invents none", () => {
  const rows = sinkTableRows();
  const header = rows.shift();
  assert.deepEqual(header, [
    "Sink",
    "Export",
    "What you need",
    "The picture",
    "Self-hosted",
    "One report becomes",
    "Server bundle",
  ]);

  const named = new Set<string>();
  for (const row of rows) {
    assert.equal(row.length, header!.length, `row "${row[0]}" has ${row.length} cells`);
    const exported = [...row[1]!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
    assert.ok(exported.length > 0, `row "${row[0]}" names no export`);
    for (const name of exported) named.add(name);
    // The measured size is what the row is for; an empty cell would otherwise
    // still be a well-formed table.
    assert.match(row[6]!, /^\d+(\.\d+)? kB$/, `row "${row[0]}" has no measured size`);
  }

  const actual = sinkExports();
  for (const name of actual) {
    assert.ok(named.has(name), `the sinks table has no row naming ${name}`);
  }
  for (const name of named) {
    assert.ok(actual.includes(name), `the sinks table names ${name}, which is not exported`);
  }
  assert.equal(rows.length, 11, `eleven sinks, ${rows.length} rows`);
});

/**
 * The core entry is what a reader opens first to learn what the browser half
 * of the library is, so the things a *receiving server* does with a report are
 * not in it (#68). `REPORT_TYPES` and `isReportType` are the exception, and a
 * named one: the panel and the adapters build the type radiogroup out of them,
 * and `ReportType` would otherwise be a type with no values behind it.
 */
test("the core entry carries no server validator and no Markdown renderer", async () => {
  const core = await import("../src/index.ts");
  const names = Object.keys(core);
  const server = names.filter(
    (name) => /^normalise/.test(name) || name === "toMarkdown" || name === "validateReport",
  );
  assert.deepEqual(server, [], `bugbottle exports ${server.join(", ")}, which belong on /server`);
  assert.ok(names.includes("REPORT_TYPES"), "the panel builds its radiogroup out of these");
  assert.ok(names.includes("isReportType"));

  // And they are all still one import away, where they belong.
  const serverEntry = await import("../src/server/index.ts");
  for (const name of ["normaliseMessage", "normaliseConsole", "normaliseNotes", "toMarkdown"]) {
    assert.ok(name in serverEntry, `bugbottle/server should still export ${name}`);
  }
});

test("CLAUDE.md counts the entry points it lists", () => {
  const claude = read("CLAUDE.md");
  const word = WORDS[code.length - 10];
  assert.ok(word, `no English word for ${code.length} entry points`);
  assert.ok(
    claude.includes(`${word} entry points in \`package.json#exports\``),
    `CLAUDE.md should say "${word} entry points"; there are ${code.length}`,
  );
  for (const [name] of code) {
    const listed = name === "." ? "`.`" : "`" + name + "`";
    assert.ok(claude.includes(listed), `CLAUDE.md's list is missing ${listed}`);
  }
});
