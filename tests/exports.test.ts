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
