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

import type { Readable } from "svelte/store";
import { REPORT_TYPES, type ReportType } from "../report-core.ts";
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

/** What `$form` holds: the state, plus the values a template would derive. */
export type BugReportView = ReportState & {
  types: readonly ReportType[];
  isCapturing: boolean;
  isPicking: boolean;
  isSending: boolean;
  statusMessage: string;
};

export function createBugReport(options: UseBugReportOptions) {
  const store = createReportState(options);

  const view = (): BugReportView => {
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
  const subscribe: Readable<BugReportView>["subscribe"] = (run) => {
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
