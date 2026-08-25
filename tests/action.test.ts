/**
 * Tests for the GitHub Action's validation logic.
 *
 * The action inlines report-core's rules (zero-dependency requirement for
 * actions), so these tests pin the two implementations together: the same
 * inputs must get the same verdict from both.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ACTION = new URL("../action/index.cjs", import.meta.url).pathname;

function runAction(files: Record<string,string>, env: Record<string,string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bugbottle-action-"));
  try {
    for (const [name, content] of Object.entries(files) as [string, string][]) {
      const p = join(dir, name);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, content);
    }
    const out = execFileSync(process.execPath, [ACTION], {
      cwd: dir,
      env: { ...process.env, ...env, INPUT_REPORTS_GLOB: env.INPUT_REPORTS_GLOB ?? GLOB },
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
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
  assert.match(r.out, /::set-output name=valid-count::2/);
});

test("malformed report fails with ::error annotations", () => {
  const r = runAction({ "reports/bad.json": JSON.stringify({ type: "nope", message: "" }) });
  assert.equal(r.code, 1);
  assert.match(r.out, /::error::reports\/bad\.json: type must be one of/);
  assert.match(r.out, /::set-output name=invalid-count::1/);
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
  const enforced = runAction({ "reports/s.json": missing }, { INPUT_REQUIRE_SCREENSHOT: "true" });
  assert.equal(enforced.code, 1);
  assert.match(enforced.out, /screenshot required but absent/);
});

test("glob matches only report files", () => {
  const r = runAction({ "src/code.js": "console.log(1)", "reports/a.json": goodReport }, { INPUT_REPORTS_GLOB: "reports/*.json" });
  assert.equal(r.code, 0, r.out);
});

test("no matching files is an error, not a silent pass", () => {
  const r = runAction({}, { INPUT_REPORTS_GLOB: "reports/*.json" });
  assert.equal(r.code, 1);
  assert.match(r.out, /no report files matched/);
});
