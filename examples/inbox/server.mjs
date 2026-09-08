/**
 * The smallest honest place for a report to land: a Node server that receives
 * reports with `handleReport`, writes each one to disk, and serves a read-only
 * inbox behind one password.
 *
 * It is an example rather than a product. There are no accounts, no search, no
 * assignment and no digests — one password, a list, a detail page, a delete
 * button. That is enough for a freelancer to run one of these per client site
 * on a small VPS behind Caddy or nginx and stop losing reports in email.
 *
 * Only Node's built-in modules and the library itself. The browser half is
 * served from this repository's dist/, so run `npm run build` in the root
 * first.
 */
import { createServer } from "node:http";
import { readFile, writeFile, readdir, mkdir, rm } from "node:fs/promises";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { handleReport, toMarkdown } from "bugbottle/server";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "..", "dist");
const reportsDir = process.env.REPORTS_DIR ?? join(here, "reports");
const port = Number(process.env.PORT ?? 8788);
/**
 * Loopback by default, because an inbox reached over plain HTTP hands its
 * password to the network. Inside a container there is no proxy on the same
 * loopback, so the image sets `HOST=0.0.0.0` and the proxy is the platform's.
 */
const host = process.env.HOST ?? "127.0.0.1";

/**
 * No password, no inbox. Refusing to start is the only safe default: an inbox
 * that came up without one would be a public list of screenshots of somebody's
 * application, and nobody would notice until it was indexed.
 */
const password = process.env.INBOX_PASSWORD;
if (!password) {
  console.error(
    "Refusing to start: set INBOX_PASSWORD to the password that guards the inbox.\n" +
      "  INBOX_PASSWORD=$(openssl rand -base64 24) node server.mjs",
  );
  process.exit(1);
}

/** How much of a body is read before it is refused. The picture dominates it. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Compares two secrets in constant time. The digests are the same length
 * whatever the passwords are, so the comparison cannot be timed to learn how
 * long the real one is — which a bare `!==`, or `timingSafeEqual` on the raw
 * bytes, would leak.
 */
function sameSecret(a, b) {
  const digest = (value) => createHash("sha256").update(String(value)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** True when the request carries the inbox password. The username is ignored. */
function authorised(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const offered = decoded.slice(decoded.indexOf(":") + 1);
  return sameSecret(offered, password);
}

/**
 * True when a state-changing request came from the inbox's own pages.
 *
 * The password alone is not enough here. A browser attaches a cached
 * `Authorization` header to a cross-site form POST exactly as it does to a
 * same-site one — `SameSite` governs cookies and has nothing to say about HTTP
 * auth — so without this check any page the operator happens to be visiting can
 * delete a report whose id it knows. A reporter learns an id by sending one:
 * the endpoint answers with it.
 *
 * `Sec-Fetch-Site` is the modern answer and `Origin` the older one; every
 * browser has sent both on a cross-origin POST for years. A request carrying
 * neither is not a browser — curl, a deploy script — and is allowed through,
 * because refusing it would break scripting the inbox without stopping the
 * attack this exists for.
 */
function sameOrigin(req) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function forbidden(res) {
  res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("This request did not come from the inbox\n");
}

function unauthorised(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="bugbottle inbox", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("Password required\n");
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Inline `code` spans, on text that has already been escaped. Nothing else is
 * inline: bold and links would each be another place a report could smuggle
 * markup through, and the report is attacker-controlled text.
 */
const inline = (escaped) => escaped.replace(/`([^`]+)`/g, "<code>$1</code>");

/**
 * `toMarkdown` output as HTML — headings, paragraphs, tables, fenced code,
 * lists and the two `<details>` lines it writes itself. Everything else is a
 * paragraph of escaped text.
 *
 * The structure is read from the raw Markdown; every piece of *text* is
 * escaped before it reaches the page. That order is the whole point: a report
 * saying `<img src=x onerror=…>` is shown, never run.
 */
function renderMarkdown(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let i = 0;
  const paragraph = [];
  const flush = () => {
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join("<br />"))}</p>`);
    paragraph.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      flush();
      i += 1;
      continue;
    }

    // A fenced block, kept verbatim: this is where the console stack lives.
    const fence = /^(`{3,})(\w*)$/.exec(line.trim());
    if (fence) {
      flush();
      const body = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== fence[1]) body.push(lines[i++]);
      i += 1;
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    // The only HTML `toMarkdown` writes, and it writes the summary itself.
    const details = /^<details><summary>(.*)<\/summary>$/.exec(line);
    if (details) {
      flush();
      out.push(`<details open><summary>${escapeHtml(details[1])}</summary>`);
      i += 1;
      continue;
    }
    if (line.trim() === "</details>") {
      flush();
      out.push("</details>");
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      i += 1;
      continue;
    }

    // A table: a row, a divider of dashes, then rows until the blank line.
    if (line.startsWith("|") && (lines[i + 1] ?? "").replace(/[|\-: ]/g, "") === "") {
      flush();
      const cells = (row) =>
        row
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map((cell) => inline(escapeHtml(cell.replace(/\\\|/g, "|").trim())));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(cells(lines[i++]));
      const headHtml = head.some((cell) => cell !== "")
        ? `<thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>`
        : "";
      const bodyHtml = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
        .join("");
      out.push(`<table>${headHtml}<tbody>${bodyHtml}</tbody></table>`);
      continue;
    }

    if (line.startsWith("- ")) {
      flush();
      const items = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(`<li>${inline(escapeHtml(lines[i++].slice(2)))}</li>`);
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    paragraph.push(escapeHtml(line));
    i += 1;
  }
  flush();
  return out.join("\n");
}

const PAGE = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
  a { color: inherit; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #8886; padding: .35rem .6rem; text-align: left; vertical-align: top; }
  pre { background: #8881; padding: .75rem; overflow-x: auto; }
  code { font-size: .9em; }
  img { max-width: 100%; border: 1px solid #8886; }
  ol.reports { list-style: none; padding: 0; }
  ol.reports li { border-bottom: 1px solid #8884; padding: .6rem 0; }
  .meta { color: #8889; font-size: .85em; }
  .tools { display: flex; gap: .5rem; align-items: center; margin: 1rem 0; }
  button { font: inherit; padding: .4rem .8rem; cursor: pointer; }
</style></head><body>${body}</body></html>
`;

/**
 * The list, in memory: one small entry per stored report rather than the
 * reports themselves.
 *
 * Reading and parsing every file on every request is fine for the first
 * hundred reports and is quietly quadratic after that — and it was being done
 * for the detail page too, which needs exactly one of them. So the directory
 * is walked once, at the first request that needs the list, and the four
 * strings the list actually shows are kept. After that a write appends and a
 * delete removes; nothing re-reads the directory, because this process is the
 * only thing that writes to it.
 *
 * `null` until that first walk. It is not a cache to be invalidated: dropping
 * an entry that is still on disk would hide a report, so every path that
 * touches the directory touches this in the same breath.
 */
let index = null;

/** How many reports the directory holds before the oldest are deleted. */
const MAX_REPORTS = Number(process.env.MAX_REPORTS ?? 2000);

/** The strings the list shows, taken from a report once and then kept. */
function summarise(id, file, report) {
  return {
    id,
    file,
    title: String(report?.message ?? "").split(/\r?\n/)[0] ?? "",
    type: String(report?.type ?? ""),
    url: String(report?.context?.url ?? ""),
    receivedAt: String(report?.receivedAt ?? ""),
  };
}

/** Every stored report, newest first. Built once, then kept up to date. */
async function listReports() {
  if (index) return index;
  let files = [];
  try {
    files = await readdir(reportsDir);
  } catch {
    index = [];
    return index;
  }
  const entries = [];
  // The name begins with the arrival time, so sorting the names sorts by age.
  for (const file of files.filter((name) => name.endsWith(".json")).sort().reverse()) {
    const id = /-([0-9a-f-]{36})\.json$/.exec(file)?.[1];
    if (!id) continue;
    try {
      entries.push(summarise(id, file, JSON.parse(await readFile(join(reportsDir, file), "utf8"))));
    } catch {
      // A half-written file is skipped rather than allowed to empty the list.
    }
  }
  index = entries;
  return index;
}

/** One list entry by id, or null. The id is checked before it reaches a path. */
async function findReport(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return (await listReports()).find((entry) => entry.id === id) ?? null;
}

/** The stored JSON for one entry — one file, read only when it is asked for. */
async function readReport(entry) {
  try {
    return JSON.parse(await readFile(join(reportsDir, entry.file), "utf8"));
  } catch {
    return null;
  }
}

/** Forgets an entry and deletes both of its files. */
async function forget(entry) {
  if (index) index = index.filter((other) => other.id !== entry.id);
  await rm(join(reportsDir, entry.file), { force: true });
  await rm(join(reportsDir, `${entry.id}.png`), { force: true });
}

/**
 * Deletes the oldest reports until the directory is back inside `MAX_REPORTS`.
 *
 * An inbox with no ceiling is a disk that fills: the rate limit allows thirty
 * reports a minute and each of them may carry four megabytes of picture, so a
 * fortnight of somebody's script is a full volume and an inbox that has
 * stopped accepting anything. Oldest first, because the newest report is the
 * one somebody is about to read.
 */
async function prune() {
  if (!index || !Number.isFinite(MAX_REPORTS) || MAX_REPORTS <= 0) return;
  while (index.length > MAX_REPORTS) {
    const oldest = index[index.length - 1];
    if (!oldest) break;
    await forget(oldest);
  }
}

function listPage(reports) {
  const items = reports
    .map(({ id, title, type, url, receivedAt }) => {
      return `<li><a href="/r/${id}"><strong>${escapeHtml(title)}</strong></a>
        <div class="meta">${escapeHtml(type)} · ${escapeHtml(url)}
        · ${escapeHtml(receivedAt)}</div></li>`;
    })
    .join("\n");
  const body = reports.length
    ? `<ol class="reports">${items}</ol>`
    : "<p>Nothing yet. Send one from <a href=\"/demo.html\">the demo page</a>.</p>";
  return PAGE("bugbottle inbox", `<h1>Inbox (${reports.length})</h1>${body}`);
}

function detailPage({ id, report }, hasPicture) {
  const markdown = toMarkdown(report, {
    screenshotUrl: hasPicture ? `/r/${id}.png` : undefined,
  });
  return PAGE(
    report.message.split(/\r?\n/)[0] ?? "Report",
    `<p><a href="/">← Inbox</a></p>
${renderMarkdown(markdown)}
${hasPicture ? `<p><img src="/r/${id}.png" alt="Screenshot sent with the report" /></p>` : ""}
<div class="tools">
  <button type="button" id="copy">Copy as Markdown</button>
  <a href="/r/${id}.json">Raw JSON</a>
  <form method="post" action="/r/${id}/delete" onsubmit="return confirm('Delete this report?')">
    <button type="submit">Delete</button>
  </form>
</div>
<pre id="markdown" hidden>${escapeHtml(markdown)}</pre>
<script>
  const source = document.getElementById("markdown");
  document.getElementById("copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(source.textContent);
    document.getElementById("copy").textContent = "Copied";
  });
</script>`,
  );
}

/** Reads the request body, refusing anything over the ceiling. */
function readBody(req, res) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Report is too large" }));
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

/**
 * Where a report goes: the validated JSON under its arrival time, the decoded
 * picture beside it under the id alone. The split keeps the JSON readable —
 * a megabyte of base64 in the middle of a file makes it unopenable — and it
 * means deleting a report is deleting two files nobody has to parse.
 */
async function store(report, screenshot) {
  const id = randomUUID();
  // Before the write, not after: the first report of a run is what triggers
  // the one walk of the directory, and a walk that ran afterwards would find
  // this report on disk and then be handed it a second time below.
  const reports = await listReports();

  await mkdir(reportsDir, { recursive: true });
  const stamp = report.receivedAt.replace(/[:.]/g, "-");
  const file = `${stamp}-${id}.json`;
  await writeFile(join(reportsDir, file), JSON.stringify(report, null, 2));
  if (screenshot) await writeFile(join(reportsDir, `${id}.png`), screenshot);

  reports.unshift(summarise(id, file, report));
  await prune();
  return { id };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  try {
    // Public, and deliberately empty of news: the platform's check runs before
    // anybody has the password, and what it needs to know is that the process
    // is answering. Anything about the inbox itself — how many reports, how
    // much disk — would be a fact about somebody's application, given away at
    // an address with no password on it.
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok\n");
      return;
    }

    if (req.method === "POST" && path === "/api/feedback") {
      const raw = await readBody(req, res);
      if (raw === null) return;
      const response = await handleReport(
        new Request("http://localhost/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: raw,
        }),
        {
          maxBodyBytes: MAX_BODY_BYTES,
          rateLimit: { limit: 30, windowMs: 60_000 },
          dedupe: { windowMs: 60_000 },
          // One named origin or nothing. A wildcard would let any page on the
          // internet fill this disk, and the disk is where the pictures are.
          cors: process.env.ALLOWED_ORIGIN,
          store,
        },
      );
      res.writeHead(response.status, { "Content-Type": "application/json" });
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    // The reporting half is public — that is the endpoint a browser posts to.
    if (req.method === "GET" && path === "/demo.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await readFile(join(here, "demo.html")));
      return;
    }

    if (req.method === "GET" && path.startsWith("/bugbottle/")) {
      const file = normalize(join(dist, path.slice("/bugbottle/".length)));
      if (!file.startsWith(dist) || !file.endsWith(".js")) {
        res.writeHead(404).end();
        return;
      }
      try {
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end(await readFile(file));
      } catch {
        res.writeHead(404).end("Run `npm run build` in the repository root first.");
      }
      return;
    }

    // Everything below is the inbox, and the inbox is the password's job.
    if (!authorised(req)) {
      unauthorised(res);
      return;
    }

    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(listPage(await listReports()));
      return;
    }

    const json = /^\/r\/([^/]+)\.json$/.exec(path);
    if (req.method === "GET" && json) {
      const found = await findReport(json[1]);
      if (!found) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(await readFile(join(reportsDir, found.file)));
      return;
    }

    const png = /^\/r\/([^/]+)\.png$/.exec(path);
    if (req.method === "GET" && png) {
      const found = await findReport(png[1]);
      if (!found) {
        res.writeHead(404).end();
        return;
      }
      try {
        const bytes = await readFile(join(reportsDir, `${found.id}.png`));
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(bytes);
      } catch {
        res.writeHead(404).end();
      }
      return;
    }

    const remove = /^\/r\/([^/]+)\/delete$/.exec(path);
    if (req.method === "POST" && remove) {
      // The one route that changes anything, so the one that needs more than
      // the password: see `sameOrigin`.
      if (!sameOrigin(req)) {
        forbidden(res);
        return;
      }
      const found = await findReport(remove[1]);
      if (!found) {
        res.writeHead(404).end();
        return;
      }
      await forget(found);
      res.writeHead(303, { Location: "/" }).end();
      return;
    }

    const detail = /^\/r\/([^/]+)$/.exec(path);
    if (req.method === "GET" && detail) {
      const found = await findReport(detail[1]);
      if (!found) {
        res.writeHead(404).end();
        return;
      }
      // One file, the one that was asked for. The list's index carries the
      // name; the report itself is read only here.
      const report = await readReport(found);
      if (!report) {
        res.writeHead(404).end();
        return;
      }
      let hasPicture = true;
      try {
        await readFile(join(reportsDir, `${found.id}.png`));
      } catch {
        hasPicture = false;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(detailPage({ id: found.id, report }, hasPicture));
      return;
    }

    res.writeHead(404).end();
  } catch (error) {
    // Never tell the caller what broke; the operator reads the terminal.
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Something went wrong\n");
  }
});

server.listen(port, host, () => {
  const { port: bound } = server.address();
  // A wildcard address is not one anybody can open, so the line names the
  // address they can: the port is either mapped to their machine or in front
  // of a proxy that is.
  const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  console.log(`Inbox on http://${shown}:${bound} — reports in ${reportsDir}`);
  console.log(`Send one from http://${shown}:${bound}/demo.html`);
});
