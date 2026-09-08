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
import { normaliseReplay } from "../src/report-core.ts";
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
