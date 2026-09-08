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
