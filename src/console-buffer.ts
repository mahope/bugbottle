/**
 * A small ring buffer of recent console errors, kept so a bug report can carry
 * the evidence with it.
 *
 * Error trackers catch what throws. They cannot tell you what someone was doing
 * when something merely looked wrong, and plenty of defects never throw at all.
 * When a report arrives, the last few console errors are usually the difference
 * between "it didn't work" and something reproducible.
 *
 * Only `error` and `warn` are recorded. `log` and `debug` are deliberately left
 * alone: they are noisy, and in most applications they are where stray user
 * data ends up. The original functions are always called through, so nothing
 * disappears from the developer console.
 */

import {
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_MESSAGE_LENGTH,
  type ConsoleEntry,
  type ConsoleLevel,
  type StackFrame,
} from "./report-core.ts";
import { parseStack } from "./stack.ts";

export type { ConsoleEntry, ConsoleLevel, StackFrame };

export type ConsoleBufferOptions = {
  /** How many entries to keep. Oldest are dropped first. Default 50. */
  maxEntries?: number;
  /** Longest a single message may be before it is clipped. Default 500. */
  maxMessageLength?: number;
};

type Limits = { maxEntries: number; maxMessageLength: number };

const DEFAULTS: Limits = {
  maxEntries: MAX_CONSOLE_ENTRIES,
  maxMessageLength: MAX_CONSOLE_MESSAGE_LENGTH,
};

let buffer: ConsoleEntry[] = [];
let initialised = false;
let limits: Limits = { ...DEFAULTS };
let originalError: typeof console.error | null = null;
let originalWarn: typeof console.warn | null = null;
let onError: ((e: ErrorEvent) => void) | null = null;
let onRejection: ((e: PromiseRejectionEvent) => void) | null = null;

function serialise(args: unknown[], maxLength: number): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        // Circular structures and the like — a readable stand-in beats throwing
        // from inside a console call.
        return String(a);
      }
    })
    .join(" ")
    .slice(0, maxLength);
}

function push(level: ConsoleLevel, args: unknown[], stack?: StackFrame[]): void {
  const entry: ConsoleEntry = {
    ts: new Date().toISOString(),
    level,
    message: serialise(args, limits.maxMessageLength),
  };
  if (stack && stack.length > 0) entry.stack = stack;
  buffer.push(entry);
  if (buffer.length > limits.maxEntries) buffer = buffer.slice(-limits.maxEntries);
}

/**
 * Starts recording. Call once, as early as your app can manage — anything that
 * happens before this is not in the buffer.
 *
 * Safe to call more than once; only the first call patches the console. In a
 * server-rendered app, call it from client-only code: it patches whichever
 * `console` it finds, and on the server that is the server's.
 *
 * Returns the stop, `resetConsoleBuffer`, so a caller can put the console back
 * without importing a second name. Every `init*` in the package returns its
 * own, and a second call returns it as well.
 */
export function initConsoleBuffer(options: ConsoleBufferOptions = {}): () => void {
  if (initialised) return resetConsoleBuffer;
  initialised = true;
  limits = {
    maxEntries: options.maxEntries ?? DEFAULTS.maxEntries,
    maxMessageLength: options.maxMessageLength ?? DEFAULTS.maxMessageLength,
  };

  originalError = console.error;
  originalWarn = console.warn;

  console.error = (...args: unknown[]) => {
    push("error", args);
    originalError?.(...args);
  };
  console.warn = (...args: unknown[]) => {
    push("warn", args);
    originalWarn?.(...args);
  };

  if (typeof window !== "undefined") {
    // Uncaught errors do not reach console.error in every browser, so they are
    // recorded directly.
    // The message stays the one-liner it always was; the frames are the extra
    // evidence, parsed from whatever the browser attached to the error itself.
    onError = (e) => {
      push(
        "error",
        [`Uncaught: ${e.message} (${e.filename}:${e.lineno})`],
        parseStack((e.error as { stack?: unknown } | undefined)?.stack),
      );
    };
    onRejection = (e) => {
      push(
        "error",
        [`Unhandled rejection: ${serialise([e.reason], limits.maxMessageLength)}`],
        parseStack((e.reason as { stack?: unknown } | undefined)?.stack),
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
  }
  return resetConsoleBuffer;
}

/** A copy of what has been recorded so far. */
export function getConsoleBuffer(): ConsoleEntry[] {
  return [...buffer];
}

/** Empties the buffer and restores the real console functions. */
export function resetConsoleBuffer(): void {
  buffer = [];
  if (!initialised) return;
  if (originalError) console.error = originalError;
  if (originalWarn) console.warn = originalWarn;
  if (typeof window !== "undefined") {
    if (onError) window.removeEventListener("error", onError);
    if (onRejection) window.removeEventListener("unhandledrejection", onRejection);
  }
  onError = null;
  onRejection = null;
  initialised = false;
  limits = { ...DEFAULTS };
}
