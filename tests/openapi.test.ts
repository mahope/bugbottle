/**
 * The OpenAPI document is generated, so what has to be tested is not the JSON
 * but the agreement between it and the handler it describes.
 *
 * The document is built in-process rather than read from `dist/`, for the same
 * reason `tests/schema.test.ts` builds the schema: a test that read the
 * committed file would pass on a stale build and say nothing about the code as
 * it is now.
 *
 * The status list is not written down twice either. Every answer
 * `handleReport` can give is *exercised* below and collected, and the document
 * is then required to describe each one. A new status that nobody documents
 * fails here rather than in a reader's generator six months later.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenApiDocument,
  serialiseOpenApi,
  OPENAPI_ID,
  REPORT_PATH,
  SIGNATURE_SCHEME,
} from "../scripts/build-openapi.ts";
import { handleReport, resetDedupe, resetRateLimits } from "../src/server/handle.ts";
import { MAX_MESSAGE_LENGTH, MAX_CONSOLE_ENTRIES } from "../src/report-core.ts";
import { reportBody as body } from "./report-fixtures.ts";

type Json = Record<string, unknown>;

const doc = buildOpenApiDocument();

function post(payload: unknown, init: RequestInit = {}): Request {
  return new Request("https://app.example.com/api/bug-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    ...init,
  });
}

function streamed(stream: ReadableStream<Uint8Array>): Request {
  return new Request("https://app.example.com/api/bug-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  } as unknown as RequestInit);
}

/** The path item, whatever the path is called. */
function pathItem(): Json {
  const paths = doc.paths as Json;
  const item = paths[REPORT_PATH];
  assert.ok(item, `the document has no ${REPORT_PATH} path`);
  return item as Json;
}

/** Every status code the document answers with, across every method. */
function documented(): Set<string> {
  const out = new Set<string>();
  for (const operation of Object.values(pathItem())) {
    const responses = (operation as Json).responses as Json | undefined;
    if (!responses) continue;
    for (const status of Object.keys(responses)) out.add(status);
  }
  return out;
}

test("the required top-level keys of an OpenAPI 3.1 document are all there", () => {
  assert.match(String(doc.openapi), /^3\.1\.\d+$/);
  const info = doc.info as Json;
  assert.ok(info, "info");
  assert.equal(typeof info.title, "string");
  assert.equal(typeof info.version, "string");
  assert.equal(typeof info.description, "string");
  assert.ok(doc.paths, "paths");
  assert.ok(doc.components, "components");
  assert.equal(doc.$id, OPENAPI_ID);
  // 3.1 lets a document declare the JSON Schema dialect its schemas speak, and
  // ours are the report schema unchanged, so it is the 2020-12 one.
  assert.equal(doc.jsonSchemaDialect, "https://json-schema.org/draft/2020-12/schema");
});

test("the report endpoint is a POST that takes a BugReport", () => {
  const item = pathItem();
  const operation = item.post as Json;
  assert.ok(operation, "the path has no post operation");
  assert.equal(typeof operation.operationId, "string");
  const requestBody = operation.requestBody as Json;
  assert.equal(requestBody.required, true);
  const media = (requestBody.content as Json)["application/json"] as Json;
  assert.deepEqual(media.schema, { $ref: "#/components/schemas/BugReport" });
  assert.ok(item.options, "the CORS preflight is an operation too, or its 204 is undocumented");
});

test("every status handleReport can answer is documented", async () => {
  const answered = new Set<string>();
  const record = (response: Response): Response => {
    answered.add(String(response.status));
    return response;
  };

  resetRateLimits();
  resetDedupe();

  // 201: stored, with an id.
  record(await handleReport(post(body), { store: async () => ({ id: "rep_1" }) }));
  // 202: accepted, nothing stored.
  record(await handleReport(post(body), {}));
  // 200: a duplicate of one already seen.
  const dedupe = { windowMs: 60_000 };
  await handleReport(post(body), { dedupe, store: async () => ({ id: "rep_2" }) });
  record(await handleReport(post(body), { dedupe, store: async () => ({ id: "rep_3" }) }));
  resetDedupe();
  // 204: the CORS preflight.
  record(
    await handleReport(new Request("https://app.example.com/api/bug-report", { method: "OPTIONS" }), {
      cors: true,
    }),
  );
  // 400: a body that is not JSON, and a report with nothing written in it.
  record(await handleReport(post("{not json"), {}));
  record(await handleReport(post({ message: "   " }), {}));
  // 401: an authorize that says no.
  record(await handleReport(post(body), { authorize: () => false }));
  // 401 again, from a signature that does not match.
  record(
    await handleReport(post(body, { headers: { "X-Bugbottle-Signature": "t=1,v1=00" } }), {
      signature: { key: "secret" },
    }),
  );
  // 405: anything that is not a POST.
  record(
    await handleReport(new Request("https://app.example.com/api/bug-report", { method: "GET" }), {}),
  );
  // 408: a body that never finishes arriving.
  let cancelled = false;
  const dribble = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (cancelled) return;
      try {
        controller.enqueue(new TextEncoder().encode(" "));
      } catch {
        // The reader gave up between the wait and the enqueue.
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  record(await handleReport(streamed(dribble), { bodyTimeoutMs: 40 }));
  // 413: a body over the ceiling.
  record(await handleReport(post(body), { maxBodyBytes: 10 }));
  // 429: past the rate limit.
  resetRateLimits();
  const rateLimit = { limit: 1, windowMs: 60_000, key: () => "one-caller" };
  await handleReport(post(body), { rateLimit });
  record(await handleReport(post(body), { rateLimit }));
  resetRateLimits();
  // 500: a store that throws.
  record(
    await handleReport(post(body), {
      store: async () => {
        throw new Error("the database is on fire");
      },
      onError: () => {},
    }),
  );

  const expected = ["200", "201", "202", "204", "400", "401", "405", "408", "413", "429", "500"];
  assert.deepEqual([...answered].sort(), expected, "the handler answered something new");

  const described = documented();
  for (const status of answered) {
    assert.ok(described.has(status), `${status} is answered but not documented`);
  }
  for (const status of described) {
    assert.ok(answered.has(status), `${status} is documented but the handler never answers it`);
  }
});

test("the answers carry the body shape the handler actually sends", () => {
  const responses = (pathItem().post as Json).responses as Json;
  const schemaOf = (status: string): Json => {
    const response = responses[status] as Json;
    assert.ok(response, `no ${status}`);
    const content = response.content as Json | undefined;
    assert.ok(content, `${status} documents no body`);
    return (content["application/json"] as Json).schema as Json;
  };

  assert.deepEqual(schemaOf("201"), { $ref: "#/components/schemas/Created" });
  assert.deepEqual(schemaOf("202"), { $ref: "#/components/schemas/Accepted" });
  assert.deepEqual(schemaOf("200"), { $ref: "#/components/schemas/Duplicate" });
  for (const status of ["400", "401", "405", "408", "413", "429", "500"]) {
    assert.deepEqual(schemaOf(status), { $ref: "#/components/schemas/ErrorBody" });
  }

  const schemas = (doc.components as Json).schemas as Json;
  assert.deepEqual((schemas.ErrorBody as Json).required, ["error"]);
  assert.deepEqual((schemas.Created as Json).required, ["id"]);
  assert.deepEqual((schemas.Duplicate as Json).required, ["duplicate"]);
  // 204 carries no body, and a response object that claimed one would be a lie.
  const preflight = ((pathItem().options as Json).responses as Json)["204"] as Json;
  assert.equal(preflight.content, undefined);
});

test("the signature header is an apiKey scheme, described for what it is", () => {
  const schemes = (doc.components as Json).securitySchemes as Json;
  const scheme = schemes[SIGNATURE_SCHEME] as Json;
  assert.equal(scheme.type, "apiKey");
  assert.equal(scheme.in, "header");
  assert.equal(scheme.name, "X-Bugbottle-Signature");
  assert.match(String(scheme.description), /spam deterrence/);
  assert.match(String(scheme.description), /not authentication/);

  // Optional, because an endpoint without `signature` set takes reports
  // unsigned: the empty requirement is what says so.
  const security = (pathItem().post as Json).security as unknown[];
  assert.deepEqual(security, [{}, { [SIGNATURE_SCHEME]: [] }]);
});

test("the limits travel with the document, and nothing still points at $defs", () => {
  const schemas = (doc.components as Json).schemas as Json;
  const report = (schemas.BugReport as Json).properties as Json;
  assert.equal((report.message as Json).maxLength, MAX_MESSAGE_LENGTH);
  assert.equal((report.console as Json).maxItems, MAX_CONSOLE_ENTRIES);
  assert.ok(schemas.ReportContext, "the referenced definitions came along");

  const text = JSON.stringify(doc);
  assert.ok(!text.includes("#/$defs/"), "a reference was left pointing at the schema's $defs");
  for (const ref of text.matchAll(/"\$ref":"([^"]+)"/g)) {
    const target = ref[1]!;
    assert.match(target, /^#\/components\/schemas\/[A-Za-z0-9_]+$/, target);
    assert.ok(schemas[target.slice("#/components/schemas/".length)], `${target} resolves to nothing`);
  }
});

test("two builds serialise to the same bytes", () => {
  // dist/ is committed, so an unstable key order would show up as a diff on
  // every build and the CI dist guard would fail for no reason.
  assert.equal(serialiseOpenApi(buildOpenApiDocument()), serialiseOpenApi(doc));
});
