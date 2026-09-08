/**
 * "The server trusts nothing", written down as a test.
 *
 * A seeded generator builds thousands of reports out of the values an
 * attacker actually sends — the wrong type at every path, strings longer than
 * any limit, objects nested deeper than a parser likes, null bytes, lone
 * surrogates, `__proto__` and `constructor` as keys, arrays where objects go,
 * numbers written as strings, NaN and Infinity — and feeds them through every
 * `normalise*`, `validateReport`, `scrubReport`, `toMarkdown` and
 * `handleReport`. Three things are asserted, and only three: nothing throws,
 * every output respects its `MAX_*` limit, and `handleReport` answers with a
 * status it chose rather than a 500 it fell into.
 *
 * The generator is hand-rolled and seeded so a failure is reproducible: the
 * seed and the iteration are printed with the failure, and re-running with
 * `FUZZ_SEED=<seed> FUZZ_ITERATIONS=<n>` replays exactly the same values.
 * `FUZZ_ITERATIONS` defaults to 2000, which is a little over two seconds; CI
 * leaves it at the default and a longer soak is one env away.
 *
 * When this file finds something, the fix belongs in the module and the case
 * belongs beside it as a named regression test at the bottom — a fuzz failure
 * that only the fuzzer remembers is a fix nobody can review.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BREADCRUMBS,
  MAX_BREADCRUMB_TEXT_LENGTH,
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_MESSAGE_LENGTH,
  MAX_CONTACT_LENGTH,
  MAX_CONTEXT_LENGTHS,
  MAX_COOKIE_NAMES,
  MAX_ELEMENTS,
  MAX_ELEMENT_TEXT_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_NETWORK_ENTRIES,
  MAX_PERF_MS,
  MAX_REPLAY_BYTES,
  MAX_REPLAY_EVENTS,
  MAX_STACK_FRAMES,
  MAX_STACK_STRING_LENGTH,
  MAX_STORAGE_KEYS,
  MAX_STORAGE_KEY_LENGTH,
  MAX_STORAGE_VALUES,
  MAX_STORAGE_VALUE_LENGTH,
  normaliseBreadcrumbs,
  normaliseConsole,
  normaliseContact,
  normaliseContext,
  normaliseElements,
  normaliseMessage,
  normaliseNetwork,
  normalisePerf,
  normaliseReplay,
  normaliseStorage,
  utf8Length,
} from "../src/report-core.ts";
import { scrubReport } from "../src/scrub.ts";
import { toMarkdown } from "../src/markdown.ts";
import {
  MAX_EXTRA_KEYS,
  MAX_EXTRA_STRING_LENGTH,
  collectExtra,
  handleReport,
  validateReport,
} from "../src/server/handle.ts";

const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 2000);
const SEED = Number(process.env.FUZZ_SEED ?? 0x5eed_1379);

/** A literal NUL breaks tooling, so it is built rather than typed. */
const NUL = String.fromCharCode(0);

/**
 * mulberry32: thirty-two bits of state, one multiply and three shifts. Not a
 * cryptographic generator and not meant to be — what it has to be is the same
 * sequence on every machine for a given seed, so a failure here reproduces on
 * the reviewer's laptop.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

const pick = <T>(random: Random, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)] as T;

const int = (random: Random, max: number) => Math.floor(random() * max);

/**
 * The scalars worth sending on purpose. Half of them are the values a type
 * system promises cannot arrive and a JSON body delivers anyway; the rest are
 * the strings that break something downstream — a null byte Postgres refuses,
 * half a surrogate pair no encoder can encode, a key the language owns.
 */
function scalar(random: Random): unknown {
  switch (int(random, 22)) {
    case 0:
      return "";
    case 1:
      return "   \t\n  ";
    case 2:
      return `before${NUL}after`;
    case 3:
      return NUL.repeat(1 + int(random, 40));
    case 4:
      return "\uD800"; // A high surrogate with nothing after it.
    case 5:
      return `pair\uDC00broken\uD83D`; // A low surrogate first, then a lone high.
    case 6:
      return "x".repeat(1 + int(random, 12_000));
    case 7:
      return "æøå😀".repeat(1 + int(random, 400));
    case 8:
      return "__proto__";
    case 9:
      return "constructor";
    case 10:
      return String(int(random, 1_000_000)); // A number written as a string.
    case 11:
      return pick(random, ["-1", "1e400", "NaN", "0x10", "Infinity"]);
    case 12:
      return pick(random, [NaN, Infinity, -Infinity]);
    case 13:
      return pick(random, [0, -0, -1, 1e308, -1e308, 2 ** 53, 0.1, -0.000_001]);
    case 14:
      return int(random, 4000) - 2000;
    case 15:
      return true;
    case 16:
      return false;
    case 17:
      return null;
    case 18:
      return undefined;
    case 19:
      return pick(random, ["bug", "idea", "other", "BUG", "bug ", "error", "warn", "log"]);
    case 20:
      return pick(random, [
        "2026-09-08T10:00:00.000Z",
        "not a date",
        "2026-13-45T99:99:99Z",
        "0000-01-01T00:00:00Z",
      ]);
    default:
      return pick(random, ["click", "navigation", "submit", "visibility", "swipe"]);
  }
}

/** Keys chosen to collide with the language rather than with the schema. */
const HOSTILE_KEYS = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "hasOwnProperty",
  "length",
  "0",
  "",
  `key${NUL}`,
  "a".repeat(500),
  "valueOf",
] as const;

/**
 * One arbitrary JSON value. `depth` is spent going down, so a generator that
 * keeps choosing containers still terminates; the depth it starts with is
 * deliberately deeper than any real report and shallower than the recursion
 * limit of `JSON.stringify`, which the test itself has to survive.
 */
function value(random: Random, depth: number): unknown {
  if (depth <= 0 || random() < 0.55) return scalar(random);
  if (random() < 0.5) {
    const length = int(random, 6);
    const out: unknown[] = [];
    for (let i = 0; i < length; i += 1) out.push(value(random, depth - 1));
    return out;
  }
  const out: Record<string, unknown> = {};
  const keys = int(random, 6);
  for (let i = 0; i < keys; i += 1) {
    const key = random() < 0.4 ? pick(random, HOSTILE_KEYS) : `k${int(random, 8)}`;
    // Assigned through a descriptor: `out.__proto__ = {}` would reach the
    // prototype setter and quietly build a different object than intended.
    Object.defineProperty(out, key, {
      value: value(random, depth - 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * A nest of arrays `levels` deep, with `leaf` at the bottom — the shape that
 * costs a recursive walk one stack frame per level. Cheap to write and the
 * reason `normaliseReplay` bounds how far it follows an event.
 */
function nest(levels: number, leaf: unknown): unknown {
  let out: unknown = leaf;
  for (let i = 0; i < levels; i += 1) out = [out];
  return out;
}

/**
 * A value that is either arbitrary or roughly the right shape. Both matter: a
 * validator that rejects everything would pass a test made only of nonsense,
 * so most fields most of the time arrive plausible and one of them is wrong.
 */
function field(random: Random, plausible: () => unknown): unknown {
  return random() < 0.45 ? value(random, 4) : plausible();
}

function entry(random: Random, build: (random: Random) => unknown, max: number): unknown {
  if (random() < 0.2) return value(random, 3);
  const length = int(random, max);
  const out: unknown[] = [];
  for (let i = 0; i < length; i += 1) {
    out.push(random() < 0.25 ? value(random, 3) : build(random));
  }
  return out;
}

function report(random: Random): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out.type = field(random, () => pick(random, ["bug", "idea", "other"]));
  out.message = field(random, () => "x".repeat(int(random, 5000)) || "a report");
  out.contact = field(random, () => `user${int(random, 99)}@example.com`);
  out.context = field(random, () => ({
    url: `/orders/${int(random, 99)}?token=${"t".repeat(int(random, 800))}`,
    viewport: "1440x900",
    userAgent: "u".repeat(int(random, 900)),
    language: "l".repeat(int(random, 90)),
    timezone: "Europe/Copenhagen",
    screen: "s".repeat(int(random, 90)),
    colorScheme: pick(random, ["dark", "light", "sepia"]),
    online: pick(random, [true, false, "yes"]),
    connection: "c".repeat(int(random, 40)),
  }));
  out.console = field(random, () =>
    entry(
      random,
      (r) => ({
        ts: scalar(r),
        level: pick(r, ["error", "warn", "log", "debug"]),
        message: "m".repeat(int(r, 900)),
        stack: entry(
          r,
          (rr) => ({
            file: "f".repeat(int(rr, 400)),
            line: scalar(rr),
            col: scalar(rr),
            fn: scalar(rr),
          }),
          20,
        ),
      }),
      80,
    ),
  );
  out.elements = field(random, () =>
    entry(
      random,
      (r) => ({
        selector: "#a".repeat(int(r, 400)),
        tag: "t".repeat(int(r, 60)),
        text: "e".repeat(int(r, 400)),
        rect: { x: scalar(r), y: scalar(r), width: scalar(r), height: scalar(r) },
        attributes: value(r, 2),
      }),
      20,
    ),
  );
  out.breadcrumbs = field(random, () =>
    entry(
      random,
      (r) => ({
        ts: scalar(r),
        kind: pick(r, ["click", "navigation", "submit", "visibility", "hover"]),
        target: "b".repeat(int(r, 900)),
        text: "t".repeat(int(r, 90)),
        from: scalar(r),
        to: scalar(r),
      }),
      50,
    ),
  );
  out.network = field(random, () =>
    entry(
      random,
      (r) => ({
        ts: scalar(r),
        method: "M".repeat(int(r, 40)),
        url: `/api/${"u".repeat(int(r, 900))}`,
        status: scalar(r),
        ms: scalar(r),
        error: scalar(r),
      }),
      50,
    ),
  );
  out.perf = field(random, () => ({
    lcp: scalar(random),
    cls: scalar(random),
    inp: scalar(random),
    ttfb: scalar(random),
    domContentLoaded: scalar(random),
    load: scalar(random),
    longTasks: { count: scalar(random), totalMs: scalar(random) },
    memory: { usedMB: scalar(random), limitMB: scalar(random) },
  }));
  out.storage = field(random, () => ({
    local: entry(random, (r) => ({ key: "k".repeat(int(r, 200)), length: scalar(r) }), 80),
    session: entry(random, (r) => ({ key: scalar(r), length: scalar(r) }), 80),
    cookies: entry(random, (r) => `c${"o".repeat(int(r, 200))}`, 150),
    values: value(random, 2),
  }));
  out.replay = field(random, () => ({
    events: entry(
      random,
      (r) => ({
        type: int(r, 8),
        timestamp: Date.now() + int(r, 10_000),
        // Occasionally deeper than any recursive walk should follow, and with
        // a null byte at the bottom so the walk is actually attempted.
        data: r() < 0.01 ? nest(600 + int(r, 3000), `deep${NUL}leaf`) : value(r, 3),
      }),
      40,
    ),
    seconds: scalar(random),
  }));
  out.screenshotDataUrl = field(random, () =>
    pick(random, [
      "data:image/png;base64,iVBORw0KGgo=",
      `data:image/png;base64,${"A".repeat(int(random, 4000))}`,
      "data:image/jpeg;base64,/9j/4AAQ",
      "not a data url",
    ]),
  );
  // The unknown keys `collectExtra` has to survive, hostile names included.
  const extras = int(random, 4);
  for (let i = 0; i < extras; i += 1) {
    const key = random() < 0.5 ? pick(random, HOSTILE_KEYS) : `extra${int(random, 40)}`;
    Object.defineProperty(out, key, {
      value: value(random, 3),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * No object a validator built may have a prototype the sender chose. A key
 * called `__proto__` in a parsed body is an own property; writing it back with
 * `=` reaches the setter instead, which both loses the value and hands the
 * sender a prototype on a row we are about to store.
 */
function assertOwnPrototypes(value: unknown, where: string, depth = 0): void {
  if (depth > 12 || typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) assertOwnPrototypes(item, where, depth + 1);
    return;
  }
  assert.ok(
    Object.getPrototypeOf(value) === Object.prototype,
    `${where} let the payload choose a prototype`,
  );
  for (const item of Object.values(value)) assertOwnPrototypes(item, where, depth + 1);
}

/** No output of any validator may carry a null byte into a database. */
function assertNoNul(text: string, where: string): void {
  assert.ok(!text.includes(NUL), `${where} kept a null byte`);
}

/** Every `MAX_*` the validated report is answerable for. */
function assertLimits(payload: Record<string, unknown>): void {
  const message = normaliseMessage(payload.message);
  if (message !== null) {
    assert.ok(message.length <= MAX_MESSAGE_LENGTH, "message over its limit");
    assertNoNul(message, "normaliseMessage");
  }
  const contact = normaliseContact(payload.contact);
  if (contact !== null) {
    assert.ok(contact.length <= MAX_CONTACT_LENGTH, "contact over its limit");
    assertNoNul(contact, "normaliseContact");
  }

  const context = normaliseContext(payload.context);
  assert.ok(context.url.length <= 500, "context.url over its limit");
  assert.ok(context.viewport.length <= 32, "context.viewport over its limit");
  assert.ok(context.userAgent.length <= 500, "context.userAgent over its limit");
  for (const [key, max] of Object.entries(MAX_CONTEXT_LENGTHS)) {
    const fact = (context as Record<string, unknown>)[key];
    if (typeof fact === "string") assert.ok(fact.length <= max, `context.${key} over its limit`);
  }
  assertNoNul(JSON.stringify(context), "normaliseContext");

  const entries = normaliseConsole(payload.console);
  assert.ok(entries.length <= MAX_CONSOLE_ENTRIES, "too many console entries");
  for (const item of entries) {
    assert.ok(item.message.length <= MAX_CONSOLE_MESSAGE_LENGTH, "console message over its limit");
    assert.ok((item.stack ?? []).length <= MAX_STACK_FRAMES, "too many stack frames");
    for (const frame of item.stack ?? []) {
      assert.ok(frame.file.length <= MAX_STACK_STRING_LENGTH, "stack file over its limit");
      assert.ok((frame.fn ?? "").length <= MAX_STACK_STRING_LENGTH, "stack fn over its limit");
      assert.ok(Number.isInteger(frame.line) && frame.line >= 0, "stack line is not a position");
      assert.ok(Number.isInteger(frame.col) && frame.col >= 0, "stack col is not a position");
    }
  }
  assertNoNul(JSON.stringify(entries), "normaliseConsole");

  const elements = normaliseElements(payload.elements);
  assert.ok(elements.length <= MAX_ELEMENTS, "too many elements");
  for (const el of elements) {
    assert.ok(el.selector.length <= 500, "selector over its limit");
    assert.ok(el.tag.length <= 32, "tag over its limit");
    assert.ok(el.text.length <= MAX_ELEMENT_TEXT_LENGTH, "element text over its limit");
    assert.ok(Object.keys(el.attributes).length <= 20, "too many attributes");
    for (const attr of Object.values(el.attributes)) {
      assert.ok(attr.length <= 200, "attribute value over its limit");
    }
    for (const side of Object.values(el.rect)) {
      assert.ok(Number.isFinite(side), "rect side is not a finite number");
    }
  }
  assertNoNul(JSON.stringify(elements), "normaliseElements");

  const crumbs = normaliseBreadcrumbs(payload.breadcrumbs);
  assert.ok(crumbs.length <= MAX_BREADCRUMBS, "too many breadcrumbs");
  for (const crumb of crumbs) {
    assert.ok((crumb.text ?? "").length <= MAX_BREADCRUMB_TEXT_LENGTH, "crumb text over its limit");
    for (const key of ["target", "from", "to"] as const) {
      assert.ok((crumb[key] ?? "").length <= 500, `crumb ${key} over its limit`);
    }
  }
  assertNoNul(JSON.stringify(crumbs), "normaliseBreadcrumbs");

  const network = normaliseNetwork(payload.network);
  assert.ok(network.length <= MAX_NETWORK_ENTRIES, "too many requests");
  for (const item of network) {
    assert.ok(item.method.length <= 20, "method over its limit");
    assert.ok(item.url.length <= 500, "url over its limit");
    assert.ok(Number.isInteger(item.status) && item.status >= 0 && item.status <= 999, "status");
    assert.ok(Number.isInteger(item.ms) && item.ms >= 0 && item.ms <= MAX_PERF_MS, "ms");
  }
  assertNoNul(JSON.stringify(network), "normaliseNetwork");

  const perf = normalisePerf(payload.perf);
  if (perf) {
    for (const key of ["lcp", "inp", "ttfb", "domContentLoaded", "load"] as const) {
      const figure: number | undefined = perf[key];
      if (figure !== undefined) {
        assert.ok(
          Number.isInteger(figure) && figure >= 0 && figure <= MAX_PERF_MS,
          `perf.${key} out of range`,
        );
      }
    }
    if (perf.cls !== undefined) {
      assert.ok(Number.isFinite(perf.cls) && perf.cls >= 0 && perf.cls <= 1000, "perf.cls");
    }
    if (perf.longTasks) {
      assert.ok(Number.isFinite(perf.longTasks.count), "longTasks.count");
      assert.ok(perf.longTasks.totalMs <= MAX_PERF_MS, "longTasks.totalMs over its limit");
    }
    if (perf.memory) {
      assert.ok(Number.isFinite(perf.memory.usedMB), "memory.usedMB");
      assert.ok(Number.isFinite(perf.memory.limitMB), "memory.limitMB");
    }
  }

  const storage = normaliseStorage(payload.storage);
  if (storage) {
    for (const list of [storage.local, storage.session]) {
      assert.ok((list ?? []).length <= MAX_STORAGE_KEYS, "too many storage keys");
      for (const key of list ?? []) {
        assert.ok(key.key.length <= MAX_STORAGE_KEY_LENGTH, "storage key over its limit");
        assert.ok(Number.isFinite(key.length) && key.length >= 0, "storage length");
      }
    }
    assert.ok((storage.cookies ?? []).length <= MAX_COOKIE_NAMES, "too many cookies");
    for (const name of storage.cookies ?? []) {
      assert.ok(name.length <= MAX_STORAGE_KEY_LENGTH, "cookie name over its limit");
    }
    const values = Object.entries(storage.values ?? {});
    assert.ok(values.length <= MAX_STORAGE_VALUES, "too many storage values");
    for (const [key, item] of values) {
      assert.ok(key.length <= MAX_STORAGE_KEY_LENGTH, "storage value key over its limit");
      assert.ok(item.length <= MAX_STORAGE_VALUE_LENGTH, "storage value over its limit");
    }
    assertNoNul(JSON.stringify(storage), "normaliseStorage");
    assertOwnPrototypes(storage, "normaliseStorage");
  }

  const replay = normaliseReplay(payload.replay);
  if (replay) {
    assert.ok(replay.events.length <= MAX_REPLAY_EVENTS, "too many replay events");
    assert.ok(utf8Length(JSON.stringify(replay.events)) <= MAX_REPLAY_BYTES, "replay too large");
    assert.ok(Number.isInteger(replay.seconds) && replay.seconds >= 0, "replay seconds");
    assertNoNul(JSON.stringify(replay.events), "normaliseReplay");
    assertOwnPrototypes(replay.events, "normaliseReplay");
  }

  const extra = collectExtra(payload);
  assert.ok(Object.keys(extra).length <= MAX_EXTRA_KEYS, "too many extra keys");
  for (const [key, item] of Object.entries(extra)) {
    assert.ok(key !== "__proto__" && key !== "constructor", `extra kept the key ${key}`);
    if (typeof item === "string") {
      assert.ok(item.length <= MAX_EXTRA_STRING_LENGTH, "extra string over its limit");
      assertNoNul(item, "collectExtra");
    } else {
      assert.ok(typeof item === "number" || typeof item === "boolean", "extra kept a container");
    }
  }
  assert.ok(
    Object.getPrototypeOf(extra) === Object.prototype,
    "collectExtra let a payload change its prototype",
  );
}

/** The statuses `handleReport` is allowed to answer. 500 is not one of them. */
const ALLOWED_STATUSES = new Set([200, 201, 202, 400, 401, 405, 408, 413, 429]);

function post(body: string): Request {
  return new Request("https://app.example.com/api/bug-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

test("thousands of hostile reports pass every validator without throwing", () => {
  const random = rng(SEED);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const payload = report(random);
    try {
      assertLimits(payload);
      // The two consumers of whatever the validators let through.
      const validated = validateReport(payload);
      if (validated) {
        assert.equal(typeof toMarkdown(validated), "string");
        assert.equal(typeof toMarkdown(scrubReport(validated, { contact: true })), "string");
      }
      assert.equal(typeof toMarkdown(scrubReport(payload)), "string");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      assert.fail(`FUZZ_SEED=${SEED} FUZZ_ITERATIONS=${ITERATIONS}, iteration ${i}: ${detail}`);
    }
  }
});

test("thousands of hostile bodies reach handleReport without a 500", async () => {
  const random = rng(SEED ^ 0x9e37_79b9);
  // A tenth of the iterations: each one is a Request, a parse and a render,
  // and the validators above have already seen the same generator.
  const rounds = Math.max(1, Math.round(ITERATIONS / 10));
  for (let i = 0; i < rounds; i += 1) {
    const payload = report(random);
    let body: string;
    try {
      body = JSON.stringify(payload) ?? "null";
    } catch {
      continue; // Not a body a browser could have sent either.
    }
    // Every fifth body is corrupted after serialisation, which is the shape a
    // truncated upload or a hand-written client actually arrives in.
    const text =
      i % 5 === 0 ? body.slice(0, Math.max(0, body.length - 1 - int(random, 40))) : body;
    let response: Response;
    try {
      response = await handleReport(post(text), { maxBodyBytes: 1024 * 1024 });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      assert.fail(`FUZZ_SEED=${SEED} FUZZ_ITERATIONS=${ITERATIONS}, iteration ${i}: ${detail}`);
      continue;
    }
    assert.ok(
      ALLOWED_STATUSES.has(response.status),
      `FUZZ_SEED=${SEED}, iteration ${i}: answered ${response.status}`,
    );
  }
});

/**
 * Found by the loop above. `normaliseReplay` walked a parsed event to take the
 * null bytes out and recursed once per level, so an event nested a couple of
 * thousand deep overflowed the stack — out of a function whose contract is
 * that it never throws, and out of `handleReport` as a 500. The depth the walk
 * follows is now its own limit, and a replay past it is dropped whole exactly
 * as an oversized one is.
 */
test("a replay nested deeper than the null-byte walk follows is dropped, not thrown", () => {
  let deep: unknown = `bottom${NUL}text`;
  for (let i = 0; i < 4000; i += 1) deep = [deep];
  const events = [{ type: 2, timestamp: 1_700_000_000_000, data: deep }];
  assert.equal(normaliseReplay({ events }), null);

  // The report around it survives: only the recording is gone.
  const report = validateReport({ message: "the page froze", replay: { events } });
  assert.equal(report?.replay, null);
  assert.equal(report?.message, "the page froze");
});

/**
 * The same walk wrote its cleaned keys back with `=`. A replay event whose
 * body carried `__proto__` therefore reached the prototype setter: the key's
 * value never made it into the copy, and the object about to be stored
 * inherited whatever the sender had put there instead. The allow-listed
 * storage values were written the same way, and lost a `__proto__` key whole.
 */
test("a __proto__ key in a replay event stays a key rather than becoming a prototype", () => {
  const events = JSON.parse(
    `[{"type":2,"timestamp":1,"__proto__":{"polluted":"yes"},"note":"has a null byte: \\u0000"}]`,
  ) as unknown[];
  const replay = normaliseReplay({ events });
  const event = replay?.events[0] as Record<string, unknown> | undefined;
  assert.ok(event, "the replay was dropped");
  assert.equal(Object.getPrototypeOf(event) === Object.prototype, true);
  assert.deepEqual(Object.keys(event).sort(), ["__proto__", "note", "timestamp", "type"]);
  assert.equal((event as { polluted?: unknown }).polluted, undefined);
});

test("a __proto__ key among the storage values is kept rather than dropped", () => {
  const storage = normaliseStorage(JSON.parse(`{"values":{"__proto__":"a flag","tenant":"9"}}`));
  assert.deepEqual(Object.keys(storage?.values ?? {}).sort(), ["__proto__", "tenant"]);
  assert.equal(Object.getPrototypeOf(storage?.values as object), Object.prototype);
});

test("an oversized body is refused with 413 rather than parsed", async () => {
  const body = JSON.stringify({ message: "x".repeat(200_000) });
  const response = await handleReport(post(body), { maxBodyBytes: 1024 });
  assert.equal(response.status, 413);
});
