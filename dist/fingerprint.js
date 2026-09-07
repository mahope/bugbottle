/**
 * One identity for a report, computed the same way in the browser and on the
 * server.
 *
 * Two things need it. The auto-open trigger has to recognise the same error
 * arriving a hundred times from a render loop, and the receiver has to
 * recognise the same report arriving twice because a reporter pressed send
 * twice or a retry fired. Both are the same question — "have I seen this
 * already?" — so both ask it of the same function, and a fingerprint written
 * down by a sink means the same thing as one computed in a browser.
 *
 * The hash is FNV-1a over UTF-16 code units: no dependency, a few lines, and
 * stable across runtimes and versions. It is not a security primitive and is
 * never used as one; collisions here cost a deduplicated report, not a secret.
 *
 * This module is imported by nothing in the core entry, so a bundler drops it
 * whole when the integrator never asks for a fingerprint.
 */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
/** A short, stable, base-36 hash of a string. Same input, same output, always. */
export function stableHash(input) {
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME);
    }
    return (hash >>> 0).toString(36);
}
/**
 * Whitespace is not part of what makes two reports the same: a message
 * re-wrapped by a textarea, or a stack indented differently by another
 * runtime, is still the same message.
 */
function normalise(value) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}
/**
 * The identity of a report: its type, its message, and the first console error
 * recorded with it.
 *
 * The console entry is what separates "the save button does nothing" reported
 * from two different broken screens. Anything more — the URL, the viewport,
 * the breadcrumbs — would make every report unique, which is the same as
 * having no fingerprint at all.
 */
export function fingerprint(report) {
    const type = typeof report.type === "string" ? report.type : "other";
    const entries = Array.isArray(report.console) ? report.console : [];
    let firstError = "";
    for (const entry of entries) {
        if (entry && typeof entry === "object") {
            const line = entry;
            if (line.level === "error") {
                firstError = normalise(line.message);
                break;
            }
        }
    }
    return stableHash(`${type}\n${normalise(report.message)}\n${firstError}`);
}
//# sourceMappingURL=fingerprint.js.map