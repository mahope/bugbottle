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
import { decodeScreenshotDataUrl, isReportType, normaliseBreadcrumbs, normaliseConsole, normaliseContact, normaliseContext, normaliseElements, normaliseMessage, normaliseNetwork, normaliseNotes, normalisePerf, normaliseReplay, normaliseStorage, InvalidScreenshotError, } from "../report-core.js";
import { fingerprint } from "../fingerprint.js";
import { hmacHex, DEFAULT_SIGNATURE_HEADER } from "../sign.js";
import { toMarkdown } from "../markdown.js";
import { scrubReport } from "../scrub.js";
import { sendReportEmail } from "../sinks/resend.js";
import { sendReportWebhook } from "../sinks/webhook.js";
import { createGithubIssue } from "../sinks/github.js";
import { createLinearIssue } from "../sinks/linear.js";
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
    "notes",
    "screenshotDataUrl",
]);
/** Longest key kept for a bucket: a header is not allowed to size the map. */
export const MAX_RATE_LIMIT_KEY_LENGTH = 64;
/** Hard ceiling on the bucket map, whatever the traffic looks like. */
export const MAX_RATE_LIMIT_BUCKETS = 10_000;
/**
 * Whether what a store answered with is really an entry. `id` is the only
 * field, and it is optional, so this is a shape check rather than a schema:
 * what it rejects is a value that was never a dedupe entry at all.
 */
function isDedupeEntry(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const id = value.id;
    return id === undefined || typeof id === "string";
}
/** Hard ceiling on the fingerprint map. */
export const MAX_DEDUPE_ENTRIES = 10_000;
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
 * memory in full; give such a deployment a `signature.store` instead.
 */
export const MAX_SIGNATURE_SECONDS = 640;
/** Hard ceiling on the replay cache: the two bounds above, multiplied. */
export const MAX_SIGNATURE_ENTRIES = MAX_SIGNATURE_ENTRIES_PER_SECOND * MAX_SIGNATURE_SECONDS;
/** The one answer to every bad signature. Missing, wrong, late and replayed all read the same. */
export const BAD_SIGNATURE_ERROR = "Bad signature";
/**
 * The rate-limit buckets. Module-level on purpose and documented as such: a
 * serverless isolate gets its own, and two instances behind a load balancer do
 * not share one. It stops a loop from one browser, not a distributed flood.
 */
const buckets = new Map();
/** Exported for tests, which would otherwise leak counts into each other. */
export function resetRateLimits() {
    buckets.clear();
}
/**
 * The fingerprints answered so far, and the id each one was stored under.
 * Module-level for the same reason the buckets are, and with the same honest
 * limit: it stops one browser sending the same crash forty times, not two
 * instances behind a load balancer storing it twice.
 */
const seenReports = new Map();
/** Exported for tests, which would otherwise leak fingerprints into each other. */
export function resetDedupe() {
    seenReports.clear();
}
/** Drops what has expired, then the oldest, so the map cannot grow for ever. */
function evictDedupe(now, windowMs) {
    for (const [key, seen] of seenReports)
        if (seen.at + windowMs <= now)
            seenReports.delete(key);
    while (seenReports.size >= MAX_DEDUPE_ENTRIES) {
        const oldest = seenReports.keys().next();
        if (oldest.done)
            break;
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
 * lands anyway; `signature.store` is the seam for the deployments that
 * need one answer across all of them.
 */
const seenSignatures = new Map();
/** Exported for tests, which would otherwise leak signatures into each other. */
export function resetSignatures() {
    seenSignatures.clear();
}
/** The bucket a signed timestamp belongs to: its second. */
function signatureBucket(timestamp) {
    return Math.floor(timestamp / 1000);
}
/**
 * Compares two hex digests without leaking where they differ through timing.
 * The lengths are public — both are 64 characters of SHA-256 — so returning
 * early on a mismatch there tells an attacker nothing.
 */
function timingSafeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let differences = 0;
    for (let i = 0; i < a.length; i += 1)
        differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
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
function parseSignature(value) {
    let sent = "";
    let digest = "";
    for (const part of value.split(",")) {
        const eq = part.indexOf("=");
        if (eq < 0)
            continue;
        const name = part.slice(0, eq).trim();
        if (name === "t")
            sent = part.slice(eq + 1);
        else if (name === "v1")
            digest = part.slice(eq + 1).trim();
    }
    // The shape is checked before any HMAC is computed, so a header full of
    // rubbish costs two regular expressions rather than a key import. Sixteen
    // digits is a quarter of a million years past the epoch and the widest run
    // that still fits a double.
    if (!/^\d{1,16}$/.test(sent) || !/^[0-9a-f]{64}$/.test(digest))
        return null;
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
function evictSignatures(now, maxSkewMs) {
    for (const second of seenSignatures.keys()) {
        if (second * 1000 + 1000 + maxSkewMs <= now)
            seenSignatures.delete(second);
    }
    while (seenSignatures.size >= MAX_SIGNATURE_SECONDS) {
        let earliest;
        for (const second of seenSignatures.keys()) {
            if (earliest === undefined || second < earliest)
                earliest = second;
        }
        if (earliest === undefined)
            break;
        seenSignatures.delete(earliest);
    }
}
/** True when this digest was accepted before, at the second it signed. */
function seenSignature(timestamp, digest) {
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
function rememberSignature(timestamp, digest, now, maxSkewMs) {
    evictSignatures(now, maxSkewMs);
    const second = signatureBucket(timestamp);
    let bucket = seenSignatures.get(second);
    if (!bucket) {
        bucket = new Set();
        seenSignatures.set(second, bucket);
    }
    // A `Set` iterates in insertion order, so the front of it is the digest this
    // second has held longest.
    while (bucket.size >= MAX_SIGNATURE_ENTRIES_PER_SECOND) {
        const oldest = bucket.values().next();
        if (oldest.done)
            break;
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
async function verifySignature(request, body, options) {
    const header = request.headers.get(options.header ?? DEFAULT_SIGNATURE_HEADER);
    // No signature at all is the one case `require: false` lets through. A
    // signature that is present is verified whatever `require` says.
    if (!header)
        return options.require === false;
    const parsed = parseSignature(header);
    if (!parsed)
        return false;
    const maxSkewMs = options.maxSkewMs ?? DEFAULT_SIGNATURE_SKEW_MS;
    const now = Date.now();
    // Both directions: a clock ahead of ours is as much of a replay window as a
    // clock behind it.
    if (Math.abs(now - parsed.timestamp) > maxSkewMs)
        return false;
    const keys = Array.isArray(options.key) ? options.key : [options.key];
    // The timestamp as it was sent, not as we would spell it: the browser signed
    // those characters and a re-spelling is a different message.
    const message = `${parsed.sent}.${body}`;
    let matched = false;
    for (const key of keys) {
        // Every key is tried even after one matches, so the time this takes says
        // nothing about which key was used or whether the first one was right.
        if (timingSafeEqual(await hmacHex(key, message), parsed.digest))
            matched = true;
    }
    if (!matched)
        return false;
    // Only a signature that verified is remembered, so nobody can fill the cache
    // with digests of their own choosing — though a public key means they can
    // still mint digests that do verify, which is why the in-memory store bounds
    // itself per signed second and why `signature.store` exists at all.
    const store = options.store ?? options.replayStore;
    if (store) {
        // A store that throws propagates: `handleReport` answers 500 rather than
        // accept a signature it could not check against what it has already seen.
        if (await store.has(parsed.digest))
            return false;
        await store.add(parsed.digest, parsed.timestamp + maxSkewMs);
        return true;
    }
    if (seenSignature(parsed.timestamp, parsed.digest))
        return false;
    rememberSignature(parsed.timestamp, parsed.digest, now, maxSkewMs);
    return true;
}
function defaultRateLimitKey(request) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded)
        return forwarded.split(",")[0]?.trim() || "unknown";
    return request.headers.get("cf-connecting-ip") ?? "unknown";
}
/**
 * Makes room for one more bucket: the expired ones first, because they cost
 * nothing to lose, and then the oldest entries. A `Map` iterates in insertion
 * order, so the front of it is the oldest key we know about.
 */
function evictBuckets(now) {
    for (const [k, v] of buckets)
        if (v.resetAt <= now)
            buckets.delete(k);
    while (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
        const oldest = buckets.keys().next();
        if (oldest.done)
            break;
        buckets.delete(oldest.value);
    }
}
/** True when this caller is over its allowance. Prunes as it goes. */
async function overRateLimit(request, options, onError) {
    // The key is attacker-controlled by default: a forwarded address is a header.
    // Clipping it bounds one entry, and the ceiling below bounds the whole map.
    const key = (options.key ?? defaultRateLimitKey)(request).slice(0, MAX_RATE_LIMIT_KEY_LENGTH);
    const store = options.store ?? options.rateLimitStore;
    if (store) {
        try {
            // The count is checked before it is compared, for the same reason the
            // dedupe store's answer is: a store that hands back `"3"`, or `null`, or
            // a promise of nothing, would otherwise be compared with `>` and quietly
            // decide the limit — `"3" > 30` is false, and so is `NaN > 30`, so every
            // caller would be under their allowance for ever with nothing said.
            const count = await store.hit(key, options.windowMs);
            if (typeof count !== "number" || !Number.isFinite(count)) {
                throw new TypeError("rateLimit.store.hit did not answer with a number");
            }
            return count > options.limit;
        }
        catch (err) {
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
    if (!bucket && buckets.size >= MAX_RATE_LIMIT_BUCKETS)
        evictBuckets(now);
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return false;
}
function corsHeaders(cors) {
    if (!cors)
        return {};
    // `Vary: Origin` travels with the header even when the value is a fixed `*`
    // or a single origin: a shared cache in front of the endpoint must not hand
    // one origin's answer to another, and a configuration that changes later
    // would otherwise be served from a cache that never learnt it varies.
    return { "Access-Control-Allow-Origin": cors === true ? "*" : cors, Vary: "Origin" };
}
function json(body, status, cors) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders(cors) },
    });
}
/** Copies the CORS header onto a response a caller built themselves. */
function withCors(response, cors) {
    const headers = corsHeaders(cors);
    if (Object.keys(headers).length === 0)
        return response;
    const merged = new Headers(response.headers);
    for (const [k, v] of Object.entries(headers)) {
        // A `respond` of the caller's own may already vary on something else, and
        // replacing their list with ours would quietly break their caching.
        if (k === "Vary") {
            const existing = merged.get("Vary");
            const already = (existing ?? "")
                .split(",")
                .some((part) => part.trim().toLowerCase() === "origin");
            merged.set("Vary", existing && !already ? `${existing}, ${v}` : (existing ?? v));
            continue;
        }
        merged.set(k, v);
    }
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: merged,
    });
}
/** Thrown internally when the body is over the ceiling. */
class BodyTooLargeError extends Error {
}
/** Thrown internally when the body took longer to arrive than we will wait. */
class BodyTimeoutError extends Error {
}
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
async function readBoundedText(request, maxBytes, timeoutMs) {
    const declared = request.headers.get("content-length");
    if (declared !== null) {
        const length = Number(declared);
        if (Number.isFinite(length) && length > maxBytes)
            throw new BodyTooLargeError();
    }
    const body = request.body;
    if (!body)
        return await request.text();
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    let timer;
    const expiry = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new BodyTimeoutError()), timeoutMs);
    });
    // Nothing awaits `expiry` once the loop is done, so it is marked handled here
    // rather than surfacing as an unhandled rejection after a fast request.
    expiry.catch(() => { });
    try {
        for (;;) {
            const { done, value } = await Promise.race([reader.read(), expiry]);
            if (done)
                break;
            if (!value)
                continue;
            total += value.byteLength;
            if (total > maxBytes)
                throw new BodyTooLargeError();
            chunks.push(value);
        }
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
        // Stops the sender rather than draining a body we have already refused.
        await reader.cancel().catch(() => { });
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
export function collectExtra(payload) {
    const extra = {};
    for (const [key, value] of Object.entries(payload)) {
        if (KNOWN_KEYS.has(key))
            continue;
        if (FORBIDDEN_EXTRA_KEYS.has(key))
            continue;
        if (Object.keys(extra).length >= MAX_EXTRA_KEYS)
            break;
        if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key))
            continue;
        if (typeof value === "string") {
            extra[key] = value.replace(/\u0000/g, "").slice(0, MAX_EXTRA_STRING_LENGTH);
        }
        else if (typeof value === "number" && Number.isFinite(value)) {
            extra[key] = value;
        }
        else if (typeof value === "boolean") {
            extra[key] = value;
        }
    }
    return extra;
}
/**
 * Validates a parsed body into a `ValidatedReport`, or returns null when there
 * is no message — the one field without which there is nothing to store.
 */
export function validateReport(payload) {
    const body = (typeof payload === "object" && payload !== null ? payload : {});
    const message = normaliseMessage(body.message);
    if (!message)
        return null;
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
        notes: normaliseNotes(body.notes),
        extra: collectExtra(body),
        receivedAt: new Date().toISOString(),
    };
}
/** A sink that never answered. Counted exactly like a sink that threw. */
export class SinkTimeoutError extends Error {
    constructor(ms) {
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
async function runSink(sink, report, ctx, timeoutMs) {
    // A plain timer rather than AbortSignal.timeout: on Node 22 that signal's
    // timer does not keep the event loop alive, so a hung sink in a process with
    // nothing else pending would end the process before the deadline fired.
    const controller = new AbortController();
    let timer;
    const expiry = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort(new SinkTimeoutError(timeoutMs));
            reject(new SinkTimeoutError(timeoutMs));
        }, timeoutMs);
    });
    // A sink that answers in time leaves this promise to reject into nobody.
    expiry.catch(() => { });
    try {
        await Promise.race([sink(report, { ...ctx, signal: controller.signal }), expiry]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
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
export async function handleReport(request, options = {}) {
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
        let text;
        try {
            text = await readBoundedText(request, maxBodyBytes, bodyTimeoutMs);
        }
        catch (err) {
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
        let payload;
        try {
            payload = JSON.parse(text);
        }
        catch {
            return json({ error: "Malformed JSON" }, 400, cors);
        }
        let report = validateReport(payload);
        if (!report)
            return json({ error: EMPTY_MESSAGE_ERROR }, 400, cors);
        // Dropped before scrubbing, deduplicating, storing or rendering, so a
        // deployment that says no to replays never has one in memory a moment
        // longer than the parse took.
        if (options.replay === "drop")
            report.replay = null;
        if (options.scrub) {
            report = scrubReport(report, options.scrub === true ? {} : options.scrub);
        }
        // Deduplicated after scrubbing, so two reports that only differ in what was
        // redacted are one report, and before anything is stored or delivered: the
        // whole point is that the second copy costs a row and an email less.
        let dedupeKey;
        if (options.dedupe) {
            const now = Date.now();
            const dedupeStore = options.dedupe.store ?? options.dedupe.dedupeStore;
            dedupeKey = (options.dedupe.key ?? fingerprint)(report);
            let seen;
            if (dedupeStore) {
                try {
                    // Anything shaped like an entry counts as a duplicate: expiring it
                    // when the window closes is what `expiresAt` asked the store to do.
                    // The shape is checked because a store that answers with a raw
                    // string, or with `true` for "present", would otherwise make every
                    // report a duplicate and quietly store nothing ever again.
                    const answer = await dedupeStore.get(dedupeKey);
                    if (answer !== undefined && answer !== null) {
                        if (isDedupeEntry(answer))
                            seen = answer;
                        else
                            throw new TypeError("dedupe.store.get did not answer with a dedupe entry");
                    }
                }
                catch (err) {
                    // Fails open. A duplicate costs a row and an email; a store that is
                    // down, or answering with something else entirely, must not cost the
                    // report itself.
                    options.onError?.(err);
                }
            }
            else {
                const remembered = seenReports.get(dedupeKey);
                if (remembered && remembered.at + options.dedupe.windowMs > now)
                    seen = remembered;
            }
            if (seen) {
                // 200 rather than 201: nothing was created. The reporter is still told
                // it arrived, because it did — the first time.
                return json(seen.id === undefined ? { duplicate: true } : { id: seen.id, duplicate: true }, 200, cors);
            }
            if (!dedupeStore)
                evictDedupe(now, options.dedupe.windowMs);
        }
        // A rejected picture is not a rejected report: the message is the valuable
        // part, and the reporter is not the one who broke the encoding.
        const mode = options.screenshot ?? "keep";
        let bytes;
        let screenshotUrl;
        const rawScreenshot = payload?.screenshotDataUrl;
        if (mode !== "drop" && typeof rawScreenshot === "string" && rawScreenshot) {
            try {
                bytes = decodeScreenshotDataUrl(rawScreenshot);
            }
            catch (err) {
                if (!(err instanceof InvalidScreenshotError))
                    throw err;
            }
        }
        if (bytes && typeof mode === "function") {
            try {
                screenshotUrl = await mode(bytes, report);
            }
            catch (err) {
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
        let id;
        if (options.store) {
            const stored = await options.store(report, screenshot);
            if (stored && typeof stored === "object" && typeof stored.id === "string")
                id = stored.id;
        }
        // Recorded once the report is stored, so a `store` that threw does not
        // leave a fingerprint that swallows the retry.
        if (dedupeKey !== undefined && options.dedupe) {
            const dedupeStore = options.dedupe.store ?? options.dedupe.dedupeStore;
            if (dedupeStore) {
                try {
                    await dedupeStore.set(dedupeKey, { id }, Date.now() + options.dedupe.windowMs);
                }
                catch (err) {
                    // The report is stored and about to be delivered. A store that could
                    // not remember it only means the next copy is answered as new.
                    options.onError?.(err);
                }
            }
            else {
                seenReports.set(dedupeKey, { id, at: Date.now() });
            }
        }
        const markdown = toMarkdown(report, {
            ...options.markdown,
            ...(screenshotUrl ? { screenshotUrl } : {}),
        });
        const sinkErrors = [];
        const sinks = options.sinks ?? [];
        const sinkTimeoutMs = options.sinkTimeoutMs ?? DEFAULT_SINK_TIMEOUT_MS;
        for (let i = 0; i < sinks.length; i += 1) {
            const sink = sinks[i];
            if (!sink)
                continue;
            try {
                await runSink(sink, report, { markdown, screenshotUrl, screenshot }, sinkTimeoutMs);
            }
            catch (err) {
                // A report that is already stored must not be lost to a webhook that
                // was revoked last week.
                sinkErrors.push(err);
                options.onSinkError?.(err, i);
            }
        }
        const result = { report, id, screenshot, screenshotUrl, markdown, sinkErrors };
        if (options.respond)
            return withCors(options.respond(result), cors);
        return id === undefined ? json({}, 202, cors) : json({ id }, 201, cors);
    }
    catch (err) {
        options.onError?.(err);
        // Whatever broke, its message is ours and not the reporter's to read.
        return json({ error: "Could not store the report" }, 500, cors);
    }
}
/** Sends every report on to Resend. The screenshot is attached when it was kept. */
export function toResend(options) {
    return async (report, ctx) => await sendReportEmail(report, {
        ...options,
        ...(ctx.screenshot ? { screenshot: ctx.screenshot } : {}),
        markdown: { ...options.markdown, ...(ctx.screenshotUrl ? { screenshotUrl: ctx.screenshotUrl } : {}) },
    });
}
/** POSTs every report to a webhook — `json`, `slack` or `discord`. */
export function toWebhook(options) {
    return async (report, ctx) => await sendReportWebhook(report, {
        ...options,
        markdown: { ...options.markdown, ...(ctx.screenshotUrl ? { screenshotUrl: ctx.screenshotUrl } : {}) },
    });
}
/** Files every report as a GitHub issue, linking the stored screenshot. */
export function toGithub(options) {
    return async (report, ctx) => await createGithubIssue(report, {
        ...options,
        ...(ctx.screenshotUrl ? { screenshotUrl: ctx.screenshotUrl } : {}),
    });
}
/** Files every report as a Linear issue, linking the stored screenshot. */
export function toLinear(options) {
    return async (report, ctx) => await createLinearIssue(report, {
        ...options,
        ...(ctx.screenshotUrl ? { screenshotUrl: ctx.screenshotUrl } : {}),
    });
}
//# sourceMappingURL=handle.js.map