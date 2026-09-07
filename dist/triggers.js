/**
 * Two ways to open a report form that do not need a button on the page.
 *
 * `onShortcut` listens for a key combination — `mod+shift+b` by default, where
 * `mod` is Command on a Mac and Control everywhere else — and stays out of the
 * way while somebody is typing. `onUncaughtError` listens for the errors the
 * application did not catch and calls you once per distinct error, so a render
 * loop that throws a hundred times does not open a hundred panels.
 *
 * Both are listeners and nothing else: they never touch the DOM, never render,
 * and hand back the unsubscribe. `bugbottle/ui` wires them to its panel, a
 * hand-built form wires them to its own state, and an application that wants
 * neither pays for neither — this is a separate entry point (`bugbottle/triggers`).
 */
import { stableHash } from "./fingerprint.js";
/** The combination `mountBugbottle` uses unless told otherwise. */
export const DEFAULT_SHORTCUT = "mod+shift+b";
/** How long one error stays quiet after it has been reported once. */
export const DEFAULT_DEDUPE_MS = 60_000;
/**
 * True on Apple hardware, where `mod` means Command.
 *
 * `navigator.platform` is deprecated and still the only thing every browser
 * agrees on, so the modern `userAgentData.platform` is read first and the old
 * one is the fallback. Guessing wrong costs a shortcut that does not fire, not
 * a broken page.
 */
export function isApplePlatform() {
    if (typeof navigator === "undefined")
        return false;
    const nav = navigator;
    return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}
/**
 * Turns `"mod+shift+b"` into the modifiers and the key.
 *
 * `mod` is the whole point of the syntax: an application writes one string and
 * Mac reporters get Command while everybody else gets Control. `ctrl`, `meta`
 * (`cmd`, `command`), `shift` and `alt` (`option`) mean themselves. The last
 * part that is not a modifier is the key, compared against `event.key` in
 * lower case.
 */
export function parseShortcut(combo, mac = isApplePlatform()) {
    const shortcut = { key: "", ctrl: false, meta: false, shift: false, alt: false };
    for (const raw of combo.toLowerCase().split("+")) {
        const part = raw.trim();
        if (!part)
            continue;
        if (part === "mod") {
            if (mac)
                shortcut.meta = true;
            else
                shortcut.ctrl = true;
        }
        else if (part === "ctrl" || part === "control")
            shortcut.ctrl = true;
        else if (part === "meta" || part === "cmd" || part === "command")
            shortcut.meta = true;
        else if (part === "shift")
            shortcut.shift = true;
        else if (part === "alt" || part === "option")
            shortcut.alt = true;
        else
            shortcut.key = part;
    }
    return shortcut;
}
/**
 * True when this keystroke is the combination. Every modifier is compared,
 * including the ones the combination does not ask for: `mod+shift+b` must not
 * fire on `mod+shift+alt+b`, which is very likely somebody else's shortcut.
 */
export function matchesShortcut(event, shortcut) {
    return (shortcut.key !== "" &&
        typeof event.key === "string" &&
        event.key.toLowerCase() === shortcut.key &&
        event.ctrlKey === shortcut.ctrl &&
        event.metaKey === shortcut.meta &&
        event.shiftKey === shortcut.shift &&
        event.altKey === shortcut.alt);
}
/**
 * True for the places a reporter types. A shortcut that fires inside a text
 * field is a shortcut that eats somebody's sentence, and `mod+shift+b` is a
 * plausible thing to press by accident while writing.
 *
 * Read by duck typing rather than `instanceof`: the target may come from an
 * iframe or a shadow root whose `HTMLElement` is not this realm's.
 */
export function isEditableTarget(target) {
    if (!target || typeof target !== "object")
        return false;
    const node = target;
    if (node.isContentEditable === true)
        return true;
    const tag = typeof node.tagName === "string" ? node.tagName.toUpperCase() : "";
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
/**
 * The element a keystroke actually came from.
 *
 * An event that crosses a shadow boundary is retargeted on the way out: by the
 * time a `keydown` from a textarea inside a shadow root reaches `document`, its
 * `target` is the host element, which is not editable and would let the
 * shortcut fire over somebody's sentence. `composedPath()[0]` is the node the
 * event started at, before any of that. It is missing on older browsers and on
 * synthetic events, so `target` remains the fallback.
 */
export function eventSource(event) {
    const e = event;
    const path = typeof e?.composedPath === "function" ? e.composedPath() : null;
    return (Array.isArray(path) && path.length > 0 ? path[0] : e?.target) ?? null;
}
/**
 * The deepest focused element, following `activeElement` down through every
 * shadow root on the way.
 *
 * `document.activeElement` stops at the host of a shadow tree, so a panel that
 * lives in one reports itself as focused however deep the caret really is. The
 * chain is what says whether the reporter is typing.
 */
export function deepActiveElement(root) {
    const doc = typeof document === "undefined" ? null : document;
    let active = (root ?? doc)?.activeElement;
    // A shadow root with no focus of its own reports null, and then the host it
    // belongs to is the answer.
    for (;;) {
        const inner = active?.shadowRoot?.activeElement;
        if (!inner || inner === active)
            break;
        active = inner;
    }
    // A node taken out of the document is not where anybody is typing, whatever
    // the browser still remembers about it.
    return active && active.isConnected !== false ? active : null;
}
/**
 * Calls `handler` when the combination is pressed, unless the reporter is
 * typing. Returns the unsubscribe. A match is also `preventDefault`ed, so the
 * browser does not act on a keystroke that has just opened a form.
 *
 * ```ts
 * const off = onShortcut("mod+shift+b", () => widget.open());
 * ```
 */
export function onShortcut(combo, handler, options = {}) {
    const host = options.target ?? (typeof document === "undefined" ? undefined : document);
    if (!host)
        return () => { };
    const shortcut = parseShortcut(combo, options.mac ?? isApplePlatform());
    const listener = (event) => {
        const key = event;
        if (!matchesShortcut(key, shortcut))
            return;
        // Two questions, because either can be the one that knows: the composed
        // path says where the keystroke came from, and the focus chain says where
        // the caret is when the event is synthetic or the path has been lost.
        if (isEditableTarget(eventSource(key)) || isEditableTarget(deepActiveElement()))
            return;
        key.preventDefault?.();
        handler(event);
    };
    host.addEventListener("keydown", listener);
    return () => host.removeEventListener("keydown", listener);
}
/** Never let the map grow without bound, whatever the traffic looks like. */
const MAX_SEEN_ERRORS = 500;
/** The first stack line that names a frame. Runtimes disagree on the format. */
function firstFrame(error) {
    const stack = error instanceof Error ? error.stack : undefined;
    if (typeof stack !== "string")
        return "";
    for (const line of stack.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("at ") || trimmed.includes("@"))
            return trimmed;
    }
    return "";
}
/**
 * Describes an `error` or `unhandledrejection` event, or returns null when
 * there is nothing to report. A failed image load reaches the same listener
 * with no message and no error, and is not a bug the reporter can describe.
 */
export function describeUncaught(event) {
    if (!event || typeof event !== "object")
        return null;
    const e = event;
    const rejection = e.type === "unhandledrejection" || e.reason !== undefined;
    const thrown = rejection ? e.reason : e.error;
    const message = thrown instanceof Error && thrown.message
        ? thrown.message
        : typeof e.message === "string" && e.message
            ? e.message
            : thrown === undefined || thrown === null
                ? ""
                : String(thrown);
    if (!message)
        return null;
    const frame = firstFrame(thrown);
    return {
        message,
        error: thrown,
        source: rejection ? "unhandledrejection" : "error",
        frame,
        fingerprint: stableHash(`${message}\n${frame}`),
    };
}
/**
 * Calls `handler` for each distinct uncaught error — thrown or rejected — and
 * returns the unsubscribe.
 *
 * ```ts
 * const off = onUncaughtError((e) => widget.open(), { dedupeMs: 60_000 });
 * ```
 *
 * Nothing here reports anything by itself. It says an error happened; what to
 * do about it is the application's decision.
 */
export function onUncaughtError(handler, options = {}) {
    const host = options.target ?? (typeof window === "undefined" ? undefined : window);
    if (!host)
        return () => { };
    const dedupeMs = options.dedupeMs ?? DEFAULT_DEDUPE_MS;
    const seen = new Map();
    const listener = (event) => {
        const described = describeUncaught(event);
        if (!described)
            return;
        if (options.ignore?.(described))
            return;
        if (dedupeMs > 0) {
            const now = Date.now();
            for (const [key, at] of seen)
                if (at + dedupeMs <= now)
                    seen.delete(key);
            const last = seen.get(described.fingerprint);
            if (last !== undefined && last + dedupeMs > now)
                return;
            if (seen.size >= MAX_SEEN_ERRORS)
                seen.clear();
            seen.set(described.fingerprint, now);
        }
        handler(described);
    };
    host.addEventListener("error", listener);
    host.addEventListener("unhandledrejection", listener);
    return () => {
        host.removeEventListener("error", listener);
        host.removeEventListener("unhandledrejection", listener);
    };
}
//# sourceMappingURL=triggers.js.map