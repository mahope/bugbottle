import { useCallback, useRef, useState } from "react";
import { captureScreenshot, collectContext, ScreenshotTooLargeError } from "../capture.ts";
import { getConsoleBuffer } from "../console-buffer.ts";
import { REPORT_TYPES, type ReportType } from "../report-core.ts";

/**
 * Everything a report form needs, and none of its markup.
 *
 * The hook is headless on purpose. The chrome around a feedback form is exactly
 * the part that differs between applications — one has a toast layer, the next
 * announces inline; one has a Button component, the next has three. Shipping
 * opinionated markup means every consumer fights it. So this owns the state
 * machine, the capture, and the submit, and you render whatever fits.
 */

export type BugReportStatus =
  | { kind: "idle" }
  | { kind: "capturing" }
  | { kind: "sending" }
  | { kind: "sent"; id?: string }
  | { kind: "error"; reason: "empty" | "screenshot-too-large" | "screenshot-failed" | "send-failed"; message: string };

export type UseBugReportOptions = {
  /** Endpoint that receives the report. Required. */
  endpoint: string;
  /** Type selected when the form opens. Defaults to "bug". */
  initialType?: ReportType;
  /**
   * Whether to arm the screenshot for this type. Defaults to arming it for
   * bugs only, where the picture nearly always helps.
   */
  screenshotFor?: (type: ReportType) => boolean;
  /** Attach the recorded console errors for this type. Defaults to bugs only. */
  consoleFor?: (type: ReportType) => boolean;
  /** Extra fields to send alongside the report. */
  extra?: Record<string, unknown>;
  /** Called after a successful submit. */
  onSent?: (id: string | undefined) => void;
  /** Turn a failed response into a message. Defaults to the body's `error`/`message`. */
  parseError?: (response: Response, body: unknown) => string;
  /** Messages shown to the reporter. Supply translated strings here. */
  messages?: Partial<Record<
    "empty" | "screenshotTooLarge" | "screenshotFailed" | "sendFailed" | "sent",
    string
  >>;
};

const FALLBACK_MESSAGES = {
  empty: "Write a message first",
  screenshotTooLarge: "The picture is too large — sending without it",
  screenshotFailed: "The picture could not be taken — you can still send without it",
  sendFailed: "The report could not be sent",
  sent: "Thank you — the report is on its way",
} as const;

/** How long to wait for the endpoint before giving the reporter an error. */
const SEND_TIMEOUT_MS = 15_000;

export function useBugReport(options: UseBugReportOptions) {
  const {
    endpoint,
    initialType = "bug",
    screenshotFor = (t: ReportType) => t === "bug",
    consoleFor = (t: ReportType) => t === "bug",
  } = options;
  const msg = { ...FALLBACK_MESSAGES, ...options.messages };

  const [type, setTypeState] = useState<ReportType>(initialType);
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [includeScreenshot, setIncludeScreenshot] = useState(screenshotFor(initialType));
  const [status, setStatus] = useState<BugReportStatus>({ kind: "idle" });
  const capturing = useRef(false);

  const capture = useCallback(async () => {
    if (capturing.current) return;
    capturing.current = true;
    setStatus({ kind: "capturing" });
    try {
      setScreenshot(await captureScreenshot());
      setStatus({ kind: "idle" });
    } catch (err) {
      // A failed picture must never block the report, so this only turns the
      // attachment off and says why.
      setIncludeScreenshot(false);
      setStatus({
        kind: "error",
        reason: err instanceof ScreenshotTooLargeError ? "screenshot-too-large" : "screenshot-failed",
        message:
          err instanceof ScreenshotTooLargeError ? msg.screenshotTooLarge : msg.screenshotFailed,
      });
    } finally {
      capturing.current = false;
    }
  }, [msg.screenshotFailed, msg.screenshotTooLarge]);

  /** Call when the form opens, so the picture shows what they were looking at. */
  const open = useCallback(() => {
    setStatus({ kind: "idle" });
    if (screenshotFor(type) && includeScreenshot && !screenshot) void capture();
  }, [capture, includeScreenshot, screenshot, screenshotFor, type]);

  const setType = useCallback(
    (next: ReportType) => {
      setTypeState(next);
      if (screenshotFor(next) && !screenshot) {
        setIncludeScreenshot(true);
        void capture();
      }
    },
    [capture, screenshot, screenshotFor],
  );

  const toggleScreenshot = useCallback(
    (checked: boolean) => {
      setIncludeScreenshot(checked);
      if (checked && !screenshot) void capture();
      if (!checked) setScreenshot(null);
    },
    [capture, screenshot],
  );

  const submit = useCallback(async () => {
    if (!message.trim()) {
      setStatus({ kind: "error", reason: "empty", message: msg.empty });
      return false;
    }
    setStatus({ kind: "sending" });
    try {
      // A hung request must not leave the form stuck on "sending" forever: the
      // reporter closes the tab and the report is lost. Abort after a bounded
      // wait and say so, so they can retry instead of assuming it went through.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...options.extra,
            type,
            message: message.trim(),
            screenshotDataUrl: includeScreenshot && screenshot ? screenshot : undefined,
            console: consoleFor(type) ? getConsoleBuffer() : undefined,
            context: collectContext(),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const parsed = options.parseError?.(res, body);
        const fromBody = (body as { error?: string; message?: string } | null) ?? null;
        throw new Error(parsed || fromBody?.error || fromBody?.message || msg.sendFailed);
      }
      const id = (body as { id?: string } | null)?.id;
      setStatus({ kind: "sent", id });
      setMessage("");
      setScreenshot(null);
      setIncludeScreenshot(screenshotFor(type));
      options.onSent?.(id);
      return true;
    } catch (err) {
      setStatus({
        kind: "error",
        reason: "send-failed",
        message: err instanceof Error ? err.message : msg.sendFailed,
      });
      return false;
    }
  }, [
    consoleFor,
    endpoint,
    includeScreenshot,
    message,
    msg.empty,
    msg.sendFailed,
    options,
    screenshot,
    screenshotFor,
    type,
  ]);

  return {
    types: REPORT_TYPES,
    type,
    setType,
    message,
    setMessage,
    screenshot,
    includeScreenshot,
    toggleScreenshot,
    recapture: capture,
    open,
    submit,
    status,
    /** Convenience flags, so consumers do not have to match on the union. */
    isCapturing: status.kind === "capturing",
    isSending: status.kind === "sending",
    statusMessage:
      status.kind === "error" ? status.message : status.kind === "sent" ? msg.sent : "",
  };
}
