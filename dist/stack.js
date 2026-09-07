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
import { MAX_STACK_FRAMES, MAX_STACK_STRING_LENGTH } from "./report-core.js";
/**
 * `fn@file:line:col`, `at fn (file:line:col)` and `at file:line:col` in one
 * pass. The function name is optional and lazy so it stops at the separator;
 * the file may contain colons and slashes, so it is anchored by the two
 * numbers at the end of the line.
 */
const FRAME = /^\s*(?:at )?(?:(.*?) ?[(@])?(\S+?):(\d+):(\d+)\)?\s*$/;
/**
 * Parses up to `maxFrames` frames out of a stack string. Never throws: a
 * missing or nonsense stack means "no frames", not a failed report.
 */
export function parseStack(stack, maxFrames = MAX_STACK_FRAMES) {
    if (typeof stack !== "string")
        return [];
    const frames = [];
    for (const line of stack.split("\n")) {
        if (frames.length >= maxFrames)
            break;
        const match = FRAME.exec(line);
        if (!match)
            continue;
        const frame = {
            file: (match[2] ?? "").slice(0, MAX_STACK_STRING_LENGTH),
            line: Number(match[3]),
            col: Number(match[4]),
        };
        const fn = (match[1] ?? "").trim();
        if (fn)
            frame.fn = fn.slice(0, MAX_STACK_STRING_LENGTH);
        frames.push(frame);
    }
    return frames;
}
//# sourceMappingURL=stack.js.map