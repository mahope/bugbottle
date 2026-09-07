/**
 * Redacting the things a reporter never meant to send.
 *
 * A bug report is written in a hurry. People paste the request that failed,
 * the token they were debugging with, the customer's email address — and the
 * page URL carries a `?token=` of its own. This module walks a report and
 * replaces those with `[redacted]`.
 *
 * It is a separate module on purpose, and nothing in the core imports it. The
 * bare `bugbottle` entry has to stay under a kilobyte gzipped, so an
 * integrator who does not scrub must not pay for the patterns. Wire it in
 * yourself — `buildReport({ scrub: scrubReport })` in the browser, or call
 * `scrubReport` in the route handler before the row is written.
 *
 * Nothing here throws. It is handed browser input, sometimes malformed, and a
 * report that cannot be scrubbed is still a report worth keeping, so anything
 * unexpected is left exactly as it was found.
 */
export const DEFAULT_REPLACEMENT = "[redacted]";
/** Keeps whatever the pattern captured first, redacts the rest of the match. */
const keepPrefix = (_match, groups, replacement) => (groups[0] ?? "") + replacement;
/**
 * Luhn's check digit. Card numbers satisfy it; order numbers, invoice numbers
 * and timestamps only do so by accident, roughly one time in ten.
 */
function passesLuhn(digits) {
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
        let d = digits.charCodeAt(i) - 48;
        if (d < 0 || d > 9)
            return false;
        if (double) {
            d *= 2;
            if (d > 9)
                d -= 9;
        }
        sum += d;
        double = !double;
    }
    return sum % 10 === 0;
}
/**
 * The query scrubber's pattern, kept as its own binding so `scrubUrl` can use
 * it without touching `BUILTIN_SCRUBBERS`. A bundler that sees only `scrubUrl`
 * imported then drops every other pattern, `passesLuhn` included — which is
 * what lets `bugbottle/network` scrub its URLs inside a 1.2 kB budget.
 */
const QUERY_PATTERN = /([?&][^?&=#\s]*(?:token|key|secret|password|auth)[^?&=#\s]*=)[^&#\s]*/gi;
/**
 * Redacts the sensitive query values in one URL, keeping the key that named
 * them: `/orders?token=abc` becomes `/orders?token=[redacted]`. Everything
 * else — the path, the ordinary parameters — is left exactly as it was.
 *
 * This is the one part of the scrubber that `bugbottle/network` needs, and it
 * is exported separately so that module does not have to carry the rest.
 */
export function scrubUrl(url, replacement = DEFAULT_REPLACEMENT) {
    if (typeof url !== "string")
        return url;
    QUERY_PATTERN.lastIndex = 0;
    return url.replace(QUERY_PATTERN, (_match, prefix) => (prefix ?? "") + replacement);
}
/**
 * The patterns that are on by default, in the order they are applied. Order
 * matters: the query scrubber runs before the ones that would match the value
 * it is about to redact, and the card scrubber runs last so it never eats the
 * digits inside an IBAN.
 */
export const BUILTIN_SCRUBBERS = {
    query: {
        pattern: QUERY_PATTERN,
        replace: keepPrefix,
        urlsOnly: true,
    },
    bearer: {
        pattern: /(\bBearer\s+)[A-Za-z0-9\-._~+/]+=*/gi,
        replace: keepPrefix,
    },
    jwt: {
        pattern: /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
    },
    email: {
        pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    },
    iban: {
        pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}\b/g,
    },
    card: {
        pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
        // A long run of digits is only redacted when it could actually be a card:
        // 13 to 19 of them, and Luhn-valid. Everything else is somebody's order
        // number and belongs in the report.
        replace: (match, _groups, replacement) => {
            const digits = match.replace(/[^0-9]/g, "");
            if (digits.length < 13 || digits.length > 19)
                return match;
            return passesLuhn(digits) ? replacement : match;
        },
    },
};
const SCRUBBER_ORDER = ["query", "bearer", "jwt", "email", "iban", "card"];
function plan(options) {
    const keep = new Set(Array.isArray(options.keep) ? options.keep : []);
    const all = [];
    for (const name of SCRUBBER_ORDER) {
        if (!keep.has(name))
            all.push(BUILTIN_SCRUBBERS[name]);
    }
    if (Array.isArray(options.patterns)) {
        for (const pattern of options.patterns) {
            if (pattern instanceof RegExp)
                all.push({ pattern });
        }
    }
    return {
        all,
        plain: all.filter((s) => !s.urlsOnly),
        replacement: typeof options.replacement === "string" ? options.replacement : DEFAULT_REPLACEMENT,
    };
}
function scrubString(value, p, isUrl) {
    let out = value;
    for (const scrubber of isUrl ? p.all : p.plain) {
        const { pattern, replace } = scrubber;
        // A global regex carries `lastIndex` between uses; `replace` resets it,
        // but a caller-supplied pattern may have been left mid-scan elsewhere.
        pattern.lastIndex = 0;
        out = out.replace(pattern, (...args) => {
            const match = String(args[0]);
            const groups = args.slice(1, -2);
            return replace ? replace(match, groups, p.replacement) : p.replacement;
        });
    }
    return out;
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Scrubs a string in place in a copy, leaving anything else untouched. */
function scrubField(source, key, p, isUrl = false) {
    const value = source[key];
    if (typeof value === "string")
        source[key] = scrubString(value, p, isUrl);
}
/**
 * Attributes that describe the shape of an element rather than its content.
 * Redacting these would cost the reader the ability to tell one element from
 * another and buy no privacy at all.
 */
const STRUCTURAL_ATTRIBUTES = new Set(["id", "role", "type"]);
function scrubAttributes(attributes, p) {
    if (!isObject(attributes))
        return attributes;
    const out = { ...attributes };
    for (const [key, value] of Object.entries(out)) {
        if (typeof value !== "string" || STRUCTURAL_ATTRIBUTES.has(key))
            continue;
        // Everything but the three structural names is scrubbed. `describeElement`
        // also records aria-label, title, name and placeholder, and those are prose
        // written for a human: they name people, quote addresses and echo whatever
        // the field is asking for. Only href is treated as a URL, because only href
        // carries a query string.
        out[key] = scrubString(value, p, key === "href");
    }
    return out;
}
/** Every string property of a breadcrumb-like object, one level deep. */
function scrubBreadcrumb(entry, p) {
    if (typeof entry === "string")
        return scrubString(entry, p, false);
    if (!isObject(entry))
        return entry;
    const out = { ...entry };
    for (const [key, value] of Object.entries(out)) {
        if (typeof value === "string")
            out[key] = scrubString(value, p, false);
    }
    return out;
}
/**
 * Returns a copy of the report with matched substrings replaced.
 *
 * Pure: the report handed in is not modified. `screenshotDataUrl` is passed
 * through untouched — a picture is pixels, and masking it is a different job
 * with different trade-offs.
 */
export function scrubReport(report, options = {}) {
    if (!isObject(report))
        return report;
    try {
        const p = plan(options);
        const out = { ...report };
        scrubField(out, "message", p);
        if (isObject(out.context)) {
            const context = { ...out.context };
            scrubField(context, "url", p, true);
            out.context = context;
        }
        if (Array.isArray(out.console)) {
            out.console = out.console.map((entry) => {
                if (!isObject(entry))
                    return entry;
                const copy = { ...entry };
                scrubField(copy, "message", p);
                return copy;
            });
        }
        if (Array.isArray(out.elements)) {
            out.elements = out.elements.map((element) => {
                if (!isObject(element))
                    return element;
                const copy = { ...element };
                scrubField(copy, "text", p);
                if ("attributes" in copy)
                    copy.attributes = scrubAttributes(copy.attributes, p);
                return copy;
            });
        }
        if (Array.isArray(out.breadcrumbs)) {
            out.breadcrumbs = out.breadcrumbs.map((entry) => scrubBreadcrumb(entry, p));
        }
        return out;
    }
    catch {
        // Whatever went wrong, an unscrubbed report beats a thrown submit. The
        // caller asked for redaction, not for a form that refuses to send.
        return report;
    }
}
//# sourceMappingURL=scrub.js.map