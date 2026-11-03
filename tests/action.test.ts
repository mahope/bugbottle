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
import { fileURLToPath } from "node:url";

const ACTION = fileURLToPath(new URL("../action/index.cjs", import.meta.url));

function runAction(files: Record<string,string>, env: Record<string,string> = {}, forbidReportAccess = false) {
  const dir = mkdtempSync(join(tmpdir(), "bugbottle-action-"));
  try {
    for (const [name, content] of Object.entries(files) as [string, string][]) {
      const p = join(dir, name);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, content);
    }
    const args = [ACTION];
    if (forbidReportAccess) {
      const guard = join(dir, "guard.cjs");
      writeFileSync(guard, `const fs = require('node:fs');
const readFile = fs.readFileSync;
const refuse = () => { throw new Error('report access before configuration validation'); };
fs.readdirSync = refuse;
fs.readFileSync = (file, ...args) => file === ${JSON.stringify(ACTION)} ? readFile(file, ...args) : refuse();
require(${JSON.stringify(ACTION)});`);
      args[0] = guard;
    }
    const out = execFileSync(process.execPath, args, {
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

test("default size limit remains 4096 KB", () => {
  const below = runAction({ "reports/a.json": goodReport.padEnd(4096 * 1024, " ") });
  assert.equal(below.code, 0, below.out);
  const above = runAction({ "reports/a.json": goodReport.padEnd(4096 * 1024 + 1, " ") });
  assert.equal(above.code, 1);
  assert.match(above.out, /file larger than 4096 KB/);
});

test("custom size limit accepts a report one byte below and rejects one byte above", () => {
  const r = runAction({
    "reports/below.json": goodReport.padEnd(1023, " "),
    "reports/above.json": goodReport.padEnd(1025, " "),
  }, { INPUT_MAX_REPORT_SIZE_KB: "1" });
  assert.equal(r.code, 1);
  assert.match(r.out, /ok: reports\/below.json/);
  assert.match(r.out, /reports\/above.json: unreadable or oversized \(file larger than 1 KB\)/);
  assert.match(r.out, /1 valid, 1 invalid/);
  assert.doesNotMatch(r.out, /configuration error/);
});

for (const limit of ["nonsense", "10junk", "0", "-1", "NaN", "Infinity", "-Infinity", "1e309", "0.5", "1.5", "0x10", "1e3", "9007199254740992", " ", " 1", "1\n", "+1"]) {
  test(`invalid size limit ${limit} fails before walking or reading reports`, () => {
    const r = runAction({ "reports/a.json": goodReport }, { INPUT_MAX_REPORT_SIZE_KB: limit }, true);
    assert.equal(r.code, 1);
    assert.match(r.out, /::error::configuration error: max-report-size-kb must be a positive safe integer in KB/);
    assert.doesNotMatch(r.out, /report access|unreadable or oversized|valid-count|invalid-count/);
  });
}
