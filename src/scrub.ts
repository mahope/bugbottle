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

/** The built-in patterns, by the name `keep` uses to switch one off. */
export type ScrubberName = "email" | "bearer" | "jwt" | "card" | "iban" | "query";

/**
 * How one pattern redacts. `replace` decides what a single match becomes,
 * which is how the card scrubber lets a 16-digit order number through and how
 * `query` keeps the key it found the value under.
 */
export type Scrubber = {
  /** Matched against every scrubbed string. Must be global. */
  pattern: RegExp;
  /** Returns the text for one match. Returning the match keeps it. */
  replace?: (match: string, groups: (string | undefined)[], replacement: string) => string;
  /**
   * Only applied to fields that hold a URL — `context.url` and an `href`
   * attribute. A message that happens to say `key=value` is prose, not a
   * credential, and redacting it would be worse than leaving it.
   */
  urlsOnly?: boolean;
};

export type ScrubOptions = {
  /**
   * Extra patterns, redacted whole. Global regexes, please: a non-global one
   * only ever replaces the first match on a line.
   */
  patterns?: RegExp[];
  /** Built-in patterns to switch off, by name. */
  keep?: ScrubberName[];
  /** What redacted text becomes. Default `[redacted]`. */
  replacement?: string;
};

export const DEFAULT_REPLACEMENT = "[redacted]";

/** Keeps whatever the pattern captured first, redacts the rest of the match. */
const keepPrefix = (_match: string, groups: (string | undefined)[], replacement: string) =>
  (groups[0] ?? "") + replacement;

/**
 * Luhn's check digit. Card numbers satisfy it; order numbers, invoice numbers
 * and timestamps only do so by accident, roughly one time in ten.
 */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
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
export function scrubUrl(url: string, replacement: string = DEFAULT_REPLACEMENT): string {
  if (typeof url !== "string") return url;
  QUERY_PATTERN.lastIndex = 0;
  return url.replace(QUERY_PATTERN, (_match, prefix: string) => (prefix ?? "") + replacement);
}

/**
 * The patterns that are on by default, in the order they are applied. Order
 * matters: the query scrubber runs before the ones that would match the value
 * it is about to redact, and the card scrubber runs last so it never eats the
 * digits inside an IBAN.
 */
export const BUILTIN_SCRUBBERS: Record<ScrubberName, Scrubber> = {
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
      if (digits.length < 13 || digits.length > 19) return match;
      return passesLuhn(digits) ? replacement : match;
    },
  },
};

const SCRUBBER_ORDER: ScrubberName[] = ["query", "bearer", "jwt", "email", "iban", "card"];

type Plan = {
  all: Scrubber[];
  /** The subset that is not `urlsOnly`, so plain strings skip the check. */
  plain: Scrubber[];
  replacement: string;
};

function plan(options: ScrubOptions): Plan {
  const keep = new Set(Array.isArray(options.keep) ? options.keep : []);
  const all: Scrubber[] = [];
  for (const name of SCRUBBER_ORDER) {
    if (!keep.has(name)) all.push(BUILTIN_SCRUBBERS[name]);
  }
  if (Array.isArray(options.patterns)) {
    for (const pattern of options.patterns) {
      if (pattern instanceof RegExp) all.push({ pattern });
    }
  }
  return {
    all,
    plain: all.filter((s) => !s.urlsOnly),
    replacement: typeof options.replacement === "string" ? options.replacement : DEFAULT_REPLACEMENT,
  };
}

function scrubString(value: string, p: Plan, isUrl: boolean): string {
  let out = value;
  for (const scrubber of isUrl ? p.all : p.plain) {
    const { pattern, replace } = scrubber;
    // A global regex carries `lastIndex` between uses; `replace` resets it,
    // but a caller-supplied pattern may have been left mid-scan elsewhere.
    pattern.lastIndex = 0;
    out = out.replace(pattern, (...args) => {
      const match = String(args[0]);
      const groups = args.slice(1, -2) as (string | undefined)[];
      return replace ? replace(match, groups, p.replacement) : p.replacement;
    });
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Scrubs a string in place in a copy, leaving anything else untouched. */
function scrubField(source: Record<string, unknown>, key: string, p: Plan, isUrl = false): void {
  const value = source[key];
  if (typeof value === "string") source[key] = scrubString(value, p, isUrl);
}

/**
 * Attributes that describe the shape of an element rather than its content.
 * Redacting these would cost the reader the ability to tell one element from
 * another and buy no privacy at all.
 */
const STRUCTURAL_ATTRIBUTES = new Set(["id", "role", "type"]);

function scrubAttributes(attributes: unknown, p: Plan): unknown {
  if (!isObject(attributes)) return attributes;
  const out: Record<string, unknown> = { ...attributes };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== "string" || STRUCTURAL_ATTRIBUTES.has(key)) continue;
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
function scrubBreadcrumb(entry: unknown, p: Plan): unknown {
  if (typeof entry === "string") return scrubString(entry, p, false);
  if (!isObject(entry)) return entry;
  const out: Record<string, unknown> = { ...entry };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string") out[key] = scrubString(value, p, false);
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
export function scrubReport<T>(report: T, options: ScrubOptions = {}): T {
  if (!isObject(report)) return report;
  try {
    const p = plan(options);
    const out: Record<string, unknown> = { ...report };

    scrubField(out, "message", p);

    if (isObject(out.context)) {
      const context = { ...out.context };
      scrubField(context, "url", p, true);
      out.context = context;
    }

    if (Array.isArray(out.console)) {
      out.console = out.console.map((entry) => {
        if (!isObject(entry)) return entry;
        const copy = { ...entry };
        scrubField(copy, "message", p);
        return copy;
      });
    }

    if (Array.isArray(out.elements)) {
      out.elements = out.elements.map((element) => {
        if (!isObject(element)) return element;
        const copy = { ...element };
        scrubField(copy, "text", p);
        if ("attributes" in copy) copy.attributes = scrubAttributes(copy.attributes, p);
        return copy;
      });
    }

    if (Array.isArray(out.breadcrumbs)) {
      out.breadcrumbs = out.breadcrumbs.map((entry) => scrubBreadcrumb(entry, p));
    }

    // The allow-listed storage values and the cookie names. The values are
    // there because somebody named the key, which says the key is interesting,
    // not that everything inside it is safe: a feature-flag blob can still
    // carry the email address it was keyed by. Cookie names are scrubbed for
    // the same reason — applications habitually name a cookie after the user
    // it belongs to. Key names and lengths are left alone: they are the shape
    // of the store, and redacting them costs the reader the whole point of the
    // snapshot. `perf` holds nothing but numbers, so there is nothing there to
    // redact.
    if (isObject(out.storage)) {
      const storage: Record<string, unknown> = { ...out.storage };
      if (isObject(storage.values)) {
        const values: Record<string, unknown> = { ...storage.values };
        for (const [key, value] of Object.entries(values)) {
          if (typeof value === "string") values[key] = scrubString(value, p, false);
        }
        storage.values = values;
      }
      if (Array.isArray(storage.cookies)) {
        storage.cookies = storage.cookies.map((name) =>
          typeof name === "string" ? scrubString(name, p, false) : name,
        );
      }
      out.storage = storage;
    }

    return out as T;
  } catch {
    // Whatever went wrong, an unscrubbed report beats a thrown submit. The
    // caller asked for redaction, not for a form that refuses to send.
    return report;
  }
}
