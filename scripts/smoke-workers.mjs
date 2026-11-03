import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import workerd from "workerd";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "bugbottle-workers-"));
const run = (args, cwd) => execFileSync("npm", args, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 60_000,
});
let runtime;
let exited;
let watchdog;
const interrupt = () => {
  process.exitCode = 1;
  runtime?.kill("SIGTERM");
};
try {
  const [packed] = JSON.parse(run(["pack", "--json", "--ignore-scripts", "--pack-destination", dir], root));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run(["install", "--ignore-scripts", "--omit=dev", "--omit=optional", "--legacy-peer-deps",
    "--no-audit", "--no-fund", join(dir, packed.filename)], dir);
  const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
  assert.deepEqual(Object.keys(lock.packages).sort(), ["", "node_modules/bugbottle"]);
  copyFileSync(join(root, "examples/workers/worker.mjs"), join(dir, "worker.mjs"));
  copyFileSync(join(root, "scripts/fixtures/workers-smoke.mjs"), join(dir, "smoke.mjs"));
  copyFileSync(join(root, "examples/workers/workerd.capnp"), join(dir, "workerd.capnp"));
  const result = await build({
    entryPoints: [join(dir, "smoke.mjs")], outfile: join(dir, "bundle.mjs"),
    bundle: true, format: "esm", platform: "neutral", metafile: true,
    // Resolve unused Node-only barrel exports, without providing implementations.
    external: ["node:*"],
  });
  for (const output of Object.values(result.metafile.outputs)) {
    assert.deepEqual(output.imports, [], "No external modules may reach workerd");
  }
  assert.doesNotMatch(readFileSync(join(dir, "bundle.mjs"), "utf8"), /node:/);
  runtime = spawn(workerd.default, ["serve", "--control-fd=3", "workerd.capnp"], {
    cwd: dir, stdio: ["ignore", "inherit", "inherit", "pipe"],
  });
  exited = once(runtime, "exit");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  watchdog = setTimeout(() => runtime.kill("SIGKILL"), 30_000);
  const lines = createInterface({ input: runtime.stdio[3] });
  const ready = (async () => {
    for await (const line of lines) {
      const event = JSON.parse(line);
      if (event.event === "listen") return `http://127.0.0.1:${event.port}`;
    }
    throw new Error("workerd closed before listening");
  })();
  const origin = await Promise.race([ready, exited.then(() => { throw new Error("workerd exited before ready"); })]);
  const request = (path, options) => fetch(origin + path, { ...options, signal: AbortSignal.timeout(5_000) });
  const body = JSON.stringify({ type: "bug", message: "Workers smoke", context: { url: "/smoke" }, console: [] });
  const post = (text = body, origin = "https://app.example", signature) => ({
    method: "POST", body: text,
    headers: { "Content-Type": "application/json", Origin: origin,
      ...(signature ? { "X-Bugbottle-Signature": signature } : {}) },
  });
  const stored = async () => (await request("/__stored")).json();
  const response = await request("/report", post());
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: "report_1" });
  const [report] = await stored();
  assert.equal(report.message, "Workers smoke");
  assert.equal(report.context.url, "/smoke");
  assert.ok(Number.isFinite(Date.parse(report.receivedAt)));
  assert.equal((await request("/report", post("{"))).status, 400);
  assert.equal((await request("/report", post(body, "https://forbidden.example"))).status, 401);
  assert.equal((await stored()).length, 1, "Rejected reports must not reach storage");

  // The signature is minted inside workerd, with its native WebCrypto.
  const signature = await (await request("/__sign", { method: "POST", body })).text();
  assert.equal((await request("/signed-report", post())).status, 401);
  assert.equal((await request("/signed-report", post(body + " ", "https://app.example", signature))).status, 401);
  assert.equal((await request("/signed-report", post(body, "https://app.example", signature))).status, 201);
  assert.equal((await request("/signed-report", post(body, "https://app.example", signature))).status, 401);
  assert.equal((await stored()).length, 2, "Only the valid signed report reaches storage");
  console.log("Workers: packed public server export, storage, JSON/origin rejection and native WebCrypto passed");
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  clearTimeout(watchdog);
  try {
    if (runtime && runtime.exitCode === null && runtime.signalCode === null) {
      runtime.kill("SIGTERM");
      const force = setTimeout(() => runtime.kill("SIGKILL"), 2_000);
      try { await exited; } finally { clearTimeout(force); }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
