/**
 * The report form for Svelte: the same state machine as the React hook,
 * exposed as a readable store plus the actions.
 *
 * `const form = createBugReport({ endpoint })` and then `$form.message` in the
 * markup, `form.setMessage(...)` in the handlers. The store contract is
 * implemented here rather than imported from `svelte/store` — it is one
 * function, and this way the adapter has no runtime dependency on Svelte at
 * all, only a type.
 */
import { REPORT_TYPES } from "../report-core.js";
import { createReportState, statusText, } from "../report-state.js";
export { REPORT_TYPES } from "../report-core.js";
export {} from "../capture.js";
export function createBugReport(options) {
    const store = createReportState(options);
    const view = () => {
        const state = store.getState();
        return {
            ...state,
            types: REPORT_TYPES,
            isCapturing: state.status.kind === "capturing",
            isPicking: state.status.kind === "picking",
            isSending: state.status.kind === "sending",
            statusMessage: statusText(state.status, options.messages),
        };
    };
    // A Svelte store hands the subscriber the current value first, then every
    // later one; unsubscribing is the returned function.
    const subscribe = (run) => {
        run(view());
        return store.subscribe(() => run(view()));
    };
    return {
        subscribe,
        types: REPORT_TYPES,
        ...store.actions,
        /** Aborts a pick in progress. Call from `onDestroy` if the form can unmount mid-pick. */
        destroy: store.destroy,
    };
}
//# sourceMappingURL=index.js.map