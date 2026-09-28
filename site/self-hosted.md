"Self-hosted" is the word on the box of most tools people compare this one
to, and it means a service: a container, a database, a version to track, a
migration to run and a changelog to read. bugbottle has none of those. There is
no bugbottle server, no admin interface and no data store to operate, because
the whole backend half is two exported functions and a route you already have
somewhere. What you self-host is your own endpoint — and the question this page
answers is what that actually costs, and what you take on when you write the
route yourself.

The figures below are from the repository on 28 September 2026 and are checked
by `npm run check`; follow the links rather than the numbers if you are reading
this later.

## What you run

Three shapes, in the order most people end up in them. None of them requires
installing anything on the server beyond what the application already has.

**A route in an application you already run.** This is the whole of it:

```ts
import { fileStore, handleReport } from "bugbottle/server";

const reports = fileStore({ dir: "./reports", maxReports: 2000 });

export const POST = (req: Request) => handleReport(req, { store: reports.store });
```

`handleReport` is a `Request` in and a `Response` out, so that line is a route
in Hono, Cloudflare Workers, Deno, Bun, Next.js, Astro or anything else that
speaks fetch — and `expressHandler` and `fastifyHandler` exist for the two that
do not. The [receiving
guide](/docs/receiving-a-report/) is the long version, and
[the payload](/docs/the-payload/) is what arrives.

**A small container you own.** [`examples/inbox`](https://github.com/mahope/bugbottle/tree/main/examples/inbox)
is that route plus a read-only list and a detail page behind one password, with
a `Dockerfile` and a `compose.yml` that put it on a VPS in front of Caddy. It is
an example you copy, not a service we run: no database, one directory of files
on a volume, and `INBOX_PASSWORD` set or it refuses to start. It also posts to
Slack, Discord, Teams, Sentry, Jira, GitLab, Linear, Resend or SMTP from
environment variables alone, so the notification is not something you have to
write.

**WordPress, in one activation.** The
[plugin](https://github.com/mahope/bugbottle-wordpress) is the panel *and* a
receiving endpoint in the same zip: mount the panel with one setting, and the
site's own REST route takes the report, with its own authentication and its own
rate limit. There is nothing else to deploy.

## What it costs to operate

The honest answer is one directory and a cron entry, and the numbers are
constants you can read in the source:

- **One file per report**, named `<receivedAt>-<id>.json`, with the decoded
  screenshot beside it as `<id>.png` — or no picture at all, if you pass
  `screenshots: false`. Every write goes to a temporary file and is renamed into
  place, so a crash leaves a `.tmp` nothing lists rather than half a report.
- **2 000 reports by default** (`DEFAULT_MAX_REPORTS`); the oldest go first,
  JSON and picture together. The cap runs on a write.
- **Retention is off unless you ask for it.** `maxAgeDays` is 0, which means
  "keep it", and `prune()` is what applies a limit — so an age limit is a
  schedule you write, not a setting a library can enforce. The example runs
  `prune()` at start and hourly.
- **A report with a screenshot is up to 2 MiB of base64** on the wire
  (`MAX_SCREENSHOT_BYTES`), inside a 4 MiB body ceiling
  (`DEFAULT_MAX_BODY_BYTES`). Disk is the only capacity number worth planning
  for, and a report that arrives without a picture is still a report.
- **Nothing to patch.** No container to rebuild, no dependency tree, no
  migration, no version to pin. The library has zero runtime dependencies, so
  the thing you would normally have to keep current does not exist; the last
  release keeps working, because it is
  [MIT](/docs/licence/) and it is on npm.
- **No data leaves your network.** There is no account, no key, no telemetry
  and no endpoint of ours in the path, which is also why there is no DPA to sign
  — the [privacy checklist](/docs/privacy-checklist/) is the document to hand to
  whoever asks.

## Five things that bite whoever receives the report

These are the same five on every framework page, collected here because they are
properties of *your* deployment and not of the framework. All five are
invisible until a report with a screenshot arrives, which is the worst time to
find them.

| What | What actually happens | Where |
|---|---|---|
| The framework's body limit is smaller than a report | `express.json()` caps the body at 100 kB and Nest inherits it; Fastify's default `bodyLimit` is 1 MiB. A report with a screenshot is 2 MiB of base64, so the request is refused **before your route runs** and the handler never answers | [Express](/docs/express/), [Fastify](/docs/fastify/), [NestJS](/docs/nestjs/) |
| A signed route behind a body parser | A signature covers the exact bytes, and a JSON parser has already replaced them with an object. The bytes are usually still there (`req.rawBody`), just not where the adapter looks | [Express](/docs/express/), [Fastify](/docs/fastify/) |
| Behind a proxy, the rate limit counts the proxy | `trustProxy` is `false` by default, and the address the limit keys on is the connection, not the header. One shared egress address is one shared bucket | [handleReport](/docs/receiving-a-report/) |
| A screenshot is checked in its bytes, not its declared type | The decoded data URL is verified against the PNG signature before it is written; one that is not a picture is dropped and the report is stored without it | [Screenshots](/docs/screenshots/) |
| Everything from the browser is hostile input | The store receives lengths, null-byte-free strings and a validated body, because a report is about to be written to disk and read back into a page | [Validation](/docs/the-payload/) |

## What you do not get

This is the part to read before you choose it over a product, and the
[comparison](/compare/) says the same thing row by row with every figure
sourced:

- **No dashboard.** Reports land where you put them: files, a database, a Slack
  channel, a ticket. There is no queue, no owner, no status and no history
  unless the thing you already use has one.
- **No alerting and no grouping.** Nothing pages anybody, and nothing merges two
  reports that share a fingerprint. A duplicate report arrives as a duplicate.
- **No performance product.** `bugbottle/perf` reports the Web Vitals of the
  session that produced a report; there is no time series, no percentile
  dashboard and no tracing.
- **Replay only if you bring it.** [`attachRrweb`](/docs/replay-with-rrweb/)
  wraps your own rrweb `record`; rrweb is not a dependency and there is no
  replay storage here.
- **One browser in CI.** Every push runs the accessibility audits and an
  annotation smoke test in one Chrome. There is no automated Firefox or Safari
  run — see [what a donation pays for](/support/).
- **No seat count, because there is no seat.** One binary, MIT, the same for a
  freelancer and a company, and nothing behind a paywall to upgrade to.

## When it is the right choice

Choose it when the reports are a by-product of something you already run: you
have an API, a database and an inbox, and what is missing is the few kilobytes
that turn "it's broken" into JSON you can act on. The panel is about
[11.5 kB gzipped](/compare/) and the core about 1.4 kB, so the whole cost of
the library is smaller than one image on the page that reports it.

Choose a self-hosted *product* when the reporters are not developers and what
unblocks them is a queue with an owner, or when you want alerting, release
health and a dashboard you did not write. That is a real need and this library
is not the answer to it — the
[comparison page](/compare/) names the tools that are, and says what each one
costs. Choose the WordPress plugin if the application is WordPress and nobody
wants to write a route.
