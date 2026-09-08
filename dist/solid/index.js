/**
 * The report form for Solid: the same state machine as the React hook, exposed
 * as accessors.
 *
 * Every value is a function, the way Solid reads reactive state, so `state()`
 * in the JSX tracks it and nothing else has to. The subscription is torn down
 * with the owner the function was called in, which in a component is the
 * component itself; `destroy` is returned for the callers who have no owner.
 */
import { createSignal, onCleanup } from "solid-js";
import { REPORT_TYPES } from "../report-core.js";
import { createReportState, statusText, } from "../report-state.js";
export { REPORT_TYPES } from "../report-core.js";
export {} from "../capture.js";
export function createBugReport(options) {
    const store = createReportState(options);
    // The machine replaces its state wholesale on every change, so the default
    // identity comparison is exactly right: a new object means something moved.
    const [state, setState] = createSignal(store.getState());
    const unsubscribe = store.subscribe(() => setState(store.getState()));
    const destroy = () => {
        unsubscribe();
        store.destroy();
    };
    // Solid warns when there is no owner; a form created outside one is the
    // caller's to clean up, and `destroy` is returned for that.
    onCleanup(destroy);
    const status = () => state().status;
    return {
        types: REPORT_TYPES,
        type: () => state().type,
        message: () => state().message,
        /** Whether a renderer was supplied, so the form can hide the checkbox. */
        canScreenshot: () => state().canScreenshot,
        screenshot: () => state().screenshot,
        includeScreenshot: () => state().includeScreenshot,
        /** Elements the reporter has pointed at, in order. */
        elements: () => state().elements,
        status,
        /** Convenience flags, so the JSX does not have to match on the union. */
        isCapturing: () => status().kind === "capturing",
        isPicking: () => status().kind === "picking",
        isSending: () => status().kind === "sending",
        statusMessage: () => statusText(status(), options.messages),
        ...store.actions,
        /** Stops the subscription. Called for you when the owner is disposed. */
        destroy,
    };
}
//# sourceMappingURL=index.js.map