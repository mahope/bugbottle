/**
 * Builds `dist/openapi.json`, an OpenAPI 3.1 description of the endpoint a
 * report is POSTed to.
 *
 * A team that gates its APIs on an OpenAPI document should not have to
 * hand-write one for an endpoint whose payload and whose answers are both
 * already written down in this repository. So neither half of this file is
 * typed out: the request body is `dist/report.schema.json` — generated from
 * `BugReport`, ceilings and all — and the responses are the ones
 * `handleReport` gives, with `tests/openapi.test.ts` exercising the handler
 * for each of them and refusing a status that is answered but not described.
 *
 * OpenAPI 3.1 is a superset of JSON Schema 2020-12, which is the dialect the
 * report schema already speaks, so the `$defs` move into
 * `components/schemas` unchanged and only the `$ref` targets are rewritten.
 * That is the whole reason the schema is generated in that dialect.
 *
 * What this document cannot tell you is *where* your endpoint lives: it is
 * your route, in your application, and the path below is the one the README's
 * examples use. Change it after importing if yours differs; nothing in the
 * library reads it.
 *
 * The output is written with recursively sorted keys, exactly as
 * `scripts/build-schema.ts` writes the schema, because `dist/` is committed
 * and an unstable key order would show up as a diff on every build.
 *
 * Run by `npm run build` straight after the schema, and imported by
 * `tests/openapi.test.ts`, which writes nothing.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildReportSchema, SCHEMA_ID } from "./build-schema.ts";
import { DEFAULT_SIGNATURE_HEADER } from "../src/sign.ts";
import { DEFAULT_MAX_BODY_BYTES } from "../src/server/handle.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where the document is served from, beside the report schema.
 *
 * It travels as `x-bugbottle-id` rather than `$id`: OpenAPI 3.1 closes the
 * root object, so a `$id` there is a structural error in the meta-schema even
 * though the same keyword is legal in every schema below it.
 */
export const OPENAPI_ID = "https://bugbottle.dev/schema/openapi.json";

/** The route the README's examples mount the handler on. */
export const REPORT_PATH = "/api/bug-report";

/** The name the signature header is referred to by inside the document. */
export const SIGNATURE_SCHEME = "bugbottleSignature";

const DIALECT = "https://json-schema.org/draft/2020-12/schema";

type Json = Record<string, unknown>;

/** Rewrites every `#/$defs/…` reference into the OpenAPI components section. */
function retargetRefs(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) retargetRefs(item);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const obj = node as Json;
  if (typeof obj.$ref === "string") {
    obj.$ref = obj.$ref.replace("#/$defs/", "#/components/schemas/");
  }
  for (const value of Object.values(obj)) retargetRefs(value);
}

/**
 * The two headers every answer carries once `cors` is set — including the
 * refusals, because `handleReport` puts them on every response it builds.
 *
 * They are written out rather than `$ref`-ed at `#/components/headers`, so
 * that every `$ref` in the document points at a schema and a reader chasing
 * one never leaves the schemas section.
 */
function corsResponseHeaders(): Json {
  return {
    "Access-Control-Allow-Origin": {
      description:
        "Present only when `cors` is set: `*` for `cors: true`, otherwise the " +
        "single origin you configured.",
      schema: { type: "string" },
    },
    Vary: {
      description:
        "`Origin`, sent alongside `Access-Control-Allow-Origin` so a shared cache " +
        "never hands one origin's answer to another.",
      schema: { type: "string" },
    },
  };
}

/**
 * Puts those headers on every answer of an operation, which is what
 * `handleReport` does: the CORS header goes on the refusals as well, or a
 * browser would see a network error instead of the sentence explaining itself.
 */
function withCorsHeaders(responses: Json): Json {
  const out: Json = {};
  for (const [status, response] of Object.entries(responses)) {
    out[status] = { ...(response as Json), headers: corsResponseHeaders() };
  }
  return out;
}

/** One JSON answer, with the schema it always has. */
function jsonResponse(description: string, schema: string, example: unknown): Json {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: `#/components/schemas/${schema}` },
        example,
      },
    },
  };
}

/** One of the handler's `{ error }` answers. The string is the one it sends. */
function errorResponse(description: string, error: string): Json {
  return jsonResponse(description, "ErrorBody", { error });
}

/**
 * Builds the document and returns it as a plain object.
 *
 * Exported so the test can check the same thing the build writes, rather than
 * a file that may or may not have been rebuilt.
 */
export function buildOpenApiDocument(): Json {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
    homepage: string;
    license: string;
  };

  const schema = buildReportSchema();
  const schemas = schema.$defs as Json;
  retargetRefs(schemas);

  const megabytes = DEFAULT_MAX_BODY_BYTES / (1024 * 1024);

  return {
    openapi: "3.1.0",
    // A document served under an address may as well say so — but as an
    // extension, because the 3.1 meta-schema closes the root object and a
    // `$id` there is a structural error rather than the identifier it looks
    // like.
    "x-bugbottle-id": OPENAPI_ID,
    jsonSchemaDialect: DIALECT,
    // There is no bugbottle service to point at, so the only honest server is
    // the reader's own: the path below is relative to whatever origin the
    // application that mounted `handleReport` is served from.
    servers: [
      {
        url: "/",
        description:
          "Your own origin. bugbottle runs no service, so the path is relative " +
          "to the application you mounted `handleReport` in.",
      },
    ],
    info: {
      title: "bugbottle report endpoint",
      version: pkg.version,
      summary: "The endpoint a bugbottle client POSTs a report to.",
      description:
        "bugbottle is a client library, not a service: this describes the endpoint " +
        "**you** run, as `handleReport` from `bugbottle/server` behaves. The request " +
        "body is the published report schema (" +
        SCHEMA_ID +
        "), inlined here so the document stands on its own; the responses are the " +
        "ones the handler gives. The path below is the one the README's examples " +
        "use — yours is wherever you mounted the route, and the only server listed " +
        "is your own origin, because there is no bugbottle server to list.\n\n" +
        "Several answers only occur when the matching option is set: 200 needs " +
        "`dedupe`, 401 needs `authorize` or `signature`, 429 needs `rateLimit`, and " +
        "204 needs `cors`. A handler configured without them simply never sends " +
        "them, which is why they are documented rather than promised.",
      license: { name: pkg.license, identifier: pkg.license },
      contact: { name: "bugbottle", url: pkg.homepage },
    },
    externalDocs: { description: "The README", url: `${pkg.homepage}/docs/` },
    paths: {
      [REPORT_PATH]: {
        summary: "One report in, one answer out.",
        post: {
          operationId: "postBugReport",
          summary: "Receive a bug report",
          description:
            "The body is validated field by field, optionally scrubbed and " +
            "deduplicated, the screenshot is decoded and checked against the PNG " +
            "signature in its bytes, and the report is stored and fanned out to the " +
            "sinks. Unknown top-level fields are kept as `extra` rather than " +
            "refused, so the request schema allows them.",
          // Both entries are deliberate: an endpoint configured without
          // `signature` takes reports unsigned, and the empty requirement is
          // how OpenAPI says a scheme is optional.
          security: [{}, { [SIGNATURE_SCHEME]: [] }],
          requestBody: {
            required: true,
            description: `The report. At most ${megabytes} MB by default; over that is a 413.`,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BugReport" },
              },
            },
          },
          responses: withCorsHeaders({
            "200": jsonResponse(
              "A duplicate of a report already seen inside the dedupe window. " +
                "Nothing was stored and no sink ran; the id, when there is one, is " +
                "the first copy's.",
              "Duplicate",
              { id: "rep_7", duplicate: true },
            ),
            "201": jsonResponse(
              "Stored. The id is whatever your `store` returned, and the client " +
                "hands it to `onSent`.",
              "Created",
              { id: "rep_7" },
            ),
            "202": jsonResponse(
              "Accepted and delivered to the sinks, but no `store` was configured, " +
                "so there is no id to give back.",
              "Accepted",
              {},
            ),
            "400": errorResponse(
              "The body was not JSON, or the report had no message. The `error` is " +
                "shown to the reporter, so it is a sentence rather than a code.",
              "Write a message first",
            ),
            "401": errorResponse(
              "`authorize` said no, or the `X-Bugbottle-Signature` header was " +
                "missing, stale or wrong.",
              "Not allowed",
            ),
            "405": errorResponse(
              "The route was reached with something other than POST — a GET, most " +
                "likely. Documented here because it is this path's answer; those " +
                "methods are not operations of their own. The OPTIONS operation " +
                "below documents its own 405.",
              "Method not allowed",
            ),
            "408": errorResponse(
              "The body was still arriving when the deadline passed. The stream is " +
                "cancelled rather than drained.",
              "Report took too long to arrive",
            ),
            "413": errorResponse(
              `The body was over the ceiling — ${megabytes} MB unless \`maxBodyBytes\` ` +
                "says otherwise. Counted as it arrives, so an oversized upload is cut " +
                "off rather than buffered.",
              "Report is too large",
            ),
            "429": errorResponse(
              "Past the rate limit for this caller. A rate-limit store that is down " +
                "fails open, so this is a real count rather than an outage.",
              "Too many reports",
            ),
            "500": errorResponse(
              "Something the handler did not expect — a `store` that threw, most " +
                "likely. Whatever broke, its message stays on the server.",
              "Could not store the report",
            ),
          }),
        },
        options: {
          operationId: "preflightBugReport",
          summary: "CORS preflight",
          description:
            "Answered with a 204 only when `cors` is set; without it the handler " +
            "has no preflight to give and OPTIONS is a method like any other, so " +
            "it is refused with the same `{ error }` a GET gets. The requested " +
            "headers are reflected back, so a client may send its own — a CSRF " +
            "token, a tracing id — without this document listing them.",
          security: [{}],
          responses: {
            "204": {
              description: "The preflight is allowed. No body.",
              headers: {
                ...corsResponseHeaders(),
                "Access-Control-Allow-Methods": {
                  description: "Always `POST, OPTIONS`.",
                  schema: { type: "string" },
                },
                "Access-Control-Allow-Headers": {
                  description:
                    "Whatever `Access-Control-Request-Headers` asked for, or " +
                    "`Content-Type, Authorization` when it asked for nothing.",
                  schema: { type: "string" },
                },
                "Access-Control-Max-Age": {
                  description: "Always `86400`.",
                  schema: { type: "string" },
                },
              },
            },
            "405": errorResponse(
              "`cors` is not set, so there is no preflight to answer and the " +
                "request falls through to the method check. No CORS headers come " +
                "back with it — there are none to send.",
              "Method not allowed",
            ),
          },
        },
      },
    },
    components: {
      schemas: {
        ...schemas,
        Created: {
          type: "object",
          title: "Created",
          description: "The report was stored under this id.",
          properties: { id: { type: "string", description: "Whatever `store` returned." } },
          required: ["id"],
        },
        Accepted: {
          type: "object",
          title: "Accepted",
          description: "Deliberately empty: there was no `store`, so there is no id.",
          properties: {},
        },
        Duplicate: {
          type: "object",
          title: "Duplicate",
          description: "A repeat of a report already seen inside the dedupe window.",
          properties: {
            id: { type: "string", description: "The first copy's id, when it had one." },
            duplicate: { const: true },
          },
          required: ["duplicate"],
        },
        ErrorBody: {
          type: "object",
          title: "Error",
          description:
            "Every refusal has this shape. The client shows `error` to the reporter, " +
            "so it is a sentence in English and never a machine code.",
          properties: { error: { type: "string" } },
          required: ["error"],
        },
      },
      securitySchemes: {
        [SIGNATURE_SCHEME]: {
          type: "apiKey",
          in: "header",
          name: DEFAULT_SIGNATURE_HEADER,
          description:
            "An HMAC-SHA-256 over `<timestamp>.<body>`, sent as `t=<ms>,v1=<hex>` and " +
            "verified over the raw text before anything parses it. Read this honestly: " +
            "the key ships inside the browser bundle, so it is public, and this is " +
            "spam deterrence beside a rate limit — it is not authentication and it " +
            "identifies nobody. What it buys is that a script pointed at the endpoint " +
            "has to read your bundle and implement HMAC before it can post, and that a " +
            "captured body cannot be replayed once the timestamp is stale. `authorize` " +
            "is the hook for real authentication, and what it checks is yours to " +
            "decide, so it is not described here.",
        },
      },
    },
  };
}

/**
 * Serialises with recursively sorted keys, so two builds of the same inputs
 * produce byte-identical files and `dist/` only changes when the document does.
 */
export function serialiseOpenApi(doc: Json): string {
  return `${JSON.stringify(sortKeys(doc), null, 2)}\n`;
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
  const outfile = join(root, "dist", "openapi.json");
  mkdirSync(dirname(outfile), { recursive: true });
  const json = serialiseOpenApi(buildOpenApiDocument());
  writeFileSync(outfile, json, "utf8");
  console.log(`dist/openapi.json: ${Buffer.byteLength(json)} bytes`);
}
