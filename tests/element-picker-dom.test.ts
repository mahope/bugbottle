import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { describeElement, pickElement } from "../src/element-picker.ts";

for (const phase of ["movement", "completion"] as const) {
for (const exit of ["click", "Escape", "abort", "already aborted"] as const) {
  test(`throwing ${phase} observers cannot prevent ${exit} from settling once`, async (t) => {
    const win = new Window();
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.window = win;
    globals.document = win.document;
    globals.Element = win.Element;
    const doc = win.document;
    doc.body.innerHTML = '<button id="save">Save</button>';
    doc.documentElement.style.cursor = "help";
    const button = doc.querySelector("button")!;
    const controller = new win.AbortController();
    if (exit === "already aborted") controller.abort();
    const removeListener = t.mock.method(doc, "removeEventListener");
    const removeAbort = t.mock.method(controller.signal, "removeEventListener");
    let finalCalls = 0;
    const promise = pickElement({
      signal: controller.signal as unknown as AbortSignal,
      onHover(el) {
        if (el === null) {
          finalCalls++;
          // Re-enter completion while its final observer is still running.
          doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
          controller.signal.dispatchEvent(new win.Event("abort"));
        }
        if ((el === null) === (phase === "completion")) throw new Error("hover observer failed");
      },
    });
    const box = doc.querySelector('[data-bugbottle="highlight"]');
    const removeBox = box ? t.mock.method(box, "remove") : null;
    if (exit !== "already aborted") {
      assert.doesNotThrow(() => button.dispatchEvent(new win.PointerEvent("pointermove", {
        bubbles: true,
      })));
      assert.equal((box as unknown as HTMLElement).style.display, "block");
      assert.doesNotThrow(() => {
        if (exit === "click") button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
        else if (exit === "Escape") doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
        else controller.abort();
      });
    }
    const pending = Symbol("pending");
    const result = await Promise.race([promise, Promise.resolve().then(() => pending)]);
    assert.notEqual(result, pending, "the picker must settle before the next microtask");
    assert.deepEqual(result, exit === "click" ? describeElement(button as unknown as Element) : null);
    assert.equal(finalCalls, 1);
    assert.equal(doc.documentElement.style.cursor, "help");
    assert.equal(doc.querySelector('[data-bugbottle="highlight"]'), null);
    assert.equal(removeListener.mock.callCount(), 3);
    assert.equal(removeAbort.mock.callCount(), 1);
    if (removeBox) assert.equal(removeBox.mock.callCount(), 1);

    doc.documentElement.style.cursor = "wait";
    controller.abort();
    controller.signal.dispatchEvent(new win.Event("abort"));
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
    assert.equal(finalCalls, 1);
    assert.equal(removeListener.mock.callCount(), 3);
    assert.equal(doc.documentElement.style.cursor, "wait");

    const next = pickElement();
    button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    assert.deepEqual(await next, describeElement(button as unknown as Element));
    assert.equal(doc.documentElement.style.cursor, "wait");
    assert.equal(doc.querySelector('[data-bugbottle="highlight"]'), null);
  });
}
}
