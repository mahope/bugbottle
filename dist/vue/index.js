/**
 * The report form for Vue: the same state machine as the React hook, exposed
 * as refs.
 *
 * `type` and `message` are writable computeds, so `v-model` works on them
 * directly; everything else is read-only and changes when the machine does.
 * The subscription is torn down with the effect scope the composable was
 * called in, which in a component is the component itself.
 */
import { computed, onScopeDispose, shallowRef } from "vue";
import { REPORT_TYPES } from "../report-core.js";
import { createReportState, statusText, } from "../report-state.js";
export { REPORT_TYPES } from "../report-core.js";
export {} from "../capture.js";
export function useBugReport(options) {
    const store = createReportState(options);
    const state = shallowRef(store.getState());
    const unsubscribe = store.subscribe(() => {
        state.value = store.getState();
    });
    const destroy = () => {
        unsubscribe();
        store.destroy();
    };
    // `true` asks Vue not to warn when there is no scope: a composable called
    // outside one is the caller's to clean up, and `destroy` is returned for it.
    onScopeDispose(destroy, true);
    const { setType, setMessage, ...rest } = store.actions;
    const status = computed(() => state.value.status);
    return {
        types: REPORT_TYPES,
        type: computed({ get: () => state.value.type, set: setType }),
        setType,
        message: computed({ get: () => state.value.message, set: setMessage }),
        setMessage,
        /** Whether a renderer was supplied, so the form can hide the checkbox. */
        canScreenshot: computed(() => state.value.canScreenshot),
        screenshot: computed(() => state.value.screenshot),
        includeScreenshot: computed(() => state.value.includeScreenshot),
        /** Elements the reporter has pointed at, in order. */
        elements: computed(() => state.value.elements),
        status,
        /** Convenience flags, so templates do not have to match on the union. */
        isCapturing: computed(() => status.value.kind === "capturing"),
        isPicking: computed(() => status.value.kind === "picking"),
        isSending: computed(() => status.value.kind === "sending"),
        statusMessage: computed(() => statusText(status.value, options.messages)),
        ...rest,
        /** Stops the subscription. Called for you when the effect scope ends. */
        destroy,
    };
}
//# sourceMappingURL=index.js.map