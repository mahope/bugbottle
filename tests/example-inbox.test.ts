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
import type { Readable } from "node:stream";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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
async function start(): Promise<Started> {
  const reports = await mkdtemp(join(tmpdir(), "bugbottle-inbox-"));
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, INBOX_PASSWORD: PASSWORD, PORT: "0", REPORTS_DIR: reports },
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

async function stop({ child, reports }: Started): Promise<void> {
  const ended = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await ended;
  await rm(reports, { recursive: true, force: true });
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
