import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("CI and publishing require the isolated Node 18 consumer smoke", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const smoke = read("../.github/workflows/min-node-smoke.yml");
  assert.match(smoke, /node-version: 22/);
  assert.match(smoke, /node-version: 18/);
  assert.match(smoke, /node scripts\/smoke-packed.mjs/);
  for (const workflow of ["ci", "release"]) {
    assert.match(read(`../.github/workflows/${workflow}.yml`), /uses: \.\/\.github\/workflows\/min-node-smoke.yml/);
  }
  assert.match(read("../.github/workflows/release.yml"), /publish:\s+needs: min-node-smoke/);
});
