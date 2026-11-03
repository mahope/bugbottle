/**
 * Tests for the GitHub Action's validation logic.
 *
 * The action inlines report-core's rules (zero-dependency requirement for
 * actions), so these tests pin the two implementations together: the same
 * inputs must get the same verdict from both.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ACTION = fileURLToPath(new URL("../action/index.cjs", import.meta.url));

function runAction(files: Record<string,string>, env: Record<string,string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bugbottle-action-"));
  try {
    for (const [name, content] of Object.entries(files) as [string, string][]) {
      const p = join(dir, name);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, content);
    }
    const outputFile = join(dir, "github-output");
    writeFileSync(outputFile, "existing=value\n");
    const runnerEnv: NodeJS.ProcessEnv = {
      ...process.env,
      "INPUT_REPORTS-GLOB": GLOB,
      "INPUT_REQUIRE-SCREENSHOT": "false",
      "INPUT_MAX-REPORT-SIZE-KB": "4096",
      GITHUB_OUTPUT: outputFile,
      ...env,
    };
    if (env.GITHUB_OUTPUT === "") delete runnerEnv.GITHUB_OUTPUT;
    const result = spawnSync(process.execPath, [ACTION], {
      cwd: dir,
      env: runnerEnv,
      encoding: "utf8",
    });
    assert.ifError(result.error);
    return {
      code: result.status,
      out: result.stdout + result.stderr,
      outputs: readFileSync(outputFile, "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GLOB = "reports/*.json";

const goodReport = JSON.stringify({
  type: "bug",
  message: "Button does nothing on submit",
  context: { url: "https://example.com/x", viewport: "1280x800", userAgent: "test" },
});

// A real minimal PNG (1x1 transparent) as a data URL.
const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU3DQgAAAABJRU5ErkJggg==";

test("valid reports pass and exit 0", () => {
  const r = runAction({ "reports/a.json": goodReport, "reports/b.json": JSON.stringify({ type: "idea", message: "hi", context: { url: "", viewport: "", userAgent: "" } }) });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2 valid, 0 invalid/);
  assert.equal(r.outputs, "existing=value\nvalid-count=2\ninvalid-count=0\n");
  assert.doesNotMatch(r.out, /::set-output/);
});

test("malformed report fails with ::error annotations", () => {
  const r = runAction({ "reports/bad.json": JSON.stringify({ type: "nope", message: "" }) });
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::reports\/bad\.json: type must be one of/);
  assert.equal(r.outputs, "existing=value\nvalid-count=0\ninvalid-count=1\n");
  assert.doesNotMatch(r.out, /::set-output/);
});

test("non-JSON file fails cleanly", () => {
  const r = runAction({ "reports/x.json": "{not json" });
  assert.equal(r.code, 1);
  assert.match(r.out, /unreadable or oversized/);
});

test("invalid screenshot data URL is rejected", () => {
  const bad = JSON.stringify({
    type: "bug",
    message: "m",
    context: {},
    screenshotDataUrl: "data:image/png;base64,AAAA",
  });
  const r = runAction({ "reports/s.json": bad });
  assert.equal(r.code, 1);
  assert.match(r.out, /not a valid PNG data URL/);
});

test("valid tiny PNG passes; require-screenshot enforces presence", () => {
  const withShot = JSON.stringify({ type: "bug", message: "m", context: { url: "https://e.com", viewport: "1x1", userAgent: "t" }, screenshotDataUrl: tinyPng });
  const ok = runAction({ "reports/s.json": withShot });
  assert.equal(ok.code, 0, ok.out);

  const missing = JSON.stringify({ type: "bug", message: "m", context: {} });
  const enforced = runAction({ "reports/s.json": missing }, { "INPUT_REQUIRE-SCREENSHOT": "true" });
  assert.equal(enforced.code, 1);
  assert.match(enforced.out, /screenshot required but absent/);
});

test("glob matches only report files", () => {
  const r = runAction({ "src/code.js": "console.log(1)", "reports/a.json": goodReport }, { "INPUT_REPORTS-GLOB": "reports/*.json" });
  assert.equal(r.code, 0, r.out);
});

test("no matching files is an error, not a silent pass", () => {
  const r = runAction({}, { "INPUT_REPORTS-GLOB": "reports/*.json" });
  assert.equal(r.code, 1);
  assert.match(r.out, /no report files matched/);
});

const globFixtures = [
  { pattern: "reports/**/*.json", matches: ["reports/a.json"], excludes: ["reports/a.txt"] },
  { pattern: "**/*.json", matches: ["a.json", "reports/nested/a.json"], excludes: ["a.txt", "node_modules/a.json", ".git/a.json"] },
  { pattern: "reports/**/*.json", matches: ["reports/a.json", "reports/nested/a.json", "reports/nested/deep/a.json"], excludes: ["reports/a.txt", "reports/nested/a.json.bak", "reports-other/a.json"] },
  { pattern: "reports/*.json", matches: ["reports/a.json", "reports/.json"], excludes: ["reports/nested/a.json", "reports/a.txt", "reports-other/a.json"] },
  { pattern: "reports/?.json", matches: ["reports/a.json"], excludes: ["reports/.json", "reports/ab.json", "reports/x/y.json", "reports/a.txt"] },
  { pattern: "reports?.json", matches: ["reportsa.json"], excludes: ["reports/.json", "reports.json", "reportsab.json"] },
  { pattern: "reports/**.json", matches: ["reports/a.json", "reports/nested/deep/a.json"], excludes: ["reports/a.txt", "reports-other/a.json"] },
  { pattern: "reports/a.+(x)[1]{$}^|.json", matches: ["reports/a.+(x)[1]{$}^|.json"], excludes: ["reports/aaax1.json", "reports/a.+(x)[1]{$}^|Xjson"] },
  { pattern: "reports/**/*.json", matches: [], excludes: ["reports/a.txt", "reports-other/a.json", "node_modules/reports/a.json", ".git/reports/a.json"] },
];

for (const { pattern, matches, excludes } of globFixtures) {
  test(`glob ${pattern} selects exactly ${JSON.stringify(matches)}`, () => {
    const files = Object.fromEntries([...matches, ...excludes].map((name) => [name, goodReport]));
    const r = runAction(files, { "INPUT_REPORTS-GLOB": pattern });
    assert.equal(r.code, matches.length ? 0 : 1, r.out);
    const selected = r.out.split("\n").filter((line) => line.startsWith("ok: ")).map((line) => line.slice(4));
    assert.deepEqual(selected.sort(), [...matches].sort(), r.out);
    if (!matches.length) assert.match(r.out, /no report files matched/);
  });
}

test("runner max-report-size-kb input limits file size", () => {
  const r = runAction({ "reports/a.json": goodReport }, { "INPUT_MAX-REPORT-SIZE-KB": "0" });
  assert.equal(r.code, 1);
  assert.match(r.out, /file larger than 0 KB/);
  assert.equal(r.outputs, "existing=value\nvalid-count=0\ninvalid-count=1\n");
});

test("standalone validation without GITHUB_OUTPUT keeps its exit status and summary", () => {
  for (const [report, code] of [[goodReport, 0], ["{}", 1]] as const) {
    const r = runAction({ "reports/a.json": report }, { GITHUB_OUTPUT: "" });
    assert.equal(r.code, code, r.out);
    assert.match(r.out, /bugbottle: .* report\(s\)/);
    assert.doesNotMatch(r.out, /::set-output/);
    assert.equal(r.outputs, "existing=value\n");
  }
});
