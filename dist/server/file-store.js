/**
 * A directory of reports: the storage most small deployments want before they
 * want a database.
 *
 * One JSON file per report with the decoded picture beside it, an in-memory
 * index of the few strings a list shows, and a ceiling on how many reports the
 * directory holds. It is the `store` function `handleReport` takes, plus the
 * three calls whoever builds a page over it needs: `list`, `read`, `remove`.
 *
 * This is the one module under `src/server/` that reaches for Node — `node:fs`,
 * `node:path`, `node:crypto`. It is re-exported from `bugbottle/server` like
 * everything else there, and nothing the validators reach imports it, so a
 * bundle that only wanted `normaliseConsole` still carries no filesystem: CI
 * greps the minified text for `node:fs` and `readFile` and fails if either
 * arrives.
 *
 * ```ts
 * import { fileStore, handleReport } from "bugbottle/server";
 *
 * const reports = fileStore({ dir: "./reports", maxReports: 2000 });
 *
 * export const POST = (req: Request) => handleReport(req, { store: reports.store });
 * ```
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { decodeScreenshotDataUrl, InvalidScreenshotError, MAX_SCREENSHOT_BYTES, } from "../report-core.js";
/** How many reports the directory holds before the oldest are deleted. */
export const DEFAULT_MAX_REPORTS = 2000;
/**
 * The shape `crypto.randomUUID()` writes, and the only thing that is ever
 * allowed to become part of a path.
 *
 * An id arrives from a URL — `/r/<id>` — which makes it attacker-controlled
 * text on its way to `join()`. Matching the shape before a path is built is
 * what stops `../../etc/passwd` and `a/b` from ever being one; there is no
 * normalising afterwards to get wrong, because nothing else is accepted.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The same shape at the end of a file name, which is where the id is kept. */
const UUID_IN_NAME = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;
/** The eight bytes every PNG begins with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/**
 * A directory of reports, with an index built on the first call that needs it.
 *
 * Reading and parsing every file on every request is fine for the first
 * hundred reports and quietly quadratic after that, so the directory is walked
 * once and the few strings a list shows are kept. After that a write appends
 * and a delete removes; nothing re-reads the directory, because this process is
 * assumed to be the only thing that writes to it. Two processes over one
 * directory is a database, and this is not one.
 */
export function fileStore(options) {
    const dir = options.dir;
    const maxReports = options.maxReports ?? DEFAULT_MAX_REPORTS;
    const screenshots = options.screenshots ?? true;
    /**
     * `null` until the first walk. It is not a cache to be invalidated: dropping
     * an entry that is still on disk would hide a report, so every path that
     * touches the directory touches this in the same breath.
     */
    let index = null;
    /**
     * The walk in flight, so two calls that both find no index share one.
     *
     * Without it the second walk finishes last and its array becomes the index,
     * throwing away whatever the first one had already been handed and added to
     * — a report on disk that no listing mentions until the process restarts.
     * Once there is an index it is never replaced, only added to and taken from,
     * which is what lets a caller hold on to it across an `await`.
     */
    let walking = null;
    function ensureIndex() {
        if (index)
            return Promise.resolve(index);
        walking ??= walk().finally(() => void (walking = null));
        return walking;
    }
    async function walk() {
        index = await readDirectory();
        return index;
    }
    /** One pass over the directory, answering with entries and touching nothing. */
    async function readDirectory() {
        let files = [];
        try {
            files = await readdir(dir);
        }
        catch {
            // No directory yet is an empty inbox, not an error.
            return [];
        }
        const pictures = new Set(files.filter((name) => name.endsWith(".png")));
        const entries = [];
        // The name begins with the arrival time, so sorting the names sorts by age.
        for (const file of files.filter((name) => name.endsWith(".json")).sort().reverse()) {
            const id = UUID_IN_NAME.exec(file)?.[1];
            if (!id)
                continue;
            try {
                const report = JSON.parse(await readFile(join(dir, file), "utf8"));
                entries.push(summarise(id, file, report, pictures.has(`${id}.png`)));
            }
            catch {
                // A file something else half-wrote is skipped rather than allowed to
                // empty the list. Our own writes cannot land here: see `writeAtomic`.
            }
        }
        return entries;
    }
    /**
     * Deletes the oldest reports until the directory is back inside the ceiling.
     *
     * An inbox with no ceiling is a disk that fills: each report may carry four
     * megabytes of picture, so a fortnight of somebody's script is a full volume
     * and an endpoint that has stopped accepting anything. Oldest first, because
     * the newest report is the one somebody is about to read.
     */
    async function prune() {
        if (!index || !Number.isFinite(maxReports) || maxReports <= 0)
            return;
        while (index.length > maxReports) {
            const oldest = index[index.length - 1];
            if (!oldest)
                break;
            await forget(oldest);
        }
    }
    /**
     * Forgets one entry and deletes both of its files.
     *
     * The entry is spliced out rather than filtered into a new array: a `store`
     * that is between its write and the line that remembers it is holding this
     * array, and replacing it would leave that report remembered nowhere.
     */
    /**
     * Takes one entry out of the index, in place.
     *
     * Spliced rather than filtered into a new array, for the same reason
     * `forget` does it: a `store` between its write and the line that remembers
     * it is holding this array, and replacing it would leave that report
     * remembered nowhere.
     */
    function drop(id) {
        const at = index?.findIndex((other) => other.id === id) ?? -1;
        if (index && at !== -1)
            index.splice(at, 1);
    }
    async function forget(entry) {
        drop(entry.id);
        await rm(join(dir, entry.file), { force: true });
        await rm(join(dir, `${entry.id}.png`), { force: true });
    }
    const store = async (report, screenshot) => {
        const id = randomUUID();
        // Before the write, not after: the first report of a run is what triggers
        // the one walk of the directory, and a walk that ran afterwards would find
        // this report on disk and then be handed it a second time below.
        const entries = await ensureIndex();
        await mkdir(dir, { recursive: true });
        const receivedAt = String(report?.receivedAt ?? new Date().toISOString());
        const file = `${nameSafe(receivedAt)}-${id}.json`;
        const picture = screenshots ? pngBytes(screenshot) : undefined;
        await writeAtomic(join(dir, file), JSON.stringify(report, null, 2));
        if (picture)
            await writeAtomic(join(dir, `${id}.png`), picture);
        // `index` rather than the `entries` this call was handed: the two are the
        // same array unless the walk was replaced under us, and the index is the
        // one a listing reads.
        (index ?? entries).unshift(summarise(id, file, report, Boolean(picture)));
        await prune();
        return { id };
    };
    return {
        dir,
        store,
        async list() {
            // A copy: the index is how the directory is remembered, and a caller
            // that sorted or spliced the array it was handed would be editing it.
            return [...(await ensureIndex())];
        },
        async read(id, readOptions = {}) {
            if (!UUID.test(id))
                return null;
            const entry = (await ensureIndex()).find((other) => other.id === id);
            if (!entry)
                return null;
            let report;
            try {
                report = JSON.parse(await readFile(join(dir, entry.file), "utf8"));
            }
            catch {
                // The index says this report is here and the disk says it is not:
                // something outside this process deleted it, or the file was replaced
                // with something that no longer parses. Either way the listing is now
                // lying, and a link to a report that answers 404 for the rest of the
                // run is worse than a listing one entry shorter. The picture, if there
                // was one, is left where it is: a read does not delete files.
                drop(id);
                return null;
            }
            const found = { entry, report };
            if (readOptions.screenshot && entry.screenshot) {
                try {
                    found.screenshot = await readFile(join(dir, `${entry.id}.png`));
                }
                catch {
                    // The JSON is the report. A missing picture is not a missing report.
                }
            }
            return found;
        },
        async refresh() {
            const fresh = await readDirectory();
            // In place: the array is the index, and a `store` holding it across an
            // `await` must still be holding the live one when this returns.
            if (index)
                index.splice(0, index.length, ...fresh);
            else
                index = fresh;
            return [...index];
        },
        async remove(id) {
            if (!UUID.test(id))
                return false;
            const entry = (await ensureIndex()).find((other) => other.id === id);
            if (!entry)
                return false;
            await forget(entry);
            return true;
        },
    };
}
/**
 * The arrival time as the front half of a file name.
 *
 * `handleReport` writes `receivedAt` itself, so in the ordinary path this is an
 * ISO timestamp and the colons and dots are all that need replacing. But
 * `store` is a function anybody can call with a report from anywhere, and half
 * a file name is half a path: `../..` in this field would put the report
 * somewhere the directory does not reach and the listing never looks. Only the
 * characters a timestamp is made of survive, for the same reason the id is
 * matched against the UUID shape before it becomes a path.
 */
function nameSafe(receivedAt) {
    const cleaned = receivedAt.replace(/[^0-9A-Za-z]/g, "-").slice(0, 40);
    return cleaned.replace(/^-+/, "") || "undated";
}
/** The strings a list shows, taken from a report once and then kept. */
function summarise(id, file, report, screenshot) {
    return {
        id,
        file,
        title: String(report?.message ?? "").split(/\r?\n/)[0] ?? "",
        type: String(report?.type ?? ""),
        url: String(report?.context?.url ?? ""),
        receivedAt: String(report?.receivedAt ?? ""),
        screenshot,
    };
}
/**
 * Writes through a temporary name and renames it into place.
 *
 * `rename` within one directory is atomic on every filesystem this runs on, so
 * a reader either sees the whole file or does not see it at all. A plain
 * `writeFile` is not: a process killed halfway through four megabytes leaves a
 * truncated `.json` that parses as nothing and a truncated `.png` that renders
 * as half a screenshot, and both of them look like reports. What a crash can
 * leave behind here is a `.tmp` file, which no listing looks at.
 */
async function writeAtomic(path, data) {
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(tmp, data);
        await rename(tmp, path);
    }
    catch (error) {
        await rm(tmp, { force: true }).catch(() => { });
        throw error;
    }
}
/**
 * The picture to write, or nothing.
 *
 * `handleReport` hands over bytes it has already decoded and signature-checked,
 * but `store` is a function anybody can call, so the check is made here as
 * well rather than assumed: what gets written under a `.png` name is a PNG. A
 * picture that fails it is dropped and the report is stored without it —
 * screenshots fail open throughout this library, because the message is the
 * valuable part and the reporter is not the one who broke the encoding.
 */
function pngBytes(screenshot) {
    if (!screenshot || screenshot.length === 0)
        return undefined;
    if (typeof screenshot === "string") {
        try {
            return decodeScreenshotDataUrl(screenshot);
        }
        catch (error) {
            if (error instanceof InvalidScreenshotError)
                return undefined;
            throw error;
        }
    }
    if (screenshot.length > MAX_SCREENSHOT_BYTES)
        return undefined;
    if (screenshot.length < PNG_SIGNATURE.length)
        return undefined;
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (screenshot[i] !== PNG_SIGNATURE[i])
            return undefined;
    }
    return screenshot;
}
//# sourceMappingURL=file-store.js.map