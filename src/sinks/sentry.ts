/**
 * Posting a report to Sentry — or to GlitchTip or Bugsink, which speak the
 * same protocol — as an envelope on the DSN's ingest endpoint.
 *
 * The point of this sink is that a team already running Sentry does not need a
 * second place to look. The report arrives as an event carrying a `feedback`
 * context, and the evidence bugbottle collected arrives with it: the console
 * buffer, the breadcrumbs and the recorded requests as Sentry breadcrumbs, the
 * pointed-at elements in `extra`, and the screenshot as an attachment item in
 * the same envelope — the one delivery in this library that carries the
 * picture itself rather than a link to storage you had to arrange first.
 *
 * Written against the Sentry developer documentation as it stood on
 * 2026-09-08, which is a restructured tree: the envelope grammar and the size
 * limits are `develop.sentry.dev/sdk/foundations/envelopes/`, the item types
 * `…/envelopes/envelope-items/`, the event payload and its breadcrumbs
 * `…/envelopes/event-payloads/`, the DSN and `X-Sentry-Auth`
 * `…/foundations/transport/authentication/`, rate limiting
 * `…/foundations/transport/rate-limiting/`, attachments `…/telemetry/
 * attachments/` (spec 1.6.0, 2026-02-24) and the feedback context
 * `…/telemetry/feedbacks/` (spec 1.3.0, 2026-02-04). Protocol version 7 is
 * the only one Sentry has ever shipped.
 *
 * Three places where this sink knowingly differs from that specification, each
 * for a reason:
 *
 * 1. It sends an `event` item by default rather than the `feedback` item the
 *    feedback spec describes. A `feedback` item is what puts the report in
 *    Sentry's own User Feedback list, but GlitchTip and Bugsink do not know
 *    the type and drop what they cannot parse. `itemType: "feedback"` opts
 *    into it on a real Sentry, where it is also a separate rate-limit
 *    category from errors.
 * 2. `contexts.feedback.source` is not in spec 1.3.0 — it survives only in
 *    Sentry's own architecture notes. Unknown context attributes must be
 *    retained and forwarded, so it costs nothing and says where the report
 *    came from on a server old enough to want it.
 * 3. The event carries both `logentry.formatted` and the legacy top-level
 *    `message`. The first is what the spec defines; the second is what the
 *    documentation's own envelope example sends and what the older
 *    self-hosted receivers read. The message is capped, so the duplicate is
 *    a few kilobytes at the very worst.
 *
 * Server-only, like every sink. A DSN is not a secret the way an API key is —
 * every Sentry browser SDK ships one — but the reports are, and the delivery
 * belongs where the report already is.
 *
 * No SDK dependency: one `fetch` and a formatter, the same as the others.
 */

import {
  decodeScreenshotDataUrl,
  isReportType,
  looksLikeEmail,
  normaliseBreadcrumbs,
  normaliseConsole,
  normaliseContact,
  normaliseContext,
  normaliseElements,
  normaliseMessage,
  normaliseNetwork,
  type Breadcrumb,
  type ConsoleEntry,
  type NetworkEntry,
  type ReportType,
} from "../report-core.ts";
import { messageFromBody, readBody, SinkError, type FetchLike } from "./error.ts";
import { clip, type ChatSink, type ChatSinkContext } from "./chat.ts";

/** The library name Sentry shows on the event, in `sdk` and in the auth header. */
export const SENTRY_CLIENT_NAME = "bugbottle";

/**
 * The version that travels with it.
 *
 * Written down here because a file compiled by `tsc` cannot read
 * `package.json` the way the esbuild bundle can. `tests/sentry-sink.test.ts`
 * compares this with `package.json` and fails when the two drift, so a release
 * that forgets this line does not ship.
 */
export const SENTRY_CLIENT_VERSION = "0.8.0";

/** `bugbottle/0.6.0`, the `sentry_client` format the documentation asks for. */
export const SENTRY_CLIENT = `${SENTRY_CLIENT_NAME}/${SENTRY_CLIENT_VERSION}`;

/** The only protocol version Sentry has shipped. */
export const SENTRY_VERSION = 7;

/** Sentry keeps the newest hundred breadcrumbs on an event and drops the rest. */
export const MAX_SENTRY_BREADCRUMBS = 100;

/**
 * Longest message the event carries, in UTF-8 bytes.
 *
 * Relay clips a `logentry` at 8192 and asks SDKs not to enforce the limit
 * themselves, but a message that arrives already clipped is a message whose
 * ellipsis a reader can see, and `normaliseMessage` has capped it at 4000
 * characters long before this anyway.
 */
export const MAX_SENTRY_MESSAGE_BYTES = 8 * 1024;

/** The feedback spec's own limit on `contexts.feedback.message`, in characters. */
export const MAX_SENTRY_FEEDBACK_MESSAGE = 4096;

/**
 * Relay's ceiling for one event item, and so the ceiling for everything except
 * the attachment: 1 MiB. A larger event item is rejected whatever the envelope
 * around it weighs.
 */
export const MAX_SENTRY_EVENT_BYTES = 1024 * 1024;

/**
 * Longest envelope the sink will send, in bytes.
 *
 * Relay's own ceiling is 200 MiB, and the attachment is the only item that
 * could ever approach it. A megabyte is the point past which the only thing
 * that grew is the picture, and a picture that costs the whole delivery is a
 * bad trade — Sentry's own guidance is that a screenshot should stay under
 * 2 MB. What is dropped is written on the event as `tags.bugbottle_truncated`,
 * so the reader knows the event is not the whole report.
 */
export const MAX_SENTRY_ENVELOPE_BYTES = 1024 * 1024;

/**
 * What a 429 without a `Retry-After` means. The transport spec is explicit:
 * "On 429 responses without the above headers, assume a 60s rate limit for all
 * categories."
 */
export const DEFAULT_SENTRY_RETRY_AFTER = 60;

/** Sentry's level scale, of which a report can only ever be two. */
const LEVEL_BY_TYPE: Record<ReportType, "error" | "info"> = {
  bug: "error",
  idea: "info",
  other: "info",
};

/** What a DSN says, once it has been taken apart. */
export type SentryDsn = {
  /** The public key, which goes in `X-Sentry-Auth` as `sentry_key`. */
  publicKey: string;
  /** The numeric project id, or whatever the host uses in its place. */
  projectId: string;
  /** `https://o0.ingest.sentry.io/api/1/envelope/`, ready to POST to. */
  envelopeUrl: string;
  /** The DSN with any legacy secret half removed — the form the header takes. */
  dsn: string;
};

/**
 * Which envelope item the report becomes.
 *
 * `event` is the default and works on all three servers. `feedback` is what
 * puts it in Sentry's User Feedback list, and is understood by Sentry ≥ 24.x
 * and by nothing else.
 */
export type SentryItemType = "event" | "feedback";

export type SentrySinkOptions = {
  /**
   * The project's DSN, `https://<publicKey>@<host>/<projectId>`. A path in
   * front of the project id is kept, so a self-hosted GlitchTip or Bugsink
   * behind a prefix works. A legacy DSN with a secret half
   * (`https://key:secret@…`) is accepted and the secret dropped: `sentry_secret`
   * has been ignored on the receiving side for years.
   */
  dsn: string;
  /** Injected `fetch`, for tests or a runtime with its own client. */
  fetch?: FetchLike;
  /** `event` (default, portable) or `feedback` (Sentry's own feedback list). */
  itemType?: SentryItemType;
  /** `release` on the event — the build the report came from. */
  release?: string;
  /** `environment` on the event. Sentry defaults it to `production`. */
  environment?: string;
  /** `server_name` on the event. */
  serverName?: string;
  /** Extra tags, merged over the ones read from the report. */
  tags?: Record<string, string>;
  /**
   * The reporter's email address, when your application knows it. It is what
   * somebody replies to, so it is worth passing: read it off the report, which
   * is where a `contact_email` in `extra` would have arrived.
   *
   * Without this, the report's own `contact` field is used when it looks like
   * an address — which is what the panel's optional contact field writes.
   */
  contactEmail?: (report: unknown) => string | undefined;
  /** The reporter's name, on the same terms. */
  contactName?: (report: unknown) => string | undefined;
  /**
   * An error event in the same project that this feedback is about, so Sentry
   * links the two. Not the envelope's own `event_id`.
   */
  associatedEventId?: (report: unknown) => string | undefined;
  /** Send the screenshot as an attachment item. Default true. */
  attachScreenshot?: boolean;
  /** Overrides {@link MAX_SENTRY_ENVELOPE_BYTES} for one sink. */
  maxEnvelopeBytes?: number;
  /**
   * Supplies the event id: 32 lower-case hex digits. Defaults to
   * `crypto.randomUUID()` with the dashes taken out. Injectable so a test can
   * assert a whole envelope rather than a shape.
   */
  eventId?: () => string;
  /** Supplies "now". Injectable for the same reason. */
  now?: () => Date;
};

/**
 * What this sink is handed beside the report.
 *
 * The same context every sink gets, plus the decoded PNG `handleReport` keeps
 * when `screenshot: "keep"` — the one sink that can do something with the
 * bytes rather than only with an address for them.
 */
export type SentrySinkContext = ChatSinkContext & {
  /** The decoded PNG, when the handler kept it. */
  screenshot?: Uint8Array;
};

/** What was left out of the envelope to keep it under a ceiling. */
export type SentryTruncation = "attachment" | "breadcrumbs";

export type SentryEnvelope = {
  /** The bytes to POST, item headers and all. */
  body: Uint8Array<ArrayBuffer>;
  /** The event id, so a caller can write it beside the stored report. */
  eventId: string;
  /** What had to be dropped, in the order it was dropped. */
  truncated: SentryTruncation[];
};

const encoder = new TextEncoder();

function encode(text: string): Uint8Array {
  return encoder.encode(text);
}

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

function concat(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Clips a string to `maxBytes` UTF-8 bytes without splitting a character.
 *
 * The protocol counts payloads in bytes and so does every item header, so a
 * limit measured in characters would be wrong by up to three times for
 * anything not written in English — which is most of what a reporter types.
 */
export function clipBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  // Walk back from the byte budget until the ellipsis fits too, so the reader
  // can see the message was cut rather than guess at it.
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && byteLength(`${text.slice(0, end)}…`) > maxBytes) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

/**
 * Takes a DSN apart into the ingest URL and the key.
 *
 * `{PROTOCOL}://{PUBLIC_KEY}@{HOST}{PATH}/{PROJECT_ID}` becomes
 * `{PROTOCOL}://{HOST}{PATH}/api/{PROJECT_ID}/envelope/`, which is the rule
 * the authentication page states for every endpoint.
 *
 * Throws `TypeError` on anything that is not a DSN. `sentrySink` calls this
 * when it is built rather than when it first delivers, so a typo fails where
 * it was written down and not at three in the morning.
 */
export function parseSentryDsn(dsn: string): SentryDsn {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new TypeError("The Sentry DSN is not a URL");
  }
  const publicKey = url.username;
  if (!publicKey) throw new TypeError("The Sentry DSN has no public key");

  // The project id is the last path segment; anything in front of it is a
  // prefix a self-hosted install sits behind.
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const projectId = segments.pop();
  if (!projectId) throw new TypeError("The Sentry DSN has no project id");
  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";

  return {
    publicKey,
    projectId,
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
    // The envelope header's copy of the DSN carries no credential beyond the
    // public key, so a legacy secret is dropped here rather than sent on.
    dsn: `${url.protocol}//${publicKey}@${url.host}${prefix}/${projectId}`,
  };
}

/** The `X-Sentry-Auth` header, in the order the documentation writes it. */
export function sentryAuthHeader(publicKey: string, client: string = SENTRY_CLIENT): string {
  // `sentry_timestamp` and `sentry_secret` are both deprecated and ignored on
  // the receiving side; the envelope header's `sent_at` replaced the first.
  return `Sentry sentry_version=${SENTRY_VERSION}, sentry_client=${client}, sentry_key=${publicKey}`;
}

/** Sentry timestamps are seconds since the epoch, fractional part and all. */
function seconds(iso: string | undefined, fallback: number): number {
  if (!iso) return fallback;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? fallback : ms / 1000;
}

type SentryBreadcrumb = {
  timestamp: number;
  type: string;
  category: string;
  level?: string;
  message?: string;
  data?: Record<string, unknown>;
};

function consoleCrumb(entry: ConsoleEntry, fallbackTs: number): SentryBreadcrumb {
  return {
    timestamp: seconds(entry.ts, fallbackTs),
    type: "default",
    category: "console",
    // Sentry's scale has no "warn"; the word is "warning".
    level: entry.level === "warn" ? "warning" : "error",
    message: entry.message,
  };
}

function activityCrumb(crumb: Breadcrumb, fallbackTs: number): SentryBreadcrumb {
  const timestamp = seconds(crumb.ts, fallbackTs);
  if (crumb.kind === "navigation") {
    // `from` and `to` are the two sub-properties the navigation type defines.
    const data: Record<string, unknown> = {};
    if (crumb.from) data.from = crumb.from;
    if (crumb.to) data.to = crumb.to;
    return { timestamp, type: "navigation", category: "navigation", data };
  }
  if (crumb.kind === "click" || crumb.kind === "submit") {
    const out: SentryBreadcrumb = {
      timestamp,
      type: "user",
      category: crumb.kind === "click" ? "ui.click" : "ui.submit",
    };
    const message = crumb.text ? `${crumb.target ?? ""} ${crumb.text}`.trim() : crumb.target;
    if (message) out.message = message;
    return out;
  }
  const out: SentryBreadcrumb = { timestamp, type: "default", category: "ui.visibility" };
  if (crumb.to) out.message = crumb.to;
  return out;
}

function networkCrumb(entry: NetworkEntry, fallbackTs: number): SentryBreadcrumb {
  const data: Record<string, unknown> = {
    url: entry.url,
    method: entry.method,
    // A request that never got a status is recorded as 0 by `bugbottle/network`;
    // Sentry would rather have no key than a status code that does not exist.
    ...(entry.status > 0 ? { status_code: entry.status } : {}),
    duration: entry.ms,
  };
  return {
    timestamp: seconds(entry.ts, fallbackTs),
    type: "http",
    // `xhr` is the category the breadcrumb documentation's own http example
    // uses. The recorder patches `fetch` and `XMLHttpRequest` both and the
    // report does not say which one a request came through, so guessing
    // between two categories would be inventing a fact.
    category: "xhr",
    level: entry.error || entry.status >= 400 ? "error" : "info",
    data,
  };
}

/**
 * Builds the Sentry event for a report.
 *
 * Exported because it is useful on its own: if you already run a Sentry SDK on
 * the server and would rather it did the sending, `captureEvent` takes this
 * object as it is.
 *
 * Nothing here throws on a malformed report. Every field goes through the
 * `normalise*` validators in report-core first, so a half-built body still
 * becomes an event somebody can look at and see that something is wrong.
 */
export function buildSentryEvent(
  report: unknown,
  options: SentrySinkOptions,
  ctx: SentrySinkContext = {},
): Record<string, unknown> {
  const raw = (typeof report === "object" && report !== null ? report : {}) as Record<
    string,
    unknown
  >;
  const type = isReportType(raw.type) ? raw.type : "other";
  const message = clipBytes(normaliseMessage(raw.message) ?? "", MAX_SENTRY_MESSAGE_BYTES);
  const context = normaliseContext(raw.context);
  const elements = normaliseElements(raw.elements);

  const receivedAt = typeof raw.receivedAt === "string" ? raw.receivedAt : undefined;
  const nowSeconds = (options.now?.() ?? new Date()).getTime() / 1000;
  const timestamp = seconds(receivedAt, nowSeconds);

  const crumbs: SentryBreadcrumb[] = [
    ...normaliseConsole(raw.console).map((entry) => consoleCrumb(entry, timestamp)),
    ...normaliseBreadcrumbs(raw.breadcrumbs).map((crumb) => activityCrumb(crumb, timestamp)),
    ...normaliseNetwork(raw.network).map((entry) => networkCrumb(entry, timestamp)),
  ];
  // Sentry keeps breadcrumbs in the order they arrive and does not sort them,
  // so three recorders with three clocks have to be put in one timeline here.
  crumbs.sort((a, b) => a.timestamp - b.timestamp);

  const tags: Record<string, string> = { type };
  if (context.url) tags.url = context.url;
  if (context.viewport) tags.viewport = context.viewport;
  Object.assign(tags, options.tags ?? {});

  const feedback: Record<string, unknown> = {
    // The feedback context has its own, shorter limit on the message.
    message: clip(message, MAX_SENTRY_FEEDBACK_MESSAGE),
    source: "bugbottle",
  };
  if (context.url) feedback.url = context.url;
  // The report's own contact line is the default, but only when it is an
  // address: Sentry puts `contact_email` behind a mail link, and "call me on
  // 12345678" behind one is worse than nothing. The whole line still travels
  // in `extra.contact`, so a phone number is not lost, only not linked.
  const contact = normaliseContact(raw.contact);
  const contactEmail =
    options.contactEmail?.(report) ?? (looksLikeEmail(contact) ? contact : undefined);
  if (contactEmail) feedback.contact_email = contactEmail;
  const contactName = options.contactName?.(report);
  if (contactName) feedback.name = contactName;
  const associated = options.associatedEventId?.(report);
  if (associated) feedback.associated_event_id = associated;

  // No `type` discriminator on any of these: the contexts interface takes the
  // key name as the type when they match, and all three of these do.
  const contexts: Record<string, unknown> = { feedback };
  if (context.userAgent) contexts.browser = { name: context.userAgent };
  const device: Record<string, unknown> = {};
  if (context.screen) device.screen_resolution = context.screen;
  if (typeof context.online === "boolean") device.online = context.online;
  if (Object.keys(device).length > 0) contexts.device = device;

  const extra: Record<string, unknown> = {};
  if (contact) extra.contact = contact;
  if (elements.length > 0) extra.elements = elements;
  if (context.language) extra.language = context.language;
  if (context.timezone) extra.timezone = context.timezone;
  if (context.colorScheme) extra.color_scheme = context.colorScheme;
  if (context.connection) extra.connection = context.connection;
  if (ctx.screenshotUrl) extra.screenshot_url = ctx.screenshotUrl;

  const event: Record<string, unknown> = {
    timestamp,
    platform: "javascript",
    level: LEVEL_BY_TYPE[type],
    logger: SENTRY_CLIENT_NAME,
    // `logentry` is the interface the spec defines; the bare `message` beside
    // it is what the documentation's own example sends and what the older
    // self-hosted receivers read.
    logentry: { formatted: message },
    message,
    tags,
    contexts,
    sdk: { name: SENTRY_CLIENT_NAME, version: SENTRY_CLIENT_VERSION },
  };
  if (crumbs.length > 0) event.breadcrumbs = { values: crumbs.slice(-MAX_SENTRY_BREADCRUMBS) };
  if (Object.keys(extra).length > 0) event.extra = extra;
  if (options.release) event.release = options.release;
  if (options.environment) event.environment = options.environment;
  if (options.serverName) event.server_name = options.serverName;
  return event;
}

/** The PNG for this report, from whichever of the two places has it. */
function screenshotBytes(report: unknown, ctx: SentrySinkContext): Uint8Array | undefined {
  // `handleReport` hands over the decoded bytes when `screenshot: "keep"`, so
  // the common path does not decode the same base64 a second time.
  if (ctx.screenshot instanceof Uint8Array && ctx.screenshot.length > 0) return ctx.screenshot;
  const raw = (typeof report === "object" && report !== null ? report : {}) as Record<
    string,
    unknown
  >;
  if (typeof raw.screenshotDataUrl !== "string") return undefined;
  try {
    return decodeScreenshotDataUrl(raw.screenshotDataUrl);
  } catch {
    // A picture that will not decode is not worth the delivery. The message is
    // the valuable part, exactly as it is in the browser.
    return undefined;
  }
}

/**
 * One envelope item: a JSON header line, the payload, and the newline that
 * terminates it. `length` is always declared — the documentation asks for it
 * by default, and a payload with a newline in it is malformed without one.
 */
function item(header: Record<string, unknown>, payload: Uint8Array): Uint8Array[] {
  const line = JSON.stringify({ ...header, length: payload.length });
  return [encode(`${line}\n`), payload, encode("\n")];
}

/**
 * Assembles the envelope: a header line, the event, and the screenshot as an
 * attachment item when there is one and it fits.
 *
 * Exported for the tests, which read the bytes back apart rather than compare
 * them with a snapshot, and useful if you would rather POST the envelope
 * through a proxy of your own.
 */
export function buildSentryEnvelope(
  report: unknown,
  options: SentrySinkOptions,
  ctx: SentrySinkContext = {},
): SentryEnvelope {
  const dsn = parseSentryDsn(options.dsn);
  const eventId = (options.eventId ?? defaultEventId)();
  // RFC 3339 in UTC, written exactly once: a second `sent_at` anywhere in the
  // envelope makes Sentry reject the whole thing.
  const sentAt = (options.now?.() ?? new Date()).toISOString();
  const maxEnvelopeBytes = options.maxEnvelopeBytes ?? MAX_SENTRY_ENVELOPE_BYTES;
  const truncated: SentryTruncation[] = [];

  const event = buildSentryEvent(report, options, ctx);
  // The envelope header's id is authoritative when the two disagree, so the
  // payload is given the same one rather than a second.
  event.event_id = eventId;

  const picture = options.attachScreenshot === false ? undefined : screenshotBytes(report, ctx);

  const header = encode(
    `${JSON.stringify({
      event_id: eventId,
      sent_at: sentAt,
      dsn: dsn.dsn,
      sdk: { name: SENTRY_CLIENT_NAME, version: SENTRY_CLIENT_VERSION },
    })}\n`,
  );

  const eventItemBytes = (): Uint8Array => {
    const tags = event.tags as Record<string, string>;
    if (truncated.length > 0) tags.bugbottle_truncated = truncated.join(",");
    else delete tags.bugbottle_truncated;
    return encode(JSON.stringify(event));
  };

  const assemble = (): Uint8Array<ArrayBuffer> => {
    const chunks: Uint8Array[] = [header];
    chunks.push(
      ...item(
        { type: options.itemType ?? "event", content_type: "application/json" },
        eventItemBytes(),
      ),
    );
    if (picture && !truncated.includes("attachment")) {
      chunks.push(
        ...item(
          {
            // `filename` is required on an attachment, and Sentry recognises a
            // screenshot by the word in the name rather than by a type.
            type: "attachment",
            filename: "screenshot.png",
            content_type: "image/png",
            attachment_type: "event.attachment",
          },
          picture,
        ),
      );
    }
    return concat(chunks);
  };

  let body = assemble();
  // The picture is the only part that is ever megabytes, so it goes first.
  if (body.length > maxEnvelopeBytes && picture) {
    truncated.push("attachment");
    body = assemble();
  }
  // What is left that can still be large is the timeline, and the event item
  // has a ceiling of its own that the attachment does not count towards. The
  // message, the context and the pointed-at elements stay: they are capped by
  // their validators and they are what the report is for.
  if (
    (body.length > maxEnvelopeBytes || eventItemBytes().length > MAX_SENTRY_EVENT_BYTES) &&
    event.breadcrumbs !== undefined
  ) {
    truncated.push("breadcrumbs");
    delete event.breadcrumbs;
    body = assemble();
  }

  return { body, eventId, truncated };
}

/** 32 lower-case hex digits, which is what Sentry means by an event id. */
function defaultEventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * A `SinkError` that also carries what Sentry said about coming back.
 *
 * It is still a `SinkError`, so a handler that catches those catches this one
 * and nothing has to know the difference; the extra fields are for a caller
 * that would rather schedule a retry than drop the delivery. Sentry's own
 * advice is not to retry automatically, so this is deliberately information
 * and not behaviour.
 */
export class SentrySinkError extends SinkError {
  /**
   * Seconds to wait. From `Retry-After` when it carried a number, and
   * {@link DEFAULT_SENTRY_RETRY_AFTER} on a 429 that carried no usable header,
   * which is what the transport spec says to assume.
   */
  readonly retryAfter: number | undefined;
  /** The raw `Retry-After`, in case it was an HTTP date rather than seconds. */
  readonly retryAfterHeader: string | undefined;
  /** The raw `X-Sentry-Rate-Limits`, which says which category ran out. */
  readonly rateLimits: string | undefined;

  constructor(
    message: string,
    status: number,
    body: unknown,
    retryAfter: string | null,
    rateLimits: string | null,
  ) {
    super(message, status, body);
    this.name = "SentrySinkError";
    this.retryAfterHeader = retryAfter ?? undefined;
    const parsed = retryAfter === null || retryAfter.trim() === "" ? Number.NaN : Number(retryAfter);
    this.retryAfter = Number.isFinite(parsed)
      ? parsed
      : status === 429
        ? DEFAULT_SENTRY_RETRY_AFTER
        : undefined;
    this.rateLimits = rateLimits ?? undefined;
  }
}

/**
 * A sink that posts one envelope per report to a Sentry-compatible ingest
 * endpoint — Sentry, GlitchTip or Bugsink. Resolves on a 2xx, throws
 * `SentrySinkError` — a `SinkError` — carrying the status and the response
 * body on anything else, and lets network failures from `fetch` propagate as
 * they are.
 *
 * A 429 is the one worth handling: Sentry answers it when a project is over
 * quota, and the seconds from `Retry-After` and the raw `X-Sentry-Rate-Limits`
 * are put on the error so the caller can back off rather than guess. A 413
 * means the envelope was larger than that server accepts, whatever this sink's
 * own ceiling says.
 *
 * ```ts
 * handleReport(req, { sinks: [sentrySink({ dsn: process.env.SENTRY_DSN! })] });
 * ```
 */
export function sentrySink(options: SentrySinkOptions): ChatSink {
  // Parsed once, when the sink is built: a DSN with a typo in it should fail
  // where it was written down rather than on the first report.
  const dsn = parseSentryDsn(options.dsn);

  return async (report, ctx = {}) => {
    const { body } = buildSentryEnvelope(report, options, ctx);
    const doFetch = options.fetch ?? globalThis.fetch;
    const response = await doFetch(dsn.envelopeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": sentryAuthHeader(dsn.publicKey),
      },
      body,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    if (!response.ok) {
      const responseBody = await readBody(response);
      const fallback = `Sentry refused the envelope with status ${response.status}`;
      throw new SentrySinkError(
        messageFromBody(responseBody, fallback),
        response.status,
        responseBody,
        response.headers.get("Retry-After"),
        response.headers.get("X-Sentry-Rate-Limits"),
      );
    }
  };
}
