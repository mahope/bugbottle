import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("bugbottle/package.json"));
assert.equal(existsSync(join(root, "src")), false);
assert.ok(require.resolve("bugbottle/react").startsWith(join(root, "dist") + "/"));
const adapterRequire = createRequire(require.resolve("bugbottle/react"));
assert.equal(realpathSync(adapterRequire.resolve("react")), realpathSync(require.resolve("react")));
assert.ok(realpathSync(require.resolve("react")).startsWith(dirname(root) + "/react/"));

const win = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "navigator", "location", "HTMLElement", "Element", "Node", "Event"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? win : win[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, StrictMode, act, useEffect } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useBugReport } = await import("bugbottle/react");
const { enMessages } = await import("bugbottle/locales");
const deliveries = [];
const successes = [];
const renders = [];
let setups = 0;
let cleanups = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/local-delivery");
  const body = JSON.parse(options.body);
  return new Promise((resolve) => deliveries.push({ body, finish: () => resolve(new Response(JSON.stringify({ id: body.message }), { status: 201 })) }));
};
function Form({ name }) {
  const report = useBugReport({ endpoint: "/local-delivery", messages: enMessages, onSent: (id) => successes.push([name, id]) });
  renders.push(name);
  useEffect(() => { setups++; return () => { cleanups++; }; }, []);
  return h("form", { onSubmit: (event) => { event.preventDefault(); void report.submit(); } },
    h("textarea", { value: report.message, onInput: (event) => report.setMessage(event.currentTarget.value) }),
    h("output", null, `${report.message}|${report.status.kind}`),
    h("button", { type: "submit" }, "Send"));
}
const host = document.createElement("div");
document.body.append(host);
let mounted;
async function mount(name) {
  mounted = createRoot(host);
  await act(async () => mounted.render(h(StrictMode, null, h(Form, { name }))));
}
async function submit(message) {
  await act(async () => {
    const input = host.querySelector("textarea");
    input.value = message;
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  assert.equal(host.querySelector("output").textContent, `${message}|idle`);
  await act(async () => host.querySelector("form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(host.querySelector("output").textContent, `${message}|sending`);
}
try {
  await mount("first");
  assert.equal(setups, 2, "development StrictMode must replay effect setup");
  assert.equal(cleanups, 1);
  await submit("first report");
  assert.equal(deliveries.length, 1);
  await act(async () => deliveries[0].finish());
  assert.match(host.querySelector("output").textContent, /\|sent$/);
  assert.deepEqual(successes, [["first", "first report"]]);
  await act(async () => mounted.unmount());

  await mount("pending");
  await submit("pending report");
  assert.equal(deliveries.length, 2);
  await act(async () => mounted.unmount());
  const oldRenders = renders.filter((name) => name === "pending").length;
  await mount("replacement");
  const replacementRenders = renders.length;
  await act(async () => deliveries[1].finish());
  assert.equal(host.querySelector("output").textContent, "|idle");
  assert.equal(renders.length, replacementRenders);
  assert.equal(renders.filter((name) => name === "pending").length, oldRenders);
  assert.deepEqual(successes, [["first", "first report"]]);
  await submit("replacement report");
  assert.equal(deliveries.length, 3);
  await act(async () => deliveries[2].finish());
  assert.match(host.querySelector("output").textContent, /\|sent$/);
  assert.deepEqual(successes, [["first", "first report"], ["replacement", "replacement report"]]);
  console.log(`React ${require("react/package.json").version}: packed StrictMode form, pending unmount and remount passed`);
} finally {
  await act(async () => mounted.unmount());
  await win.happyDOM.close();
}
