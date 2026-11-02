import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const release = readFileSync(new URL("../scripts/release.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");
const checkDist = new URL("../scripts/check-dist.mjs", import.meta.url);

for (const unstable of [false, true]) {
  test(`release ${unstable ? "stops before committing when the rebuild differs" : "checks rebuilt and newly emitted dist files before committing"}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "bugbottle-release-"));
    const commands: string[] = [];
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    let builds = 0;
    const build = () => {
      builds++;
      writeFileSync(join(dir, "dist/index.js"), unstable ? `build ${builds}` : "new version");
      writeFileSync(join(dir, "dist/new.js"), "new entry point");
    };
    try {
      git("init", "-q", "--initial-branch=main");
      mkdirSync(join(dir, "dist"));
      writeFileSync(join(dir, "dist/index.js"), "old version");
      writeFileSync(join(dir, ".gitignore"), "dist/\n");
      git("add", ".gitignore");
      git("add", "-f", "dist");
      git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Initial fixture");
      const files = new Map([
        ["package.json", '{"version":"1.1.0"}'],
        ["CHANGELOG.md", "## Unreleased\n"],
        ["README.md", "v1.1.0"],
        ["site/index.html", "Version 1.1.0"],
        ["site/da/index.html", "Version 1.1.0"],
        ["site/da/kom-i-gang.md", "v1.1.0"],
        ["src/sinks/sentry.ts", 'export const SENTRY_CLIENT_VERSION = "1.1.0";'],
      ]);
      const run = () => runInNewContext(release, {
        process: { argv: ["node", "release.mjs", "patch"] },
        console: { log() {}, error() {} },
        readFileSync: (file: string) => {
          assert.ok(files.has(file), `unexpected file: ${file}`);
          return files.get(file);
        },
        writeFileSync: (file: string, value: string) => files.set(file, value),
        execSync: (command: string) => {
          commands.push(command);
          if (command === "npm version patch --no-git-tag-version") files.set("package.json", '{"version":"1.1.1"}');
          else if (command === "npm run build") build();
          else if (command === "npm run check") {
            build();
            execFileSync(process.execPath, [checkDist.pathname], { cwd: dir, stdio: "pipe" });
          } else if (command.startsWith("git add ")) git(...command.slice(4).split(" "));
          else if (command === "git status --porcelain") return "";
          else if (command === "git branch --show-current") return "main";
          else if (!/^git (commit|tag|push) /.test(command)) throw new Error(`unexpected command: ${command}`);
          return "";
        },
      });
      if (unstable) {
        assert.throws(run);
        assert.ok(!commands.some((command) => /^git (commit|tag|push) /.test(command)));
      } else {
        run();
        assert.ok(commands.includes('git commit -q -m "Release 1.1.1"'));
        assert.ok(commands.includes("git push origin main v1.1.1"));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
