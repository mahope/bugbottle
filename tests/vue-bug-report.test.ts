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
 * The Vue composable, driven the way a component would drive it: inside an
 * `effectScope`, reading `.value` off the refs it returns, and stopping the
 * scope where a component would unmount. Same cases as the React hook's tests,
 * because the two are the same machine.
 */
const win = await installDom();

const { effectScope, nextTick } = await import("vue");
const { useBugReport } = await import("../src/vue/index.ts");

/** Runs the composable in its own scope, and hands back the scope's stop. */
function mount(options: Parameters<typeof useBugReport>[0]) {
  const scope = effectScope();
  const form = scope.run(() => useBugReport(options))!;
  return { form, unmount: () => scope.stop() };
}

test("the form starts empty, idle and on the initial type", () => {
  const { form, unmount } = mount({ endpoint: ENDPOINT });
  assert.equal(form.type.value, "bug");
  assert.equal(form.message.value, "");
  assert.deepEqual(form.status.value, { kind: "idle" });
  assert.deepEqual(form.elements.value, []);
  assert.equal(form.screenshot.value, null);
  assert.equal(form.isSending.value, false);
  assert.equal(form.statusMessage.value, "");
  unmount();
});

test("without a renderer the screenshot is off and opening captures nothing", async () => {
  const { form, unmount } = mount({ endpoint: ENDPOINT });
  assert.equal(form.canScreenshot.value, false);
  assert.equal(form.includeScreenshot.value, false);

  form.open();
  await flush();
  assert.equal(form.screenshot.value, null);
  assert.deepEqual(form.status.value, { kind: "idle" });

  // Toggling it on is a no-op too, so a form that forgot to hide the checkbox
  // cannot put the composable into a state it can never leave.
  form.toggleScreenshot(true);
  await flush();
  assert.equal(form.includeScreenshot.value, false);
  assert.equal(form.screenshot.value, null);
  unmount();
});

test("with a renderer, opening the form takes the picture", async () => {
  const renderer = fakeRenderer();
  const { form, unmount } = mount({ endpoint: ENDPOINT, screenshot: renderer.render });
  assert.equal(form.canScreenshot.value, true);
  assert.equal(form.includeScreenshot.value, true);
  assert.equal(form.screenshot.value, null);

  form.open();
  await flush();
  await nextTick();
  assert.equal(renderer.calls, 1);
  assert.equal(form.screenshot.value, PNG);
  assert.deepEqual(form.status.value, { kind: "idle" });
  unmount();
});

test("turning the screenshot off throws the picture away", async () => {
  const renderer = fakeRenderer();
  const { form, unmount } = mount({ endpoint: ENDPOINT, screenshot: renderer.render });
  form.open();
  await flush();
  assert.equal(form.screenshot.value, PNG);

  form.toggleScreenshot(false);
  await nextTick();
  assert.equal(form.includeScreenshot.value, false);
  assert.equal(form.screenshot.value, null);
  unmount();
});

test("switching to a type that is not a bug does not arm the screenshot", async () => {
  const renderer = fakeRenderer();
  const { form, unmount } = mount({ endpoint: ENDPOINT, screenshot: renderer.render });
  form.toggleScreenshot(false);
  await flush();
  assert.equal(renderer.calls, 0);

  // `type` is a writable computed, so a template can `v-model` it.
  form.type.value = "idea";
  await flush();
  assert.equal(form.type.value, "idea");
  assert.equal(form.includeScreenshot.value, false);
  assert.equal(form.screenshot.value, null);
  assert.equal(renderer.calls, 0);

  // Back on a bug the default does arm it again, which is what makes the
  // assertion above about the type and not about the toggle being sticky.
  form.setType("bug");
  await flush();
  assert.equal(form.includeScreenshot.value, true);
  assert.equal(form.screenshot.value, PNG);
  assert.equal(renderer.calls, 1);
  unmount();
});

test("submitting an empty message is refused before any request", async () => {
  const fetchStub = stubFetch(() => json({ id: "never" }));
  const { form, unmount } = mount({ endpoint: ENDPOINT });

  form.message.value = "   ";
  const sent = await form.submit();
  assert.equal(sent, false);
  assert.deepEqual(form.status.value, {
    kind: "error",
    reason: "empty",
    message: enMessages.empty,
  });
  assert.equal(form.statusMessage.value, enMessages.empty);
  assert.equal(fetchStub.seen.length, 0);
  fetchStub.restore();
  unmount();
});

test("a successful submit reports the id, clears the form and calls onSent", async () => {
  const fetchStub = stubFetch(() => json({ id: "rep_42" }));
  const seenIds: (string | undefined)[] = [];
  const { form, unmount } = mount({
    endpoint: ENDPOINT,
    extra: { appVersion: "1.2.3" },
    onSent: (id) => seenIds.push(id),
  });

  form.setMessage("The save button does nothing");
  const sent = await form.submit();
  await nextTick();

  assert.equal(sent, true);
  assert.deepEqual(form.status.value, { kind: "sent", id: "rep_42" });
  assert.equal(form.statusMessage.value, enMessages.sent);
  assert.equal(form.message.value, "");
  assert.deepEqual(seenIds, ["rep_42"]);

  assert.equal(fetchStub.seen.length, 1);
  const posted = fetchStub.seen[0];
  assert.equal(posted?.url, ENDPOINT);
  const body = posted?.body as Record<string, unknown>;
  assert.equal(body["type"], "bug");
  assert.equal(body["message"], "The save button does nothing");
  assert.equal(body["appVersion"], "1.2.3");
  fetchStub.restore();
  unmount();
});

test("a rejected report surfaces the server's own message", async () => {
  const fetchStub = stubFetch(() => json({ error: "Reports are closed for this project" }, 500));
  const { form, unmount } = mount({ endpoint: ENDPOINT });

  form.setMessage("Something is wrong");
  const sent = await form.submit();

  assert.equal(sent, false);
  assert.deepEqual(form.status.value, {
    kind: "error",
    reason: "send-failed",
    message: "Reports are closed for this project",
  });
  // The message the reporter typed survives a failure, so they can try again.
  assert.equal(form.message.value, "Something is wrong");
  fetchStub.restore();
  unmount();
});

test("a report dropped by beforeSend still thanks the reporter", async () => {
  const fetchStub = stubFetch(() => json({ id: "never" }));
  const { form, unmount } = mount({ endpoint: ENDPOINT, beforeSend: () => null });

  form.setMessage("Nothing to see here");
  const sent = await form.submit();

  assert.equal(sent, true);
  assert.deepEqual(form.status.value, { kind: "sent", id: undefined });
  assert.equal(form.message.value, "");
  assert.equal(fetchStub.seen.length, 0);
  fetchStub.restore();
  unmount();
});

test("reset clears the message, the picture and the status", async () => {
  const renderer = fakeRenderer();
  const fetchStub = stubFetch(() => json({ error: "nope" }, 500));
  const { form, unmount } = mount({ endpoint: ENDPOINT, screenshot: renderer.render });

  form.open();
  form.setMessage("Half a report");
  await flush();
  form.setType("idea");
  await form.submit();
  assert.equal(form.status.value.kind, "error");

  form.reset();
  await nextTick();
  assert.equal(form.type.value, "bug");
  assert.equal(form.message.value, "");
  assert.equal(form.screenshot.value, null);
  assert.deepEqual(form.elements.value, []);
  assert.equal(form.includeScreenshot.value, true);
  assert.deepEqual(form.status.value, { kind: "idle" });
  fetchStub.restore();
  unmount();
});

test("picking an element attaches it and swallows the click", async () => {
  const target = win.document.createElement("button");
  target.id = "save-order";
  target.textContent = "Save";
  win.document.body.appendChild(target);

  const heard: string[] = [];
  const listener = () => heard.push("click");
  win.document.addEventListener("click", listener);

  const { form, unmount } = mount({ endpoint: ENDPOINT });

  const pending = form.pickElement();
  await flush();
  assert.equal(form.isPicking.value, true);
  target.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  const picked = await pending;
  await nextTick();

  assert.deepEqual(heard, [], "the pick swallows the click it is listening for");
  assert.equal(form.elements.value.length, 1);
  assert.equal(form.elements.value[0]?.tag, "button");
  assert.equal(form.elements.value[0]?.selector, "button#save-order");
  assert.equal(picked?.tag, "button");
  assert.deepEqual(form.status.value, { kind: "idle" });

  // And the reporter can take it off again.
  form.removeElement(0);
  await nextTick();
  assert.deepEqual(form.elements.value, []);

  win.document.removeEventListener("click", listener);
  target.remove();
  unmount();
});

test("stopping the scope during a pick lets clicks through again", async () => {
  const target = win.document.createElement("button");
  target.id = "cancel-order";
  win.document.body.appendChild(target);

  const heard: string[] = [];
  const listener = () => heard.push("click");
  win.document.addEventListener("click", listener);

  const { form, unmount } = mount({ endpoint: ENDPOINT });

  const pending = form.pickElement();
  await flush();
  // Stopping the scope is what a component unmounting does, and it takes the
  // pick with it: the picker's capture-phase listeners are gone and an
  // ordinary click reaches the page again.
  unmount();
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
  const { form, unmount } = mount({ endpoint: ENDPOINT, queue });

  form.setMessage("The save button does nothing");
  const sent = await form.submit();
  await nextTick();

  assert.equal(sent, true, "as far as the reporter is concerned the report is filed");
  assert.deepEqual(form.status.value, { kind: "queued" });
  assert.equal(form.statusMessage.value, enMessages.queued);
  assert.equal(queued.length, 1);
  assert.equal((queued[0] as { message: string }).message, "The save button does nothing");
  assert.equal(form.message.value, "", "the form is cleared, as after a send");
  fetchStub.restore();
  unmount();
});

test("a report the endpoint refuses with a 4xx is not queued", async () => {
  const fetchStub = stubFetch(() => json({ error: "That project is closed" }, 400));
  const { queue, queued } = fakeQueue();
  const { form, unmount } = mount({ endpoint: ENDPOINT, queue });

  form.setMessage("Something is wrong");
  const sent = await form.submit();

  assert.equal(sent, false);
  assert.equal(queued.length, 0, "a 4xx is the server saying no, not the network failing");
  assert.equal(form.status.value.kind, "error");
  fetchStub.restore();
  unmount();
});

test("a bundled locale reaches the reporter", async () => {
  const fetchStub = stubFetch(() => json({ id: "rep_7" }));
  const { da } = await import("../src/locales.ts");
  const { form, unmount } = mount({ endpoint: ENDPOINT, messages: da.messages });

  form.setMessage("Knappen gemmer ikke");
  await form.submit();
  assert.equal(form.statusMessage.value, da.messages.sent);
  fetchStub.restore();
  unmount();
});
