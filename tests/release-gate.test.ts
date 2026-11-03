import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("publication requires the complete reusable CI on the caller's SHA", () => {
  const ci = read("../.github/workflows/ci.yml");
  const release = read("../.github/workflows/release.yml");
  assert.match(ci, /on:\s+workflow_call:/);
  assert.match(release, /validation:\s+uses: \.\/\.github\/workflows\/ci.yml/);
  assert.match(release, /publish:\s+needs: validation/);
  assert.match(ci, /@redocly\/cli@.* lint dist\/openapi.json/);
  for (const job of ["min-node-smoke", "check", "bundle", "browser"]) {
    assert.match(ci, new RegExp(`\\n  ${job}:`));
  }
  // No ref override may make a called job validate another commit.
  assert.doesNotMatch(ci, /^\s+ref:/m);
  assert.doesNotMatch(release, /^\s+ref:/m);
  const condition = release.match(/if: \$\{\{ (needs.validation.result == 'success') \}\}/)?.[1];
  assert.ok(condition, "publish must fail closed on the aggregate validation result");
  for (const result of ["success", "failure", "cancelled", "skipped", "pending", undefined]) {
    assert.equal(runInNewContext(condition, { needs: { validation: { result } } }), result === "success");
  }
  assert.ok(release.indexOf("node scripts/check-release-ref.mjs") < release.indexOf("npm publish"));
  assert.match(release, /fetch-depth: 0/);
});

test("tag and manual releases require a matching version tag at the exact SHA", () => {
  const source = read("../scripts/check-release-ref.mjs").replace(/^import .*;\n/gm, "");
  const sha = "a".repeat(40);
  for (const event of ["push", "workflow_dispatch"]) {
    for (const fixture of ["valid", "branch", "version", "other-sha", "missing-tag", "wrong-checkout"]) {
      const writes: string[] = [];
      const run = () => runInNewContext(source, {
        process: { env: {
          GITHUB_EVENT_NAME: event, GITHUB_REF: fixture === "branch" ? "refs/heads/main" : "refs/tags/v1.2.3",
          GITHUB_REF_NAME: "v1.2.3", GITHUB_SHA: sha, GITHUB_ENV: "env-file",
        } },
        readFileSync: () => JSON.stringify({ version: fixture === "version" ? "1.2.4" : "1.2.3" }),
        appendFileSync: (_path: string, value: string) => writes.push(value),
        execFileSync: (_command: string, args: string[]) => {
          if (args.includes("refs/tags/v1.2.3^{commit}")) {
            if (fixture === "missing-tag") throw new Error("missing tag");
            return fixture === "other-sha" ? "b".repeat(40) : sha;
          }
          assert.deepEqual(Array.from(args), ["rev-parse", "HEAD"]);
          return fixture === "wrong-checkout" ? "b".repeat(40) : sha;
        },
      });
      if (fixture === "valid") {
        run();
        assert.deepEqual(writes, ["RELEASE_TAG=v1.2.3\n"]);
      } else {
        assert.throws(run, `${event}: ${fixture}`);
        assert.deepEqual(writes, []);
      }
    }
  }
});
