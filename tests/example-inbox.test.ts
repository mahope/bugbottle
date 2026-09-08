/**
 * The inbox example, driven the way somebody would drive it: a real process,
 * a real port, a real directory on disk.
 *
 * It is spawned rather than imported on purpose. The refusal to start without
 * `INBOX_PASSWORD` is a property of the program, not of a function, and the
 * only honest way to check it is to run the program and read its exit code.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import type { Readable } from "node:stream";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { reportBody, PNG_DATA_URL } from "./report-fixtures.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "examples", "inbox", "server.mjs");

const PASSWORD = "correct horse battery staple";
const auth = `Basic ${Buffer.from(`inbox:${PASSWORD}`).toString("base64")}`;

/** The inbox, running: stdin is closed, stdout and stderr are pipes. */
type Inbox = ChildProcessByStdio<null, Readable, Readable>;

type Started = { child: Inbox; origin: string; reports: string };

/** Starts the example on a port the operating system picks, in a temp dir. */
async function start(
  extra: Record<string, string> = {},
  reportsDir?: string,
): Promise<Started> {
  const reports = reportsDir ?? (await mkdtemp(join(tmpdir(), "bugbottle-inbox-")));
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, INBOX_PASSWORD: PASSWORD, PORT: "0", REPORTS_DIR: reports, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const origin = await new Promise<string>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`No address in: ${out}`)), 15_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      const found = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (found) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${found[1]}`);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The inbox exited with ${code}: ${out}`));
    });
  });

  return { child, origin, reports };
}

async function stop({ child, reports }: Started, keepDirectory = false): Promise<void> {
  const ended = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await ended;
  if (!keepDirectory) await rm(reports, { recursive: true, force: true });
}

/** Posts one report and answers with the id the inbox stored it under. */
async function post(origin: string, message: string): Promise<string> {
  const response = await fetch(`${origin}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "bug", message }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { id: string }).id;
}

test("a report is posted, listed, read and deleted", async () => {
  const running = await start();
  try {
    const posted = await fetch(`${running.origin}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...reportBody, screenshotDataUrl: PNG_DATA_URL }),
    });
    assert.equal(posted.status, 201);
    const { id } = (await posted.json()) as { id: string };
    assert.match(id, /^[0-9a-f-]{36}$/);

    // Both halves are on disk, and the JSON no longer carries the picture.
    const files = await readdir(running.reports);
    assert.equal(files.filter((f) => f.endsWith(".json")).length, 1);
    assert.ok(files.includes(`${id}.png`));
    const stored = await fetch(`${running.origin}/r/${id}.json`, {
      headers: { Authorization: auth },
    });
    const json = (await stored.json()) as Record<string, unknown>;
    assert.equal(json.message, reportBody.message);
    assert.equal(json.screenshotDataUrl, undefined);

    const list = await fetch(`${running.origin}/`, { headers: { Authorization: auth } });
    assert.equal(list.status, 200);
    const listHtml = await list.text();
    assert.ok(listHtml.includes(id), "the list links the report");
    assert.ok(listHtml.includes("The save button does nothing"));

    const detail = await fetch(`${running.origin}/r/${id}`, { headers: { Authorization: auth } });
    assert.equal(detail.status, 200);
    const detailHtml = await detail.text();
    assert.ok(detailHtml.includes("<h2>Bug: The save button does nothing</h2>"));
    assert.ok(detailHtml.includes(`/r/${id}.png`), "the picture is on the page");

    const picture = await fetch(`${running.origin}/r/${id}.png`, {
      headers: { Authorization: auth },
    });
    assert.equal(picture.status, 200);
    assert.equal(picture.headers.get("content-type"), "image/png");

    const deleted = await fetch(`${running.origin}/r/${id}/delete`, {
      method: "POST",
      headers: { Authorization: auth },
      redirect: "manual",
    });
    assert.equal(deleted.status, 303);
    assert.deepEqual(await readdir(running.reports), []);
    const gone = await fetch(`${running.origin}/r/${id}`, { headers: { Authorization: auth } });
    assert.equal(gone.status, 404);
  } finally {
    await stop(running);
  }
});

test("a delete from another site is refused, password or no password", async () => {
  // Basic auth is attached by the browser to a cross-site form POST as well as
  // to a same-site one: `SameSite` governs cookies and has nothing to say about
  // an `Authorization` header the browser is caching. Without an origin check
  // any page the operator visits can delete a report whose id it knows — and a
  // reporter learns an id simply by sending one, because the endpoint answers
  // with it.
  const running = await start();
  try {
    const posted = await fetch(`${running.origin}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "bug", message: "The save button does nothing" }),
    });
    const { id } = (await posted.json()) as { id: string };

    const fromElsewhere: Record<string, string>[] = [
      { Origin: "https://evil.example" },
      { "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of fromElsewhere) {
      const attempt = await fetch(`${running.origin}/r/${id}/delete`, {
        method: "POST",
        headers: { Authorization: auth, ...headers },
        redirect: "manual",
      });
      assert.equal(attempt.status, 403, `${JSON.stringify(headers)} is refused`);
    }
    const still = await fetch(`${running.origin}/r/${id}`, { headers: { Authorization: auth } });
    assert.equal(still.status, 200, "the report is still there");

    // The inbox's own form still works: its Origin is this server.
    const own = await fetch(`${running.origin}/r/${id}/delete`, {
      method: "POST",
      headers: { Authorization: auth, Origin: running.origin, "Sec-Fetch-Site": "same-origin" },
      redirect: "manual",
    });
    assert.equal(own.status, 303);
  } finally {
    await stop(running);
  }
});

test("nothing is readable without the password", async () => {
  const running = await start();
  try {
    for (const path of ["/", "/r/anything", "/r/anything.json"]) {
      const res = await fetch(`${running.origin}${path}`);
      assert.equal(res.status, 401, `${path} answered ${res.status}`);
      assert.match(res.headers.get("www-authenticate") ?? "", /^Basic /);
    }
    const wrong = await fetch(`${running.origin}/`, {
      headers: { Authorization: `Basic ${Buffer.from("inbox:wrong").toString("base64")}` },
    });
    assert.equal(wrong.status, 401);

    // Posting is the reporter's half and never carries the inbox password.
    const posted = await fetch(`${running.origin}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportBody),
    });
    assert.equal(posted.status, 201);
  } finally {
    await stop(running);
  }
});

test("the report text is escaped rather than injected", async () => {
  const running = await start();
  try {
    const message = "<img src=x onerror=alert(1)> & \"quoted\"";
    const posted = await fetch(`${running.origin}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...reportBody, message }),
    });
    const { id } = (await posted.json()) as { id: string };

    for (const path of ["/", `/r/${id}`]) {
      const html = await (
        await fetch(`${running.origin}${path}`, { headers: { Authorization: auth } })
      ).text();
      assert.ok(!html.includes("<img src=x"), `${path} injected the report`);
      assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), `${path} lost the text`);
    }
  } finally {
    await stop(running);
  }
});

test("the directory is capped at MAX_REPORTS, oldest deleted first", async () => {
  // Without a ceiling the disk is the ceiling: thirty reports a minute are
  // allowed and each may carry four megabytes of picture, so an inbox left
  // running is a full volume and an endpoint that has stopped accepting
  // anything. Three reports into a cap of two: the first one goes.
  const running = await start({ MAX_REPORTS: "2" });
  try {
    const first = await post(running.origin, "The first report");
    const second = await post(running.origin, "The second report");
    const third = await post(running.origin, "The third report");

    const files = await readdir(running.reports);
    assert.equal(files.filter((f) => f.endsWith(".json")).length, 2);

    const gone = await fetch(`${running.origin}/r/${first}`, { headers: { Authorization: auth } });
    assert.equal(gone.status, 404, "the oldest report was deleted");

    const html = await (
      await fetch(`${running.origin}/`, { headers: { Authorization: auth } })
    ).text();
    assert.ok(html.includes("Inbox (2)"));
    assert.ok(!html.includes(first), "the oldest is off the list too");
    assert.ok(html.includes(second) && html.includes(third));
  } finally {
    await stop(running);
  }
});

test("the picture goes with the report the cap deletes", async () => {
  const running = await start({ MAX_REPORTS: "1" });
  try {
    const posted = await fetch(`${running.origin}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...reportBody, screenshotDataUrl: PNG_DATA_URL }),
    });
    const { id } = (await posted.json()) as { id: string };
    assert.ok((await readdir(running.reports)).includes(`${id}.png`));

    await post(running.origin, "The report that pushes the first one out");
    assert.ok(!(await readdir(running.reports)).includes(`${id}.png`), "the picture went too");
  } finally {
    await stop(running);
  }
});

test("reports written by an earlier run are listed by the next one", async () => {
  // The list is held in memory, so the one thing that could go wrong is a
  // process that only ever knows about what it wrote itself.
  const first = await start();
  let id = "";
  try {
    id = await post(first.origin, "Written before the restart");
  } finally {
    await stop(first, true);
  }

  const second = await start({}, first.reports);
  try {
    const html = await (
      await fetch(`${second.origin}/`, { headers: { Authorization: auth } })
    ).text();
    assert.ok(html.includes(id), "the list was built from the directory");
    assert.ok(html.includes("Written before the restart"));

    const detail = await fetch(`${second.origin}/r/${id}`, { headers: { Authorization: auth } });
    assert.equal(detail.status, 200);
  } finally {
    await stop(second);
  }
});

test("the inbox refuses to start without a password", async () => {
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, INBOX_PASSWORD: "", PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(code, 1);
  assert.match(stderr, /INBOX_PASSWORD/);
});

test("the health route answers without a password", async () => {
  // A platform's health check runs before anybody has a credential, and a
  // check that needed one would report a healthy inbox as down for ever.
  const running = await start();
  try {
    const response = await fetch(`${running.origin}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.text()).trim(), "ok");
    assert.match(response.headers.get("content-type") ?? "", /text\/plain/);

    // It is the only thing it says. Everything else still wants the password.
    const list = await fetch(`${running.origin}/`);
    assert.equal(list.status, 401);
  } finally {
    await stop(running);
  }
});

test("REPORTS_DIR is where the reports go, even when it does not exist yet", async () => {
  // The container names the mount point here, and on a fresh host the
  // directory arrives empty or not at all.
  const parent = await mkdtemp(join(tmpdir(), "bugbottle-inbox-"));
  const reports = join(parent, "deeper", "still");
  const running = await start({}, reports);
  try {
    const id = await post(running.origin, "Written where REPORTS_DIR said");
    const written = await readdir(reports);
    assert.ok(
      written.some((file) => file.endsWith(`-${id}.json`)),
      `the report is in REPORTS_DIR: ${written.join(", ")}`,
    );

    // And nothing was written beside the example instead.
    const beside = await readdir(join(root, "examples", "inbox"));
    assert.ok(!beside.includes("reports"), "the default directory was not used");
  } finally {
    await stop(running);
    await rm(parent, { recursive: true, force: true });
  }
});

/**
 * A small strict XML parser, so "well-formed Atom" is checked rather than
 * asserted with a substring.
 *
 * Node has no XML parser and this repository has no test dependencies, so this
 * is the sanity check the feed needs: tags must nest and close in order, an
 * attribute must be quoted, and every `&` in the document must begin a legal
 * entity. That last rule is the one that catches an unescaped report — a
 * message containing `&` or `<` makes the parse throw rather than quietly
 * produce a feed no reader can open.
 */
type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(raw: string): string {
  // A bare `&` is not text in XML; it is the start of an entity or an error.
  const stray = /&(?![a-zA-Z]+;|#[0-9]+;|#x[0-9a-fA-F]+;)/.exec(raw);
  if (stray) {
    throw new Error(`Unescaped & at ${stray.index} in ${JSON.stringify(raw.slice(0, 60))}`);
  }
  if (raw.includes("<")) throw new Error("Unescaped < in text");
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
    const named = ENTITIES[body];
    if (named === undefined) throw new Error(`Unknown entity ${whole}`);
    return named;
  });
}

function parseXml(source: string): XmlNode {
  let i = 0;
  let root: XmlNode | null = null;
  const stack: XmlNode[] = [];
  const isSpace = (ch: string) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

  const addText = (raw: string) => {
    const decoded = decodeXml(raw);
    const top = stack[stack.length - 1];
    if (top) top.text += decoded;
    else if (decoded.trim() !== "") throw new Error(`Text outside the root: ${decoded.trim()}`);
  };

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      addText(source.slice(i));
      break;
    }
    addText(source.slice(i, lt));

    if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt);
      if (end === -1) throw new Error("Unterminated processing instruction");
      i = end + 2;
      continue;
    }
    if (source.startsWith("<!", lt)) throw new Error("The feed writes no declarations or comments");

    if (source.startsWith("</", lt)) {
      const end = source.indexOf(">", lt);
      if (end === -1) throw new Error("Unterminated closing tag");
      const name = source.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error(`</${name}> closes <${open?.name}>`);
      i = end + 1;
      continue;
    }

    // An opening tag, read character by character, so a `>` inside an
    // attribute value is a failure rather than a lucky escape.
    let j = lt + 1;
    while (j < source.length && !isSpace(source[j]!) && source[j] !== ">" && source[j] !== "/") {
      j += 1;
    }
    const name = source.slice(lt + 1, j);
    if (name === "") throw new Error("A tag with no name");
    const node: XmlNode = { name, attrs: {}, children: [], text: "" };

    for (;;) {
      while (j < source.length && isSpace(source[j]!)) j += 1;
      const ch = source[j];
      if (ch === undefined) throw new Error(`Unterminated <${name}>`);
      if (ch === ">" || (ch === "/" && source[j + 1] === ">")) break;
      let k = j;
      while (k < source.length && !isSpace(source[k]!) && source[k] !== "=") k += 1;
      const attr = source.slice(j, k);
      if (attr === "" || source[k] !== "=") throw new Error(`A bare attribute in <${name}>`);
      const quote = source[k + 1];
      if (quote !== '"' && quote !== "'") throw new Error(`An unquoted attribute in <${name}>`);
      const end = source.indexOf(quote, k + 2);
      if (end === -1) throw new Error(`Unterminated attribute in <${name}>`);
      const value = source.slice(k + 2, end);
      if (value.includes("<")) throw new Error(`Unescaped < in an attribute of <${name}>`);
      node.attrs[attr] = decodeXml(value);
      j = end + 1;
    }

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (root) throw new Error("A second root element");
    else root = node;

    if (source[j] === "/") {
      i = j + 2;
    } else {
      stack.push(node);
      i = j + 1;
    }
  }

  if (stack.length > 0) throw new Error(`Unclosed <${stack[stack.length - 1]!.name}>`);
  if (!root) throw new Error("No root element");
  return root;
}

const child = (node: XmlNode, name: string): XmlNode | undefined =>
  node.children.find((each) => each.name === name);

/** Writes `count` reports straight into a directory, oldest first. */
async function seed(directory: string, count: number): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const messages: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const receivedAt = new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
    const message = `Report number ${n}`;
    messages.push(message);
    const report = {
      type: "bug",
      message,
      context: { url: "/checkout", userAgent: "seed", viewport: { width: 800, height: 600 } },
      console: [],
      receivedAt,
    };
    const stamp = receivedAt.replace(/[:.]/g, "-");
    await writeFile(join(directory, `${stamp}-${randomUUID()}.json`), JSON.stringify(report));
  }
  return messages;
}

test("the feeds are behind the same password as the inbox", async () => {
  // A feed URL is pasted into readers, phones and Slack, and a public one
  // would be the inbox itself — titles, pages, times — at an address with no
  // password on it.
  const running = await start();
  try {
    for (const path of ["/feed.json", "/feed.xml"]) {
      const res = await fetch(`${running.origin}${path}`);
      assert.equal(res.status, 401, `${path} answered ${res.status}`);
      assert.match(res.headers.get("www-authenticate") ?? "", /^Basic /);
    }
  } finally {
    await stop(running);
  }
});

test("the JSON feed is JSON Feed 1.1, newest first", async () => {
  const running = await start();
  try {
    const first = await post(running.origin, "The first report");
    const second = await post(running.origin, "The second report");

    const response = await fetch(`${running.origin}/feed.json`, {
      headers: { Authorization: auth },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/feed\+json/);

    const feed = (await response.json()) as Record<string, unknown>;
    assert.equal(feed.version, "https://jsonfeed.org/version/1.1");
    assert.equal(typeof feed.title, "string");
    assert.equal(feed.feed_url, `${running.origin}/feed.json`);
    assert.equal(feed.home_page_url, `${running.origin}/`);
    assert.ok(Array.isArray(feed.items));

    const items = feed.items as Record<string, unknown>[];
    assert.equal(items.length, 2);
    const [newest, oldest] = items as [Record<string, unknown>, Record<string, unknown>];
    assert.equal(newest.title, "The second report", "the newest report is first");
    assert.equal(oldest.title, "The first report");
    assert.equal(newest.id, `${running.origin}/r/${second}`);
    assert.equal(newest.url, `${running.origin}/r/${second}`);
    assert.equal(oldest.id, `${running.origin}/r/${first}`);
    assert.deepEqual(newest.tags, ["bug"]);
    assert.ok(
      String(newest.content_text).includes("The second report"),
      "the rendered Markdown is the content",
    );
    assert.ok(String(newest.content_text).includes("|"), "the context table came with it");
    assert.ok(!Number.isNaN(Date.parse(String(newest.date_published))));
    assert.equal(newest.date_modified, newest.date_published);

    // The picture is a link rather than bytes: a reader would fetch it
    // without the password anyway, and the feed stays small.
    assert.ok(!String(newest.content_text).includes("data:image"));
  } finally {
    await stop(running);
  }
});

test("the Atom feed is well formed and carries every required element", async () => {
  const running = await start();
  try {
    const id = await post(running.origin, 'Breaks on <b>save</b> & "quoted"');

    const response = await fetch(`${running.origin}/feed.xml`, {
      headers: { Authorization: auth },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/atom\+xml/);
    const xml = await response.text();

    // The report is escaped rather than injected; the parse throws otherwise.
    assert.ok(!xml.includes("<b>save</b>"), "the report's markup reached the feed raw");
    const feed = parseXml(xml);
    assert.equal(feed.name, "feed");
    assert.equal(feed.attrs.xmlns, "http://www.w3.org/2005/Atom");

    for (const required of ["id", "title", "updated"]) {
      const found = child(feed, required);
      assert.ok(found, `the feed has no <${required}>`);
      assert.notEqual(found.text.trim(), "");
    }
    assert.ok(!Number.isNaN(Date.parse(child(feed, "updated")!.text)));
    const self = feed.children.find((each) => each.name === "link" && each.attrs.rel === "self");
    assert.equal(self?.attrs.href, `${running.origin}/feed.xml`);
    assert.ok(child(feed, "author"), "the feed has no <author>");

    const entries = feed.children.filter((each) => each.name === "entry");
    assert.equal(entries.length, 1);
    const entry = entries[0]!;
    for (const required of ["id", "title", "updated"]) {
      const found = child(entry, required);
      assert.ok(found, `the entry has no <${required}>`);
      assert.notEqual(found.text.trim(), "");
    }
    assert.equal(child(entry, "id")!.text, `${running.origin}/r/${id}`);
    assert.equal(child(entry, "title")!.text, 'Breaks on <b>save</b> & "quoted"');
    assert.ok(!Number.isNaN(Date.parse(child(entry, "updated")!.text)));
    const alternate = entry.children.find((each) => each.name === "link");
    assert.equal(alternate?.attrs.href, `${running.origin}/r/${id}`);
    assert.equal(alternate?.attrs.rel, "alternate");
    assert.equal(child(entry, "category")?.attrs.term, "bug");
    const content = child(entry, "content");
    assert.equal(content?.attrs.type, "text");
    assert.ok(content!.text.includes('Breaks on <b>save</b> & "quoted"'), "the Markdown came back");
  } finally {
    await stop(running);
  }
});

test("both feeds stop at the newest fifty reports", async () => {
  // Seeded on disk rather than posted: the endpoint allows thirty reports a
  // minute, and what is under test is the ceiling on the feed, not the rate.
  const reports = await mkdtemp(join(tmpdir(), "bugbottle-inbox-"));
  const messages = await seed(reports, 55);
  const running = await start({}, reports);
  try {
    const feed = (await (
      await fetch(`${running.origin}/feed.json`, { headers: { Authorization: auth } })
    ).json()) as { items: { title: string }[] };
    assert.equal(feed.items.length, 50);
    assert.equal(feed.items[0]!.title, messages[54], "the newest is first");
    assert.equal(feed.items[49]!.title, messages[5], "and the fiftieth is where it stops");

    const atom = parseXml(
      await (await fetch(`${running.origin}/feed.xml`, { headers: { Authorization: auth } })).text(),
    );
    const entries = atom.children.filter((each) => each.name === "entry");
    assert.equal(entries.length, 50);
    assert.equal(child(entries[0]!, "title")!.text, messages[54]);
  } finally {
    await stop(running);
  }
});

/**
 * A webhook that records what it was told, on a port the operating system
 * picks. It answers 200 to everything: what is under test is what the inbox
 * sends, not what a chat service would make of it.
 */
async function fakeWebhook(): Promise<{
  url: string;
  bodies: Record<string, unknown>[];
  close: () => Promise<void>;
}> {
  const bodies: Record<string, unknown>[] = [];
  const hook = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        bodies.push(JSON.parse(text) as Record<string, unknown>);
      } catch {
        bodies.push({ unparsed: text });
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    });
  });
  await new Promise<void>((resolve) => hook.listen(0, "127.0.0.1", () => resolve()));
  const address = hook.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    bodies,
    close: () => new Promise<void>((resolve) => hook.close(() => resolve())),
  };
}

/** Waits for the webhook to have been told `count` times, then insists on it. */
async function toldTimes(bodies: unknown[], count: number): Promise<void> {
  for (let waited = 0; waited < 5000 && bodies.length < count; waited += 25) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(bodies.length, count, `the webhook was told ${bodies.length} times, not ${count}`);
}

test("every stored report is announced to NOTIFY_WEBHOOK, linking the detail page", async () => {
  const hook = await fakeWebhook();
  const running = await start({
    NOTIFY_WEBHOOK: hook.url,
    PUBLIC_URL: "https://bugs.example.test",
  });
  try {
    const first = await post(running.origin, "the save button does nothing");
    const second = await post(running.origin, "and neither does cancel");
    await toldTimes(hook.bodies, 2);

    const sent = hook.bodies.map((body) => JSON.stringify(body));
    assert.ok(
      sent.some((text) => text.includes(`https://bugs.example.test/r/${first}`)),
      "the first report is linked where the inbox keeps it",
    );
    assert.ok(
      sent.some((text) => text.includes(`https://bugs.example.test/r/${second}`)),
      "and so is the second",
    );
    assert.equal(hook.bodies[0]!.message, "the save button does nothing");
    assert.match(String(hook.bodies[0]!.markdown ?? ""), /the save button does nothing/);
  } finally {
    await stop(running);
    await hook.close();
  }
});

test("NOTIFY_KIND says what the webhook is when its host does not", async () => {
  const hook = await fakeWebhook();
  const running = await start({
    NOTIFY_WEBHOOK: hook.url,
    NOTIFY_KIND: "slack",
    PUBLIC_URL: "https://bugs.example.test",
  });
  try {
    const id = await post(running.origin, "the header overlaps the menu");
    await toldTimes(hook.bodies, 1);
    const body = hook.bodies[0]!;
    assert.ok(Array.isArray(body.blocks), "a Slack webhook is told in Block Kit");
    assert.ok(
      JSON.stringify(body).includes(`https://bugs.example.test/r/${id}`),
      "and the button opens the detail page",
    );
  } finally {
    await stop(running);
    await hook.close();
  }
});

test("a webhook that is not there does not cost the reporter their report", async () => {
  // Nothing is listening on port 1, so the sink fails as certainly as a
  // webhook revoked last week does.
  const running = await start({
    NOTIFY_WEBHOOK: "http://127.0.0.1:1/hook",
    PUBLIC_URL: "https://bugs.example.test",
  });
  try {
    const posted = await fetch(`${running.origin}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "bug", message: "the report survives the notification" }),
    });
    assert.equal(posted.status, 201, "the report is stored and the reporter is told so");
    const { id } = (await posted.json()) as { id: string };
    const stored = await fetch(`${running.origin}/r/${id}.json`, {
      headers: { Authorization: auth },
    });
    assert.equal(stored.status, 200, "and it really is on disk");
  } finally {
    await stop(running);
  }
});

test("ALLOWED_ORIGIN really lets that origin's browser post a report", async () => {
  const running = await start({ ALLOWED_ORIGIN: "https://app.example.test" });
  try {
    // The preflight comes first, and a browser that never gets an answer to it
    // never sends the report at all.
    const preflight = await fetch(`${running.origin}/api/feedback`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.test",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.ok(preflight.status < 300, `the preflight answered ${preflight.status}`);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://app.example.test");

    const posted = await fetch(`${running.origin}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://app.example.test" },
      body: JSON.stringify({ type: "bug", message: "posted from another origin" }),
    });
    assert.equal(posted.status, 201);
    assert.equal(
      posted.headers.get("access-control-allow-origin"),
      "https://app.example.test",
      "the answer carries the header, or the browser throws the response away",
    );
  } finally {
    await stop(running);
  }
});

test("without the notify variables nobody is told", async () => {
  const hook = await fakeWebhook();
  const running = await start({ PUBLIC_URL: "https://bugs.example.test" });
  try {
    await post(running.origin, "nothing should leave this process");
    // Long enough for a sink to have run, had there been one to run.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(hook.bodies.length, 0);
  } finally {
    await stop(running);
    await hook.close();
  }
});
