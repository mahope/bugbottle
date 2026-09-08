import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { buildReportSchema } from "../scripts/build-schema.ts";
import {
  attachRrweb,
  getReplay,
  isRrwebAttached,
  resetRrweb,
  DEFAULT_REPLAY_SECONDS,
  REPLAY_CHECKOUT_MS,
  REPLAY_BLOCK_SELECTOR,
  REPLAY_MASK_SELECTOR,
  type RrwebEvent,
  type RrwebRecordOptions,
} from "../src/rrweb.ts";
import { buildReport } from "../src/send.ts";
import { normaliseReplay, MAX_REPLAY_BYTES } from "../src/report-core.ts";
import { toMarkdown } from "../src/markdown.ts";
import { validateReport, handleReport } from "../src/server/handle.ts";

/**
 * A stand-in for the application's own `rrweb`. It records the options it was
 * handed, hands back an `emit` the test drives by hand, and counts the stops —
 * which is the whole contract this adapter has with rrweb: it never imports
 * it, so a fake is not a compromise here, it is the same shape a real
 * `record` presents.
 */
type Fake = {
  options: RrwebRecordOptions | null;
  stopped: number;
  emit: (event: RrwebEvent, isCheckout?: boolean) => void;
  record: (options: RrwebRecordOptions) => () => void;
};

function fakeRecord(): Fake {
  const fake: Fake = {
    options: null,
    stopped: 0,
    emit: () => {},
    record: (options) => {
      fake.options = options;
      fake.emit = (event, isCheckout) => options.emit(event, isCheckout);
      return () => {
        fake.stopped += 1;
      };
    },
  };
  return fake;
}

/** One event, with whatever size the test needs it to have. */
function event(type: number, timestamp: number, padding = 0): RrwebEvent {
  return { type, timestamp, data: { s: "x".repeat(padding) } };
}

afterEach(() => {
  resetRrweb();
});

test("the recorder is started with masking on and the bugbottle markers mapped", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record);
  assert.equal(fake.options?.maskAllInputs, true);
  assert.equal(fake.options?.checkoutEveryNms, REPLAY_CHECKOUT_MS);
  assert.equal(fake.options?.maskTextSelector, REPLAY_MASK_SELECTOR);
  assert.equal(fake.options?.blockSelector, REPLAY_BLOCK_SELECTOR);
  assert.equal(isRrwebAttached(), true);
});

test("record options can be overridden, masking included", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record, { recordOptions: { maskAllInputs: false, sampling: { scroll: 150 } } });
  assert.equal(fake.options?.maskAllInputs, false);
  assert.deepEqual(fake.options?.sampling, { scroll: 150 });
});

test("nothing is recorded before it is attached", () => {
  assert.equal(getReplay(), null);
  assert.equal(isRrwebAttached(), false);
});

test("a replay with no events at all is no replay", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record);
  assert.equal(getReplay(), null);
});

test("the buffer keeps the events and says how long they cover", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record);
  const t0 = Date.now();
  fake.emit(event(2, t0), true);
  fake.emit(event(3, t0 + 4000));
  const replay = getReplay();
  assert.equal(replay?.events.length, 2);
  assert.equal(replay?.seconds, 4);
});

test("a checkout group older than the window is dropped, the newer ones stay", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record, { seconds: 30 });
  const t0 = 1_000_000;
  // Three full-snapshot groups, ten seconds apart, and then an event far
  // enough on that the first group is entirely outside the window.
  fake.emit(event(2, t0), true);
  fake.emit(event(3, t0 + 1000));
  fake.emit(event(2, t0 + 10_000), true);
  fake.emit(event(2, t0 + 20_000), true);
  assert.equal(getReplay()?.events.length, 4);
  // Now past t0 + 40 000: the group that starts at t0 + 10 000 is still the
  // most recent checkout at least thirty seconds old, so the first goes.
  fake.emit(event(3, t0 + 41_000));
  const replay = getReplay();
  assert.equal(replay?.events.length, 3);
  assert.equal(replay?.events[0]?.timestamp, t0 + 10_000);
});

test("the newest group is never trimmed away, however old the events are", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record, { seconds: 1 });
  const t0 = 2_000_000;
  fake.emit(event(2, t0), true);
  fake.emit(event(3, t0 + 60_000));
  const replay = getReplay();
  assert.equal(replay?.events.length, 2);
});

test("the byte cap drops the oldest checkout group first", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record, { maxBytes: 2000, seconds: 3600 });
  const t0 = 3_000_000;
  fake.emit(event(2, t0, 800), true);
  fake.emit(event(2, t0 + 10_000, 800), true);
  assert.equal(getReplay()?.events.length, 2);
  // A third group of the same size takes the buffer over the cap, so the
  // first one goes rather than the newest.
  fake.emit(event(2, t0 + 20_000, 800), true);
  const replay = getReplay();
  assert.equal(replay?.events.length, 2);
  assert.equal(replay?.events[0]?.timestamp, t0 + 10_000);
});

test("a single group larger than the cap is not sent at all", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record, { maxBytes: 500, seconds: 3600 });
  const t0 = 4_000_000;
  fake.emit(event(2, t0, 2000), true);
  assert.equal(getReplay(), null);
});

test("the buffer is measured in UTF-8 bytes, not in code units", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record, { maxBytes: 500, seconds: 3600 });
  const t0 = 4_500_000;
  // 200 code units, 600 bytes: under the cap counted wrongly, over it counted
  // honestly, and the whole group is therefore too large to send.
  fake.emit({ type: 2, timestamp: t0, data: { s: "漢".repeat(200) } }, true);
  assert.equal(getReplay(), null);
});

test("an event that is not an object is ignored", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record);
  fake.emit(null as unknown as RrwebEvent, true);
  fake.emit("nope" as unknown as RrwebEvent);
  fake.emit(event(2, Date.now()), true);
  assert.equal(getReplay()?.events.length, 1);
});

test("an event without a timestamp is still buffered", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record);
  fake.emit({ type: 2 } as RrwebEvent, true);
  assert.equal(getReplay()?.events.length, 1);
});

test("stop() stops the recorder, forgets the buffer and unregisters the source", () => {
  const fake = fakeRecord();
  const stop = attachRrweb(fake.record);
  fake.emit(event(2, Date.now()), true);
  stop();
  assert.equal(fake.stopped, 1);
  assert.equal(getReplay(), null);
  assert.equal(isRrwebAttached(), false);
  const report = buildReport({ type: "bug", message: "gone" });
  assert.equal(report.replay, undefined);
});

test("stop() twice stops the recorder once", () => {
  const fake = fakeRecord();
  const stop = attachRrweb(fake.record);
  stop();
  stop();
  assert.equal(fake.stopped, 1);
});

test("a second attach does not start a second recorder", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record);
  const first = fake.options;
  attachRrweb(fake.record);
  assert.equal(fake.options, first);
});

test("a record that throws leaves nothing attached", () => {
  const stop = attachRrweb(() => {
    throw new Error("rrweb is unhappy");
  });
  assert.equal(isRrwebAttached(), false);
  assert.equal(getReplay(), null);
  stop();
});

test("a record that returns nothing still stops cleanly", () => {
  const stop = attachRrweb(() => undefined);
  stop();
  assert.equal(isRrwebAttached(), false);
});

test("the report carries the replay only when something is recording", () => {
  const before = buildReport({ type: "bug", message: "no replay" });
  assert.equal(before.replay, undefined);

  const fake = fakeRecord();
  attachRrweb(fake.record);
  const t0 = Date.now();
  fake.emit(event(2, t0), true);
  fake.emit(event(3, t0 + 2000));
  const after = buildReport({ type: "bug", message: "with replay" });
  assert.equal(after.replay?.events.length, 2);
  assert.equal(after.replay?.seconds, 2);
});

test("includeReplay: false leaves the replay out", () => {
  const fake = fakeRecord();
  attachRrweb(fake.record);
  fake.emit(event(2, Date.now()), true);
  const report = buildReport({ type: "bug", message: "x", includeReplay: false });
  assert.equal(report.replay, undefined);
});

test("the default window is thirty seconds", () => {
  assert.equal(DEFAULT_REPLAY_SECONDS, 30);
});

/* --- the server half ------------------------------------------------- */

test("normaliseReplay keeps well-formed events", () => {
  const replay = normaliseReplay({
    events: [
      { type: 2, timestamp: 1000, data: { node: 1 } },
      { type: 3, timestamp: 2000 },
    ],
    seconds: 1,
  });
  assert.equal(replay?.events.length, 2);
  assert.equal(replay?.seconds, 1);
  assert.deepEqual(replay?.events[0]?.data, { node: 1 });
});

test("normaliseReplay refuses anything that is not a replay", () => {
  assert.equal(normaliseReplay(null), null);
  assert.equal(normaliseReplay("no"), null);
  assert.equal(normaliseReplay([]), null);
  assert.equal(normaliseReplay({ events: "no" }), null);
  assert.equal(normaliseReplay({ events: [] }), null);
});

test("normaliseReplay drops events without numeric type and timestamp", () => {
  const replay = normaliseReplay({
    events: [
      { type: "2", timestamp: 1000 },
      { type: 2, timestamp: "1000" },
      { type: 2 },
      null,
      "nope",
      { type: Number.NaN, timestamp: 1000 },
      { type: 2, timestamp: 1000 },
    ],
  });
  assert.equal(replay?.events.length, 1);
});

test("normaliseReplay recomputes seconds from the events it kept", () => {
  const replay = normaliseReplay({
    events: [
      { type: 2, timestamp: 1000 },
      { type: 3, timestamp: 31_000 },
    ],
    seconds: 9999,
  });
  assert.equal(replay?.seconds, 30);
});

test("an oversized replay is dropped whole, like an oversized screenshot", () => {
  const big = "x".repeat(2000);
  const events = [];
  for (let i = 0; i < 1000; i += 1) events.push({ type: 3, timestamp: 1000 + i, data: big });
  const serialised = JSON.stringify(events).length;
  assert.ok(serialised > MAX_REPLAY_BYTES);
  assert.equal(normaliseReplay({ events }), null);
});

test("a replay is measured in UTF-8 bytes, not in code units", () => {
  // Three bytes each in UTF-8, one code unit each in the string: a payload
  // that is comfortably under the cap by `length` and well over it by size.
  const cjk = "漢".repeat(500);
  const events = [];
  for (let i = 0; i < 800; i += 1) events.push({ type: 3, timestamp: 1000 + i, data: cjk });
  const serialised = JSON.stringify(events);
  assert.ok(serialised.length < MAX_REPLAY_BYTES, "under the cap counted wrongly");
  assert.ok(
    new TextEncoder().encode(serialised).byteLength > MAX_REPLAY_BYTES,
    "over the cap counted honestly",
  );
  assert.equal(normaliseReplay({ events }), null);
});

test("null bytes are stripped out of a replay", () => {
  const nul = String.fromCharCode(0);
  const replay = normaliseReplay({
    events: [{ type: 3, timestamp: 1000, data: { text: `a${nul}b` } }],
  });
  const data = replay?.events[0]?.data as { text: string };
  assert.equal(data.text, "ab");
});

test("an event whose text merely looks like an escaped NUL survives whole", () => {
  // The six characters backslash-u-0000, as text a page really rendered. The
  // strip used to run over the serialised JSON, where that reads exactly like
  // the escape `JSON.stringify` writes for a real NUL, so removing it left
  // invalid JSON and the whole replay was dropped.
  const literal = "\\" + "u0000";
  const replay = normaliseReplay({
    events: [{ type: 3, timestamp: 1000, data: { text: `a${literal}b` } }],
  });
  assert.equal(replay?.events.length, 1);
  const data = replay?.events[0]?.data as { text: string };
  assert.equal(data.text, `a${literal}b`);
});

test("validateReport carries the replay through", () => {
  const report = validateReport({
    message: "it froze",
    replay: { events: [{ type: 2, timestamp: 1000 }], seconds: 0 },
  });
  assert.equal(report?.replay?.events.length, 1);
});

test("validateReport nulls a malformed replay rather than failing", () => {
  const report = validateReport({ message: "it froze", replay: { events: [1, 2, 3] } });
  assert.equal(report?.replay, null);
});

test("toMarkdown says how much replay is attached", () => {
  const md = toMarkdown({
    type: "bug",
    message: "it froze",
    replay: {
      events: [
        { type: 2, timestamp: 1000 },
        { type: 3, timestamp: 31_000 },
      ],
    },
  });
  assert.match(md, /\| Replay \| 2 events over 30 s \(attached\) \|/);
});

test("toMarkdown says nothing about a replay that is not there", () => {
  const md = toMarkdown({ type: "bug", message: "it froze" });
  assert.doesNotMatch(md, /Replay/);
});

test("handleReport keeps the replay by default", async () => {
  let stored: unknown = null;
  const response = await handleReport(
    new Request("https://example.test/report", {
      method: "POST",
      body: JSON.stringify({
        type: "bug",
        message: "it froze",
        replay: { events: [{ type: 2, timestamp: 1000 }] },
      }),
    }),
    {
      store: (report) => {
        stored = report.replay;
        return { id: "r1" };
      },
    },
  );
  assert.equal(response.status, 201);
  assert.equal((stored as { events: unknown[] } | null)?.events.length, 1);
});

test("a report carrying a replay is valid against the published schema", () => {
  const validate = new Ajv2020({ strict: false }).compile(buildReportSchema());
  const valid = validate({
    type: "bug",
    message: "it froze",
    context: { url: "/checkout", viewport: "1280x800", userAgent: "Test" },
    replay: { events: [{ type: 2, timestamp: 1000, data: { node: 1 } }], seconds: 12 },
  });
  assert.equal(valid, true, JSON.stringify(validate.errors ?? []));
  // An event without the two numbers rrweb always writes is not an event.
  assert.equal(
    validate({
      type: "bug",
      message: "it froze",
      context: { url: "/checkout", viewport: "1280x800", userAgent: "Test" },
      replay: { events: [{ data: {} }], seconds: 1 },
    }),
    false,
  );
});

test('handleReport with replay: "drop" stores none of it', async () => {
  let stored: unknown = "unset";
  let markdown = "";
  await handleReport(
    new Request("https://example.test/report", {
      method: "POST",
      body: JSON.stringify({
        type: "bug",
        message: "it froze",
        replay: { events: [{ type: 2, timestamp: 1000 }] },
      }),
    }),
    {
      replay: "drop",
      store: (report) => {
        stored = report.replay;
      },
      respond: (result) => {
        markdown = result.markdown;
        return new Response(null, { status: 204 });
      },
    },
  );
  assert.equal(stored, null);
  assert.doesNotMatch(markdown, /Replay/);
});
