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
import { type ConsoleEntry, type ConsoleLevel, type StackFrame } from "./report-core.ts";
export type { ConsoleEntry, ConsoleLevel, StackFrame };
export type ConsoleBufferOptions = {
    /** How many entries to keep. Oldest are dropped first. Default 50. */
    maxEntries?: number;
    /** Longest a single message may be before it is clipped. Default 500. */
    maxMessageLength?: number;
};
/**
 * Starts recording. Call once, as early as your app can manage — anything that
 * happens before this is not in the buffer.
 *
 * Safe to call more than once; only the first call patches the console. In a
 * server-rendered app, call it from client-only code: it patches whichever
 * `console` it finds, and on the server that is the server's.
 */
export declare function initConsoleBuffer(options?: ConsoleBufferOptions): void;
/** A copy of what has been recorded so far. */
export declare function getConsoleBuffer(): ConsoleEntry[];
/** Empties the buffer and restores the real console functions. */
export declare function resetConsoleBuffer(): void;
//# sourceMappingURL=console-buffer.d.ts.map