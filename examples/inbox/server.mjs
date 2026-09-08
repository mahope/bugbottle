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
import { readFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import {
  discordSink,
  fileStore,
  handleReport,
  sendReportWebhook,
  slackSink,
  smtpSink,
  teamsSink,
  toMarkdown,
} from "bugbottle/server";

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
 * Which address the rate limit counts against, read from `TRUST_PROXY`.
 *
 * Unset is the honest default: the socket, which behind a proxy is the proxy,
 * so every visitor shares one bucket of 30 a minute. `true` trusts the last
 * entry of `X-Forwarded-For`, which is what Caddy, Traefik and nginx append
 * when they are the only hop in front of this process. A number is that many
 * hops in from the right, for a CDN in front of your own proxy. Anything else
 * is read as a header name, for a platform that writes one of its own —
 * `TRUST_PROXY=CF-Connecting-IP`.
 *
 * Set it wrong in one direction and the limit is shared by the whole site; set
 * it wrong in the other and any caller can pick their own key with one header.
 */
function readTrustProxy() {
  const raw = (process.env.TRUST_PROXY ?? "").trim();
  if (!raw || raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops > 0) return { hops };
  return { header: raw };
}

const trustProxy = readTrustProxy();

/**
 * One JSON line per decision on stdout, behind `AUDIT_LOG=1`.
 *
 * Docker keeps stdout, so this is the audit trail an inbox on a VPS gets for
 * free: what was decided, why, for whom and when. It is deliberately the
 * decision and nothing else — no message, no contact line, no picture — so
 * that a log shipper is not a second copy of somebody's bug report. The
 * fingerprint is how two lines about the same report are tied together.
 */
const auditLog = (process.env.AUDIT_LOG ?? "").trim() === "1";

/**
 * The eleven words `handleReport` can answer with, every one of them seeded at
 * zero.
 *
 * A counter that appears only once it has fired is a counter nothing can graph
 * across a restart: `rate()` over a series whose first sample is the first
 * refusal reads that refusal as no change at all. Naming the whole set here
 * costs eleven lines in a scrape and makes every one of them a series from the
 * first request onwards. The order is the order the main README lists them in.
 */
const DECISION_REASONS = [
  "stored",
  "accepted",
  "duplicate",
  "not-post",
  "rate-limited",
  "unauthorised",
  "too-large",
  "timeout",
  "bad-signature",
  "invalid",
  "error",
];

/**
 * How many times each answer has been given since this process started.
 *
 * In memory and nowhere else: a restart is a reset, which is what a Prometheus
 * counter expects and what lets this stay a dependency-free example. The
 * numbers are counts of answers, never anything out of a report.
 */
const decisions = new Map(DECISION_REASONS.map((reason) => [reason, 0]));

/** Counts one answer. An unknown word is still counted, rather than dropped. */
function countDecision(reason) {
  decisions.set(reason, (decisions.get(reason) ?? 0) + 1);
}

/**
 * One decision, counted always and printed behind `AUDIT_LOG=1`.
 *
 * The counting is unconditional because `/metrics` is: an operator who turns
 * the audit log off should not silently lose their graphs with it. The
 * printing is the thing that writes a second copy of anything, so that is the
 * half with a switch on it.
 */
const onDecision = (decision) => {
  countDecision(decision.reason);
  if (auditLog) console.log(JSON.stringify({ event: "bugbottle.decision", ...decision }));
};

/**
 * The header the trusted setting reads, or null when nothing is trusted. The
 * request handed to `handleReport` is built here rather than forwarded whole,
 * so a header nobody copies across is a header `trustProxy` never sees.
 */
const trustedHeader =
  trustProxy === false
    ? null
    : (typeof trustProxy === "object" && trustProxy.header ? trustProxy.header : "x-forwarded-for")
        .toLowerCase();

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
 * Where a report goes: one JSON file per report with the decoded picture
 * beside it, an in-memory index of the strings the list shows, a cap on the
 * directory, and an atomic write under all of it.
 *
 * All of that is `fileStore` in `bugbottle/server` now. It used to be two
 * hundred lines of this file, which is how it earnt its way into the library:
 * the rename that stops a half-written report from ever being read, the id
 * that cannot become a path, and the cap that deletes the oldest first are the
 * parts everybody needs and nobody wants to get wrong twice. What is left here
 * is routing, the password and the HTML.
 */
const reports = fileStore({
  dir: reportsDir,
  /** How many reports the directory holds before the oldest are deleted. */
  maxReports: Number(process.env.MAX_REPORTS ?? 2000),
  /**
   * How long a report is kept, in days. Off by default: how long you may hold
   * somebody's screenshot is your obligation to work out, not this example's
   * to guess. Set it and the schedule below deletes what is older.
   */
  maxAgeDays: Number(process.env.RETENTION_DAYS ?? 0),
});

/** How often retention runs after the pass at start. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Retention: everything past `RETENTION_DAYS`, then everything past
 * `MAX_REPORTS`, JSON and picture together.
 *
 * The cap already runs on every write, so what the schedule adds is the age:
 * an inbox nobody has posted to for a month must still be empty at the end of
 * it, and that only happens if something runs with no request to trigger it.
 * Once at start, because a process that keeps restarting would otherwise never
 * reach the first hour, and hourly after that — retention measured in days
 * does not need a tighter clock than that.
 */
async function prune() {
  try {
    const deleted = await reports.prune();
    if (deleted) console.log(`Retention deleted ${deleted} report(s)`);
  } catch (error) {
    // A directory that cannot be pruned is not a reason to stop serving.
    console.error(error);
  }
}

/**
 * What the inbox filed a report as, remembered until the request is over.
 *
 * A sink is handed the report and its Markdown, never the id the store chose,
 * so the two are tied together here: the key is the object `handleReport`
 * passes first to `store` and then to every sink, and a `WeakMap` forgets the
 * entry as soon as the request that made it is collected.
 */
const filed = new WeakMap();

/** `fileStore.store`, with the id it answered with kept for the sinks. */
async function store(report, screenshot) {
  const result = await reports.store(report, screenshot);
  if (result?.id) filed.set(report, { id: result.id, picture: Boolean(screenshot?.length) });
  return result;
}

/**
 * The absolute address of this inbox, as a notification links it.
 *
 * `baseUrl` below asks the request, which is right for a feed and impossible
 * here: a sink runs after the browser has been answered, so `PUBLIC_URL` is
 * the only thing that knows the public name. Without it the address the server
 * is bound to is the honest answer, and it is right on a laptop.
 */
function notifyBase() {
  const configured = process.env.PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const bound = server.address();
  const shown = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${shown}:${bound?.port ?? port}`;
}

/** Where this inbox keeps the report, for a sink that wants to link to it. */
function reportUrl(report) {
  const entry = filed.get(report);
  return entry ? `${notifyBase()}/r/${entry.id}` : undefined;
}

/**
 * Where the picture is, when there was one. It is behind the password like
 * everything else, so Slack and Teams will fetch it and get a 401 rather than
 * an image — which is the right way round. The link is still worth sending:
 * whoever opens it is signed in, and the alternative is a public address for a
 * screenshot of somebody's application.
 */
function screenshotUrl(report) {
  const entry = filed.get(report);
  return entry?.picture ? `${notifyBase()}/r/${entry.id}.png` : undefined;
}

/**
 * What is on the other end of `NOTIFY_WEBHOOK`. Slack, Discord and Teams each
 * want a body of their own, and the host of the URL says which; `NOTIFY_KIND`
 * settles it for a webhook that arrives through a relay, a proxy or a gateway
 * whose hostname says nothing.
 */
function webhookKind(target) {
  const forced = (process.env.NOTIFY_KIND ?? "").trim().toLowerCase();
  if (forced) return forced;
  let hostname = "";
  try {
    hostname = new URL(target).hostname.toLowerCase();
  } catch {
    return "webhook";
  }
  if (hostname === "slack.com" || hostname.endsWith(".slack.com")) return "slack";
  if (/(^|\.)(discord\.com|discordapp\.com)$/.test(hostname)) return "discord";
  if (/(^|\.)(webhook\.office\.com|logic\.azure\.com|logic\.azure\.us)$/.test(hostname)) {
    return "teams";
  }
  return "webhook";
}

/**
 * A port out of the environment, or nothing when the variable is unset.
 *
 * `Number("smtp")` is `NaN`, and `NaN` is not nullish, so a typo used to reach
 * the sink as a port and defeat its own default — the inbox came up looking
 * healthy and failed on the first report, hours later. A misconfiguration is
 * cheapest to fix while somebody is still looking at the configuration, so
 * this refuses to start instead.
 */
function envPort(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Refusing to start: ${name} must be a port between 1 and 65535.`);
    process.exit(1);
  }
  return port;
}

/**
 * The deliveries this inbox makes, read from the environment and nothing else.
 *
 * They are the library's own sinks: the example adds no delivery code, only
 * the two addresses — the report's detail page and its picture — that a sink
 * cannot work out for itself. An empty list is the default, because an inbox
 * that mailed somebody by accident would be worse than one that is quiet.
 */
function notifySinks() {
  const sinks = [];

  const webhookUrl = process.env.NOTIFY_WEBHOOK;
  if (webhookUrl) {
    const kind = webhookKind(webhookUrl);
    const options = { webhookUrl, reportUrlFrom: reportUrl, screenshotUrlFrom: screenshotUrl };
    if (kind === "slack") sinks.push(slackSink(options));
    else if (kind === "discord") sinks.push(discordSink(options));
    else if (kind === "teams") sinks.push(teamsSink(options));
    else {
      if (kind !== "webhook") {
        console.error(`NOTIFY_KIND=${kind} is not one of slack, discord, teams, webhook — posting JSON.`);
      }
      // The plain shape is the whole report as JSON with the rendered Markdown
      // beside it. There is no button in it, so the link goes in the facts
      // table, which is where anything reading this body will look.
      sinks.push(async (report, ctx) => {
        await sendReportWebhook(report, {
          endpoint: webhookUrl,
          markdown: {
            facts: { Inbox: reportUrl(report) },
            ...(ctx.screenshotUrl ? { screenshotUrl: ctx.screenshotUrl } : {}),
          },
        });
      });
    }
  }

  const smtpHost = process.env.NOTIFY_SMTP_HOST;
  if (smtpHost) {
    const from = process.env.NOTIFY_SMTP_FROM;
    const to = (process.env.NOTIFY_SMTP_TO ?? "")
      .split(",")
      .map((address) => address.trim())
      .filter(Boolean);
    if (!from || to.length === 0) {
      console.error(
        "Ignoring NOTIFY_SMTP_HOST: NOTIFY_SMTP_FROM and NOTIFY_SMTP_TO are both required.",
      );
    } else {
      const options = { host: smtpHost, from, to, screenshotUrlFrom: screenshotUrl };
      const port = envPort("NOTIFY_SMTP_PORT");
      if (port !== undefined) options.port = port;
      if (process.env.NOTIFY_SMTP_USER) options.user = process.env.NOTIFY_SMTP_USER;
      if (process.env.NOTIFY_SMTP_PASS) options.pass = process.env.NOTIFY_SMTP_PASS;
      sinks.push(async (report, ctx) => {
        // Built here rather than once, because the link to the report is one of
        // the facts and the facts belong to the options, not to the call.
        const send = smtpSink({ ...options, markdown: { facts: { Inbox: reportUrl(report) } } });
        await send(report, ctx);
      });
    }
  }

  return sinks;
}

const sinks = notifySinks();

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
  // Named on the page, because a feed nobody can find is a feed nobody uses.
  const feeds = `<p class="meta">Feeds: <a href="/feed.json">JSON</a> ·
    <a href="/feed.xml">Atom</a> — both want the password.</p>`;
  return PAGE("bugbottle inbox", `<h1>Inbox (${reports.length})</h1>${feeds}${body}`);
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

/**
 * How many reports a feed carries. A reader polls this every few minutes and
 * keeps what it has already seen, so the feed only has to cover the gap since
 * the last poll; fifty reports is a generous gap and a small response.
 */
const FEED_LIMIT = 50;

/**
 * Drops the characters XML 1.0 cannot carry at all — not even escaped: the
 * control characters other than tab, newline and carriage return. A feed
 * containing one is a feed every reader refuses, so they go rather than the
 * report. The validators strip null bytes already; the rest can arrive in a
 * file written into the directory by something other than this server.
 */
function stripControl(text) {
  let kept = "";
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === 9 || code === 10 || code === 13 || code >= 32) kept += character;
  }
  return kept;
}

const escapeXml = (value) =>
  stripControl(String(value ?? ""))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * The absolute address of this inbox, because a feed's links are read
 * somewhere else entirely — in a reader, on a phone, in Slack — where a
 * relative `/r/<id>` means nothing.
 *
 * `PUBLIC_URL` wins when it is set; otherwise the request's own `Host` says
 * where it was reached, with `X-Forwarded-Proto` from the proxy in front. The
 * header is attacker-controlled in general, but every route that reaches this
 * has already asked for the password, and the worst it can do is put a wrong
 * hostname in a feed the operator asked for.
 */
function baseUrl(req) {
  const configured = process.env.PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const proto = /^https?$/.test(forwarded) ? forwarded : "http";
  return `${proto}://${req.headers.host ?? `${host}:${port}`}`;
}

/** An ISO timestamp that a reader can parse, whatever the file said. */
function when(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

/**
 * The newest reports, rendered.
 *
 * The list comes from the in-memory index — no directory walk — and only the
 * fifty files that end up in the feed are read, because `content_text` is the
 * whole report and the index keeps just its title. The picture is a link
 * rather than bytes: a reader would fetch it without the password anyway, and
 * a feed carrying fifty screenshots is a feed nothing will poll twice.
 */
async function feedItems(req) {
  const base = baseUrl(req);
  const items = [];
  for (const entry of (await reports.list()).slice(0, FEED_LIMIT)) {
    const found = await reports.read(entry.id);
    if (!found) continue;
    items.push({
      url: `${base}/r/${entry.id}`,
      title: entry.title || "Report",
      type: entry.type || "other",
      published: when(entry.receivedAt),
      markdown: toMarkdown(found.report, { headingLevel: 0 }),
    });
  }
  return { base, items };
}

/** JSON Feed 1.1 — https://jsonfeed.org/version/1.1 */
function jsonFeed(base, items) {
  return JSON.stringify(
    {
      version: "https://jsonfeed.org/version/1.1",
      title: "bugbottle inbox",
      description: "Reports received by this inbox, newest first.",
      home_page_url: `${base}/`,
      feed_url: `${base}/feed.json`,
      items: items.map((item) => ({
        id: item.url,
        url: item.url,
        title: item.title,
        content_text: item.markdown,
        date_published: item.published,
        date_modified: item.published,
        tags: [item.type],
      })),
    },
    null,
    2,
  );
}

/**
 * Atom — RFC 4287. Every element the specification requires is here: the
 * feed's `id`, `title` and `updated`, and the same three on every entry. The
 * text all comes from a report, so all of it goes through `escapeXml`.
 */
function atomFeed(base, items) {
  const updated = items[0]?.published ?? new Date().toISOString();
  const entries = items
    .map(
      (item) => `  <entry>
    <id>${escapeXml(item.url)}</id>
    <title type="text">${escapeXml(item.title)}</title>
    <updated>${escapeXml(item.published)}</updated>
    <published>${escapeXml(item.published)}</published>
    <link rel="alternate" type="text/html" href="${escapeXml(item.url)}" />
    <category term="${escapeXml(item.type)}" />
    <content type="text">${escapeXml(item.markdown)}</content>
  </entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${escapeXml(`${base}/feed.xml`)}</id>
  <title type="text">bugbottle inbox</title>
  <subtitle type="text">Reports received by this inbox, newest first.</subtitle>
  <updated>${escapeXml(updated)}</updated>
  <author><name>bugbottle inbox</name></author>
  <link rel="self" type="application/atom+xml" href="${escapeXml(`${base}/feed.xml`)}" />
  <link rel="alternate" type="text/html" href="${escapeXml(`${base}/`)}" />
  <generator>bugbottle</generator>
${entries}
</feed>
`;
}

/**
 * The inbox as OpenMetrics text, which is the format Prometheus, VictoriaMetrics
 * and Grafana Alloy all read without being told anything.
 *
 * Three families and no more. The counters come from `onDecision`, so they are
 * exactly the answers the endpoint gave; the gauges come from the in-memory
 * index, so a scrape reads no file and walks no directory — which matters,
 * because a scrape happens every fifteen seconds for as long as the inbox
 * runs.
 *
 * There is deliberately no `bugbottle_reports_bytes`. The index knows a
 * report's name, title, type, page, time and whether there is a picture, and
 * not what either file weighs; summing that would mean two `stat` calls per
 * report on every scrape, and on an inbox at its two-thousand ceiling that is
 * four thousand of them a quarter of a minute. `du` on the volume answers the
 * same question without this process in the way.
 *
 * A counter's family name must not carry the `_total` its samples do — that is
 * the one thing about the format that surprises people — and the file ends
 * with `# EOF`, which is what tells a parser it read all of it rather than as
 * much as a dropped connection left.
 */
function metricsText(entries) {
  const lines = [];

  lines.push("# TYPE bugbottle_decisions counter");
  lines.push(
    "# HELP bugbottle_decisions Answers this endpoint has given, by reason, since it started.",
  );
  for (const [reason, count] of decisions) {
    lines.push(`bugbottle_decisions_total{reason="${reason}"} ${count}`);
  }

  lines.push("# TYPE bugbottle_reports_stored gauge");
  lines.push("# HELP bugbottle_reports_stored Reports on disk in this inbox right now.");
  lines.push(`bugbottle_reports_stored ${entries.length}`);

  // Seconds, because that is the unit every timestamp in this format is in,
  // and zero when there is nothing — a gauge that is absent until the first
  // report is a gauge an alert cannot be written against. `time() - this` is
  // then the age of the newest report, which is the question worth alerting
  // on: an endpoint that has stopped receiving looks exactly like a quiet week
  // until you graph it.
  const newest = Date.parse(entries[0]?.receivedAt ?? "");
  lines.push("# TYPE bugbottle_last_report_timestamp_seconds gauge");
  lines.push("# UNIT bugbottle_last_report_timestamp_seconds seconds");
  lines.push(
    "# HELP bugbottle_last_report_timestamp_seconds When the newest stored report arrived, " +
      "or 0 when the inbox is empty.",
  );
  lines.push(
    `bugbottle_last_report_timestamp_seconds ${Number.isFinite(newest) ? newest / 1000 : 0}`,
  );

  lines.push("# EOF");
  return `${lines.join("\n")}\n`;
}

/** Reads the request body, refusing anything over the ceiling. */
function readBody(req, res) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // `handleReport` never sees this one — the socket is closed before the
        // body is whole — so the count it would have made is made here, with
        // the word it would have used. Without this the one refusal an inbox
        // on a small VPS meets most often is the one `/metrics` cannot see.
        countDecision("too-large");
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

    // The preflight belongs to `handleReport` too, and it has to be answered
    // before the password check below: a browser on another origin sends this
    // first and never sends the report at all if it comes back a 401. Only
    // `ALLOWED_ORIGIN` makes it a yes; without it `handleReport` answers 405,
    // which is the honest reply to a cross-origin request nobody allowed.
    if ((req.method === "POST" || req.method === "OPTIONS") && path === "/api/feedback") {
      const raw = req.method === "POST" ? await readBody(req, res) : null;
      if (raw === null && req.method === "POST") return;
      const headers = { "Content-Type": "application/json" };
      if (req.headers.origin) headers.Origin = req.headers.origin;
      // Only the one header the setting names, and only when something is
      // trusted: copying every forwarding header across would hand
      // `handleReport` claims nobody asked for.
      if (trustedHeader && req.headers[trustedHeader]) {
        headers[trustedHeader] = String(req.headers[trustedHeader]);
      }
      if (req.headers["access-control-request-method"]) {
        headers["Access-Control-Request-Method"] = req.headers["access-control-request-method"];
      }
      const response = await handleReport(
        new Request("http://localhost/api/feedback", {
          method: req.method,
          headers,
          ...(raw === null ? {} : { body: raw }),
        }),
        {
          maxBodyBytes: MAX_BODY_BYTES,
          // The socket is the one address nobody outside could have written.
          // `trustProxy` is what decides whether the header above may name
          // somebody else instead.
          remoteAddress: req.socket?.remoteAddress,
          trustProxy,
          rateLimit: { limit: 30, windowMs: 60_000 },
          // Every answer, counted for `/metrics` and printed when AUDIT_LOG
          // says so. The hook is the only place either number comes from.
          onDecision,
          dedupe: { windowMs: 60_000 },
          // One named origin or nothing. A wildcard would let any page on the
          // internet fill this disk, and the disk is where the pictures are.
          cors: process.env.ALLOWED_ORIGIN,
          store,
          // Run in order after the report is on disk, each with its own
          // deadline. A webhook revoked last week is not the reporter's
          // problem: the failure is the operator's to read in the terminal,
          // and the answer is still the 201 the report earnt.
          sinks,
          onSinkError: (error) => {
            console.error(`Could not announce the report: ${error?.message ?? error}`);
          },
        },
      );
      // Its own headers, not ours: the CORS headers `handleReport` worked out
      // are on that response, and a hard-coded `Content-Type` used to be all
      // that reached the browser — which is a report the browser then threw
      // away for having no `Access-Control-Allow-Origin` on it.
      res.writeHead(response.status, Object.fromEntries(response.headers));
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
      res.end(listPage(await reports.list()));
      return;
    }

    // Behind the password with the rest of the inbox, and for the same reason:
    // how many reports arrived and when the last one did are facts about
    // somebody's application, and a scrape URL travels as far as a feed URL.
    // Prometheus has had a `basic_auth` block in every job since 2.0, so this
    // costs the operator two lines rather than a public route.
    if (req.method === "GET" && path === "/metrics") {
      res.writeHead(200, {
        "Content-Type": "application/openmetrics-text; version=1.0.0; charset=utf-8",
        "Cache-Control": "no-store, private",
      });
      res.end(metricsText(await reports.list()));
      return;
    }

    // The same list, for something that is not a browser: a feed reader, a
    // phone, a Slack RSS app. Behind the password like everything else — the
    // titles and pages of somebody's application are exactly what the inbox
    // exists to keep private, and a feed URL travels further than a bookmark.
    if (req.method === "GET" && (path === "/feed.json" || path === "/feed.xml")) {
      const { base, items } = await feedItems(req);
      const atom = path === "/feed.xml";
      res.writeHead(200, {
        "Content-Type": atom
          ? "application/atom+xml; charset=utf-8"
          : "application/feed+json; charset=utf-8",
        // A reader that cached a feed would show reports that are gone, and
        // an intermediary that cached one would hand it to the next request.
        "Cache-Control": "no-store, private",
      });
      res.end(atom ? atomFeed(base, items) : jsonFeed(base, items));
      return;
    }

    const json = /^\/r\/([^/]+)\.json$/.exec(path);
    if (req.method === "GET" && json) {
      const found = await reports.read(json[1]);
      if (!found) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(found.report, null, 2));
      return;
    }

    const png = /^\/r\/([^/]+)\.png$/.exec(path);
    if (req.method === "GET" && png) {
      const found = await reports.read(png[1], { screenshot: true });
      if (!found?.screenshot) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from(found.screenshot));
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
      if (!(await reports.remove(remove[1]))) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(303, { Location: "/" }).end();
      return;
    }

    const detail = /^\/r\/([^/]+)$/.exec(path);
    if (req.method === "GET" && detail) {
      // One file, the one that was asked for. The index carries the name and
      // whether there is a picture; the report itself is read only here.
      const found = await reports.read(detail[1]);
      if (!found) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(detailPage({ id: found.entry.id, report: found.report }, found.entry.screenshot));
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
  // The kinds, never the addresses: a webhook URL is the credential, and this
  // line ends up in a platform's log where a password does not belong.
  if (sinks.length) console.log(`Announcing every report through ${sinks.length} sink(s)`);
  const days = Number(process.env.RETENTION_DAYS ?? 0);
  if (days > 0) console.log(`Keeping reports for ${days} day(s)`);
  void prune();
  // `unref`, so the interval is never the reason this process stays up: the
  // server is what holds it open, and when that closes the inbox should end.
  setInterval(() => void prune(), PRUNE_INTERVAL_MS).unref();
});
