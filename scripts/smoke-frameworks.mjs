import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "bugbottle-framework-consumer-"));
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "inherit"],
});
try {
  const [packed] = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", dir], root));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", "--omit=dev", "--omit=optional", "--legacy-peer-deps", "--no-audit", "--no-fund", join(dir, packed.filename)], dir);
  // Reuse the reviewed, lockfile-installed dev frameworks, never library source.
  for (const name of ["express", "fastify"]) {
    symlinkSync(join(root, "node_modules", name), join(dir, "node_modules", name), "junction");
  }
  const metadata = JSON.parse(run(process.execPath, ["--input-type=module", "-e", 'import p from "bugbottle/package.json" with { type: "json" }; console.log(JSON.stringify(p))'], dir));
  assert.equal(metadata.dependencies, undefined);
  assert.equal(existsSync(join(dir, "node_modules/bugbottle/src")), false);
  copyFileSync(new URL("./fixtures/framework-consumer.mjs", import.meta.url), join(dir, "smoke.mjs"));
  process.stdout.write(run(process.execPath, ["smoke.mjs"], dir));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
