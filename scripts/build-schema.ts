/**
 * Builds `dist/report.schema.json`, the JSON Schema for the payload a browser
 * POSTs to your endpoint.
 *
 * It is generated from `BugReport` in `src/report-core.ts` rather than written
 * by hand, so the schema cannot drift from the type the library actually
 * sends. The JSDoc on those types becomes the `description` of each property,
 * which is the whole reason the comments are worth keeping there.
 *
 * The generator speaks draft-07; the shape it emits is also valid 2020-12, so
 * the dialect is switched and `definitions` renamed to `$defs` afterwards. The
 * `MAX_*` constants are applied in the same pass, because a length ceiling
 * lives in the validator rather than in the type and a receiver in another
 * language has no other way to learn it.
 *
 * The output is written with recursively sorted keys. `dist/` is committed, so
 * an unstable key order would show up as a diff on every build.
 *
 * Run after tsc by `npm run build`, and imported by `tests/schema.test.ts`,
 * which validates the report fixtures against what this produces.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGenerator } from "ts-json-schema-generator";
import {
  MAX_BREADCRUMBS,
  MAX_CONTEXT_LENGTHS,
  MAX_BREADCRUMB_TEXT_LENGTH,
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_MESSAGE_LENGTH,
  MAX_COOKIE_NAMES,
  MAX_ELEMENTS,
  MAX_ELEMENT_TEXT_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_NETWORK_ENTRIES,
  MAX_REPLAY_EVENTS,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
  MAX_STACK_FRAMES,
  MAX_STACK_STRING_LENGTH,
  MAX_STORAGE_KEYS,
  MAX_STORAGE_KEY_LENGTH,
  MAX_STORAGE_VALUE_LENGTH,
} from "../src/report-core.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the schema is served from, and the identity a receiver caches it by. */
export const SCHEMA_ID = "https://bugbottle.dev/schema/report.json";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";

/** What `decodeScreenshotDataUrl` insists on before it decodes anything. */
const PNG_DATA_URL_PATTERN = "^data:image/png;base64,";

type Json = Record<string, unknown>;

/**
 * Reads a nested object out of the generated schema, or throws.
 *
 * Renaming a type or a property would otherwise quietly stop a limit from
 * being applied, and a schema that has silently lost its ceilings is worse
 * than one that was never generated: it looks authoritative.
 */
function at(schema: Json, path: string[]): Json {
  let node: unknown = schema;
  const walked: string[] = [];
  for (const key of path) {
    if (typeof node !== "object" || node === null) {
      throw new Error(`Schema path ${walked.join(".")} is not an object`);
    }
    node = (node as Json)[key];
    walked.push(key);
    if (node === undefined) {
      throw new Error(`Schema path ${walked.join(".")} is missing; did a type get renamed?`);
    }
  }
  return node as Json;
}

/** Rewrites every `#/definitions/…` reference the generator left behind. */
function retargetRefs(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) retargetRefs(item);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const obj = node as Json;
  if (typeof obj.$ref === "string") {
    obj.$ref = obj.$ref.replace("#/definitions/", "#/$defs/");
  }
  for (const value of Object.values(obj)) retargetRefs(value);
}

/**
 * Generates the schema for `BugReport` and returns it as a plain object.
 *
 * Exported so the test can check the same thing the build writes, rather than
 * a file that may or may not have been rebuilt.
 */
export function buildReportSchema(): Json {
  const generated = createGenerator({
    path: join(root, "src", "report-core.ts"),
    tsconfig: join(root, "tsconfig.json"),
    type: "BugReport",
    jsDoc: "extended",
    topRef: true,
    // A client may add its own fields, and `handleReport` keeps them as
    // `extra`. A schema that refused them would describe a stricter library
    // than the one we ship.
    additionalProperties: true,
  }).createSchema("BugReport") as Json;

  const defs = at(generated, ["definitions"]);
  retargetRefs(defs);

  const report = at(defs, ["BugReport", "properties"]);
  at(report, ["message"]).maxLength = MAX_MESSAGE_LENGTH;
  at(report, ["console"]).maxItems = MAX_CONSOLE_ENTRIES;
  at(report, ["elements"]).maxItems = MAX_ELEMENTS;
  at(report, ["breadcrumbs"]).maxItems = MAX_BREADCRUMBS;
  at(report, ["network"]).maxItems = MAX_NETWORK_ENTRIES;

  // The replay's real bound is its serialised size, which no JSON Schema
  // keyword can express; the event count is the half that can be written down.
  const replay = at(defs, ["ReplayCapture", "properties"]);
  at(replay, ["events"]).maxItems = MAX_REPLAY_EVENTS;

  const storage = at(defs, ["StorageSnapshot", "properties"]);
  at(storage, ["local"]).maxItems = MAX_STORAGE_KEYS;
  at(storage, ["session"]).maxItems = MAX_STORAGE_KEYS;
  at(storage, ["cookies"]).maxItems = MAX_COOKIE_NAMES;
  at(storage, ["cookies", "items"]).maxLength = MAX_STORAGE_KEY_LENGTH;
  at(storage, ["values", "additionalProperties"]).maxLength = MAX_STORAGE_VALUE_LENGTH;

  const storageKey = at(defs, ["StorageKeyRef", "properties"]);
  at(storageKey, ["key"]).maxLength = MAX_STORAGE_KEY_LENGTH;

  const screenshot = at(report, ["screenshotDataUrl"]);
  screenshot.maxLength = MAX_SCREENSHOT_DATA_URL_LENGTH;
  screenshot.pattern = PNG_DATA_URL_PATTERN;

  const entry = at(defs, ["ConsoleEntry", "properties"]);
  at(entry, ["message"]).maxLength = MAX_CONSOLE_MESSAGE_LENGTH;
  at(entry, ["stack"]).maxItems = MAX_STACK_FRAMES;

  const frame = at(defs, ["StackFrame", "properties"]);
  at(frame, ["file"]).maxLength = MAX_STACK_STRING_LENGTH;
  at(frame, ["fn"]).maxLength = MAX_STACK_STRING_LENGTH;

  // The optional context facts are tokens, and their ceilings live in
  // `normaliseContext` rather than in the type, so a receiver in another
  // language has no other way to learn them.
  const context = at(defs, ["ReportContext", "properties"]);
  for (const [key, max] of Object.entries(MAX_CONTEXT_LENGTHS)) {
    at(context, [key]).maxLength = max;
  }

  at(defs, ["ElementRef", "properties", "text"]).maxLength = MAX_ELEMENT_TEXT_LENGTH;
  at(defs, ["Breadcrumb", "properties", "text"]).maxLength = MAX_BREADCRUMB_TEXT_LENGTH;

  return {
    $schema: DIALECT,
    $id: SCHEMA_ID,
    title: "bugbottle report",
    description:
      "The JSON body bugbottle POSTs to your endpoint. Generated from the " +
      "BugReport type; the maxLength and maxItems ceilings are the ones the " +
      "server-side validators enforce.",
    $ref: "#/$defs/BugReport",
    $defs: defs,
  };
}

/**
 * Serialises with recursively sorted keys, so two builds of the same types
 * produce byte-identical files and `dist/` only changes when the schema does.
 */
export function serialiseSchema(schema: Json): string {
  return `${JSON.stringify(sortKeys(schema), null, 2)}\n`;
}

function sortKeys(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sortKeys);
  if (typeof node !== "object" || node === null) return node;
  const out: Json = {};
  for (const key of Object.keys(node as Json).sort()) {
    out[key] = sortKeys((node as Json)[key]);
  }
  return out;
}

// Only when run as a script: the test imports the two functions above and
// writes nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outfile = join(root, "dist", "report.schema.json");
  mkdirSync(dirname(outfile), { recursive: true });
  const json = serialiseSchema(buildReportSchema());
  writeFileSync(outfile, json, "utf8");
  console.log(`dist/report.schema.json: ${Buffer.byteLength(json)} bytes`);
}
