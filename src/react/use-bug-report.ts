import { useCallback, useEffect, useRef, useState } from "react";
import { captureScreenshot, ScreenshotTooLargeError, type ScreenshotRenderer } from "../capture.ts";
import { pickElement as pickElementFromPage } from "../element-picker.ts";
import { MAX_ELEMENTS, REPORT_TYPES, type ElementRef, type ReportType } from "../report-core.ts";
import { buildReport, sendReport, type SendOptions } from "../send.ts";

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
  | { kind: "picking" }
  | { kind: "sending" }
  | { kind: "sent"; id?: string }
  | {
      kind: "error";
      reason: "empty" | "screenshot-too-large" | "screenshot-failed" | "send-failed";
      message: string;
    };

export type UseBugReportOptions = {
  /** Endpoint that receives the report. Required. */
  endpoint: string;
  /**
   * How to take the picture. Without it, screenshots are off and
   * `canScreenshot` is false. `import { htmlToImage } from "bugbottle/html-to-image"`
   * is the ready-made one.
   */
  screenshot?: ScreenshotRenderer;
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
  /** Extra request headers — an auth token, a CSRF header. */
  headers?: SendOptions["headers"];
  /** Passed to `fetch`. Set to `"include"` for a cross-origin endpoint that needs cookies. */
  credentials?: SendOptions["credentials"];
  /** Called after a successful submit. */
  onSent?: (id: string | undefined) => void;
  /** Turn a failed response into a message. Defaults to the body's `error`/`message`. */
  parseError?: SendOptions["parseError"];
  /** Messages shown to the reporter. Supply translated strings here. */
  messages?: Partial<
    Record<"empty" | "screenshotTooLarge" | "screenshotFailed" | "sendFailed" | "sent", string>
  >;
};

const FALLBACK_MESSAGES = {
  empty: "Write a message first",
  screenshotTooLarge: "The picture is too large — sending without it",
  screenshotFailed: "The picture could not be taken — you can still send without it",
  sendFailed: "The report could not be sent",
  sent: "Thank you — the report is on its way",
} as const;

const bugsOnly = (t: ReportType) => t === "bug";

export function useBugReport(options: UseBugReportOptions) {
  const {
    endpoint,
    screenshot: render,
    initialType = "bug",
    screenshotFor = bugsOnly,
    consoleFor = bugsOnly,
  } = options;
  const msg = { ...FALLBACK_MESSAGES, ...options.messages };
  const canScreenshot = render !== undefined;

  // Options are read through a ref at call time, so a consumer passing inline
  // callbacks or a fresh `extra` object each render does not change the
  // identity of `submit` and friends.
  const latest = useRef(options);
  latest.current = options;

  const [type, setTypeState] = useState<ReportType>(initialType);
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [includeScreenshot, setIncludeScreenshot] = useState(
    canScreenshot && screenshotFor(initialType),
  );
  const [elements, setElements] = useState<ElementRef[]>([]);
  const [status, setStatus] = useState<BugReportStatus>({ kind: "idle" });
  const capturing = useRef(false);
  const picking = useRef<AbortController | null>(null);

  // A pick installs capture-phase listeners on the document that swallow
  // clicks. If the form unmounts mid-pick — a modal closed, a route change —
  // they must go with it, or every click on the page is eaten until Escape.
  useEffect(() => () => picking.current?.abort(), []);

  const capture = useCallback(async () => {
    const renderer = latest.current.screenshot;
    if (!renderer || capturing.current) return;
    capturing.current = true;
    setStatus({ kind: "capturing" });
    try {
      setScreenshot(await captureScreenshot(renderer));
      setStatus({ kind: "idle" });
    } catch (err) {
      // A failed picture must never block the report, so this only turns the
      // attachment off and says why.
      const tooLarge = err instanceof ScreenshotTooLargeError;
      const m = { ...FALLBACK_MESSAGES, ...latest.current.messages };
      setIncludeScreenshot(false);
      setStatus({
        kind: "error",
        reason: tooLarge ? "screenshot-too-large" : "screenshot-failed",
        message: tooLarge ? m.screenshotTooLarge : m.screenshotFailed,
      });
    } finally {
      capturing.current = false;
    }
  }, []);

  /** Call when the form opens, so the picture shows what they were looking at. */
  const open = useCallback(() => {
    setStatus({ kind: "idle" });
    if (canScreenshot && screenshotFor(type) && includeScreenshot && !screenshot) void capture();
  }, [canScreenshot, capture, includeScreenshot, screenshot, screenshotFor, type]);

  const setType = useCallback(
    (next: ReportType) => {
      setTypeState(next);
      if (canScreenshot && screenshotFor(next) && !screenshot) {
        setIncludeScreenshot(true);
        void capture();
      }
    },
    [canScreenshot, capture, screenshot, screenshotFor],
  );

  const toggleScreenshot = useCallback(
    (checked: boolean) => {
      if (!canScreenshot) return;
      setIncludeScreenshot(checked);
      if (checked && !screenshot) void capture();
      if (!checked) setScreenshot(null);
    },
    [canScreenshot, capture, screenshot],
  );

  /**
   * Lets the reporter click the element the report is about. Resolves when
   * they have clicked or pressed Escape. Calling it again while picking
   * cancels the first pick. Up to `MAX_ELEMENTS` can be attached.
   */
  const pickElement = useCallback(async () => {
    picking.current?.abort();
    const controller = new AbortController();
    picking.current = controller;
    setStatus({ kind: "picking" });
    try {
      const picked = await pickElementFromPage({ signal: controller.signal });
      if (picked) setElements((prev) => [...prev, picked].slice(-MAX_ELEMENTS));
      return picked;
    } finally {
      if (picking.current === controller) {
        picking.current = null;
        setStatus((s) => (s.kind === "picking" ? { kind: "idle" } : s));
      }
    }
  }, []);

  const cancelPick = useCallback(() => picking.current?.abort(), []);

  const removeElement = useCallback((index: number) => {
    setElements((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** Clears the form and any status, ready for a new report. */
  const reset = useCallback(() => {
    picking.current?.abort();
    setTypeState(initialType);
    setMessage("");
    setScreenshot(null);
    setElements([]);
    setIncludeScreenshot(canScreenshot && screenshotFor(initialType));
    setStatus({ kind: "idle" });
  }, [canScreenshot, initialType, screenshotFor]);

  const submit = useCallback(async () => {
    const opts = latest.current;
    const m = { ...FALLBACK_MESSAGES, ...opts.messages };
    if (!message.trim()) {
      setStatus({ kind: "error", reason: "empty", message: m.empty });
      return false;
    }
    setStatus({ kind: "sending" });
    try {
      const report = buildReport({
        type,
        message,
        screenshotDataUrl: includeScreenshot ? screenshot : null,
        includeConsole: consoleFor(type),
        elements,
        extra: opts.extra,
      });
      const { id } = await sendReport(endpoint, report, {
        headers: opts.headers,
        credentials: opts.credentials,
        parseError: opts.parseError,
      });
      setStatus({ kind: "sent", id });
      setMessage("");
      setScreenshot(null);
      setElements([]);
      setIncludeScreenshot(canScreenshot && screenshotFor(type));
      opts.onSent?.(id);
      return true;
    } catch (err) {
      setStatus({
        kind: "error",
        reason: "send-failed",
        message: err instanceof Error && err.message ? err.message : m.sendFailed,
      });
      return false;
    }
  }, [
    canScreenshot,
    consoleFor,
    elements,
    endpoint,
    includeScreenshot,
    message,
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
    /** Whether a renderer was supplied, so the form can hide the checkbox. */
    canScreenshot,
    screenshot,
    includeScreenshot,
    toggleScreenshot,
    recapture: capture,
    /** Elements the reporter has pointed at, in order. */
    elements,
    pickElement,
    cancelPick,
    removeElement,
    open,
    submit,
    reset,
    status,
    /** Convenience flags, so consumers do not have to match on the union. */
    isCapturing: status.kind === "capturing",
    isPicking: status.kind === "picking",
    isSending: status.kind === "sending",
    statusMessage:
      status.kind === "error" ? status.message : status.kind === "sent" ? msg.sent : "",
  };
}
