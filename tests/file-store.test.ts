/**
 * `fileStore` — the directory of reports the inbox example runs on.
 *
 * Every test works on a real temporary directory, because the properties worth
 * checking are properties of a filesystem: a rename is atomic and a write is
 * not, a name built from a URL can leave the directory it was meant to stay
 * in, and a file half-written by a process that died still parses as nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileStore, type StoredReport } from "../src/server/file-store.ts";
import type { ValidatedReport } from "../src/server/handle.ts";
import { PNG_DATA_URL } from "./report-fixtures.ts";

/** The bytes behind `PNG_DATA_URL`: a real PNG, signature and all. */
const PNG = Buffer.from(PNG_DATA_URL.slice("data:image/png;base64,".length), "base64");

const dirs: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bugbottle-file-store-"));
  dirs.push(dir);
  return dir;
}

test.after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** A report the way `handleReport` hands one over. */
function report(message: string, receivedAt = new Date().toISOString()): ValidatedReport {
  return {
    type: "bug",
    message,
    context: { url: "/orders?page=2", userAgent: "test", viewport: { width: 800, height: 600 } },
    console: [],
    elements: [],
    breadcrumbs: [],
    network: [],
    perf: null,
    storage: null,
    replay: null,
    extra: {},
    receivedAt,
  } as unknown as ValidatedReport;
}

/** Stamps that sort, so "oldest first" means something in a fast test. */
const at = (minute: number) => `2026-09-08T10:${String(minute).padStart(2, "0")}:00.000Z`;

test("a report is written, listed, read back and removed", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });

  const { id } = await store.store(report("The save button does nothing"));
  assert.match(id, /^[0-9a-f-]{36}$/);

  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, id);
  assert.equal(listed[0]?.title, "The save button does nothing");
  assert.equal(listed[0]?.type, "bug");
  assert.equal(listed[0]?.url, "/orders?page=2");
  assert.equal(listed[0]?.screenshot, false);

  const found = await store.read(id);
  assert.equal(found?.report.message, "The save button does nothing");
  assert.equal(found?.entry.id, id);
  assert.equal(found?.screenshot, undefined, "the picture is not read unless it is asked for");

  assert.equal(await store.remove(id), true);
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.read(id), null);
  assert.equal(await store.remove(id), false, "removing it twice is not an error");
  assert.deepEqual(
    (await readdir(dir)).filter((name) => !name.startsWith(".")),
    [],
    "both files went",
  );
});

test("the list is newest first, and it is a copy", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });
  await store.store(report("First", at(1)));
  const second = await store.store(report("Second", at(2)));

  const listed = await store.list();
  assert.deepEqual(
    listed.map((entry) => entry.title),
    ["Second", "First"],
  );

  // A caller that sorted the array it was handed would be sorting the index.
  listed.length = 0;
  assert.equal((await store.list()).length, 2);
  assert.equal(listed.length, 0);
  assert.equal((await store.list())[0]?.id, second.id);
});

test("the index is built lazily from a directory an earlier run wrote", async () => {
  const dir = await scratch();
  const first = fileStore({ dir });
  const { id } = await first.store(report("Written before the restart", at(3)));
  await first.store(report("And this one too", at(4)));

  // A second store over the same directory has never seen a write.
  const second = fileStore({ dir });
  const listed = await second.list();
  assert.deepEqual(
    listed.map((entry) => entry.title),
    ["And this one too", "Written before the restart"],
  );
  assert.equal((await second.read(id))?.report.message, "Written before the restart");
});

test("the picture is written beside the report and read back on request", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });
  const { id } = await store.store(report("With a screenshot"), PNG);

  assert.ok((await readdir(dir)).includes(`${id}.png`));
  assert.equal((await store.list())[0]?.screenshot, true);

  const withPicture = await store.read(id, { screenshot: true });
  assert.deepEqual(Buffer.from(withPicture!.screenshot!), PNG);

  // The data URL is accepted too, for a caller that has not decoded one.
  const second = await store.store(report("From a data URL"), PNG_DATA_URL);
  const decoded = await store.read(second.id, { screenshot: true });
  assert.deepEqual(Buffer.from(decoded!.screenshot!), PNG);

  await store.remove(id);
  assert.ok(!(await readdir(dir)).includes(`${id}.png`), "the picture went with the report");
});

test("`screenshots: false` keeps the JSON and nothing else", async () => {
  const dir = await scratch();
  const store = fileStore({ dir, screenshots: false });
  const { id } = await store.store(report("No pictures here"), PNG);

  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.endsWith(".png")),
    [],
  );
  assert.equal((await store.list())[0]?.screenshot, false);
  assert.equal((await store.read(id, { screenshot: true }))?.screenshot, undefined);
});

test("anything that is not a PNG is refused, and the report is still stored", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });

  // The signature is checked in the bytes, not in what the caller called them.
  const gif = Buffer.from("GIF89a and then some rubbish", "utf8");
  const { id } = await store.store(report("A picture that is not one"), gif);
  assert.equal((await store.list())[0]?.screenshot, false, "no picture was claimed");
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.endsWith(".png")),
    [],
    "and none was written",
  );
  assert.equal((await store.read(id))?.report.message, "A picture that is not one");

  // Too short to hold a signature at all, rather than holding a wrong one.
  await store.store(report("Two bytes"), Buffer.from([0x89, 0x50]));
  // A data URL of something that is not a PNG.
  await store.store(report("A JPEG in disguise"), "data:image/png;base64,/9j/4AAQSkZJRg==");
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.endsWith(".png")),
    [],
  );
  assert.equal((await store.list()).length, 3, "every report was stored regardless");
});

test("the directory is capped at maxReports, oldest deleted first", async () => {
  const dir = await scratch();
  const store = fileStore({ dir, maxReports: 2 });
  const first = await store.store(report("First", at(1)), PNG);
  const second = await store.store(report("Second", at(2)));
  const third = await store.store(report("Third", at(3)));

  assert.deepEqual(
    (await store.list()).map((entry) => entry.title),
    ["Third", "Second"],
  );
  assert.equal(await store.read(first.id), null, "the oldest is gone");
  const names = await readdir(dir);
  assert.equal(names.filter((name) => name.endsWith(".json")).length, 2);
  assert.ok(!names.includes(`${first.id}.png`), "its picture went too");
  assert.ok(names.some((name) => name.endsWith(`-${second.id}.json`)));
  assert.ok(names.some((name) => name.endsWith(`-${third.id}.json`)));
});

test("maxReports of zero keeps everything", async () => {
  const dir = await scratch();
  const store = fileStore({ dir, maxReports: 0 });
  for (let i = 1; i <= 5; i++) await store.store(report(`Report ${i}`, at(i)));
  assert.equal((await store.list()).length, 5);
});

test("an id that is not a UUID never reaches a path", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });
  await store.store(report("Somewhere in the directory"));

  // The secret a traversal would be reaching for, one level up.
  const secret = join(dir, "..", `bugbottle-secret-${Date.now()}.json`);
  await writeFile(secret, JSON.stringify({ message: "not yours" }));
  dirs.push(secret);

  for (const id of [
    "../etc/passwd",
    "..\\..\\windows\\win.ini",
    "a/b",
    "%2e%2e%2fpasswd",
    "../bugbottle-secret",
    "",
    ".",
    "0123456789abcdef0123456789abcdef",
    "0123456789ab-cdef-0123-4567-89abcdef0123-extra",
    "ZZZZZZZZ-0000-0000-0000-000000000000",
  ]) {
    assert.equal(await store.read(id), null, `read refused ${id}`);
    assert.equal(await store.remove(id), false, `remove refused ${id}`);
  }

  // Nothing outside the directory was touched by any of that.
  assert.equal(
    JSON.parse(await readFile(secret, "utf8")).message,
    "not yours",
  );
  await rm(secret, { force: true });
});

test("a crash mid-write leaves debris that is never read as a report", async () => {
  const dir = await scratch();
  await mkdir(dir, { recursive: true });
  const store = fileStore({ dir });
  const good = await store.store(report("A whole report", at(1)));

  // What a process killed halfway through a write leaves behind: a temporary
  // file holding half a report. It is never a `.json`, so no listing sees it.
  const debris = join(dir, `${at(2).replace(/[:.]/g, "-")}-${good.id}.json.abc.tmp`);
  await writeFile(debris, '{"type":"bug","message":"half a rep');
  // And, for good measure, a truncated `.json` written by something that is
  // not this library at all: skipped rather than allowed to empty the list.
  await writeFile(
    join(dir, `${at(3).replace(/[:.]/g, "-")}-11111111-2222-3333-4444-555555555555.json`),
    '{"type":"bug","messag',
  );

  const next = fileStore({ dir });
  const listed = await next.list();
  assert.deepEqual(
    listed.map((entry: StoredReport) => entry.title),
    ["A whole report"],
  );
  assert.equal(await next.read("11111111-2222-3333-4444-555555555555"), null);
  assert.ok((await readdir(dir)).includes(debris.split(/[\\/]/).pop()!), "debris is left alone");
});

test("a report is renamed into place, so it is never on disk half-written", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });

  // A picture big enough that a plain `writeFile` would be several chunks — and
  // still inside `MAX_SCREENSHOT_BYTES`, or it would be dropped rather than
  // written. If the write went straight to the final name, a reader watching
  // the directory would catch it short. With a rename it is absent or whole.
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 - PNG.length, 7)]);
  let watching = true;
  const seen: number[] = [];
  const watch = (async () => {
    while (watching) {
      for (const name of await readdir(dir).catch(() => [])) {
        if (!name.endsWith(".png")) continue;
        seen.push((await stat(join(dir, name)).catch(() => ({ size: -1 }) as never)).size);
      }
    }
  })();

  const { id } = await store.store(report("A large picture"), big);
  watching = false;
  await watch;

  for (const size of seen) {
    assert.ok(
      size === big.length || size === -1,
      `a ${size}-byte picture was visible under its final name`,
    );
  }
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.endsWith(".tmp")),
    [],
    "and no temporary file was left behind",
  );
  assert.equal((await store.read(id, { screenshot: true }))?.screenshot?.length, big.length);
});

test("a report can be stored into a directory that does not exist yet", async () => {
  const dir = join(await scratch(), "deeper", "still");
  const store = fileStore({ dir });
  assert.deepEqual(await store.list(), [], "an absent directory is an empty inbox");
  const { id } = await store.store(report("Written where dir said"));
  assert.ok((await readdir(dir)).some((name) => name.endsWith(`-${id}.json`)));
  assert.equal((await store.list()).length, 1);
});

test("the file name carries the arrival time, so names sort by age", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });
  const { id } = await store.store(report("Named by its time", "2026-09-08T10:11:12.345Z"));
  const names = await readdir(dir);
  assert.ok(
    names.includes(`2026-09-08T10-11-12-345Z-${id}.json`),
    `unexpected names: ${names.join(", ")}`,
  );
});

/* -------------------------------------------------------------------------- */
/* Two writes at once                                                          */
/* -------------------------------------------------------------------------- */

test("two reports stored at once are both listed", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });
  // Both calls find no index and both walk the directory. A walk that finished
  // second used to replace what the first had already remembered, so one of
  // the two reports was on disk and in no listing until the process restarted.
  const stored = await Promise.all([store.store(report("First")), store.store(report("Second"))]);
  const listed = await store.list();
  assert.equal(listed.length, 2, `only ${listed.map((entry) => entry.title).join(", ")}`);
  for (const { id } of stored) assert.ok(await store.read(id), `${id} is not readable`);
});

test("a report stored while the cap is deleting another is still listed", async () => {
  const dir = await scratch();
  const store = fileStore({ dir, maxReports: 2 });
  await store.store(report("Oldest", "2026-09-08T10:00:00.000Z"));
  // The eviction the second write triggers must not throw away what the third
  // write is in the middle of remembering.
  await Promise.all([
    store.store(report("Middle", "2026-09-08T11:00:00.000Z")),
    store.store(report("Newest", "2026-09-08T12:00:00.000Z")),
  ]);
  const listed = await store.list();
  assert.equal(listed.length, 2);
  assert.deepEqual(
    listed.map((entry) => entry.title).sort(),
    ["Middle", "Newest"],
    "the cap kept the newest two",
  );
});

test("a report deleted from outside is dropped from the listing when it is read", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });
  const { id } = await store.store(report("Deleted by hand", "2026-09-08T10:00:00.000Z"));
  await store.store(report("Still here", "2026-09-08T11:00:00.000Z"));
  const entry = (await store.list()).find((other) => other.id === id);
  assert.ok(entry, "it was listed to begin with");

  // Somebody's `rm`, a backup restore, a volume remounted: this process is
  // assumed to be the only writer and sometimes it is not.
  await rm(join(dir, entry.file));

  assert.equal(await store.read(id), null, "there is nothing to read");
  assert.equal(
    (await store.list()).some((other) => other.id === id),
    false,
    "and the entry that read found nothing behind is gone from the listing",
  );
  assert.deepEqual(
    (await store.list()).map((other) => other.title),
    ["Still here"],
    "the rest of the index is untouched",
  );
});

test("refresh walks the directory again and picks up what changed underneath", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });
  await store.store(report("From this process", "2026-09-08T10:00:00.000Z"));
  assert.equal((await store.list()).length, 1);

  // A second process wrote one report and deleted the other. Neither is
  // something the index could know about.
  const outsider = {
    type: "bug",
    message: "From somewhere else",
    receivedAt: "2026-09-08T12:00:00.000Z",
  };
  await writeFile(
    join(dir, "2026-09-08T12-00-00-000Z-3f1b8c2e-0a4d-4c9e-9b1a-2f6d5e4c3b2a.json"),
    JSON.stringify(outsider),
  );
  assert.equal((await store.list()).length, 1, "the index knows nothing about it yet");

  const listed = await store.refresh();
  assert.deepEqual(
    listed.map((entry) => entry.title).sort(),
    ["From somewhere else", "From this process"],
  );
  assert.deepEqual(
    (await store.list()).map((entry) => entry.title).sort(),
    ["From somewhere else", "From this process"],
    "and the walk it did is the index from now on",
  );
});

test("an arrival time cannot walk out of the directory it names a file in", async () => {
  const dir = await scratch();
  const store = fileStore({ dir });
  // `handleReport` sets `receivedAt` itself, but `store` is a function anybody
  // can call, and it is half of a file name.
  const { id } = await store.store(report("Escaping", "../../2026-09-08T10:00:00.000Z"));
  const names = await readdir(dir);
  assert.ok(
    names.some((name) => name.endsWith(`-${id}.json`)),
    `the report was written outside the directory: ${names.join(", ")}`,
  );
  assert.equal((await store.list()).length, 1);
});

/** An arrival time this many days ago, as a report carries it. */
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

test("prune deletes what is older than maxAgeDays and keeps what is not", async () => {
  const dir = await scratch();
  const store = fileStore({ dir, maxAgeDays: 7 });
  const old = await store.store(report("Eight days old", daysAgo(8)));
  // Either side of the boundary. The one stamped exactly seven days ago is a
  // few milliseconds over seven days by the time `prune` reads the clock,
  // which is the sense in which the limit is "older than".
  const boundary = await store.store(report("Seven days old", daysAgo(7)));
  const fresh = await store.store(report("An hour old", daysAgo(1 / 24)));

  assert.equal(await store.prune(), 2);
  assert.deepEqual(
    (await store.list()).map((entry) => entry.title),
    ["An hour old"],
  );
  assert.equal(await store.read(old.id), null);
  assert.equal(await store.read(boundary.id), null);
  assert.ok(await store.read(fresh.id));
  assert.equal(
    (await readdir(dir)).filter((name) => name.endsWith(".json")).length,
    1,
    "the files went with the entries",
  );
  assert.equal(await store.prune(), 0, "a second run finds nothing left to do");
});

test("prune deletes the picture with the report it ages out", async () => {
  const dir = await scratch();
  const store = fileStore({ dir, maxAgeDays: 1 });
  const { id } = await store.store(report("With a picture", daysAgo(3)), PNG);
  assert.ok((await readdir(dir)).includes(`${id}.png`));

  assert.equal(await store.prune(), 1);
  assert.equal((await readdir(dir)).includes(`${id}.png`), false, "the picture went too");
});

test("without maxAgeDays prune deletes nothing the cap would not", async () => {
  const dir = await scratch();
  const store = fileStore({ dir, maxReports: 0 });
  await store.store(report("Ancient", "2019-01-01T00:00:00.000Z"));
  assert.equal(await store.prune(), 0, "age is off, and so is the cap");
  assert.equal((await store.list()).length, 1);
});

test("prune applies the age limit and the cap together", async () => {
  const dir = await scratch();
  // Four reports: one well over the age limit, three inside it, and one more
  // than a cap of two allows. Both rules have to run for the right two to be
  // the ones left.
  const store = fileStore({ dir, maxReports: 2, maxAgeDays: 10 });
  await store.store(report("Ancient", daysAgo(40)));
  await store.store(report("Oldest inside the window", daysAgo(9)));
  await store.store(report("Middle", daysAgo(2)));
  await store.store(report("Newest", daysAgo(1)));
  // The cap runs on every write too, so by now it has already taken the two
  // oldest; what is asked of `prune` here is that it leaves the rest alone.
  assert.equal(await store.prune(), 0);
  assert.deepEqual(
    (await store.list()).map((entry) => entry.title),
    ["Newest", "Middle"],
    "the newest two, and neither of them over the age limit",
  );

  // Now the other order: a directory whose newest report is also too old.
  const second = await scratch();
  const aged = fileStore({ dir: second, maxReports: 2, maxAgeDays: 10 });
  await aged.store(report("Old one", daysAgo(30)));
  await aged.store(report("Old two", daysAgo(20)));
  await aged.store(report("Old three", daysAgo(15)));
  assert.equal(await aged.prune(), 2, "the cap took one on the way in, age takes both that are left");
  assert.deepEqual(await aged.list(), []);
});

test("prune deletes an old report an earlier run left behind", async () => {
  const dir = await scratch();
  // Nothing has been stored in this process, so there is no index yet: a
  // prune at start has to walk the directory before it can delete anything.
  await mkdir(dir, { recursive: true });
  const id = "3f1b8c2e-0a4d-4c9e-9b1a-2f6d5e4c3b2a";
  await writeFile(
    join(dir, `2019-01-01T00-00-00-000Z-${id}.json`),
    JSON.stringify({
      type: "bug",
      message: "From last year",
      receivedAt: "2019-01-01T00:00:00.000Z",
    }),
  );

  const store = fileStore({ dir, maxAgeDays: 30 });
  assert.equal(await store.prune(), 1);
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await readdir(dir), []);
});

test("prune never touches a file this store did not name", async () => {
  const dir = await scratch();
  const store = fileStore({ dir, maxAgeDays: 1 });
  await store.store(report("Mine, and old", daysAgo(5)));

  // Everything else somebody might keep in the same directory: a note, an
  // export, a picture with no report beside it, half a file from a crash, and
  // a report whose name carries no id at all.
  const foreign: Record<string, string> = {
    "notes.txt": "the volume is shared with the backup script",
    "export-2026-09.json": JSON.stringify({ type: "bug", message: "Exported by hand" }),
    "0f0f0f0f-0a4d-4c9e-9b1a-2f6d5e4c3b2a.png": "not a picture of ours",
    "2019-01-01T00-00-00-000Z-9c8b7a6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d.json.tmp": "half a report",
  };
  for (const [name, body] of Object.entries(foreign)) await writeFile(join(dir, name), body);

  assert.equal(await store.prune(), 1, "its own report, and only that");
  assert.deepEqual(
    (await readdir(dir)).sort(),
    Object.keys(foreign).sort(),
    "every foreign file is still there",
  );
});

test("a report stored while prune is deleting another is still listed", async () => {
  const dir = await scratch();
  const store = fileStore({ dir, maxAgeDays: 1 });
  await store.store(report("Old enough to go", daysAgo(4)));
  // The deletion and the write are interleaved on purpose: `prune` splices the
  // one index a `store` is holding across its own awaits, so neither may lose
  // what the other is in the middle of.
  const [deleted, stored] = await Promise.all([
    store.prune(),
    store.store(report("Arriving while it runs", daysAgo(0))),
  ]);
  assert.equal(deleted, 1);
  assert.deepEqual(
    (await store.list()).map((entry) => entry.title),
    ["Arriving while it runs"],
  );
  assert.ok(await store.read(stored.id), "the report stored during the prune is readable");
});
