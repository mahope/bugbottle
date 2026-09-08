import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sentrySink,
  buildSentryEvent,
  buildSentryEnvelope,
  parseSentryDsn,
  sentryAuthHeader,
  clipBytes,
  SentrySinkError,
  SENTRY_CLIENT,
  SENTRY_CLIENT_NAME,
  SENTRY_CLIENT_VERSION,
  SENTRY_VERSION,
  MAX_SENTRY_BREADCRUMBS,
  MAX_SENTRY_MESSAGE_BYTES,
  MAX_SENTRY_FEEDBACK_MESSAGE,
  DEFAULT_SENTRY_RETRY_AFTER,
} from "../src/sinks/sentry.ts";
import { SinkError } from "../src/sinks/error.ts";
import type { ReportSink } from "../src/server/handle.ts";
import { fullReportBody, PNG_BYTES, PNG_DATA_URL, reportBody } from "./report-fixtures.ts";

const DSN = "https://abc123@o42.ingest.sentry.io/7";

/** A fetch stand-in that records the request and answers with the given body. */
function fakeFetch(status = 200, body: unknown = { id: "e1" }, headers: HeadersInit = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** Fixed clock and id, so a whole envelope can be asserted rather than a shape. */
const fixed = {
  eventId: () => "9ec79c33ec9942ab8353589fcb2e04dc",
  now: () => new Date("2026-09-08T12:00:00.000Z"),
};

type ParsedItem = { header: Record<string, unknown>; payload: Uint8Array };

/**
 * Reads an envelope back apart the way a receiver does: a header line, then
 * item headers each followed by exactly `length` bytes and a newline.
 *
 * Deliberately strict. The point of these tests is that the byte lengths in
 * the item headers are right, so a lenient parser that scanned for newlines
 * would test nothing.
 */
function parseEnvelope(body: Uint8Array): {
  header: Record<string, unknown>;
  items: ParsedItem[];
} {
  const decoder = new TextDecoder();
  let at = 0;
  const readLine = (): string => {
    const end = body.indexOf(0x0a, at);
    assert.notEqual(end, -1, "every header line ends in a newline");
    const line = decoder.decode(body.subarray(at, end));
    at = end + 1;
    return line;
  };

  const header = JSON.parse(readLine()) as Record<string, unknown>;
  const items: ParsedItem[] = [];
  while (at < body.length) {
    const itemHeader = JSON.parse(readLine()) as Record<string, unknown>;
    const length = itemHeader.length;
    assert.equal(typeof length, "number", "every item header declares a length");
    const payload = body.subarray(at, at + (length as number));
    assert.equal(payload.length, length, "the declared length is really there");
    at += length as number;
    assert.equal(body[at], 0x0a, "a length-prefixed payload is terminated by a newline");
    at += 1;
    items.push({ header: itemHeader, payload });
  }
  return { header, items };
}

function eventOf(body: Uint8Array): Record<string, unknown> {
  const { items } = parseEnvelope(body);
  const item = items.find((i) => i.header.type === "event" || i.header.type === "feedback");
  assert.ok(item, "the envelope carries an event item");
  return JSON.parse(new TextDecoder().decode(item.payload)) as Record<string, unknown>;
}

// --- the DSN and the auth header -------------------------------------------

test("a DSN becomes the envelope endpoint and the public key", () => {
  const dsn = parseSentryDsn(DSN);
  assert.equal(dsn.publicKey, "abc123");
  assert.equal(dsn.projectId, "7");
  assert.equal(dsn.envelopeUrl, "https://o42.ingest.sentry.io/api/7/envelope/");
  assert.equal(dsn.dsn, "https://abc123@o42.ingest.sentry.io/7");
});

test("a self-hosted DSN keeps the path in front of the project id", () => {
  const dsn = parseSentryDsn("https://key@bugs.example.com:8443/sentry/inner/12");
  assert.equal(dsn.envelopeUrl, "https://bugs.example.com:8443/sentry/inner/api/12/envelope/");
  assert.equal(dsn.dsn, "https://key@bugs.example.com:8443/sentry/inner/12");
});

test("a legacy DSN is accepted and its secret half is dropped", () => {
  const dsn = parseSentryDsn("https://public:secret@sentry.io/42");
  assert.equal(dsn.publicKey, "public");
  assert.ok(!dsn.dsn.includes("secret"), "the secret never reaches the envelope header");
  assert.ok(!sentryAuthHeader(dsn.publicKey).includes("secret"));
});

test("a DSN without a key or a project id is refused where it was written", () => {
  assert.throws(() => parseSentryDsn("not a url"), TypeError);
  assert.throws(() => parseSentryDsn("https://sentry.io/42"), TypeError);
  assert.throws(() => parseSentryDsn("https://key@sentry.io/"), TypeError);
  assert.throws(() => sentrySink({ dsn: "https://sentry.io/42" }), TypeError);
});

test("the auth header has the documented format and no deprecated keys", () => {
  const header = sentryAuthHeader("abc123");
  assert.equal(
    header,
    `Sentry sentry_version=7, sentry_client=${SENTRY_CLIENT}, sentry_key=abc123`,
  );
  assert.equal(SENTRY_VERSION, 7);
  assert.ok(!header.includes("sentry_secret"));
  assert.ok(!header.includes("sentry_timestamp"));
});

test("the client version tracks package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  assert.equal(SENTRY_CLIENT_VERSION, pkg.version, "bump SENTRY_CLIENT_VERSION with the package");
  assert.equal(SENTRY_CLIENT, `${SENTRY_CLIENT_NAME}/${pkg.version}`);
});

// --- the envelope ----------------------------------------------------------

test("the envelope header parses and names the event, the time and the DSN", () => {
  const { body, eventId } = buildSentryEnvelope(reportBody, { dsn: DSN, ...fixed });
  const { header } = parseEnvelope(body);
  assert.equal(header.event_id, eventId);
  assert.match(String(header.event_id), /^[0-9a-f]{32}$/);
  assert.equal(header.sent_at, "2026-09-08T12:00:00.000Z");
  assert.equal(header.dsn, "https://abc123@o42.ingest.sentry.io/7");
  assert.deepEqual(header.sdk, { name: "bugbottle", version: SENTRY_CLIENT_VERSION });
});

test("sent_at is written exactly once, anywhere in the envelope", () => {
  const { body } = buildSentryEnvelope(fullReportBody, { dsn: DSN, ...fixed });
  const text = new TextDecoder("utf8", { fatal: false }).decode(body);
  assert.equal(text.split("sent_at").length - 1, 1);
});

test("the item headers carry exact byte lengths, ellipsis and all", () => {
  const report = { ...fullReportBody, message: "Kør — så gør den ingenting ✅" };
  const { body } = buildSentryEnvelope(report, { dsn: DSN, ...fixed });
  const { items } = parseEnvelope(body);
  // parseEnvelope already asserts every declared length against the bytes; this
  // checks the multi-byte characters really are in there rather than mangled.
  const event = JSON.parse(new TextDecoder().decode(items[0]!.payload)) as { message: string };
  assert.equal(event.message, "Kør — så gør den ingenting ✅");
  assert.equal(items[0]!.header.type, "event");
  assert.equal(items[0]!.header.content_type, "application/json");
});

test("the screenshot rides along as an attachment item and the bytes round-trip", () => {
  const { body } = buildSentryEnvelope(fullReportBody, { dsn: DSN, ...fixed });
  const { items } = parseEnvelope(body);
  const attachment = items.find((i) => i.header.type === "attachment");
  assert.ok(attachment, "the envelope carries an attachment item");
  assert.equal(attachment.header.filename, "screenshot.png");
  assert.equal(attachment.header.content_type, "image/png");
  assert.equal(attachment.header.attachment_type, "event.attachment");
  assert.equal(attachment.header.length, PNG_BYTES.length);
  assert.deepEqual(Array.from(attachment.payload), Array.from(PNG_BYTES));
});

test("the decoded bytes handleReport kept are used in place of the data URL", () => {
  const bytes = new Uint8Array([...PNG_BYTES, 0x02, 0x03]);
  const { body } = buildSentryEnvelope(reportBody, { dsn: DSN, ...fixed }, { screenshot: bytes });
  const { items } = parseEnvelope(body);
  const attachment = items.find((i) => i.header.type === "attachment");
  assert.deepEqual(Array.from(attachment!.payload), Array.from(bytes));
});

test("attachScreenshot: false leaves the picture behind", () => {
  const { body } = buildSentryEnvelope(fullReportBody, {
    dsn: DSN,
    attachScreenshot: false,
    ...fixed,
  });
  assert.equal(parseEnvelope(body).items.length, 1);
});

test("a screenshot that will not decode is dropped rather than thrown", () => {
  const report = { ...reportBody, screenshotDataUrl: "data:image/png;base64,not base64 at all" };
  const { body } = buildSentryEnvelope(report, { dsn: DSN, ...fixed });
  assert.equal(parseEnvelope(body).items.length, 1, "the message still gets there");
});

test("itemType: feedback changes only the item type", () => {
  const { body } = buildSentryEnvelope(reportBody, { dsn: DSN, itemType: "feedback", ...fixed });
  const { items } = parseEnvelope(body);
  assert.equal(items[0]!.header.type, "feedback");
  const event = eventOf(body) as { contexts: { feedback: Record<string, unknown> } };
  assert.equal(event.contexts.feedback.message, reportBody.message);
});

// --- the event -------------------------------------------------------------

test("the event carries the three required attributes", () => {
  const event = eventOf(buildSentryEnvelope(reportBody, { dsn: DSN, ...fixed }).body);
  assert.match(String(event.event_id), /^[0-9a-f]{32}$/);
  assert.equal(typeof event.timestamp, "number");
  assert.equal(event.platform, "javascript");
});

test("the event id in the payload matches the one in the envelope header", () => {
  const { body } = buildSentryEnvelope(reportBody, { dsn: DSN });
  const { header } = parseEnvelope(body);
  assert.equal(eventOf(body).event_id, header.event_id);
});

test("the timestamp is receivedAt in seconds when the server wrote one down", () => {
  const event = buildSentryEvent(
    { ...reportBody, receivedAt: "2026-09-07T10:00:05.500Z" },
    { dsn: DSN },
  );
  assert.equal(event.timestamp, Date.parse("2026-09-07T10:00:05.500Z") / 1000);
});

test("a bug is an error and an idea is info", () => {
  assert.equal(buildSentryEvent({ ...reportBody, type: "bug" }, { dsn: DSN }).level, "error");
  assert.equal(buildSentryEvent({ ...reportBody, type: "idea" }, { dsn: DSN }).level, "info");
  assert.equal(buildSentryEvent({ ...reportBody, type: "other" }, { dsn: DSN }).level, "info");
  assert.equal(buildSentryEvent({ ...reportBody, type: "nonsense" }, { dsn: DSN }).level, "info");
});

test("the message is in logentry and beside it, and the tags name the page", () => {
  const event = buildSentryEvent(reportBody, { dsn: DSN });
  assert.equal(event.message, reportBody.message);
  assert.deepEqual(event.logentry, { formatted: reportBody.message });
  assert.deepEqual(event.tags, {
    type: "bug",
    url: "/orders/91",
    viewport: "1440x900",
  });
});

test("the feedback context is the modern shape", () => {
  const event = buildSentryEvent(reportBody, {
    dsn: DSN,
    contactEmail: () => "reporter@example.com",
    contactName: () => "Alex",
    associatedEventId: () => "32fd1995636d446385016e2747623e11",
  });
  const contexts = event.contexts as { feedback: Record<string, unknown> };
  assert.deepEqual(contexts.feedback, {
    message: reportBody.message,
    source: "bugbottle",
    url: "/orders/91",
    contact_email: "reporter@example.com",
    name: "Alex",
    associated_event_id: "32fd1995636d446385016e2747623e11",
  });
});

test("no contact is passed, no contact is invented", () => {
  const contexts = buildSentryEvent(reportBody, { dsn: DSN }).contexts as {
    feedback: Record<string, unknown>;
  };
  assert.ok(!("contact_email" in contexts.feedback));
  assert.ok(!("name" in contexts.feedback));
});

test("the browser and device contexts come from the context facts", () => {
  const contexts = buildSentryEvent(fullReportBody, { dsn: DSN }).contexts as Record<
    string,
    Record<string, unknown>
  >;
  assert.deepEqual(contexts.browser, { name: "Chrome 141" });
  assert.deepEqual(contexts.device, { screen_resolution: "2560x1440@2", online: true });
});

test("the optional facts and the pointed-at elements are extra", () => {
  const extra = buildSentryEvent(fullReportBody, { dsn: DSN }).extra as Record<string, unknown>;
  assert.equal(extra.language, "en-GB");
  assert.equal(extra.timezone, "Europe/Copenhagen");
  assert.equal(extra.color_scheme, "dark");
  assert.equal(extra.connection, "4g");
  assert.equal((extra.elements as unknown[]).length, 1);
});

test("a stored screenshot URL is noted in extra", () => {
  const extra = buildSentryEvent(reportBody, { dsn: DSN }, { screenshotUrl: "https://s3/x.png" })
    .extra as Record<string, unknown>;
  assert.equal(extra.screenshot_url, "https://s3/x.png");
});

test("release, environment, server name and extra tags are passed through", () => {
  const event = buildSentryEvent(reportBody, {
    dsn: DSN,
    release: "checkout@1.4.2",
    environment: "staging",
    serverName: "web-3",
    tags: { tenant: "acme" },
  });
  assert.equal(event.release, "checkout@1.4.2");
  assert.equal(event.environment, "staging");
  assert.equal(event.server_name, "web-3");
  assert.equal((event.tags as Record<string, string>).tenant, "acme");
});

// --- breadcrumbs -----------------------------------------------------------

type Crumb = { type: string; category: string; level?: string; message?: string; data?: Record<string, unknown> };

function crumbsOf(report: unknown): Crumb[] {
  const event = buildSentryEvent(report, { dsn: DSN });
  const breadcrumbs = event.breadcrumbs as { values: Crumb[] } | undefined;
  return breadcrumbs?.values ?? [];
}

test("a console entry becomes a console breadcrumb, warn spelt Sentry's way", () => {
  const crumbs = crumbsOf({
    ...reportBody,
    console: [
      { level: "warn", message: "slow", ts: "2026-09-07T10:00:00.000Z" },
      { level: "error", message: "save failed", ts: "2026-09-07T10:00:01.000Z" },
    ],
  });
  assert.equal(crumbs.length, 2);
  assert.deepEqual(crumbs[0], {
    timestamp: Date.parse("2026-09-07T10:00:00.000Z") / 1000,
    type: "default",
    category: "console",
    level: "warning",
    message: "slow",
  } as unknown as Crumb);
  assert.equal(crumbs[1]!.level, "error");
});

test("a click, a submit, a navigation and a visibility change each map", () => {
  const crumbs = crumbsOf({
    ...reportBody,
    console: [],
    breadcrumbs: [
      { ts: "2026-09-07T09:59:57.000Z", kind: "navigation", from: "/orders", to: "/orders/91" },
      { ts: "2026-09-07T09:59:58.000Z", kind: "click", target: "button#save", text: "Save" },
      { ts: "2026-09-07T09:59:59.000Z", kind: "submit", target: "form#checkout" },
      { ts: "2026-09-07T10:00:00.000Z", kind: "visibility", to: "hidden" },
    ],
  });
  assert.equal(crumbs[0]!.type, "navigation");
  assert.deepEqual(crumbs[0]!.data, { from: "/orders", to: "/orders/91" });
  assert.equal(crumbs[1]!.type, "user");
  assert.equal(crumbs[1]!.category, "ui.click");
  assert.equal(crumbs[1]!.message, "button#save Save");
  assert.equal(crumbs[2]!.category, "ui.submit");
  assert.equal(crumbs[2]!.message, "form#checkout");
  assert.equal(crumbs[3]!.message, "hidden");
});

test("a recorded request becomes an http breadcrumb with the documented data keys", () => {
  const crumbs = crumbsOf({
    ...reportBody,
    console: [],
    network: [
      { ts: "2026-09-07T10:00:00.000Z", method: "POST", url: "/api/orders/91", status: 500, ms: 812 },
      { ts: "2026-09-07T10:00:01.000Z", method: "GET", url: "/api/me", status: 0, ms: 30, error: true },
      { ts: "2026-09-07T10:00:02.000Z", method: "GET", url: "/api/ok", status: 200, ms: 12 },
    ],
  });
  assert.deepEqual(crumbs[0], {
    timestamp: Date.parse("2026-09-07T10:00:00.000Z") / 1000,
    type: "http",
    category: "xhr",
    level: "error",
    data: { url: "/api/orders/91", method: "POST", status_code: 500, duration: 812 },
  } as unknown as Crumb);
  // A request that never got a status carries no status_code rather than a 0.
  assert.ok(!("status_code" in crumbs[1]!.data!));
  assert.equal(crumbs[1]!.level, "error");
  assert.equal(crumbs[2]!.level, "info");
});

test("three recorders become one timeline, oldest first", () => {
  const crumbs = crumbsOf(fullReportBody);
  const times = crumbs.map((c) => (c as unknown as { timestamp: number }).timestamp);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(crumbs.length, 1 + 2 + 2, "console, breadcrumbs and network all arrive");
});

test("breadcrumbs are capped at a hundred, newest kept", () => {
  const console_ = Array.from({ length: 50 }, (_, i) => ({
    level: "error" as const,
    message: `c${i}`,
    ts: new Date(1_780_000_000_000 + i * 1000).toISOString(),
  }));
  const network = Array.from({ length: 30 }, (_, i) => ({
    ts: new Date(1_780_000_100_000 + i * 1000).toISOString(),
    method: "GET",
    url: `/n${i}`,
    status: 500,
    ms: 5,
  }));
  const breadcrumbs = Array.from({ length: 30 }, (_, i) => ({
    ts: new Date(1_780_000_200_000 + i * 1000).toISOString(),
    kind: "click" as const,
    target: `#b${i}`,
  }));
  const crumbs = crumbsOf({ ...reportBody, console: console_, network, breadcrumbs });
  assert.equal(crumbs.length, MAX_SENTRY_BREADCRUMBS);
  // 110 were built and the oldest ten went, so the last click survives.
  assert.equal(crumbs.at(-1)?.message, "#b29");
});

test("a report with no evidence carries no breadcrumbs key at all", () => {
  const event = buildSentryEvent({ type: "idea", message: "a thought" }, { dsn: DSN });
  assert.equal(event.breadcrumbs, undefined);
});

// --- truncation ------------------------------------------------------------

test("clipBytes counts bytes, not characters, and marks the cut", () => {
  assert.equal(clipBytes("hello", 100), "hello");
  // "ø" is two bytes, so ten of them are twenty.
  const clipped = clipBytes("ø".repeat(10), 8);
  assert.ok(new TextEncoder().encode(clipped).length <= 8);
  assert.ok(clipped.endsWith("…"));
});

test("a message longer than 8 kB is clipped and the feedback context at 4096", () => {
  const event = buildSentryEvent({ ...reportBody, message: "x".repeat(20_000) }, { dsn: DSN });
  const message = event.message as string;
  assert.ok(new TextEncoder().encode(message).length <= MAX_SENTRY_MESSAGE_BYTES);
  const feedback = (event.contexts as { feedback: { message: string } }).feedback;
  assert.ok(feedback.message.length <= MAX_SENTRY_FEEDBACK_MESSAGE);
});

test("an oversized envelope drops the attachment first and says so", () => {
  const { body, truncated } = buildSentryEnvelope(fullReportBody, {
    dsn: DSN,
    // Small enough that the picture cannot fit, large enough that the event can:
    // the event item alone weighs 1700 bytes for this fixture, and the picture
    // adds 135 on top of it.
    maxEnvelopeBytes: 1750,
    ...fixed,
  });
  assert.deepEqual(truncated, ["attachment"]);
  assert.equal(parseEnvelope(body).items.length, 1);
  const tags = eventOf(body).tags as Record<string, string>;
  assert.equal(tags.bugbottle_truncated, "attachment");
});

test("and the breadcrumbs second, both named in the tag", () => {
  const { body, truncated } = buildSentryEnvelope(fullReportBody, {
    dsn: DSN,
    // Under the 1700 the event item weighs with its timeline, over the 1060
    // it weighs without one.
    maxEnvelopeBytes: 1200,
    ...fixed,
  });
  assert.deepEqual(truncated, ["attachment", "breadcrumbs"]);
  const event = eventOf(body);
  assert.equal(event.breadcrumbs, undefined);
  assert.equal((event.tags as Record<string, string>).bugbottle_truncated, "attachment,breadcrumbs");
  assert.equal(event.message, fullReportBody.message, "the message is what survives");
});

test("an envelope that fits carries no truncation tag", () => {
  const { truncated, body } = buildSentryEnvelope(fullReportBody, { dsn: DSN, ...fixed });
  assert.deepEqual(truncated, []);
  assert.ok(!("bugbottle_truncated" in (eventOf(body).tags as Record<string, string>)));
});

// --- delivery --------------------------------------------------------------

test("the sink POSTs the envelope to the DSN's endpoint with the auth header", async () => {
  const { fetch, calls } = fakeFetch();
  await sentrySink({ dsn: DSN, fetch, ...fixed })(fullReportBody, {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://o42.ingest.sentry.io/api/7/envelope/");
  assert.equal(calls[0]!.init.method, "POST");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/x-sentry-envelope");
  assert.equal(headers["X-Sentry-Auth"], sentryAuthHeader("abc123"));
  const { items } = parseEnvelope(calls[0]!.init.body as Uint8Array);
  assert.equal(items.length, 2, "the event and the picture");
});

test("the abort signal handleReport hands over reaches fetch", async () => {
  const { fetch, calls } = fakeFetch();
  const controller = new AbortController();
  await sentrySink({ dsn: DSN, fetch })(reportBody, { signal: controller.signal });
  assert.equal(calls[0]!.init.signal, controller.signal);
});

test("a 4xx throws a SinkError carrying the status and the body", async () => {
  const { fetch } = fakeFetch(400, { detail: "invalid event envelope" });
  await assert.rejects(
    async () => await sentrySink({ dsn: DSN, fetch })(reportBody, {}),
    (err: unknown) => {
      assert.ok(err instanceof SinkError);
      assert.ok(err instanceof SentrySinkError);
      assert.equal(err.status, 400);
      assert.equal(err.message, "invalid event envelope");
      assert.deepEqual(err.body, { detail: "invalid event envelope" });
      return true;
    },
  );
});

test("a 413 says the envelope was too large for that server", async () => {
  const { fetch } = fakeFetch(413, "Payload Too Large");
  await assert.rejects(
    async () => await sentrySink({ dsn: DSN, fetch })(fullReportBody, {}),
    (err: SentrySinkError) => {
      assert.equal(err.status, 413);
      assert.equal(err.retryAfter, undefined);
      return true;
    },
  );
});

test("a 5xx throws with the fallback message when the body says nothing", async () => {
  const { fetch } = fakeFetch(503, "");
  await assert.rejects(
    async () => await sentrySink({ dsn: DSN, fetch })(reportBody, {}),
    (err: SentrySinkError) => {
      assert.equal(err.status, 503);
      assert.equal(err.message, "Sentry refused the envelope with status 503");
      return true;
    },
  );
});

test("a 429 carries Retry-After and the rate-limit header to the caller", async () => {
  const { fetch } = fakeFetch(429, { detail: "event rejected due to rate limit" }, {
    "Retry-After": "42",
    "X-Sentry-Rate-Limits": "42:error:organization:quota_exceeded",
  });
  await assert.rejects(
    async () => await sentrySink({ dsn: DSN, fetch })(reportBody, {}),
    (err: SentrySinkError) => {
      assert.equal(err.status, 429);
      assert.equal(err.retryAfter, 42);
      assert.equal(err.retryAfterHeader, "42");
      assert.equal(err.rateLimits, "42:error:organization:quota_exceeded");
      return true;
    },
  );
});

test("a 429 with no usable header falls back to the documented sixty seconds", async () => {
  const { fetch } = fakeFetch(429, "slow down");
  await assert.rejects(
    async () => await sentrySink({ dsn: DSN, fetch })(reportBody, {}),
    (err: SentrySinkError) => {
      assert.equal(err.retryAfter, DEFAULT_SENTRY_RETRY_AFTER);
      assert.equal(err.retryAfterHeader, undefined);
      return true;
    },
  );
});

test("an HTTP-date Retry-After is kept raw rather than parsed into nonsense", async () => {
  const { fetch } = fakeFetch(429, "", { "Retry-After": "Wed, 09 Sep 2026 12:00:00 GMT" });
  await assert.rejects(
    async () => await sentrySink({ dsn: DSN, fetch })(reportBody, {}),
    (err: SentrySinkError) => {
      assert.equal(err.retryAfterHeader, "Wed, 09 Sep 2026 12:00:00 GMT");
      assert.equal(err.retryAfter, DEFAULT_SENTRY_RETRY_AFTER);
      return true;
    },
  );
});

test("a network failure propagates as itself", async () => {
  const fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof globalThis.fetch;
  await assert.rejects(async () => await sentrySink({ dsn: DSN, fetch })(reportBody, {}), TypeError);
});

// --- the malformed case ----------------------------------------------------

test("a malformed report reaches the fetch rather than throwing before it", async () => {
  const { fetch, calls } = fakeFetch();
  const rubbish = {
    type: 7,
    message: { nope: true },
    context: "not an object",
    console: "not an array",
    breadcrumbs: [null, { kind: "invented" }],
    network: [{ url: 42 }],
    elements: 5,
    screenshotDataUrl: 12,
  };
  await sentrySink({ dsn: DSN, fetch, ...fixed })(rubbish, {});
  assert.equal(calls.length, 1, "somebody still sees that something is wrong");
  const event = eventOf(calls[0]!.init.body as Uint8Array);
  assert.equal(event.level, "info");
  assert.equal(event.message, "");
  assert.equal(event.platform, "javascript");
});

test("null, undefined and a string are reports too", async () => {
  const { fetch, calls } = fakeFetch();
  const sink = sentrySink({ dsn: DSN, fetch, ...fixed });
  await sink(null, {});
  await sink(undefined, {});
  await sink("just a sentence", {});
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(eventOf(call.init.body as Uint8Array).platform, "javascript");
  }
});

// --- the shape handleReport wants ------------------------------------------

test("the sink is a ReportSink and goes straight into handleReport's sinks", () => {
  const sink: ReportSink = sentrySink({ dsn: DSN, fetch: fakeFetch().fetch });
  assert.equal(typeof sink, "function");
});

test("a data URL on the report is enough on its own, without handleReport", () => {
  const { body } = buildSentryEnvelope(
    { ...reportBody, screenshotDataUrl: PNG_DATA_URL },
    { dsn: DSN, ...fixed },
  );
  const attachment = parseEnvelope(body).items.find((i) => i.header.type === "attachment");
  assert.deepEqual(Array.from(attachment!.payload), Array.from(PNG_BYTES));
});
