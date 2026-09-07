import { useEffect, useRef, useSyncExternalStore } from "react";
import { REPORT_TYPES } from "../report-core.ts";
import {
  createReportState,
  statusText,
  type BugReportStatus,
  type ReportStateStore,
  type UseBugReportOptions,
} from "../report-state.ts";

/**
 * Everything a report form needs, and none of its markup.
 *
 * The hook is headless on purpose. The chrome around a feedback form is exactly
 * the part that differs between applications — one has a toast layer, the next
 * announces inline; one has a Button component, the next has three. Shipping
 * opinionated markup means every consumer fights it. So this owns the state
 * machine, the capture, and the submit, and you render whatever fits.
 *
 * The machine itself lives in `../report-state.ts`, which knows nothing about
 * React; this file is the subscription and the render values. The Vue and
 * Svelte adapters are the same few lines against their own primitives.
 */

export type { BugReportStatus, UseBugReportOptions };

export function useBugReport(options: UseBugReportOptions) {
  // One store for the life of the form. Options are handed over on every
  // render, so a consumer passing inline callbacks or a fresh `extra` object
  // does not change the identity of `submit` and friends — they are the
  // store's own, and never change at all.
  const held = useRef<ReportStateStore | null>(null);
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
