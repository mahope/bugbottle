import { useCallback, useRef, useState } from "react";
import { captureScreenshot, collectContext, ScreenshotTooLargeError } from "../capture.js";
import { getConsoleBuffer } from "../console-buffer.js";
import { REPORT_TYPES } from "../report-core.js";
const FALLBACK_MESSAGES = {
    empty: "Write a message first",
    screenshotTooLarge: "The picture is too large — sending without it",
    screenshotFailed: "The picture could not be taken — you can still send without it",
    sendFailed: "The report could not be sent",
    sent: "Thank you — the report is on its way",
};
/** How long to wait for the endpoint before giving the reporter an error. */
const SEND_TIMEOUT_MS = 15_000;
export function useBugReport(options) {
    const { endpoint, initialType = "bug", screenshotFor = (t) => t === "bug", consoleFor = (t) => t === "bug", } = options;
    const msg = { ...FALLBACK_MESSAGES, ...options.messages };
    const [type, setTypeState] = useState(initialType);
    const [message, setMessage] = useState("");
    const [screenshot, setScreenshot] = useState(null);
    const [includeScreenshot, setIncludeScreenshot] = useState(screenshotFor(initialType));
    const [status, setStatus] = useState({ kind: "idle" });
    const capturing = useRef(false);
    const capture = useCallback(async () => {
        if (capturing.current)
            return;
        capturing.current = true;
        setStatus({ kind: "capturing" });
        try {
            setScreenshot(await captureScreenshot());
            setStatus({ kind: "idle" });
        }
        catch (err) {
            // A failed picture must never block the report, so this only turns the
            // attachment off and says why.
            setIncludeScreenshot(false);
            setStatus({
                kind: "error",
                reason: err instanceof ScreenshotTooLargeError ? "screenshot-too-large" : "screenshot-failed",
                message: err instanceof ScreenshotTooLargeError ? msg.screenshotTooLarge : msg.screenshotFailed,
            });
        }
        finally {
            capturing.current = false;
        }
    }, [msg.screenshotFailed, msg.screenshotTooLarge]);
    /** Call when the form opens, so the picture shows what they were looking at. */
    const open = useCallback(() => {
        setStatus({ kind: "idle" });
        if (screenshotFor(type) && includeScreenshot && !screenshot)
            void capture();
    }, [capture, includeScreenshot, screenshot, screenshotFor, type]);
    const setType = useCallback((next) => {
        setTypeState(next);
        if (screenshotFor(next) && !screenshot) {
            setIncludeScreenshot(true);
            void capture();
        }
    }, [capture, screenshot, screenshotFor]);
    const toggleScreenshot = useCallback((checked) => {
        setIncludeScreenshot(checked);
        if (checked && !screenshot)
            void capture();
        if (!checked)
            setScreenshot(null);
    }, [capture, screenshot]);
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
            let res;
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
            }
            finally {
                clearTimeout(timer);
            }
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                const parsed = options.parseError?.(res, body);
                const fromBody = body ?? null;
                throw new Error(parsed || fromBody?.error || fromBody?.message || msg.sendFailed);
            }
            const id = body?.id;
            setStatus({ kind: "sent", id });
            setMessage("");
            setScreenshot(null);
            setIncludeScreenshot(screenshotFor(type));
            options.onSent?.(id);
            return true;
        }
        catch (err) {
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
        statusMessage: status.kind === "error" ? status.message : status.kind === "sent" ? msg.sent : "",
    };
}
//# sourceMappingURL=use-bug-report.js.map