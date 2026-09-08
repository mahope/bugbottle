/**
 * The published schema has to agree with the library that produced it, so the
 * fixtures the receiver accepts are validated against it here with ajv — the
 * same validator a consumer in another language would reach for.
 *
 * The schema is generated in-process rather than read from `dist/`: a test
 * that read the committed file would pass on a stale build and say nothing
 * about the types as they are now.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import {
  buildReportSchema,
  serialiseSchema,
  SCHEMA_ID,
} from "../scripts/build-schema.ts";
import {
  MAX_CONSOLE_ENTRIES,
  MAX_CONTACT_LENGTH,
  MAX_CONTEXT_LENGTHS,
  MAX_MESSAGE_LENGTH,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
  MAX_STACK_FRAMES,
  MAX_STACK_STRING_LENGTH,
  MAX_COOKIE_NAMES,
  MAX_STORAGE_KEYS,
  MAX_STORAGE_KEY_LENGTH,
  MAX_STORAGE_VALUE_LENGTH,
} from "../src/report-core.ts";
import { fullReportBody, reportBody } from "./report-fixtures.ts";

const schema = buildReportSchema();

/** One compiled validator for the whole file; generating the schema is the slow part. */
const validate = new Ajv2020({ strict: false }).compile(schema);

function errors(): string {
  return JSON.stringify(validate.errors ?? []);
}

test("the schema announces itself as 2020-12 under its published id", () => {
  assert.equal(schema.$id, SCHEMA_ID);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$ref, "#/$defs/BugReport");
  assert.equal(schema.title, "bugbottle report");
});

test("the report the handler tests post is valid against the schema", () => {
  assert.equal(validate(reportBody), true, errors());
});

test("a report with every section filled in is valid", () => {
  assert.equal(validate(fullReportBody), true, errors());
});

test("a client may add its own fields, exactly as handleReport allows", () => {
  assert.equal(validate({ ...reportBody, tenant: "acme", build: 412 }), true, errors());
});

test("a payload with the wrong types and an unknown report type is rejected", () => {
  const invalid = {
    type: "catastrophe",
    message: 42,
    context: { url: "/orders/91", viewport: "1440x900" },
    console: [{ level: "info", message: "hello" }],
  };

  assert.equal(validate(invalid), false, "the bad payload must not validate");
  const keywords = (validate.errors ?? []).map((e) => e.keyword);
  assert.ok(keywords.includes("enum"), `expected an enum failure, got ${errors()}`);
});

test("a report without a message or a context is rejected", () => {
  assert.equal(validate({ type: "bug" }), false);
});

test("the MAX_ limits travel with the schema, so another language can enforce them", () => {
  const properties = (schema.$defs as Record<string, Record<string, Record<string, Record<string, unknown>>>>)
    .BugReport!.properties!;

  assert.equal(properties.message?.maxLength, MAX_MESSAGE_LENGTH);
  assert.equal(properties.console?.maxItems, MAX_CONSOLE_ENTRIES);
  assert.equal(properties.screenshotDataUrl?.maxLength, MAX_SCREENSHOT_DATA_URL_LENGTH);

  assert.equal(properties.contact?.maxLength, MAX_CONTACT_LENGTH);

  assert.equal(validate({ ...reportBody, message: "x".repeat(MAX_MESSAGE_LENGTH + 1) }), false);
  assert.equal(validate({ ...reportBody, contact: "anna@example.com" }), true, errors());
  assert.equal(validate({ ...reportBody, contact: "x".repeat(MAX_CONTACT_LENGTH + 1) }), false);
  assert.equal(validate({ ...reportBody, contact: 42 }), false, "a contact line is text");
});

test("the stack and context ceilings travel with the schema too", () => {
  const defs = schema.$defs as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
  const context = defs.ReportContext!.properties!;
  assert.equal(context.language?.maxLength, MAX_CONTEXT_LENGTHS.language);
  assert.equal(context.timezone?.maxLength, MAX_CONTEXT_LENGTHS.timezone);
  assert.equal(context.screen?.maxLength, MAX_CONTEXT_LENGTHS.screen);
  assert.equal(context.connection?.maxLength, MAX_CONTEXT_LENGTHS.connection);
  assert.deepEqual(context.colorScheme?.enum, ["dark", "light"]);

  assert.equal(defs.ConsoleEntry!.properties!.stack?.maxItems, MAX_STACK_FRAMES);
  const frame = defs.StackFrame!.properties!;
  assert.equal(frame.file?.maxLength, MAX_STACK_STRING_LENGTH);
  assert.equal(frame.fn?.maxLength, MAX_STACK_STRING_LENGTH);
  assert.ok(!("source" in frame), "a frame never carries source text");

  const sepia = { ...fullReportBody.context, colorScheme: "sepia" };
  assert.equal(
    validate({ ...fullReportBody, context: sepia }),
    false,
    "an unknown colour scheme is not a colour scheme",
  );
});

test("only a PNG data url passes as a screenshot", () => {
  assert.equal(validate({ ...reportBody, screenshotDataUrl: "https://example.com/a.png" }), false);
});

test("the JSDoc on the types becomes the documentation in the schema", () => {
  const context = (schema.$defs as Record<string, Record<string, Record<string, Record<string, unknown>>>>)
    .ReportContext!.properties!;
  assert.match(String(context.url?.description), /origin and the fragment are left out/);
});

test("two builds of the same types serialise to the same bytes", () => {
  // dist/ is committed, so an unstable key order would show up as a diff on
  // every build and the CI dist guard would fail for no reason.
  assert.equal(serialiseSchema(buildReportSchema()), serialiseSchema(schema));
});

test("the storage ceilings the validator enforces are published in the schema", () => {
  const defs = schema.$defs as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
  const storage = defs.StorageSnapshot!.properties!;
  assert.equal(storage.local?.maxItems, MAX_STORAGE_KEYS);
  assert.equal(storage.session?.maxItems, MAX_STORAGE_KEYS);
  assert.equal(storage.cookies?.maxItems, MAX_COOKIE_NAMES);
  const cookieItems = storage.cookies?.items as Record<string, unknown> | undefined;
  assert.equal(cookieItems?.maxLength, MAX_STORAGE_KEY_LENGTH);
  const value = storage.values?.additionalProperties as Record<string, unknown> | undefined;
  assert.equal(value?.maxLength, MAX_STORAGE_VALUE_LENGTH);
  assert.equal(defs.StorageKeyRef!.properties!.key?.maxLength, MAX_STORAGE_KEY_LENGTH);
});

test("a report whose storage is over the published caps is rejected by the schema", () => {
  const tooMany = {
    ...reportBody,
    storage: { local: Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, length: 1 })) },
  };
  assert.equal(validate(tooMany), false, "51 keys is past the cap the validator clips at");
});

test("a perf block of the wrong shape is rejected by the schema", () => {
  assert.equal(validate({ ...reportBody, perf: { lcp: "fast" } }), false);
  assert.equal(validate({ ...reportBody, perf: { lcp: 3412 } }), true, errors());
});
