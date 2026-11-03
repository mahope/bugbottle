import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
});
for (const line of ["18", "19"]) {
  const dir = mkdtempSync(join(tmpdir(), `bugbottle-react${line}-`));
  assert.ok(!dir.startsWith(root), "Consumer must live outside the checkout");
  try {
    for (const file of ["package.json", "package-lock.json"]) {
      copyFileSync(new URL(`./fixtures/react${line}/${file}`, import.meta.url), join(dir, file));
    }
    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], dir);
    const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", dir], root));
    run("npm", ["install", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund", join(dir, packed.filename)], dir);
    const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
    assert.equal(lock.packages["node_modules/react"].version.split(".")[0], line);
    assert.equal(lock.packages["node_modules/@types/react"].version.split(".")[0], line);
    for (const extension of ["mjs", "ts"]) {
      copyFileSync(new URL(`./fixtures/react-consumer.${extension}`, import.meta.url), join(dir, `consumer.${extension}`));
    }
    process.stdout.write(run(process.execPath, ["consumer.mjs"], dir));
    run(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--strict", "--module", "NodeNext", "--target", "ES2022", "--lib", "ES2022,DOM", "consumer.ts"], dir);
    console.log(`React ${line}: packed TypeScript consumer passed`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
