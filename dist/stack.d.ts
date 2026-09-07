/**
 * One small parser turning an `error.stack` string into frames.
 *
 * Browsers disagree about the shape of a stack, and none of them promises one:
 * V8 writes `at fn (file:line:col)` or `at file:line:col`, Firefox and Safari
 * write `fn@file:line:col`. Rather than sniff the browser, every line is run
 * through the same expression, which reads the trailing `:line:col` and treats
 * whatever came before an `@` or an opening bracket as the function name. A
 * line that does not end in a position — the `TypeError: …` header, an
 * `[native code]` frame, anything else a runtime invents — is skipped rather
 * than guessed at.
 *
 * Only positions are kept. No source text is ever read or recorded: a frame
 * says where to look, and the reporter's screen is not a code viewer.
 */
import { type StackFrame } from "./report-core.ts";
/**
 * Parses up to `maxFrames` frames out of a stack string. Never throws: a
 * missing or nonsense stack means "no frames", not a failed report.
 */
export declare function parseStack(stack: unknown, maxFrames?: number): StackFrame[];
//# sourceMappingURL=stack.d.ts.map