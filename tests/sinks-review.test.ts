import { test } from "node:test";
import assert from "node:assert/strict";
import { sendReportEmail } from "../src/sinks/resend.ts";

function capture(status = 200, body: unknown = { id: "e_1" }) {
  const calls: { init: RequestInit }[] = [];
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.push({ init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, sent: () => JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown> };
}

test("a dollar sign in the message does not corrupt the subject", async () => {
  const { fetch, sent } = capture();
  await sendReportEmail(
    { type: "bug", message: "Copy button inserts $` and $& into the field" },
    { apiKey: "k", from: "a@b.c", to: "d@e.f", fetch },
  );
  assert.match(String(sent().subject), /Copy button inserts \$` and \$& into the field/);
});

test("the subject is the title even when the body omits the heading", async () => {
  const { fetch, sent } = capture();
  await sendReportEmail(
    { type: "bug", message: "Save does nothing\nmore lines" },
    { apiKey: "k", from: "a@b.c", to: "d@e.f", fetch, markdown: { headingLevel: 0 } },
  );
  assert.match(String(sent().subject), /Save does nothing$/);
  assert.doesNotMatch(String(sent().subject), /\| \| \|/);
  assert.doesNotMatch(String(sent().text), /^##/m, "the body honours headingLevel 0");
});
