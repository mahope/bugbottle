/**
 * The README's code is the code people paste, and nothing in the build can
 * tell a snippet that runs from a snippet that 500s. This file pins the two
 * kinds of snippet that have actually been wrong.
 *
 * The first is `fileStore` (#33). It answers an *object* — `store`, `list`,
 * `read`, `remove`, `prune`, `refresh` — while `handleReport`'s `store` option
 * is a function it calls. Six snippets passed the object straight in, on the
 * Hono, Express, Fastify, NestJS and GitLab pages and in the opening, and a
 * reader who pasted one got a `TypeError` and a 500 with no report. The API
 * section said "whose store answers `store`", so the type was documented and
 * the examples were not; the first test below is the trap itself, and the
 * second is the six.
 *
 * The second is the opening (#33), which is also `/docs/install/`. It is the
 * one part of the README a reader arrives at *instead* of reading the rest,
 * and it had no line in it that sent a report: the first snippet that built
 * one was 3 700 lines down and the first complete round trip 7 800. So the
 * third test asks that it names the whole round trip, and the fourth asks
 * that every `bugbottle` import in it is a name the package still exports —
 * a rename cannot leave the quickstart naming a function that is gone.
 *
 * It reads the repository rather than `dist/`, like `exports.test.ts`: the
 * README is changed in the same commit as the code it documents.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = readFileSync(root + "README.md", "utf8");

/** The fenced code blocks, the way a reader meets them: one page of code at a time. */
function fences(markdown: string): string[] {
  const blocks: string[] = [];
  let open: string | null = null;
  let body: string[] = [];
  for (const line of markdown.split("\n")) {
    const marker = /^\s*(```+|~~~+)/.exec(line);
    if (!marker) {
      if (open !== null) body.push(line);
      continue;
    }
    if (open === null) {
      open = marker[1]!;
      body = [];
      continue;
    }
    if (marker[1]![0] === open[0]) {
      blocks.push(body.join("\n"));
      open = null;
    }
  }
  return blocks;
}

/** The index just past the `)` that closes the call starting at `from`. */
function callEnd(fence: string, from: number): number {
  let depth = 0;
  for (let i = from; i < fence.length; i += 1) {
    if (fence[i] === "(") depth += 1;
    else if (fence[i] === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return fence.length;
}

test("fileStore answers an object, so a store option is its .store", async () => {
  const { fileStore } = await import("../src/server/index.ts");
  /* No I/O: the directory is walked on the first call that needs it, not here,
     so a temporary path that does not exist is safe to construct against. */
  const store = fileStore({ dir: `${tmpdir()}/bugbottle-readme-test` });
  assert.notEqual(typeof store, "function", "if this changed, every snippet changed with it");
  assert.equal(typeof store.store, "function", "handleReport calls this one");
  assert.equal(typeof store.list, "function", "and the inbox reads through this one");
});

test("every README snippet that stores a report reaches fileStore's .store", () => {
  /* The three names that take a `store`. A fence that only *reads* the
     directory — the retention example calls `prune()` and never hands the
     object anywhere — is not a fence that can be wrong this way. */
  const receivers = /\b(handleReport|expressHandler|fastifyHandler)\s*\(/;
  const wrong: string[] = [];
  for (const fence of fences(readme)) {
    if (!fence.includes("fileStore(") || !receivers.test(fence)) continue;
    for (const match of fence.matchAll(/fileStore\(/g)) {
      /* Everything after the call: `.store` on the same expression, or a
         variable the rest of the block then reaches through (the shape
         "Storing it" uses, because it also calls list() and prune()). */
      const after = fence.slice(callEnd(fence, match.index!));
      if (!after.includes(".store")) {
        wrong.push(fence.split("\n").find((line) => line.includes("fileStore("))!.trim());
      }
    }
  }
  assert.deepEqual(
    wrong,
    [],
    "fileStore() answers an object; a store option is a function handleReport calls. " +
      "Write `.store` — a pasted object throws and the reader gets a 500 instead of a report.",
  );
});

/** The opening: everything above the first `##`, which is also /docs/install/. */
const intro = readme.slice(0, readme.indexOf("\n## "));

test("the opening carries a whole report, both halves of it", () => {
  for (const [what, needle] of [
    ["the browser half's import", 'from "bugbottle"'],
    ["the receiving half's import", 'from "bugbottle/server"'],
    ["the console buffer, or the report arrives empty", "initConsoleBuffer("],
    ["the builder", "buildReport("],
    ["the send", "sendReport("],
    ["the endpoint", "handleReport("],
    ["the store that makes it 201 rather than 202", "fileStore("],
  ] as const) {
    assert.ok(intro.includes(needle), `the opening is missing ${what}: ${needle}`);
  }
});

test("every bugbottle import in the opening is a name the package still exports", async () => {
  const core = await import("../src/index.ts");
  const server = await import("../src/server/index.ts");
  for (const fence of fences(intro)) {
    for (const match of fence.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(bugbottle[^"]*)"/g)) {
      const [, names, from] = match;
      const entry = from === "bugbottle" ? core : server;
      for (const name of names!.split(",")) {
        const bare = name.trim().split(/\s+as\s+/)[0]!.trim();
        if (!bare || bare.startsWith("type ")) continue;
        assert.ok(
          bare in entry,
          `the opening imports ${bare} from ${from}, which no longer exports it — ` +
            `the first thing a reader pastes would not resolve`,
        );
      }
    }
  }
});
