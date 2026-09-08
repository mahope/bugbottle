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
export const REPORT_TYPES = ["bug", "idea", "other"];
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
};
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
export function utf8Length(text) {
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
export const BREADCRUMB_KINDS = ["click", "navigation", "submit", "visibility"];
export function isReportType(value) {
    return typeof value === "string" && REPORT_TYPES.includes(value);
}
/**
 * Postgres (and others) refuse a text value containing a null byte, so one
 * arriving from a browser would fail the whole insert.
 */
function stripNullBytes(text) {
    return text.replace(/\u0000/g, "");
}
/**
 * Trims and length-checks the reporter's message.
 * Returns null when there is nothing worth storing.
 */
export function normaliseMessage(raw, maxLength = MAX_MESSAGE_LENGTH) {
    if (typeof raw !== "string")
        return null;
    const text = stripNullBytes(raw).trim();
    if (text.length === 0)
        return null;
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
export function normaliseContact(raw, maxLength = MAX_CONTACT_LENGTH) {
    if (typeof raw !== "string")
        return null;
    const text = stripNullBytes(raw).trim();
    if (text.length === 0)
        return null;
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
export function looksLikeEmail(value) {
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
export function normaliseContext(raw) {
    const obj = (raw ?? {});
    const str = (v, max) => typeof v === "string" ? stripNullBytes(v).slice(0, max) : "";
    const context = {
        url: str(obj.url, 500),
        viewport: str(obj.viewport, 32),
        userAgent: str(obj.userAgent, 500),
    };
    const language = str(obj.language, MAX_CONTEXT_LENGTHS.language);
    if (language)
        context.language = language;
    const timezone = str(obj.timezone, MAX_CONTEXT_LENGTHS.timezone);
    if (timezone)
        context.timezone = timezone;
    const screen = str(obj.screen, MAX_CONTEXT_LENGTHS.screen);
    if (screen)
        context.screen = screen;
    if (obj.colorScheme === "dark" || obj.colorScheme === "light") {
        context.colorScheme = obj.colorScheme;
    }
    if (typeof obj.online === "boolean")
        context.online = obj.online;
    const connection = str(obj.connection, MAX_CONTEXT_LENGTHS.connection);
    if (connection)
        context.connection = connection;
    return context;
}
/**
 * Validates the stack frames one console entry arrived with. A frame without a
 * string `file` or without finite numbers is dropped, strings are clipped, and
 * at most `maxFrames` are kept — the innermost ones, which is where a stack is
 * written from. Never throws.
 */
function normaliseStack(raw, maxFrames, maxStringLength) {
    if (!Array.isArray(raw))
        return [];
    const frames = [];
    for (const item of raw) {
        if (frames.length >= maxFrames)
            break;
        if (typeof item !== "object" || item === null)
            continue;
        const o = item;
        if (typeof o.file !== "string")
            continue;
        const num = (v) => typeof v === "number" && Number.isFinite(v) ? Math.max(Math.trunc(v), 0) : 0;
        const frame = {
            file: stripNullBytes(o.file).slice(0, maxStringLength),
            line: num(o.line),
            col: num(o.col),
        };
        if (typeof o.fn === "string" && o.fn)
            frame.fn = stripNullBytes(o.fn).slice(0, maxStringLength);
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
export function normaliseConsole(raw, options = {}) {
    const maxEntries = options.maxEntries ?? MAX_CONSOLE_ENTRIES;
    const maxMessageLength = options.maxMessageLength ?? MAX_CONSOLE_MESSAGE_LENGTH;
    const maxStackFrames = options.maxStackFrames ?? MAX_STACK_FRAMES;
    const maxStackStringLength = options.maxStackStringLength ?? MAX_STACK_STRING_LENGTH;
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null)
            continue;
        const { ts, level, message, stack } = item;
        if (level !== "error" && level !== "warn")
            continue;
        if (typeof message !== "string")
            continue;
        const entry = {
            ts: typeof ts === "string" && !Number.isNaN(Date.parse(ts)) ? ts : "",
            level,
            message: stripNullBytes(message).slice(0, maxMessageLength),
        };
        const frames = normaliseStack(stack, maxStackFrames, maxStackStringLength);
        if (frames.length > 0)
            entry.stack = frames;
        out.push(entry);
    }
    return out.length > maxEntries ? out.slice(-maxEntries) : out;
}
/**
 * Validates the elements a report arrived with. Malformed entries are dropped,
 * strings are clipped, attribute names are limited to a safe pattern, and at
 * most `maxElements` are kept. Never throws.
 */
export function normaliseElements(raw, options = {}) {
    const maxElements = options.maxElements ?? MAX_ELEMENTS;
    if (!Array.isArray(raw))
        return [];
    const str = (v, max) => typeof v === "string" ? stripNullBytes(v).slice(0, max) : "";
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
    const out = [];
    for (const item of raw) {
        if (out.length >= maxElements)
            break;
        if (typeof item !== "object" || item === null)
            continue;
        const o = item;
        const selector = str(o.selector, 500);
        const tag = str(o.tag, 32);
        if (!selector || !tag)
            continue;
        const rect = (o.rect ?? {});
        const attributes = {};
        if (typeof o.attributes === "object" && o.attributes !== null) {
            for (const [k, v] of Object.entries(o.attributes)) {
                if (Object.keys(attributes).length >= 20)
                    break;
                if (!/^[a-z][a-z0-9-]{0,63}$/.test(k) || k.startsWith("data-bugbottle"))
                    continue;
                if (typeof v === "string")
                    attributes[k] = stripNullBytes(v).slice(0, 200);
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
export function normaliseBreadcrumbs(raw, options = {}) {
    const maxBreadcrumbs = options.maxBreadcrumbs ?? MAX_BREADCRUMBS;
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null)
            continue;
        const o = item;
        const kind = o.kind;
        if (typeof kind !== "string" || !BREADCRUMB_KINDS.includes(kind)) {
            continue;
        }
        const crumb = {
            ts: typeof o.ts === "string" && !Number.isNaN(Date.parse(o.ts)) ? o.ts : "",
            kind: kind,
        };
        if (typeof o.target === "string")
            crumb.target = stripNullBytes(o.target).slice(0, 500);
        if (typeof o.text === "string") {
            crumb.text = stripNullBytes(o.text).slice(0, MAX_BREADCRUMB_TEXT_LENGTH);
        }
        if (typeof o.from === "string")
            crumb.from = stripNullBytes(o.from).slice(0, 500);
        if (typeof o.to === "string")
            crumb.to = stripNullBytes(o.to).slice(0, 500);
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
export function normaliseNetwork(raw, options = {}) {
    const maxEntries = options.maxEntries ?? MAX_NETWORK_ENTRIES;
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null)
            continue;
        const o = item;
        if (typeof o.url !== "string")
            continue;
        const status = typeof o.status === "number" && Number.isFinite(o.status) ? o.status : 0;
        const ms = typeof o.ms === "number" && Number.isFinite(o.ms) ? o.ms : 0;
        const entry = {
            ts: typeof o.ts === "string" && !Number.isNaN(Date.parse(o.ts)) ? o.ts : "",
            // A method is a short token by definition, so anything longer is either
            // a mistake or an attempt to smuggle text through a field nobody reads.
            method: typeof o.method === "string" ? stripNullBytes(o.method).slice(0, 20) : "GET",
            url: stripNullBytes(o.url).slice(0, 500),
            status: Math.min(Math.max(Math.trunc(status), 0), 999),
            ms: Math.min(Math.max(Math.round(ms), 0), 3_600_000),
        };
        if (o.error === true)
            entry.error = true;
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
export function normalisePerf(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        return null;
    const o = raw;
    const out = {};
    /** A whole number, never negative, never past `max`. */
    const whole = (v, max) => {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
            return null;
        return Math.min(Math.round(v), max);
    };
    for (const key of ["lcp", "inp", "ttfb", "domContentLoaded", "load"]) {
        const value = whole(o[key], MAX_PERF_MS);
        if (value !== null)
            out[key] = value;
    }
    // Layout shift is a unitless score, and three decimals is what the Web
    // Vitals reports print. A page that shifted a thousand times over is already
    // as bad as the number can usefully say.
    if (typeof o.cls === "number" && Number.isFinite(o.cls) && o.cls >= 0) {
        out.cls = Math.min(Math.round(o.cls * 1000) / 1000, 1000);
    }
    if (typeof o.longTasks === "object" && o.longTasks !== null) {
        const lt = o.longTasks;
        const count = whole(lt.count, 100_000);
        const totalMs = whole(lt.totalMs, MAX_PERF_MS);
        if (count !== null || totalMs !== null) {
            out.longTasks = { count: count ?? 0, totalMs: totalMs ?? 0 };
        }
    }
    if (typeof o.memory === "object" && o.memory !== null) {
        const mem = o.memory;
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
export function normaliseStorage(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        return null;
    const o = raw;
    const out = {};
    const keyList = (value) => {
        if (!Array.isArray(value))
            return [];
        const list = [];
        for (const item of value) {
            if (list.length >= MAX_STORAGE_KEYS)
                break;
            if (typeof item !== "object" || item === null)
                continue;
            const entry = item;
            if (typeof entry.key !== "string")
                continue;
            const length = typeof entry.length === "number" && Number.isFinite(entry.length) && entry.length > 0
                ? Math.min(Math.round(entry.length), 100_000_000)
                : 0;
            list.push({ key: stripNullBytes(entry.key).slice(0, MAX_STORAGE_KEY_LENGTH), length });
        }
        return list;
    };
    const local = keyList(o.local);
    if (local.length > 0)
        out.local = local;
    const session = keyList(o.session);
    if (session.length > 0)
        out.session = session;
    if (Array.isArray(o.cookies)) {
        const cookies = [];
        for (const name of o.cookies) {
            if (cookies.length >= MAX_COOKIE_NAMES)
                break;
            if (typeof name !== "string")
                continue;
            cookies.push(stripNullBytes(name).slice(0, MAX_STORAGE_KEY_LENGTH));
        }
        if (cookies.length > 0)
            out.cookies = cookies;
    }
    if (typeof o.values === "object" && o.values !== null && !Array.isArray(o.values)) {
        const values = {};
        for (const [key, value] of Object.entries(o.values)) {
            if (Object.keys(values).length >= MAX_STORAGE_VALUES)
                break;
            if (typeof value !== "string")
                continue;
            values[stripNullBytes(key).slice(0, MAX_STORAGE_KEY_LENGTH)] = stripNullBytes(value).slice(0, MAX_STORAGE_VALUE_LENGTH);
        }
        if (Object.keys(values).length > 0)
            out.values = values;
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
 * How deep the null-byte walk follows one replay event. rrweb nests a DOM
 * snapshot a few dozen levels at most; a body nested deeper than this was
 * written to reach the recursion rather than to play back, and following it
 * costs one stack frame per level.
 */
const MAX_REPLAY_DEPTH = 200;
/** Thrown by the walk and caught one frame later. Never leaves this module. */
class ReplayTooDeepError extends Error {
}
/**
 * A copy of `value` with every real null byte gone, out of the strings and out
 * of the keys alike. Postgres refuses a text value containing one, and a
 * replay is nested attacker-controlled JSON on its way into a column. What
 * arrives here has already survived `JSON.stringify`, so there is nothing
 * circular to guard against — but surviving `JSON.stringify` is not the same
 * as surviving this walk, which spends more stack per level, so the depth is
 * counted here rather than inferred from the serialisation.
 */
function stripNuls(value, depth) {
    if (depth > MAX_REPLAY_DEPTH)
        throw new ReplayTooDeepError();
    if (typeof value === "string")
        return stripNullBytes(value);
    // An arrow rather than the bare function: `map` passes the index as the
    // second argument, which would arrive here as the depth.
    if (Array.isArray(value))
        return value.map((item) => stripNuls(item, depth + 1));
    if (typeof value === "object" && value !== null) {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            out[stripNullBytes(key)] = stripNuls(item, depth + 1);
        }
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
export function normaliseReplay(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        return null;
    const o = raw;
    if (!Array.isArray(o.events))
        return null;
    const events = [];
    for (const item of o.events) {
        if (events.length >= MAX_REPLAY_EVENTS)
            break;
        if (typeof item !== "object" || item === null || Array.isArray(item))
            continue;
        const event = item;
        if (typeof event.type !== "number" || !Number.isFinite(event.type))
            continue;
        if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp))
            continue;
        events.push(event);
    }
    if (events.length === 0)
        return null;
    let serialised;
    try {
        serialised = JSON.stringify(events);
    }
    catch {
        // Circular, or a BigInt somebody hand-wrote. Either way it cannot be
        // stored and it is certainly not an rrweb recording.
        return null;
    }
    if (utf8Length(serialised) > MAX_REPLAY_BYTES)
        return null;
    // Stripping the escape out of the serialised text also hit an event whose
    // own text was those six characters, because that is what `JSON.stringify`
    // writes for both: the removal left JSON that would not parse and the whole
    // replay was dropped for nothing. So the walk is over the parsed values
    // instead, where a real NUL is one character and the six characters are six.
    // The serialised form still decides whether the walk is worth doing at all.
    let clean = events;
    if (serialised.includes(NUL_ESCAPE)) {
        try {
            clean = stripNuls(events, 0);
        }
        catch {
            // Nested deeper than the walk follows. A replay whose null bytes cannot
            // be taken out is not a replay that can be stored, so it goes the way an
            // oversized one goes: dropped whole, and the report keeps everything else.
            return null;
        }
    }
    const first = clean[0]?.timestamp ?? 0;
    const last = clean[clean.length - 1]?.timestamp ?? first;
    const span = Math.round((last - first) / 1000);
    return { events: clean, seconds: Number.isFinite(span) && span > 0 ? span : 0 };
}
export class InvalidScreenshotError extends Error {
    constructor(message) {
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
export function decodeScreenshotDataUrl(dataUrl, options = {}) {
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
function base64ToBytes(b64) {
    if (typeof atob === "function") {
        let binary;
        try {
            binary = atob(b64);
        }
        catch {
            throw new InvalidScreenshotError("Screenshot is not valid base64");
        }
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++)
            out[i] = binary.charCodeAt(i);
        return out;
    }
    // Node without atob (or a stripped runtime).
    const g = globalThis;
    if (g.Buffer)
        return new Uint8Array(g.Buffer.from(b64, "base64"));
    throw new InvalidScreenshotError("No base64 decoder available in this runtime");
}
//# sourceMappingURL=report-core.js.map