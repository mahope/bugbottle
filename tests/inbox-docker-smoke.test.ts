import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../scripts/inbox-docker-smoke.mjs", import.meta.url), "utf8");
function harness(results: object[]) {
  const errors: string[] = [];
  const process = { env: {}, exitCode: 0 };
  const api = runInNewContext(source.slice(source.indexOf("const name ="), source.indexOf('for (const signal')) +
    "\n({ docker, cleanup, password, authorization, message });", {
    root: ".", Buffer, randomUUID: () => "fixture", randomBytes: () => Buffer.alloc(32, 42),
    spawnSync: () => { assert.ok(results.length, "unexpected Docker call"); return results.shift(); },
    console: { error: (text: string) => errors.push(text) }, process,
  });
  return { ...api, errors, process };
}

test("Docker build failures retain bounded diagnostics and redact fixture secrets", () => {
  const result = { status: 1, stdout: "COPY failed: dist missing", stderr: "" };
  const h = harness([result]);
  result.stderr = `${"x".repeat(20_000)} ${h.password} ${h.authorization} ${h.message} package resolution failed`;
  assert.throws(() => h.docker(["build"]), /exit 1/);
  const output = h.errors.join("\n");
  assert.match(output, /COPY failed: dist missing/);
  assert.match(output, /package resolution failed/);
  assert.ok(output.length < 9000);
  for (const secret of [h.password, h.authorization, h.message]) assert.ok(!output.includes(secret));
});

test("Docker errors distinguish timeout, spawn failure and signal termination", () => {
  for (const [result, pattern] of [
    [{ status: null, error: { code: "ETIMEDOUT" } }, /timed out/],
    [{ status: null, error: { code: "ENOENT" } }, /spawn error ENOENT/],
    [{ status: null, signal: "SIGTERM" }, /signal SIGTERM/],
  ] as const) {
    const h = harness([result]);
    assert.throws(() => h.docker(["build"]), pattern);
  }
});

test("cleanup fails closed when resource absence cannot be confirmed", () => {
  for (const inspect of [
    { status: 1, stderr: "Cannot connect to the Docker daemon" },
    { status: null, error: { code: "ETIMEDOUT" } },
    { status: 0, stdout: "[]" },
  ]) {
    const h = harness([{ status: 1 }, inspect, { status: 0 }, { status: 0 }]);
    h.cleanup();
    assert.equal(h.process.exitCode, 1);
    assert.match(h.errors.join("\n"), /cleanup failed/);
  }
});

test("cleanup accepts confirmed missing resources after partial startup", () => {
  const h = harness([
    { status: 1 }, { status: 1, stderr: "Error: No such container: bugbottle-inbox-smoke-fixture" },
    { status: 1 }, { status: 1, stderr: "Error response from daemon: get bugbottle-inbox-smoke-fixture-data: no such volume" },
    { status: 1 }, { status: 1, stderr: "Error response from daemon: No such image: bugbottle-inbox-smoke-fixture:test" },
  ]);
  h.cleanup();
  assert.equal(h.process.exitCode, 0);
  assert.deepEqual(h.errors, []);
});
