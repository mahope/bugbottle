/**
 * An optional, ready-made report panel: a floating button and a small dialog,
 * rendered in a shadow root so your styles and its styles never meet.
 *
 * The headless core stays headless. This is a separate entry point
 * (`bugbottle/ui`) for the applications that want something on the page in
 * five minutes and are happy to brand it with a handful of CSS variables and
 * a locale, rather than build a form.
 *
 * Everything the reporter reads comes from a `Locale`; everything they see
 * comes from `Theme` and `Brand`. Custom properties (`--bb-primary` and
 * friends) pierce the shadow root, so a stylesheet can also restyle it from
 * outside without touching JavaScript.
 */

import { captureScreenshot, ScreenshotTooLargeError, type ScreenshotRenderer } from "../capture.ts";
import { pickElement } from "../element-picker.ts";
import { en, type Locale, type Messages, type UiTexts } from "../locales.ts";
import { MAX_ELEMENTS, REPORT_TYPES, type ElementRef, type ReportType } from "../report-core.ts";
import { buildReport, sendReport, SendFailedError, type SendOptions } from "../send.ts";

export type Theme = {
  /** Accent: trigger button, primary action, focus ring. */
  primary?: string;
  /** Text on the accent colour. */
  onPrimary?: string;
  background?: string;
  text?: string;
  /** Secondary text: intro, notes, status. */
  muted?: string;
  border?: string;
  /** Border radius of the panel and controls, e.g. `"12px"`. */
  radius?: string;
  /** Font stack. Defaults to the system UI font. */
  font?: string;
  shadow?: string;
  zIndex?: number;
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** `"auto"` follows `prefers-color-scheme`. Default `"auto"`. */
  scheme?: "light" | "dark" | "auto";
};

export type Brand = {
  /** Shown in the panel header. Defaults to the locale's title. */
  name?: string;
  /** An image URL, or an inline `<svg>…</svg>` string. Shown before the title and on the trigger. */
  logo?: string;
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type MountOptions = {
  /** Endpoint that receives the report. Required. */
  endpoint: string;
  /** How to take the picture. Without it the screenshot row is not rendered. */
  screenshot?: ScreenshotRenderer;
  /** A bundled locale from `bugbottle/locales`, or your own. Default English. */
  locale?: Locale;
  /** Override individual labels of the locale. */
  texts?: DeepPartial<UiTexts>;
  /** Override individual status messages of the locale. */
  messages?: Partial<Messages>;
  theme?: Theme;
  brand?: Brand;
  /** Which report types to offer. Default all three. */
  types?: readonly ReportType[];
  initialType?: ReportType;
  /** Attach the console buffer. Default: for bugs only. */
  consoleFor?: (type: ReportType) => boolean;
  /** Tick the screenshot box by default. Default: for bugs only. */
  screenshotFor?: (type: ReportType) => boolean;
  /** Offer the element picker. Default true. */
  elementPicker?: boolean;
  /**
   * `false` renders no floating button — call `open()` from your own control.
   * An element or selector makes that element the trigger instead.
   */
  trigger?: false | HTMLElement | string;
  /** Where to mount. Default `document.body`. */
  container?: HTMLElement;
  /** Extra fields merged into every report — app version, tenant id. */
  extra?: Record<string, unknown>;
  headers?: SendOptions["headers"];
  credentials?: SendOptions["credentials"];
  timeoutMs?: SendOptions["timeoutMs"];
  /**
   * Replace the global `fetch`. Mostly for tests and for demonstrations that
   * have no endpoint to talk to.
   */
  fetch?: SendOptions["fetch"];
  parseError?: SendOptions["parseError"];
  onSent?: (id: string | undefined) => void;
  onError?: (error: unknown) => void;
};

export type BugbottleWidget = {
  open(): void;
  close(): void;
  toggle(): void;
  /** Removes the widget and its listeners. */
  destroy(): void;
  /** The element carrying the shadow root. Set `--bb-*` custom properties here. */
  host: HTMLElement;
  /** Swap language at runtime. */
  setLocale(locale: Locale): void;
};

const POSITIONS: Record<NonNullable<Theme["position"]>, string> = {
  "bottom-right": "right:16px;bottom:16px;",
  "bottom-left": "left:16px;bottom:16px;",
  "top-right": "right:16px;top:16px;",
  "top-left": "left:16px;top:16px;",
};

const CSS = `
:host{
  --bb-primary:#2563eb;--bb-on-primary:#fff;--bb-bg:#fff;--bb-text:#111827;--bb-muted:#6b7280;
  --bb-border:#e5e7eb;--bb-radius:12px;--bb-font:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --bb-shadow:0 12px 40px rgba(0,0,0,.18);--bb-z:2147483000;
  position:fixed;z-index:var(--bb-z);font:14px/1.45 var(--bb-font);color:var(--bb-text);
}
:host([data-scheme="dark"]){--bb-bg:#111827;--bb-text:#f3f4f6;--bb-muted:#9ca3af;--bb-border:#374151}
@media (prefers-color-scheme:dark){
  :host([data-scheme="auto"]){--bb-bg:#111827;--bb-text:#f3f4f6;--bb-muted:#9ca3af;--bb-border:#374151}
}
*,*::before,*::after{box-sizing:border-box}
button,textarea,input{font:inherit;color:inherit}
.trigger{
  display:inline-flex;align-items:center;gap:8px;border:0;cursor:pointer;
  background:var(--bb-primary);color:var(--bb-on-primary);padding:10px 16px;
  border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.2);font-weight:600;
}
.trigger:focus-visible,.send:focus-visible,.close:focus-visible,.type:focus-visible,.pick:focus-visible,
textarea:focus-visible,input:focus-visible,.rm:focus-visible{outline:2px solid var(--bb-primary);outline-offset:2px}
.logo{display:inline-flex;width:18px;height:18px}
.logo img,.logo svg{width:100%;height:100%;object-fit:contain}
.panel{
  width:min(360px,calc(100vw - 32px));background:var(--bb-bg);color:var(--bb-text);
  border:1px solid var(--bb-border);border-radius:var(--bb-radius);box-shadow:var(--bb-shadow);
  padding:16px;margin-bottom:12px;
}
:host([data-pos^="top"]) .panel{margin-bottom:0;margin-top:12px}
:host([data-pos^="bottom"]) .wrap{display:flex;flex-direction:column;align-items:flex-end}
:host([data-pos="bottom-left"]) .wrap,:host([data-pos="top-left"]) .wrap{align-items:flex-start}
:host([data-pos^="top"]) .wrap{display:flex;flex-direction:column-reverse;align-items:flex-end}
:host([data-pos="top-left"]) .wrap{align-items:flex-start}
header{display:flex;align-items:center;gap:8px;margin-bottom:4px}
header .logo{width:22px;height:22px}
h2{font-size:16px;font-weight:600;margin:0;flex:1}
.close{border:0;background:none;cursor:pointer;font-size:20px;line-height:1;padding:2px 6px;color:var(--bb-muted);border-radius:6px}
.close:hover{color:var(--bb-text)}
.intro,.note,.status{color:var(--bb-muted);margin:0 0 10px;font-size:13px}
.note{margin:4px 0 10px 24px}
.types{display:flex;gap:6px;margin:10px 0}
.type{flex:1;padding:6px 8px;border:1px solid var(--bb-border);background:none;border-radius:calc(var(--bb-radius) - 4px);cursor:pointer}
.type[aria-checked="true"]{border-color:var(--bb-primary);color:var(--bb-primary);font-weight:600}
label.field{display:block;font-weight:600;margin:8px 0 4px}
textarea{width:100%;min-height:88px;resize:vertical;padding:8px 10px;border:1px solid var(--bb-border);border-radius:calc(var(--bb-radius) - 4px);background:transparent}
.check{display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer}
.preview{display:block;max-width:100%;max-height:120px;border:1px solid var(--bb-border);border-radius:6px;margin:6px 0}
.pick{margin-top:8px;padding:6px 10px;border:1px dashed var(--bb-border);background:none;border-radius:calc(var(--bb-radius) - 4px);cursor:pointer;width:100%;text-align:left}
.pick[aria-pressed="true"]{border-style:solid;border-color:var(--bb-primary)}
ul{list-style:none;margin:6px 0 0;padding:0;font-size:13px}
li{display:flex;gap:6px;align-items:baseline;padding:3px 0}
li code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--bb-muted);word-break:break-all}
li span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rm{border:0;background:none;cursor:pointer;color:var(--bb-muted);padding:0 4px;border-radius:4px}
.status{margin:10px 0 0;min-height:1.2em}
.status[data-kind="error"]{color:#dc2626}
.send{
  display:block;width:100%;margin-top:12px;border:0;cursor:pointer;
  background:var(--bb-primary);color:var(--bb-on-primary);padding:10px;border-radius:calc(var(--bb-radius) - 4px);font-weight:600;
}
.send:disabled{opacity:.6;cursor:default}
.thanks{text-align:center;padding:12px 0 4px}
.thanks p{margin:0 0 12px}
[hidden]{display:none!important}
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function logoNode(logo: string): HTMLElement {
  const wrap = el("span", { class: "logo", "aria-hidden": "true" });
  if (logo.trim().startsWith("<svg")) {
    // Inline SVG from the integrator's own code, not from a reporter.
    wrap.innerHTML = logo;
  } else {
    wrap.append(el("img", { src: logo, alt: "" }));
  }
  return wrap;
}

function merge<T extends object>(base: T, over: DeepPartial<T> | undefined): T {
  if (!over) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) {
    const current = out[k];
    out[k] =
      typeof v === "object" && v !== null && typeof current === "object" && current !== null
        ? merge(current as object, v as object)
        : v;
  }
  return out as T;
}

const bugsOnly = (t: ReportType) => t === "bug";

/** Mounts the panel and returns a handle. Call once per page. */
export function mountBugbottle(options: MountOptions): BugbottleWidget {
  if (typeof document === "undefined") {
    throw new Error("mountBugbottle requires a browser environment");
  }
  const types = options.types ?? REPORT_TYPES;
  const consoleFor = options.consoleFor ?? bugsOnly;
  const screenshotFor = options.screenshotFor ?? bugsOnly;
  const theme = options.theme ?? {};
  const container = options.container ?? document.body;

  let locale = options.locale ?? en;
  let ui: UiTexts = merge(locale.ui, options.texts);
  let msg: Messages = { ...locale.messages, ...options.messages };

  // ---- state
  let type: ReportType = options.initialType ?? types[0] ?? "bug";
  let screenshot: string | null = null;
  let elements: ElementRef[] = [];
  let pickController: AbortController | null = null;
  let sending = false;
  let isOpen = false;

  // ---- host + shadow
  const host = el("div", { "data-bugbottle": "ui", lang: locale.code, dir: locale.dir ?? "ltr" });
  host.dataset.scheme = theme.scheme ?? "auto";
  host.dataset.pos = theme.position ?? "bottom-right";
  host.style.cssText = POSITIONS[theme.position ?? "bottom-right"];
  const vars: [keyof Theme, string][] = [
    ["primary", "--bb-primary"], ["onPrimary", "--bb-on-primary"], ["background", "--bb-bg"],
    ["text", "--bb-text"], ["muted", "--bb-muted"], ["border", "--bb-border"], ["radius", "--bb-radius"],
    ["font", "--bb-font"], ["shadow", "--bb-shadow"], ["zIndex", "--bb-z"],
  ];
  for (const [key, name] of vars) {
    const value = theme[key];
    if (value !== undefined) host.style.setProperty(name, String(value));
  }
  const root = host.attachShadow({ mode: "open" });
  root.append(el("style", {}, CSS));

  // ---- elements
  const trigger = el("button", { class: "trigger", type: "button", "aria-expanded": "false" });
  const title = el("h2", { id: "bb-title" });
  const closeBtn = el("button", { class: "close", type: "button" }, "×");
  const header = el("header", {}, title, closeBtn);
  const intro = el("p", { class: "intro" });
  const typesRow = el("div", { class: "types", role: "radiogroup" });
  const messageLabel = el("label", { class: "field", for: "bb-message" });
  const textarea = el("textarea", { id: "bb-message", rows: "4" });
  const shotBox = el("input", { type: "checkbox" });
  const shotText = el("span");
  const shotRow = el("label", { class: "check" }, shotBox, shotText);
  const shotNote = el("p", { class: "note" });
  const preview = el("img", { class: "preview", alt: "", hidden: "" });
  const pickBtn = el("button", { class: "pick", type: "button", "aria-pressed": "false" });
  const list = el("ul", { hidden: "" });
  const status = el("p", { class: "status", role: "status", "aria-live": "polite" });
  const sendBtn = el("button", { class: "send", type: "button" });
  const form = el("div", { class: "form" },
    intro, typesRow, messageLabel, textarea, shotRow, shotNote, preview, pickBtn, list, status, sendBtn);
  const thanksText = el("p");
  const thanksClose = el("button", { class: "send", type: "button" });
  const thanks = el("div", { class: "thanks", hidden: "" }, thanksText, thanksClose);
  const panel = el("div", {
    class: "panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "bb-title", hidden: "",
  }, header, form, thanks);
  const wrap = el("div", { class: "wrap" }, panel, trigger);
  root.append(wrap);

  if (!options.screenshot) {
    shotRow.hidden = true;
    shotNote.hidden = true;
  }
  if (options.elementPicker === false) pickBtn.hidden = true;

  const typeButtons = new Map<ReportType, HTMLButtonElement>();
  for (const t of types) {
    const b = el("button", { class: "type", type: "button", role: "radio", "aria-checked": "false" });
    b.addEventListener("click", () => setType(t));
    typeButtons.set(t, b);
    typesRow.append(b);
  }

  if (options.brand?.logo) {
    trigger.prepend(logoNode(options.brand.logo));
    header.prepend(logoNode(options.brand.logo));
  }

  // ---- text
  function applyTexts() {
    host.lang = locale.code;
    host.dir = locale.dir ?? "ltr";
    const triggerLabel = trigger.querySelector("span:not(.logo)") ?? trigger.appendChild(el("span"));
    triggerLabel.textContent = ui.trigger;
    trigger.setAttribute("aria-label", ui.trigger);
    title.textContent = options.brand?.name ?? ui.title;
    closeBtn.setAttribute("aria-label", ui.close);
    closeBtn.title = ui.close;
    intro.textContent = ui.intro;
    intro.hidden = !ui.intro;
    for (const [t, b] of typeButtons) b.textContent = ui.types[t];
    messageLabel.textContent = ui.messageLabel;
    textarea.placeholder = ui.messagePlaceholder;
    shotText.textContent = ui.screenshot;
    shotNote.textContent = ui.screenshotNote;
    shotNote.hidden = !options.screenshot || !ui.screenshotNote;
    pickBtn.textContent = pickController ? ui.picking : ui.pickElement;
    sendBtn.textContent = sending ? ui.sending : ui.send;
    thanksText.textContent = ui.thanks;
    thanksClose.textContent = ui.close;
    renderElements();
  }

  function setStatus(text: string, kind: "info" | "error" = "info") {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function setType(next: ReportType) {
    type = next;
    for (const [t, b] of typeButtons) b.setAttribute("aria-checked", String(t === next));
    if (options.screenshot && screenshotFor(next) && !shotBox.checked) {
      shotBox.checked = true;
      void capture();
    }
  }

  async function capture() {
    const render = options.screenshot;
    if (!render || screenshot) return;
    try {
      screenshot = await captureScreenshot(render);
      preview.src = screenshot;
      preview.hidden = false;
    } catch (err) {
      shotBox.checked = false;
      setStatus(err instanceof ScreenshotTooLargeError ? msg.screenshotTooLarge : msg.screenshotFailed, "error");
      options.onError?.(err);
    }
  }

  function clearScreenshot() {
    screenshot = null;
    preview.hidden = true;
    preview.removeAttribute("src");
  }

  function renderElements() {
    list.replaceChildren();
    list.hidden = elements.length === 0;
    elements.forEach((e, i) => {
      const rm = el("button", { class: "rm", type: "button", "aria-label": ui.remove, title: ui.remove }, "×");
      rm.addEventListener("click", () => {
        elements = elements.filter((_, j) => j !== i);
        renderElements();
      });
      list.append(el("li", {}, el("code", {}, e.selector), el("span", {}, e.text), rm));
    });
  }

  async function pick() {
    if (pickController) {
      pickController.abort();
      return;
    }
    pickController = new AbortController();
    pickBtn.setAttribute("aria-pressed", "true");
    pickBtn.textContent = ui.picking;
    // The panel is in the way of the page while picking.
    panel.hidden = true;
    try {
      const picked = await pickElement({ signal: pickController.signal });
      if (picked) {
        elements = [...elements, picked].slice(-MAX_ELEMENTS);
        renderElements();
      }
    } finally {
      pickController = null;
      pickBtn.setAttribute("aria-pressed", "false");
      pickBtn.textContent = ui.pickElement;
      if (isOpen) {
        panel.hidden = false;
        pickBtn.focus();
      }
    }
  }

  async function submit() {
    if (sending) return;
    if (!textarea.value.trim()) {
      setStatus(msg.empty, "error");
      textarea.focus();
      return;
    }
    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = ui.sending;
    setStatus("");
    try {
      const report = buildReport({
        type,
        message: textarea.value,
        screenshotDataUrl: shotBox.checked ? screenshot : null,
        includeConsole: consoleFor(type),
        elements,
        extra: options.extra,
      });
      const { id } = await sendReport(options.endpoint, report, {
        headers: options.headers,
        credentials: options.credentials,
        timeoutMs: options.timeoutMs,
        fetch: options.fetch,
        parseError: options.parseError,
      });
      resetForm();
      form.hidden = true;
      thanks.hidden = false;
      thanksClose.focus();
      options.onSent?.(id);
    } catch (err) {
      setStatus(err instanceof SendFailedError && err.message ? err.message : msg.sendFailed, "error");
      options.onError?.(err);
    } finally {
      sending = false;
      sendBtn.disabled = false;
      sendBtn.textContent = ui.send;
    }
  }

  function resetForm() {
    textarea.value = "";
    elements = [];
    renderElements();
    clearScreenshot();
    setStatus("");
    setType(options.initialType ?? types[0] ?? "bug");
    shotBox.checked = !!options.screenshot && screenshotFor(type);
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    form.hidden = false;
    thanks.hidden = true;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    textarea.focus();
    if (shotBox.checked) void capture();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    pickController?.abort();
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (!thanks.hidden) resetForm();
    trigger.focus();
  }

  // ---- wiring
  trigger.addEventListener("click", () => (isOpen ? close() : open()));
  closeBtn.addEventListener("click", close);
  thanksClose.addEventListener("click", close);
  sendBtn.addEventListener("click", () => void submit());
  pickBtn.addEventListener("click", () => void pick());
  shotBox.addEventListener("change", () => {
    if (shotBox.checked) void capture();
    else clearScreenshot();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen && !pickController) close();
  };
  root.addEventListener("keydown", onKey as EventListener);

  let externalTrigger: HTMLElement | null = null;
  if (options.trigger === false) {
    trigger.hidden = true;
  } else if (options.trigger) {
    trigger.hidden = true;
    externalTrigger =
      typeof options.trigger === "string" ? document.querySelector(options.trigger) : options.trigger;
    externalTrigger?.addEventListener("click", toggle);
    externalTrigger?.setAttribute("data-bugbottle", "trigger");
  }

  function toggle() {
    isOpen ? close() : open();
  }

  resetForm();
  applyTexts();
  container.append(host);

  return {
    open,
    close,
    toggle,
    host,
    setLocale(next: Locale) {
      locale = next;
      ui = merge(next.ui, options.texts);
      msg = { ...next.messages, ...options.messages };
      applyTexts();
    },
    destroy() {
      pickController?.abort();
      externalTrigger?.removeEventListener("click", toggle);
      host.remove();
    },
  };
}
