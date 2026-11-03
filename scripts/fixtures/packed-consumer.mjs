import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const metadata = require("bugbottle/package.json");
const root = dirname(require.resolve("bugbottle/package.json"));
assert.equal(existsSync(join(root, "src")), false, "The consumer must not have package source");

// These entries require peers supplied by the application. Svelte is type-only.
const peers = new Set(["./react", "./vue", "./solid", "./html-to-image"]);
let imported = 0;
for (const entry of Object.keys(metadata.exports)) {
  if (peers.has(entry) || entry.endsWith(".json")) continue;
  const specifier = entry === "." ? "bugbottle" : `bugbottle/${entry.slice(2)}`;
  assert.ok(require.resolve(specifier).startsWith(join(root, "dist") + "/"));
  assert.ok(Object.keys(await import(specifier)).length > 0, specifier);
  imported++;
}

const schema = require("bugbottle/report.schema.json");
const openapi = require("bugbottle/openapi.json");
assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.ok(schema.$defs.BugReport.properties.message);
assert.match(openapi.openapi, /^3\./);
assert.ok(openapi.paths["/api/bug-report"]);

const { handleReport } = await import("bugbottle/server");
let stored;
const options = {
  store: async (report) => { stored = report; return { id: "smoke_1" }; },
};
const post = (message) => new Request("https://example.invalid/bug-report", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "bug", message, context: { url: "/smoke" }, console: [] }),
});
const invalid = await handleReport(post(""), options);
assert.equal(invalid.status, 400);
assert.equal(stored, undefined);
const response = await handleReport(post("Packed runtime smoke"), options);
assert.equal(response.status, 201);
assert.deepEqual(await response.json(), { id: "smoke_1" });
assert.equal(stored.message, "Packed runtime smoke");
assert.equal(stored.type, "bug");
assert.equal(stored.context.url, "/smoke");
assert.deepEqual(stored.console, []);
assert.ok(Number.isFinite(Date.parse(stored.receivedAt)));
console.log(`Node ${process.versions.node}: ${imported} dependency-free entries, both JSON contracts and handleReport passed`);
