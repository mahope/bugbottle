/**
 * Building a report and sending it — the part every framework adapter shares.
 *
 * Nothing here is React-specific. A Vue, Svelte or vanilla form calls
 * `buildReport` with what the user typed and `sendReport` with the result; the
 * React hook does the same underneath.
 */

import { collectContext } from "./capture.ts";
import { getConsoleBuffer } from "./console-buffer.ts";
import type { BugReport, ElementRef, ReportType } from "./report-core.ts";

export type BuildReportInput = {
  type: ReportType;
  message: string;
  /** A PNG data URL from `captureScreenshot`, or nothing. */
  screenshotDataUrl?: string | null;
  /** Attach the recorded console errors. Default true. */
  includeConsole?: boolean;
  /** Elements the reporter pointed at, from `pickElement`. */
  elements?: ElementRef[];
  /**
   * Extra fields to send alongside the report — an app version, a tenant id.
   * The report's own fields win if the names collide.
   */
  extra?: Record<string, unknown>;
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
  if (input.screenshotDataUrl) report.screenshotDataUrl = input.screenshotDataUrl;
  return { ...input.extra, ...report };
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
   * Turn a failed response into a message for the reporter. Defaults to the
   * body's `error` or `message` field, then a generic one.
   */
  parseError?: (response: Response, body: unknown) => string | undefined;
};

export const DEFAULT_SEND_TIMEOUT_MS = 15_000;

export type SendResult = {
  /** The `id` field of the response body, when the server sends one. */
  id?: string;
  body: unknown;
  response: Response;
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
 */
export async function sendReport(
  endpoint: string,
  report: BugReport & Record<string, unknown>,
  options: SendOptions = {},
): Promise<SendResult> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: JSON.stringify(report),
  };
  if (options.credentials) init.credentials = options.credentials;

  const timeoutMs = options.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onOuterAbort);
  if (options.signal?.aborted) onOuterAbort();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort("timeout"), timeoutMs) : null;
  init.signal = controller.signal;

  let response: Response;
  let body: unknown;
  try {
    response = await doFetch(endpoint, init);
    body = await response.json().catch(() => null);
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason === "timeout") {
      throw new SendTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }

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
}
