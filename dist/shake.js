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
/** The acceleration a shake has to reach, in m/s², after gravity is filtered out. */
export const DEFAULT_SHAKE_THRESHOLD = 15;
/** How long the detector stays quiet after it has fired once. */
export const DEFAULT_SHAKE_COOLDOWN_MS = 3_000;
/** How long a crossing counts towards the shake it belongs to. */
export const DEFAULT_SHAKE_WINDOW_MS = 1_000;
/** How many alternating crossings make a shake rather than a bump. */
const REQUIRED_CROSSINGS = 3;
/**
 * How much of the previous reading the gravity estimate keeps. A phone lying
 * still reads about 9.8 m/s² on one axis forever, so the raw numbers say
 * nothing on their own; what a shake looks like is the part that changes. This
 * is the smoothing constant of a one-pole low-pass filter, and subtracting its
 * output is the high-pass filter. 0.8 settles within a few readings at the 60 Hz
 * phones sample at, and still ignores a slow tilt.
 */
const GRAVITY_SMOOTHING = 0.8;
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
export async function requestShakePermission() {
    const motion = globalThis.DeviceMotionEvent;
    if (typeof motion?.requestPermission !== "function")
        return "unsupported";
    try {
        return (await motion.requestPermission()) === "granted" ? "granted" : "denied";
    }
    catch {
        // Safari rejects when the call did not come from a user gesture. The page
        // has no permission either way, and a rejected promise nobody awaited is a
        // worse outcome than a plain answer.
        return "denied";
    }
}
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
export function onShake(handler, options = {}) {
    const found = options.target ?? (typeof window === "undefined" ? undefined : window);
    if (!found)
        return () => { };
    const host = found;
    const threshold = options.threshold ?? DEFAULT_SHAKE_THRESHOLD;
    const cooldownMs = options.cooldownMs ?? DEFAULT_SHAKE_COOLDOWN_MS;
    const windowMs = options.windowMs ?? DEFAULT_SHAKE_WINDOW_MS;
    let gravity = null;
    let lastDirection = 0;
    let crossings = [];
    let quietUntil = 0;
    function reset() {
        gravity = null;
        lastDirection = 0;
        crossings = [];
    }
    const listener = (event) => {
        const reading = event.accelerationIncludingGravity;
        if (!reading)
            return;
        const axes = [
            typeof reading.x === "number" ? reading.x : 0,
            typeof reading.y === "number" ? reading.y : 0,
            typeof reading.z === "number" ? reading.z : 0,
        ];
        // The first reading is all gravity as far as we know, so it defines the
        // rest position rather than counting as movement.
        if (!gravity) {
            gravity = axes;
            return;
        }
        let moved = 0;
        for (let i = 0; i < 3; i++) {
            const raw = axes[i];
            const settled = gravity[i] * GRAVITY_SMOOTHING + raw * (1 - GRAVITY_SMOOTHING);
            gravity[i] = settled;
            const high = raw - settled;
            // One axis decides. A shake is a direction, and summing the axes would
            // let three small wobbles add up to one that never happened.
            if (Math.abs(high) > Math.abs(moved))
                moved = high;
        }
        if (Math.abs(moved) < threshold)
            return;
        const direction = moved > 0 ? 1 : -1;
        // Several readings of the same swing are one crossing; the swing back is
        // the next one.
        if (direction === lastDirection)
            return;
        lastDirection = direction;
        const now = Date.now();
        crossings = [...crossings.filter((at) => at > now - windowMs), now];
        if (crossings.length < REQUIRED_CROSSINGS || now < quietUntil)
            return;
        quietUntil = now + cooldownMs;
        reset();
        handler();
    };
    const doc = typeof document === "undefined" ? null : document;
    let listening = false;
    function listen(on) {
        if (on === listening)
            return;
        listening = on;
        if (on)
            host.addEventListener("devicemotion", listener);
        else {
            host.removeEventListener("devicemotion", listener);
            // The phone has been moving all the while we were not looking; whatever
            // half a shake we remembered is meaningless now.
            reset();
        }
    }
    const onVisibility = () => listen(doc?.visibilityState !== "hidden");
    listen(doc?.visibilityState !== "hidden");
    doc?.addEventListener("visibilitychange", onVisibility);
    return () => {
        listen(false);
        doc?.removeEventListener("visibilitychange", onVisibility);
    };
}
//# sourceMappingURL=shake.js.map