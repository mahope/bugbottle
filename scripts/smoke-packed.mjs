import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.versions.node.split(".")[0], "18", "Run the consumer smoke on Node 18");
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "bugbottle-node18-"));
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
});

try {
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", dir], root));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--omit=dev", "--omit=optional", "--legacy-peer-deps",
    "--no-audit", "--no-fund", join(dir, packed.filename)], dir);
  const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
  assert.deepEqual(Object.keys(lock.packages).sort(), ["", "node_modules/bugbottle"]);
  copyFileSync(new URL("./fixtures/packed-consumer.mjs", import.meta.url), join(dir, "smoke.mjs"));
  process.stdout.write(run(process.execPath, ["smoke.mjs"], dir));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
