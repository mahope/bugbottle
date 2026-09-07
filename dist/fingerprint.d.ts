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
/** A short, stable, base-36 hash of a string. Same input, same output, always. */
export declare function stableHash(input: string): string;
/** The fields a fingerprint is made of. A `BugReport` or a `ValidatedReport` fits. */
export type FingerprintInput = {
    type?: unknown;
    message?: unknown;
    console?: unknown;
};
/**
 * The identity of a report: its type, its message, and the first console error
 * recorded with it.
 *
 * The console entry is what separates "the save button does nothing" reported
 * from two different broken screens. Anything more — the URL, the viewport,
 * the breadcrumbs — would make every report unique, which is the same as
 * having no fingerprint at all.
 */
export declare function fingerprint(report: FingerprintInput): string;
//# sourceMappingURL=fingerprint.d.ts.map