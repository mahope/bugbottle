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
import { SinkError, type FetchLike } from "./error.ts";
import { type ChatSink, type ChatSinkContext } from "./chat.ts";
/** The library name Sentry shows on the event, in `sdk` and in the auth header. */
export declare const SENTRY_CLIENT_NAME = "bugbottle";
/**
 * The version that travels with it.
 *
 * Written down here because a file compiled by `tsc` cannot read
 * `package.json` the way the esbuild bundle can. `tests/sentry-sink.test.ts`
 * compares this with `package.json` and fails when the two drift, so a release
 * that forgets this line does not ship.
 */
export declare const SENTRY_CLIENT_VERSION = "0.6.0";
/** `bugbottle/0.6.0`, the `sentry_client` format the documentation asks for. */
export declare const SENTRY_CLIENT = "bugbottle/0.6.0";
/** The only protocol version Sentry has shipped. */
export declare const SENTRY_VERSION = 7;
/** Sentry keeps the newest hundred breadcrumbs on an event and drops the rest. */
export declare const MAX_SENTRY_BREADCRUMBS = 100;
/**
 * Longest message the event carries, in UTF-8 bytes.
 *
 * Relay clips a `logentry` at 8192 and asks SDKs not to enforce the limit
 * themselves, but a message that arrives already clipped is a message whose
 * ellipsis a reader can see, and `normaliseMessage` has capped it at 4000
 * characters long before this anyway.
 */
export declare const MAX_SENTRY_MESSAGE_BYTES: number;
/** The feedback spec's own limit on `contexts.feedback.message`, in characters. */
export declare const MAX_SENTRY_FEEDBACK_MESSAGE = 4096;
/**
 * Relay's ceiling for one event item, and so the ceiling for everything except
 * the attachment: 1 MiB. A larger event item is rejected whatever the envelope
 * around it weighs.
 */
export declare const MAX_SENTRY_EVENT_BYTES: number;
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
export declare const MAX_SENTRY_ENVELOPE_BYTES: number;
/**
 * What a 429 without a `Retry-After` means. The transport spec is explicit:
 * "On 429 responses without the above headers, assume a 60s rate limit for all
 * categories."
 */
export declare const DEFAULT_SENTRY_RETRY_AFTER = 60;
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
/**
 * Clips a string to `maxBytes` UTF-8 bytes without splitting a character.
 *
 * The protocol counts payloads in bytes and so does every item header, so a
 * limit measured in characters would be wrong by up to three times for
 * anything not written in English — which is most of what a reporter types.
 */
export declare function clipBytes(text: string, maxBytes: number): string;
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
export declare function parseSentryDsn(dsn: string): SentryDsn;
/** The `X-Sentry-Auth` header, in the order the documentation writes it. */
export declare function sentryAuthHeader(publicKey: string, client?: string): string;
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
export declare function buildSentryEvent(report: unknown, options: SentrySinkOptions, ctx?: SentrySinkContext): Record<string, unknown>;
/**
 * Assembles the envelope: a header line, the event, and the screenshot as an
 * attachment item when there is one and it fits.
 *
 * Exported for the tests, which read the bytes back apart rather than compare
 * them with a snapshot, and useful if you would rather POST the envelope
 * through a proxy of your own.
 */
export declare function buildSentryEnvelope(report: unknown, options: SentrySinkOptions, ctx?: SentrySinkContext): SentryEnvelope;
/**
 * A `SinkError` that also carries what Sentry said about coming back.
 *
 * It is still a `SinkError`, so a handler that catches those catches this one
 * and nothing has to know the difference; the extra fields are for a caller
 * that would rather schedule a retry than drop the delivery. Sentry's own
 * advice is not to retry automatically, so this is deliberately information
 * and not behaviour.
 */
export declare class SentrySinkError extends SinkError {
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
    constructor(message: string, status: number, body: unknown, retryAfter: string | null, rateLimits: string | null);
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
export declare function sentrySink(options: SentrySinkOptions): ChatSink;
//# sourceMappingURL=sentry.d.ts.map