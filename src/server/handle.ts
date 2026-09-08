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

import {
  decodeScreenshotDataUrl,
  isReportType,
  normaliseBreadcrumbs,
  normaliseConsole,
  normaliseContact,
  normaliseContext,
  normaliseElements,
  normaliseMessage,
  normaliseNetwork,
  normalisePerf,
  normaliseReplay,
  normaliseStorage,
  InvalidScreenshotError,
  type Breadcrumb,
  type ConsoleEntry,
  type ElementRef,
  type NetworkEntry,
  type PerfSnapshot,
  type ReplayCapture,
  type ReportContext,
  type StorageSnapshot,
  type ReportType,
} from "../report-core.ts";
import { fingerprint } from "../fingerprint.ts";
import { hmacHex, DEFAULT_SIGNATURE_HEADER } from "../sign.ts";
import { toMarkdown, type MarkdownOptions } from "../markdown.ts";
import { scrubReport, type ScrubOptions } from "../scrub.ts";
import { sendReportEmail, type SendReportEmailOptions } from "../sinks/resend.ts";
import { sendReportWebhook, type SendReportWebhookOptions } from "../sinks/webhook.ts";
import { createGithubIssue, type CreateGithubIssueOptions } from "../sinks/github.ts";
import { createLinearIssue, type CreateLinearIssueOptions } from "../sinks/linear.ts";

/** Default ceiling for a request body: the screenshot dominates it. */
export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Longest string kept for one `extra` value. */
export const MAX_EXTRA_STRING_LENGTH = 500;

/** How many unknown top-level keys are kept. */
export const MAX_EXTRA_KEYS = 20;

/** How long the whole body may take to arrive. Default 15 s. Over it answers 408. */
export const DEFAULT_BODY_TIMEOUT_MS = 15_000;

/** How long one sink may take before it is abandoned. Default 10 s. */
export const DEFAULT_SINK_TIMEOUT_MS = 10_000;

/** The locale-neutral answer to a report with nothing written in it. */
export const EMPTY_MESSAGE_ERROR = "Write a message first";

/** The answer to a body over the ceiling. Shared with the Express adapter. */
export const TOO_LARGE_ERROR = "Report is too large";

/** The known top-level keys of a report. Everything else becomes `extra`. */
const KNOWN_KEYS = new Set([
  "type",
  "message",
  "contact",
  "context",
  "console",
  "elements",
  "breadcrumbs",
  "network",
  "perf",
  "storage",
  "replay",
  "screenshotDataUrl",
]);

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
  rateLimitStore?: RateLimitStore;
};

/**
 * The seam between `handleReport` and wherever the counting happens. One
 * method, because a limit needs exactly one thing: increment and tell me the
 * total. It may be synchronous — the in-memory default is — so a store that
 * needs no network costs no promise.
 *
 * ```ts
 * const rateLimitStore = {
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
export const MAX_RATE_LIMIT_KEY_LENGTH = 64;

/** Hard ceiling on the bucket map, whatever the traffic looks like. */
export const MAX_RATE_LIMIT_BUCKETS = 10_000;

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
  dedupeStore?: DedupeStore;
};

/** What a dedupe store keeps: the id the first copy was stored under, if any. */
export type DedupeEntry = { id?: string };

/**
 * The seam between `handleReport` and wherever the fingerprints are
 * remembered. Shaped like `ReplayStore`, and like it either half may be
 * synchronous.
 *
 * ```ts
 * const dedupeStore = {
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

/**
 * Whether what a store answered with is really an entry. `id` is the only
 * field, and it is optional, so this is a shape check rather than a schema:
 * what it rejects is a value that was never a dedupe entry at all.
 */
function isDedupeEntry(value: unknown): value is DedupeEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const id = (value as { id?: unknown }).id;
  return id === undefined || typeof id === "string";
}

/** Hard ceiling on the fingerprint map. */
export const MAX_DEDUPE_ENTRIES = 10_000;

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
  replayStore?: ReplayStore;
};

/**
 * The seam between `handleReport` and wherever accepted signatures are
 * remembered. Both halves may be synchronous — the in-memory default is — so a
 * store that needs no network costs no promise.
 *
 * ```ts
 * const replayStore = {
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
export const DEFAULT_SIGNATURE_SKEW_MS = 5 * 60_000;

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
export const MAX_SIGNATURE_ENTRIES_PER_SECOND = 128;

/**
 * How many signed seconds are remembered at once. The default window spans 601
 * of them — five minutes on either side of our clock — so honest traffic never
 * reaches this. A `maxSkewMs` wider than this many seconds cannot be held in
 * memory in full; give such a deployment a `replayStore` instead.
 */
export const MAX_SIGNATURE_SECONDS = 640;

/** Hard ceiling on the replay cache: the two bounds above, multiplied. */
export const MAX_SIGNATURE_ENTRIES = MAX_SIGNATURE_ENTRIES_PER_SECOND * MAX_SIGNATURE_SECONDS;

/** The one answer to every bad signature. Missing, wrong, late and replayed all read the same. */
export const BAD_SIGNATURE_ERROR = "Bad signature";

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
  screenshot?:
    | "drop"
    | "keep"
    | ((bytes: Uint8Array, report: ValidatedReport) => Promise<string | undefined>);
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
  store?: (
    report: ValidatedReport,
    screenshot?: Uint8Array,
  ) => Promise<{ id?: string } | void> | { id?: string } | void;
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
   * shared. `rateLimit.rateLimitStore` is the seam for a shared count.
   */
  rateLimit?: RateLimitOptions;
  /**
   * Answer a repeat of the same report with 200 `{ id, duplicate: true }`
   * instead of storing and delivering it again. In memory and per instance by
   * default; `dedupe.dedupeStore` is the seam for one answer across a fleet.
   */
  dedupe?: DedupeOptions;
  /** Passed through to `toMarkdown` — extra facts, a heading level. */
  markdown?: MarkdownOptions;
};

/**
 * The rate-limit buckets. Module-level on purpose and documented as such: a
 * serverless isolate gets its own, and two instances behind a load balancer do
 * not share one. It stops a loop from one browser, not a distributed flood.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/** Exported for tests, which would otherwise leak counts into each other. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * The fingerprints answered so far, and the id each one was stored under.
 * Module-level for the same reason the buckets are, and with the same honest
 * limit: it stops one browser sending the same crash forty times, not two
 * instances behind a load balancer storing it twice.
 */
const seenReports = new Map<string, { id?: string; at: number }>();

/** Exported for tests, which would otherwise leak fingerprints into each other. */
export function resetDedupe(): void {
  seenReports.clear();
}

/** Drops what has expired, then the oldest, so the map cannot grow for ever. */
function evictDedupe(now: number, windowMs: number): void {
  for (const [key, seen] of seenReports) if (seen.at + windowMs <= now) seenReports.delete(key);
  while (seenReports.size >= MAX_DEDUPE_ENTRIES) {
    const oldest = seenReports.keys().next();
    if (oldest.done) break;
    seenReports.delete(oldest.value);
  }
}

/**
 * The signatures accepted so far, in buckets keyed by the *signed* second
 * rather than the moment each one arrived. Two things follow from that key.
 *
 * An entry survives exactly as long as the signature it stands for would still
 * be accepted: the window runs in both directions, so a signature dated ahead
 * of our clock is valid for nearly twice `maxSkewMs` after it first turns up,
 * and forgetting it any earlier hands back the rest as a replay window.
 *
 * And the ceiling is per bucket, so making room is a local act. The key is
 * public — it ships to the browser — so anybody can mint valid signatures in
 * bulk; against one global ceiling that is a way to evict an honest digest and
 * replay the body it stood for. Here a flood can only push out digests dated
 * the same second it floods.
 *
 * Module-level with the same honest limit as the buckets and the fingerprints:
 * one instance remembers its own traffic, and two instances behind a load
 * balancer do not share a cache. It stops a captured body being replayed at
 * the instance that saw it, which is where a replay of a browser's own request
 * lands anyway; `signature.replayStore` is the seam for the deployments that
 * need one answer across all of them.
 */
const seenSignatures = new Map<number, Set<string>>();

/** Exported for tests, which would otherwise leak signatures into each other. */
export function resetSignatures(): void {
  seenSignatures.clear();
}

/** The bucket a signed timestamp belongs to: its second. */
function signatureBucket(timestamp: number): number {
  return Math.floor(timestamp / 1000);
}

/**
 * Compares two hex digests without leaking where they differ through timing.
 * The lengths are public — both are 64 characters of SHA-256 — so returning
 * early on a mismatch there tells an attacker nothing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i += 1) differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return differences === 0;
}

/**
 * `t=<unix ms>,v1=<hex>` into its parts, or null when it is not that.
 *
 * `t` is matched against the documented spelling exactly — digits, nothing
 * else — rather than handed to `Number()`, which would also take `0x1`, `1e12`
 * and a leading space and then canonicalise them into the message we verify.
 * None of that was exploitable, but a format with one spelling is a format a
 * second implementation can get right, and the digest is over the text as it
 * was sent rather than over our idea of the same number.
 */
function parseSignature(value: string): { timestamp: number; sent: string; digest: string } | null {
  let sent = "";
  let digest = "";
  for (const part of value.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === "t") sent = part.slice(eq + 1);
    else if (name === "v1") digest = part.slice(eq + 1).trim();
  }
  // The shape is checked before any HMAC is computed, so a header full of
  // rubbish costs two regular expressions rather than a key import. Sixteen
  // digits is a quarter of a million years past the epoch and the widest run
  // that still fits a double.
  if (!/^\d{1,16}$/.test(sent) || !/^[0-9a-f]{64}$/.test(digest)) return null;
  return { timestamp: Number(sent), sent, digest };
}

/**
 * Drops the seconds that can no longer be accepted anyway, then the earliest.
 *
 * A bucket holds timestamps from `second * 1000` to `second * 1000 + 999`, and
 * the latest of those is refused once `now` is more than `maxSkewMs` past it,
 * so the whole bucket is free at `second * 1000 + 1000 + maxSkewMs`. The
 * earliest bucket is the one dropped when there are too many, because it is
 * the one closest to expiring on its own — and it is found by comparing the
 * keys rather than by taking the front of the map, which is insertion order
 * and so is whatever an attacker signed first.
 */
function evictSignatures(now: number, maxSkewMs: number): void {
  for (const second of seenSignatures.keys()) {
    if (second * 1000 + 1000 + maxSkewMs <= now) seenSignatures.delete(second);
  }
  while (seenSignatures.size >= MAX_SIGNATURE_SECONDS) {
    let earliest: number | undefined;
    for (const second of seenSignatures.keys()) {
      if (earliest === undefined || second < earliest) earliest = second;
    }
    if (earliest === undefined) break;
    seenSignatures.delete(earliest);
  }
}

/** True when this digest was accepted before, at the second it signed. */
function seenSignature(timestamp: number, digest: string): boolean {
  return seenSignatures.get(signatureBucket(timestamp))?.has(digest) === true;
}

/**
 * Remembers one accepted digest under the second it signed.
 *
 * Room is made inside that second and nowhere else. The digest binds the
 * timestamp — the HMAC is over `<t>.<body>` — so a digest belongs to exactly
 * one bucket and looking it up costs one hash of the second and one of the
 * digest.
 */
function rememberSignature(timestamp: number, digest: string, now: number, maxSkewMs: number): void {
  evictSignatures(now, maxSkewMs);
  const second = signatureBucket(timestamp);
  let bucket = seenSignatures.get(second);
  if (!bucket) {
    bucket = new Set<string>();
    seenSignatures.set(second, bucket);
  }
  // A `Set` iterates in insertion order, so the front of it is the digest this
  // second has held longest.
  while (bucket.size >= MAX_SIGNATURE_ENTRIES_PER_SECOND) {
    const oldest = bucket.values().next();
    if (oldest.done) break;
    bucket.delete(oldest.value);
  }
  bucket.add(digest);
}

/**
 * True when this body arrived with a signature we are willing to accept.
 *
 * The body is the raw text as it was received, not a re-serialisation of the
 * parsed JSON: `JSON.stringify(JSON.parse(x))` is not `x` — key order, spacing
 * and number formatting all move — so anything that reparses before verifying
 * would reject every honest report.
 */
async function verifySignature(
  request: Request,
  body: string,
  options: SignatureOptions,
): Promise<boolean> {
  const header = request.headers.get(options.header ?? DEFAULT_SIGNATURE_HEADER);
  // No signature at all is the one case `require: false` lets through. A
  // signature that is present is verified whatever `require` says.
  if (!header) return options.require === false;

  const parsed = parseSignature(header);
  if (!parsed) return false;

  const maxSkewMs = options.maxSkewMs ?? DEFAULT_SIGNATURE_SKEW_MS;
  const now = Date.now();
  // Both directions: a clock ahead of ours is as much of a replay window as a
  // clock behind it.
  if (Math.abs(now - parsed.timestamp) > maxSkewMs) return false;

  const keys = Array.isArray(options.key) ? options.key : [options.key];
  // The timestamp as it was sent, not as we would spell it: the browser signed
  // those characters and a re-spelling is a different message.
  const message = `${parsed.sent}.${body}`;
  let matched = false;
  for (const key of keys) {
    // Every key is tried even after one matches, so the time this takes says
    // nothing about which key was used or whether the first one was right.
    if (timingSafeEqual(await hmacHex(key, message), parsed.digest)) matched = true;
  }
  if (!matched) return false;

  // Only a signature that verified is remembered, so nobody can fill the cache
  // with digests of their own choosing — though a public key means they can
  // still mint digests that do verify, which is why the in-memory store bounds
  // itself per signed second and why `replayStore` exists at all.
  const store = options.replayStore;
  if (store) {
    // A store that throws propagates: `handleReport` answers 500 rather than
    // accept a signature it could not check against what it has already seen.
    if (await store.has(parsed.digest)) return false;
    await store.add(parsed.digest, parsed.timestamp + maxSkewMs);
    return true;
  }
  if (seenSignature(parsed.timestamp, parsed.digest)) return false;
  rememberSignature(parsed.timestamp, parsed.digest, now, maxSkewMs);
  return true;
}

function defaultRateLimitKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/**
 * Makes room for one more bucket: the expired ones first, because they cost
 * nothing to lose, and then the oldest entries. A `Map` iterates in insertion
 * order, so the front of it is the oldest key we know about.
 */
function evictBuckets(now: number): void {
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  while (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
    const oldest = buckets.keys().next();
    if (oldest.done) break;
    buckets.delete(oldest.value);
  }
}

/** True when this caller is over its allowance. Prunes as it goes. */
async function overRateLimit(
  request: Request,
  options: RateLimitOptions,
  onError: ((error: unknown) => void) | undefined,
): Promise<boolean> {
  // The key is attacker-controlled by default: a forwarded address is a header.
  // Clipping it bounds one entry, and the ceiling below bounds the whole map.
  const key = (options.key ?? defaultRateLimitKey)(request).slice(0, MAX_RATE_LIMIT_KEY_LENGTH);
  const store = options.rateLimitStore;
  if (store) {
    try {
      // The count is checked before it is compared, for the same reason the
      // dedupe store's answer is: a store that hands back `"3"`, or `null`, or
      // a promise of nothing, would otherwise be compared with `>` and quietly
      // decide the limit — `"3" > 30` is false, and so is `NaN > 30`, so every
      // caller would be under their allowance for ever with nothing said.
      const count = await store.hit(key, options.windowMs);
      if (typeof count !== "number" || !Number.isFinite(count)) {
        throw new TypeError("rateLimitStore.hit did not answer with a number");
      }
      return count > options.limit;
    } catch (err) {
      // Fails open, unlike the replay store: a rate limit exists to stop a
      // flood, and answering 429 to an honest reporter because Redis blinked
      // loses the one report that was worth having.
      onError?.(err);
      return false;
    }
  }
  const now = Date.now();
  const bucket = buckets.get(key);
  if (bucket && bucket.resetAt > now) {
    bucket.count += 1;
    return bucket.count > options.limit;
  }
  // A fresh key is what grows the map, so that is where the ceiling is checked.
  if (!bucket && buckets.size >= MAX_RATE_LIMIT_BUCKETS) evictBuckets(now);
  buckets.set(key, { count: 1, resetAt: now + options.windowMs });
  return false;
}

function corsHeaders(cors: string | boolean | undefined): Record<string, string> {
  if (!cors) return {};
  return { "Access-Control-Allow-Origin": cors === true ? "*" : cors };
}

function json(body: unknown, status: number, cors: string | boolean | undefined): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(cors) },
  });
}

/** Copies the CORS header onto a response a caller built themselves. */
function withCors(response: Response, cors: string | boolean | undefined): Response {
  const headers = corsHeaders(cors);
  if (Object.keys(headers).length === 0) return response;
  const merged = new Headers(response.headers);
  for (const [k, v] of Object.entries(headers)) merged.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

/** Thrown internally when the body is over the ceiling. */
class BodyTooLargeError extends Error {}

/** Thrown internally when the body took longer to arrive than we will wait. */
class BodyTimeoutError extends Error {}

/**
 * Reads the body as text without ever holding more than the ceiling, and
 * without waiting for it longer than the deadline.
 *
 * `content-length` is a claim, not a fact, so it is checked first as a cheap
 * rejection and the stream is counted anyway. The deadline covers the whole
 * read rather than one chunk, because a sender that dribbles a byte at a time
 * never trips a per-chunk timer and holds the socket open for as long as it
 * likes.
 */
async function readBoundedText(
  request: Request,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) throw new BodyTooLargeError();
  }

  const body = request.body;
  if (!body) return await request.text();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BodyTimeoutError()), timeoutMs);
  });
  // Nothing awaits `expiry` once the loop is done, so it is marked handled here
  // rather than surfacing as an unhandled rejection after a fast request.
  expiry.catch(() => {});
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), expiry]);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new BodyTooLargeError();
      chunks.push(value);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Stops the sender rather than draining a body we have already refused.
    await reader.cancel().catch(() => {});
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Keys that mean something to the language rather than to us. `JSON.parse`
 * makes `__proto__` an own property, but assigning it back onto a plain object
 * reaches the prototype setter instead, and `constructor` shadows a method
 * every later reader assumes is there. Neither belongs in a row.
 */
const FORBIDDEN_EXTRA_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * The unknown top-level keys, capped. Strings are clipped, numbers and
 * booleans pass as they are, and anything else — an object, an array, a
 * function that arrived as JSON cannot — is left out.
 */
export function collectExtra(payload: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (KNOWN_KEYS.has(key)) continue;
    if (FORBIDDEN_EXTRA_KEYS.has(key)) continue;
    if (Object.keys(extra).length >= MAX_EXTRA_KEYS) break;
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key)) continue;
    if (typeof value === "string") {
      extra[key] = value.replace(/\u0000/g, "").slice(0, MAX_EXTRA_STRING_LENGTH);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      extra[key] = value;
    } else if (typeof value === "boolean") {
      extra[key] = value;
    }
  }
  return extra;
}

/**
 * Validates a parsed body into a `ValidatedReport`, or returns null when there
 * is no message — the one field without which there is nothing to store.
 */
export function validateReport(payload: unknown): ValidatedReport | null {
  const body = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const message = normaliseMessage(body.message);
  if (!message) return null;
  const contact = normaliseContact(body.contact);
  return {
    type: isReportType(body.type) ? body.type : "other",
    message,
    // Left out rather than set to null: a report without a contact line has no
    // contact line, and a reader should not have to tell those two apart.
    ...(contact ? { contact } : {}),
    context: normaliseContext(body.context),
    console: normaliseConsole(body.console),
    elements: normaliseElements(body.elements),
    breadcrumbs: normaliseBreadcrumbs(body.breadcrumbs),
    network: normaliseNetwork(body.network),
    perf: normalisePerf(body.perf),
    storage: normaliseStorage(body.storage),
    replay: normaliseReplay(body.replay),
    extra: collectExtra(body),
    receivedAt: new Date().toISOString(),
  };
}

/** A sink that never answered. Counted exactly like a sink that threw. */
export class SinkTimeoutError extends Error {
  constructor(ms: number) {
    super(`Sink did not answer within ${ms} ms`);
    this.name = "SinkTimeoutError";
  }
}

/**
 * Runs one sink under a deadline.
 *
 * A sink is one `fetch` to somebody else's service, and somebody else's
 * service is allowed to hang. Without a deadline the reporter waits for it,
 * and on a serverless runtime the whole invocation is billed for the wait —
 * for a delivery that is explicitly not allowed to fail the reply anyway.
 */
async function runSink(
  sink: ReportSink,
  report: ValidatedReport,
  ctx: SinkContext,
  timeoutMs: number,
): Promise<void> {
  // A plain timer rather than AbortSignal.timeout: on Node 22 that signal's
  // timer does not keep the event loop alive, so a hung sink in a process with
  // nothing else pending would end the process before the deadline fired.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new SinkTimeoutError(timeoutMs));
      reject(new SinkTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  // A sink that answers in time leaves this promise to reject into nobody.
  expiry.catch(() => {});
  try {
    await Promise.race([sink(report, { ...ctx, signal: controller.signal }), expiry]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Turns an incoming request into a stored, delivered report and a `Response`.
 *
 * ```ts
 * export const POST = (req: Request) =>
 *   handleReport(req, { sinks: [toResend({ apiKey, from, to })] });
 * ```
 */
export async function handleReport(
  request: Request,
  options: HandleReportOptions = {},
): Promise<Response> {
  const cors = options.cors;

  try {
    if (request.method === "OPTIONS" && cors) {
      // Reflecting what was asked for is what lets a client send its own
      // headers — a CSRF token, a tracing id — without us listing them here.
      const requested = request.headers.get("access-control-request-headers");
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(cors),
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": requested ?? "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Only a POST carries a report. Anything else is a misrouted request, and
    // answering it here is cheaper than validating a body that cannot exist.
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    if (options.rateLimit && (await overRateLimit(request, options.rateLimit, options.onError))) {
      return json({ error: "Too many reports" }, 429, cors);
    }

    if (options.authorize && !(await options.authorize(request))) {
      return json({ error: "Not allowed" }, 401, cors);
    }

    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const bodyTimeoutMs = options.bodyTimeoutMs ?? DEFAULT_BODY_TIMEOUT_MS;
    let text: string;
    try {
      text = await readBoundedText(request, maxBodyBytes, bodyTimeoutMs);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return json({ error: TOO_LARGE_ERROR }, 413, cors);
      }
      if (err instanceof BodyTimeoutError) {
        return json({ error: "Report took too long to arrive" }, 408, cors);
      }
      throw err;
    }

    // Verified over the text that arrived, before anything parses it, and
    // before a body nobody signed reaches a validator.
    if (options.signature && !(await verifySignature(request, text, options.signature))) {
      return json({ error: BAD_SIGNATURE_ERROR }, 401, cors);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return json({ error: "Malformed JSON" }, 400, cors);
    }

    let report = validateReport(payload);
    if (!report) return json({ error: EMPTY_MESSAGE_ERROR }, 400, cors);

    // Dropped before scrubbing, deduplicating, storing or rendering, so a
    // deployment that says no to replays never has one in memory a moment
    // longer than the parse took.
    if (options.replay === "drop") report.replay = null;

    if (options.scrub) {
      report = scrubReport(report, options.scrub === true ? {} : options.scrub);
    }

    // Deduplicated after scrubbing, so two reports that only differ in what was
    // redacted are one report, and before anything is stored or delivered: the
    // whole point is that the second copy costs a row and an email less.
    let dedupeKey: string | undefined;
    if (options.dedupe) {
      const now = Date.now();
      const dedupeStore = options.dedupe.dedupeStore;
      dedupeKey = (options.dedupe.key ?? fingerprint)(report);
      let seen: DedupeEntry | undefined;
      if (dedupeStore) {
        try {
          // Anything shaped like an entry counts as a duplicate: expiring it
          // when the window closes is what `expiresAt` asked the store to do.
          // The shape is checked because a store that answers with a raw
          // string, or with `true` for "present", would otherwise make every
          // report a duplicate and quietly store nothing ever again.
          const answer = await dedupeStore.get(dedupeKey);
          if (answer !== undefined && answer !== null) {
            if (isDedupeEntry(answer)) seen = answer;
            else throw new TypeError("dedupeStore.get did not answer with a dedupe entry");
          }
        } catch (err) {
          // Fails open. A duplicate costs a row and an email; a store that is
          // down, or answering with something else entirely, must not cost the
          // report itself.
          options.onError?.(err);
        }
      } else {
        const remembered = seenReports.get(dedupeKey);
        if (remembered && remembered.at + options.dedupe.windowMs > now) seen = remembered;
      }
      if (seen) {
        // 200 rather than 201: nothing was created. The reporter is still told
        // it arrived, because it did — the first time.
        return json(
          seen.id === undefined ? { duplicate: true } : { id: seen.id, duplicate: true },
          200,
          cors,
        );
      }
      if (!dedupeStore) evictDedupe(now, options.dedupe.windowMs);
    }

    // A rejected picture is not a rejected report: the message is the valuable
    // part, and the reporter is not the one who broke the encoding.
    const mode = options.screenshot ?? "keep";
    let bytes: Uint8Array | undefined;
    let screenshotUrl: string | undefined;
    const rawScreenshot = (payload as Record<string, unknown> | null)?.screenshotDataUrl;
    if (mode !== "drop" && typeof rawScreenshot === "string" && rawScreenshot) {
      try {
        bytes = decodeScreenshotDataUrl(rawScreenshot);
      } catch (err) {
        if (!(err instanceof InvalidScreenshotError)) throw err;
      }
    }
    if (bytes && typeof mode === "function") {
      try {
        screenshotUrl = await mode(bytes, report);
      } catch (err) {
        // The bucket being down is not the reporter losing their report. The
        // message is still stored and still delivered, only without a picture.
        options.onError?.(err);
      }
    }
    // A stored picture travels on as its URL: handing the bytes to a sink as
    // well would attach the same image twice, once inline and once by link.
    // `store` sees them on the same terms, which is what the README promises:
    // only `"keep"` hands bytes on.
    const screenshot = mode === "keep" ? bytes : undefined;

    let id: string | undefined;
    if (options.store) {
      const stored = await options.store(report, screenshot);
      if (stored && typeof stored === "object" && typeof stored.id === "string") id = stored.id;
    }

    // Recorded once the report is stored, so a `store` that threw does not
    // leave a fingerprint that swallows the retry.
    if (dedupeKey !== undefined && options.dedupe) {
      const dedupeStore = options.dedupe.dedupeStore;
      if (dedupeStore) {
        try {
          await dedupeStore.set(dedupeKey, { id }, Date.now() + options.dedupe.windowMs);
        } catch (err) {
          // The report is stored and about to be delivered. A store that could
          // not remember it only means the next copy is answered as new.
          options.onError?.(err);
        }
      } else {
        seenReports.set(dedupeKey, { id, at: Date.now() });
      }
    }

    const markdown = toMarkdown(report, {
      ...options.markdown,
      ...(screenshotUrl ? { screenshotUrl } : {}),
    });

    const sinkErrors: unknown[] = [];
    const sinks = options.sinks ?? [];
    const sinkTimeoutMs = options.sinkTimeoutMs ?? DEFAULT_SINK_TIMEOUT_MS;
    for (let i = 0; i < sinks.length; i += 1) {
      const sink = sinks[i];
      if (!sink) continue;
      try {
        await runSink(sink, report, { markdown, screenshotUrl, screenshot }, sinkTimeoutMs);
      } catch (err) {
        // A report that is already stored must not be lost to a webhook that
        // was revoked last week.
        sinkErrors.push(err);
        options.onSinkError?.(err, i);
      }
    }

    const result: HandleReportResult = { report, id, screenshot, screenshotUrl, markdown, sinkErrors };
    if (options.respond) return withCors(options.respond(result), cors);
    return id === undefined ? json({}, 202, cors) : json({ id }, 201, cors);
  } catch (err) {
    options.onError?.(err);
    // Whatever broke, its message is ours and not the reporter's to read.
    return json({ error: "Could not store the report" }, 500, cors);
  }
}

/** Sends every report on to Resend. The screenshot is attached when it was kept. */
export function toResend(options: Omit<SendReportEmailOptions, "screenshot">): ReportSink {
  return async (report, ctx) =>
    await sendReportEmail(report, {
      ...options,
      ...(ctx.screenshot ? { screenshot: ctx.screenshot } : {}),
      markdown: { ...options.markdown, ...(ctx.screenshotUrl ? { screenshotUrl: ctx.screenshotUrl } : {}) },
    });
}

/** POSTs every report to a webhook — `json`, `slack` or `discord`. */
export function toWebhook(options: SendReportWebhookOptions): ReportSink {
  return async (report, ctx) =>
    await sendReportWebhook(report, {
      ...options,
      markdown: { ...options.markdown, ...(ctx.screenshotUrl ? { screenshotUrl: ctx.screenshotUrl } : {}) },
    });
}

/** Files every report as a GitHub issue, linking the stored screenshot. */
export function toGithub(options: CreateGithubIssueOptions): ReportSink {
  return async (report, ctx) =>
    await createGithubIssue(report, {
      ...options,
      ...(ctx.screenshotUrl ? { screenshotUrl: ctx.screenshotUrl } : {}),
    });
}

/** Files every report as a Linear issue, linking the stored screenshot. */
export function toLinear(options: CreateLinearIssueOptions): ReportSink {
  return async (report, ctx) =>
    await createLinearIssue(report, {
      ...options,
      ...(ctx.screenshotUrl ? { screenshotUrl: ctx.screenshotUrl } : {}),
    });
}
