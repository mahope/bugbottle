/**
 * The report form as a state machine, with no framework in it.
 *
 * Every adapter — the React hook, the Vue composable, the Svelte store — is a
 * few lines of binding over this: `getState` for the current values,
 * `subscribe` for the changes, `actions` for everything the reporter can do.
 * Keeping the machine here means the three of them cannot drift apart, and
 * that a framework we have not written an adapter for is still one `subscribe`
 * away from a working form.
 *
 * The store owns its options rather than closing over them, so an adapter that
 * re-renders with fresh callbacks (React does, on every render) can hand the
 * new ones over with `setOptions` without disturbing the state.
 */
import { captureScreenshot, ScreenshotTooLargeError, } from "./capture.js";
import { pickElement as pickElementFromPage } from "./element-picker.js";
import { MAX_ELEMENTS } from "./report-core.js";
import { buildReport, sendReport, SendFailedError, } from "./send.js";
import { enMessages } from "./locales.js";
const FALLBACK_MESSAGES = enMessages;
const bugsOnly = (t) => t === "bug";
/**
 * The one line of the form that is not in the state: a sent or queued report
 * is announced with the reporter's own language, and an error carries the
 * message it failed with.
 */
export function statusText(status, messages) {
    if (status.kind === "error")
        return status.message;
    if (status.kind !== "sent" && status.kind !== "queued")
        return "";
    const msg = { ...FALLBACK_MESSAGES, ...messages };
    return status.kind === "sent" ? msg.sent : msg.queued;
}
export function createReportState(options) {
    let opts = options;
    const messages = () => ({ ...FALLBACK_MESSAGES, ...opts.messages });
    const canShoot = () => opts.screenshot !== undefined;
    const armedFor = (t) => (opts.screenshotFor ?? bugsOnly)(t);
    const firstType = () => opts.initialType ?? "bug";
    let state = {
        type: firstType(),
        message: "",
        contact: "",
        screenshot: null,
        includeScreenshot: canShoot() && armedFor(firstType()),
        canScreenshot: canShoot(),
        elements: [],
        status: { kind: "idle" },
    };
    const listeners = new Set();
    const set = (patch) => {
        state = { ...state, ...patch };
        for (const listener of listeners)
            listener();
    };
    let capturing = false;
    let picking = null;
    const capture = async () => {
        const renderer = opts.screenshot;
        if (!renderer || capturing)
            return;
        capturing = true;
        set({ status: { kind: "capturing" } });
        try {
            const dataUrl = await captureScreenshot(renderer, { mask: opts.mask });
            set({ screenshot: dataUrl, status: { kind: "idle" } });
        }
        catch (err) {
            // A failed picture must never block the report, so this only turns the
            // attachment off and says why.
            const tooLarge = err instanceof ScreenshotTooLargeError;
            const m = messages();
            set({
                includeScreenshot: false,
                status: {
                    kind: "error",
                    reason: tooLarge ? "screenshot-too-large" : "screenshot-failed",
                    message: tooLarge ? m.screenshotTooLarge : m.screenshotFailed,
                },
            });
        }
        finally {
            capturing = false;
        }
    };
    const actions = {
        setType(next) {
            set({ type: next });
            if (canShoot() && armedFor(next) && !state.screenshot) {
                set({ includeScreenshot: true });
                void capture();
            }
        },
        setMessage(next) {
            set({ message: next });
        },
        setContact(next) {
            set({ contact: next });
        },
        toggleScreenshot(checked) {
            if (!canShoot())
                return;
            set({ includeScreenshot: checked });
            if (checked && !state.screenshot)
                void capture();
            if (!checked)
                set({ screenshot: null });
        },
        recapture: capture,
        /**
         * Lets the reporter click the element the report is about. Resolves when
         * they have clicked or pressed Escape. Calling it again while picking
         * cancels the first pick. Up to `MAX_ELEMENTS` can be attached.
         */
        async pickElement() {
            picking?.abort();
            const controller = new AbortController();
            picking = controller;
            set({ status: { kind: "picking" } });
            try {
                const picked = await pickElementFromPage({ signal: controller.signal });
                if (picked)
                    set({ elements: [...state.elements, picked].slice(-MAX_ELEMENTS) });
                return picked;
            }
            finally {
                if (picking === controller) {
                    picking = null;
                    if (state.status.kind === "picking")
                        set({ status: { kind: "idle" } });
                }
            }
        },
        cancelPick() {
            picking?.abort();
        },
        removeElement(index) {
            set({ elements: state.elements.filter((_, i) => i !== index) });
        },
        /** Call when the form opens, so the picture shows what they were looking at. */
        open() {
            set({ status: { kind: "idle" } });
            if (canShoot() && armedFor(state.type) && state.includeScreenshot && !state.screenshot) {
                void capture();
            }
        },
        /** Clears the form and any status, ready for a new report. */
        reset() {
            picking?.abort();
            const type = firstType();
            set({
                type,
                message: "",
                contact: "",
                screenshot: null,
                elements: [],
                includeScreenshot: canShoot() && armedFor(type),
                status: { kind: "idle" },
            });
        },
        async submit() {
            const m = messages();
            if (!state.message.trim()) {
                set({ status: { kind: "error", reason: "empty", message: m.empty } });
                return false;
            }
            set({ status: { kind: "sending" } });
            // A report that is on its way — or safely queued — leaves an empty form
            // behind, so the next one does not start with the last one still in it.
            const clearForm = () => set({
                message: "",
                contact: "",
                screenshot: null,
                elements: [],
                includeScreenshot: canShoot() && armedFor(state.type),
            });
            // Kept outside the try so the failure path can hand the very same body to
            // the queue rather than assembling a second one from stale state.
            let report = null;
            try {
                report = buildReport({
                    type: state.type,
                    message: state.message,
                    contact: state.contact,
                    screenshotDataUrl: state.includeScreenshot ? state.screenshot : null,
                    includeConsole: (opts.consoleFor ?? bugsOnly)(state.type),
                    elements: state.elements,
                    extra: opts.extra,
                    scrub: opts.scrub,
                });
                const { id } = await sendReport(opts.endpoint, report, {
                    headers: opts.headers,
                    credentials: opts.credentials,
                    timeoutMs: opts.timeoutMs,
                    parseError: opts.parseError,
                    beforeSend: opts.beforeSend,
                    sign: opts.sign,
                });
                set({ status: { kind: "sent", id } });
                clearForm();
                opts.onSent?.(id);
                return true;
            }
            catch (err) {
                const queue = opts.queue;
                const rejected = err instanceof SendFailedError && err.status >= 400 && err.status < 500;
                if (queue && report && !rejected) {
                    queue.enqueue(report);
                    set({ status: { kind: "queued" } });
                    clearForm();
                    return true;
                }
                set({
                    status: {
                        kind: "error",
                        reason: "send-failed",
                        message: err instanceof Error && err.message ? err.message : m.sendFailed,
                    },
                });
                return false;
            }
        },
    };
    return {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
        actions,
        setOptions(next) {
            opts = next;
            // The only option that is also state: a form handed a renderer it did
            // not have before can show its checkbox without waiting for a change.
            if (canShoot() !== state.canScreenshot)
                set({ canScreenshot: canShoot() });
        },
        // A pick installs capture-phase listeners on the document that swallow
        // clicks. If the form goes away mid-pick — a modal closed, a route change —
        // they must go with it, or every click on the page is eaten until Escape.
        destroy() {
            picking?.abort();
        },
    };
}
//# sourceMappingURL=report-state.js.map