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
/** The combination `mountBugbottle` uses unless told otherwise. */
export declare const DEFAULT_SHORTCUT = "mod+shift+b";
/** How long one error stays quiet after it has been reported once. */
export declare const DEFAULT_DEDUPE_MS = 60000;
/**
 * Whatever we listen on: `window`, `document`, an element, or a stand-in in a
 * test. Only the two methods are needed, so nothing here depends on the DOM
 * classes being the ones this realm happens to own.
 */
export type ListenerHost = {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
};
/** A parsed combination: the key, and which modifiers must be down with it. */
export type Shortcut = {
    key: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
};
/** The parts of a `KeyboardEvent` a match is decided from. */
export type ShortcutEvent = {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
};
/**
 * True on Apple hardware, where `mod` means Command.
 *
 * `navigator.platform` is deprecated and still the only thing every browser
 * agrees on, so the modern `userAgentData.platform` is read first and the old
 * one is the fallback. Guessing wrong costs a shortcut that does not fire, not
 * a broken page.
 */
export declare function isApplePlatform(): boolean;
/**
 * Turns `"mod+shift+b"` into the modifiers and the key.
 *
 * `mod` is the whole point of the syntax: an application writes one string and
 * Mac reporters get Command while everybody else gets Control. `ctrl`, `meta`
 * (`cmd`, `command`), `shift` and `alt` (`option`) mean themselves. The last
 * part that is not a modifier is the key, compared against `event.key` in
 * lower case.
 */
export declare function parseShortcut(combo: string, mac?: boolean): Shortcut;
/**
 * True when this keystroke is the combination. Every modifier is compared,
 * including the ones the combination does not ask for: `mod+shift+b` must not
 * fire on `mod+shift+alt+b`, which is very likely somebody else's shortcut.
 */
export declare function matchesShortcut(event: ShortcutEvent, shortcut: Shortcut): boolean;
/**
 * True for the places a reporter types. A shortcut that fires inside a text
 * field is a shortcut that eats somebody's sentence, and `mod+shift+b` is a
 * plausible thing to press by accident while writing.
 *
 * Read by duck typing rather than `instanceof`: the target may come from an
 * iframe or a shadow root whose `HTMLElement` is not this realm's.
 */
export declare function isEditableTarget(target: unknown): boolean;
export type ShortcutOptions = {
    /** What to listen on. Default `document`. */
    target?: ListenerHost;
    /** Force the `mod` meaning instead of sniffing the platform. Mostly for tests. */
    mac?: boolean;
};
/**
 * Calls `handler` when the combination is pressed, unless the reporter is
 * typing. Returns the unsubscribe. A match is also `preventDefault`ed, so the
 * browser does not act on a keystroke that has just opened a form.
 *
 * ```ts
 * const off = onShortcut("mod+shift+b", () => widget.open());
 * ```
 */
export declare function onShortcut(combo: string, handler: (event: KeyboardEvent) => void, options?: ShortcutOptions): () => void;
/** One uncaught error, described the same way whether it threw or rejected. */
export type UncaughtError = {
    /** What the console would show. Never empty — an error without one is ignored. */
    message: string;
    /** The value that was thrown or rejected with, when there was one. */
    error: unknown;
    /** Which listener saw it. */
    source: "error" | "unhandledrejection";
    /** The first line of the stack, trimmed, or an empty string. */
    frame: string;
    /** `message` and `frame`, hashed. The same throw site gives the same value. */
    fingerprint: string;
};
export type UncaughtErrorOptions = {
    /**
     * How long one fingerprint stays quiet after it has been handled. Default
     * 60 000 ms; `0` reports every occurrence. This is what makes auto-open safe:
     * a component that throws on every render throws all afternoon.
     */
    dedupeMs?: number;
    /** Return true to drop this one — a browser extension, a cancelled request. */
    ignore?: (error: UncaughtError) => boolean;
    /** What to listen on. Default `window`. */
    target?: ListenerHost;
};
/**
 * Describes an `error` or `unhandledrejection` event, or returns null when
 * there is nothing to report. A failed image load reaches the same listener
 * with no message and no error, and is not a bug the reporter can describe.
 */
export declare function describeUncaught(event: unknown): UncaughtError | null;
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
export declare function onUncaughtError(handler: (error: UncaughtError) => void, options?: UncaughtErrorOptions): () => void;
//# sourceMappingURL=triggers.d.ts.map