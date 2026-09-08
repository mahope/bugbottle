/**
 * Shake the phone to report a bug.
 *
 * On a laptop the keyboard shortcut in `bugbottle/triggers` is the way in with
 * no button; on a phone there is no keyboard, and shaking the device is what
 * people already expect from a bug reporter. This module is that gesture and
 * nothing else: it listens on `devicemotion`, decides when a shake happened,
 * and hands back the unsubscribe in the same shape `onShortcut` does. It never
 * renders, never sends, and never asks for permission.
 *
 * It is its own entry point (`bugbottle/shake`) because `bugbottle/triggers`
 * measures within a hundred bytes of its budget and a phone gesture is not
 * something a desktop application should pay for.
 *
 * Two facts about phones are worth knowing before wiring this up. On iOS 13
 * and later Safari delivers no motion events at all until
 * `DeviceMotionEvent.requestPermission()` has been called from inside a user
 * gesture and granted — that is `requestShakePermission` below, and the
 * application decides which button calls it. And motion events are a secure
 * context feature: a page served over plain HTTP gets none, whatever the
 * permission says.
 */
import type { ListenerHost } from "./triggers.ts";
/** The acceleration a shake has to reach, in m/s², after gravity is filtered out. */
export declare const DEFAULT_SHAKE_THRESHOLD = 15;
/** How long the detector stays quiet after it has fired once. */
export declare const DEFAULT_SHAKE_COOLDOWN_MS = 3000;
/** How long a crossing counts towards the shake it belongs to. */
export declare const DEFAULT_SHAKE_WINDOW_MS = 1000;
export type ShakeOptions = {
    /**
     * Acceleration a crossing has to reach, in m/s². Default 15. Lower is more
     * sensitive: 10 fires on a firm flick, 20 wants a deliberate shake.
     */
    threshold?: number;
    /** How long to stay quiet after firing. Default 3000 ms. */
    cooldownMs?: number;
    /** How long the crossings of one shake may be spread over. Default 1000 ms. */
    windowMs?: number;
    /** What to listen on. Default `window`. */
    target?: ListenerHost;
};
/** The parts of a `DeviceMotionEvent` the detector reads. */
export type ShakeEvent = {
    accelerationIncludingGravity?: {
        x?: number | null;
        y?: number | null;
        z?: number | null;
    } | null;
};
/**
 * Asks iOS Safari for permission to read motion, and says what happened.
 *
 * `"unsupported"` means the browser has no such gate — every browser but
 * Safari, where motion events simply arrive — and is not a failure: `onShake`
 * works there without anybody calling this. On Safari the call must happen
 * inside a user gesture, so it belongs on a button the reporter pressed; called
 * from a `load` handler it rejects, which is reported here as `"denied"`.
 *
 * ```ts
 * button.addEventListener("click", async () => {
 *   if ((await requestShakePermission()) === "granted") widget.open();
 * });
 * ```
 */
export declare function requestShakePermission(): Promise<"granted" | "denied" | "unsupported">;
/**
 * Calls `handler` once per shake and returns the unsubscribe.
 *
 * A shake is three crossings of the threshold with alternating direction inside
 * one second, measured on whichever axis is moving most after gravity has been
 * filtered out. Alternation is what separates a shake from a drop: falling onto
 * a desk is one large reading in one direction, and shaking is back and forth.
 * After a shake the detector is quiet for the cool-down, so one gesture opens
 * one panel however long the reporter keeps shaking.
 *
 * Nothing is measured while the page is hidden: the listener is removed on
 * `visibilitychange` and put back when the page returns, so a phone in a pocket
 * with a background tab costs nothing.
 *
 * ```ts
 * const off = onShake(() => widget.open(), { threshold: 12 });
 * ```
 */
export declare function onShake(handler: () => void, options?: ShakeOptions): () => void;
//# sourceMappingURL=shake.d.ts.map