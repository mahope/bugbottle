import { test } from "node:test";
import assert from "node:assert/strict";
import { enMessages } from "../src/locales.ts";
import {
  ENDPOINT,
  PNG,
  fakeQueue,
  fakeRenderer,
  flush,
  installDom,
  json,
  stubFetch,
} from "./adapter-harness.ts";

/**
 * The Svelte store, read the way `$form` reads it: `get(store)` is exactly
 * what the `$` prefix compiles down to. Same cases as the React hook's tests,
 * because the two are the same machine.
 */
const win = await installDom();

const { get } = await import("svelte/store");
const { createBugReport } = await import("../src/svelte/index.ts");

test("the form starts empty, idle and on the initial type", () => {
  const form = createBugReport({ endpoint: ENDPOINT });
  const state = get(form);
  assert.equal(state.type, "bug");
  assert.equal(state.message, "");
  assert.deepEqual(state.status, { kind: "idle" });
  assert.deepEqual(state.elements, []);
  assert.equal(state.screenshot, null);
  assert.equal(state.isSending, false);
  assert.equal(state.statusMessage, "");
  form.destroy();
});

test("a subscriber hears the current value first, then every change", () => {
  const form = createBugReport({ endpoint: ENDPOINT });
  const seen: string[] = [];
  const unsubscribe = form.subscribe((state) => seen.push(state.message));
  form.setMessage("half");
  form.setMessage("whole");
  unsubscribe();
  form.setMessage("after the unsubscribe");
  assert.deepEqual(seen, ["", "half", "whole"]);
  form.destroy();
});

test("without a renderer the screenshot is off and opening captures nothing", async () => {
  const form = createBugReport({ endpoint: ENDPOINT });
  assert.equal(get(form).canScreenshot, false);
  assert.equal(get(form).includeScreenshot, false);

  form.open();
  await flush();
  assert.equal(get(form).screenshot, null);
  assert.deepEqual(get(form).status, { kind: "idle" });

  // Toggling it on is a no-op too, so a form that forgot to hide the checkbox
  // cannot put the store into a state it can never leave.
  form.toggleScreenshot(true);
  await flush();
  assert.equal(get(form).includeScreenshot, false);
  assert.equal(get(form).screenshot, null);
  form.destroy();
});

test("with a renderer, opening the form takes the picture", async () => {
  const renderer = fakeRenderer();
  const form = createBugReport({ endpoint: ENDPOINT, screenshot: renderer.render });
  assert.equal(get(form).canScreenshot, true);
  assert.equal(get(form).includeScreenshot, true);
  assert.equal(get(form).screenshot, null);

  form.open();
  await flush();
  assert.equal(renderer.calls, 1);
  assert.equal(get(form).screenshot, PNG);
  assert.deepEqual(get(form).status, { kind: "idle" });
  form.destroy();
});

test("turning the screenshot off throws the picture away", async () => {
  const renderer = fakeRenderer();
  const form = createBugReport({ endpoint: ENDPOINT, screenshot: renderer.render });
  form.open();
  await flush();
  assert.equal(get(form).screenshot, PNG);

  form.toggleScreenshot(false);
  assert.equal(get(form).includeScreenshot, false);
  assert.equal(get(form).screenshot, null);
  form.destroy();
});

test("switching to a type that is not a bug does not arm the screenshot", async () => {
  const renderer = fakeRenderer();
  const form = createBugReport({ endpoint: ENDPOINT, screenshot: renderer.render });
  form.toggleScreenshot(false);
  await flush();
  assert.equal(renderer.calls, 0);

  form.setType("idea");
  await flush();
  assert.equal(get(form).type, "idea");
  assert.equal(get(form).includeScreenshot, false);
  assert.equal(get(form).screenshot, null);
  assert.equal(renderer.calls, 0);

  // Back on a bug the default does arm it again, which is what makes the
  // assertion above about the type and not about the toggle being sticky.
  form.setType("bug");
  await flush();
  assert.equal(get(form).includeScreenshot, true);
  assert.equal(get(form).screenshot, PNG);
  assert.equal(renderer.calls, 1);
  form.destroy();
});

test("submitting an empty message is refused before any request", async () => {
  const fetchStub = stubFetch(() => json({ id: "never" }));
  const form = createBugReport({ endpoint: ENDPOINT });

  form.setMessage("   ");
  const sent = await form.submit();
  assert.equal(sent, false);
  assert.deepEqual(get(form).status, {
    kind: "error",
    reason: "empty",
    message: enMessages.empty,
  });
  assert.equal(get(form).statusMessage, enMessages.empty);
  assert.equal(fetchStub.seen.length, 0);
  fetchStub.restore();
  form.destroy();
});

test("a successful submit reports the id, clears the form and calls onSent", async () => {
  const fetchStub = stubFetch(() => json({ id: "rep_42" }));
  const seenIds: (string | undefined)[] = [];
  const form = createBugReport({
    endpoint: ENDPOINT,
    extra: { appVersion: "1.2.3" },
    onSent: (id) => seenIds.push(id),
  });

  form.setMessage("The save button does nothing");
  const sent = await form.submit();

  assert.equal(sent, true);
  assert.deepEqual(get(form).status, { kind: "sent", id: "rep_42" });
  assert.equal(get(form).statusMessage, enMessages.sent);
  assert.equal(get(form).message, "");
  assert.deepEqual(seenIds, ["rep_42"]);

  assert.equal(fetchStub.seen.length, 1);
  const posted = fetchStub.seen[0];
  assert.equal(posted?.url, ENDPOINT);
  const body = posted?.body as Record<string, unknown>;
  assert.equal(body["type"], "bug");
  assert.equal(body["message"], "The save button does nothing");
  assert.equal(body["appVersion"], "1.2.3");
  fetchStub.restore();
  form.destroy();
});

test("a rejected report surfaces the server's own message", async () => {
  const fetchStub = stubFetch(() => json({ error: "Reports are closed for this project" }, 500));
  const form = createBugReport({ endpoint: ENDPOINT });

  form.setMessage("Something is wrong");
  const sent = await form.submit();

  assert.equal(sent, false);
  assert.deepEqual(get(form).status, {
    kind: "error",
    reason: "send-failed",
    message: "Reports are closed for this project",
  });
  // The message the reporter typed survives a failure, so they can try again.
  assert.equal(get(form).message, "Something is wrong");
  fetchStub.restore();
  form.destroy();
});

test("a report dropped by beforeSend still thanks the reporter", async () => {
  const fetchStub = stubFetch(() => json({ id: "never" }));
  const form = createBugReport({ endpoint: ENDPOINT, beforeSend: () => null });

  form.setMessage("Nothing to see here");
  const sent = await form.submit();

  assert.equal(sent, true);
  assert.deepEqual(get(form).status, { kind: "sent", id: undefined });
  assert.equal(get(form).message, "");
  assert.equal(fetchStub.seen.length, 0);
  fetchStub.restore();
  form.destroy();
});

test("reset clears the message, the picture and the status", async () => {
  const renderer = fakeRenderer();
  const fetchStub = stubFetch(() => json({ error: "nope" }, 500));
  const form = createBugReport({ endpoint: ENDPOINT, screenshot: renderer.render });

  form.open();
  form.setMessage("Half a report");
  await flush();
  form.setType("idea");
  await form.submit();
  assert.equal(get(form).status.kind, "error");

  form.reset();
  assert.equal(get(form).type, "bug");
  assert.equal(get(form).message, "");
  assert.equal(get(form).screenshot, null);
  assert.deepEqual(get(form).elements, []);
  assert.equal(get(form).includeScreenshot, true);
  assert.deepEqual(get(form).status, { kind: "idle" });
  fetchStub.restore();
  form.destroy();
});

test("picking an element attaches it and swallows the click", async () => {
  const target = win.document.createElement("button");
  target.id = "save-order";
  target.textContent = "Save";
  win.document.body.appendChild(target);

  const heard: string[] = [];
  const listener = () => heard.push("click");
  win.document.addEventListener("click", listener);

  const form = createBugReport({ endpoint: ENDPOINT });

  const pending = form.pickElement();
  await flush();
  assert.equal(get(form).isPicking, true);
  target.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  const picked = await pending;

  assert.deepEqual(heard, [], "the pick swallows the click it is listening for");
  assert.equal(get(form).elements.length, 1);
  assert.equal(get(form).elements[0]?.tag, "button");
  assert.equal(get(form).elements[0]?.selector, "button#save-order");
  assert.equal(picked?.tag, "button");
  assert.deepEqual(get(form).status, { kind: "idle" });

  // And the reporter can take it off again.
  form.removeElement(0);
  assert.deepEqual(get(form).elements, []);

  win.document.removeEventListener("click", listener);
  target.remove();
  form.destroy();
});

test("destroying during a pick lets clicks through again", async () => {
  const target = win.document.createElement("button");
  target.id = "cancel-order";
  win.document.body.appendChild(target);

  const heard: string[] = [];
  const listener = () => heard.push("click");
  win.document.addEventListener("click", listener);

  const form = createBugReport({ endpoint: ENDPOINT });

  const pending = form.pickElement();
  await flush();
  // `destroy` is what a component's `onDestroy` calls, and it takes the pick
  // with it: the picker's capture-phase listeners are gone and an ordinary
  // click reaches the page again.
  form.destroy();
  const picked = await pending;

  assert.equal(picked, null);
  target.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(heard, ["click"]);

  win.document.removeEventListener("click", listener);
  target.remove();
});

test("a failed send with a queue is queued, and the reporter is thanked", async () => {
  const fetchStub = stubFetch(() => {
    throw new TypeError("Failed to fetch");
  });
  const { queue, queued } = fakeQueue();
  const form = createBugReport({ endpoint: ENDPOINT, queue });

  form.setMessage("The save button does nothing");
  const sent = await form.submit();

  assert.equal(sent, true, "as far as the reporter is concerned the report is filed");
  assert.deepEqual(get(form).status, { kind: "queued" });
  assert.equal(get(form).statusMessage, enMessages.queued);
  assert.equal(queued.length, 1);
  assert.equal((queued[0] as { message: string }).message, "The save button does nothing");
  assert.equal(get(form).message, "", "the form is cleared, as after a send");
  fetchStub.restore();
  form.destroy();
});

test("a report the endpoint refuses with a 4xx is not queued", async () => {
  const fetchStub = stubFetch(() => json({ error: "That project is closed" }, 400));
  const { queue, queued } = fakeQueue();
  const form = createBugReport({ endpoint: ENDPOINT, queue });

  form.setMessage("Something is wrong");
  const sent = await form.submit();

  assert.equal(sent, false);
  assert.equal(queued.length, 0, "a 4xx is the server saying no, not the network failing");
  assert.equal(get(form).status.kind, "error");
  fetchStub.restore();
  form.destroy();
});

test("a bundled locale reaches the reporter", async () => {
  const fetchStub = stubFetch(() => json({ id: "rep_7" }));
  const { da } = await import("../src/locales.ts");
  const form = createBugReport({ endpoint: ENDPOINT, messages: da.messages });

  form.setMessage("Knappen gemmer ikke");
  await form.submit();
  assert.equal(get(form).statusMessage, da.messages.sent);
  fetchStub.restore();
  form.destroy();
});
