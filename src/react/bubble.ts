import {
  createElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import { useBugReport, type UseBugReportOptions } from "./use-bug-report.ts";
import { REPORT_TYPES, type ReportType } from "../report-core.ts";

/**
 * A working, unstyled-but-presentable trigger + panel for people who just
 * want the widget to work, built entirely on `useBugReport`.
 *
 * This is a separate entry (`bugbottle/react/bubble`) on purpose: importing
 * only `useBugReport` from `bugbottle/react` must never pull this file's
 * markup or styling along for the ride. `scripts/check-bundle-size.mjs`
 * checks that in CI by walking the react entry's static-import graph.
 *
 * Written with `createElement` rather than JSX: `.ts` sources here run
 * directly under Node's `--experimental-strip-types` (see package.json's
 * `test` script), which strips type annotations but does not transform JSX.
 */

export type BugBottleBubbleProps = UseBugReportOptions & {
  /** Label on the trigger button. Defaults to "Report a bug". */
  triggerLabel?: string;
  /** Corner the trigger sits in. Defaults to "bottom-right". */
  position?: "bottom-right" | "bottom-left";
};

const TYPE_LABELS: Record<ReportType, string> = {
  bug: "Bug",
  idea: "Idea",
  other: "Other",
};

export function BugBottleBubble(props: BugBottleBubbleProps): ReactElement {
  const { triggerLabel = "Report a bug", position = "bottom-right", ...options } = props;
  const report = useBugReport(options);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const statusId = useId();

  const close = useCallback(() => setIsOpen(false), []);

  const openPanel = useCallback(() => {
    setIsOpen(true);
    report.open();
  }, [report]);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    first?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Runs after the closed-state DOM has committed (this cleanup fires
      // right before the next effect pass, once isOpen is already false and
      // the trigger button has re-mounted), so the ref is live by now —
      // calling focus() directly from close() would hit a still-null ref.
      triggerRef.current?.focus();
    };
  }, [isOpen, close]);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (await report.submit()) close();
    },
    [report, close],
  );

  return createElement(
    "div",
    { "data-bugbottle": "true", style: styles.root(position) },
    !isOpen &&
      createElement(
        "button",
        { ref: triggerRef, type: "button", style: styles.trigger, onClick: openPanel },
        triggerLabel,
      ),
    isOpen &&
      createElement(
        "div",
        {
          ref: panelRef,
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": titleId,
          style: styles.panel,
        },
        createElement(
          "form",
          { onSubmit: (e: FormEvent) => void onSubmit(e) },
          createElement(
            "div",
            { style: styles.header },
            createElement("h2", { id: titleId, style: styles.title }, triggerLabel),
            createElement(
              "button",
              { type: "button", "aria-label": "Close", onClick: close, style: styles.close },
              "×",
            ),
          ),
          createElement(TypeSelector, { value: report.type, onChange: report.setType }),
          createElement("textarea", {
            value: report.message,
            onChange: (e: ChangeEvent<HTMLTextAreaElement>) => report.setMessage(e.target.value),
            placeholder: "What went wrong?",
            rows: 4,
            style: styles.textarea,
          }),
          createElement(
            "label",
            { style: styles.checkboxLabel },
            createElement("input", {
              type: "checkbox",
              checked: report.includeScreenshot,
              onChange: (e: ChangeEvent<HTMLInputElement>) => report.toggleScreenshot(e.target.checked),
            }),
            "Attach a picture of this page",
          ),
          report.screenshot &&
            createElement("img", { src: report.screenshot, alt: "", style: styles.screenshotPreview }),
          createElement("p", { role: "status", id: statusId, style: styles.status }, report.statusMessage),
          createElement(
            "button",
            { type: "submit", disabled: report.isSending, style: styles.submit },
            report.isSending ? "Sending…" : "Send",
          ),
        ),
      ),
  );
}

function TypeSelector(props: { value: ReportType; onChange: (t: ReportType) => void }): ReactElement {
  const { value, onChange } = props;
  const refs = useRef<Partial<Record<ReportType, HTMLButtonElement>>>({});

  function onKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIndex = (index + 1) % REPORT_TYPES.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIndex = (index - 1 + REPORT_TYPES.length) % REPORT_TYPES.length;
    }
    if (nextIndex === -1) return;
    e.preventDefault();
    const next = REPORT_TYPES[nextIndex];
    if (!next) return;
    onChange(next);
    refs.current[next]?.focus();
  }

  return createElement(
    "div",
    { role: "radiogroup", "aria-label": "Report type", style: styles.radiogroup },
    ...REPORT_TYPES.map((t, i) =>
      createElement(
        "button",
        {
          key: t,
          ref: (el: HTMLButtonElement | null) => {
            if (el) refs.current[t] = el;
          },
          type: "button",
          role: "radio",
          "aria-checked": value === t,
          tabIndex: value === t ? 0 : -1,
          onClick: () => onChange(t),
          onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => onKeyDown(e, i),
          style: styles.radio(value === t),
        },
        TYPE_LABELS[t],
      ),
    ),
  );
}

const styles = {
  root: (position: "bottom-right" | "bottom-left"): CSSProperties => ({
    position: "fixed",
    bottom: 16,
    [position === "bottom-right" ? "right" : "left"]: 16,
    zIndex: 2147483647,
    fontFamily: "system-ui, sans-serif",
    fontSize: 14,
  }),
  trigger: {
    padding: "10px 16px",
    borderRadius: 999,
    border: "1px solid #d0d0d0",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  } satisfies CSSProperties,
  panel: {
    width: 320,
    maxWidth: "calc(100vw - 32px)",
    background: "#fff",
    color: "#111",
    border: "1px solid #d0d0d0",
    borderRadius: 12,
    padding: 16,
    boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
  } satisfies CSSProperties,
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" } satisfies CSSProperties,
  title: { fontSize: 16, margin: 0 } satisfies CSSProperties,
  close: {
    border: "none",
    background: "none",
    fontSize: 20,
    lineHeight: 1,
    cursor: "pointer",
    padding: 4,
  } satisfies CSSProperties,
  radiogroup: { display: "flex", gap: 8, margin: "12px 0" } satisfies CSSProperties,
  radio: (checked: boolean): CSSProperties => ({
    flex: 1,
    padding: "6px 8px",
    borderRadius: 6,
    border: checked ? "1px solid #111" : "1px solid #d0d0d0",
    background: checked ? "#111" : "#fff",
    color: checked ? "#fff" : "#111",
    cursor: "pointer",
  }),
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 6,
    border: "1px solid #d0d0d0",
    padding: 8,
    fontFamily: "inherit",
    fontSize: "inherit",
    resize: "vertical",
  } satisfies CSSProperties,
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  } satisfies CSSProperties,
  screenshotPreview: {
    width: "100%",
    borderRadius: 6,
    marginTop: 8,
    border: "1px solid #d0d0d0",
  } satisfies CSSProperties,
  status: { minHeight: "1.2em", fontSize: 13, margin: "8px 0" } satisfies CSSProperties,
  submit: {
    width: "100%",
    padding: "8px 16px",
    borderRadius: 6,
    border: "none",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
  } satisfies CSSProperties,
};
