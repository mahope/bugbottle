import { useCallback, useEffect, useRef, useState } from "react";
import { captureScreenshot, ScreenshotTooLargeError } from "../capture.js";
import { pickElement as pickElementFromPage } from "../element-picker.js";
import { MAX_ELEMENTS, REPORT_TYPES } from "../report-core.js";
import { buildReport, sendReport } from "../send.js";
import { enMessages } from "../locales.js";
const FALLBACK_MESSAGES = enMessages;
const bugsOnly = (t) => t === "bug";
export function useBugReport(options) {
    const { endpoint, screenshot: render, initialType = "bug", screenshotFor = bugsOnly, consoleFor = bugsOnly, } = options;
    const msg = { ...FALLBACK_MESSAGES, ...options.messages };
    const canScreenshot = render !== undefined;
    // Options are read through a ref at call time, so a consumer passing inline
    // callbacks or a fresh `extra` object each render does not change the
    // identity of `submit` and friends.
    const latest = useRef(options);
    latest.current = options;
    const [type, setTypeState] = useState(initialType);
    const [message, setMessage] = useState("");
    const [screenshot, setScreenshot] = useState(null);
    const [includeScreenshot, setIncludeScreenshot] = useState(canScreenshot && screenshotFor(initialType));
    const [elements, setElements] = useState([]);
    const [status, setStatus] = useState({ kind: "idle" });
    const capturing = useRef(false);
    const picking = useRef(null);
    // A pick installs capture-phase listeners on the document that swallow
    // clicks. If the form unmounts mid-pick — a modal closed, a route change —
    // they must go with it, or every click on the page is eaten until Escape.
    useEffect(() => () => picking.current?.abort(), []);
    const capture = useCallback(async () => {
        const renderer = latest.current.screenshot;
        if (!renderer || capturing.current)
            return;
        capturing.current = true;
        setStatus({ kind: "capturing" });
        try {
            setScreenshot(await captureScreenshot(renderer));
            setStatus({ kind: "idle" });
        }
        catch (err) {
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
        }
        finally {
            capturing.current = false;
        }
    }, []);
    /** Call when the form opens, so the picture shows what they were looking at. */
    const open = useCallback(() => {
        setStatus({ kind: "idle" });
        if (canScreenshot && screenshotFor(type) && includeScreenshot && !screenshot)
            void capture();
    }, [canScreenshot, capture, includeScreenshot, screenshot, screenshotFor, type]);
    const setType = useCallback((next) => {
        setTypeState(next);
        if (canScreenshot && screenshotFor(next) && !screenshot) {
            setIncludeScreenshot(true);
            void capture();
        }
    }, [canScreenshot, capture, screenshot, screenshotFor]);
    const toggleScreenshot = useCallback((checked) => {
        if (!canScreenshot)
            return;
        setIncludeScreenshot(checked);
        if (checked && !screenshot)
            void capture();
        if (!checked)
            setScreenshot(null);
    }, [canScreenshot, capture, screenshot]);
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
            if (picked)
                setElements((prev) => [...prev, picked].slice(-MAX_ELEMENTS));
            return picked;
        }
        finally {
            if (picking.current === controller) {
                picking.current = null;
                setStatus((s) => (s.kind === "picking" ? { kind: "idle" } : s));
            }
        }
    }, []);
    const cancelPick = useCallback(() => picking.current?.abort(), []);
    const removeElement = useCallback((index) => {
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
                timeoutMs: opts.timeoutMs,
                parseError: opts.parseError,
            });
            setStatus({ kind: "sent", id });
            setMessage("");
            setScreenshot(null);
            setElements([]);
            setIncludeScreenshot(canScreenshot && screenshotFor(type));
            opts.onSent?.(id);
            return true;
        }
        catch (err) {
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
        statusMessage: status.kind === "error" ? status.message : status.kind === "sent" ? msg.sent : "",
    };
}
//# sourceMappingURL=use-bug-report.js.map