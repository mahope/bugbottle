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
import type { ValidatedReport } from "./handle.ts";
/** How many reports the directory holds before the oldest are deleted. */
export declare const DEFAULT_MAX_REPORTS = 2000;
/** What the list of a directory knows about one report, without reading it. */
export type StoredReport = {
    /** The UUID the report was stored under, and the name of its picture. */
    id: string;
    /** The name of the JSON file, which begins with the arrival time. */
    file: string;
    /** The first line of the message. */
    title: string;
    /** The report type, as a string, because the file is not revalidated. */
    type: string;
    /** The page it came from. */
    url: string;
    /** The ISO timestamp the server accepted it at. */
    receivedAt: string;
    /** Whether a picture was stored beside it. */
    screenshot: boolean;
};
/** One report, read back off the disk. */
export type StoredReportFile = {
    /** The list entry, so a caller that already has one need not look it up. */
    entry: StoredReport;
    /**
     * The JSON that was written. It was a `ValidatedReport` when it was stored;
     * it is whatever is in the file now, which is the same thing unless somebody
     * has been editing the directory by hand.
     */
    report: ValidatedReport;
    /** The picture, when it was asked for and there is one. */
    screenshot?: Uint8Array;
};
export type FileStoreOptions = {
    /** Where the files go. Created on the first write, parents and all. */
    dir: string;
    /**
     * How many reports to keep. The oldest are deleted once the directory is
     * over it. Zero or `Infinity` keeps everything, which is a decision about a
     * disk rather than about a default.
     */
    maxReports?: number;
    /** Whether to write the picture at all. `false` keeps the JSON only. */
    screenshots?: boolean;
};
export type FileStore = {
    /** The directory, as it was given. */
    dir: string;
    /**
     * The `store` function `handleReport` takes. It accepts the decoded bytes
     * `handleReport` hands it, and a PNG data URL for a caller that has one.
     */
    store: (report: ValidatedReport, screenshot?: Uint8Array | string) => Promise<{
        id: string;
    }>;
    /** Every stored report, newest first. */
    list: () => Promise<StoredReport[]>;
    /** One report by id, or null when there is no such thing. */
    read: (id: string, options?: {
        screenshot?: boolean;
    }) => Promise<StoredReportFile | null>;
    /** Deletes a report and its picture. True when there was one. */
    remove: (id: string) => Promise<boolean>;
    /**
     * Walks the directory again and answers with what is there now.
     *
     * Nothing calls it on its own account: the index is kept up to date by every
     * write and delete, and this process is assumed to be the only writer. When
     * it is not — a backup restored underneath it, a volume remounted, a second
     * process with the same directory — this is how to say so. Reports written
     * by something else appear and reports it deleted go, in the array every
     * caller is already holding rather than a new one.
     */
    refresh: () => Promise<StoredReport[]>;
};
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
export declare function fileStore(options: FileStoreOptions): FileStore;
//# sourceMappingURL=file-store.d.ts.map