import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
        assert.ok(commands.includes("git push --atomic origin main v1.1.1"));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const scenario of ["success", "advanced main", "no atomic support"]) {
  test(`release push with ${scenario} preserves transactional refs and recovery state`, () => {
    const dir = mkdtempSync(join(tmpdir(), "bugbottle-release-push-"));
    const local = join(dir, "local");
    const remote = join(dir, "remote.git");
    const bin = join(dir, "bin");
    const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
    try {
      mkdirSync(local);
      mkdirSync(bin);
      git(dir, "init", "--bare", "--initial-branch=main", remote);
      git(local, "init", "--initial-branch=main");
      git(local, "config", "user.name", "Test");
      git(local, "config", "user.email", "test@example.invalid");
      for (const path of ["site/da", "src/sinks", "scripts", "dist"]) mkdirSync(join(local, path), { recursive: true });
      for (const [file, content] of [
        ["package.json", '{"version":"1.1.0"}'],
        ["CHANGELOG.md", "## Unreleased\n"],
        ["README.md", "v1.1.0"],
        ["site/index.html", "Version 1.1.0"],
        ["site/da/index.html", "Version 1.1.0"],
        ["site/da/kom-i-gang.md", "v1.1.0"],
        ["src/sinks/sentry.ts", 'export const SENTRY_CLIENT_VERSION = "1.1.0";'],
        ["scripts/release.mjs", readFileSync(new URL("../scripts/release.mjs", import.meta.url), "utf8")],
      ] as const) writeFileSync(join(local, file), content);
      git(local, "add", ".");
      git(local, "commit", "-qm", "Initial fixture");
      git(local, "remote", "add", "origin", remote);
      git(local, "push", "origin", "main");
      if (scenario === "advanced main") {
        const other = join(dir, "other");
        git(dir, "clone", remote, other);
        git(other, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "Advance remote main");
        git(other, "push", "origin", "main");
      }
      if (scenario === "no atomic support") git(remote, "config", "receive.advertiseAtomic", "false");
      const before = git(remote, "show-ref");
      // Only npm is stubbed: the release process performs real commits, tags and pushes.
      writeFileSync(join(bin, "npm"), `#!${process.execPath}
const fs = require("node:fs");
if (process.argv[2] === "version") fs.writeFileSync("package.json", '{"version":"1.1.1"}');
`);
      chmodSync(join(bin, "npm"), 0o755);
      const result = spawnSync(process.execPath, ["scripts/release.mjs", "patch"], {
        cwd: local, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      assert.ifError(result.error);
      const head = git(local, "rev-parse", "HEAD");
      assert.equal(git(local, "rev-parse", "refs/tags/v1.1.1"), head);
      assert.equal(git(local, "log", "-1", "--format=%s"), "Release 1.1.1");
      assert.equal(git(local, "status", "--porcelain"), "");
      if (scenario === "success") {
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Released 1\.1\.1/);
        assert.equal(git(remote, "rev-parse", "refs/heads/main"), head);
        assert.equal(git(remote, "rev-parse", "refs/tags/v1.1.1"), head);
      } else {
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.stdout, /Released/);
        assert.equal(git(remote, "show-ref"), before);
        assert.equal(git(remote, "tag", "--list", "v1.1.1"), "");
        assert.match(result.stderr, scenario === "advanced main" ? /rejected|non-fast-forward/ : /does not support --atomic push/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
