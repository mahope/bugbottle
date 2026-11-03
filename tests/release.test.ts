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
          if (command === "git tag --list") return "";
          else if (command === "npm view bugbottle versions --json --prefer-online") return '["1.1.0"]';
          else if (command === "npm version 1.1.1 --no-git-tag-version") files.set("package.json", '{"version":"1.1.1"}');
          else if (command === "npm run build") build();
          else if (command === "npm run check") {
            build();
            execFileSync(process.execPath, [checkDist.pathname], { cwd: dir, stdio: "pipe" });
          } else if (command.startsWith("git add ")) git(...command.slice(4).split(" "));
          else if (command === "git status --porcelain") return "";
          else if (command === "git branch --show-current") return "main";
          else if (!/^git (commit|tag(?! --list)|push) /.test(command)) throw new Error(`unexpected command: ${command}`);
          return "";
        },
      });
      if (unstable) {
        assert.throws(run);
        assert.ok(!commands.some((command) => /^git (commit|tag(?! --list)|push) /.test(command)));
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

for (const fixture of [
  { bump: "1.9.9", current: "1.10.0", error: /current version/ },
  { bump: "1.10.0", current: "1.10.0", error: /current version/ },
  { bump: "1.2.9", registry: '["1.2.10"]', error: /published/ },
  { bump: "2.0.0", tag: "v2.0.0", error: /tag/ },
  { bump: "2.9.9", tag: "v2.10.0", error: /tag/ },
  { bump: "2.0.0", registry: '["2.0.0"]', error: /published/ },
  { bump: "2.9.9", registry: '["2.10.0"]', error: /published/ },
  { bump: "patch", registry: "failure", error: /registry.*retry/i },
  { bump: "patch", current: "1.1.0", registry: '["1.0.0-beta.1","1.1.0"]', next: "1.1.1" },
  { bump: "1.1.1", registry: '["1.1.1-rc.1+build.2"]', next: "1.1.1" },
  { bump: "1.1.1", registry: '["1.2.0-beta.1"]', error: /published/ },
  { bump: "1.1.1", registry: '["1.1.1+build.2"]', error: /published/ },
  { bump: "1.1.1", registry: '["1.1.1+build-2"]', error: /published/ },
  ...["1.0.0-01", "1.0.0-beta..1", "1.0.0-", "01.0.0-beta.1"].map((value) =>
    ({ bump: "patch", registry: JSON.stringify(["1.0.0", value]), error: /registry.*retry/i })),
  ...["null", "[]", "{}", '"garbage"'].map((registry) =>
    ({ bump: "patch", registry, error: /registry.*retry/i })),
  { bump: "patch", current: "1.9.9", next: "1.9.10" },
  { bump: "minor", current: "1.9.9", next: "1.10.0" },
  { bump: "major", current: "1.9.9", next: "2.0.0" },
  { bump: "10.0.0", current: "9.10.11", tag: "v9.99.99", next: "10.0.0" },
]) {
  test(`release preflight ${JSON.stringify(fixture)}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "bugbottle-preflight-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    const current = fixture.current ?? "1.0.0";
    const mutations: string[] = [];
    try {
      git("init", "-q", "--initial-branch=main");
      writeFileSync(join(dir, "package.json"), JSON.stringify({ version: current }));
      git("add", "package.json");
      git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Fixture");
      if (fixture.tag) git("tag", fixture.tag);
      const snapshot = () => [
        readFileSync(join(dir, "package.json"), "utf8"),
        git("write-tree"), git("show-ref"), git("status", "--porcelain"),
      ];
      const before = snapshot();
      const run = () => runInNewContext(release, {
        process: { argv: ["node", "release.mjs", fixture.bump] },
        console,
        readFileSync: (file: string) => readFileSync(join(dir, file), "utf8"),
        writeFileSync: () => { mutations.push("write"); throw new Error("unexpected write"); },
        execSync: (command: string) => {
          if (command.startsWith("git ")) return git(...command.slice(4).split(" "));
          if (command === "npm view bugbottle versions --json --prefer-online") {
            if (fixture.registry === "failure") throw new Error("offline");
            return fixture.registry ?? JSON.stringify([current]);
          }
          mutations.push(command);
          throw new Error("mutation boundary");
        },
      });
      if (fixture.error) {
        assert.throws(run, fixture.error);
        assert.deepEqual(mutations, []);
      } else {
        assert.throws(run, /mutation boundary/);
        assert.deepEqual(mutations, [`npm version ${fixture.next} --no-git-tag-version`]);
      }
      assert.deepEqual(snapshot(), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
