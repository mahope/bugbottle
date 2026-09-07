/**
 * The report path for the errors a React tree cannot recover from.
 *
 * A render error is the one bug the reporter can describe least and the
 * evidence describes best: there is no screen left to point at, but there is a
 * message, a stack and a component stack. `BugReportBoundary` catches it,
 * hands your fallback the error and a `report()` function, and sends whatever
 * `report()` is called with through the ordinary `sendReport`. It renders no
 * UI of its own — the fallback is yours, exactly as the hook's markup is.
 *
 * `createRootErrorHandlers` covers the rest: React 19 calls `onCaughtError` and
 * `onUncaughtError` on the root for everything a boundary caught and everything
 * it did not, and these send a report for each distinct one.
 *
 * There is no JSX in this file on purpose. The package ships plain TypeScript
 * through `tsc`, and one `.tsx` file would mean a JSX pipeline for a component
 * that renders nothing of its own anyway.
 */
import { Component } from "react";
import { fingerprint } from "../fingerprint.js";
import { buildReport, sendReport } from "../send.js";
/**
 * The message a render error becomes: what threw, where it threw, and which
 * components were mounted around it. Written for a human reading an issue, so
 * the three parts are separated rather than run together.
 */
export function describeRenderError(error, componentStack) {
    const head = error instanceof Error ? `${error.name}: ${error.message}` : `Render error: ${String(error)}`;
    const parts = [head];
    if (error instanceof Error && error.stack)
        parts.push(error.stack);
    if (componentStack)
        parts.push(`Component stack:\n${componentStack.trim()}`);
    return parts.join("\n\n");
}
/** Builds and sends one render error. Resolves with the id the server gave, if any. */
async function sendRenderError(options, error, componentStack) {
    const report = buildReport({
        type: "bug",
        message: describeRenderError(error, componentStack),
        extra: options.extra,
        scrub: options.scrub,
    });
    const { id } = await sendReport(options.endpoint, report, {
        headers: options.headers,
        credentials: options.credentials,
        timeoutMs: options.timeoutMs,
        parseError: options.parseError,
        fetch: options.fetch,
        beforeSend: options.beforeSend,
        sign: options.sign,
    });
    return id;
}
/**
 * Catches a render error and offers to report it.
 *
 * ```ts
 * createElement(BugReportBoundary, {
 *   endpoint: "/api/feedback",
 *   fallback: (error, report) =>
 *     createElement("button", { onClick: report }, "Tell us what happened"),
 * }, children);
 * ```
 *
 * Nothing is sent until `report()` is called: a report is a message from a
 * person, and sending one on their behalf without asking is telemetry.
 */
export class BugReportBoundary extends Component {
    state = { error: null, componentStack: null, sending: false };
    /**
     * The send that is in flight, or the one that succeeded. A fallback button is
     * a button a worried person clicks twice, and the render error behind it is
     * the same error every time: the second click must join the first send rather
     * than start a second POST of the same report. A failed send clears this, so
     * trying again is still possible; a successful one does not, so "sent" stays
     * sent.
     */
    inFlight = null;
    /** setState after unmount is a no-op React complains about. */
    mounted = true;
    static getDerivedStateFromError(error) {
        return { error: error instanceof Error ? error : new Error(String(error)) };
    }
    componentDidCatch(error, info) {
        this.setState({ componentStack: info.componentStack ?? null });
        this.props.onError?.(error);
    }
    componentWillUnmount() {
        this.mounted = false;
    }
    async send(error, componentStack) {
        try {
            const id = await sendRenderError(this.props, error, componentStack);
            this.props.onReport?.(error, id);
            return true;
        }
        catch (err) {
            // A failed send must not throw out of the fallback and take the rest of
            // the page with it: the tree is already one error down.
            this.props.onError?.(err);
            return false;
        }
    }
    report = () => {
        const { error, componentStack } = this.state;
        if (!error)
            return Promise.resolve(false);
        if (this.inFlight)
            return this.inFlight;
        const attempt = this.send(error, componentStack).then((ok) => {
            // A failure is worth another try, so the guard is lifted again. A success
            // is not: the report is filed, and the second click was the same click.
            if (!ok && this.inFlight === attempt)
                this.inFlight = null;
            if (this.mounted)
                this.setState({ sending: false });
            return ok;
        });
        this.inFlight = attempt;
        if (this.mounted)
            this.setState({ sending: true });
        return attempt;
    };
    render() {
        if (this.state.error)
            return this.props.fallback(this.state.error, this.report, this.state.sending);
        return this.props.children ?? null;
    }
}
/**
 * The React 19 root error handlers, wired to send a report for each distinct
 * error.
 *
 * ```ts
 * createRoot(node, createRootErrorHandlers({ endpoint: "/api/feedback" }));
 * ```
 *
 * Unlike the boundary this sends without asking, because there is nobody to
 * ask: these are the errors that reached the root. Say so in your privacy
 * notice, and pass `scrub` if the messages could carry anything personal.
 */
export function createRootErrorHandlers(options) {
    const dedupeMs = options.dedupeMs ?? 60_000;
    const seen = new Map();
    const handle = (error, info) => {
        const componentStack = info?.componentStack ?? null;
        const message = describeRenderError(error, componentStack);
        if (dedupeMs > 0) {
            const now = Date.now();
            const key = fingerprint({ type: "bug", message });
            for (const [seenKey, at] of seen)
                if (at + dedupeMs <= now)
                    seen.delete(seenKey);
            const last = seen.get(key);
            if (last !== undefined && last + dedupeMs > now)
                return;
            seen.set(key, now);
        }
        void sendRenderError(options, error, componentStack)
            .then((id) => options.onReport?.(error, id))
            .catch((err) => options.onError?.(err));
    };
    return { onCaughtError: handle, onUncaughtError: handle };
}
//# sourceMappingURL=boundary.js.map