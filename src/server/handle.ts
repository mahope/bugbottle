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
  normaliseContext,
  normaliseElements,
  normaliseMessage,
  normaliseNetwork,
  InvalidScreenshotError,
  type Breadcrumb,
  type ConsoleEntry,
  type ElementRef,
  type NetworkEntry,
  type ReportContext,
  type ReportType,
} from "../report-core.ts";
import { toMarkdown, type MarkdownOptions } from "../markdown.ts";
import { scrubReport, type ScrubOptions } from "../scrub.ts";
import { sendReportEmail, type SendReportEmailOptions } from "../sinks/resend.ts";
import { sendReportWebhook, type SendReportWebhookOptions } from "../sinks/webhook.ts";
import { createGithubIssue, type CreateGithubIssueOptions } from "../sinks/github.ts";

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
  context: ReportContext;
  console: ConsoleEntry[];
  elements: ElementRef[];
  breadcrumbs: Breadcrumb[];
  network: NetworkEntry[];
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

/** How much traffic one key may send. In memory, so per instance. */
export type RateLimitOptions = {
  limit: number;
  windowMs: number;
  /** What counts as one caller. Default: the forwarded client address. */
  key?: (request: Request) => string;
};

export type HandleReportOptions = {
  /** False answers 401 before the body is read. */
  authorize?: (request: Request) => boolean | Promise<boolean>;
  /** Ceiling for the request body. Default 4 MB. Over it answers 413. */
  maxBodyBytes?: number;
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
  /** In-memory, per instance. Fine per serverless isolate, not shared. */
  rateLimit?: RateLimitOptions;
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

function defaultRateLimitKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** True when this caller is over its allowance. Prunes as it goes. */
function overRateLimit(request: Request, options: RateLimitOptions): boolean {
  const key = (options.key ?? defaultRateLimitKey)(request);
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    // The map would otherwise grow with every address that ever called.
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > options.limit;
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

/**
 * Reads the body as text without ever holding more than the ceiling.
 *
 * `content-length` is a claim, not a fact, so it is checked first as a cheap
 * rejection and the stream is counted anyway.
 */
async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
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
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new BodyTooLargeError();
      chunks.push(value);
    }
  } finally {
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
 * The unknown top-level keys, capped. Strings are clipped, numbers and
 * booleans pass as they are, and anything else — an object, an array, a
 * function that arrived as JSON cannot — is left out.
 */
export function collectExtra(payload: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (KNOWN_KEYS.has(key)) continue;
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
export async function handleReport(
  request: Request,
  options: HandleReportOptions = {},
): Promise<Response> {
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
    let text: string;
    try {
      text = await readBoundedText(request, maxBodyBytes);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return json({ error: "Report is too large" }, 413, cors);
      }
      throw err;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return json({ error: "Malformed JSON" }, 400, cors);
    }

    let report = validateReport(payload);
    if (!report) return json({ error: EMPTY_MESSAGE_ERROR }, 400, cors);

    if (options.scrub) {
      report = scrubReport(report, options.scrub === true ? {} : options.scrub);
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
      screenshotUrl = await mode(bytes, report);
    }
    // A stored picture travels on as its URL: handing the bytes to a sink as
    // well would attach the same image twice, once inline and once by link.
    const screenshot = mode === "keep" ? bytes : undefined;

    let id: string | undefined;
    if (options.store) {
      const stored = await options.store(report, bytes);
      if (stored && typeof stored === "object" && typeof stored.id === "string") id = stored.id;
    }

    const markdown = toMarkdown(report, {
      ...options.markdown,
      ...(screenshotUrl ? { screenshotUrl } : {}),
    });

    const sinkErrors: unknown[] = [];
    const sinks = options.sinks ?? [];
    for (let i = 0; i < sinks.length; i += 1) {
      const sink = sinks[i];
      if (!sink) continue;
      try {
        await sink(report, { markdown, screenshotUrl, screenshot });
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
