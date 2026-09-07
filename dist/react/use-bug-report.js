import { useEffect, useRef, useSyncExternalStore } from "react";
import { REPORT_TYPES } from "../report-core.js";
import { createReportState, statusText, } from "../report-state.js";
export function useBugReport(options) {
    // One store for the life of the form. Options are handed over on every
    // render, so a consumer passing inline callbacks or a fresh `extra` object
    // does not change the identity of `submit` and friends — they are the
    // store's own, and never change at all.
    const held = useRef(null);
    held.current ??= createReportState(options);
    const store = held.current;
    store.setOptions(options);
    const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
    useEffect(() => store.destroy, [store]);
    return {
        types: REPORT_TYPES,
        // The state and the actions are already named the way a form wants them —
        // `message`, `setMessage`, `submit` — so they are spread rather than
        // relisted, and the two objects cannot drift out of step with this one.
        ...state,
        ...store.actions,
        /** Convenience flags, so consumers do not have to match on the union. */
        isCapturing: state.status.kind === "capturing",
        isPicking: state.status.kind === "picking",
        isSending: state.status.kind === "sending",
        statusMessage: statusText(state.status, options.messages),
    };
}
//# sourceMappingURL=use-bug-report.js.map