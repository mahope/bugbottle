import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { ListenerHost } from "../src/triggers.ts";

/**
 * The shake detector needs a document to ask about visibility and a window to
 * listen on, so this file puts a happy-dom window on `globalThis` before the
 * module is imported, the same way the panel's tests do. The motion readings
 * themselves are plain objects: everything the detector reads from an event it
 * reads by name, which is what lets it work on a phone whose `DeviceMotionEvent`
 * is not this realm's.
 */
const win = new Window({ url: "https://example.test/orders" });
const globals = globalThis as unknown as Record<string, unknown>;
const forced = new Set(["window", "document", "navigator", "location", "Event", "CustomEvent"]);
for (const key of Object.getOwnPropertyNames(win)) {
  if (key.startsWith("_")) continue;
  if (!forced.has(key) && key in globals) continue;
  try {
    globals[key] = (win as unknown as Record<string, unknown>)[key];
  } catch {
    // A few properties are getter-only on the window; none of them matter here.
  }
}

const { DEFAULT_SHAKE_COOLDOWN_MS, DEFAULT_SHAKE_THRESHOLD, onShake, requestShakePermission } =
  await import("../src/shake.ts");

/** A stand-in for `window` that says how many listeners are still on it. */
function fakeHost() {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  const host: ListenerHost = {
    addEventListener(type: string, listener: (event: Event) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== listener),
      );
    },
  };
  return {
    host,
    emit(x: number, y = 0, z = 9.8) {
      const event = { accelerationIncludingGravity: { x, y, z } } as unknown as Event;
      for (const listener of [...(listeners.get("devicemotion") ?? [])]) listener(event);
    },
    emitRaw(event: unknown) {
      for (const listener of [...(listeners.get("devicemotion") ?? [])]) listener(event as Event);
    },
    get count() {
      return [...listeners.values()].reduce((n, l) => n + l.length, 0);
    },
  };
}

/** The still phone that seeds the gravity estimate before anything moves. */
function settle(fake: ReturnType<typeof fakeHost>) {
  fake.emit(0);
}

/** One swing, well past the threshold, in the given direction. */
function swing(fake: ReturnType<typeof fakeHost>, direction: number) {
  fake.emit(direction * (DEFAULT_SHAKE_THRESHOLD + 15));
}

test("three alternating crossings within the window are one shake", () => {
  const fake = fakeHost();
  let shakes = 0;
  onShake(() => shakes++, { target: fake.host });
  settle(fake);
  swing(fake, 1);
  swing(fake, -1);
  swing(fake, 1);
  assert.equal(shakes, 1);
});

test("two crossings are a bump, not a shake", () => {
  const fake = fakeHost();
  let shakes = 0;
  onShake(() => shakes++, { target: fake.host });
  settle(fake);
  swing(fake, 1);
  swing(fake, -1);
  assert.equal(shakes, 0);
});

test("crossings in the same direction do not add up", () => {
  const fake = fakeHost();
  let shakes = 0;
  onShake(() => shakes++, { target: fake.host });
  settle(fake);
  // A phone dropped on a desk reads one large acceleration several times over.
  for (let i = 0; i < 6; i++) swing(fake, 1);
  assert.equal(shakes, 0);
});

test("movement under the threshold is ignored", () => {
  const fake = fakeHost();
  let shakes = 0;
  onShake(() => shakes++, { target: fake.host, threshold: 30 });
  settle(fake);
  for (let i = 0; i < 6; i++) swing(fake, i % 2 === 0 ? 1 : -1);
  assert.equal(shakes, 0);
});

test("the cool-down keeps one gesture to one panel", () => {
  const fake = fakeHost();
  let shakes = 0;
  onShake(() => shakes++, { target: fake.host });
  settle(fake);
  for (let i = 0; i < 12; i++) swing(fake, i % 2 === 0 ? 1 : -1);
  assert.equal(shakes, 1);
});

test("the cool-down ends and a later shake fires again", async () => {
  const fake = fakeHost();
  let shakes = 0;
  onShake(() => shakes++, { target: fake.host, cooldownMs: 5 });
  settle(fake);
  swing(fake, 1);
  swing(fake, -1);
  swing(fake, 1);
  assert.equal(shakes, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  settle(fake);
  swing(fake, 1);
  swing(fake, -1);
  swing(fake, 1);
  assert.equal(shakes, 2);
});

test("crossings older than the window are forgotten", async () => {
  const fake = fakeHost();
  let shakes = 0;
  onShake(() => shakes++, { target: fake.host, windowMs: 5 });
  settle(fake);
  swing(fake, 1);
  swing(fake, -1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  swing(fake, 1);
  assert.equal(shakes, 0);
});

test("a reading without acceleration is ignored", () => {
  const fake = fakeHost();
  let shakes = 0;
  onShake(() => shakes++, { target: fake.host });
  fake.emitRaw({});
  fake.emitRaw({ accelerationIncludingGravity: null });
  // A phone that only reports some axes still works; the missing ones are zero.
  fake.emitRaw({ accelerationIncludingGravity: { x: 0 } });
  fake.emitRaw({ accelerationIncludingGravity: { x: 40, y: null } });
  fake.emitRaw({ accelerationIncludingGravity: { x: -40 } });
  fake.emitRaw({ accelerationIncludingGravity: { x: 40 } });
  assert.equal(shakes, 1);
});

test("stop removes the listener", () => {
  const fake = fakeHost();
  let shakes = 0;
  const stop = onShake(() => shakes++, { target: fake.host });
  assert.equal(fake.count, 1);
  stop();
  assert.equal(fake.count, 0);
  settle(fake);
  swing(fake, 1);
  swing(fake, -1);
  swing(fake, 1);
  assert.equal(shakes, 0);
});

test("nothing is measured while the page is hidden", () => {
  const fake = fakeHost();
  let shakes = 0;
  const stop = onShake(() => shakes++, { target: fake.host });
  settle(fake);
  swing(fake, 1);

  Object.defineProperty(win.document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  win.document.dispatchEvent(new win.Event("visibilitychange"));
  assert.equal(fake.count, 0);
  swing(fake, -1);
  swing(fake, 1);
  swing(fake, -1);
  assert.equal(shakes, 0);

  Object.defineProperty(win.document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  win.document.dispatchEvent(new win.Event("visibilitychange"));
  assert.equal(fake.count, 1);
  // The half shake from before the page was hidden is gone with it.
  settle(fake);
  swing(fake, 1);
  swing(fake, -1);
  assert.equal(shakes, 0);
  swing(fake, 1);
  assert.equal(shakes, 1);
  stop();
});

test("the defaults are the documented ones", () => {
  assert.equal(DEFAULT_SHAKE_THRESHOLD, 15);
  assert.equal(DEFAULT_SHAKE_COOLDOWN_MS, 3_000);
});

test("requestShakePermission is unsupported where the gate does not exist", async () => {
  delete globals.DeviceMotionEvent;
  assert.equal(await requestShakePermission(), "unsupported");
});

test("requestShakePermission passes granted and denied through", async () => {
  globals.DeviceMotionEvent = { requestPermission: async () => "granted" };
  assert.equal(await requestShakePermission(), "granted");
  globals.DeviceMotionEvent = { requestPermission: async () => "denied" };
  assert.equal(await requestShakePermission(), "denied");
  // Anything else Safari might answer is not permission to read motion.
  globals.DeviceMotionEvent = { requestPermission: async () => "prompt" };
  assert.equal(await requestShakePermission(), "denied");
  delete globals.DeviceMotionEvent;
});

test("a rejected permission call is denied rather than thrown", async () => {
  // Safari rejects when the call did not come from a user gesture.
  globals.DeviceMotionEvent = {
    requestPermission: async () => {
      throw new Error("requires a user gesture");
    },
  };
  assert.equal(await requestShakePermission(), "denied");
  delete globals.DeviceMotionEvent;
});
