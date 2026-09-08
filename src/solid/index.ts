/**
 * The report form for Solid: the same state machine as the React hook, exposed
 * as accessors.
 *
 * Every value is a function, the way Solid reads reactive state, so `state()`
 * in the JSX tracks it and nothing else has to. The subscription is torn down
 * with the owner the function was called in, which in a component is the
 * component itself; `destroy` is returned for the callers who have no owner.
 */

import { createSignal, onCleanup, type Accessor } from "solid-js";
import { REPORT_TYPES } from "../report-core.ts";
import {
  createReportState,
  statusText,
  type BugReportStatus,
  type ReportState,
  type UseBugReportOptions,
} from "../report-state.ts";

export type { BugReportStatus, UseBugReportOptions };
export { type ReportType, type ElementRef, REPORT_TYPES } from "../report-core.ts";
export { type ScreenshotRenderer } from "../capture.ts";

export function createBugReport(options: UseBugReportOptions) {
  const store = createReportState(options);
  // The machine replaces its state wholesale on every change, so the default
  // identity comparison is exactly right: a new object means something moved.
  const [state, setState] = createSignal<ReportState>(store.getState());
  const unsubscribe = store.subscribe(() => setState(store.getState()));
  const destroy = () => {
    unsubscribe();
    store.destroy();
  };
  // Solid warns when there is no owner; a form created outside one is the
  // caller's to clean up, and `destroy` is returned for that.
  onCleanup(destroy);

  const status: Accessor<BugReportStatus> = () => state().status;

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
