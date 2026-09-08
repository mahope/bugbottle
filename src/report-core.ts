/**
 * The shape of a report and the rules for validating one — no DOM, no network,
 * no storage. Both ends import this: the browser to build a report, the server
 * to check the one it received.
 *
 * Everything that arrives at the server is attacker-controlled input that is
 * about to be written to storage, so its shape is checked rather than trusted.
 * The screenshot needs the most care, but a message or a console entry can
 * carry a null byte that a database refuses, or be long enough to bloat a row.
 */

export const REPORT_TYPES = ["bug", "idea", "other"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Decoded ceiling for a screenshot. The client downscales before this. */
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

/** Base64 inflates by about a third; the prefix is the rest of the slack. */
export const MAX_SCREENSHOT_DATA_URL_LENGTH = 2_900_000;

export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Longest the optional contact line may be. It is a way of reaching one
 * person — an address, a phone number, a handle — not a paragraph, so 200
 * characters is generous and still short enough that nobody can hide prose in
 * a field a reader trusts to be short.
 */
export const MAX_CONTACT_LENGTH = 200;

/** How many console entries a report may carry. Oldest are dropped first. */
export const MAX_CONSOLE_ENTRIES = 50;

/** Longest a single console message may be before it is clipped. */
export const MAX_CONSOLE_MESSAGE_LENGTH = 500;

/** How many stack frames one console entry may carry. */
export const MAX_STACK_FRAMES = 10;

/** Longest a file or function name in a stack frame may be. */
export const MAX_STACK_STRING_LENGTH = 200;

/**
 * Longest each of the optional context facts may be. They are tokens rather
 * than prose — a locale, an IANA zone, a screen size, a connection type — so
 * anything longer is a mistake or an attempt to smuggle text into a field
 * nobody reads.
 */
export const MAX_CONTEXT_LENGTHS = {
  language: 35,
  timezone: 64,
  screen: 32,
  connection: 16,
} as const;

/** How many pointed-at elements a report may carry. */
export const MAX_ELEMENTS = 10;

/** Longest text kept for a pointed-at element. */
export const MAX_ELEMENT_TEXT_LENGTH = 200;

/** How many breadcrumbs a report may carry. Oldest are dropped first. */
export const MAX_BREADCRUMBS = 30;

/** Longest text kept for a clicked element. Short on purpose: a label, not a paragraph. */
export const MAX_BREADCRUMB_TEXT_LENGTH = 40;

/** How many recorded requests a report may carry. Oldest are dropped first. */
export const MAX_NETWORK_ENTRIES = 30;

/** How many keys of one web storage a report may carry. */
export const MAX_STORAGE_KEYS = 50;

/** How many cookie names a report may carry. */
export const MAX_COOKIE_NAMES = 100;

/** Longest a storage key or a cookie name may be before it is clipped. */
export const MAX_STORAGE_KEY_LENGTH = 100;

/**
 * Longest an allow-listed storage value may be. Short on purpose: the
 * allow-list exists for a feature flag or a tenant id, not for a serialised
 * session that happens to be interesting.
 */
export const MAX_STORAGE_VALUE_LENGTH = 200;

/** How many allow-listed values a report may carry. */
export const MAX_STORAGE_VALUES = 20;

/**
 * The largest duration any performance figure may claim, in milliseconds. An
 * hour is longer than any real page load and short enough that a row cannot be
 * bloated by a browser — or an attacker — sending 1e300.
 */
export const MAX_PERF_MS = 3_600_000;

/**
 * How large a session replay may be, serialised. A megabyte is a generous
 * thirty seconds of rrweb and small enough that a row, an email and a JSON
 * column all survive it. Over it the replay is dropped whole, exactly as an
 * oversized screenshot is: half a recording plays no better than none.
 */
export const MAX_REPLAY_BYTES = 1024 * 1024;

const replayEncoder = new TextEncoder();

/**
 * How many bytes a string costs once it is sent, stored or emailed. A
 * JavaScript string is measured in UTF-16 code units, and every character
 * outside Latin-1 costs more than one byte in UTF-8: a megabyte of `length`
 * is up to three megabytes on the wire for a page written in Chinese or full
 * of emoji. `TextEncoder` exists in every browser this library runs in and in
 * Node, so the client and the server count the same way.
 */
export function utf8Length(text: string): number {
  return replayEncoder.encode(text).byteLength;
}

/**
 * How many replay events one report may carry. The byte cap is the real
 * bound; this one stops a body of a million tiny objects from costing a
 * million iterations before the byte cap is reached.
 */
export const MAX_REPLAY_EVENTS = 20_000;

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type ConsoleLevel = "error" | "warn";

/**
 * One line of a parsed stack: where the code was, never what it said. Source
 * text is deliberately absent — a frame points at a file and a position, and
 * resolving that to a line of code is the reader's job, with their own maps.
 */
export type StackFrame = {
  /** Script the frame is in: a URL or a path, as the browser wrote it. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  col: number;
  /** Function name, when the browser named one. */
  fn?: string;
};

export type ConsoleEntry = {
  /** ISO 8601 timestamp. */
  ts: string;
  level: ConsoleLevel;
  message: string;
  /** Frames parsed from an uncaught error or a rejection, innermost first. */
  stack?: StackFrame[];
};

/**
 * Where the reporter was, and in what.
 *
 * Everything after `userAgent` is optional and best-effort: a browser that
 * does not offer a fact simply leaves it out. None of it identifies a person
 * more than the user agent already does.
 */
export type ReportContext = {
  /** Path and query of the page. The origin and the fragment are left out. */
  url: string;
  /** `${innerWidth}x${innerHeight}`. */
  viewport: string;
  userAgent: string;
  /** The browser's preferred language tag, e.g. `en-GB`. */
  language?: string;
  /** IANA time zone the browser resolved, e.g. `Europe/Copenhagen`. */
  timezone?: string;
  /** `${screenWidth}x${screenHeight}@${devicePixelRatio}`. */
  screen?: string;
  /** What `prefers-color-scheme` said at the time of the report. */
  colorScheme?: "dark" | "light";
  /** Whether the browser believed it was online. */
  online?: boolean;
  /** The Network Information API's effective type, e.g. `4g`. */
  connection?: string;
};

/** An element the reporter pointed at: what it is, what it says, where it is. */
export type ElementRef = {
  /** A short CSS selector, e.g. `form#checkout > button:nth-of-type(2)`. */
  selector: string;
  tag: string;
  /** Visible text, whitespace-collapsed and clipped. */
  text: string;
  /** Page coordinates in CSS pixels. */
  rect: { x: number; y: number; width: number; height: number };
  /** id, name, role, type, href, aria-label, placeholder, title and data-* — never data-bugbottle*. */
  attributes: Record<string, string>;
};

export const BREADCRUMB_KINDS = ["click", "navigation", "submit", "visibility"] as const;
export type BreadcrumbKind = (typeof BREADCRUMB_KINDS)[number];

/**
 * One thing the reporter did before they reported. A short timeline of these
 * turns "it broke after I clicked save" into something reproducible.
 *
 * Which fields are set depends on the kind: a click or a submit carries the
 * `target` selector (and, for a click, the visible `text`), a navigation
 * carries `from` and `to`, and a visibility change carries `to`.
 */
export type Breadcrumb = {
  /** ISO 8601 timestamp. */
  ts: string;
  kind: BreadcrumbKind;
  /** A short CSS selector for the element involved. */
  target?: string;
  /** Visible text of the clicked element, whitespace-collapsed and clipped. */
  text?: string;
  /** Path and query the navigation left, or nothing when it is not known. */
  from?: string;
  /** Path and query navigated to, or `hidden`/`visible` for a visibility change. */
  to?: string;
};

/**
 * One request the browser made before the report. Recorded by
 * `bugbottle/network`, which keeps the failed and the slow ones.
 *
 * Bodies and headers are never part of this, in either direction: that is
 * where tokens and personal data live. What is left says which call failed and
 * how long it took, which is the part that explains the report.
 */
export type NetworkEntry = {
  /** ISO 8601 timestamp of when the request finished. */
  ts: string;
  /** The HTTP method, upper case. */
  method: string;
  /** Path and query, with sensitive query values redacted. Cross-origin URLs keep their origin. */
  url: string;
  /** The response status, or 0 when the request never got one. */
  status: number;
  /** How long the request took, in milliseconds. */
  ms: number;
  /** True when the request failed before a status — offline, CORS, aborted. */
  error?: boolean;
};

/**
 * What the page cost the reporter, measured by `bugbottle/perf`.
 *
 * Every field is optional because every field is a measurement that may not
 * have happened: a browser without `PerformanceObserver`, a page nobody
 * interacted with, a runtime that does not expose the heap. Milliseconds are
 * whole numbers and `cls` is rounded to three decimals — this is evidence for
 * a reader, not a benchmark.
 */
export type PerfSnapshot = {
  /** Largest Contentful Paint, in milliseconds from navigation start. */
  lcp?: number;
  /** Cumulative Layout Shift, excluding shifts that followed a recent input. */
  cls?: number;
  /** Interaction to Next Paint: the worst interaction, in milliseconds. */
  inp?: number;
  /** Time to First Byte, in milliseconds from navigation start. */
  ttfb?: number;
  /** When `DOMContentLoaded` finished, in milliseconds from navigation start. */
  domContentLoaded?: number;
  /** When the load event finished, in milliseconds from navigation start. */
  load?: number;
  /** Tasks that blocked the main thread for over 50 ms. */
  longTasks?: { count: number; totalMs: number };
  /** The JS heap, where the browser exposes it. Chromium only. */
  memory?: { usedMB: number; limitMB: number };
};

/** One key of a web storage: its name and how long its value was. Never the value. */
export type StorageKeyRef = {
  /** The key, clipped. */
  key: string;
  /** How many characters the value had. */
  length: number;
};

/**
 * What was in the browser's stores when the report was written.
 *
 * Names and lengths, never values — a key called `authToken` says the state
 * the page was in, and its value says rather more than a bug report should.
 * `values` is the one exception and it is opt-in per key: `initPerf` copies a
 * value in only when the integrator named that key in `allowValues`.
 */
export type StorageSnapshot = {
  /** `localStorage` keys, in the order the browser lists them. */
  local?: StorageKeyRef[];
  /** `sessionStorage` keys, in the order the browser lists them. */
  session?: StorageKeyRef[];
  /** Cookie names. Never cookie values, allow-list or not. */
  cookies?: string[];
  /** Values of the allow-listed keys, clipped. */
  values?: Record<string, string>;
};

/**
 * One rrweb event, as rrweb wrote it.
 *
 * Only `type` and `timestamp` are read — by the buffer in `bugbottle/rrweb` to
 * find the checkouts, and by the validator to tell an event from whatever else
 * arrived in the array. The rest is rrweb's payload and is carried through
 * unread, because this library does not know how to play a replay and should
 * not pretend to. That is also why the whole thing is bounded by size rather
 * than field by field: it is somebody else's format.
 */
export type ReplayEvent = {
  /** rrweb's event type number. 2 is a full snapshot. */
  type: number;
  /** Epoch milliseconds. */
  timestamp: number;
  [key: string]: unknown;
};

/**
 * A session replay: the events and how long they cover.
 *
 * This is the heaviest and the most sensitive thing a report can carry — a
 * recording of somebody using your application — so it is only ever here
 * because the application called `attachRrweb` and handed its own rrweb
 * `record` in.
 */
export type ReplayCapture = {
  /** rrweb events, oldest first, starting at a full snapshot. */
  events: ReplayEvent[];
  /** How many seconds the events span, rounded. */
  seconds: number;
};

/** The JSON body a report is sent as. Extra fields may be added by the client. */
export type BugReport = {
  type: ReportType;
  message: string;
  context: ReportContext;
  /**
   * How to reach the reporter, when the form asked for it and they answered.
   * Free text: an email address, a phone number, a name in your own chat. Off
   * by default everywhere, and personal data the moment it is on — see the
   * privacy section of the README before you store it.
   */
  contact?: string;
  console?: ConsoleEntry[];
  /** Elements the reporter pointed at, in the order they were attached. */
  elements?: ElementRef[];
  /** What the reporter did before reporting, oldest first. */
  breadcrumbs?: Breadcrumb[];
  /** Requests that failed or were slow before the report, oldest first. */
  network?: NetworkEntry[];
  /** What the page cost, when `bugbottle/perf` was measuring. */
  perf?: PerfSnapshot;
  /** What was in the browser's stores, when `bugbottle/perf` was measuring. */
  storage?: StorageSnapshot;
  /** The last seconds before the report, when `bugbottle/rrweb` was recording. */
  replay?: ReplayCapture;
  screenshotDataUrl?: string;
};

export function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && (REPORT_TYPES as readonly string[]).includes(value);
}

/**
 * Postgres (and others) refuse a text value containing a null byte, so one
 * arriving from a browser would fail the whole insert.
 */
function stripNullBytes(text: string): string {
  return text.replace(/\u0000/g, "");
}

/**
 * Trims and length-checks the reporter's message.
 * Returns null when there is nothing worth storing.
 */
export function normaliseMessage(raw: unknown, maxLength = MAX_MESSAGE_LENGTH): string | null {
  if (typeof raw !== "string") return null;
  const text = stripNullBytes(raw).trim();
  if (text.length === 0) return null;
  return text.slice(0, maxLength);
}

/**
 * Trims and length-checks the optional contact line, exactly as the message is
 * treated. Returns null when there is nothing worth storing.
 *
 * There is deliberately no format check: the reporter is answering "how do we
 * reach you", and "call me on 12345678" is a perfectly good answer. Only the
 * sinks that need a real address — the Resend reply-to, Sentry's
 * `contact_email` — ask whether it looks like one, with {@link looksLikeEmail}.
 */
export function normaliseContact(raw: unknown, maxLength = MAX_CONTACT_LENGTH): string | null {
  if (typeof raw !== "string") return null;
  const text = stripNullBytes(raw).trim();
  if (text.length === 0) return null;
  return text.slice(0, maxLength);
}

/**
 * Whether a contact line can be used as an email address.
 *
 * Permissive on purpose: a line is only refused when it plainly is not an
 * address, because the cost of a false negative is a reply nobody can send and
 * the cost of a false positive is one bounced mail. Nothing in the browser
 * entry imports this, so it is tree-shaken out of every client bundle.
 */
export function looksLikeEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@,;]+@[^\s@,;.]+(?:\.[^\s@,;.]+)+$/.test(value.trim());
}

/**
 * Clips the context strings. A browser can send a user-agent of any length,
 * and this ends up in your database.
 *
 * The three required fields are always present, empty when they were missing.
 * The optional facts are only carried through when they arrived as the right
 * type and were not empty, so a receiver never has to tell "unknown" from
 * "the browser sent an empty string"; anything else in the object is dropped.
 */
export function normaliseContext(raw: unknown): ReportContext {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" ? stripNullBytes(v).slice(0, max) : "";
  const context: ReportContext = {
    url: str(obj.url, 500),
    viewport: str(obj.viewport, 32),
    userAgent: str(obj.userAgent, 500),
  };
  const language = str(obj.language, MAX_CONTEXT_LENGTHS.language);
  if (language) context.language = language;
  const timezone = str(obj.timezone, MAX_CONTEXT_LENGTHS.timezone);
  if (timezone) context.timezone = timezone;
  const screen = str(obj.screen, MAX_CONTEXT_LENGTHS.screen);
  if (screen) context.screen = screen;
  if (obj.colorScheme === "dark" || obj.colorScheme === "light") {
    context.colorScheme = obj.colorScheme;
  }
  if (typeof obj.online === "boolean") context.online = obj.online;
  const connection = str(obj.connection, MAX_CONTEXT_LENGTHS.connection);
  if (connection) context.connection = connection;
  return context;
}

/**
 * Validates the stack frames one console entry arrived with. A frame without a
 * string `file` or without finite numbers is dropped, strings are clipped, and
 * at most `maxFrames` are kept — the innermost ones, which is where a stack is
 * written from. Never throws.
 */
function normaliseStack(raw: unknown, maxFrames: number, maxStringLength: number): StackFrame[] {
  if (!Array.isArray(raw)) return [];
  const frames: StackFrame[] = [];
  for (const item of raw) {
    if (frames.length >= maxFrames) break;
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.file !== "string") continue;
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? Math.max(Math.trunc(v), 0) : 0;
    const frame: StackFrame = {
      file: stripNullBytes(o.file).slice(0, maxStringLength),
      line: num(o.line),
      col: num(o.col),
    };
    if (typeof o.fn === "string" && o.fn) frame.fn = stripNullBytes(o.fn).slice(0, maxStringLength);
    frames.push(frame);
  }
  return frames;
}

/**
 * Validates the console entries a report arrived with.
 *
 * Anything that is not an array of `{ ts, level, message }` with a known level
 * is dropped, messages are clipped, and only the most recent entries are kept.
 * Never throws: a malformed console section means "no console", not a failed
 * report.
 */
export function normaliseConsole(
  raw: unknown,
  options: {
    maxEntries?: number;
    maxMessageLength?: number;
    maxStackFrames?: number;
    maxStackStringLength?: number;
  } = {},
): ConsoleEntry[] {
  const maxEntries = options.maxEntries ?? MAX_CONSOLE_ENTRIES;
  const maxMessageLength = options.maxMessageLength ?? MAX_CONSOLE_MESSAGE_LENGTH;
  const maxStackFrames = options.maxStackFrames ?? MAX_STACK_FRAMES;
  const maxStackStringLength = options.maxStackStringLength ?? MAX_STACK_STRING_LENGTH;
  if (!Array.isArray(raw)) return [];

  const out: ConsoleEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { ts, level, message, stack } = item as Record<string, unknown>;
    if (level !== "error" && level !== "warn") continue;
    if (typeof message !== "string") continue;
    const entry: ConsoleEntry = {
      ts: typeof ts === "string" && !Number.isNaN(Date.parse(ts)) ? ts : "",
      level,
      message: stripNullBytes(message).slice(0, maxMessageLength),
    };
    const frames = normaliseStack(stack, maxStackFrames, maxStackStringLength);
    if (frames.length > 0) entry.stack = frames;
    out.push(entry);
  }
  return out.length > maxEntries ? out.slice(-maxEntries) : out;
}

/**
 * Validates the elements a report arrived with. Malformed entries are dropped,
 * strings are clipped, attribute names are limited to a safe pattern, and at
 * most `maxElements` are kept. Never throws.
 */
export function normaliseElements(
  raw: unknown,
  options: { maxElements?: number } = {},
): ElementRef[] {
  const maxElements = options.maxElements ?? MAX_ELEMENTS;
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, max: number) =>
    typeof v === "string" ? stripNullBytes(v).slice(0, max) : "";
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);

  const out: ElementRef[] = [];
  for (const item of raw) {
    if (out.length >= maxElements) break;
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const selector = str(o.selector, 500);
    const tag = str(o.tag, 32);
    if (!selector || !tag) continue;
    const rect = (o.rect ?? {}) as Record<string, unknown>;
    const attributes: Record<string, string> = {};
    if (typeof o.attributes === "object" && o.attributes !== null) {
      for (const [k, v] of Object.entries(o.attributes as Record<string, unknown>)) {
        if (Object.keys(attributes).length >= 20) break;
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(k) || k.startsWith("data-bugbottle")) continue;
        if (typeof v === "string") attributes[k] = stripNullBytes(v).slice(0, 200);
      }
    }
    out.push({
      selector,
      tag,
      text: str(o.text, MAX_ELEMENT_TEXT_LENGTH),
      rect: { x: num(rect.x), y: num(rect.y), width: num(rect.width), height: num(rect.height) },
      attributes,
    });
  }
  return out;
}

/**
 * Validates the breadcrumbs a report arrived with. Entries with an unknown
 * kind are dropped, strings are clipped, fields that are not strings are left
 * out entirely, and at most `maxBreadcrumbs` are kept — the most recent ones,
 * since the end of the timeline is the interesting end. Never throws: a
 * malformed section means "no breadcrumbs", not a failed report.
 */
export function normaliseBreadcrumbs(
  raw: unknown,
  options: { maxBreadcrumbs?: number } = {},
): Breadcrumb[] {
  const maxBreadcrumbs = options.maxBreadcrumbs ?? MAX_BREADCRUMBS;
  if (!Array.isArray(raw)) return [];

  const out: Breadcrumb[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const kind = o.kind;
    if (typeof kind !== "string" || !(BREADCRUMB_KINDS as readonly string[]).includes(kind)) {
      continue;
    }
    const crumb: Breadcrumb = {
      ts: typeof o.ts === "string" && !Number.isNaN(Date.parse(o.ts)) ? o.ts : "",
      kind: kind as BreadcrumbKind,
    };
    if (typeof o.target === "string") crumb.target = stripNullBytes(o.target).slice(0, 500);
    if (typeof o.text === "string") {
      crumb.text = stripNullBytes(o.text).slice(0, MAX_BREADCRUMB_TEXT_LENGTH);
    }
    if (typeof o.from === "string") crumb.from = stripNullBytes(o.from).slice(0, 500);
    if (typeof o.to === "string") crumb.to = stripNullBytes(o.to).slice(0, 500);
    out.push(crumb);
  }
  return out.length > maxBreadcrumbs ? out.slice(-maxBreadcrumbs) : out;
}

/**
 * Validates the recorded requests a report arrived with. An entry without a
 * string `url` is not a request and is dropped; everything else is clipped,
 * rounded or defaulted rather than rejected, and at most `maxEntries` are
 * kept — the most recent ones. Never throws: a malformed section means "no
 * requests", not a failed report.
 */
export function normaliseNetwork(
  raw: unknown,
  options: { maxEntries?: number } = {},
): NetworkEntry[] {
  const maxEntries = options.maxEntries ?? MAX_NETWORK_ENTRIES;
  if (!Array.isArray(raw)) return [];

  const out: NetworkEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.url !== "string") continue;
    const status = typeof o.status === "number" && Number.isFinite(o.status) ? o.status : 0;
    const ms = typeof o.ms === "number" && Number.isFinite(o.ms) ? o.ms : 0;
    const entry: NetworkEntry = {
      ts: typeof o.ts === "string" && !Number.isNaN(Date.parse(o.ts)) ? o.ts : "",
      // A method is a short token by definition, so anything longer is either
      // a mistake or an attempt to smuggle text through a field nobody reads.
      method: typeof o.method === "string" ? stripNullBytes(o.method).slice(0, 20) : "GET",
      url: stripNullBytes(o.url).slice(0, 500),
      status: Math.min(Math.max(Math.trunc(status), 0), 999),
      ms: Math.min(Math.max(Math.round(ms), 0), 3_600_000),
    };
    if (o.error === true) entry.error = true;
    out.push(entry);
  }
  return out.length > maxEntries ? out.slice(-maxEntries) : out;
}

/**
 * Validates the performance snapshot a report arrived with.
 *
 * Every field is optional and every field is a number, so the rule is the same
 * throughout: a finite number in range is kept and rounded, anything else is
 * left out. A snapshot with nothing usable in it is not a snapshot, and null
 * says so — a report carrying `perf: {}` claims a measurement it does not
 * have. Never throws: a malformed section means "not measured", not a failed
 * report.
 */
export function normalisePerf(raw: unknown): PerfSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: PerfSnapshot = {};

  /** A whole number, never negative, never past `max`. */
  const whole = (v: unknown, max: number): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
    return Math.min(Math.round(v), max);
  };
  for (const key of ["lcp", "inp", "ttfb", "domContentLoaded", "load"] as const) {
    const value = whole(o[key], MAX_PERF_MS);
    if (value !== null) out[key] = value;
  }
  // Layout shift is a unitless score, and three decimals is what the Web
  // Vitals reports print. A page that shifted a thousand times over is already
  // as bad as the number can usefully say.
  if (typeof o.cls === "number" && Number.isFinite(o.cls) && o.cls >= 0) {
    out.cls = Math.min(Math.round(o.cls * 1000) / 1000, 1000);
  }
  if (typeof o.longTasks === "object" && o.longTasks !== null) {
    const lt = o.longTasks as Record<string, unknown>;
    const count = whole(lt.count, 100_000);
    const totalMs = whole(lt.totalMs, MAX_PERF_MS);
    if (count !== null || totalMs !== null) {
      out.longTasks = { count: count ?? 0, totalMs: totalMs ?? 0 };
    }
  }
  if (typeof o.memory === "object" && o.memory !== null) {
    const mem = o.memory as Record<string, unknown>;
    const usedMB = whole(mem.usedMB, 1_000_000);
    const limitMB = whole(mem.limitMB, 1_000_000);
    if (usedMB !== null || limitMB !== null) {
      out.memory = { usedMB: usedMB ?? 0, limitMB: limitMB ?? 0 };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Validates the storage snapshot a report arrived with.
 *
 * The caps are the point of this one: a browser can hold megabytes in
 * `localStorage`, and a report that carried all of it would be a denial of
 * service with a bug attached. Keys are clipped, the lists are cut to
 * `MAX_STORAGE_KEYS` and `MAX_COOKIE_NAMES`, and the allow-listed values are
 * clipped hard. Empty sections are left out rather than sent as empty arrays,
 * so a reader can tell "nothing stored" from "not measured". Never throws.
 */
export function normaliseStorage(raw: unknown): StorageSnapshot | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: StorageSnapshot = {};

  const keyList = (value: unknown): StorageKeyRef[] => {
    if (!Array.isArray(value)) return [];
    const list: StorageKeyRef[] = [];
    for (const item of value) {
      if (list.length >= MAX_STORAGE_KEYS) break;
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.key !== "string") continue;
      const length =
        typeof entry.length === "number" && Number.isFinite(entry.length) && entry.length > 0
          ? Math.min(Math.round(entry.length), 100_000_000)
          : 0;
      list.push({ key: stripNullBytes(entry.key).slice(0, MAX_STORAGE_KEY_LENGTH), length });
    }
    return list;
  };

  const local = keyList(o.local);
  if (local.length > 0) out.local = local;
  const session = keyList(o.session);
  if (session.length > 0) out.session = session;

  if (Array.isArray(o.cookies)) {
    const cookies: string[] = [];
    for (const name of o.cookies) {
      if (cookies.length >= MAX_COOKIE_NAMES) break;
      if (typeof name !== "string") continue;
      cookies.push(stripNullBytes(name).slice(0, MAX_STORAGE_KEY_LENGTH));
    }
    if (cookies.length > 0) out.cookies = cookies;
  }

  if (typeof o.values === "object" && o.values !== null && !Array.isArray(o.values)) {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(o.values as Record<string, unknown>)) {
      if (Object.keys(values).length >= MAX_STORAGE_VALUES) break;
      if (typeof value !== "string") continue;
      values[stripNullBytes(key).slice(0, MAX_STORAGE_KEY_LENGTH)] = stripNullBytes(value).slice(
        0,
        MAX_STORAGE_VALUE_LENGTH,
      );
    }
    if (Object.keys(values).length > 0) out.values = values;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** A real U+0000, built rather than typed: a literal NUL breaks tooling. */
const NUL = String.fromCharCode(0);

/**
 * What `JSON.stringify` writes in place of a real NUL — computed from one
 * rather than spelled out, because those six characters are also a string a
 * page can legitimately render, and this file may hold neither form.
 */
const NUL_ESCAPE = JSON.stringify(NUL).slice(1, -1);

/**
 * A copy of `value` with every real null byte gone, out of the strings and out
 * of the keys alike. Postgres refuses a text value containing one, and a
 * replay is nested attacker-controlled JSON on its way into a column. What
 * arrives here has already survived `JSON.stringify`, so there is nothing
 * circular to guard against.
 */
function stripNuls(value: unknown): unknown {
  if (typeof value === "string") return stripNullBytes(value);
  if (Array.isArray(value)) return value.map(stripNuls);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[stripNullBytes(key)] = stripNuls(item);
    return out;
  }
  return value;
}

/**
 * Validates the session replay a report arrived with.
 *
 * Three rules, and they are the only ones this can honestly have. An event is
 * an object with a numeric `type` and a numeric `timestamp`; anything else in
 * the array is not an rrweb event and is dropped. The payload of an event is
 * carried through unread, because it is rrweb's format and not ours — which is
 * exactly why the third rule is a hard ceiling on the serialised size, and why
 * going over it drops the whole replay rather than part of it. A replay cut in
 * the middle does not play.
 *
 * Null bytes are stripped out of the parsed events, for the reason every other
 * validator strips them: Postgres refuses a text value containing one, and a
 * replay is nested attacker-controlled JSON on its way into a column.
 *
 * `seconds` is recomputed from the events that survived rather than believed.
 * Never throws: a malformed replay means "no replay", not a failed report.
 */
export function normaliseReplay(raw: unknown): ReplayCapture | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.events)) return null;

  const events: ReplayEvent[] = [];
  for (const item of o.events) {
    if (events.length >= MAX_REPLAY_EVENTS) break;
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const event = item as Record<string, unknown>;
    if (typeof event.type !== "number" || !Number.isFinite(event.type)) continue;
    if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp)) continue;
    events.push(event as ReplayEvent);
  }
  if (events.length === 0) return null;

  let serialised: string;
  try {
    serialised = JSON.stringify(events);
  } catch {
    // Circular, or a BigInt somebody hand-wrote. Either way it cannot be
    // stored and it is certainly not an rrweb recording.
    return null;
  }
  if (utf8Length(serialised) > MAX_REPLAY_BYTES) return null;

  // Stripping the escape out of the serialised text also hit an event whose
  // own text was those six characters, because that is what `JSON.stringify`
  // writes for both: the removal left JSON that would not parse and the whole
  // replay was dropped for nothing. So the walk is over the parsed values
  // instead, where a real NUL is one character and the six characters are six.
  // The serialised form still decides whether the walk is worth doing at all.
  const clean = serialised.includes(NUL_ESCAPE) ? (stripNuls(events) as ReplayEvent[]) : events;

  const first = clean[0]?.timestamp ?? 0;
  const last = clean[clean.length - 1]?.timestamp ?? first;
  const span = Math.round((last - first) / 1000);
  return { events: clean, seconds: Number.isFinite(span) && span > 0 ? span : 0 };
}

export class InvalidScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScreenshotError";
  }
}

/**
 * Turns a PNG data URL into bytes, or throws InvalidScreenshotError.
 *
 * Checks the declared type, the real PNG signature in the decoded bytes, and a
 * size ceiling — so a JPEG wearing a PNG label, a login page returned as HTML,
 * or a 40 MB payload never reaches storage.
 *
 * Treat a failure as "store the report without the picture" rather than as a
 * failed submission: the message is the valuable part.
 */
export function decodeScreenshotDataUrl(
  dataUrl: unknown,
  options: { maxBytes?: number; maxDataUrlLength?: number } = {},
): Uint8Array {
  const maxBytes = options.maxBytes ?? MAX_SCREENSHOT_BYTES;
  const maxLength = options.maxDataUrlLength ?? MAX_SCREENSHOT_DATA_URL_LENGTH;

  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new InvalidScreenshotError("Screenshot must be a PNG data URL");
  }
  if (dataUrl.length > maxLength) {
    throw new InvalidScreenshotError("Screenshot is too large");
  }

  const bytes = base64ToBytes(dataUrl.slice(PNG_DATA_URL_PREFIX.length));

  if (bytes.length > maxBytes) {
    throw new InvalidScreenshotError("Screenshot is too large");
  }
  // A short buffer would otherwise pass the signature check by running off the
  // end of the array.
  if (bytes.length < PNG_SIGNATURE.length) {
    throw new InvalidScreenshotError("Screenshot is not a valid PNG");
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new InvalidScreenshotError("Screenshot is not a valid PNG");
    }
  }
  return bytes;
}

/**
 * Works in Node and in the browser, without pulling in Buffer types.
 *
 * `atob` throws a DOMException on malformed input; that is wrapped so a caller
 * only ever has to catch InvalidScreenshotError.
 */
function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    let binary: string;
    try {
      binary = atob(b64);
    } catch {
      throw new InvalidScreenshotError("Screenshot is not valid base64");
    }
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  // Node without atob (or a stripped runtime).
  const g = globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } };
  if (g.Buffer) return new Uint8Array(g.Buffer.from(b64, "base64"));
  throw new InvalidScreenshotError("No base64 decoder available in this runtime");
}
