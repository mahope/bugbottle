import { test } from "node:test";
import assert from "node:assert/strict";
import { request, type Server } from "node:http";
import { once } from "node:events";
// @ts-expect-error The runnable example is plain JavaScript.
import { createDemoServer } from "../examples/vanilla-js/server.mjs";
import { fullReportBody, PNG_DATA_URL } from "./report-fixtures.ts";
import { validateReport } from "../src/server/handle.ts";

async function start(options = {}) {
  const server: Server = createDemoServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}

test("the vanilla form and modules are served and reports use shared normalisation", async () => {
  const stored: unknown[] = [];
  const { server, origin } = await start({ store: (report: unknown) => {
    stored.push(report);
    return { id: "demo-id" };
  } });
  try {
    assert.match(await (await fetch(origin)).text(), /<form/);
    assert.equal((await fetch(`${origin}/bugbottle/index.js`)).status, 200);
    const body = { ...fullReportBody, contact: "  demo@example.test  ",
      screenshotDataUrl: PNG_DATA_URL,
      screenshotRegion: { mode: "area", rect: { x: 1, y: 2, width: 30, height: 40 } } };
    const response = await fetch(`${origin}/api/feedback`, { method: "POST", body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: "demo-id" });
    const expected = validateReport(body)!;
    assert.deepEqual(stored[0], { ...expected, receivedAt: (stored[0] as typeof expected).receivedAt });
    assert.ok(expected.screenshotRegion);
    for (const [raw, status, error] of [
      ["{", 400, "Malformed JSON"],
      [JSON.stringify({ type: "bug", message: "" }), 400, "Write a message first"],
    ] as const) {
      const reply = await fetch(`${origin}/api/feedback`, { method: "POST", body: raw });
      assert.equal(reply.status, status);
      assert.deepEqual(await reply.json(), { error });
    }
    const unknownType = await fetch(`${origin}/api/feedback`, { method: "POST",
      body: JSON.stringify({ type: "wrong", message: "hello" }) });
    assert.equal(unknownType.status, 201);
    assert.equal((stored[1] as typeof expected).type, "other");
    const reply = await fetch(`${origin}/api/feedback`, { method: "POST", body: JSON.stringify({
      ...body, screenshotDataUrl: "invalid",
    }) });
    assert.equal(reply.status, 201);
    assert.equal((stored[2] as typeof expected).screenshotRegion, undefined);
  } finally { await stop(server); }
});

for (const oversized of [true, false]) {
  test(oversized ? "an unfinished oversized upload is rejected before the remainder is sent" :
    "a stalled upload receives 408 within the body deadline", { timeout: 3000 }, async () => {
    const { server, origin } = await start({ maxBodyBytes: 1024, bodyTimeoutMs: 100 });
    const started = Date.now();
    const upload = request(`${origin}/api/feedback`, { method: "POST" });
    upload.on("error", () => {});
    try {
      const response = once(upload, "response", { signal: AbortSignal.timeout(1500) });
      // No end(): the unbounded implementation waits for the rest forever.
      upload.write(oversized ? Buffer.alloc(2048, "x") : "{");
      const [reply] = await response;
      assert.equal(reply.statusCode, oversized ? 413 : 408);
      let raw = "";
      for await (const chunk of reply) raw += chunk;
      assert.deepEqual(JSON.parse(raw), { error: oversized ? "Report is too large" : "Report took too long to arrive" });
      assert.ok(Date.now() - started < 1500);
    } finally { upload.destroy(); await stop(server); }
  });
}
