/**
 * The last half-minute before the reporter opened the panel, as a session
 * replay — for the teams that already run rrweb.
 *
 * This is an adapter, not a recorder. `rrweb` is not a dependency and is never
 * imported: the application passes its own `record` function in, exactly as it
 * passes the screenshot renderer in. The type below is structural, so a
 * version bump in rrweb is not a version bump here, and an application that
 * never calls this pays nothing for it — `bugbottle/rrweb` is its own entry
 * point, and the core only reads a registry slot.
 *
 * What it adds to `record` is the buffer. rrweb emits events forever; a bug
 * report wants the recent past and nothing else. `checkoutEveryNms` makes
 * rrweb take a fresh full snapshot every ten seconds, and a full snapshot is
 * the only place a replay can be cut: everything after one is a diff against
 * it, so dropping events from the middle of a group leaves a recording that
 * cannot be played. The buffer therefore keeps whole checkout groups and drops
 * the oldest one — when it is entirely outside the window, and again when the
 * serialised buffer is over `maxBytes`.
 *
 * Read the privacy section of the README before turning this on, and then read
 * it again. A replay is a recording of a person using your application: their
 * text, their layout, their timing. `maskAllInputs` is on by default here and
 * the `data-bugbottle-mask` and `data-bugbottle-block` markers that already
 * govern screenshots are mapped onto rrweb's own selectors, but masking is a
 * floor and not a guarantee — anything rendered on the page that is not marked
 * is in the recording.
 */

import { registerReplaySource } from "./registry.ts";
import { MAX_REPLAY_BYTES, type ReplayCapture, type ReplayEvent } from "./report-core.ts";

export type { ReplayCapture, ReplayEvent };

/** How much of the recent past the buffer keeps, in seconds. */
export const DEFAULT_REPLAY_SECONDS = 30;

/** How large the serialised buffer may grow before the oldest group goes. */
export const DEFAULT_REPLAY_MAX_BYTES = 512 * 1024;

/**
 * How often rrweb is asked to take a fresh full snapshot. Ten seconds is the
 * granularity of the trim: the buffer can only be cut at a checkout, so a
 * longer interval keeps more than the window asked for and a shorter one costs
 * a full snapshot of the DOM every few seconds.
 */
export const REPLAY_CHECKOUT_MS = 10_000;

/** The screenshot mask marker, handed to rrweb as its text mask. */
export const REPLAY_MASK_SELECTOR = "[data-bugbottle-mask]";

/**
 * What rrweb is told not to record at all: the regions marked for a solid
 * overlay in a screenshot, and the panel itself — a bug reporter filming the
 * bug reporter is noise at best.
 */
export const REPLAY_BLOCK_SELECTOR = "[data-bugbottle-block],[data-bugbottle]";

/** One rrweb event. `type` and `timestamp` are all this module reads. */
export type RrwebEvent = {
  /** rrweb's event type number. 2 is a full snapshot. */
  type: number;
  /** Epoch milliseconds. */
  timestamp: number;
  [key: string]: unknown;
};

/**
 * The options this adapter hands rrweb's `record`. Typed structurally and
 * loosely on purpose: rrweb owns this shape, and pinning it here would make
 * every rrweb release a breaking change for a library that does not depend on
 * it.
 */
export type RrwebRecordOptions = {
  emit: (event: RrwebEvent, isCheckout?: boolean) => void;
  checkoutEveryNms?: number;
  maskAllInputs?: boolean;
  maskTextSelector?: string;
  blockSelector?: string;
  [key: string]: unknown;
};

/** `record` as rrweb exports it: hand it options, get the stop back. */
export type RrwebRecord = (options: RrwebRecordOptions) => (() => void) | undefined;

export type RrwebOptions = {
  /** How much of the recent past to keep, in seconds. Default 30. */
  seconds?: number;
  /** Ceiling on the serialised buffer, in bytes. Default 512 KiB. */
  maxBytes?: number;
  /**
   * Passed through to `record`, over this adapter's own defaults. This is
   * where an application widens or narrows the masking:
   *
   * ```ts
   * attachRrweb(record, { recordOptions: { maskTextClass: "sensitive" } });
   * ```
   *
   * `maskAllInputs: false` is accepted, because it is your recording and your
   * decision. It is not the default, and it should not be one.
   */
  recordOptions?: Partial<RrwebRecordOptions>;
};

/** One checkout group: a full snapshot and the diffs that follow it. */
type Group = {
  /** Timestamp of the event that opened the group. */
  start: number;
  events: RrwebEvent[];
  /** Roughly what these events serialise to, kept as they arrive. */
  bytes: number;
};

let groups: Group[] = [];
let totalBytes = 0;
let windowMs = DEFAULT_REPLAY_SECONDS * 1000;
let maxBytes = DEFAULT_REPLAY_MAX_BYTES;
let stopRecording: (() => void) | null = null;
let attached = false;

/**
 * What one event costs, near enough. `JSON.stringify` on every event is the
 * honest measure and it is what the cap is really about; the alternative is
 * measuring the whole buffer on every emit, which is the same work multiplied
 * by the number of events already in it.
 */
function sizeOf(event: RrwebEvent): number {
  try {
    return JSON.stringify(event).length + 1;
  } catch {
    // A circular event is not one rrweb produces, and it is certainly not one
    // that can be sent. Count it as large so the cap sheds it.
    return maxBytes;
  }
}

/**
 * Drops whole groups off the front: first the ones that are entirely outside
 * the window, then, while the buffer is over the cap, the oldest that is left.
 * The newest group is never dropped — a buffer with nothing in it is not an
 * improvement on one that is slightly too old.
 */
function trim(now: number): void {
  while (groups.length > 1 && (groups[1] as Group).start <= now - windowMs) drop();
  while (groups.length > 1 && totalBytes > maxBytes) drop();
}

function drop(): void {
  const gone = groups.shift();
  if (gone) totalBytes -= gone.bytes;
}

/**
 * Starts the application's own rrweb recorder with a rolling buffer in front
 * of it, and registers that buffer so `buildReport` picks it up.
 *
 * ```ts
 * import { record } from "rrweb";
 * import { attachRrweb } from "bugbottle/rrweb";
 *
 * const stop = attachRrweb(record);
 * ```
 *
 * Safe to call twice: the second call is a no-op and returns the same stop.
 * A `record` that throws — an rrweb that will not run in this browser — leaves
 * nothing attached and nothing broken; a report is still a report without a
 * replay.
 *
 * Returns the `stop()` that stops the recorder, forgets the buffer and
 * unregisters the source.
 */
export function attachRrweb(record: RrwebRecord, options: RrwebOptions = {}): () => void {
  if (attached) return resetRrweb;
  const seconds =
    typeof options.seconds === "number" && Number.isFinite(options.seconds) && options.seconds > 0
      ? options.seconds
      : DEFAULT_REPLAY_SECONDS;
  windowMs = seconds * 1000;
  maxBytes =
    typeof options.maxBytes === "number" &&
    Number.isFinite(options.maxBytes) &&
    options.maxBytes > 0
      ? options.maxBytes
      : DEFAULT_REPLAY_MAX_BYTES;
  groups = [];
  totalBytes = 0;

  const emit = (event: RrwebEvent, isCheckout?: boolean) => {
    if (typeof event !== "object" || event === null) return;
    const timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.now();
    if (isCheckout || groups.length === 0) groups.push({ start: timestamp, events: [], bytes: 0 });
    const group = groups[groups.length - 1] as Group;
    group.events.push(event);
    const bytes = sizeOf(event);
    group.bytes += bytes;
    totalBytes += bytes;
    trim(timestamp);
  };

  try {
    stopRecording = record({
      emit,
      checkoutEveryNms: REPLAY_CHECKOUT_MS,
      maskAllInputs: true,
      maskTextSelector: REPLAY_MASK_SELECTOR,
      blockSelector: REPLAY_BLOCK_SELECTOR,
      ...options.recordOptions,
    }) ?? null;
  } catch {
    // rrweb refused to start. Nothing is attached and nothing is registered.
    groups = [];
    totalBytes = 0;
    return resetRrweb;
  }

  attached = true;
  registerReplaySource(getReplay);
  return resetRrweb;
}

/**
 * The buffer as a report field, or null when there is nothing to send. Called
 * by `buildReport` through the registry, at the moment a report is written.
 *
 * A buffer still over the cap after every droppable group has gone is answered
 * with null rather than with a truncated recording: one full snapshot larger
 * than half a megabyte is a page too big to replay, and half of it would not
 * play at all.
 */
export function getReplay(): ReplayCapture | null {
  if (totalBytes > maxBytes || totalBytes > MAX_REPLAY_BYTES) return null;
  const events: ReplayEvent[] = [];
  for (const group of groups) for (const event of group.events) events.push(event);
  if (events.length === 0) return null;
  const first = events[0]?.timestamp ?? 0;
  const last = events[events.length - 1]?.timestamp ?? first;
  return { events, seconds: Math.max(0, Math.round((last - first) / 1000)) };
}

/** Whether `attachRrweb` has run and not been stopped since. */
export function isRrwebAttached(): boolean {
  return attached;
}

/**
 * Stops the recorder, empties the buffer and unregisters the source, so a
 * later report carries no replay. This is what `attachRrweb` returns.
 */
export function resetRrweb(): void {
  try {
    stopRecording?.();
  } catch {
    // A recorder that objects to being stopped is still stopped as far as this
    // module is concerned.
  }
  stopRecording = null;
  attached = false;
  groups = [];
  totalBytes = 0;
  windowMs = DEFAULT_REPLAY_SECONDS * 1000;
  maxBytes = DEFAULT_REPLAY_MAX_BYTES;
  registerReplaySource(null);
}
