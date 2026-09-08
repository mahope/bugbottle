/**
 * One receiver for every runtime that speaks the web `Request`.
 *
 * The README's hand-written handler is still the honest way to see what
 * happens to a report, and it stays documented. This is the same sequence with
 * the boilerplate removed: authorise, bound the body, validate every field
 * through the `normalise*` helpers, optionally scrub, decide what happens to
 * the screenshot, store, then fan out to the sinks. A Next.js route handler, a
 * Hono route, a Worker, Bun or Deno is three lines; Express gets the small
 * adapter next door.
 *
 * Nothing here reads your environment and nothing here is a hosted service.
 * Keys, tokens and URLs are arguments, exactly as they are for the sinks.
 *
 * The failure rules are the ones the rest of the library already follows: a
 * rejected screenshot never fails a report, a sink that is down never fails a
 * report that was already stored, and an unexpected error answers 500 without
 * telling the reporter what broke.
 */
import { type Breadcrumb, type ConsoleEntry, type ElementRef, type NetworkEntry, type PerfSnapshot, type ReplayCapture, type ReportContext, type StorageSnapshot, type ReportType } from "../report-core.ts";
import { type MarkdownOptions } from "../markdown.ts";
import { type ScrubOptions } from "../scrub.ts";
import { type SendReportEmailOptions } from "../sinks/resend.ts";
import { type SendReportWebhookOptions } from "../sinks/webhook.ts";
import { type CreateGithubIssueOptions } from "../sinks/github.ts";
import { type CreateLinearIssueOptions } from "../sinks/linear.ts";
/** Default ceiling for a request body: the screenshot dominates it. */
export declare const DEFAULT_MAX_BODY_BYTES: number;
/** Longest string kept for one `extra` value. */
export declare const MAX_EXTRA_STRING_LENGTH = 500;
/** How many unknown top-level keys are kept. */
export declare const MAX_EXTRA_KEYS = 20;
/** How long the whole body may take to arrive. Default 15 s. Over it answers 408. */
export declare const DEFAULT_BODY_TIMEOUT_MS = 15000;
/** How long one sink may take before it is abandoned. Default 10 s. */
export declare const DEFAULT_SINK_TIMEOUT_MS = 10000;
/** The locale-neutral answer to a report with nothing written in it. */
export declare const EMPTY_MESSAGE_ERROR = "Write a message first";
/** The answer to a body over the ceiling. Shared with the Express adapter. */
export declare const TOO_LARGE_ERROR = "Report is too large";
/**
 * A report after every field has been through its validator: the shape you can
 * write to a row without checking anything again.
 *
 * `extra` is whatever the client sent beside the known fields — a tenant id, a
 * build number, the signed-in user. It is capped rather than trusted: strings
 * are clipped, numbers and booleans pass, and anything nested is dropped,
 * because a nested object is an unbounded amount of attacker-controlled JSON.
 */
export type ValidatedReport = {
    type: ReportType;
    message: string;
    /**
     * How to reach the reporter, when the form asked and they answered. Absent
     * when they did not, so a row never carries an empty contact line — and
     * personal data when it is there: see the privacy section of the README.
     */
    contact?: string;
    context: ReportContext;
    console: ConsoleEntry[];
    elements: ElementRef[];
    breadcrumbs: Breadcrumb[];
    network: NetworkEntry[];
    /** What the page cost, or null when the client was not measuring. */
    perf: PerfSnapshot | null;
    /** What was in the browser's stores, or null when the client was not looking. */
    storage: StorageSnapshot | null;
    /**
     * The session replay, or null when the client was not recording one, sent
     * one that did not survive validation, or the handler was told to drop it.
     */
    replay: ReplayCapture | null;
    /**
     * What the library said about this report on the way out — the offline queue
     * dropping a screenshot it could not store, so far. Empty when it had
     * nothing to say, and clipped like every other field: the browser sent it.
     */
    notes: string[];
    extra: Record<string, unknown>;
    /** ISO 8601 timestamp of when the server accepted it. */
    receivedAt: string;
};
/** What a sink is handed beside the report. */
export type SinkContext = {
    /** The report rendered by `toMarkdown`, screenshot link included. */
    markdown: string;
    /** Where the screenshot was stored, when a `screenshot` function stored it. */
    screenshotUrl?: string;
    /** The decoded PNG, when it was kept. */
    screenshot?: Uint8Array;
    /**
     * Aborts when the sink runs out of its `sinkTimeoutMs`. Hand it to `fetch` so
     * the request is dropped as well; the handler stops waiting either way.
     */
    signal?: AbortSignal;
};
/** A delivery. Run after `store`, in order, and never allowed to fail the reply. */
export type ReportSink = (report: ValidatedReport, ctx: SinkContext) => Promise<unknown>;
/** What `respond` is handed, and what a caller gets back from the pieces below. */
export type HandleReportResult = {
    report: ValidatedReport;
    /** The id `store` returned, when it returned one. */
    id?: string;
    /** The decoded PNG, when `screenshot` was `"keep"`. */
    screenshot?: Uint8Array;
    /** The URL a `screenshot` function returned. */
    screenshotUrl?: string;
    markdown: string;
    /** One entry per sink that threw, in the order the sinks were listed. */
    sinkErrors: unknown[];
};
/** How much traffic one key may send. In memory by default, so per instance. */
export type RateLimitOptions = {
    limit: number;
    windowMs: number;
    /**
     * What counts as one caller. Default: the forwarded client address, which is
     * a header and therefore a claim — see the README. Clipped to 64 characters,
     * because the key is a map entry an attacker would otherwise size.
     */
    key?: (request: Request) => string;
    /**
     * Where the counting happens. The default is the in-memory buckets described
     * above: per instance, capped at 10 000 keys. Two instances behind a load
     * balancer each hand out the whole allowance, and a serverless isolate that
     * has just started hands out a fresh one, so a deployment that wants one
     * limit across all of them hands in its own store — Redis, Memcached, a
     * table with a TTL.
     */
    store?: RateLimitStore;
    /**
     * @deprecated Renamed to `store` in 0.9 — inside `rateLimit` the prefix said
     * nothing the key did not. Removed in 1.0 (#66). Given both, `store` is the
     * one that counts.
     */
    rateLimitStore?: RateLimitStore;
};
/**
 * The seam between `handleReport` and wherever the counting happens. One
 * method, because a limit needs exactly one thing: increment and tell me the
 * total. It may be synchronous — the in-memory default is — so a store that
 * needs no network costs no promise.
 *
 * ```ts
 * const store = {
 *   hit: async (key, windowMs) => {
 *     const count = await redis.incr(`bb:rl:${key}`);
 *     if (count === 1) await redis.pexpire(`bb:rl:${key}`, windowMs);
 *     return count;
 *   },
 * };
 * ```
 *
 * A store that throws fails the request *open*: the report is accepted and the
 * error reaches `onError`. An honest report is not refused because a shared
 * store blinked. An answer that is not a finite number is the same case, and
 * for the same reason the dedupe store's answer is shape-checked: `"3" > 30`
 * is false and so is `NaN > 30`, so a store answering with a string, a `null`
 * or nothing at all would switch the limit off and never say so. It is
 * reported once through `onError` and the request goes through.
 */
export type RateLimitStore = {
    /**
     * Counts this request against `key` and answers how many have arrived inside
     * the window, this one included. More than `limit` is answered with 429.
     */
    hit(key: string, windowMs: number): number | Promise<number>;
};
/** Longest key kept for a bucket: a header is not allowed to size the map. */
export declare const MAX_RATE_LIMIT_KEY_LENGTH = 64;
/** Hard ceiling on the bucket map, whatever the traffic looks like. */
export declare const MAX_RATE_LIMIT_BUCKETS = 10000;
/**
 * Answering the same report twice as if it were new. In memory by default, so
 * per instance — the same caveat as the rate limit, and for the same reason.
 */
export type DedupeOptions = {
    /** How long a repeat of the same report is answered as a duplicate. */
    windowMs: number;
    /**
     * What counts as the same report. Default: `fingerprint` from `bugbottle`,
     * the type, the message and the first console error, hashed — the same
     * function the browser uses, so a client that deduplicates and a server that
     * deduplicates agree.
     */
    key?: (report: ValidatedReport) => string;
    /**
     * Where the fingerprints are remembered. The default is the in-memory map
     * described above: per instance, capped at 10 000 entries. Two instances
     * behind a load balancer store the same crash twice, so a deployment that
     * wants one answer across all of them hands in its own store.
     */
    store?: DedupeStore;
    /**
     * @deprecated Renamed to `store` in 0.9 — inside `dedupe` the prefix said
     * nothing the key did not. Removed in 1.0 (#66). Given both, `store` is the
     * one that is asked.
     */
    dedupeStore?: DedupeStore;
};
/** What a dedupe store keeps: the id the first copy was stored under, if any. */
export type DedupeEntry = {
    id?: string;
};
/**
 * The seam between `handleReport` and wherever the fingerprints are
 * remembered. Shaped like `ReplayStore`, and like it either half may be
 * synchronous.
 *
 * ```ts
 * const store = {
 *   get: async (key) => {
 *     const value = await redis.get(`bb:dup:${key}`);
 *     return value === null ? undefined : (JSON.parse(value) as { id?: string });
 *   },
 *   set: (key, entry, expiresAt) =>
 *     redis.set(`bb:dup:${key}`, JSON.stringify(entry), "PXAT", expiresAt),
 * };
 * ```
 *
 * Expiry is the store's job — that is what `expiresAt` is for — so any entry
 * `get` answers with counts as a duplicate. Only an entry, though: an answer
 * that is not an object with an optional string `id` is treated as "not seen"
 * and reported through `onError`, because a store handing back a raw string
 * would otherwise make every report a duplicate. A store that throws fails
 * open on both halves: a duplicate report costs a row, and refusing one costs
 * the report.
 */
export type DedupeStore = {
    /** What was answered for this key before, or nothing when it is new. */
    get(key: string): DedupeEntry | undefined | Promise<DedupeEntry | undefined>;
    /** Remembers the answer until `expiresAt`, an epoch millisecond. */
    set(key: string, entry: DedupeEntry, expiresAt: number): void | Promise<void>;
};
/** Hard ceiling on the fingerprint map. */
export declare const MAX_DEDUPE_ENTRIES = 10000;
/**
 * Checking the HMAC the browser put on the body, from `bugbottle/sign`.
 *
 * Read the README before turning this on: the key ships to the browser, so it
 * is public, and this is spam deterrence beside a rate limit rather than
 * authentication. What it buys is that a script pointed at the endpoint has to
 * read your bundle and implement HMAC-SHA-256 before it can post anything, and
 * that a body captured once cannot be replayed.
 */
export type SignatureOptions = {
    /**
     * The shared key, or several of them for a rotation: a signature that
     * matches any key in the list is accepted, so a new key can be deployed to
     * the server before the browsers have it.
     */
    key: string | string[];
    /** Where the signature is expected. Default `X-Bugbottle-Signature`. */
    header?: string;
    /**
     * How far the signed timestamp may be from ours, in either direction.
     * Default five minutes — long enough for a clock nobody has synchronised,
     * short enough that the replay cache stays small.
     */
    maxSkewMs?: number;
    /**
     * Whether a request without a signature is refused. Default true whenever
     * `signature` is set: an optional signature that a caller can skip by
     * dropping a header deters nothing. Set it to false while the signed clients
     * are rolling out; a signature that *is* present is still verified either
     * way, because a wrong one is a claim rather than an omission.
     */
    require?: boolean;
    /**
     * Where accepted signatures are remembered, so a captured body cannot be
     * posted twice. The default is the in-memory store described above: per
     * instance, bounded per signed second. Two instances behind a load balancer
     * do not share it, and neither does a serverless isolate that has just been
     * started, so a deployment that wants one answer across all of them hands in
     * its own — Redis, Memcached, a table with a TTL. `expiresAt` is the epoch
     * millisecond after which the signature would be refused for being outside
     * the skew window anyway, which is exactly how long the entry has to live.
     */
    store?: ReplayStore;
    /**
     * @deprecated Renamed to `store` in 0.9 — inside `signature` the prefix said
     * nothing the key did not. Removed in 1.0 (#66). Given both, `store` is the
     * one that is asked.
     */
    replayStore?: ReplayStore;
};
/**
 * The seam between `handleReport` and wherever accepted signatures are
 * remembered. Both halves may be synchronous — the in-memory default is — so a
 * store that needs no network costs no promise.
 *
 * ```ts
 * const store = {
 *   has: (digest) => redis.exists(`bb:sig:${digest}`).then(Boolean),
 *   add: (digest, expiresAt) =>
 *     redis.set(`bb:sig:${digest}`, "1", "PXAT", expiresAt),
 * };
 * ```
 *
 * A store that throws fails the request closed: `handleReport` answers 500
 * rather than accepting a signature it could not check.
 */
export type ReplayStore = {
    /** True when this digest has already been accepted. */
    has(digest: string): boolean | Promise<boolean>;
    /** Remembers a digest until `expiresAt`, an epoch millisecond. */
    add(digest: string, expiresAt: number): void | Promise<void>;
};
/** The default skew window: five minutes on either side of our clock. */
export declare const DEFAULT_SIGNATURE_SKEW_MS: number;
/**
 * Digests remembered for one *signed* second.
 *
 * The bound is per second rather than over the whole cache because the signing
 * key ships to the browser and is therefore public: anybody can mint valid,
 * distinct signatures as fast as they can compute HMACs. Against one global
 * ceiling that is a way to push an honest digest out of the cache and replay
 * the body it stood for. Against a per-second ceiling the flood only evicts
 * digests dated the same second it floods, so a report signed at any other
 * second is still remembered for as long as it could be replayed.
 */
export declare const MAX_SIGNATURE_ENTRIES_PER_SECOND = 128;
/**
 * How many signed seconds are remembered at once. The default window spans 601
 * of them — five minutes on either side of our clock — so honest traffic never
 * reaches this. A `maxSkewMs` wider than this many seconds cannot be held in
 * memory in full; give such a deployment a `signature.store` instead.
 */
export declare const MAX_SIGNATURE_SECONDS = 640;
/** Hard ceiling on the replay cache: the two bounds above, multiplied. */
export declare const MAX_SIGNATURE_ENTRIES: number;
/** The one answer to every bad signature. Missing, wrong, late and replayed all read the same. */
export declare const BAD_SIGNATURE_ERROR = "Bad signature";
export type HandleReportOptions = {
    /** False answers 401 before the body is read. */
    authorize?: (request: Request) => boolean | Promise<boolean>;
    /**
     * Verify the HMAC the client put on the body. Anything wrong with it —
     * missing when required, invalid, outside the skew window, already seen —
     * answers 401 `{ error: "Bad signature" }`.
     */
    signature?: SignatureOptions;
    /** Ceiling for the request body. Default 4 MB. Over it answers 413. */
    maxBodyBytes?: number;
    /** How long the whole body may take to arrive. Default 15 s. Over it answers 408. */
    bodyTimeoutMs?: number;
    /** How long one sink may take before it is abandoned and counted as failed. Default 10 s. */
    sinkTimeoutMs?: number;
    /** Run `scrubReport` on the server as well, whatever the client did. */
    scrub?: boolean | ScrubOptions;
    /**
     * What happens to the picture. `"keep"` (the default) puts the decoded bytes
     * in the result and the sink context; `"drop"` throws it away without
     * decoding it; a function stores it and returns a URL, which reaches
     * `toMarkdown` and the sinks as `screenshotUrl`.
     */
    screenshot?: "drop" | "keep" | ((bytes: Uint8Array, report: ValidatedReport) => Promise<string | undefined>);
    /**
     * What happens to the session replay. `"keep"` (the default) validates it
     * and hands it to `store` on the report; `"drop"` throws it away, which is
     * the setting for a deployment that has rrweb wired up on the client but has
     * not decided where a recording of somebody's screen may be written.
     *
     * There is no function form on purpose: a replay is JSON and belongs in the
     * row the rest of the report goes into, not in a bucket of its own.
     */
    replay?: "drop" | "keep";
    /** Where the report is written. Its `id` is what the client is told. */
    store?: (report: ValidatedReport, screenshot?: Uint8Array) => Promise<{
        id?: string;
    } | void> | {
        id?: string;
    } | void;
    /** Deliveries, run in order after `store`. A failure is collected, not thrown. */
    sinks?: ReportSink[];
    /** Called once per failed sink, with its position in `sinks`. */
    onSinkError?: (error: unknown, index: number) => void;
    /** Called for anything unexpected, before the 500 goes out. */
    onError?: (error: unknown) => void;
    /** Replaces the default reply — 201 `{ id }`, or 202 `{}` without one. */
    respond?: (result: HandleReportResult) => Response;
    /** `true` for `*`, or the one origin you allow. Also answers `OPTIONS`. */
    cors?: string | boolean;
    /**
     * In memory and per instance by default: fine per serverless isolate, not
     * shared. `rateLimit.store` is the seam for a shared count.
     */
    rateLimit?: RateLimitOptions;
    /**
     * Answer a repeat of the same report with 200 `{ id, duplicate: true }`
     * instead of storing and delivering it again. In memory and per instance by
     * default; `dedupe.store` is the seam for one answer across a fleet.
     */
    dedupe?: DedupeOptions;
    /** Passed through to `toMarkdown` — extra facts, a heading level. */
    markdown?: MarkdownOptions;
};
/** Exported for tests, which would otherwise leak counts into each other. */
export declare function resetRateLimits(): void;
/** Exported for tests, which would otherwise leak fingerprints into each other. */
export declare function resetDedupe(): void;
/** Exported for tests, which would otherwise leak signatures into each other. */
export declare function resetSignatures(): void;
/**
 * The unknown top-level keys, capped. Strings are clipped, numbers and
 * booleans pass as they are, and anything else — an object, an array, a
 * function that arrived as JSON cannot — is left out.
 */
export declare function collectExtra(payload: Record<string, unknown>): Record<string, unknown>;
/**
 * Validates a parsed body into a `ValidatedReport`, or returns null when there
 * is no message — the one field without which there is nothing to store.
 */
export declare function validateReport(payload: unknown): ValidatedReport | null;
/** A sink that never answered. Counted exactly like a sink that threw. */
export declare class SinkTimeoutError extends Error {
    constructor(ms: number);
}
/**
 * Turns an incoming request into a stored, delivered report and a `Response`.
 *
 * ```ts
 * export const POST = (req: Request) =>
 *   handleReport(req, { sinks: [toResend({ apiKey, from, to })] });
 * ```
 */
export declare function handleReport(request: Request, options?: HandleReportOptions): Promise<Response>;
/** Sends every report on to Resend. The screenshot is attached when it was kept. */
export declare function toResend(options: Omit<SendReportEmailOptions, "screenshot">): ReportSink;
/** POSTs every report to a webhook — `json`, `slack` or `discord`. */
export declare function toWebhook(options: SendReportWebhookOptions): ReportSink;
/** Files every report as a GitHub issue, linking the stored screenshot. */
export declare function toGithub(options: CreateGithubIssueOptions): ReportSink;
/** Files every report as a Linear issue, linking the stored screenshot. */
export declare function toLinear(options: CreateLinearIssueOptions): ReportSink;
//# sourceMappingURL=handle.d.ts.map