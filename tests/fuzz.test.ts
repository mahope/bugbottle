/**
 * The bodies that broke a validator, kept as tests.
 *
 * "The server trusts nothing" is a rule the rest of the suite checks one case
 * at a time. This file is where the cases nobody thought of end up: a payload
 * that made a validator throw, or slip a limit, is fixed in the module and
 * written down here so it stays fixed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseReplay, normaliseStorage } from "../src/report-core.ts";
import { validateReport } from "../src/server/handle.ts";

/** A literal NUL breaks tooling, so it is built rather than typed. */
const NUL = String.fromCharCode(0);

/**
 * `normaliseReplay` walked a parsed event to take the null bytes out and
 * recursed once per level, so an event nested a couple of thousand deep
 * overflowed the stack — out of a function whose contract is that it never
 * throws, and out of `handleReport` as a 500. The depth the walk follows is
 * now its own limit, and a replay past it is dropped whole exactly as an
 * oversized one is.
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
