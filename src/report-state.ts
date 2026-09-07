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

import {
  captureScreenshot,
  ScreenshotTooLargeError,
  type CaptureOptions,
  type ScreenshotRenderer,
} from "./capture.ts";
import { pickElement as pickElementFromPage } from "./element-picker.ts";
import { MAX_ELEMENTS, type ElementRef, type ReportType } from "./report-core.ts";
import {
  buildReport,
  sendReport,
  SendFailedError,
  type BuildReportInput,
  type SendOptions,
} from "./send.ts";
import type { Queue } from "./queue.ts";
import type { BugReport } from "./report-core.ts";
import { enMessages, type Messages } from "./locales.ts";

export type BugReportStatus =
  | { kind: "idle" }
  | { kind: "capturing" }
  | { kind: "picking" }
  | { kind: "sending" }
  | { kind: "sent"; id?: string }
  | { kind: "queued" }
  | {
      kind: "error";
      reason: "empty" | "screenshot-too-large" | "screenshot-failed" | "send-failed";
      message: string;
    };

export type UseBugReportOptions = {
  /** Endpoint that receives the report. Required. */
  endpoint: string;
  /**
   * How to take the picture. Without it, screenshots are off and
   * `canScreenshot` is false. `import { htmlToImage } from "bugbottle/html-to-image"`
   * is the ready-made one.
   */
  screenshot?: ScreenshotRenderer;
  /** Type selected when the form opens. Defaults to "bug". */
  initialType?: ReportType;
  /**
   * Whether to arm the screenshot for this type. Defaults to arming it for
   * bugs only, where the picture nearly always helps.
   */
  screenshotFor?: (type: ReportType) => boolean;
  /** Attach the recorded console errors for this type. Defaults to bugs only. */
  consoleFor?: (type: ReportType) => boolean;
  /**
   * What to hide in the screenshot. Field values, `contenteditable` text and
   * the `data-bugbottle-mask` / `data-bugbottle-block` regions are masked by
   * default; pass an object to narrow it, or `false` to photograph the page as
   * the reporter sees it. See `CaptureOptions["mask"]`.
   */
  mask?: CaptureOptions["mask"];
  /** Extra fields to send alongside the report. */
  extra?: Record<string, unknown>;
  /** Extra request headers — an auth token, a CSRF header. */
  headers?: SendOptions["headers"];
  /** Passed to `fetch`. Set to `"include"` for a cross-origin endpoint that needs cookies. */
  credentials?: SendOptions["credentials"];
  /** Give up on the endpoint after this long. Default 15 000 ms. */
  timeoutMs?: SendOptions["timeoutMs"];
  /** Called after a successful submit. */
  onSent?: (id: string | undefined) => void;
  /** Turn a failed response into a message. Defaults to the body's `error`/`message`. */
  parseError?: SendOptions["parseError"];
  /**
   * Redact the assembled report before it is sent. Pass the scrubber:
   * `import { scrubReport } from "bugbottle"; scrub: scrubReport`.
   */
  scrub?: BuildReportInput["scrub"];
  /**
   * Last look at the report. Return it, a changed copy, or `null` to drop it.
   * A dropped report still shows the reporter the ordinary thank-you: they
   * wrote it in good faith, and telling them it was discarded helps nobody.
   */
  beforeSend?: SendOptions["beforeSend"];
  /**
   * Signs the body before it is sent. Pass the signer:
   * `import { createSigner } from "bugbottle/sign"; sign: createSigner({ key })`.
   * A key in the browser is public, so this deters spam rather than
   * authenticating anybody. See the README.
   */
  sign?: SendOptions["sign"];
  /**
   * Messages shown to the reporter. Pass a bundled locale
   * (`import { da } from "bugbottle/locales"; messages: da.messages`) or
   * your own strings. Defaults to English.
   */
  messages?: Partial<Messages>;
  /**
   * Where a report goes when the send fails. Pass a queue from
   * `bugbottle/queue` and a report written during an outage is kept and
   * delivered later; the reporter sees `status.kind === "queued"` and the
   * `queued` message instead of an error they can do nothing about.
   *
   * A 4xx is never queued: the server has already said this report is not
   * acceptable, and retrying it would only fail again more quietly.
   */
  queue?: Queue;
};

/** Everything a form renders. Replaced wholesale on every change, never mutated. */
export type ReportState = {
  type: ReportType;
  message: string;
  screenshot: string | null;
  includeScreenshot: boolean;
  /** Whether a renderer was supplied, so the form can hide the checkbox. */
  canScreenshot: boolean;
  /** Elements the reporter has pointed at, in order. */
  elements: ElementRef[];
  status: BugReportStatus;
};

export type ReportActions = {
  setType: (next: ReportType) => void;
  setMessage: (next: string) => void;
  toggleScreenshot: (checked: boolean) => void;
  recapture: () => Promise<void>;
  pickElement: () => Promise<ElementRef | null>;
  cancelPick: () => void;
  removeElement: (index: number) => void;
  open: () => void;
  submit: () => Promise<boolean>;
  reset: () => void;
};

export type ReportStateStore = {
  getState: () => ReportState;
  subscribe: (listener: () => void) => () => void;
  actions: ReportActions;
  /** Hand the store the current options. Adapters that re-render call it every time. */
  setOptions: (next: UseBugReportOptions) => void;
  /** Aborts a pick in progress. Call when the form goes away. */
  destroy: () => void;
};

const FALLBACK_MESSAGES: Messages = enMessages;

const bugsOnly = (t: ReportType) => t === "bug";

/**
 * The one line of the form that is not in the state: a sent or queued report
 * is announced with the reporter's own language, and an error carries the
 * message it failed with.
 */
export function statusText(status: BugReportStatus, messages?: Partial<Messages>): string {
  if (status.kind === "error") return status.message;
  if (status.kind !== "sent" && status.kind !== "queued") return "";
  const msg = { ...FALLBACK_MESSAGES, ...messages };
  return status.kind === "sent" ? msg.sent : msg.queued;
}

export function createReportState(options: UseBugReportOptions): ReportStateStore {
  let opts = options;
  const messages = () => ({ ...FALLBACK_MESSAGES, ...opts.messages });
  const canShoot = () => opts.screenshot !== undefined;
  const armedFor = (t: ReportType) => (opts.screenshotFor ?? bugsOnly)(t);
  const firstType = () => opts.initialType ?? "bug";

  let state: ReportState = {
    type: firstType(),
    message: "",
    screenshot: null,
    includeScreenshot: canShoot() && armedFor(firstType()),
    canScreenshot: canShoot(),
    elements: [],
    status: { kind: "idle" },
  };

  const listeners = new Set<() => void>();
  const set = (patch: Partial<ReportState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  let capturing = false;
  let picking: AbortController | null = null;

  const capture = async () => {
    const renderer = opts.screenshot;
    if (!renderer || capturing) return;
    capturing = true;
    set({ status: { kind: "capturing" } });
    try {
      const dataUrl = await captureScreenshot(renderer, { mask: opts.mask });
      set({ screenshot: dataUrl, status: { kind: "idle" } });
    } catch (err) {
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
    } finally {
      capturing = false;
    }
  };

  const actions: ReportActions = {
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

    toggleScreenshot(checked) {
      if (!canShoot()) return;
      set({ includeScreenshot: checked });
      if (checked && !state.screenshot) void capture();
      if (!checked) set({ screenshot: null });
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
        if (picked) set({ elements: [...state.elements, picked].slice(-MAX_ELEMENTS) });
        return picked;
      } finally {
        if (picking === controller) {
          picking = null;
          if (state.status.kind === "picking") set({ status: { kind: "idle" } });
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
      const clearForm = () =>
        set({
          message: "",
          screenshot: null,
          elements: [],
          includeScreenshot: canShoot() && armedFor(state.type),
        });
      // Kept outside the try so the failure path can hand the very same body to
      // the queue rather than assembling a second one from stale state.
      let report: (BugReport & Record<string, unknown>) | null = null;
      try {
        report = buildReport({
          type: state.type,
          message: state.message,
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
      } catch (err) {
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
      if (canShoot() !== state.canScreenshot) set({ canScreenshot: canShoot() });
    },
    // A pick installs capture-phase listeners on the document that swallow
    // clicks. If the form goes away mid-pick — a modal closed, a route change —
    // they must go with it, or every click on the page is eaten until Escape.
    destroy() {
      picking?.abort();
    },
  };
}
