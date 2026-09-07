import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { fingerprint, stableHash } from "../src/fingerprint.ts";
import {
  DEFAULT_SHORTCUT,
  deepActiveElement,
  describeUncaught,
  isEditableTarget,
  matchesShortcut,
  onShortcut,
  onUncaughtError,
  parseShortcut,
  type ListenerHost,
  type UncaughtError,
} from "../src/triggers.ts";

/**
 * The triggers are listeners and nothing else, so they are tested against a
 * stand-in target rather than a DOM. Everything they read from an event —
 * the key, the modifiers, the message, the stack — is read by name, which is
 * exactly what makes them work across an iframe or a shadow root as well.
 */
function fakeHost() {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  const host: ListenerHost = {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener));
    },
  };
  return {
    host,
    emit(type: string, event: unknown) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event as Event);
    },
    get count() {
      return [...listeners.values()].reduce((n, l) => n + l.length, 0);
    },
  };
}

type KeydownLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: unknown;
};

/** A keydown the way a browser sends one, plus a `preventDefault` that counts. */
function keydown(overrides: Partial<KeydownLike> = {}) {
  let prevented = 0;
  return {
    key: "b",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: null as unknown,
    preventDefault() {
      prevented += 1;
    },
    get prevented() {
      return prevented;
    },
    ...overrides,
  };
}

test("mod is Command on a Mac and Control everywhere else", () => {
  const mac = parseShortcut(DEFAULT_SHORTCUT, true);
  assert.deepEqual(mac, { key: "b", ctrl: false, meta: true, shift: true, alt: false });

  const other = parseShortcut(DEFAULT_SHORTCUT, false);
  assert.deepEqual(other, { key: "b", ctrl: true, meta: false, shift: true, alt: false });
});

test("the modifier names people actually write are all understood", () => {
  assert.deepEqual(parseShortcut("Cmd+Shift+K", false), {
    key: "k",
    ctrl: false,
    meta: true,
    shift: true,
    alt: false,
  });
  assert.deepEqual(parseShortcut(" control + option + / ", false), {
    key: "/",
    ctrl: true,
    meta: false,
    shift: false,
    alt: true,
  });
});

test("a match needs exactly the modifiers the combination names", () => {
  const shortcut = parseShortcut("mod+shift+b", false);
  assert.equal(matchesShortcut(keydown({ ctrlKey: true, shiftKey: true }), shortcut), true);
  // The reporter is holding a capital B, so `key` arrives upper case.
  assert.equal(
    matchesShortcut(keydown({ key: "B", ctrlKey: true, shiftKey: true }), shortcut),
    true,
  );
  // One modifier too many is very likely somebody else's shortcut.
  assert.equal(
    matchesShortcut(keydown({ ctrlKey: true, shiftKey: true, altKey: true }), shortcut),
    false,
  );
  assert.equal(matchesShortcut(keydown({ ctrlKey: true }), shortcut), false);
  assert.equal(matchesShortcut(keydown({ key: "n", ctrlKey: true, shiftKey: true }), shortcut), false);
});

test("a combination without a key never matches", () => {
  assert.equal(matchesShortcut(keydown(), parseShortcut("shift", false)), false);
});

test("fields and contenteditable regions are where people type", () => {
  assert.equal(isEditableTarget({ tagName: "INPUT" }), true);
  assert.equal(isEditableTarget({ tagName: "textarea" }), true);
  assert.equal(isEditableTarget({ tagName: "SELECT" }), true);
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: "DIV" }), false);
  assert.equal(isEditableTarget(null), false);
  assert.equal(isEditableTarget("body"), false);
});

test("the shortcut fires, prevents the default, and unsubscribes", () => {
  const { host, emit } = fakeHost();
  let opened = 0;
  const off = onShortcut("mod+shift+b", () => (opened += 1), { target: host, mac: false });

  const event = keydown({ ctrlKey: true, shiftKey: true });
  emit("keydown", event);
  assert.equal(opened, 1);
  assert.equal(event.prevented, 1);

  emit("keydown", keydown({ ctrlKey: true }));
  assert.equal(opened, 1, "a near miss does not open anything");

  off();
  emit("keydown", keydown({ ctrlKey: true, shiftKey: true }));
  assert.equal(opened, 1, "the listener is gone");
});

test("the shortcut stays out of the way while the reporter is typing", () => {
  const { host, emit } = fakeHost();
  let opened = 0;
  onShortcut("mod+shift+b", () => (opened += 1), { target: host, mac: false });

  const typing = keydown({ ctrlKey: true, shiftKey: true, target: { tagName: "TEXTAREA" } });
  emit("keydown", typing);
  assert.equal(opened, 0);
  assert.equal(typing.prevented, 0, "the keystroke is left alone as well");

  const editing = keydown({
    ctrlKey: true,
    shiftKey: true,
    target: { tagName: "DIV", isContentEditable: true },
  });
  emit("keydown", editing);
  assert.equal(opened, 0);
});

test("an uncaught error is described from the thrown value", () => {
  const error = new Error("Cannot read properties of undefined");
  const described = describeUncaught({ type: "error", message: "Uncaught Error", error });
  assert.ok(described);
  assert.equal(described.message, "Cannot read properties of undefined");
  assert.equal(described.source, "error");
  assert.ok(described.frame.length > 0, "the first stack frame is kept");
  assert.equal(described.fingerprint, stableHash(`${described.message}\n${described.frame}`));
});

test("a rejection is described from its reason, however it was rejected", () => {
  const fromError = describeUncaught({ type: "unhandledrejection", reason: new Error("no token") });
  assert.equal(fromError?.message, "no token");
  assert.equal(fromError?.source, "unhandledrejection");

  const fromString = describeUncaught({ type: "unhandledrejection", reason: "no token" });
  assert.equal(fromString?.message, "no token");
  assert.equal(fromString?.frame, "", "a string has no stack");
});

test("an event with nothing to report is ignored", () => {
  // A failed image load reaches the same listener with neither a message nor
  // an error, and is not a bug the reporter could describe.
  assert.equal(describeUncaught({ type: "error" }), null);
  assert.equal(describeUncaught(null), null);
  assert.equal(describeUncaught("error"), null);
});

test("the same error is handled once per dedupe window", async () => {
  const { host, emit } = fakeHost();
  const seen: UncaughtError[] = [];
  const off = onUncaughtError((e) => seen.push(e), { target: host, dedupeMs: 40 });
  const error = new Error("render loop");

  for (let i = 0; i < 5; i += 1) emit("error", { type: "error", error });
  assert.equal(seen.length, 1, "a loop of the same error opens one panel");

  // A different error is a different fingerprint, so it is not swallowed.
  emit("error", { type: "error", error: new Error("something else") });
  assert.equal(seen.length, 2);

  await sleep(60);
  emit("error", { type: "error", error });
  assert.equal(seen.length, 3, "the window has passed, so it is news again");

  off();
  emit("error", { type: "error", error: new Error("after unsubscribe") });
  assert.equal(seen.length, 3);
});

test("dedupeMs 0 reports every occurrence", () => {
  const { host, emit } = fakeHost();
  let calls = 0;
  onUncaughtError(() => (calls += 1), { target: host, dedupeMs: 0 });
  const error = new Error("every time");
  emit("error", { type: "error", error });
  emit("error", { type: "error", error });
  assert.equal(calls, 2);
});

test("ignore drops the errors an application already knows about", () => {
  const { host, emit } = fakeHost();
  const seen: string[] = [];
  onUncaughtError((e) => seen.push(e.message), {
    target: host,
    ignore: (e) => e.message.includes("extension"),
  });
  emit("error", { type: "error", error: new Error("chrome-extension noise") });
  emit("error", { type: "error", error: new Error("real failure") });
  assert.deepEqual(seen, ["real failure"]);
});

test("unsubscribing removes both listeners", () => {
  const { host, emit } = fakeHost();
  let calls = 0;
  const off = onUncaughtError(() => (calls += 1), { target: host });
  off();
  emit("error", { type: "error", error: new Error("gone") });
  emit("unhandledrejection", { type: "unhandledrejection", reason: new Error("gone too") });
  assert.equal(calls, 0);
});

test("a report fingerprints the same however its whitespace fell", () => {
  const one = fingerprint({
    type: "bug",
    message: "The save button does nothing",
    console: [{ level: "error", message: "save failed" }],
  });
  const two = fingerprint({
    type: "bug",
    message: "  The save   button\ndoes nothing  ",
    console: [{ level: "error", message: "save failed" }],
  });
  assert.equal(one, two);
});

test("the first console error is part of the identity, and warnings are not", () => {
  const base = { type: "bug", message: "It broke" };
  const withError = fingerprint({ ...base, console: [{ level: "error", message: "boom" }] });
  const withOther = fingerprint({ ...base, console: [{ level: "error", message: "bang" }] });
  const withWarning = fingerprint({ ...base, console: [{ level: "warn", message: "boom" }] });
  assert.notEqual(withError, withOther);
  assert.equal(withWarning, fingerprint(base), "a warning is not what makes a report distinct");
});

test("a fingerprint survives a malformed report", () => {
  assert.equal(typeof fingerprint({}), "string");
  assert.equal(fingerprint({ type: 7, message: null, console: "nonsense" }), fingerprint({}));
});

/**
 * A shadow root hides the reporter from a listener on the document twice over:
 * the event is retargeted to the host on its way out, and `document.activeElement`
 * stops at the host as well. The panel this package ships lives in one, so the
 * shortcut used to fire straight through somebody typing in its own textarea.
 */
test("a keydown retargeted to a shadow host is read from the composed path", () => {
  const { host, emit } = fakeHost();
  const input = { tagName: "INPUT" };
  const shadowHost = { tagName: "BB-WIDGET" };
  let opened = 0;
  const off = onShortcut("mod+shift+b", () => (opened += 1), { target: host, mac: false });

  // What a browser hands a document-level listener for a keystroke that started
  // inside a shadow tree: the target is the host, the path still has the input.
  const fromInput = { ...keydown({ ctrlKey: true, shiftKey: true, target: shadowHost }) };
  emit("keydown", { ...fromInput, composedPath: () => [input, shadowHost] });
  assert.equal(opened, 0, "the composed path knows the reporter is in a field");

  emit("keydown", { ...fromInput, composedPath: () => [shadowHost] });
  assert.equal(opened, 1, "and lets the keystroke through when they are not");
  off();
});

test("the focus chain is followed through shadow roots", () => {
  const inner = { tagName: "TEXTAREA", isConnected: true };
  const shadowHost = {
    tagName: "BB-WIDGET",
    isConnected: true,
    shadowRoot: { activeElement: inner },
  };
  assert.equal(deepActiveElement({ activeElement: shadowHost }), inner);
  // A host whose shadow tree has no focus of its own is itself the answer.
  const unfocused = { ...shadowHost, shadowRoot: { activeElement: null } };
  assert.equal(deepActiveElement({ activeElement: unfocused }), unfocused);
  // Nothing focused, or a focused node that has been taken out of the document.
  assert.equal(deepActiveElement({ activeElement: null }), null);
  assert.equal(deepActiveElement({ activeElement: { tagName: "INPUT", isConnected: false } }), null);
  assert.equal(deepActiveElement(null), null);
});

test("the shortcut does not fire while the caret is inside a shadow root", async () => {
  const { Window } = await import("happy-dom");
  const win = new Window();
  const doc = win.document;
  const shadowHost = doc.createElement("div");
  doc.body.append(shadowHost);
  const input = doc.createElement("input");
  shadowHost.attachShadow({ mode: "open" }).append(input);

  const globals = globalThis as unknown as Record<string, unknown>;
  const had = "document" in globals;
  const previous = globals["document"];
  globals["document"] = doc;
  try {
    let opened = 0;
    const off = onShortcut("mod+shift+b", () => (opened += 1), {
      target: doc as unknown as ListenerHost,
      mac: false,
    });
    const press = (from: unknown) =>
      (from as { dispatchEvent: (event: unknown) => unknown }).dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "b",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );

    input.focus();
    // `document.activeElement` is the host, which is not a field of any kind;
    // only the chain through its shadow root reaches the input.
    assert.equal((doc.activeElement as unknown as { tagName: string }).tagName, "DIV");

    // The keystroke as the reporter makes it, from inside the shadow tree.
    press(input);
    assert.equal(opened, 0, "the reporter is typing inside the shadow tree");

    // And one from elsewhere on the page while the caret is still in the box:
    // the focus chain is what knows, because this event never went near it.
    press(doc.body);
    assert.equal(opened, 0, "the caret is still in the box");

    input.blur();
    press(doc.body);
    assert.equal(opened, 1, "and the shortcut works again once they are not");
    off();
  } finally {
    if (had) globals["document"] = previous;
    else delete globals["document"];
    await win.happyDOM.close();
  }
});
