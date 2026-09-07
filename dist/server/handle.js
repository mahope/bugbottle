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
import { decodeScreenshotDataUrl, isReportType, normaliseBreadcrumbs, normaliseConsole, normaliseContext, normaliseElements, normaliseMessage, normaliseNetwork, InvalidScreenshotError, } from "../report-core.js";
import { toMarkdown } from "../markdown.js";
import { scrubReport } from "../scrub.js";
import { sendReportEmail } from "../sinks/resend.js";
import { sendReportWebhook } from "../sinks/webhook.js";
import { createGithubIssue } from "../sinks/github.js";
/** Default ceiling for a request body: the screenshot dominates it. */
export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Longest string kept for one `extra` value. */
export const MAX_EXTRA_STRING_LENGTH = 500;
/** How many unknown top-level keys are kept. */
export const MAX_EXTRA_KEYS = 20;
/** The locale-neutral answer to a report with nothing written in it. */
export const EMPTY_MESSAGE_ERROR = "Write a message first";
/** The known top-level keys of a report. Everything else becomes `extra`. */
const KNOWN_KEYS = new Set([
    "type",
    "message",
    "context",
    "console",
    "elements",
    "breadcrumbs",
    "network",
    "screenshotDataUrl",
]);
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
function defaultRateLimitKey(request) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded)
        return forwarded.split(",")[0]?.trim() || "unknown";
    return request.headers.get("cf-connecting-ip") ?? "unknown";
}
/** True when this caller is over its allowance. Prunes as it goes. */
function overRateLimit(request, options) {
    const key = (options.key ?? defaultRateLimitKey)(request);
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + options.windowMs });
        // The map would otherwise grow with every address that ever called.
        if (buckets.size > 10_000) {
            for (const [k, v] of buckets)
                if (v.resetAt <= now)
                    buckets.delete(k);
        }
        return false;
    }
    bucket.count += 1;
    return bucket.count > options.limit;
}
function corsHeaders(cors) {
    if (!cors)
        return {};
    return { "Access-Control-Allow-Origin": cors === true ? "*" : cors };
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
    for (const [k, v] of Object.entries(headers))
        merged.set(k, v);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: merged,
    });
}
/** Thrown internally when the body is over the ceiling. */
class BodyTooLargeError extends Error {
}
/**
 * Reads the body as text without ever holding more than the ceiling.
 *
 * `content-length` is a claim, not a fact, so it is checked first as a cheap
 * rejection and the stream is counted anyway.
 */
async function readBoundedText(request, maxBytes) {
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
    try {
        for (;;) {
            const { done, value } = await reader.read();
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
 * The unknown top-level keys, capped. Strings are clipped, numbers and
 * booleans pass as they are, and anything else — an object, an array, a
 * function that arrived as JSON cannot — is left out.
 */
export function collectExtra(payload) {
    const extra = {};
    for (const [key, value] of Object.entries(payload)) {
        if (KNOWN_KEYS.has(key))
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
    return {
        type: isReportType(body.type) ? body.type : "other",
        message,
        context: normaliseContext(body.context),
        console: normaliseConsole(body.console),
        elements: normaliseElements(body.elements),
        breadcrumbs: normaliseBreadcrumbs(body.breadcrumbs),
        network: normaliseNetwork(body.network),
        extra: collectExtra(body),
        receivedAt: new Date().toISOString(),
    };
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
            return new Response(null, {
                status: 204,
                headers: {
                    ...corsHeaders(cors),
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                    "Access-Control-Max-Age": "86400",
                },
            });
        }
        if (options.rateLimit && overRateLimit(request, options.rateLimit)) {
            return json({ error: "Too many reports" }, 429, cors);
        }
        if (options.authorize && !(await options.authorize(request))) {
            return json({ error: "Not allowed" }, 401, cors);
        }
        const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
        let text;
        try {
            text = await readBoundedText(request, maxBodyBytes);
        }
        catch (err) {
            if (err instanceof BodyTooLargeError) {
                return json({ error: "Report is too large" }, 413, cors);
            }
            throw err;
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
        if (options.scrub) {
            report = scrubReport(report, options.scrub === true ? {} : options.scrub);
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
            screenshotUrl = await mode(bytes, report);
        }
        // A stored picture travels on as its URL: handing the bytes to a sink as
        // well would attach the same image twice, once inline and once by link.
        const screenshot = mode === "keep" ? bytes : undefined;
        let id;
        if (options.store) {
            const stored = await options.store(report, bytes);
            if (stored && typeof stored === "object" && typeof stored.id === "string")
                id = stored.id;
        }
        const markdown = toMarkdown(report, {
            ...options.markdown,
            ...(screenshotUrl ? { screenshotUrl } : {}),
        });
        const sinkErrors = [];
        const sinks = options.sinks ?? [];
        for (let i = 0; i < sinks.length; i += 1) {
            const sink = sinks[i];
            if (!sink)
                continue;
            try {
                await sink(report, { markdown, screenshotUrl, screenshot });
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
//# sourceMappingURL=handle.js.map