/**
 * Building a report and sending it — the part every framework adapter shares.
 *
 * Nothing here is React-specific. A Vue, Svelte or vanilla form calls
 * `buildReport` with what the user typed and `sendReport` with the result; the
 * React hook does the same underneath.
 */

import { collectContext } from "./capture.ts";
import { getConsoleBuffer } from "./console-buffer.ts";
import { readBreadcrumbs, readNetwork, readPerf, readStorage } from "./registry.ts";
import type { BugReport, ElementRef, ReportType } from "./report-core.ts";

export type BuildReportInput = {
  type: ReportType;
  message: string;
  /** A PNG data URL from `captureScreenshot`, or nothing. */
  screenshotDataUrl?: string | null;
  /** Attach the recorded console errors. Default true. */
  includeConsole?: boolean;
  /**
   * Attach the recorded breadcrumbs. Default true, which means "whenever
   * `initBreadcrumbs` from `bugbottle/breadcrumbs` is recording" — an
   * application that never imports that module has nothing to attach and pays
   * nothing for the option.
   */
  includeBreadcrumbs?: boolean;
  /**
   * Attach the recorded requests. Default true, which means "whenever
   * `initNetwork` from `bugbottle/network` is recording" — an application that
   * never imports that module has nothing to attach and pays nothing for the
   * option.
   */
  includeNetwork?: boolean;
  /**
   * Attach the timings and the storage snapshot. Default true, which means
   * "whenever `initPerf` from `bugbottle/perf` is measuring" — an application
   * that never imports that module has nothing to attach and pays nothing for
   * the option.
   */
  includePerf?: boolean;
  /** Elements the reporter pointed at, from `pickElement`. */
  elements?: ElementRef[];
  /**
   * Extra fields to send alongside the report — an app version, a tenant id.
   * The report's own fields win if the names collide.
   */
  extra?: Record<string, unknown>;
  /**
   * Last pass over the assembled body, for redacting what the reporter did not
   * mean to send. Pass the scrubber from `bugbottle`:
   *
   * ```ts
   * import { buildReport, scrubReport } from "bugbottle";
   * buildReport({ type, message, scrub: scrubReport });
   * buildReport({ type, message, scrub: (r) => scrubReport(r, { keep: ["email"] }) });
   * ```
   *
   * It is a function rather than a `true` flag so that this file never imports
   * `scrub.ts`: a bundler resolves every import it sees, and the core entry has
   * a kilobyte to stay under.
   */
  scrub?: (report: BugReport & Record<string, unknown>) => BugReport & Record<string, unknown>;
};

/** Assembles the JSON body: message, type, page context, console, screenshot. */
export function buildReport(input: BuildReportInput): BugReport & Record<string, unknown> {
  const report: BugReport = {
    type: input.type,
    message: input.message.trim(),
    context: collectContext(),
  };
  if (input.includeConsole ?? true) report.console = getConsoleBuffer();
  if (input.elements && input.elements.length > 0) report.elements = input.elements;
  if (input.includeBreadcrumbs ?? true) {
    const crumbs = readBreadcrumbs();
    if (crumbs && crumbs.length > 0) report.breadcrumbs = crumbs;
  }
  if (input.includeNetwork ?? true) {
    const requests = readNetwork();
    if (requests && requests.length > 0) report.network = requests;
  }
  if (input.includePerf ?? true) {
    const perf = readPerf();
    if (perf) report.perf = perf;
    const storage = readStorage();
    if (storage) report.storage = storage;
  }
  if (input.screenshotDataUrl) report.screenshotDataUrl = input.screenshotDataUrl;
  const body = { ...input.extra, ...report };
  return input.scrub ? input.scrub(body) : body;
}

export type SendOptions = {
  /** Extra request headers — an auth token, a CSRF header. */
  headers?: Record<string, string>;
  /** Passed to `fetch`. Set to `"include"` for a cross-origin endpoint that needs cookies. */
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  /**
   * Abort the request after this many milliseconds. Default 15 000. A hung
   * request must not leave a form stuck on "sending" until the reporter gives
   * up and closes the tab. Set to 0 to disable.
   */
  timeoutMs?: number;
  /** Replace the global `fetch`, mostly for tests. */
  fetch?: typeof globalThis.fetch;
  /**
   * Ask the browser to finish the request even if the page goes away — a
   * closed tab, a link followed while the form was still sending.
   *
   * It is passed to `fetch` only when the serialised body is under
   * `KEEPALIVE_MAX_BYTES`: the specification caps all in-flight keepalive
   * bodies of a page at 64 KiB together, and a larger body makes `fetch`
   * reject outright rather than send without the flag. A report with a
   * screenshot is normally far over that, which is why this is opt-in and not
   * the default.
   */
  keepalive?: boolean;
  /**
   * Signs the serialised body and returns the headers that carry the
   * signature. Pass the signer from `bugbottle/sign`:
   *
   * ```ts
   * import { createSigner } from "bugbottle/sign";
   * sendReport(endpoint, report, { sign: createSigner({ key: SIGN_KEY }) });
   * ```
   *
   * It runs after `beforeSend` and after the body is serialised, because the
   * bytes that are signed have to be the bytes that are sent — a hook that
   * edits the report afterwards would invalidate the signature. The headers it
   * returns win over `headers`. `keepalive` changes nothing here: the same
   * signature travels on a request the browser finishes after the page is gone.
   *
   * It is a function rather than a `{ key }` option so that this file never
   * imports `sign.ts`: a bundler resolves every import it sees, and the core
   * entry has a kilobyte and a half to stay under. Same seam as `scrub`.
   */
  sign?: (body: string) => Promise<Record<string, string>>;
  /**
   * Called when the send failed, with the report as it would have been sent
   * and the error that stopped it. This is where an offline queue lives:
   *
   * ```ts
   * const queue = createQueue({ endpoint });
   * sendReport(endpoint, report, { onFailure: (r) => queue.enqueue(r) });
   * ```
   *
   * It runs before the error is rethrown, and it is awaited so a queue that
   * writes to storage has finished by the time the caller sees the failure.
   * An error thrown here is swallowed: the original failure is the one worth
   * reporting.
   */
  onFailure?: (
    report: BugReport & Record<string, unknown>,
    error: unknown,
  ) => void | Promise<void>;
  /**
   * Turn a failed response into a message for the reporter. Defaults to the
   * body's `error` or `message` field, then a generic one.
   */
  parseError?: (response: Response, body: unknown) => string | undefined;
  /**
   * Last look at the report before it leaves the browser. Return it, return a
   * changed copy, or return `null` to drop it — `sendReport` then resolves
   * `{ dropped: true, body: null, response: null }` without making a request.
   *
   * The name and the contract are Sentry's, because that is the shape people
   * already know. Errors thrown here propagate: a hook that cannot decide is
   * not a reason to send anyway.
   */
  beforeSend?: (
    report: BugReport & Record<string, unknown>,
  ) =>
    | (BugReport & Record<string, unknown>)
    | null
    | Promise<(BugReport & Record<string, unknown>) | null>;
};

export const DEFAULT_SEND_TIMEOUT_MS = 15_000;

/**
 * The largest body `keepalive` is used for. The browser limit is 64 KiB across
 * every keepalive request a page has in flight; this leaves room for a second
 * one rather than spending the whole allowance on the first.
 */
export const KEEPALIVE_MAX_BYTES = 60_000;

export type SendResult = {
  /** The `id` field of the response body, when the server sends one. */
  id?: string;
  body: unknown;
  /** `null` when `beforeSend` dropped the report and no request was made. */
  response: Response | null;
  /** True when `beforeSend` returned `null`. Nothing was sent. */
  dropped?: boolean;
};

/** The request was aborted by `timeoutMs` before the server answered. */
export class SendTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`No answer from the endpoint within ${timeoutMs} ms`);
    this.name = "SendTimeoutError";
  }
}

/** The server answered, but not with success. `message` is safe to show. */
export class SendFailedError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "SendFailedError";
    this.status = status;
    this.body = body;
  }
}

/**
 * POSTs a report as JSON. Resolves on a 2xx, throws `SendFailedError` on any
 * other status, `SendTimeoutError` when `timeoutMs` elapses first, and lets
 * network failures from `fetch` propagate as they are.
 *
 * `options.beforeSend` runs first and can drop the report, in which case this
 * resolves `{ dropped: true }` and never touches the network.
 */
export async function sendReport(
  endpoint: string,
  report: BugReport & Record<string, unknown>,
  options: SendOptions = {},
): Promise<SendResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onOuterAbort);
  if (options.signal?.aborted) onOuterAbort();
  // The clock starts before `beforeSend`, not after it. An async hook that
  // never settles — a permission dialog nobody answers, a fetch of its own to a
  // dead host — leaves the form on "sending" for ever, which is exactly the
  // failure `timeoutMs` exists to bound. The whole send is on the clock.
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort("timeout"), timeoutMs) : null;
  const timedOut = () => controller.signal.aborted && controller.signal.reason === "timeout";

  let payload = report;
  try {
    if (options.beforeSend) {
      const decided = await Promise.race([
        Promise.resolve(options.beforeSend(payload)),
        rejectWhenAborted(controller.signal),
      ]);
      if (decided === null || decided === undefined) {
        return { dropped: true, body: null, response: null };
      }
      payload = decided;
    }

    const doFetch = options.fetch ?? globalThis.fetch;
    const serialised = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };
    if (options.sign) {
      // Raced against the signal for the same reason `beforeSend` is: a signer
      // that never settles must not leave the form on "sending" for ever.
      const signed = await Promise.race([
        Promise.resolve(options.sign(serialised)),
        rejectWhenAborted(controller.signal),
      ]);
      Object.assign(headers, signed);
    }
    const init: RequestInit = {
      method: "POST",
      headers,
      body: serialised,
      signal: controller.signal,
    };
    if (options.credentials) init.credentials = options.credentials;
    if (options.keepalive && serialised.length < KEEPALIVE_MAX_BYTES) init.keepalive = true;

    const response = await doFetch(endpoint, init);
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const fromBody = body as { error?: unknown; message?: unknown } | null;
      const message =
        options.parseError?.(response, body) ||
        (typeof fromBody?.error === "string" && fromBody.error) ||
        (typeof fromBody?.message === "string" && fromBody.message) ||
        `Request failed with status ${response.status}`;
      throw new SendFailedError(message, response.status, body);
    }

    const id = (body as { id?: unknown } | null)?.id;
    return { id: typeof id === "string" ? id : undefined, body, response };
  } catch (err) {
    const failure =
      err instanceof SendFailedError || !timedOut() ? err : new SendTimeoutError(timeoutMs);
    if (options.onFailure) {
      try {
        await options.onFailure(payload, failure);
      } catch {
        // A queue that cannot write must not replace the error that says the
        // report never arrived. The send failed either way.
      }
    }
    throw failure;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * A promise that rejects the moment the signal aborts, so anything awaited can
 * be raced against it. `Promise.race` subscribes to both sides, so the loser is
 * never an unhandled rejection.
 */
function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(signal.reason ?? new DOMException("aborted", "AbortError"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}
