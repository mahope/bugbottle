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
import { captureScreenshot, ScreenshotTooLargeError, } from "../capture.js";
import { pickElement } from "../element-picker.js";
import { en } from "../locales.js";
import { MAX_ELEMENTS, REPORT_TYPES, } from "../report-core.js";
import { buildReport, sendReport, SendFailedError, } from "../send.js";
import { DEFAULT_SHORTCUT, onShortcut, onUncaughtError } from "../triggers.js";
const POSITIONS = {
    "bottom-right": "right:16px;bottom:16px;",
    "bottom-left": "left:16px;bottom:16px;",
    "top-right": "right:16px;top:16px;",
    "top-left": "left:16px;top:16px;",
};
/*
 * The stylesheet ships as bytes, so it carries no comments of its own. Two
 * things in it are not obvious. `--bb-error` and `--bb-accent-text` exist
 * because the default red and the default accent are readable on white and
 * not on #111827, and both are drawn as text; the dark scheme lightens them
 * and leaves `--bb-primary` alone, so the trigger keeps its brand colour.
 * `.close` and `.rm` carry a minimum size because 24x24 is the smallest
 * target WCAG 2.2 accepts and an icon button is otherwise smaller than that.
 * The `canvas` rule sets a width and leaves the height automatic so the box
 * keeps the picture's own shape: the annotator maps a pointer position onto a
 * pixel through that box, and a letterboxed canvas would map it wrongly.
 */
const CSS = `
:host{
  --bb-primary:#2563eb;--bb-on-primary:#fff;--bb-bg:#fff;--bb-text:#111827;--bb-muted:#6b7280;
  --bb-border:#e5e7eb;--bb-radius:12px;--bb-font:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --bb-shadow:0 12px 40px rgba(0,0,0,.18);--bb-z:2147483000;
  --bb-error:#b91c1c;--bb-accent-text:var(--bb-primary);
  position:fixed;z-index:var(--bb-z);font:14px/1.45 var(--bb-font);color:var(--bb-text);
}
:host([data-scheme="dark"]){--bb-bg:#111827;--bb-text:#f3f4f6;--bb-muted:#9ca3af;--bb-border:#374151;
  --bb-error:#f87171;--bb-accent-text:#93c5fd}
@media (prefers-color-scheme:dark){
  :host([data-scheme="auto"]){--bb-bg:#111827;--bb-text:#f3f4f6;--bb-muted:#9ca3af;--bb-border:#374151;
    --bb-error:#f87171;--bb-accent-text:#93c5fd}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
*,*::before,*::after{box-sizing:border-box}
.sr{position:absolute;width:1px;height:1px;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
button,textarea,input{font:inherit;color:inherit}
.trigger{
  display:inline-flex;align-items:center;gap:8px;border:0;cursor:pointer;
  background:var(--bb-primary);color:var(--bb-on-primary);padding:10px 16px;
  border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.2);font-weight:600;
}
.trigger:focus-visible,.send:focus-visible,.close:focus-visible,.type:focus-visible,.pick:focus-visible,
textarea:focus-visible,input:focus-visible,.rm:focus-visible,.edit:focus-visible,.tool:focus-visible,
.act:focus-visible,canvas:focus-visible{outline:2px solid var(--bb-accent-text);outline-offset:2px}
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
.hd{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.hd .logo{width:22px;height:22px}
h2{font-size:16px;font-weight:600;margin:0;flex:1}
.close,.rm{display:inline-flex;align-items:center;justify-content:center;min-width:24px;min-height:24px}
.close{border:0;background:none;cursor:pointer;font-size:20px;line-height:1;color:var(--bb-muted);border-radius:6px}
.close:hover{color:var(--bb-text)}
.intro,.note,.status{color:var(--bb-muted);margin:0 0 10px;font-size:13px}
.note{margin:4px 0 10px 24px}
.types{display:flex;gap:6px;margin:10px 0}
.type{flex:1;padding:6px 8px;border:1px solid var(--bb-border);background:none;border-radius:calc(var(--bb-radius) - 4px);cursor:pointer;min-height:24px}
.type[aria-checked="true"]{border-color:var(--bb-accent-text);color:var(--bb-accent-text);font-weight:600}
label.field{display:block;font-weight:600;margin:8px 0 4px}
textarea,#bb-contact{width:100%;padding:8px 10px;border:1px solid var(--bb-border);border-radius:calc(var(--bb-radius) - 4px);background:transparent}
textarea{min-height:88px;resize:vertical}
.hint{margin-left:0}
.check{display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;min-height:24px}
.preview{display:block;max-width:100%;max-height:120px;border:1px solid var(--bb-border);border-radius:6px;margin:6px 0}
.edit,.act{border:1px solid var(--bb-border);background:none;border-radius:calc(var(--bb-radius) - 4px);cursor:pointer;min-height:24px;padding:6px 10px}
.edit{margin:0 0 6px}
.tools{display:flex;gap:6px;margin:0 0 6px}
.tool{flex:1;padding:6px 8px;border:1px solid var(--bb-border);background:none;border-radius:calc(var(--bb-radius) - 4px);cursor:pointer;min-height:24px;min-width:24px}
.tool[aria-checked="true"]{border-color:var(--bb-accent-text);color:var(--bb-accent-text);font-weight:600}
canvas{display:block;width:100%;height:auto;border:1px solid var(--bb-border);border-radius:6px;touch-action:none;cursor:crosshair}
.acts{display:flex;gap:6px;margin-top:6px}
.act{flex:1}
.act:disabled{opacity:.6;cursor:default}
.pick{margin-top:8px;padding:6px 10px;border:1px dashed var(--bb-border);background:none;border-radius:calc(var(--bb-radius) - 4px);cursor:pointer;width:100%;text-align:left}
.pick[aria-pressed="true"]{border-style:solid;border-color:var(--bb-primary)}
ul{list-style:none;margin:6px 0 0;padding:0;font-size:13px}
li{display:flex;gap:6px;align-items:baseline;padding:3px 0}
li code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--bb-muted);word-break:break-all}
li span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rm{border:0;background:none;cursor:pointer;color:var(--bb-muted);border-radius:4px;flex:none}
.status{margin:10px 0 0;min-height:1.2em}
.status[data-kind="error"]{color:var(--bb-error)}
.send{
  display:block;width:100%;margin-top:12px;border:0;cursor:pointer;
  background:var(--bb-primary);color:var(--bb-on-primary);padding:10px;border-radius:calc(var(--bb-radius) - 4px);font-weight:600;
}
.send:disabled{opacity:.6;cursor:default}
.thanks{text-align:center;padding:12px 0 4px}
.thanks p{margin:0 0 12px}
[hidden]{display:none!important}
`;
function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "class")
            node.className = v;
        else
            node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
}
function logoNode(logo) {
    const wrap = el("span", { class: "logo", "aria-hidden": "true" });
    if (logo.trim().startsWith("<svg")) {
        // Inline SVG from the integrator's own code, not from a reporter.
        wrap.innerHTML = logo;
    }
    else {
        wrap.append(el("img", { src: logo, alt: "" }));
    }
    return wrap;
}
function merge(base, over) {
    if (!over)
        return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
        const current = out[k];
        out[k] =
            typeof v === "object" && v !== null && typeof current === "object" && current !== null
                ? merge(current, v)
                : v;
    }
    return out;
}
const bugsOnly = (t) => t === "bug";
const ARROWS = {
    ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1,
};
/**
 * Makes a row of buttons behave as a radio group: one stop in the tab order,
 * the arrow keys moving inside it and wrapping at both ends. The panel has two
 * of these — the report types and the drawing tools — and they behave the same
 * because they are the same code.
 */
function rovingGroup(row, buttons, current, select) {
    row.addEventListener("keydown", (e) => {
        const step = ARROWS[e.key];
        if (!step)
            return;
        e.preventDefault();
        const order = [...buttons.keys()];
        const next = order[(order.indexOf(current()) + step + order.length) % order.length];
        if (next === undefined)
            return;
        select(next);
        buttons.get(next)?.focus();
    });
}
/** Marks one button of a group checked, and makes it the group's tab stop. */
function checkOne(buttons, chosen) {
    for (const [value, button] of buttons) {
        const on = value === chosen;
        button.setAttribute("aria-checked", String(on));
        // Roving tabindex: only the checked radio is in the tab order.
        button.setAttribute("tabindex", on ? "0" : "-1");
    }
}
/** Mounts the panel and returns a handle. Call once per page. */
export function mountBugbottle(options) {
    if (typeof document === "undefined") {
        throw new Error("mountBugbottle requires a browser environment");
    }
    const types = options.types ?? REPORT_TYPES;
    const consoleFor = options.consoleFor ?? bugsOnly;
    const screenshotFor = options.screenshotFor ?? bugsOnly;
    // The annotator is a function the application hands in, so leaving it out
    // keeps the canvas editor out of the bundle entirely.
    const makeAnnotator = typeof options.annotate === "function" ? options.annotate : null;
    const theme = options.theme ?? {};
    const container = options.container ?? document.body;
    let locale = options.locale ?? en;
    let ui = merge(locale.ui, options.texts);
    let msg = { ...locale.messages, ...options.messages };
    // ---- state
    let type = options.initialType ?? types[0] ?? "bug";
    let screenshot = null;
    // Live only while the editor is open; the marked picture is folded back into
    // `screenshot` when it closes, so the rest of the panel never knows about it.
    let annotator = null;
    let tool = "rect";
    let elements = [];
    let pickController = null;
    let sending = false;
    let isOpen = false;
    // Whatever had focus when the panel opened, so closing it puts the reporter
    // back where they were rather than at the top of the page.
    let returnFocus = null;
    // True only while a panel that an uncaught error opened is still open, so the
    // intro can explain why it is there and go back to normal afterwards.
    let openedByError = false;
    // ---- host + shadow
    // A named landmark, so the floating button is not page content sitting
    // outside every region, and a screen reader can jump straight to it.
    const host = el("div", {
        "data-bugbottle": "ui", lang: locale.code, dir: locale.dir ?? "ltr", role: "complementary",
    });
    host.dataset.scheme = theme.scheme ?? "auto";
    host.dataset.pos = theme.position ?? "bottom-right";
    host.style.cssText = POSITIONS[theme.position ?? "bottom-right"];
    const vars = [
        ["primary", "--bb-primary"], ["onPrimary", "--bb-on-primary"], ["background", "--bb-bg"],
        ["text", "--bb-text"], ["muted", "--bb-muted"], ["border", "--bb-border"], ["radius", "--bb-radius"],
        ["font", "--bb-font"], ["shadow", "--bb-shadow"], ["zIndex", "--bb-z"],
    ];
    for (const [key, name] of vars) {
        const value = theme[key];
        if (value !== undefined)
            host.style.setProperty(name, String(value));
    }
    const root = host.attachShadow({ mode: "open" });
    root.append(el("style", {}, CSS));
    // ---- elements
    const trigger = el("button", {
        class: "trigger", type: "button", "aria-expanded": "false", "aria-haspopup": "dialog",
    });
    const title = el("h2", { id: "bb-title" });
    const closeBtn = el("button", { class: "close", type: "button" }, "×");
    // A div rather than a <header>, which would be a banner landmark nested
    // inside the dialog.
    const header = el("div", { class: "hd" }, title, closeBtn);
    const intro = el("p", { class: "intro" });
    const typesRow = el("div", { class: "types", role: "radiogroup" });
    const messageLabel = el("label", { class: "field", for: "bb-message" });
    const textarea = el("textarea", { id: "bb-message", rows: "4" });
    const contactLabel = el("label", { class: "field", for: "bb-contact", hidden: "" });
    // `inputmode="email"` for the keyboard it brings up on a phone, but
    // `type="text"`, because `type="email"` and `required` together make a phone
    // number match `:invalid`, and assistive technology announces that as an
    // error — while "call me on 12345678" is an answer this panel accepts.
    // Nothing validates what is typed; it is sent exactly as typed.
    const contactInput = el("input", {
        id: "bb-contact", type: "text", inputmode: "email", autocomplete: "email",
        "aria-describedby": "bb-contact-note", hidden: "",
    });
    const contactNote = el("p", { class: "note hint", id: "bb-contact-note", hidden: "" });
    const shotBox = el("input", { type: "checkbox", "aria-describedby": "bb-shot-note" });
    const shotText = el("span");
    const shotRow = el("label", { class: "check" }, shotBox, shotText);
    const shotNote = el("p", { class: "note", id: "bb-shot-note" });
    const preview = el("img", { class: "preview", alt: "", hidden: "" });
    const editBtn = el("button", { class: "edit", type: "button", hidden: "" });
    const toolsRow = el("div", { class: "tools", role: "radiogroup" });
    // `role="img"` rather than no role at all: a canvas has no implicit role, so
    // an accessible name on it is a prohibited attribute, and the name is where
    // the annotator's two keys are written down. Drawing needs a pointer; undo
    // and done are buttons, so the keyboard is not left with nothing.
    const canvas = el("canvas", { role: "img", tabindex: "0" });
    const undoBtn = el("button", { class: "act", type: "button" });
    const doneBtn = el("button", { class: "act", type: "button" });
    const editor = el("div", { class: "editor", hidden: "" }, toolsRow, canvas, el("div", { class: "acts" }, undoBtn, doneBtn));
    const pickBtn = el("button", { class: "pick", type: "button", "aria-pressed": "false" });
    const list = el("ul", { hidden: "" });
    const status = el("p", { class: "status", role: "status", "aria-live": "polite" });
    const sendBtn = el("button", { class: "send", type: "button" });
    const form = el("div", { class: "form" }, intro, typesRow, messageLabel, textarea, contactLabel, contactInput, contactNote, shotRow, shotNote, preview, editBtn, editor, pickBtn, list, status, sendBtn);
    const thanksText = el("p");
    const thanksClose = el("button", { class: "send", type: "button" });
    const thanks = el("div", { class: "thanks", hidden: "" }, thanksText, thanksClose);
    // `aria-modal` is true because focus really is trapped while the panel is
    // open: Tab cycles inside the shadow root and Escape is the way out.
    const panel = el("div", {
        class: "panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "bb-title", hidden: "",
    }, header, form, thanks);
    // Lives outside the panel because the panel is hidden while picking, and a
    // hidden live region announces nothing.
    const live = el("p", { class: "sr", role: "status", "aria-live": "polite" });
    const wrap = el("div", { class: "wrap" }, panel, trigger, live);
    root.append(wrap);
    if (!options.screenshot) {
        shotRow.hidden = true;
        shotNote.hidden = true;
    }
    if (options.elementPicker === false)
        pickBtn.hidden = true;
    // Nothing about the contact field is rendered unless it was asked for: no
    // label, no input, no note, and nothing in the focus order.
    const wantsContact = options.contact === true || options.contact === "required";
    if (wantsContact) {
        contactLabel.hidden = false;
        contactInput.hidden = false;
        contactNote.hidden = false;
        if (options.contact === "required") {
            contactInput.required = true;
            contactInput.setAttribute("aria-required", "true");
        }
    }
    const typeButtons = new Map();
    for (const t of types) {
        const b = el("button", {
            class: "type", type: "button", role: "radio", "aria-checked": "false", tabindex: "-1",
        });
        b.addEventListener("click", () => setType(t));
        typeButtons.set(t, b);
        typesRow.append(b);
    }
    rovingGroup(typesRow, typeButtons, () => type, setType);
    // The tools are the same shape of control as the report types: one stop in
    // the tab order, the arrows moving inside it.
    const TOOLS = ["rect", "arrow", "blur"];
    const toolButtons = new Map();
    for (const t of TOOLS) {
        const b = el("button", {
            class: "tool", type: "button", role: "radio", "aria-checked": "false", tabindex: "-1",
        });
        b.addEventListener("click", () => setTool(t));
        toolButtons.set(t, b);
        toolsRow.append(b);
    }
    rovingGroup(toolsRow, toolButtons, () => tool, setTool);
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
        host.setAttribute("aria-label", options.brand?.name ?? ui.title);
        closeBtn.setAttribute("aria-label", ui.closeDialog);
        closeBtn.title = ui.closeDialog;
        typesRow.setAttribute("aria-label", ui.typeLabel);
        list.setAttribute("aria-label", ui.attached);
        applyIntro();
        for (const [t, b] of typeButtons)
            b.textContent = ui.types[t];
        messageLabel.textContent = ui.messageLabel;
        textarea.placeholder = ui.messagePlaceholder;
        contactLabel.textContent = ui.contactLabel;
        contactNote.textContent = ui.contactHint;
        shotText.textContent = ui.screenshot;
        shotNote.textContent = ui.screenshotNote;
        shotNote.hidden = !options.screenshot || !ui.screenshotNote;
        editBtn.textContent = ui.annotate;
        toolsRow.setAttribute("aria-label", ui.toolLabel);
        canvas.setAttribute("aria-label", ui.annotateArea);
        const toolText = {
            rect: ui.toolRect, arrow: ui.toolArrow, blur: ui.toolBlur,
        };
        for (const [t, b] of toolButtons)
            b.textContent = toolText[t];
        undoBtn.textContent = ui.undo;
        doneBtn.textContent = ui.done;
        pickBtn.textContent = pickController ? ui.picking : ui.pickElement;
        sendBtn.textContent = sending ? ui.sending : ui.send;
        thanksText.textContent = ui.thanks;
        thanksClose.textContent = ui.close;
        renderElements();
    }
    function applyIntro() {
        const text = openedByError ? ui.openedByError : ui.intro;
        intro.textContent = text;
        intro.hidden = !text;
    }
    function setStatus(text, kind = "info") {
        status.textContent = text;
        status.dataset.kind = kind;
    }
    function setType(next) {
        type = next;
        checkOne(typeButtons, next);
        if (options.screenshot && screenshotFor(next) && !shotBox.checked) {
            shotBox.checked = true;
            void capture();
        }
    }
    function setTool(next) {
        tool = next;
        annotator?.setTool(next);
        checkOne(toolButtons, next);
    }
    /** Replaces the preview with the canvas and hands the picture to the annotator. */
    async function openEditor() {
        if (annotator || !screenshot || !makeAnnotator)
            return;
        editBtn.hidden = true;
        preview.hidden = true;
        editor.hidden = false;
        undoBtn.disabled = true;
        const open = makeAnnotator(canvas, screenshot, {
            tool,
            onChange: (marks) => {
                undoBtn.disabled = marks === 0;
            },
        });
        annotator = open;
        setTool(tool);
        toolButtons.get(tool)?.focus();
        try {
            await open.ready;
        }
        catch (err) {
            // A picture the browser will not decode cannot be marked. Say so once
            // and put the preview back; the report still has the screenshot on it.
            if (annotator === open)
                closeEditor(false);
            setStatus(msg.screenshotFailed, "error");
            options.onError?.(err);
        }
    }
    /**
     * Closes the editor. `keep` exports the marked picture over the screenshot —
     * the blur has already destroyed the pixels it covered, so there is nothing
     * to keep on the other side of it.
     */
    function closeEditor(keep) {
        const open = annotator;
        annotator = null;
        try {
            if (open && keep) {
                screenshot = open.toDataUrl();
                preview.src = screenshot;
            }
        }
        finally {
            // Every exit path ends here, and it ends here whether or not there was a
            // live annotator: an editor left on screen with no annotator behind it
            // is the state where "Edit picture" does nothing at all (#48), so the
            // canvas is put away in a `finally` rather than after an early return.
            open?.destroy();
            editor.hidden = true;
            preview.hidden = !screenshot;
            editBtn.hidden = !screenshot || !makeAnnotator;
        }
    }
    async function capture() {
        const render = options.screenshot;
        if (!render || screenshot)
            return;
        try {
            screenshot = await captureScreenshot(render, { mask: options.mask });
            preview.src = screenshot;
            preview.hidden = false;
            editBtn.hidden = !makeAnnotator;
        }
        catch (err) {
            shotBox.checked = false;
            setStatus(err instanceof ScreenshotTooLargeError ? msg.screenshotTooLarge : msg.screenshotFailed, "error");
            options.onError?.(err);
        }
    }
    function clearScreenshot() {
        closeEditor(false);
        screenshot = null;
        preview.hidden = true;
        preview.removeAttribute("src");
        editBtn.hidden = true;
    }
    function renderElements() {
        list.replaceChildren();
        list.hidden = elements.length === 0;
        elements.forEach((e, i) => {
            // Named after what it removes: a list of buttons all called "Remove"
            // tells a screen reader user nothing about which one to press.
            const name = ui.removeElement.replace("{element}", e.text || e.selector);
            const rm = el("button", { class: "rm", type: "button", "aria-label": name, title: ui.remove }, "×");
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
        // Nothing on screen says what just happened: the panel vanishes and the
        // pointer changes. Say it, and say how to get out again.
        live.textContent = ui.pickingAnnounce;
        // The panel is in the way of the page while picking.
        panel.hidden = true;
        try {
            const picked = await pickElement({ signal: pickController.signal });
            if (picked) {
                elements = [...elements, picked].slice(-MAX_ELEMENTS);
                renderElements();
            }
        }
        finally {
            pickController = null;
            pickBtn.setAttribute("aria-pressed", "false");
            pickBtn.textContent = ui.pickElement;
            live.textContent = ui.pickingDone;
            if (isOpen) {
                panel.hidden = false;
                pickBtn.focus();
            }
        }
    }
    async function submit() {
        if (sending)
            return;
        if (!textarea.value.trim()) {
            setStatus(msg.empty, "error");
            textarea.focus();
            return;
        }
        if (options.contact === "required" && !contactInput.value.trim()) {
            setStatus(ui.contactRequired, "error");
            contactInput.focus();
            return;
        }
        // Marks the reporter made but never confirmed with "Done" are still marks
        // they made. Send sits below the editor and nothing says the editor has to
        // be closed first, so committing them here is what keeps a blur from being
        // dropped on the way out — sending the captured picture instead would post
        // exactly the pixels somebody had just covered up.
        closeEditor(true);
        sending = true;
        sendBtn.disabled = true;
        sendBtn.textContent = ui.sending;
        setStatus("");
        // Assembled outside the try so the failure path can queue this very body.
        let report = null;
        try {
            report = buildReport({
                type,
                message: textarea.value,
                // Empty unless the field is showing, and `buildReport` leaves an empty
                // one out of the body entirely.
                contact: wantsContact ? contactInput.value : "",
                screenshotDataUrl: shotBox.checked ? screenshot : null,
                includeConsole: consoleFor(type),
                elements,
                extra: options.extra,
                scrub: options.scrub,
            });
            const { id } = await sendReport(options.endpoint, report, {
                headers: options.headers,
                credentials: options.credentials,
                timeoutMs: options.timeoutMs,
                fetch: options.fetch,
                parseError: options.parseError,
                beforeSend: options.beforeSend,
                sign: options.sign,
            });
            resetForm();
            thanksText.textContent = ui.thanks;
            form.hidden = true;
            thanks.hidden = false;
            thanksClose.focus();
            options.onSent?.(id);
        }
        catch (err) {
            const rejected = err instanceof SendFailedError && err.status >= 400 && err.status < 500;
            if (options.queue && report && !rejected) {
                options.queue.enqueue(report);
                resetForm();
                // The same panel as a successful send, with the one line that differs:
                // the report is safe, it is just not there yet.
                thanksText.textContent = msg.queued;
                form.hidden = true;
                thanks.hidden = false;
                thanksClose.focus();
            }
            else {
                setStatus(err instanceof SendFailedError && err.message ? err.message : msg.sendFailed, "error");
                options.onError?.(err);
            }
        }
        finally {
            sending = false;
            sendBtn.disabled = false;
            sendBtn.textContent = ui.send;
        }
    }
    function resetForm() {
        textarea.value = "";
        contactInput.value = "";
        elements = [];
        renderElements();
        clearScreenshot();
        setStatus("");
        setType(options.initialType ?? types[0] ?? "bug");
        shotBox.checked = !!options.screenshot && screenshotFor(type);
    }
    /**
     * The controls inside the panel that can take focus, in document order.
     * `[tabindex="-1"]` drops the unchecked radios, which the arrow keys reach
     * instead; `[hidden]` drops the halves of the panel that are not showing.
     */
    function focusable() {
        const nodes = panel.querySelectorAll('button:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]),input:not([disabled]),' +
            'canvas:not([tabindex="-1"])');
        return [...nodes].filter((n) => !n.hidden && !n.closest("[hidden]"));
    }
    function open() {
        if (isOpen)
            return;
        isOpen = true;
        const was = document.activeElement;
        // The host is what `document.activeElement` reports when focus is already
        // inside the shadow root; returning focus to it would be no return at all.
        returnFocus = was && was !== host && was !== document.body ? was : null;
        form.hidden = false;
        thanks.hidden = true;
        panel.hidden = false;
        applyIntro();
        trigger.setAttribute("aria-expanded", "true");
        textarea.focus();
        if (shotBox.checked)
            void capture();
    }
    function close() {
        if (!isOpen)
            return;
        isOpen = false;
        openedByError = false;
        pickController?.abort();
        // Marks already drawn are part of the draft, like the text in the box, so
        // they survive the panel being closed and reopened.
        closeEditor(true);
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        if (!thanks.hidden)
            resetForm();
        const back = returnFocus ?? (trigger.hidden ? externalTrigger : trigger);
        returnFocus = null;
        back?.focus();
    }
    // ---- wiring
    trigger.addEventListener("click", () => (isOpen ? close() : open()));
    closeBtn.addEventListener("click", close);
    thanksClose.addEventListener("click", close);
    sendBtn.addEventListener("click", () => void submit());
    pickBtn.addEventListener("click", () => void pick());
    editBtn.addEventListener("click", () => void openEditor());
    undoBtn.addEventListener("click", () => annotator?.undo());
    doneBtn.addEventListener("click", () => {
        closeEditor(true);
        // Back to the control that opened the editor, not to the top of the panel.
        editBtn.focus();
    });
    shotBox.addEventListener("change", () => {
        if (shotBox.checked)
            void capture();
        else
            clearScreenshot();
    });
    const onKey = (e) => {
        if (!isOpen || pickController)
            return;
        if (e.key === "Escape") {
            // With the editor open the key belongs to the editor: Escape there is
            // cancel — the marks nobody confirmed are dropped, the preview comes
            // back and focus returns to the button that opened it. The annotator
            // stops the key while a shape is being drawn, so what reaches this
            // handler is an editor with nothing in progress.
            if (annotator) {
                e.preventDefault();
                closeEditor(false);
                editBtn.focus();
                return;
            }
            close();
            return;
        }
        if (e.key !== "Tab")
            return;
        // The focus loop. A dialog that claims `aria-modal` has to keep focus, and
        // there is no `inert` to lean on inside a shadow root, so Tab wraps by hand.
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last)
            return;
        const active = (root.activeElement ?? document.activeElement);
        const at = active ? items.indexOf(active) : -1;
        if (e.shiftKey ? at <= 0 : at === items.length - 1 || at === -1) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
        }
    };
    root.addEventListener("keydown", onKey);
    let externalTrigger = null;
    if (options.trigger === false) {
        trigger.hidden = true;
    }
    else if (options.trigger) {
        trigger.hidden = true;
        externalTrigger =
            typeof options.trigger === "string" ? document.querySelector(options.trigger) : options.trigger;
        externalTrigger?.addEventListener("click", toggle);
        externalTrigger?.setAttribute("data-bugbottle", "trigger");
    }
    function toggle() {
        isOpen ? close() : open();
    }
    /** Opens the panel for an error the reporter has not asked us about yet. */
    function openForError(message, prefill) {
        if (isOpen)
            return;
        openedByError = true;
        if (types.includes("bug"))
            setType("bug");
        // Never overwrite what somebody has already written: they were here first.
        if (prefill && !textarea.value.trim())
            textarea.value = message;
        open();
    }
    const unsubscribes = [];
    if (options.shortcut !== false) {
        unsubscribes.push(onShortcut(options.shortcut ?? DEFAULT_SHORTCUT, toggle));
    }
    // A shake opens the panel rather than toggling it: the gesture that would
    // close it is the same one that shook it open, and a reporter mid-sentence
    // holding a phone moves it about.
    const shake = typeof options.shake === "function" ? { on: options.shake } : options.shake;
    if (shake)
        unsubscribes.push(shake.on(open, shake));
    if (options.openOnError) {
        const prefill = options.openOnError !== true && options.openOnError.prefill === true;
        unsubscribes.push(onUncaughtError((error) => openForError(error.message, prefill)));
    }
    resetForm();
    applyTexts();
    container.append(host);
    return {
        open,
        close,
        toggle,
        host,
        setLocale(next) {
            locale = next;
            ui = merge(next.ui, options.texts);
            msg = { ...next.messages, ...options.messages };
            applyTexts();
        },
        destroy() {
            closeEditor(false);
            pickController?.abort();
            for (const off of unsubscribes)
                off();
            externalTrigger?.removeEventListener("click", toggle);
            host.remove();
        },
    };
}
//# sourceMappingURL=index.js.map