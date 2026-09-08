# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Since 1.0 that is a promise rather
than an intention: removing or renaming an export, an option or a `data-*`
attribute needs a major version, and a new entry point needs a minor one.

## Unreleased

## 1.0.0 — 2026-09-08

The freeze. 1.0 says what the next version number will mean: **removing or
renaming an export, an option or a `data-*` attribute needs a major version, a
new entry point needs a minor one**, and a patch changes behaviour only where
the behaviour was a bug. Nothing new is added here. What lands is the other
half of the September audit (#62): the seven aliases 0.9 introduced beside the
names it settled on are removed, the server validators and `toMarkdown` leave
the browser entry, and the eleven sinks agree on one shape for the picture
address.

The whole public surface — every export of all twenty entry points — is
generated from the build into `docs/api-audit-1.0.md` by
`node scripts/api-table.mjs`, so a rename is a diff rather than a surprise;
`tests/exports.test.ts` writes the exports map out in full and fails when it,
the README's API section and `CLAUDE.md` stop agreeing; and the seven naming
rules in `CLAUDE.md` are the contract the next name is chosen by rather than a
style preference.

Every migration in one table. All of them are mechanical, and nobody has to
read a value to make one:

| Was | Is | Where |
|---|---|---|
| `SendOptions.onFailure` | `SendOptions.onError` | `sendReport` |
| `QueueOptions.maxItems` | `QueueOptions.maxEntries` | `createQueue` |
| `SLACK_MAX_*`, `DISCORD_MAX_*` (13) | `MAX_SLACK_*`, `MAX_DISCORD_*` | `bugbottle/server` |
| `rateLimit.rateLimitStore` | `rateLimit.store` | `handleReport` |
| `dedupe.dedupeStore` | `dedupe.store` | `handleReport` |
| `signature.replayStore` | `signature.store` | `handleReport` |
| `SendReportWebhookOptions.url` | `SendReportWebhookOptions.endpoint` | `sendReportWebhook`, `toWebhook` |
| `import { normalise*, toMarkdown } from "bugbottle"` | `… from "bugbottle/server"` | the core entry |
| `slackSink({ screenshotUrl: (r) => … })` | `slackSink({ screenshotUrlFrom: (r) => … })` | Slack, Discord, Teams |
| `slackSink({ reportUrl: (r) => … })` | `slackSink({ reportUrlFrom: (r) => … })` | Slack, Discord, Teams |

The wire format is unchanged: a 0.15 browser and a 1.0 server understand each
other in both directions, and so do the schema, the OpenAPI document and the
GitHub Action.

Sizes moved by single-digit bytes and no budget moved with them, apart from
what #98 cost the queue. Measured
against 0.15.0 with the same recipe: `bugbottle/react` −4, `bugbottle/vue` −5,
`bugbottle/svelte` −6, `bugbottle/solid` −5, `bugbottle/ui` −6,
`bugbottle/queue` 1545 → 1539 → 1565 (the signer seam; the budget stays at
1600), `bugbottle/server` −2, `dist/bugbottle.js` −14 then +51
and `dist/bugbottle.slim.js` −12 then +50, both still inside 25088 and 21504.
The core rose three bytes, which is the
compressor rather than the code: everything #68 took off the entry was already
tree-shaken out of a bundle that never called it, which is why that issue was
about what the entry says it is and not about bytes.

### Changed

- **The site has one canonical host.** `bugbottle.dev` resolves to the Dokploy
  application, so `bugbottle.mahoje.dk` — the address the site had first, and
  still a domain on the same application — no longer serves a second copy of
  every page. A second `server` block in `site/nginx.conf` answers it with
  `301 https://bugbottle.dev$request_uri`: the same path and query on the
  canonical host, so bookmarks and whatever a crawler still remembers converge
  on one origin. Traefik forwards the original `Host`, which is what lets an
  exact `server_name` catch the alias before the catch-all. `/health` still
  answers 200 on both hosts, because Dokploy polls it and a redirect there
  would read as a failure and flap the application, and the alias block
  includes the same `security-headers.conf` as the one that serves. Nothing in
  the package changed; the canonical links, the Open Graph URLs and the sitemap
  have said bugbottle.dev since 0.5.0.
- **One shape for the screenshot address across all eleven sinks** (#69).
  `screenshotUrl` is a `string` everywhere — the address you already have — and
  `screenshotUrlFrom` is the function that reads one out of the report, which
  wins where both are given. `slackSink`, `discordSink` and `teamsSink` took
  the function under the first name until now, which was the one place in the
  package where a key meant two different things depending on the import:

  ```diff
   slackSink({
     webhookUrl: process.env.SLACK_WEBHOOK,
  -  screenshotUrl: (report) => report.screenshotUrl,
  +  screenshotUrlFrom: (report) => report.screenshotUrl,
   });
  ```

  A sink already passing a string keeps working unchanged.
  `createGithubIssue`, `createLinearIssue` and `sendReportEmail` gained the
  function form, and `sendReportEmail` gained `screenshotUrl` beside the
  `screenshot` bytes it already took, so the address no longer has to be posted
  through `markdown.screenshotUrl`. All eleven now drop a `data:` address the
  same way, since no service will fetch one, and all eleven now let an option
  set on the sink win over the address `handleReport` stored — `toGithub` and
  `toLinear` had it the other way round.
- **The link to the full report takes the same pair of shapes** (#69's shape,
  applied to the one option it had missed). `slackSink`, `discordSink` and
  `teamsSink` took a function of the report under `reportUrl`, which is the
  name every other address in the package uses for a plain string. `reportUrl`
  is now that string — the address you already have — and `reportUrlFrom` is
  the function, winning where both are given:

  ```diff
   slackSink({
     webhookUrl: process.env.SLACK_WEBHOOK,
  -  reportUrl: (report) => `https://app.acme.com/reports/${idOf(report)}`,
  +  reportUrlFrom: (report) => `https://app.acme.com/reports/${idOf(report)}`,
   });
  ```

  There is no alias: 1.0 is where a rename like this is free, and after it a
  rename costs a major version. `examples/inbox` passes the function and moved
  with it.

### Fixed

- Every table on the documentation pages sits in a focusable, named scroll
  region, so a table wider than its column can be scrolled from the keyboard;
  the browser audit in CI caught the migration table on the changelog page.
- **The offline queue delivers signed** (#98). `createQueue` had no `sign`
  seam, so the script tag's own auto-mount built `createQueue({ endpoint })`
  even with `data-sign-key` set: a report that went through the queue arrived
  without `X-Bugbottle-Signature`, and a `handleReport` with
  `signature.require` refused exactly the reports the queue exists to save.
  The README presented that as a design decision — "signing and queueing do
  not go together; pick one per endpoint" — and it was not one; the WordPress
  plugin had to work around it with a `fetch` wrapper (shipped in its 0.6.1,
  and now removable).

  `createQueue({ endpoint, headers, sign })` takes the same signer
  `sendReport` takes and signs the serialised body **at delivery time**, once
  per attempt rather than once per report. That is the part that matters: a
  signature carries the timestamp it was made at, the server checks it against
  a skew window of minutes, and a report signed while the network was down
  would be hours stale by the time it left. Every attempt — including every
  retry after a backoff — signs the bytes it is about to send with a fresh
  timestamp. A signer that throws leaves the report queued and schedules the
  retry, like any other failed delivery.

  The auto-mount passes the signer whenever `data-sign-key` is set, so the
  script tag needs no wiring. `mountBugbottle` cannot: it is handed a queue
  that is already built, so a signed endpoint needs `sign` given to
  `createQueue` as well as to the panel — the README says so where the
  "pick one" paragraph used to be. A queue built without `sign` posts
  unsigned, exactly as before.

  `bugbottle/queue` 1539 → 1565 bytes gzipped against its 1600 budget, and the
  two script-tag builds about fifty bytes each.

### Removed

- **`SendOptions.onFailure`** (#63). Rename it to `onError`: same signature,
  same contract, awaited before the error reaches the caller.
- **`QueueOptions.maxItems`** (#64). Rename it to `maxEntries`, which is what
  the console buffer, the breadcrumbs and the network log call the same cap:
  same meaning, same default of five, oldest evicted first.
- **The thirteen vendor-first `SLACK_MAX_*` and `DISCORD_MAX_*` limits** (#65).
  The rename is mechanical, and nobody has to read a value to make it:
  `<VENDOR>_MAX_<REST>` becomes `MAX_<VENDOR>_<REST>`, so `SLACK_MAX_TEXT` is
  `MAX_SLACK_TEXT` and `DISCORD_MAX_EMBED_TITLE` is `MAX_DISCORD_EMBED_TITLE`.
- **`rateLimit.rateLimitStore`, `dedupe.dedupeStore` and
  `signature.replayStore`** (#66). All three are `store` now — inside the
  option object the vendor prefix said nothing the key did not. The store
  contracts are unchanged, and `HandleReportOptions.store`, the top-level one
  that persists a report, is a different option and was never touched.
- **`SendReportWebhookOptions.url`** (#67). Rename it to `endpoint`, the word
  everything else in the package uses for somewhere it POSTs a report.
  `toWebhook` takes the same options object and migrates the same way; a
  vendor's own address keeps the vendor's own word, so `webhookUrl`, `host`,
  `site` and `dsn` are unchanged.
- **The server validators and `toMarkdown` are off the `bugbottle` entry**
  (#68). Import them from `bugbottle/server`, which has re-exported every one
  of them all along — the functions are identical and only the path changes.
  They are what a receiving server does with a report that has arrived, and the
  core entry is what a reader opens to learn what the browser half is; fourteen
  server names in that list said the opposite. `REPORT_TYPES` and
  `isReportType` stay on `bugbottle`, because the panel and the adapters build
  the type radiogroup out of them. They were tree-shaken before, so no bundle
  gets smaller: the core measured 1540 bytes gzipped before the change and
  1543 after, which is the compressor, not the code.

## 0.15.0 — 2026-09-08

The observable release. `handleReport` says what it decided: `onDecision`
fires once per request with the status, one of eleven reason words, the
address the rate limit keyed on and the report's id, routed through the one
way out of the handler so no answer can skip it; the inbox example prints an
audit line from it and answers `/metrics` in OpenMetrics text behind its
password. Nothing moves under `prefers-reduced-motion`, and both audits now
read every transition and animation duration to prove it. The landing pages
caught up with the library: the eleven places a report can land, the queue
and its quota story, the privacy checklist, the theme playground and the
inbox. No public API changed shape.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 1.4 kB,
`bugbottle/react` 5.7 kB, `bugbottle/vue` 5.8 kB, `bugbottle/svelte` 5.6 kB,
`bugbottle/solid` 5.7 kB, `bugbottle/ui` 11.6 kB, `bugbottle/annotate` 1.4 kB,
`bugbottle/breadcrumbs` 1.3 kB, `bugbottle/network` 1.2 kB, `bugbottle/perf`
1.3 kB, `bugbottle/queue` 1.5 kB, `bugbottle/queue-idb` 0.7 kB,
`bugbottle/triggers` 1.3 kB, `bugbottle/shake` 0.7 kB, `bugbottle/sign` 0.4 kB,
`bugbottle/rrweb` 0.7 kB, `bugbottle/locales-extra` 4.7 kB,
`dist/bugbottle.js` 24.6 kB, `dist/bugbottle.slim.js` 21.0 kB,
`bugbottle/server` validators 0.6 kB.

### Changed

- **`prefers-reduced-motion: reduce` is honoured everywhere, and audited**
  (#96). The panel's stylesheet already switched transitions and animations
  off; the block now also names `:host` and the pseudo-elements, which `*`
  never matched, and turns `scroll-behavior` off with them, since a smooth
  scroll is motion no transition property describes. On the landing pages the
  scroll to the rendered payload jumps instead of gliding when the reader asked
  for stillness — CSS cannot reach a scroll a script asks for, so `site/demo.js`
  reads the media query for it, next to the reveal it already switched off.
  Every state change still happens; none of them takes time.
  Both accessibility audits gained the state: `scripts/a11y-audit.mjs` runs axe
  over the panel with the feature emulated (ten states now, not nine) and then
  reads every computed `transition-duration` and `animation-duration` back out
  of the shadow root, and `scripts/a11y-site.mjs` does the same for the landing
  page and a documentation page (thirty page-and-scheme runs, not twenty-six).
  The shared walker is `scripts/motionless.mjs`; it descends into open shadow
  roots, so the demo's panel is covered where it ships, and it fails on a
  document that still scrolls smoothly.

### Added

- **`onDecision`: one hook per request saying what `handleReport` decided and
  why** (#94). An endpoint that refuses a report says so to the browser and to
  nobody else; the hook is called once per request with
  `{ id?, status, reason, address, fingerprint?, at }`, so an audit line or a
  metric costs no response parsing. The `reason` is one closed set of eleven
  words — `stored`, `accepted`, `duplicate`, `not-post`, `rate-limited`,
  `unauthorised`, `too-large`, `timeout`, `bad-signature`, `invalid`, `error` —
  and they are the handler's real answers rather than a catalogue of HTTP.
  Every `respond` inside `handleReport` now goes through one `decide` function,
  which is what says a status added later cannot skip the hook; the CORS
  preflight is the one request it says nothing about, because it decides
  nothing about a report. A custom `respond`'s status is read back off the
  response it built, so a `204` is logged as `204`. `address` is the caller as
  `trustProxy` resolves it, which is the same address the rate limit counted
  against, and `fingerprint` is there once there is a valid report to
  fingerprint. A decision deliberately carries no message, no contact line and
  no picture: an audit line is written where logs are kept and shipped where
  logs are shipped. A hook that throws reaches `onError` and changes no answer.
  `examples/inbox` prints one JSON line per decision behind `AUDIT_LOG=1`.
  Sixteen tests, one per answer; the validator-only `bugbottle/server` bundle
  is unmoved at 584 bytes, since none of this is on a validator's path.

- **`examples/inbox` exposes `/metrics` in OpenMetrics text** (#95), fed by
  `onDecision` and behind the same password as the rest of the inbox.
  `bugbottle_decisions_total{reason="…"}` is one series per reason word, all
  eleven present from the first scrape so `rate()` reads the first refusal as a
  change rather than as a new series; `bugbottle_reports_stored` and
  `bugbottle_last_report_timestamp_seconds` come from the in-memory index, so a
  scrape reads no file and walks no directory. `time() -
  bugbottle_last_report_timestamp_seconds` is the age of the newest report,
  which is the alert worth writing: an endpoint that has quietly stopped
  receiving looks exactly like a quiet week. The counters live in memory and
  reset with the process, which is what a counter is and what keeps this an
  example with no dependency. The body a socket refuses at four megabytes never
  reaches `handleReport`, so the example counts that `too-large` itself.
  Deliberately no `bugbottle_reports_bytes`: the index carries no sizes, and
  summing them would be two `stat` calls per report on every scrape. The
  library is untouched — this is the example, its README's new *Scrape it*
  section with a Prometheus job, and three tests.


### Documentation

- A third content pass over the two landing pages, which still described the
  0.6 library. Both now carry a band naming all eleven places a report can
  land, linking the sinks table in the documentation; the "what it does" list
  gains the offline queue and what it does when the storage quota runs out,
  and the privacy checklist; the install section points at `examples/inbox`,
  one container and one password; and the branding item links the theme
  playground. The version line and the size table are untouched — they are
  stamped at release. `site/README.md` gains "The sections of the landing
  pages", which writes down the order, the alternating grounds and the rule
  that the eleven sink names follow the README's own table.

## 0.14.0 — 2026-09-08

The accountable release. The rate limit used to key on the first entry of
`X-Forwarded-For`, which is the one the caller writes, so a fresh header bought
a fresh allowance; `trustProxy` now says which address to believe, the Express
adapter and the inbox pass the socket in, and the default trusts no header at
all. `fileStore` gained `maxAgeDays` and `prune()`, the inbox runs it hourly
from `RETENTION_DAYS`, and a privacy checklist — in English on the docs and in
Danish at /da/privatliv/ — lists every field of a report, whether it is on by
default, whether it can hold personal data, the switch that turns it off and
where it ends up, with a test that a new field cannot be left off the list.
The panel now holds up under Windows High Contrast, proved by two more audit
states and a pixel check.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 1.4 kB,
`bugbottle/react` 5.7 kB, `bugbottle/vue` 5.8 kB, `bugbottle/svelte` 5.6 kB,
`bugbottle/solid` 5.7 kB, `bugbottle/ui` 11.6 kB, `bugbottle/annotate` 1.4 kB,
`bugbottle/breadcrumbs` 1.3 kB, `bugbottle/network` 1.2 kB, `bugbottle/perf`
1.3 kB, `bugbottle/queue` 1.5 kB, `bugbottle/queue-idb` 0.7 kB,
`bugbottle/triggers` 1.3 kB, `bugbottle/shake` 0.7 kB, `bugbottle/sign` 0.4 kB,
`bugbottle/rrweb` 0.7 kB, `bugbottle/locales-extra` 4.7 kB,
`dist/bugbottle.js` 24.6 kB, `dist/bugbottle.slim.js` 21.0 kB,
`bugbottle/server` validators 0.6 kB.

### Changed

- **`handleReport` no longer reads `X-Forwarded-For` or `CF-Connecting-IP` by
  default.** The rate-limit key was the first entry of `X-Forwarded-For` —
  the entry furthest from the proxy and so the one the caller writes — which
  meant a client varying one header got a fresh allowance every request. The
  key is now the connection address, handed in as `remoteAddress`, and a
  forwarding header names the caller only when `trustProxy` says it may (#90).
  Deployments behind a proxy that relied on the old behaviour should set
  `trustProxy: true`; the honest sentence about which way to be wrong is in
  the README.

### Added

- Retention on `fileStore` (#89). `maxAgeDays` is how long a report is kept and
  `prune()` is what applies it: everything that arrived longer ago than that is
  deleted first, then everything over `maxReports`, JSON and picture together,
  and the number it answers with is how many reports went. Off by default —
  how long you may keep somebody's screenshot is a question about the promise
  you made them, not one a library can answer — and scheduled by nobody, since
  a library owning a timer is a library that keeps a process alive. It is safe
  beside a concurrent `store`, its first call walks the directory so what an
  earlier run left behind is pruned too, a report whose arrival time cannot be
  parsed is left for the cap rather than deleted on a guess, and a file this
  store did not name is never touched: a directory that also holds a note, a
  backup or an export keeps all three.
- `examples/inbox` runs `prune()` at start and once an hour, behind
  `RETENTION_DAYS` (unset, so off). The cap runs on every write, but only a
  schedule empties an inbox nobody is posting to. Its README says what is
  deleted when, `.env.example` and `compose.yml` carry the variable.
- `trustProxy` on `handleReport`: `false` (the default) counts the connection
  address, `true` the last entry of `X-Forwarded-For`, `{ hops: n }` n entries
  in from the right, and `{ header: "CF-Connecting-IP" }` a header the
  platform writes itself. A chain shorter than `hops` falls back to the
  connection rather than reaching further left (#90).
- `remoteAddress` on `handleReport`, the address the runtime saw. A web
  `Request` has none; `expressHandler` now passes `req.socket.remoteAddress`
  and the inbox example passes the same socket (#90).
- `clientAddress(request, remoteAddress, trustProxy)` exported from
  `bugbottle/server`, so a handler that keys on something else can resolve the
  address the same way. A `rateLimit.key` of your own is handed it as a second
  argument (#90).
- `TRUST_PROXY` in the inbox example, which also forwards the one header the
  setting names and nothing else (#90).

### Fixed

- The panel survives Windows High Contrast (#91). Under `forced-colors:
  active` the browser replaces every used colour with one from the reporter's
  palette, so `--bb-*` stops being read and anything that was only a colour
  disappeared: the trigger and the send button lost the background that was
  their whole shape, and the selected report type, the active drawing tool and
  the armed element picker lost the accent that said which one they were. The
  stylesheet now ends with a `@media (forced-colors: active)` block that says
  those things in system colours instead — `ButtonText` for the two missing
  edges, `Highlight` and `HighlightText` for the three selected states,
  `Highlight` for the focus ring, `GrayText` for a disabled action, since
  forced colours do not dim an opacity. It is last in the sheet because every
  rule in it has the same weight as the one it replaces. `forced-color-adjust:
  none` appears three times: on the attached picture and on the annotator
  canvas, where a mark's colour is the mark, and on the selected state, because
  Chrome paints a `Canvas`-coloured backplate behind text in forced colours and
  a `HighlightText` label on a `Highlight` fill came out white on white — the
  word vanished while axe reported the button as passing. Nothing about the
  reporter's palette is overridden: every colour in that rule is a system
  colour.
- `scripts/a11y-audit.mjs` audits nine states rather than seven: the panel and
  the picture editor again with `forced-colors` emulated through CDP, which is
  used directly because `page.emulateMediaFeatures` keeps an allowlist that
  refuses the feature Chrome has emulated for years. The forced run then ends
  where axe cannot go — a screenshot, and four measurements taken from its
  pixels: the trigger has an edge against the page, the selected type differs
  from the two beside it, its label crosses nineteen colour edges rather than
  the two a blank backplate would, and the focus ring differs from the panel
  behind it. `npm run a11y` fails on any of them.
- `bugbottle/ui` 11 486 → 11 595 bytes gzipped, `dist/bugbottle.js` 24 441 →
  24 556 and `dist/bugbottle.slim.js` 20 896 → 21 003. No budget moved: the
  block is about 110 bytes gzipped in each of them.

### Documentation

- A privacy checklist, in English and Danish (#92). `## A privacy checklist` in
  the README, on the site as [/docs/privacy-checklist/](https://bugbottle.dev/docs/privacy-checklist/)
  and [/da/privatliv/](https://bugbottle.dev/da/privatliv/), answers the three
  questions an EU site owner has to answer before a lawyer asks them: what is
  collected, where does it go, and how long is it kept. Every field of a report
  gets a row — on by default, whether it can hold personal data, the switch
  that turns it off, and where it ends up — followed by retention, the "no
  cookies, no fingerprinting, no third party" facts with the site's CSP as the
  proof, and a policy paragraph to adapt. Not legal advice, and it says so.
- The two pages are one page in two languages and say so: `hreflang` alternates
  both ways in the sitemap and in each head, the third such pair on the site.
  `tests/privacy-checklist.test.ts` compares the field column of both tables
  with the properties of the generated report schema, so a new field cannot be
  added to `BugReport` and left out of either checklist.

## 0.13.0 — 2026-09-08

The reviewed release. A fresh-context review read everything since 0.9.0 and
found six defects, all fixed with tests written first: an SMTP address header
that encoded the address itself, a file-store index that two early reports
could race, a Teams card that a long picture address pushed over the cap, an
inbox preflight that answered 401, a language tag of `__proto__` that threw at
mount, and a page-script hook that a renamed heading could silently detach.
Its follow-ups landed too: `requireTls` and a write deadline on the SMTP
client, the legacy Teams webhook's 200-with-error, clipping on code points, a
one-function queue storage seam, `versionchange` in the IndexedDB storage,
`fileStore.refresh()`. The OpenAPI document now passes a real linter, which
runs in CI, and every CORS answer carries `Vary: Origin`. New since 0.12.0:
`bugbottle/queue-idb` and the queue's quota fallback — a report that does not
fit is stored without its picture and says so in `notes`, rather than being
lost — plus the table of eleven sinks and the inbox's notifications.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 1.4 kB,
`bugbottle/react` 5.7 kB, `bugbottle/vue` 5.8 kB, `bugbottle/svelte` 5.6 kB,
`bugbottle/solid` 5.7 kB, `bugbottle/ui` 11.5 kB, `bugbottle/annotate` 1.4 kB,
`bugbottle/breadcrumbs` 1.3 kB, `bugbottle/network` 1.2 kB, `bugbottle/perf`
1.3 kB, `bugbottle/queue` 1.5 kB, `bugbottle/queue-idb` 0.7 kB,
`bugbottle/triggers` 1.3 kB, `bugbottle/shake` 0.7 kB, `bugbottle/sign` 0.4 kB,
`bugbottle/rrweb` 0.7 kB, `bugbottle/locales-extra` 4.7 kB,
`dist/bugbottle.js` 24.4 kB, `dist/bugbottle.slim.js` 20.9 kB,
`bugbottle/server` validators 0.6 kB.

### Added

- The offline queue survives a full `localStorage` (#85). A refused write used
  to turn the queue memory-only and that was all: the report reached storage
  nowhere and was gone on the next reload, which is what an outage ends in. It
  now costs the picture instead — the queue writes the reports again without
  their screenshots, and leaves a line in the new `notes` field of each one it
  took a picture from, so the receiver can tell "no screenshot was taken" from
  "a screenshot was taken and would not fit". `notes` is validated server-side
  by `normaliseNotes` (at most five, 200 characters each, `MAX_NOTES` and
  `MAX_NOTE_LENGTH`), carried in `ValidatedReport` and the JSON Schema, and
  printed above the evidence by `toMarkdown`.
- `createQueue({ storage })`: the storage is a seam now, `localStorage` its
  default, and `QueueStorage` is two functions — `read`, and an `update` that
  reads, changes and writes back as one step and throws when the write was
  refused. Either may answer with a promise.
- `bugbottle/queue-idb`, the twentieth entry point: `createIdbStorage()` keeps
  the queue in IndexedDB, which has room for a 2 MB report with its picture,
  and whose read-write transactions are ordered across tabs — so the claim that
  keeps two tabs from delivering one report twice is decided by the database
  rather than by whoever wrote last. 654 bytes gzipped, and only in the bundles
  that ask for it.
- `bugbottle/openapi.json`, an OpenAPI 3.1 description of the report endpoint,
  generated by `scripts/build-openapi.ts` into `dist/openapi.json` and served
  at [bugbottle.dev/schema/openapi.json](https://bugbottle.dev/schema/openapi.json)
  beside the report schema. Nothing in it is typed out twice: the request body
  is the generated report schema with its `maxLength`/`maxItems` ceilings
  intact — 3.1 is a superset of JSON Schema 2020-12, so only the `$ref` targets
  move — and the responses are the ones `handleReport` gives, `201 { id }`,
  `202 {}` without a store, `200` for a duplicate and the seven `{ error }`
  refusals. The `X-Bugbottle-Signature` header is an `apiKey` scheme described
  honestly as spam deterrence rather than authentication. `tests/openapi.test.ts`
  exercises the handler for every status it can answer and fails when one is
  answered but not documented, or documented but never answered (#86).

### Documentation

- A table at the top of the README's "Sending it somewhere" answers, for all
  eleven sinks at once, the questions the prose only answers one sink at a
  time: what you need, whether the picture travels with the report or is linked
  from storage you arranged, whether a self-hosted instance works, what one
  report becomes, and what a server bundle importing only that sink weighs.
  Measured on 8 September 2026 with the recipe CI uses, and reproducible with
  the new `scripts/measure-sinks.mjs` — dev-only, because it packs the package
  and installs the tarball. `tests/exports.test.ts` now fails when a sink has
  no row or a row names an export that `bugbottle/server` does not have, so the
  twelfth sink cannot land with the table describing eleven (#83).

### Changed

- **Pre-1.0 shape change:** `QueueStorage` is one function, not two. `read` was
  required of every storage and called from nowhere — every path through the
  queue goes through `update`, because anything read outside a
  read-modify-write is stale the moment another tab commits. A custom storage
  written as an object literal with a `read` on it is now a type error: delete
  the method, nothing called it. `createIdbStorage()` has lost its own (#88).
- Nothing is dropped from a queued report on a guess about the quota any more.
  The 1 MB ceiling that took the screenshot off every large report before it
  was ever stored is gone; a picture that fits is kept whole, and the storage
  is what says whether it fits.
- Sizes after the #88 review fixes, all inside the budgets they already had:
  `bugbottle/queue` 1553 → 1545 (the seam lost a method), `bugbottle/queue-idb`
  654 → 661 (`versionchange`), `bugbottle/ui` 11 485 → 11 486,
  `dist/bugbottle.js` 24 424 → 24 441 and `dist/bugbottle.slim.js`
  20 886 → 20 896. The validator-only server bundle is 584 bytes, unmoved.
- Sizes: `bugbottle/queue` 1313 → 1553 bytes gzipped (budget 1330 → 1600),
  `dist/bugbottle.js` 24 238 → 24 424 (budget 24576 → 25088) and
  `dist/bugbottle.slim.js` 20 650 → 20 886 (budget 20992 → 21504). The seam
  bridges a synchronous storage and an asynchronous one in one code path and
  chains its commits, and the refusal is answered rather than surrendered to;
  the issue hoped for a hundred bytes and it cost two hundred and forty.

### Fixed

- `dist/openapi.json` did not survive an OpenAPI linter (#87). Redocly reported
  two errors and a warning on the file whose whole purpose is to be read by
  other people's tooling: `$id` at the root, which the 3.1 meta-schema does not
  permit there however legal the keyword is one level down; no `servers` at
  all; and an OPTIONS operation with no refusal documented. The identifier is
  `x-bugbottle-id` now, the servers list is the one honest entry — `/`, the
  reader's own origin, because there is no bugbottle service to point at — and
  the preflight documents the `405 { error }` it answers when `cors` is off
  beside the `204` it answers when it is on. Every answer that allows an origin
  now documents `Access-Control-Allow-Origin` and `Vary` as well, on the
  preflight and on the POST alike. `tests/openapi.test.ts` compares the
  handler's answers with the document *per operation* rather than pooled across
  the path item, so an operation can no longer be credited with a status only
  its neighbour answers, and CI runs `@redocly/cli@2.51.2` over the built file
  after the build so none of it can regress.
- `handleReport` sent `Access-Control-Allow-Origin` without `Vary: Origin`. A
  shared cache in front of the endpoint could store one origin's answer and
  hand it to the next, which for a single-origin `cors` is the wrong header on
  a cross-origin reply and for `cors: true` is a header that outlives the
  configuration that produced it. The two now travel together on every answer,
  refusals and preflight included, and a `respond` of your own that already
  varies on something keeps it — `Origin` is appended, not substituted.
- `fileStore` listed reports that were no longer there. The index is built by
  one walk and kept up to date by this process's own writes, so a report
  deleted from outside stayed in every listing until the process restarted —
  a link that answered 404 each time somebody tried it. An entry `read` finds
  nothing behind is dropped from the index then and there, and the new
  `refresh()` walks the directory again on purpose, in place, for the backup
  restored underneath an inbox (#88).
- The theme playground printed a block that pinned every colour it had read off
  the panel and `scheme` as it happened to be, so a reader who copied it
  verbatim shipped a panel that ignores `prefers-color-scheme` — the one
  setting whose default is to follow the browser. It prints the keys the reader
  moved and nothing else, and says so when nothing has moved. The site audit
  checks it, since a browser is the only place the playground runs (#88).
- The inbox example took a `NOTIFY_SMTP_PORT` that is not a number. `Number`
  answers a typo with `NaN`, which is not nullish, so the sink's own default
  never applied and the port reached it as `NaN` — the inbox came up looking
  healthy and failed on the first report, hours after the mistake was made. It
  refuses to start now, which is while somebody is still looking at the
  configuration (#88).
- `createIdbStorage()` went memory-only for the life of the page when another
  tab upgraded the database. Nothing listened for `versionchange`, so the
  connection was closed under it and every transaction after that threw — and
  until the browser gave up, this tab was also what blocked the other tab's
  upgrade. It now closes the connection when asked and opens a fresh one on the
  next write (#88).
- The chat sinks left half a character behind when they clipped. `clip` sliced
  UTF-16 units, so a message ending on an emoji or an ideograph outside the
  basic plane lost one of its two units and Slack, Discord and Teams all drew
  the leftover as `�`. It counts characters now. The Teams byte budget
  counts them the same way where it works out how much to ask for: a limit in
  units is a limit a message of emoji is already under, and the loop that
  clipped it would never have ended (#88).
- `teamsSink` read a refusal as a delivery on a legacy connector webhook. Those
  are retired but still in use, and they answer `200` with `Webhook message
  delivery failed with error: …` in the body where a Workflows webhook answers
  202 with nothing — so the status check passed and the report was gone without
  a line in any log. A 200 whose body opens with that phrase is a `SinkError`
  now, carrying the reason (#88).
- `teamsSink` now checks `webhookUrl` with `new URL` when the sink is built. A
  mistyped address used to reach `fetch` and come back as a failure whose
  message quotes the URL — which is the credential — into a log, on the first
  report rather than where it was configured (#88).
- `smtpSink` sent the whole report in the clear when something on the path
  stripped STARTTLS out of the EHLO reply. That reply is not authenticated, so
  a downgrade is a line removed from a list; the only guard was the refusal to
  authenticate over an unencrypted connection, which never fires for an account
  with no `user` and `pass`. The new `requireTls` gives up before MAIL FROM —
  true by default on the submission port (587) and wherever credentials are
  set, false for the relay on the same machine, and `allowInsecureAuth` lowers
  the default with it (#88).
- `smtpSink` could hang for ever on a server that stopped reading. Every read
  had a deadline and no write had one, so the message body — the one write big
  enough to fill a TCP window — waited on a socket that would never drain,
  taking a direct caller of `sendReportSmtp` with it. `timeoutMs` now bounds
  the writes as well as the reads (#88).
- `smtpSink` sent an unroutable `From` when the address carried a non-ASCII
  display name. `foldHeader` encoded the whole value as one RFC 2047 word, so
  `Bjørn Hansen <bugs@example.com>` reached the wire as `=?UTF-8?B?…?=` and
  nothing after it: an encoded word is a phrase, never an address, and a mail
  server has nothing left to route or reply to. Only the display name is
  encoded now, and the `<local@domain>` half travels as it arrived — for every
  address in a list, split on the commas that separate addresses and not on the
  ones inside a quoted name. The same fix bounds an encoded word at the
  seventy-five characters RFC 2047 §2 allows: a Danish subject used to become
  one word of a hundred and sixty, which a decoder is entitled to ignore, and
  is now several that fold onto lines that fit.
- `fileStore` lost a report when two arrived before the directory had been
  walked. Both writes found no index, both walked, and the walk that finished
  second became the index — so the first report was on disk, readable by id,
  and in no listing until the process restarted. The walk is shared now, and
  once there is an index it is added to and spliced from rather than replaced,
  so a write holding it across an `await` is still holding the live one when
  the cap deletes something underneath it.
- `fileStore` built the front half of a file name out of the report's own
  `receivedAt`. `handleReport` sets that field itself, but `store` is a
  function anybody can call, and `../..` in it would have written the report
  outside the directory — the same hole the id is checked against the UUID
  shape to close. Only the characters a timestamp is made of survive it now.
- `teamsSink` could post a card over the 28 kB Teams refuses above. The budget
  dropped the console, then the facts, then clipped the message — and none of
  those touches the screenshot address or the button, so a stored picture
  behind a very long signed URL spent the reporter's whole message and left the
  card over the cap regardless, which Teams then refused outright. An address
  cannot be clipped, so it is now measured against the floor — the same card
  with no console, no facts and no message — and dropped when even that will
  not fit. A card that arrives without its picture says what went wrong; a card
  that is refused says nothing.
- CI's `browser` job has a fifteen-minute ceiling. A Chrome that never answers
  used to run into GitHub's own six-hour default, which is a wedged runner
  holding the queue rather than a red tick; a green run takes about three
  minutes.
- The README said "ten server-side sinks" in its opening summary where the
  table below it lists eleven, and `docs/roadmap.md` still gave
  `bugbottle/perf` a 1.25 kB budget where CI enforces 1536 bytes.
- The inbox example's `ALLOWED_ORIGIN` did nothing a browser could use. The
  preflight fell past the report route into the password check and came back a
  401, so the report was never sent; and the answer to the POST was written
  with a hard-coded `Content-Type` and none of the headers `handleReport` had
  put on it, so even a request that got through arrived without
  `Access-Control-Allow-Origin` and the browser discarded it. `OPTIONS` is
  handled by `handleReport` now, before the password, and the response's own
  headers are the ones written.
- `resolveLocale` answered `"__proto__"` with `Object.prototype` and
  `"constructor"` with a function. The tag is usually `navigator.language`, but
  it is just as often a `?lang=` off the URL, and a plain bracket read finds
  every inherited property of the map. Neither answer is a `Locale`, so the
  panel threw on `locale.ui.title` at mount instead of falling back to English.
  The lookup is `Object.hasOwn` now.
- `scripts/build-docs.mjs` lost the theme playground silently when its README
  heading was renamed. The page script is keyed on the slug and
  `PAGE_SCRIPTS[slug] ?? []` answers a renamed one with nothing — the build
  green, the section still on the site, the editor gone, and the theme table's
  own check silent because that one only runs on the page it is attached to. A
  hook with no page to hook onto is a build failure, like an ungrouped section.

## 0.12.0 — 2026-09-08

The self-hosted release. Two things that used to need a service now need
only what you already have: `smtpSink` speaks SMTP itself — EHLO, STARTTLS,
AUTH PLAIN or LOGIN, one folded and dot-stuffed message, a deadline on every
phase — so any mail account is an email sink; and `fileStore` is the inbox
example's storage lifted into `bugbottle/server` — a JSON file per report with
the PNG beside it, atomic writes, ids checked before a path is built, an
oldest-first cap — for the deployments that want a directory before they want
a database. CI now asserts from both sides that the validator-only server
bundle carries neither DOM nor disk. One fix: the site demo imported
`toMarkdown` from the server entry, which the file store made Node-only, and
the browser audit in CI caught the broken demo on the merge.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 1.4 kB,
`bugbottle/react` 5.7 kB, `bugbottle/vue` 5.8 kB, `bugbottle/svelte` 5.6 kB,
`bugbottle/solid` 5.7 kB, `bugbottle/ui` 11.5 kB, `bugbottle/annotate` 1.4 kB,
`bugbottle/breadcrumbs` 1.3 kB, `bugbottle/network` 1.2 kB, `bugbottle/perf`
1.3 kB, `bugbottle/queue` 1.3 kB, `bugbottle/triggers` 1.3 kB,
`bugbottle/shake` 0.7 kB, `bugbottle/sign` 0.4 kB, `bugbottle/rrweb` 0.7 kB,
`bugbottle/locales-extra` 4.7 kB, `dist/bugbottle.js` 24.2 kB,
`dist/bugbottle.slim.js` 20.6 kB, `bugbottle/server` validators 0.6 kB.

### Fixed

- The landing-page demo imported `toMarkdown` from the server entry, which since
  `fileStore` re-exports a module that imports `node:fs`; a browser then tried to
  fetch `node:fs/promises` and the CSP refused it, so the demo panel broke on the
  live site until the demo imported `dist/markdown.js` directly. The browser audit
  in CI caught it on the merge, which is what it is for.

### Added

- `smtpSink({ host, port?, secure?, user?, pass?, allowInsecureAuth?, from, to,
  subject?, replyTo?, clientName?, timeoutMs?, tls?, locale?, screenshotUrl?,
  screenshotUrlFrom?, markdown? })` in `bugbottle/server`: email through any
  SMTP account, without Resend and without a dependency. The eleventh sink and
  the only one that speaks a protocol rather than an HTTP API — a small client
  on `node:net` and `node:tls` that does EHLO, STARTTLS when the server offers
  it, AUTH PLAIN or LOGIN, one message and QUIT, with a deadline on every phase
  rather than on the conversation as a whole. One report is one connection: no
  pooling, no pipelining, no queue, no attachments, because the retrying
  belongs to whoever runs the endpoint and that is what keeps it a single file.
  The message is RFC 5322 with folded headers and dot-stuffing, a
  `multipart/alternative` of the report as `text/plain` and the same report as
  `text/markdown`, quoted-printable when it is not pure ASCII so the body stays
  readable on the wire, and the `Reply-To` taken from the report's `contact`
  line exactly as the Resend sink takes it. A refusal throws `SinkError`
  carrying the server's own reply code and line; a failure with no reply — a
  hang, a refused connection — throws one with `SMTP_NO_REPLY` (`0`).
  **AUTH is refused over a connection that is not encrypted** unless
  `allowInsecureAuth: true` is set, because base64 is not encryption and every
  hop to the mail server could read the password; credentials never reach an
  error message or a log. `sendReportSmtp`, `buildMessage`, `foldHeader` and
  `dotStuff` are exported beside the factory. Nothing in the core entry imports
  it, and the validator-only `bugbottle/server` bundle is still 584 bytes
  gzipped with no `node:` module in it. Tested against a scripted SMTP server
  on `node:net`, the STARTTLS upgrade included: the test builds a self-signed
  certificate in DER from a `node:crypto` key pair rather than checking a
  private key into the repository (#81).
- `examples/inbox` tells somebody when a report arrives, from environment
  variables alone: `NOTIFY_WEBHOOK` posts through `slackSink`, `discordSink`,
  `teamsSink` or `sendReportWebhook` — chosen by the URL's host, or by
  `NOTIFY_KIND` when the host says nothing — and `NOTIFY_SMTP_HOST` with
  `_PORT`, `_USER`, `_PASS`, `_FROM` and `_TO` mails through `smtpSink`. The
  example adds no delivery code of its own, only the two addresses a sink
  cannot work out for itself: the report's detail page under `PUBLIC_URL` and
  its picture at `/r/<id>.png`, both behind the inbox password. The sinks run
  after the report is on disk, exactly as `handleReport` runs them, so a
  webhook revoked last week is a line on stderr and still a 201 for the
  reporter. Nothing is sent when neither variable is set (#84).

## 0.11.0 — 2026-09-08

The tested release. A seeded fuzzer now throws thousands of hostile bodies at
the validators, the scrubber, the Markdown and `handleReport` on every test
run, and it earned its keep on the first day: a replay nested a few thousand
levels deep overflowed the stack and answered 500, and a `__proto__` key in a
replay event or a storage snapshot reached the prototype setter. Both are
fixed with named regressions. Beside it: a Microsoft Teams sink through a
Workflows webhook (the tenth), a JSON Feed and an Atom feed on the inbox
example, and three things on the site — the demo draws a picture of itself so
the annotator can be tried, a theme playground restyles a live panel and
prints the code, and a Danish getting-started page. No library API changed.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 1.4 kB,
`bugbottle/react` 5.7 kB, `bugbottle/vue` 5.8 kB, `bugbottle/svelte` 5.6 kB,
`bugbottle/solid` 5.7 kB, `bugbottle/ui` 11.5 kB, `bugbottle/annotate` 1.4 kB,
`bugbottle/breadcrumbs` 1.3 kB, `bugbottle/network` 1.2 kB, `bugbottle/perf`
1.3 kB, `bugbottle/queue` 1.3 kB, `bugbottle/triggers` 1.3 kB,
`bugbottle/shake` 0.7 kB, `bugbottle/sign` 0.4 kB, `bugbottle/rrweb` 0.7 kB,
`bugbottle/locales-extra` 4.7 kB, `dist/bugbottle.js` 24.2 kB,
`dist/bugbottle.slim.js` 20.6 kB, `bugbottle/server` validators 0.6 kB.

### Added

- `fileStore({ dir, maxReports?, screenshots? })` in `bugbottle/server`: the
  `store` function `handleReport` takes, backed by a directory. One JSON file
  per report named `<receivedAt>-<id>.json`, the decoded PNG beside it as
  `<id>.png`, and `list()`, `read(id, { screenshot? })` and `remove(id)` for
  whoever builds a page over it. It is the storage `examples/inbox` had grown
  for itself, lifted into the library, and the example now runs on it with its
  fourteen tests unchanged.

  Three things it does that a first attempt does not. Every write goes to a
  temporary name and is renamed into place, so a process killed mid-write
  leaves a `.tmp` file no listing looks at rather than a truncated report or
  half a screenshot. An id reaching `read` or `remove` came out of a URL, so it
  is matched against the shape `crypto.randomUUID()` writes before any path is
  built — there is no normalising afterwards to get wrong. And the picture is
  signature-checked in its bytes before it is written under a `.png` name,
  whatever the caller called it; one that fails is dropped and the report is
  stored without it, because screenshots fail open.

  `maxReports` (2000 by default) deletes the oldest when the directory is over
  it, `0` keeps everything, and `screenshots: false` writes the JSON alone. The
  index is built by one walk of the directory on the first call that needs it
  and kept up to date by every write and delete after that, so a list costs no
  directory walk and a detail page reads one file. It is Node-only —
  `node:fs/promises`, `node:path`, `node:crypto` — and nothing the validators
  reach imports it: the validator-only bundle is still 583 bytes gzipped and
  its minified text still mentions neither `node:fs` nor `readFile`. (#82)

- `teamsSink({ webhookUrl, screenshotUrl?, reportUrl?, buttonText?, fetch? })`
  in `bugbottle/server`: one Adaptive Card per report in a Microsoft Teams
  channel. The tenth sink and the third chat one, built on the same
  `src/sinks/chat.ts` helpers as `slackSink` and `discordSink`. The Office 365
  connector webhooks are retired, so the target is a **Workflows** webhook
  ("post to a channel when a webhook request is received"), which takes a Bot
  Framework message — `{ type: "message", attachments: [{ contentType:
  "application/vnd.microsoft.card.adaptive", content }] }` — rather than the
  card on its own. The card is schema 1.5: a bold title, the message as a
  wrapping `TextBlock`, the facts as a `FactSet`, the last five console entries
  in a monospace `TextBlock`, an `Image` when there is a URL to fetch, a subtle
  line with the time and the selector, and an `Action.OpenUrl` when a
  `reportUrl` is given. No inputs and no `Action.Submit`: a webhook has nowhere
  to send an answer. A `TextBlock` renders a subset of Markdown, so
  `escapeTeams` turns every string into plain text first — emphasis, code,
  links and the line-start list and heading forms — and it runs after the
  clipping, never before, so a clip cannot leave a stray backslash on screen.
  Workflows replies `202 Accepted` with an empty body, so every 2xx is a
  success and anything else is a `SinkError` carrying the status and the body.
  A Workflows message is capped at 28 kB and Teams refuses a larger one rather
  than clipping it, so the card is measured before it is sent: while it is
  over, the console goes first, then the facts from the back, then the
  reporter's own words. No report can reach that cap on its own — every string
  is already clipped by report-core — but a stored screenshot's address is
  whatever your storage hands back, and a long enough one leaves no room.
  `buildTeamsMessage(report, options)` returns the message without sending it.
  Server-only: a `bugbottle/server` bundle that imports only the validators is
  still the same 1025 minified bytes and measures 584 gzipped against a 1024
  budget, the two-byte move being esbuild renaming identifiers across a larger
  module graph rather than a line of the sink reaching the bundle. Schema and
  limits checked on
  2026-09-08 against the Adaptive Cards documentation hub and Microsoft Learn;
  the date is in the file header.
  Closes #78.
- Two feeds in the inbox example, behind the same password as the list:
  `GET /feed.json` is JSON Feed 1.1 and `GET /feed.xml` is Atom, both carrying
  the newest 50 reports with the title, the rendered Markdown as
  `content_text`, the detail URL, the arrival time and the report's type as its
  one tag. A new report can then arrive in a reader, a phone or a Slack RSS app
  without a sink, an account or a webhook. They are behind the password
  because a feed URL travels further than a bookmark and the titles and page
  addresses in it are facts about somebody's application: subscribe with
  `https://inbox:PASSWORD@bugs.example.com/feed.xml`, which every reader worth
  using accepts. The list comes from the in-memory index — no directory walk —
  and only the fifty files that reach the feed are read; the screenshot stays a
  link. Every string in the Atom document is escaped, and the control
  characters XML cannot carry at all are dropped rather than emitted; the tests
  parse the document with a strict XML reader rather than matching substrings.
  Links are absolute, from `Host` and `X-Forwarded-Proto` or from a new
  `PUBLIC_URL`.
  Closes #80.
- A Danish getting-started page on the site, `/da/kom-i-gang/`. The panel
  speaks Danish and the landing page is Danish; the documentation is English
  only, and most of the people who will install this from the owner's network
  are Danish site owners and WordPress users. One page is enough: three routes
  from nothing to a first report — the pinned jsDelivr script tag, the
  WordPress plugin with its real setting names, and a bundler with the React,
  Vue, Svelte or Solid hook — the privacy section in Danish, and links into the
  English reference for everything deeper. It is written as
  `site/da/kom-i-gang.md` and rendered by `scripts/build-docs.mjs` like the two
  comparison pages, linked from the Danish landing page's hero buttons and
  footer, and in `sitemap.xml`. No `hreflang`: `/docs/install/` is the nearest
  English page and it is a different one, so claiming they are the same page in
  two languages would be false. Not in `docs/search.json` either, which is what
  the entry's `indexed: false` says — it is the Danish retelling of pages the
  index already has in English. `scripts/release.mjs` now edits this file too,
  so the script tag keeps naming the current version, and
  `scripts/a11y-site.mjs` audits it in both colour schemes.
  Closes #77.
- A theme playground in the documentation, under "Branding and theme" on
  `/docs/languages-and-branding/`: labelled controls for the primary colour, the
  ground, the ink, the corner radius, the font, the position and the colour
  scheme, restyling a real `bugbottle/ui` panel mounted into the page and
  printing the `mountBugbottle({ theme: ... })` call and the CSS-variable block
  to copy. The panel is mounted with `trigger: false` into an `inert` stage, so
  it is a live component the reader cannot type into, and the theme reaches it
  through `style.setProperty` on the host and its two data attributes rather
  than through an inline stylesheet the site's Content-Security-Policy would
  refuse. `site/playground.js` is vanilla JavaScript loaded by that one page,
  through a new `PAGE_SCRIPTS` hook in `scripts/build-docs.mjs` keyed on the
  slug. The variable names come from the README's own table, which
  `scripts/build-docs.mjs` now reads and writes onto the controls: a control
  naming a `theme` key the table does not list fails the build, so the two
  cannot drift. The README gained that table — the whole `--bb-*` list, which
  was prose until now — and `scripts/a11y-site.mjs` a playground state, with
  four controls moved before axe looks. Nothing in the package changed.
  Closes #76.
- `tests/fuzz.test.ts`: a seeded generator that builds thousands of hostile
  reports — the wrong type at every path, strings past every limit, objects
  nested deeper than a parser likes, null bytes, lone surrogates, `__proto__`
  and `constructor` as keys, arrays where objects go, numbers written as
  strings, NaN and Infinity — and feeds them through every `normalise*`,
  `validateReport`, `collectExtra`, `scrubReport`, `toMarkdown` and
  `handleReport`. It asserts three things and only three: nothing throws,
  every output respects its `MAX_*` limit, and `handleReport` answers with a
  status it chose rather than a 500 it fell into. The generator is hand-rolled
  (no new dependency) and seeded, and a failure prints the seed and the
  iteration, so `FUZZ_SEED=<seed> FUZZ_ITERATIONS=<n>` replays it exactly.
  `FUZZ_ITERATIONS` defaults to 2000, a little over two seconds. It found the
  two defects fixed below, and each of them has a named regression test beside
  it in the same file.
  Closes #79.

### Fixed

- `normaliseReplay` no longer throws on a deeply nested replay event. The walk
  that takes null bytes out of a parsed event recursed once per level, so an
  event nested a couple of thousand deep overflowed the stack — out of a
  validator documented never to throw, and out of `handleReport` as a 500 to a
  reporter who had done nothing wrong. The walk now has a depth of its own
  (200, which is deeper than rrweb nests a DOM snapshot), and a replay past it
  is dropped whole exactly as an oversized one is: the report keeps everything
  else. Surviving `JSON.stringify` was not the guarantee it looked like, since
  that walk spends less stack per level than this one does.
- A `__proto__` key from a parsed body is kept as a key rather than becoming a
  prototype. `JSON.parse` makes it an own property; writing it back with `=`
  reaches the prototype setter instead, so the value was silently lost and,
  where it was an object, the row about to be stored inherited whatever the
  sender had put there. `normaliseReplay`'s null-byte walk and the allow-listed
  `storage.values` both wrote their keys that way and now write a descriptor.
  `collectExtra` was already refusing the name outright and is unchanged.

## 0.10.0 — 2026-09-08

The visible release: the browser audits — axe over the panel and every site
page with the security headers served, and the pixel proof that the blur
destroys what it covers — now run in CI on every push, so what the two
reviewers ran by hand this week runs by itself. The changelog is a page on the
site, the version line on both landing pages points at it, and the inbox
example ships as a container with a compose file and a Dokploy walk-through.
`bugbottle/locales-extra` adds Italian, Polish, Portuguese, Finnish and
Ukrainian as an entry you import on purpose, so the script tags do not grow;
and the panel takes the network log and the timings snapshot as options, the
same way it takes the annotator and the shake gesture. One contrast fix on the
site, found by the audit on its first run.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 1.4 kB,
`bugbottle/react` 5.7 kB, `bugbottle/vue` 5.8 kB, `bugbottle/svelte` 5.6 kB,
`bugbottle/solid` 5.7 kB, `bugbottle/ui` 11.5 kB, `bugbottle/annotate` 1.4 kB,
`bugbottle/breadcrumbs` 1.3 kB, `bugbottle/network` 1.2 kB, `bugbottle/perf`
1.3 kB, `bugbottle/queue` 1.3 kB, `bugbottle/triggers` 1.3 kB,
`bugbottle/shake` 0.7 kB, `bugbottle/sign` 0.4 kB, `bugbottle/rrweb` 0.7 kB,
`bugbottle/locales-extra` 4.7 kB for all five (about 1.1 kB for one),
`dist/bugbottle.js` 24.2 kB, `dist/bugbottle.slim.js` 20.6 kB,
`bugbottle/server` validators 0.6 kB.

### Added

- The demo on bugbottle.dev has a picture, so the annotator can be tried
  without installing anything. `site/demo.js` hands `mountBugbottle` a
  `screenshot` renderer of its own that *draws* a simplified picture of the
  demo section onto a canvas — the header band, a heading, some text bars, the
  button and the code slab, in the page's own colour tokens — and
  `annotate: createAnnotator` from `dist/annotate.js` alongside it. So "Attach
  the drawn picture", "Edit picture", the rectangle, the arrow, the blur and
  Done all work on `/` and `/da/`, and the report still never leaves the
  browser: the canvas export is a `data:` URL, which `img-src 'self' data:`
  already allowed. `html-to-image` is still not loaded on the site and the
  picture is not a capture — both pages say so, and the checkbox and its note
  are relabelled rather than left saying "the picture shows this page as you
  see it now". `scripts/a11y-site.mjs` gained the state that proves it: the
  landing page with the panel open and the editor over the drawn picture, in
  both colour schemes, at zero violations.
  Closes #75.
- Five more languages, in their own entry point: `bugbottle/locales-extra`
  ships Italian, Polish, Portuguese, Finnish and Ukrainian in the same `Locale`
  shape as the eight bundled ones, with every key present and reviewed line by
  line against the English source. A locale is data and data is carried whole,
  so putting them beside the other eight would have made every site that shows
  a panel carry them; here they are imported on purpose. All five weigh about
  4.7 kB gzipped, one of them about 1.1 kB, and nothing in the library imports
  the entry. `resolveLocale` now takes the map to look in as a third argument,
  so `resolveLocale(navigator.language, en, { ...locales, ...localesExtra })`
  reaches them and the default map is unchanged. `pt` is European Portuguese
  and `pt-BR` resolves to it, the way `da-DK` resolves to `da`. Neither script
  tag carries a word of it: `dist/bugbottle.js` moved 65 292 → 65 295 bytes
  minified and `dist/bugbottle.slim.js` 56 251 → 56 254, which is the three
  bytes of the new parameter and nothing else.
  Closes #74.
- The inbox example deploys: `examples/inbox/Dockerfile`, `compose.yml`,
  `.env.example` and `Caddyfile`, plus a "Deploy it" section in its README with
  an eight-line Dokploy walk-through. The image is `node:22-alpine`, runs as
  the `node` user and installs nothing — `package.json`, `dist/` and the two
  files of the example, which is exactly the layout the example's
  `import "bugbottle/server"` self-reference already resolves against, so the
  build context is the repository root. `npm pack`ing the library in would work
  too and was measured against this: it is the same `dist/` carried twice, once
  in the tarball and once unpacked under `node_modules/`, with an `npm install`
  at image build time to do it. The reports live on a named volume at `/data`;
  the password comes from an env file, and compose refuses to start without it,
  the way the server does. The `ports:` block is bound to loopback, because
  basic auth over plain HTTP sends the password in every request.
- `GET /health` on the inbox example: `ok`, public, and deliberately nothing
  else — a platform's check runs before anybody has the password, and a count
  of reports at an address with no password on it would be a fact about
  somebody's application. `HOST` is honoured too, `127.0.0.1` by default and
  `0.0.0.0` in the image, since inside a container the proxy is on the other
  side of the boundary. Closes #73.
- The changelog is a page on the site: `/docs/changelog/`, generated from this
  file by `scripts/build-docs.mjs` in the same run as the documentation and the
  comparison, with the site's typography and the same header and footer. Each
  release is an `<h2>` anchored at its version with hyphens for dots, so
  `/docs/changelog/#0-9-0` is a link anyone can guess; the headings under a
  release carry no id, because a dozen elements answering to `#added` is eleven
  anchors pointing at the wrong place. The list of releases sits above the
  first one, in the ruled column "On this page" uses, and `docs.js` marks the
  release being read. Both landing pages' "Version x.y.z, released …" line now
  links to that release instead of to the raw file on GitHub, and
  `scripts/release.mjs` moves the link with the version it already stamps. The
  page is in the sitemap, dated by this file's last commit, and in the search
  index by release — one entry per version carrying the paragraph under its
  heading, not everything under it, so thirteen releases cannot outrank the
  page that documents whatever was searched for. It is listed under About in
  the sidebar beside "Compared with", through the same `extras` array, because
  it is not a README section. `scripts/a11y-site.mjs` audits it in both colour
  schemes: sixteen page-and-scheme runs now, still zero violations.
  Closes #72.
- CI runs the browser audits. A third job, `browser`, builds, generates the
  site and runs `npm run a11y` (axe over the panel's seven states and the
  site's sixteen page-and-scheme runs, with the real security headers served)
  and `npm run smoke:annotate` (the blur destroyed the pixels it covered) in
  the Chrome the `ubuntu-latest` image ships. A violation, a console message or
  a surviving pixel fails the pull request, and the axe reports are uploaded as
  an artifact when it does. The checks themselves are unchanged for local use.
- `scripts/chrome.mjs` — `findChrome()` and `loadPuppeteer()`, the lookup the
  five browser scripts each used to carry their own copy of. It honours
  `CHROME_BIN` and `CHROME_PATH`, then looks in the usual Linux, macOS and
  Windows locations and on PATH, so one command works on a runner and on a
  desktop. Nothing downloads a browser: `puppeteer-core` never does.
- `mountBugbottle` takes `network` and `perf`, the two `data-*` switches that
  had no mount option: `network: initNetwork` from `bugbottle/network` and
  `perf: initPerf` from `bugbottle/perf` start the recorders on mount and stop
  them on `destroy()`, and `{ on: initNetwork, all: true }` tunes them. They are
  the same hand-it-in seam as `annotate`, `shake`, `scrub` and `sign`: the panel
  imports neither module, only their types, so a page that records nothing
  carries nothing. The panel's own `endpoint` is handed to the network recorder
  unless the caller names one, so a report never describes its own delivery.
  `src/global.ts` now passes the options through for `data-network` and
  `data-perf` rather than calling the recorders behind the panel's back, so the
  script tag behaves exactly as before. Additive; nothing has to change on
  upgrade. Closes #70. The wiring costs `bugbottle/ui` 54 bytes gzipped
  (11 431 → 11 485), the script tag 46 (24 128 → 24 174) and the slim build 63
  (20 575 → 20 638); no budget moves.

### Fixed

- Contrast on the English landing page: a `code` span inside a muted paragraph
  inherited the muted grey onto the code background and measured 3.86:1 at
  0.875em, under the 4.5 that size needs. Code spans keep the page's ink now.
  This is what the new job would have caught.

## 0.9.0 — 2026-09-08

The consistency release. The whole public API was read once before 1.0 —
412 exported names across eighteen entry points — and the seven naming rules
that came out of it are now in CLAUDE.md. Every rename ships as an alias:
`onError` beside `onFailure`, `maxEntries` beside `maxItems`, `store` beside
the three store names, `endpoint` beside the webhook `url`, `MAX_SLACK_*` and
`MAX_DISCORD_*` beside the vendor-first spellings, and every `init*` returns
its `stop()`. Nothing is removed; the removals are issues #63–#67 for 1.0.
Beside it: a Content-Security-Policy on every path of the site, the server
bundle asserted in CI against DOM symbols, Jira line breaks as `hardBreak`
nodes, the inbox example indexed and capped, honest result counts in the docs
search, and the review fixes to the replay cap, the null-byte strip, the store
answers and the contact input.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 1.4 kB,
`bugbottle/react` 5.7 kB, `bugbottle/vue` 5.8 kB, `bugbottle/svelte` 5.6 kB,
`bugbottle/solid` 5.7 kB, `bugbottle/ui` 11.4 kB, `bugbottle/annotate` 1.4 kB,
`bugbottle/breadcrumbs` 1.3 kB, `bugbottle/network` 1.2 kB, `bugbottle/perf`
1.3 kB, `bugbottle/queue` 1.3 kB, `bugbottle/triggers` 1.3 kB,
`bugbottle/shake` 0.6 kB, `bugbottle/sign` 0.4 kB, `bugbottle/rrweb` 0.7 kB,
`dist/bugbottle.js` 24.1 kB, `dist/bugbottle.slim.js` 20.6 kB,
`bugbottle/server` validators 0.6 kB.

### Added

- `docs/api-audit-1.0.md`: the whole public API read once before 1.0 freezes it
  — 412 exported bindings under 315 names across the eighteen entry points,
  with a verdict each, the naming rules it settled (now in CLAUDE.md's
  Conventions) and the eight issues it opened. Nothing was removed; every
  rename below kept the old name working.
- `tests/exports.test.ts` pins `package.json#exports` to the documentation: an
  entry point added or dropped without the README's API section and CLAUDE.md's
  count following it fails the suite.
- The thirty-five exports the README never named are named — the payload and
  option types on `bugbottle`, each sink's options and result on
  `bugbottle/server`, and `enMessages` on `bugbottle/locales`.
- The site answers with a `Content-Security-Policy`: `default-src 'self'`, so
  the footer's promise that the page makes no external request is now something
  the browser refuses to break rather than a claim, plus `object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'` and `form-action 'self'`. It sits
  in `site/security-headers.conf` beside the two headers that were there, so
  every location in `nginx.conf` serves it, the 404 included. Two directives
  are wider than `'self'` and both are the panel: `img-src 'self' data:` for
  the screenshot preview, and `style-src 'self' 'unsafe-inline'` because
  `bugbottle/ui` puts its stylesheet into its shadow root as a `<style>`
  element, which CSP judges as inline style — without it the panel is served
  unstyled, measured. Nothing in the site's own HTML or scripts is inline.
  `scripts/a11y-site.mjs` now parses that file and serves the same headers, so
  the audit sees the policy that will be deployed and a blocked resource fails
  it.

### Fixed

- `jiraSink` splits a multi-line message into `text` nodes with `hardBreak`
  between them. The Atlassian Document Format has no newline inside a `text`
  node — it has a node for a line break — so a report written on two lines was
  either collapsed onto one or refused outright, and the sink had never been
  called against a real Jira Cloud site to find out which. A blank line is its
  breaks and no empty text node, which ADF also rejects. The console code block
  keeps its newlines, where they are preformatted and belong.
- `examples/inbox` reads one file for the detail page instead of parsing every
  stored report on every request, and keeps the list as a small in-memory index
  refreshed by each write and delete. The directory now has a ceiling as well:
  `MAX_REPORTS`, 2000 by default, deletes the oldest reports — JSON and picture
  together — once a new one takes the count past it. Thirty reports a minute at
  four megabytes each is a full disk soon enough, and a full disk is an inbox
  that has stopped accepting anything.
- `npm run build:docs` fails on two README `##` headings that slugify the same
  way, beside the ungrouped and ghost checks it already had. They used to
  collapse in a `Map` and the second heading won, so one section's text
  disappeared from the site while the README still held both — and the README
  reads perfectly well either way, so the build is the only place that can
  notice.
- A `rateLimitStore` whose `hit` answers with anything but a finite number is
  reported once through `onError` and the request goes through, as it already
  was for a `dedupeStore` answering with something that is not an entry. A
  store handing back `"3"` was compared with `>` and — since `"3" > 30` is
  false, and so is `NaN > 30` — switched the rate limit off for every caller
  with nothing said.
- The documentation search told a screen-reader user that a truncated list was
  everything there was: it showed the top eight matches and announced their
  number, so a query with forty hits said "8 results". It now says "8 of 40
  results" whenever the list is cut short, in both languages.
- The count is the search's live region, and it was `display: none` while
  empty — outside the accessibility tree at the moment its first content
  arrived, which is why NVDA and JAWS commonly said nothing for the first
  search of a session. It is now clipped rather than hidden: no room in the
  layout, present in the tree from the start. Its text is also written 250 ms
  after the list instead of on every keystroke, so typing a word queues one
  polite announcement rather than one per letter, and an unchanged sentence is
  not rewritten.
- The search index stripped every underscore along with the backticks around
  it, so `DEFAULT_MASK_SELECTOR` and every other `SCREAMING_CASE` name was
  unfindable, and it dropped README table rows entirely, so options documented
  only in a table — `elementPicker` among them — were invisible to the field.
  Underscores now survive and table cells are indexed as text.

### Changed

- `sendReportWebhook` and `toWebhook` take `endpoint`, the word the rest of the
  package uses for the address it POSTs to. `url` still works, is marked
  `@deprecated`, and goes in 1.0 (#67); giving both is a type error rather than
  a guess. A vendor's own address keeps the vendor's own word — `webhookUrl`,
  `host`, `site`, `dsn`.

- `handleReport`'s three pluggable stores are all called `store` now:
  `rateLimit: { store }`, `dedupe: { store }` and `signature: { store }`.
  Inside the option object the prefix said nothing the key did not, and the
  three of them spelled it three ways. `rateLimitStore`, `dedupeStore` and
  `replayStore` still work, are marked `@deprecated`, and go in 1.0 (#66);
  given both, `store` is the one that is asked. The two `TypeError`s a store
  that answers with nonsense produces now name `rateLimit.store.hit` and
  `dedupe.store.get`.

- The thirteen Slack and Discord ceilings are `MAX_SLACK_*` and
  `MAX_DISCORD_*`, so every limit in the package starts with `MAX_` — Jira,
  GitLab, Sentry and report-core already did. The vendor-first `SLACK_MAX_*`
  and `DISCORD_MAX_*` names are the same numbers, marked `@deprecated`, and go
  in 1.0 (#65).

- `QueueOptions.maxEntries` is the new name for `maxItems`. The console buffer,
  the breadcrumbs and the network log all cap their ring buffer with
  `maxEntries`; the queue was the one that did not. `maxItems` still works, is
  marked `@deprecated`, and goes in 1.0 (#64).

- `SendOptions.onError` is the new name for `onFailure`, which is what
  `MountOptions` and `HandleReportOptions` have always called the same idea.
  `onFailure` still works, is marked `@deprecated`, and goes in 1.0 (#63);
  given both names, `onError` is the one that runs.

- `initConsoleBuffer`, `initBreadcrumbs` and `initNetwork` return their stop —
  `resetConsoleBuffer`, `resetBreadcrumbs` and `resetNetwork` — the way
  `initPerf` and `attachRrweb` already did. A caller can undo what it started
  without importing a second name, and a call that recorded nothing (a second
  `init`, or `maxEntries: 0`) returns the stop as well, where calling it is
  harmless. Nothing changed for the callers that ignore the return value.
- CI now asserts the `bugbottle/server` bundle rather than only printing its
  size. A bundle of one validator must stay under 1024 bytes gzipped and its
  minified text must mention none of `document`, `window.`, `navigator` or
  `localStorage`. "A server bundle must never pull in DOM code" has been a rule
  since the first release and until now nothing checked it.

## 0.8.0 — 2026-09-08

The reachable release: the report can carry how to answer the person who
wrote it, and it can land in Jira, GitLab, or your own inbox. A contact field,
off by default everywhere and reply-to on the email; Jira Cloud and GitLab
sinks beside the seven that existed; the rate limit and the dedupe as store
seams like the replay cache, so several instances answer as one; the last
thirty seconds from the app's own rrweb recorder as an attachment; a slim
script-tag build without the optional recorders; `examples/inbox`, a
zero-dependency place for reports to land behind one password; on the site,
a search over the documentation, a recipes page with one verified route
handler per framework, security headers on every path and dated sitemap
entries. One change for an existing panel: the contact input is new markup,
off unless asked for. A fresh-context review went in before this tag; its
fixes are under Fixed.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 1.5 kB,
`bugbottle/react` 5.7 kB, `bugbottle/vue` 5.8 kB, `bugbottle/svelte` 5.6 kB,
`bugbottle/solid` 5.7 kB, `bugbottle/ui` 11.4 kB, `bugbottle/annotate` 1.4 kB,
`bugbottle/breadcrumbs` 1.3 kB, `bugbottle/network` 1.2 kB, `bugbottle/perf`
1.3 kB, `bugbottle/queue` 1.3 kB, `bugbottle/triggers` 1.3 kB,
`bugbottle/shake` 0.6 kB, `bugbottle/sign` 0.4 kB, `bugbottle/rrweb` 0.7 kB,
`dist/bugbottle.js` 24.0 kB, `dist/bugbottle.slim.js` 20.5 kB,
`bugbottle/server` validators 0.6 kB.

### Added

- `dist/bugbottle.slim.js`, a second script-tag build. The full one is the
  "everything" build — a `data-*` attribute has to be able to switch on the
  annotator, the timings snapshot, the shake gesture and the network log, so
  every page that loads it carries all four whether it asks for them or not.
  The slim file is the same panel without those four: the console, the
  breadcrumbs, the element picker, the offline queue, the scrubber, the signer
  and all eight locales, 20.5 kB gzipped against 23.9. Locales stayed, because
  they are data and dropping them would break `data-locale` for everyone not
  in English. `data-annotate`, `data-perf`, `data-shake` and `data-network` are
  read and ignored, and the build says so on the console once, in English,
  naming the attributes it saw — that is a message to whoever wrote the script
  tag, not to the reporter. `window.bugbottle` is the same namespace without
  `createAnnotator`, `initPerf`, `onShake`, `requestShakePermission` and
  `initNetwork`. Both files are built by the same `scripts/build-iife.mjs` with
  the same settings, from `src/global.ts` and the new `src/global-slim.ts`; the
  `data-*` reading they share moved to `src/global-shared.ts` rather than being
  copied, which cost the full build 52 bytes gzipped (23 937 → 23 989) and left
  its budget where it was.
- `bugbottle/rrweb`: `attachRrweb(record, { seconds = 30, maxBytes = 512 * 1024 })`,
  the last half-minute before the panel opened, for the applications that
  already run rrweb. An adapter and not a recorder — rrweb is not a dependency
  and is never imported, so the application hands its own `record` in the way
  it hands the screenshot renderer in, and the type of it is structural. rrweb
  is asked for a fresh full snapshot every ten seconds, because a checkout is
  the only place a recording can be cut, and the buffer keeps whole checkout
  groups: the oldest goes when it falls entirely outside the window, and again
  while the serialised buffer is over `maxBytes`. The newest group is never
  dropped, so `seconds` is a floor rather than a promise; one snapshot larger
  than the cap is dropped whole, like an oversized screenshot, because half a
  replay does not play. Registered through `src/registry.ts` beside the
  breadcrumbs, the network log and the perf snapshot, so the core pays 19 bytes
  for one registry read (1316 → 1335 gzipped) and not one byte of the module,
  which is 711 gzipped against a 768-byte budget. The report gains
  `replay: { events, seconds }`; `includeReplay: false` leaves it out of one
  report. Masking is rrweb's own and is the only control there is —
  `scrubReport` does not walk somebody else's event format — so
  `maskAllInputs: true` is the default here, `data-bugbottle-mask` becomes
  rrweb's `maskTextSelector`, and `data-bugbottle-block` and `data-bugbottle`
  become its `blockSelector`, which also stops the panel filming itself.
  On the server `normaliseReplay` keeps the events that are objects with a
  numeric `type` and `timestamp`, strips null bytes, recomputes `seconds`, and
  drops the whole replay over `MAX_REPLAY_BYTES` (1 MB); `handleReport` takes
  `replay: "keep" | "drop"`, defaulting to keep and dropping before anything is
  scrubbed, deduplicated, stored or rendered; `toMarkdown` prints one line —
  `Replay: 240 events over 32 s (attached)`. In the schema as `ReplayCapture`
  and `ReplayEvent`. The README says plainly what it is: a recording of a
  person using your software, to which the privacy section applies twice.
- `examples/inbox`: a place for reports to land, in one file and with no
  dependencies. A Node 22+ server that receives them with `handleReport`,
  writes each one to disk as `<time>-<id>.json` beside `<id>.png` — the
  screenshot out of the JSON, so the file stays readable — and serves a
  read-only inbox behind one password from `INBOX_PASSWORD`, compared in
  constant time. It refuses to start without that variable, because an inbox
  that came up without a password would be a public list of screenshots of
  somebody's application. The list is newest first; the detail page renders
  `toMarkdown` through a tiny subset (headings, paragraphs, tables, fenced
  code, lists, `<details>`) where the structure is read from the Markdown and
  every piece of text is escaped first, so a report whose message is
  `<img src=x onerror=…>` is shown rather than run. Copy as Markdown, the raw
  JSON, the picture, delete — and delete asks for more than the password,
  because a browser attaches a cached `Authorization` header to a form POST
  from any site: it answers 403 unless `Sec-Fetch-Site` and `Origin` say the
  request came from the inbox, and lets through a request with neither, which
  is not a browser. `demo.html` mounts the panel against it, so the
  whole round trip is one `node examples/inbox/server.mjs`. Not part of the npm
  package, and not a product: no accounts, no search, no assignment, no
  digests. `tests/example-inbox.test.ts` runs the real program on a random port
  in a temp directory.
- An optional contact field: `contact` on the report — free text, trimmed,
  null bytes stripped, clipped at `MAX_CONTACT_LENGTH` (200) and part of
  `report.schema.json` — so a team that receives "the save button does
  nothing" can answer the person who wrote it. Off by default everywhere,
  because asking for an address is a promise to answer and that promise is the
  application's to make.
  - `createReportState` carries `contact` and `setContact`, and all four
    adapters expose them the way they expose `message`: spread into the React
    hook and the Svelte store, a writable ref in Vue, an accessor in Solid. An
    empty line is left out of the body entirely, so a form that never asks
    sends no `contact` key.
  - `mountBugbottle` takes `contact: false | true | "required"`. `true`
    renders an `<input type="email">` with a label and a hint under the
    message; `"required"` refuses to send without it through the same inline
    error an empty message gets. Nothing validates what is typed — "call me on
    12345678" is a good answer. Three new locale strings in all eight
    languages, and `data-contact` on the script tag (`required` included).
  - `scrubReport(report, { contact: true })` redacts the line, whole. It is the
    one scrubber that is off unless asked: an address typed into a field asking
    for one is not a leak, but a phone number matches no pattern, so when
    reports go somewhere public the line goes whole or not at all.
  - `toMarkdown` renders a `Contact` fact row under the type, so the GitHub,
    GitLab and Linear sinks carry it as well; Jira, which builds its own facts
    rather than rendering Markdown, puts it in the same place in the bullet
    list; Slack and Discord put it first in their
    fields; Sentry fills `contexts.feedback.contact_email` from it when it
    looks like an address and keeps the whole line in `extra.contact`.
  - `sendReportEmail` sets `reply_to` from a contact line that looks like an
    email, so replying to the mail answers the reporter. A line that is not an
    address is left in the body only — Resend refuses a malformed `reply_to`
    rather than ignoring it. `replyTo` overrides it; `replyTo: false` sends
    none.
  - `handleReport` validates the field onto `ValidatedReport` (absent when
    there is none, never in `extra`), and `bugbottle/server` exports
    `normaliseContact`, `looksLikeEmail` and `MAX_CONTACT_LENGTH`.
- `npm run a11y` audits two more states, the panel with the contact field on in
  each colour scheme. Seven states, zero violations.
- `rateLimit.rateLimitStore` and `dedupe.dedupeStore` on `handleReport`, shaped
  like the `replayStore` seam beside them: a fleet behind a load balancer can
  now share one rate limit and one dedupe answer instead of one per instance.
  `RateLimitStore` is a single `hit(key, windowMs)` that increments and returns
  the count — an `INCR` and a `PEXPIRE` in Redis — and `DedupeStore` is
  `get(key)` and `set(key, entry, expiresAt)`, where expiry is the store's job,
  so anything `get` answers with is a duplicate. Either half may be
  synchronous. Nothing is bundled and nothing is depended on; the README shows
  all three seams together under *Running more than one instance*. Without a
  store the in-memory maps and their eviction are exactly what they were.
  Both new stores fail **open** — a `hit` or a `get` or a `set` that throws
  reaches `onError` and the report is accepted — because an honest report must
  not be refused, or lost, because a shared store blinked. `replayStore` still
  fails closed, since an unchecked signature is the replay it exists to stop.
- Two more places a report can land, for teams on neither GitHub nor Linear.
  `jiraSink({ site, email, apiToken, projectKey, issueType? })` files a Jira
  Cloud issue over REST v3. It is the only sink that does not send Markdown:
  v3 takes the Atlassian Document Format in `description`, so the report is
  built as a node tree instead — a paragraph for the reporter's words, a bullet
  list for the facts and the element, a code block for the last twenty console
  entries. `buildJiraDescription` returns that document on its own. The two
  credentials are the basic auth pair, base64-encoded UTF-8 safe so an accented
  token does not throw on the way out, and a refused create names the field:
  Jira's `errorMessages` list and its per-field `errors` object are joined into
  the `SinkError` message. `site` accepts `acme`, `acme.atlassian.net` or the
  full URL.
- `gitlabSink({ host?, projectId, token, labels? })` files a GitLab issue with
  the Markdown from `toMarkdown` verbatim. `host` defaults to gitlab.com, so a
  self-hosted instance is one option; a namespaced `projectId` is URL-encoded
  into the one path segment, the token travels in `PRIVATE-TOKEN` rather than
  in `Authorization`, and labels are comma-joined, which is the shape the API
  takes. GitLab answers `404` rather than `403` for a project the token cannot
  see, so the `SinkError` message — its own, flat or keyed by field — is the
  only thing that tells a wrong project from a too-narrow scope.
  Neither takes an attachment in this version: both want a second request in a
  different shape, so the screenshot is stored by you and travels as
  `screenshotUrl`, as it does for GitHub and Linear. The validator-only
  `bugbottle/server` bundle is unchanged at 528 bytes gzipped — the emitted
  code is byte-for-byte the same, so neither sink reached the shared path.
- **Search over the documentation.** `bugbottle.dev/docs` has a field at the
  top of its sidebar — under the header on a phone — over an index generated
  beside the pages: one entry per page and per heading, matched
  case-insensitively over the title, the heading and the prose, ranked in that
  order, top eight. Escape clears it and Enter opens the first result. The
  index is fetched on the first focus of the field, never with the page, and
  the field is built by `site/docs.js`, so a reader without JavaScript gets
  the page they got before rather than a box that cannot answer.
- A "Recipes" section in the README: one route handler per framework — Next.js
  App Router, SvelteKit, Nuxt, Astro, React Router 7 (and Remix) and Hono —
  with the file path each expects, the one framework-specific line that
  matters, whether the raw body survives for signing, and where the client
  mounts. Every snippet was type-checked against the framework's current
  release beside a packed `bugbottle`; the versions are named at the top of the
  section. WordPress points at the plugin, and Deno, Bun and Workers are said
  to need no recipe at all.

### Fixed

- The site served most of its files without `Referrer-Policy`. nginx replaces
  the inherited `add_header` set as soon as a block adds a header of its own,
  and every location in `site/nginx.conf` sets a `Cache-Control`, so
  `/robots.txt`, `/sitemap.xml`, `/dist/`, `/fonts/`, `/style.css`, `/demo.js`
  and every page re-added `X-Content-Type-Options` and dropped the rest. The
  two headers now live in `site/security-headers.conf`, copied to
  `/etc/nginx/snippets/` by the Dockerfile and included by the server block and
  by every location inside it, so adding a header reaches all of them.
- A replay was measured in UTF-16 code units rather than in UTF-8 bytes, on the
  server and in the rolling buffer alike, so a recording of a page written in
  Chinese or full of emoji passed a "1 MB" cap at up to three megabytes on the
  wire. Both count with `TextEncoder` now.
- `normaliseReplay` stripped null bytes by removing the escape from the
  serialised JSON, which also matched an event whose own text was those six
  characters — leaving JSON that would not parse, so the whole replay was
  dropped. It now walks the parsed events and removes real null bytes from the
  string values and keys.
- An injected `dedupe.dedupeStore` whose `get` answered with something that is
  not an entry — a raw string, `true`, anything unparsed — made every report a
  duplicate, silently. Only an object with an optional string `id` is believed
  now; anything else is "not seen" and reaches `onError`, as a throwing store
  does.
- The panel's contact input was `type="email"`, so with `contact: "required"`
  a phone number matched `:invalid` and assistive technology announced an error
  on an answer the panel accepts. It is a text input with `inputmode="email"`
  now, which brings up the same keyboard on a phone.

### Changed

- The `bugbottle/ui` budget is 11776 bytes gzipped (was 11264; measures 11 342)
  and `dist/bugbottle.js` 24576 (was 23552; measures 23 839). The field is one
  input, a label, a hint and the required check — about 256 bytes — and three
  locale strings, which the script tag carries in eight languages. Argued in
  the comments beside both budgets in `.github/workflows/ci.yml`.
- Every `<url>` in the generated `site/sitemap.xml` carries a `<lastmod>`: the
  date of the commit that last touched the file the page is generated from,
  read with `git log -1 --format=%cs` and never from a file mtime, which a
  checkout resets. The site image's builder stage therefore installs `git` and
  takes the repository in last, after the sources, so a commit does not
  invalidate the layers above it; neither reaches the served image. The copy is
  allowed to match nothing, since a source export and a git worktree both
  arrive without a usable repository — the script then dates every page today.

## 0.7.0 — 2026-09-08

The evidence release: the reporter can mark the picture before it leaves, a
blur that really destroys what it covers, request signing with a replay cache
that the key holder cannot empty, timings and a storage snapshot, shake to
report on a phone, a Solid adapter, and four more places a report can land —
Slack, Discord, Sentry (with GlitchTip and Bugsink) — beside the existing four.
The panel now takes the annotator and the shake detector as functions you hand
in, so a panel nobody marks a picture in ships neither; that is the one change
an existing `annotate: true` has to make. The site was set in two typefaces of
its own and audited page by page. A fresh-context review of the annotator, the
signing and the comparison page went in before this tag, with three privacy and
security fixes recorded under Fixed.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 1.5 kB,
`bugbottle/react` 5.6 kB, `bugbottle/vue` 5.6 kB, `bugbottle/svelte` 5.5 kB,
`bugbottle/solid` 5.6 kB, `bugbottle/ui` 11.1 kB, `bugbottle/annotate` 1.4 kB,
`bugbottle/breadcrumbs` 1.3 kB, `bugbottle/network` 1.2 kB, `bugbottle/perf`
1.2 kB, `bugbottle/queue` 1.3 kB, `bugbottle/triggers` 1.3 kB,
`bugbottle/shake` 0.6 kB, `bugbottle/sign` 0.4 kB, `dist/bugbottle.js` 23.1 kB,
`bugbottle/server` validators 0.5 kB.

### Added

- `bugbottle/shake`: `onShake(callback, options?)`, the gesture a phone has
  instead of a keyboard shortcut. A `devicemotion` listener with a one-pole
  high-pass filter over the three axes, so the 9.8 m/s² a still phone reports
  forever is not mistaken for movement; a shake is three crossings of the
  threshold (15 m/s² by default) with alternating direction inside one second,
  which is what separates a shake from a drop. A three-second cool-down keeps
  one gesture to one panel, and the listener comes off on `visibilitychange`, so
  a phone in a pocket with a background tab measures nothing.
  `requestShakePermission()` resolves to `"granted"`, `"denied"` or
  `"unsupported"` and is the only thing here that ever prompts: iOS 13 and later
  gate motion behind `DeviceMotionEvent.requestPermission()` from a user
  gesture, in Safari alone, so the application owns that button and `onShake`
  stays silent until permission arrives. `mountBugbottle` takes the detector the
  way it takes the annotator — `shake: onShake`, or `{ on: onShake, threshold,
  cooldownMs }` — so the panel carries the wiring and never the module, and
  `data-shake` (presence, or a number for the threshold) switches it on from the
  script tag, which also exposes `requestShakePermission` because a page with no
  bundler has no other way to ask iOS. Its own entry point rather than a third
  function in `bugbottle/triggers`, which measures 1281 bytes against a
  1300-byte budget: 685 bytes gzipped against 768, 94 bytes added to
  `bugbottle/ui` and 572 to `dist/bugbottle.js`, whose budget rises to 23552.
  No new locale string — a shake opens the panel the reporter already knows.
- `bugbottle/solid`: `createBugReport(options)`, the fourth binding over
  `src/report-state.ts` and the last framework the roadmap named. Everything it
  returns is an accessor — `state` through `type`, `message`, `screenshot`,
  `elements`, `status` and the three convenience flags — so the JSX tracks
  exactly what it reads, and the actions are the same ones the other three
  adapters expose. The subscription is torn down by `onCleanup`, which in a
  component is the component; `destroy` is returned for a form created outside
  an owner. `solid-js` is an optional peer dependency (>= 1.8), so nothing
  about it reaches a project that does not use it. 1270 bytes gzipped over the
  bundle of `buildReport`/`sendReport`/`captureScreenshot`/`pickElement` that
  any form pays for, against the same 1536-byte marginal budget Vue and Svelte
  are measured on.
- `bugbottle/perf`: `initPerf(options?)`, a fifth recorder that answers "was it
  slow?" and "what state was the browser in?" without bundling `web-vitals`.
  `report.perf` carries LCP, CLS, INP, TTFB, DOM content loaded, load, the
  count and total of long tasks and — on Chromium — the JS heap, read from
  `PerformanceObserver` with `buffered: true` so a paint from before the call
  still counts. Two simplifications are documented rather than hidden: CLS is
  the sum of the shifts without recent input rather than the worst session
  window, and INP is the worst interaction rather than the 98th percentile.
  `report.storage` lists `localStorage` and `sessionStorage` key names with
  value lengths and cookie names — never values, and never a cookie value at
  all — with `allowValues` as an opt-in per key, clipped to 200 characters.
  It registers through `src/registry.ts` like breadcrumbs and the network log,
  so the core carries two reads and none of the module: 1236 bytes gzipped
  against a 1280-byte budget, and the core moved 1272 → 1310.
  `normalisePerf` and `normaliseStorage` validate both blocks server-side with
  the same caps, `handleReport` puts them on `ValidatedReport`, the schema
  publishes the ceilings, `toMarkdown` renders a "Performance" table and a
  collapsed "Storage" block, and `scrubReport` runs over `storage.values` and
  the cookie names. `data-perf` switches it on in the script-tag build, which
  grew from 21.1 kB to 21.7 kB gzipped.
- `bugbottle/server`: `sentrySink({ dsn })`, which posts one envelope per report
  to a Sentry-compatible ingest endpoint — Sentry, GlitchTip or Bugsink — so a
  team that already runs one does not need a second place to look. No SDK
  dependency: the DSN is taken apart into `https://<host>/api/<project>/envelope/`
  and one `fetch` sends the envelope with `X-Sentry-Auth`. The report becomes an
  event with the message, a level of `error` for a bug and `info` otherwise,
  tags for the type, the page and the viewport, and a `contexts.feedback` — the
  shape Sentry ≥ 24.x reads as User Feedback. The console buffer, the
  breadcrumbs and the recorded requests become Sentry breadcrumbs in one
  timeline sorted oldest first (`console`, `ui.click`, `ui.submit`,
  `navigation`, and `http` with `url`, `method`, `status_code` and `duration`);
  the pointed-at elements and the optional context facts become `extra`; and the
  screenshot rides in the same envelope as an attachment item, which makes this
  the one sink that carries the picture rather than a link to it.
- Every Sentry limit is a clip rather than a failure: a hundred breadcrumbs,
  8 kB of message (4096 characters in the feedback context, which is that
  spec's own cap) and a megabyte of envelope, where the attachment is dropped
  first and the breadcrumbs second and the loss is named on the event as a
  `bugbottle_truncated` tag. `SentrySinkError` is a `SinkError` that also
  carries `retryAfter` — sixty seconds when a 429 came with no usable header,
  as the transport specification says to assume — and the raw
  `X-Sentry-Rate-Limits`, so a caller can back off with a number. A DSN with a
  typo throws when the sink is built rather than on the first report.
  `buildSentryEvent` and `buildSentryEnvelope` are exported for anyone who
  would rather send it themselves. Written against the developer documentation
  of 2026-09-08, including the attachments spec 1.6.0 and the feedback spec
  1.3.0; the two knowing departures from it — an `event` item by default rather
  than a `feedback` one, because GlitchTip and Bugsink do not know the newer
  type, and a legacy `message` beside `logentry` for the same reason — are
  argued in a comment at the top of `src/sinks/sentry.ts`. `itemType:
  "feedback"` opts into the feedback item on a real Sentry.
- `bugbottle/server`: `slackSink` and `discordSink`, two incoming-webhook sinks
  that post one structured message per report rather than a wall of Markdown.
  Slack gets a Block Kit message — a header, the message as escaped `mrkdwn`, a
  section of fields, the last five console entries fenced, an `image` block, a
  `context` line with the time and the pointed-at selector, and an "Open report"
  button. Discord gets one embed, coloured red, green or grey by report type,
  with the same facts as fields, the screenshot as `image`, the report link as
  the embed's `url` and the selector in the footer. Both are factories that go
  straight into `handleReport`'s `sinks`, both take an injected `fetch` and use
  the `AbortSignal` they are handed, and both throw `SinkError` with the
  upstream status and body. `screenshotUrl` and `reportUrl` are functions of the
  report, so the addresses come from whatever you stored; neither service will
  fetch a data URL, so one is ignored rather than sent.
  `buildSlackMessage` and `buildDiscordMessage` return the body without sending
  it, for anyone posting through a bot token instead.
- Every Block Kit and embed limit is a clip rather than a failure: 50 blocks,
  3000 characters per Slack text object, 10 fields per section; 256, 4096, 25,
  256 and 1024 on a Discord embed, and 6000 across it, where the description is
  what gives way first because the facts are what somebody triages from.
- `bugbottle/sign`: `createSigner({ key, header? })` returns the `sign` function
  `sendReport` takes, signing the serialised body with WebCrypto HMAC-SHA-256
  and sending `X-Bugbottle-Signature: t=<unix ms>,v1=<hex>` over
  `<t>.<body>`. 366 bytes gzipped, imported by nothing in the core — the same
  function-shaped seam as `scrub`, so nobody pays for it who does not sign.
  `sign` is passed through `createReportState`, the React, Vue and Svelte
  adapters, `BugReportBoundary`, `mountBugbottle` and `data-sign-key` on the
  script tag. A browser without `crypto.subtle` (a very old one, or a page on
  plain HTTP) sends the report unsigned rather than failing.
- `handleReport`: a `signature` option — `{ key, header?, maxSkewMs?, require? }`
  — verifying that HMAC over the raw text before anything parses it. Several
  keys may be given for a rotation, the comparison is constant-time, the skew
  window is five minutes on either side by default, and accepted signatures are
  remembered so a captured body cannot be replayed (in memory, per instance,
  bounded per signed second; see Changed below). Missing when
  required, invalid, expired and replayed all answer
  `401 { error: "Bad signature" }`, deliberately indistinguishable. `require`
  defaults to true whenever `signature` is set; a signature that is present is
  verified either way. With Express the signed route must be mounted without a
  body parser, because `express.json()` re-serialises the body into different
  bytes. Documented honestly in the README: a key that ships to a browser is
  public, so this is spam deterrence beside a rate limit, not authentication.
- A "Compared with" page on the site, in English at `/compare/` and in Danish
  at `/da/sammenlign/`, placing bugbottle next to Marker.io, Jam, Sentry User
  Feedback, BugPin and rrweb: licence, hosted or your own endpoint, what each
  captures, what it weighs and what it costs, with every figure dated
  September 2026 and linked to the page it came from, and a paragraph on when
  to pick one of the others. Written as Markdown in `site/compare.md` and
  `site/da/sammenlign.md` and rendered by `scripts/build-docs.mjs`, so it is
  generated and gitignored like the documentation. Linked from both landing
  page footers and from the About group of the documentation sidebar.
- `site/sitemap.xml` and `site/robots.txt`, written by the same script: every
  page as an absolute `https://bugbottle.dev` URL, `hreflang` alternates on
  the two pairs that exist in both languages, and a `Sitemap:` line in a
  robots file that allows everything. Generated rather than hand-written, so a
  new documentation page cannot be left out of them; nginx serves the sitemap
  as `application/xml` and the robots file as `text/plain`.
- `bugbottle/annotate`: `createAnnotator(canvas, dataUrl, options)`, the
  reporter marking the screenshot before it is sent — a rectangle to point at
  something, an arrow to point from somewhere, and a blur. Undo, pointer input
  so a mouse, a pen and a finger all work, Backspace to undo and Escape to
  abandon the mark in progress, and `toDataUrl()` for the PNG. A canvas and
  nothing else: about 1.4 kB gzipped, no dependency, no strings of its own.
  The blur is destructive on purpose — it reads the region back out of the
  canvas, averages it in 12-pixel blocks and paints the averages over the top,
  so the original pixels are gone from the export and cannot be recovered by
  whoever receives the report. That makes it the privacy tool as much as the
  marking one, for the customer name a masking rule did not know about.
  `scripts/annotate-smoke.mjs` proves it in a real Chrome: every block inside
  the region is one flat colour, none of them still carries the original
  pixels, and not one pixel outside the region changed.
- The panel gained the flow over it. Once a picture is attached, "Edit
  picture" replaces the preview with the canvas and a toolbar: the three tools
  as a labelled `radiogroup` the arrow keys walk through, undo, and done —
  which folds the marked picture back into the report and returns focus to the
  button that opened it. Eight new locale strings in all eight languages,
  including a name for the canvas that says which keys work on it, since
  nothing on screen does. `annotate: false` on `mountBugbottle` and
  `data-annotate="off"` on the script tag switch it off; `createAnnotator` is
  also on `window.bugbottle` for a page with its own form. `npm run a11y` now
  audits five states rather than three, the two new ones with the editor open,
  and reports no violations.

### Changed

- **The site is set in two typefaces of its own** — Newsreader for the
  headings, Source Sans 3 for everything else — served from `bugbottle.dev`
  rather than linked from Google, so the footer's promise that the page makes
  no external request stays true. Latin only, preloaded, `font-display: swap`,
  no layout shift. A second design pass came with them: the hero picture fills
  its column, the screenshot warning is printed on the dark ground the code
  slabs use, the documentation pages carry the landing page's header instead of
  one of their own, the topic list collapses on a phone, and the footer has a
  language switch. Nothing in the library changed.
- **`npm run a11y` now audits the site as well as the panel.**
  `scripts/a11y-site.mjs` runs axe over both landing pages, the documentation
  index, a deep documentation page and the two comparison pages in both colour
  schemes, and fails on a console message as well as on a violation.
  `scripts/capture-panel.mjs` and `scripts/render-og.mjs` make the hero and the
  link preview, which were made by hand before.
- `handleReport`: the replay cache is bounded per *signed second* — 128 digests
  each, `MAX_SIGNATURE_ENTRIES_PER_SECOND`, across at most 640 seconds,
  `MAX_SIGNATURE_SECONDS` — rather than by one global ceiling of 10 000
  entries. `MAX_SIGNATURE_ENTRIES` is still exported and is now the product of
  the two, the true ceiling on the cache. See Fixed: a global ceiling was
  something the key holder could exhaust, and the key holder is anybody.
- `signature` takes a `replayStore` — `{ has(digest), add(digest, expiresAt) }`,
  either half synchronous or a promise — so several instances behind a load
  balancer can share one answer about what has already been accepted. Nothing
  is bundled and nothing is required: the README shows the four lines of Redis.
  `expiresAt` is the millisecond the signature stops being acceptable anyway,
  which is exactly how long the entry needs to live. Only a signature that
  verified is ever written to it, and a store that throws fails the request
  closed.
- **Breaking, for the panel:** `mountBugbottle`'s `annotate` option is now the
  `createAnnotator` function itself rather than a boolean. This corrects the
  annotator entry above: the panel imported `src/annotate.ts` unconditionally,
  so every application that mounted the panel shipped a canvas editor it might
  never open — `bugbottle/ui` went from 10 229 to 12 131 bytes gzipped and
  `annotate: false` hid the button without shrinking anything. The annotator is
  now handed in the way `screenshot`, `scrub` and `sign` are:
  `mountBugbottle({ endpoint, screenshot, annotate: createAnnotator })`. Leave
  it out and the editor is not in your bundle at all; `bugbottle/ui` is back to
  10 951 bytes, and the CI budget with it, from 12 kB to 11 kB. What is left of
  the 720-byte difference against the pre-annotator panel is the panel's own
  toolbar, its CSS and its eight English strings, which no bundler can remove
  from a static import. The script tag is unchanged for its readers: it is the
  build that carries everything, so it hands the annotator in itself and
  `data-annotate="off"` still switches the button off.

### Fixed

- `handleReport`: the replay cache could be emptied by whoever held the key,
  which is everybody — it ships to the browser. Ten thousand valid, distinct
  signatures inside the window evicted an honest digest, and the body it stood
  for could then be posted again. The cache now makes room inside the second a
  signature was dated in, so a flood can only displace digests from the second
  it floods.
- `handleReport`: `t=` is matched against `/^\d{1,16}$/` rather than handed to
  `Number()`, which also accepted `0x1`, `1e12` and a leading space and then
  canonicalised them into the message being verified. The digest is now checked
  over the timestamp exactly as it was sent. Nothing was exploitable; a format
  with one spelling is a format a second implementation can get right.
- `expressHandler`: a signed route mounted behind `express.json()` answered
  every report with the same 401 a forged signature gets, and said nothing
  about why. It now calls `onError` once per handler with a line naming
  `express.json()` and pointing at the fix, and still answers that same 401 —
  the reply says no more than it did, and the explanation goes to the log. A
  report that carries no signature at all under `require: false` is untouched:
  that is how signing is rolled out.
- The ready-made panel closed altogether when Escape was pressed in the picture
  editor with no mark in progress, and left the editor on screen with a live
  annotator behind it, so "Edit picture" did nothing at the next attempt.
  Escape in the editor is now the editor's own way out — the unconfirmed marks
  are dropped, the preview comes back and focus returns to "Edit picture" —
  while a mark being drawn still swallows the key and a closed editor still
  lets it close the panel. Closing the editor now puts the canvas away on every
  path, whether or not an annotator was live, so the dead-button state cannot
  be reached at all. The `annotateArea` sentence the canvas reads to a screen
  reader says so, in all eight languages.
- The ready-made panel posted the picture as it was captured when Send was
  pressed with the editor still open, because the marks were only folded in by
  "Done". A blur the reporter had just drawn over a customer name never reached
  the report. The marks are committed when the report is built.
- `createAnnotator`: the blur left the last column and row of its region
  carrying their original pixels when a drag began or ended between two pixels,
  and slid the region sideways when a drag began off the canvas. Both edges are
  now rounded outwards and then clamped.
- `handleReport`: the replay cache kept an accepted signature for `maxSkewMs`
  from the moment it arrived rather than from the timestamp it signed. The skew
  window runs in both directions, so a signature dated ahead of the server's
  clock was forgotten while it was still acceptable and the captured body could
  be posted a second time.

## 0.6.0 — 2026-09-07

The adoptable release: one form state shared by React, Vue and Svelte; a
panel that a keyboard and a screen reader can use; the offline queue; a
keyboard shortcut and an opt-in open-on-error; stack frames and a wider page
context on every report; the Linear sink and a JSON Schema for the payload;
documentation generated from this README at bugbottle.dev/docs. No breaking
changes for the ESM entries; the script-tag build grew from 13.7 kB to 18.1 kB
gzipped because it carries every default in eight languages.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 1.3 kB,
`bugbottle/react` 5.5 kB, `bugbottle/vue` 5.6 kB, `bugbottle/svelte` 5.4 kB,
`bugbottle/ui` 10.1 kB, `bugbottle/breadcrumbs` 1.3 kB, `bugbottle/network`
1.2 kB, `bugbottle/queue` 1.3 kB, `bugbottle/triggers` 1.3 kB,
`dist/bugbottle.js` 18.1 kB, `bugbottle/server` validators 0.5 kB.

### Added

- `bugbottle/vue`: `useBugReport(options)`, the same form as the React hook as
  a composable over refs. `type` and `message` are writable computeds, so
  `v-model` binds to them; the subscription is torn down with the effect scope
  the composable was called in, and `destroy()` is there for a call outside
  one. `vue` is an optional peer dependency (`>= 3`). About 1.3 kB gzipped over
  the capture, the picker and the send any form pays for.
- `bugbottle/svelte`: `createBugReport(options)`, the same form as a readable
  store plus the actions — `$form.message` in the markup, `form.setMessage()`
  in the handlers. The store contract is implemented in the adapter rather than
  imported, so only the `Readable` type comes from `svelte` and nothing of it
  reaches the bundle; `svelte` is an optional peer dependency (`>= 4`). About
  1.2 kB gzipped over the same shared core.
- `src/report-state.ts`: `createReportState(options)` returning `{ getState,
  subscribe, actions, setOptions, destroy }` — the form as a state machine with
  no framework in it, and `statusText(status, messages)` for the one line that
  is not state. The three adapters are bindings over it, so they cannot drift
  apart, and a framework without an adapter is one `subscribe` away from a
  working form.
- An accessibility pass over the ready-made panel, so a client site can switch
  it on without an accessibility regression. Focus is trapped inside the shadow
  root while the panel is open — Tab wraps at both ends, which is what
  `aria-modal` has been claiming — and closing it returns focus to whatever
  opened it rather than to the top of the page. The report types became a
  proper `radiogroup`: one stop in the tab order, arrow keys walking through
  it, `aria-checked` on each. Every control has a name, including the remove
  buttons, which are now named after the element they remove instead of being
  several buttons called "Remove", and the screenshot note, which is attached
  to the checkbox with `aria-describedby`. A polite live region outside the
  panel announces the element picker starting and stopping, with the Escape
  hint — that mode hides the panel and changes the pointer, and nothing said
  so. Targets are at least 24x24, `prefers-reduced-motion` is respected, and
  the dark scheme now lightens the accent and the error red (`--bb-accent-text`
  and `--bb-error`), which were readable on white and not on `#111827`.
  `axe-core` reports zero violations with the panel open in both schemes and
  closed; `npm run a11y` runs that audit against a real Chrome. Five new
  `UiTexts` strings in all eight languages: `typeLabel`, `pickingAnnounce`,
  `pickingDone`, `removeElement` and `closeDialog`.
- Normalised stack frames on uncaught errors and unhandled rejections.
  `ConsoleEntry` gains an optional `stack` of at most ten
  `{ file, line, col, fn? }` frames, parsed by one small expression in
  `src/stack.ts` that reads V8 (`at fn (file:line:col)` and
  `at file:line:col`) and Firefox/Safari (`fn@file:line:col`) alike; a line
  without a position, such as the `TypeError: ...` header, is skipped rather
  than guessed at. The one-line `message` is unchanged, `normaliseConsole`
  validates and caps the frames a report arrives with, and `toMarkdown` prints
  the top three under their entry. No source text is ever read or sent: a
  frame is a position, and resolving it stays with whoever has the maps.
- Six optional facts on `collectContext`: `language`, `timezone`, `screen`
  (with the device pixel ratio), `colorScheme`, `online` and `connection`.
  Each is read behind a guard and left out when the browser has no answer, so
  a receiver never has to tell "unknown" from an empty string.
  `normaliseContext` clips them (35, 64, 32 and 16 characters) and drops
  anything of the wrong type, and `toMarkdown` adds them to the facts table.
  None of it says more about the person than the user agent already does, and
  nothing beyond that list is collected — no canvas, no fonts, no device
  enumeration. The schema regenerates from `ReportContext`, so the new
  `maxLength`s and the `dark`/`light` enum travel with it.

- `dist/report.schema.json`, the JSON Schema (2020-12) for the payload,
  generated from the `BugReport` type by `scripts/build-schema.ts` as part of
  `npm run build` and exported as `bugbottle/report.schema.json`. It carries
  `$id: https://bugbottle.dev/schema/report.json`, the JSDoc on the types as
  `description`s, and the `MAX_*` ceilings as `maxLength`/`maxItems`, so a
  receiver written in another language can enforce the same limits the
  validators do without depending on the library. The landing page serves it
  at `/schema/report.json` from the same file. Generated rather than
  hand-written so it cannot drift from what the browser sends, and serialised
  with sorted keys so the committed `dist/` only changes when the schema does.
- `createLinearIssue(report, options)` in `bugbottle/server` and the matching
  `toLinear` sink for `handleReport`: files a report as a Linear issue through
  the `issueCreate` GraphQL mutation, with `teamId`, an optional `projectId`
  and `labelIds`, and returns `{ id, identifier, url }`. Linear rejects a
  mutation with a `200` and an `errors` array rather than an HTTP error, so the
  body is inspected as well as the status and either one throws `SinkError` —
  a mistyped team id is a visible failure, not an issue that was never
  created. Like the other sinks it is one `fetch`, the key is an argument, and
  it never reads your environment.

- `bugbottle/queue`: `createQueue({ endpoint, storageKey?, maxItems?,
  maxAgeMs?, headers?, credentials?, fetch? })`, a small durable queue in front
  of the endpoint, so a report written during the outage it describes is not
  lost when the `fetch` fails. Reports are kept in `localStorage` and delivered
  oldest first — when the queue is created, when the browser fires `online`,
  and when the tab becomes visible. Failed attempts back off exponentially
  from one second to five minutes and never flush in parallel; a 4xx drops the
  report (the server has refused it), a 5xx or a network error keeps it. Five
  reports and seven days by default, the oldest evicted first. An item over
  1 MB serialised loses its screenshot and keeps everything else, and a browser
  with no usable `localStorage` degrades to memory-only rather than failing.
  1.0 kB gzipped, with a CI budget of 1024 bytes.
- `keepalive` on `SendOptions`: passed to `fetch` when the serialised body is
  under 60 kB, so a send during unload survives the page closing. The browser
  caps all in-flight keepalive bodies of a page at 64 KiB together, which is
  why it is opt-in and why a report with a screenshot does not use it.
- `onFailure(report, error)` on `SendOptions`, awaited before the error is
  rethrown. It is the seam the queue integration is built on: a consumer can
  enqueue the exact body that failed.
- `queue` on `useBugReport` and on `mountBugbottle`. A failed send is enqueued
  and the reporter sees the ordinary thank-you instead of an error they can do
  nothing about: `status.kind === "queued"` in the hook, and the thank-you
  panel with the queued line in the widget. A 4xx is never queued.
- `queued` in `Messages` and in all eight bundled locales
  ("Saved — it will be sent when you are back online").
- `createQueue` on `window.bugbottle`, and `data-queue` on the script tag:
  present with any value, the panel queues what it cannot send.

### Changed

- The OpenGraph picture is redrawn in the site's light palette: the pale green
  ground and bottle green ink of the page itself, the seal red kept for the
  four marks it carries there. A link preview is pasted into a timeline that
  already chose a background, and the first visit it promises is the light
  one. `site/og.svg` is the source, re-rendered to `site/og.png` at 1200x630.
- `useBugReport` from `bugbottle/react` is now a thin wrapper over
  `createReportState`, subscribed with `useSyncExternalStore`. No behaviour
  changed — the hook's tests are untouched and still pass — and the returned
  object is the same shape, but the actions are the store's own and never
  change identity now. The entry costs 5240 bytes gzipped rather than 5174,
  which is the price of a machine three frameworks share.
- The CI bundle job weighs `bugbottle/vue` and `bugbottle/svelte` against a
  bundle of `buildReport`/`sendReport`/`captureScreenshot`/`pickElement`, and
  budgets the difference at 1536 bytes each: nearly all of an adapter bundle is
  the shared core, and what the adapter itself adds is the number worth
  guarding. The queue check in that job was also missing its `exit 1` and its
  `fi`, which left the whole step unparseable.
- `scripts/build-docs.mjs` groups "Catching render errors (React)", "Opening it
  without a button" and "When the network is down", which shipped without a
  group and had been failing `npm run build:docs` since.
- The CI budgets for `bugbottle/ui` (9216 → 10240 bytes gzipped, measuring
  9849) and `dist/bugbottle.js` (16384 → 17920, measuring 17239), for the
  accessibility pass. The behaviour — the focus trap and return, the radio
  group and its arrow keys, the live region, the two-scheme colours — is about
  0.7 kB; the rest is five new strings, which the script-tag build carries in
  all eight languages. A panel a keyboard user cannot leave is not a smaller
  panel, so this was not a trade worth making the other way.
- The panel's header is a `div` rather than a `<header>`, which browsers and
  axe treat as a banner landmark nested inside the dialog.
- The CI budget for `dist/bugbottle.js` is 16 kB gzipped: the script-tag build
  now carries the queue and the triggers as well, and measures 16.1 kB.
- The CI size budgets for `bugbottle/react` (5120 → 5376 bytes) and
  `dist/bugbottle.js` (14336 → 15360 bytes). The hook grew by the `queued`
  state and its message; the script-tag build carries the whole queue.
- Documentation at [bugbottle.dev/docs/](https://bugbottle.dev/docs/): one page
  per README section, grouped into Get started, Evidence, Server, Privacy,
  Reference and About, with a sidebar that marks the current page, heading
  anchors, a copy button on every code block, previous/next links and an
  "Edit this page on GitHub" link straight to the section it came from.
- `scripts/build-docs.mjs` generates those pages from `README.md` with `marked`
  (pinned devDependency). It runs in a `node:22-alpine` builder stage in
  `site/Dockerfile`, so nothing under `site/docs/` is committed and the README
  stays the only copy of the text. A README section that is not placed in the
  script's grouping fails the build rather than becoming a page nobody links
  to.
- `site/docs.css` and `site/docs.js` for the documentation pages only. The
  landing page's stylesheet is untouched.


- The "Docs" link in the header of both landing pages, and the "Read the docs"
  button in the hero, now point at `/docs/` instead of the README on GitHub.
- `.dockerignore`: the site image is built from the repository root, so
  `node_modules` and `.git` no longer travel to the daemon on every build.
- `bugbottle/triggers`, a new entry point: `onShortcut(combo, handler)` and
  `onUncaughtError(handler, options)`, two listeners and nothing else. The
  combination is written once as `"mod+shift+b"` — `mod` is Command on a Mac
  and Control everywhere else — never fires while the reporter is typing in a
  field or a `contenteditable` region, and is `preventDefault`ed when it
  matches. `onUncaughtError` listens for `error` and `unhandledrejection`,
  describes both the same way, and calls the handler at most once per
  fingerprint per `dedupeMs` (60 000 by default), which is what makes it safe
  to open a panel from. Both return the unsubscribe. Also exposed on
  `window.bugbottle` in the script-tag build.
- `fingerprint(report)` and `stableHash(text)` in `bugbottle` and
  `bugbottle/server`: the type, the message and the first console error,
  hashed with FNV-1a. One identity for a report computed the same way in the
  browser and on the server, so a fingerprint a sink writes down means the same
  thing on both sides. Its own module, imported by nothing in the core entry,
  so it is tree-shaken when nobody deduplicates.
- `mountBugbottle` takes `shortcut` (`"mod+shift+b"` by default, `false` for
  none) and `openOnError` (off by default; `true` or `{ prefill: true }`). An
  uncaught error opens the panel with the type set to bug and the new
  `ui.openedByError` line where the intro usually is — "Something went wrong on
  this page. Want to tell us what you were doing?", translated into all eight
  locales — and with `prefill` the error message in the box, without
  overwriting anything already written. The reporter still presses send.
  `data-shortcut` and `data-open-on-error` do the same from the script tag.
- `BugReportBoundary` and `createRootErrorHandlers` in `bugbottle/react`. The
  boundary catches a render error and renders your `fallback(error, report)`;
  `report()` sends the error, its stack and the component stack as a bug
  report, and nothing is sent until it is called. The root handlers are React
  19's `onCaughtError`/`onUncaughtError` and do send by themselves — there is
  nobody left to ask — once per distinct error per `dedupeMs`. Written with no
  JSX so that the package keeps building with plain `tsc`.
- `handleReport` takes `dedupe: { windowMs, key? }`: a repeat of the same
  report is answered `200 { id, duplicate: true }` with the first one's id,
  without running `store` or the sinks again. The default key is `fingerprint`,
  compared after scrubbing. In memory and per instance, with the same honest
  caveat as the rate limit, and `resetDedupe()` for tests.


- Budgets: `bugbottle/ui` moves from 8192 to 9216 bytes gzipped and the
  script-tag build from 14336 to 15360, because the panel now imports
  `bugbottle/triggers` so that a keyboard shortcut works with no wiring at all.
  Measured 9043 and 15111. `bugbottle/triggers` is budgeted at 1200 and
  measures 1133: the roadmap said 1 kB, and 2.3 kB of dense minified code with
  nothing to share a compression dictionary with does not get there.

### Changed

- The landing page, both languages, is set on one spacing and one type scale
  (`--s-*` and `--t-*` on `:root`) instead of a clamp invented per section, so
  the vertical rhythm is the same everywhere and the measure of running text
  stays around 65 characters. Nothing about the page's structure or voice
  changed.
- The hero screenshot is matted in a frame that carries its own aspect ratio,
  so it cannot shift the hero while it loads, crops to the panel rather than
  the page behind it on a phone, and is taken down a few percent in dark mode
  where a bare light capture used to read as a lamp.
- Dark mode holds two reds rather than one: a deep fill for the primary button
  that carries white text at 5.3:1, and the bright rose kept for the wordmark,
  the stamp and the focus ring, where a full-strength fill was too much light.
- The demo is the centre of the page: it sits on a raised plate, carries the
  largest heading, and says under the payload that nothing is sent and no
  endpoint exists on the host.
- Every code slab, including the demo payload, has a copy button. `demo.js`
  builds it, so the label follows the page language and a browser without a
  clipboard never gets a button that cannot do anything.
- The language switch is a segmented control instead of two links with a slash
  between them, the header carries a Docs link to `/docs/`, and on a phone the
  header is two deliberate rows rather than a wrap. The header is still not
  sticky: the page is one read with no in-page navigation to return to.
- The footer is quieter — one size down, muted throughout, links underlined
  with a hairline rather than shouting.

### Fixed

- `bugbottle/queue` survives a second tab. `localStorage` is shared by every
  tab on the origin and cannot be changed atomically, and the queue read the
  array once and wrote it back whole — so two tabs lost each other's reports,
  flushed the same report twice, and put back reports the other had just
  delivered. Every queued report now gets a random `id` at enqueue, and every
  write re-reads storage and merges by that id instead of replacing the array.
  Before a report goes out it is claimed with a `claimedAt` timestamp that
  tells the other tabs to leave it alone for 30 seconds; a failed delivery
  releases the claim, a successful one removes the report by id from a freshly
  read array. Two tabs that read, decide and write within the same few
  milliseconds can still both claim one report and send it twice — the module
  header and the README say so, and a duplicate is the failure worth having.
  Reports queued by 0.5 have no id and are given one derived from the time they
  were queued, so nothing waiting in storage is lost on upgrade.
- `bugbottle/queue` removes a delivered report by identity rather than by
  position. `deliver` dropped `items[0]` after the `await`, by which time an
  `enqueue` at `maxItems` may have evicted the head — and the report that was
  thrown away was one nobody had sent.
- `destroy()` during an in-flight flush no longer leaves the queue retrying for
  ever. The failure that arrived after `destroy` armed a backoff timer nobody
  would clear, which failed and armed the next one. `flush`, `retryLater` and
  the delivery loop all check the flag now.
- `bugbottle/queue` reads storage before it writes to it. The probe that
  decided whether `localStorage` works was a `setItem`, so a full quota made
  the queue behave as though there were no storage at all — including for the
  reports an earlier visit had already stored, which is exactly the case the
  queue exists for. The probe is a read; a write that fails still turns the
  queue memory-only from that point on, and memory then stays the copy that
  counts.
- The keyboard shortcut stays out of the way of somebody typing inside a shadow
  root — the panel's own textarea above all. A `keydown` that crosses a shadow
  boundary is retargeted to the host, so `event.target` said "the widget" while
  the caret was in a field; the check now reads `event.composedPath()[0]` where
  it exists and follows `document.activeElement` down through every
  `shadowRoot.activeElement`. One consequence is deliberate: `mod+shift+b` no
  longer closes the panel while the caret is in its box. Escape and the close
  button do.
- `BugReportBoundary`'s `report()` is idempotent. A second click while a send
  was in flight filed the same render error twice; it now joins the first send
  and gets the same promise, a click after a successful send does nothing, and
  a failed send can still be retried. The fallback is handed a third argument,
  `sending`, for a button that should say so and be disabled.

## 0.5.0

The receiving release: one function that takes any web Request and turns it
into a validated, scrubbed, delivered report; the network log; masking on by
default in screenshots; and the landing page in its own voice at bugbottle.dev.
No breaking changes.

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 0.9 kB,
`bugbottle/react` 5.0 kB, `bugbottle/ui` 8.0 kB, `bugbottle/breadcrumbs`
1.2 kB, `bugbottle/network` 1.2 kB, `dist/bugbottle.js` 13.7 kB,
`bugbottle/server` validators 0.8 kB.

### Added

- `handleReport(request, options)` in `bugbottle/server`: one receiver that
  turns an incoming web `Request` into a validated report and a `Response`, so
  a Next.js route handler, a Hono route, a Worker, Bun or Deno endpoint is
  three lines. It runs the same `normalise*` helpers the manual path does, then
  `authorize` (false → 401), a body ceiling (`maxBodyBytes`, 4 MB by default,
  checked against `content-length` and counted on the stream → 413), malformed
  JSON and an empty message → 400, optional server-side `scrub`, a `screenshot`
  policy of `"keep"`, `"drop"` or a function that stores the picture and
  returns a `screenshotUrl`, `store`, and ordered `sinks` whose failures are
  collected through `onSinkError` rather than thrown. `respond` replaces the
  default `201 { id }` / `202 {}`, `cors` adds the header and answers
  `OPTIONS`, `rateLimit` answers 429 from an in-memory map (per instance, so
  per serverless isolate — documented as such), and anything unexpected is a
  500 with `onError` called and no internal message in the body.
- `ValidatedReport`, the shape `store` and the sinks receive: every field
  validated, plus `extra` — the top-level keys the client sent that bugbottle
  does not know about, so a tenant id or a build number needs no schema change.
  Strings are clipped to 500 characters, numbers and booleans pass, nested
  objects are dropped, and at most 20 keys are kept.
- `toResend`, `toWebhook` and `toGithub`: sink helpers over the existing
  `sendReportEmail`, `sendReportWebhook` and `createGithubIssue`, so a sink is
  a call rather than an arrow function. They pass the kept screenshot bytes and
  the stored `screenshotUrl` on from the handler.
- `expressHandler(options)` in `bugbottle/server` for Express: it builds a web
  `Request` from `req` — an already-parsed `req.body` when a parser ran, the
  raw stream when none did — and writes the `Response` back onto `res`.
  Structurally typed, so it adds no dependency.
- The server entry is still dependency-free and still tree-shakeable: a
  consumer importing only `normaliseMessage` bundles 603 bytes with esbuild and
  contains neither `handleReport` nor any sink.
- `bugbottle/network`, a network log next to the console buffer: `initNetwork`
  patches `fetch` and `XMLHttpRequest` and keeps the last 30 requests that
  failed (status 400 and up, or no status at all) or took longer than `slowMs`
  (2000 ms by default). `all: true` records everything, `beforeRequest` can
  redact or drop an entry, `maxEntries` bounds the ring, and requests to the
  report endpoint are skipped. `buildReport` attaches them as `network`
  (`includeNetwork: false` leaves them out), `toMarkdown` renders a "Requests"
  table, and `normaliseNetwork` with `MAX_NETWORK_ENTRIES` validates them on
  the server. Its own entry point, 1174 bytes gzipped when it landed, budgeted
  at 1330 in CI after the fixes below.
  Request and response bodies and headers are never recorded, in either
  direction; sensitive query values in the URL are redacted, and a cross-origin
  URL keeps its origin.
- `scrubUrl` in `bugbottle` and `bugbottle/server`: the query-value scrubber on
  its own, so a module can redact a URL without carrying the whole scrubber.
- `window.bugbottle.initNetwork` in the script-tag build, with a `data-network`
  attribute that turns the network log on from the tag. The IIFE budget moves
  from 12288 to 14336 bytes gzipped to make room; the bundle measures 13754.

- Screenshot masking, on by default. `captureScreenshot` now hides what the
  reporter typed before it calls the renderer and puts it back in a `finally`,
  so a picture taken of a checkout or an intake form never carries the card
  number or the diagnosis, and a renderer that throws still leaves the page
  usable. Input and textarea values become bullets of the same length,
  placeholders are cleared, `contenteditable` text is bulleted, elements marked
  `data-bugbottle-mask` have their text bulleted, and elements marked
  `data-bugbottle-block` are covered by a solid overlay in their `--bb-mask`
  colour (default `#999`). The attribute names are rrweb's, so annotations made
  for session replay are reused as they are. The element is kept in every case
  — only its content is hidden — so the layout of the screenshot is unchanged,
  which is what makes this different from `exclude`. Narrow it with
  `mask: { inputs, selector, block, colour }` or switch it off with
  `mask: false`; `useBugReport` and `mountBugbottle` pass the option through and
  the script-tag build reads `data-mask="off"`.

- `captureScreenshot` options `pixelRatio` (force a scale and skip the
  estimate), `bytesPerPixelEstimate` (tune the estimate for pages that compress
  unusually well or badly, default `DEFAULT_BYTES_PER_PIXEL_ESTIMATE`, half a
  byte per CSS pixel) and `onCapture`, a callback given the `pixelRatio`,
  data-URL `length`, number of `attempts` and elapsed `ms` of every capture —
  including one that ends in `ScreenshotTooLargeError`. That callback is how an
  application measures what capture costs it.

### Changed

- The canonical address of the project is now <https://bugbottle.dev>: canonical,
  `hreflang` and OpenGraph tags on the landing page, the README link and the
  npm `homepage` point there. bugbottle.mahoje.dk stays as an alias for the
  same deployment.

- The budget for `bugbottle/react` rises from 4 kB gzipped to 5 kB and the
  script-tag build from 12 kB to 13 kB, both measured after masking landed
  (4.5 kB and 12.2 kB). Masking costs about 0.65 kB gzipped and the hook pays
  it whether or not it takes pictures, because it is on by default: a privacy
  default a consumer has to remember to import is not a default. The bare core
  is unchanged at 0.9 kB — `captureScreenshot` and the masking behind it are
  tree-shaken out of a bundle that only builds and sends reports.

- `captureScreenshot` now picks the scale before rendering rather than
  discovering it afterwards. Halving `pixelRatio` only changes the final raster
  step — walking the DOM and inlining its styles happens identically either way
  — so an oversized first render used to roughly double the reporter's wait for
  nothing. The capture area (`root.scrollWidth * root.scrollHeight`) is now
  turned into an estimated data-URL length, and a page whose estimate is over
  the ceiling starts at half scale. The single retry stays as the safety net,
  so correctness never depends on the estimate being right. No change to the
  public contract: the same call with the same arguments still returns a data
  URL or throws `ScreenshotTooLargeError`.

- The landing page in `site/` is rewritten in both languages to read like a
  person wrote it (issue #19). Copy is first person where it matters — a
  two-line "why I built it" in the hero, and a colophon signed by name — short
  and concrete instead of summarising itself. The hero shows a real capture of
  the panel (`site/panel.png`, taken headless from this page at 2x) next to
  the text, with `width`/`height` set so it costs no layout shift, replacing
  the fully synthetic report card. The case-file idea from the previous
  redesign is down to one detail — a small stamp under the hero holding the
  version, the release date and a link to what changed — with the margin rule
  and dark code slabs it introduced kept because they still work. No gradient
  blobs, no three-card feature row: the six things it does are one column of
  terms and definitions, and "get started" is three rows (bundler, one script
  tag, WordPress plugin), sized to what each needs rather than forced into
  equal columns. Section reveals still use one `IntersectionObserver` in
  `demo.js`, set from JavaScript so a page without it hides nothing, off under
  `prefers-reduced-motion`. The size table and the stamp read from measured
  numbers, noted where to update them at a release. Danish is rewritten rather
  than translated. Still no framework, no analytics, no cookies and no
  external request: system fonts only, under 50 kB of HTML, CSS and
  JavaScript.
- `site/og.png` (1200x630, rendered from the new `site/og.svg` with headless
  Chrome) is wired as `og:image` and `twitter:image` on both pages, and the
  Dockerfile copies it into the image.

### Fixed

- `data-bugbottle-block` on a replaced element — `img`, `canvas`, `video`,
  `iframe`, `input`, `embed`, `object`, `svg` — did nothing at all. None of
  them render children, so the overlay was appended into a tree nobody paints
  and the region was photographed in full while looking annotated. Those
  elements are now hidden for the render and covered by a sibling rectangle
  positioned over the box they occupied; both are put back afterwards.
- Inputs inside a web component were photographed unmasked.
  `querySelectorAll` does not cross a shadow boundary, but a renderer clones
  `shadowRoot` children into the picture, so every pass now walks open shadow
  roots as well. Closed roots still cannot be masked, and the README says so.
- An overlay could be painted over from underneath: a positioned descendant of
  a blocked element, or content overflowing its box, came out on top. The
  overlay now carries `z-index: 2147483647` and the blocked element is clipped
  with `overflow: hidden` for the length of the render.
- A mask pass that threw part way through left the page half masked. `applyMask`
  now unwinds what it had already changed before rethrowing, and
  `captureScreenshot` applies the mask inside the `try` that its restoring
  `finally` belongs to. Masking is the one part of a capture that does not fail
  open: an unmasked picture is worse than no picture.
- A reused `XMLHttpRequest` recorded itself once per `send` it had ever had.
  The `loadend` listener was registered on every `send`, so the second request
  produced two entries and the third produced three, each copy timed from an
  older `send` and therefore longer than the request took. The listener is now
  registered once per instance and reads the start time from the record `send`
  sets.
- `resetNetwork` uninstalled other people's instrumentation. It assigned the
  originals back over whatever was in `fetch`, `open` and `send`, which
  silently removed any wrapper another library had put on top of ours. It now
  restores only what is still ours and leaves a stranger's wrapper alone;
  `record` is a no-op while nothing is initialised, so a wrapper still calling
  through costs a function call and nothing more.
- A request still in flight when the recorder was reset used to land in the
  buffer of the next `initNetwork`. Each patch now remembers which run it
  belongs to, and `initNetwork` starts from an empty buffer.
Nine findings from a review of `handleReport` and the Express adapter, each
with a test. None of them changes a documented option, and all of them are
about what an endpoint on the public internet is handed rather than about what
a well-behaved browser sends.

- The Express adapter read a raw stream without a ceiling: a route mounted
  without `express.json({ limit })` buffered whatever arrived. It now counts
  the bytes against `maxBodyBytes`, calls `req.destroy()` and answers 413
  without reading the rest.
- The Express adapter decoded every chunk on its own, so a multi-byte
  character split across a chunk boundary — `æøå` in a Danish report — arrived
  as replacement characters. One streaming `TextDecoder` now spans the whole
  read and is flushed at the end.
- The Express adapter treated the "" that an already-drained `IncomingMessage`
  reads as a body, so `express.json()` plus an empty request answered "Malformed
  JSON" instead of "Write a message first". An empty read now means the same
  as no read at all.
- A `screenshot` store function that threw took the whole report with it: the
  reply was 500 and nothing was stored. It now reaches `onError`, and the
  report is stored and delivered without a `screenshotUrl`.
- A `screenshot` store function was also handed to `store` as bytes, against
  the documented rule that only `"keep"` hands bytes on. `store` now sees the
  same thing the sinks do.
- The rate-limit key was whatever the `key` function returned, which by default
  is an attacker-controlled header. It is clipped to 64 characters, and the
  bucket map is hard-capped at 10 000 entries — expired buckets evicted first,
  then the oldest — rather than only pruning expired ones. The README now says
  plainly that the default key is only a limit behind a proxy that overwrites
  `x-forwarded-for`, and shows a `key` that counts a session instead.
- A sink that never answered held the request open for as long as it liked.
  `sinkTimeoutMs` (10 s by default) abandons it and counts it in `sinkErrors`
  and `onSinkError` like a sink that threw; the sink context now also carries
  the `AbortSignal` so a `fetch` can be dropped with it.
- A body that dribbled in a byte at a time never tripped the size cap and was
  read for ever. `bodyTimeoutMs` (15 s by default) bounds the whole read and
  answers 408.
- A CORS preflight answered with a fixed `Access-Control-Allow-Headers`, so a
  client sending its own header (a CSRF token, a tracing id) was refused by the
  browser. It now reflects `access-control-request-headers` when the browser
  asks, and keeps the old list when it does not.
- `__proto__` and `constructor` in `extra` were only excluded by accident of
  how assignment behaves; `constructor` was written as an own property.
  `collectExtra` now rejects them, and `prototype`, by name.
- Anything that is not a `POST` (and not a preflight) is answered with 405,
  rather than being validated as an empty body and answered with 400.

## 0.4.0

The evidence release: what happened before, where it went, and what must never
leave the browser. One breaking change: `Locale` now requires an `email` key
(every bundled locale has it; a hand-written one needs the two strings).

Sizes (esbuild, minified + gzipped, without `html-to-image`): core 0.8 kB,
`bugbottle/react` 3.9 kB, `bugbottle/ui` 6.9 kB, `bugbottle/breadcrumbs`
1.2 kB, `dist/bugbottle.js` 11.6 kB, `bugbottle/server` 0.3 kB (validators
only; sinks and `toMarkdown` are tree-shaken when unused).

### Added

- `dist/bugbottle.js`, a self-contained IIFE for pages with no build step:
  one `<script src>` from jsDelivr mounts the panel. The tag configures it —
  `data-endpoint` (required, and the switch that turns the auto-mount on),
  `data-locale`, `data-position`, `data-primary`, `data-brand`, `data-logo`,
  `data-trigger`, `data-scrub` and `data-extra` — and the same building blocks
  are on `window.bugbottle` (`mount`, `initConsoleBuffer`, `initBreadcrumbs`,
  `locales`, `resolveLocale`, `scrubReport`, `buildReport`, `sendReport`,
  `pickElement`, `version`) for the programmatic case. Built from
  `src/global.ts` by `scripts/build-iife.mjs`, which `npm run build` now runs
  after tsc; esbuild is a pinned devDependency. 11.1 kB gzipped, budgeted in CI
  at 12 kB. There is no screenshot renderer in this build — `html-to-image` is
  larger than the rest of the bundle together — so a page that wants pictures
  loads it itself and passes it to `window.bugbottle.mount`.
- `sendReportEmail(report, options)` in `bugbottle/server`: renders the report
  with `toMarkdown` and emails it through Resend — subject from the report
  title and the locale, text and a minimal HTML body, the decoded screenshot
  attached as `screenshot.png`. The API key is an argument; the sink never
  reads the environment itself.
- `sendReportWebhook(report, options)` in `bugbottle/server`: posts the report
  to a webhook as `json` (the report plus a `markdown` field), `slack`
  (`{ text }`) or `discord` (`{ content }`, clipped to 2000 characters).
- `createGithubIssue(report, options)` in `bugbottle/server`: files the report
  as a GitHub issue with the `toMarkdown` body, optional `labels` and a title
  from the report type and its first line, and resolves with `{ number, url }`.
  The issues API cannot take an attachment, so a screenshot has to be stored by
  you and passed as `screenshotUrl` to be linked from the body.
- `SinkError`, thrown by every sink with the HTTP status and the response body
  when the service answers with anything but success.
- An `email` key on every bundled `Locale` (`subject` with a `{title}`
  placeholder, and `intro`), so a forwarded report is worded in the team's
  language. `Locale` now requires it; a hand-written locale needs the key.
- `fetch` option on `mountBugbottle`, passed through to `sendReport`. The panel
  could already be pointed at any endpoint, but not at a function — which is
  what a demonstration with no server behind it needs.
- `site/`: the landing page for <https://bugbottle.mahoje.dk> in English and
  Danish, served by `nginx:alpine` from `site/Dockerfile`. It is built from the
  repository root so the committed `dist/` can be copied into the image: the
  panel on the page is the real `bugbottle/ui`, mounted with a fake `fetch`
  that renders the payload it was given through `toMarkdown`. Nothing in
  `src/` refers to it and the npm package is unchanged.
- `scrubReport(report, options)` in the core entry and in `bugbottle/server`,
  with `BUILTIN_SCRUBBERS`: email addresses, `Bearer <token>`, JWTs, 13 to 19
  digit card numbers that pass Luhn, IBANs, and query values whose key matches
  `/token|key|secret|password|auth/i`, replaced with `[redacted]` across the
  message, console entries, `context.url`, element text, `href` and `data-*`
  attributes, and `breadcrumbs` if present. `patterns` adds your own, `keep`
  switches a built-in off, `replacement` changes the text. Pure, never throws,
  and leaves the screenshot alone. It lives in its own module that nothing else
  imports, so the core entry stays under a kilobyte gzipped when it is unused.
- `beforeSend` on `SendOptions`, mirroring Sentry: the last look at a report
  before it leaves the browser. Returning `null` drops it, and `sendReport`
  then resolves `{ dropped: true, body: null, response: null }` without making
  a request. `SendResult.response` is now `Response | null` for that reason.
- `scrub` on `BuildReportInput`, a function seam applied to the assembled body —
  pass `scrubReport` itself. Both options are forwarded by `useBugReport` and
  `mountBugbottle`; a dropped report shows the reporter the ordinary
  thank-you.
- **`bugbottle/breadcrumbs`** — a short timeline of what the reporter did
  before they reported: clicks (a short selector and the element's visible
  text), navigation (`pushState`, `replaceState`, `popstate`, `hashchange`,
  path and query only), form submits (the selector only) and visibility
  changes. A ring buffer of 30, its own entry point, and no cost to an
  application that does not import it: `initBreadcrumbs` registers a getter
  that `buildReport` reads, so the core never imports the recorder.
  Input values are never recorded, `[data-bugbottle]` is skipped entirely,
  `[data-bugbottle-mask]` records a selector with no text, and
  `beforeBreadcrumb(crumb)` can drop or rewrite anything before it is stored.
- `buildReport` gains `includeBreadcrumbs` (default: attach them whenever the
  buffer is recording), `normaliseBreadcrumbs` and `MAX_BREADCRUMBS` join the
  server validators, and `toMarkdown` renders a "What happened before" list
  between the elements and the console.

### Fixed

- A `beforeBreadcrumb` that throws no longer throws out of the host
  application's `pushState`: the hook is wrapped, a throw drops the crumb, and
  nothing the recorder does can fail a navigation.
- Text inside a `contenteditable` region, and an `<option>` label, are masked
  the way `<input>` already was — a rich-text editor is a field whatever tag it
  uses, so a click there records the selector only.
- Navigations that go nowhere are no longer recorded. A `hashchange`, or the
  `replaceState` a query-sync library fires on every keystroke, used to push a
  crumb per event and evict the ones worth reading.
- `maxEntries: 0` records nothing instead of removing the bound (`slice(-0)` is
  the whole array), and a NaN or otherwise unusable value falls back to the
  default 30.
- `scrubReport` now scrubs every element attribute except `id`, `role` and
  `type`. `aria-label`, `title`, `name` and `placeholder` are recorded by
  `describeElement` and routinely name a person.
- `sendReport` starts the `timeoutMs` clock before `beforeSend`, so an async
  hook that never settles raises `SendTimeoutError` instead of leaving the form
  on "sending" for ever.
## 0.3.1

### Added

- `toMarkdown(report, options)` in `bugbottle/server` (and the core entry):
  renders a raw or validated report as Markdown — title from the first line,
  facts table, pointed-at elements, collapsible console — for an issue body,
  a chat message, or the digest a coding agent reads each morning. Accepts
  the raw request body and never throws.

First release published from CI through npm Trusted Publishing.

## 0.3.0

First npm release. The API changed from 0.2 in two places: `captureScreenshot`
takes a renderer as its first argument, and `useBugReport` needs
`screenshot: htmlToImage` (from `bugbottle/html-to-image`) to take pictures.
Everything else is additive.

### Changed

- **`captureScreenshot(renderer, options)`** — the renderer is passed in.
  An earlier version used a dynamic `import("html-to-image")` in the core;
  esbuild refused to bundle any project that had not installed the package,
  so "optional" was not true in practice. `bugbottle/html-to-image` is the
  only module that imports it.
- `useBugReport` takes `screenshot?: ScreenshotRenderer`; without it
  `canScreenshot` is false and the screenshot state stays off.
- The 15 s submit timeout from 0.2.0 moved into `sendReport` as `timeoutMs`
  (default 15 000, 0 disables) and now throws `SendTimeoutError`.

### Added

- `pickElement`, `describeElement`, `buildSelector` — let the reporter click
  the element the report is about; the payload carries a short selector, the
  tag, visible text, page position and useful attributes. Escape cancels,
  the click is swallowed, `[data-bugbottle]` cannot be picked.
- `buildReport` and `sendReport` — framework-agnostic assembly and POST, with
  `headers`, `credentials`, `signal`, `timeoutMs` and a `SendFailedError`
  carrying the status and parsed body.
- `useBugReport`: `elements` / `pickElement` / `removeElement` / `cancelPick`,
  `canScreenshot`, `reset`, `isPicking`, `headers`, `credentials`,
  `timeoutMs`; stable callback identities; a pick is aborted on unmount.
- `bugbottle/server`: `normaliseConsole`, `normaliseElements`, and the
  `MAX_CONSOLE_*` / `MAX_ELEMENT*` limits.
- **`bugbottle/ui`** — `mountBugbottle`, an optional ready-made panel in a
  shadow root: floating trigger (or your own), report types, message,
  screenshot checkbox, element picker, thank-you state. Themed through
  `theme` / `--bb-*` custom properties, branded with `brand.name` and
  `brand.logo`, positioned in any corner, light/dark/auto. About 6 kB gzipped.
- **`bugbottle/locales`** — `Locale` objects for en, da, sv, nb, de, nl, fr,
  es with every reporter-facing string; `resolveLocale(navigator.language)`;
  `texts` and `messages` overrides on the widget, `messages` on the hook.
- Package metadata for npm (`author`, `main`/`types` fallbacks, keywords,
  `./package.json` export), CLAUDE.md, CONTRIBUTING, SECURITY, this
  changelog, `docs/roadmap.md` and the research behind it.
- CI: Node 22 and 24 matrix, `npm pack --dry-run`, and a job that bundles
  every entry without `html-to-image` and fails if `bugbottle/react` exceeds
  3.5 kB gzipped. A tag-triggered release workflow with npm provenance.

### Fixed

- `decodeScreenshotDataUrl` threw a raw DOMException on malformed base64
  instead of `InvalidScreenshotError`.
- `normaliseMessage` and `normaliseContext` passed null bytes through, which
  Postgres refuses.
- `resetConsoleBuffer` left the window `error`/`unhandledrejection` listeners
  attached, so a later `initConsoleBuffer` recorded uncaught errors twice.
- The GitHub Action test resolved its path incorrectly on Windows.
- The vanilla example imported `bugbottle@0.1` from esm.sh, which did not
  exist; it now serves the repository's `dist/`.

Sizes (esbuild, minified + gzipped, without `html-to-image`): `bugbottle`
core 0.6 kB, `bugbottle/react` 3.4 kB (React external, element picker
included), `bugbottle/ui` 6.4 kB, one locale 0.5 kB, `bugbottle/server`
0.8 kB.

## 0.2.4, 0.2.3, 0.2.2, 0.2.1

Tags only, no npm release. A GitHub Action (`mahope/bugbottle@v0`) that
validates exported JSON reports in CI, with its entry point and
absent-context handling fixed across the patch tags; `dist/` committed so the
package installs from GitHub and serves from jsDelivr without npm.

## 0.2.0

- `useBugReport` aborts the submit after 15 s so a hung endpoint cannot leave
  the form stuck on "sending".
- `examples/vanilla-js`: a complete no-build round trip.

## 0.1.0

First cut. Extracted from the feedback bubble in two production apps.

### Added

- `initConsoleBuffer` — ring buffer of `console.error`/`console.warn`, uncaught
  errors and unhandled rejections. `log` and `debug` are deliberately ignored.
- `captureScreenshot(renderer)` — DOM-to-PNG with a half-scale retry when the
  first render exceeds the size ceiling. The renderer is injected;
  `bugbottle/html-to-image` provides the `html-to-image` one.
- `pickElement`, `describeElement`, `buildSelector` — let the reporter click
  the element the report is about; the payload carries a short selector, the
  tag, visible text, page position and useful attributes. Escape cancels,
  the click is swallowed, `[data-bugbottle]` cannot be picked.
- `buildReport` and `sendReport` — framework-agnostic assembly and POST, with
  `headers`, `credentials`, `signal` and a `SendFailedError` carrying the
  status and parsed body.
- `useBugReport` (`bugbottle/react`) — headless hook over the above, with
  `elements` / `pickElement` / `removeElement`, `canScreenshot`, `reset`, and
  stable callback identities.
- `bugbottle/server` — `normaliseMessage`, `normaliseContext`,
  `normaliseConsole`, `normaliseElements`, `isReportType`,
  `decodeScreenshotDataUrl`, and the `MAX_*` limits.

### Design notes

- `html-to-image` is not imported anywhere except `bugbottle/html-to-image`.
  An earlier draft used a dynamic `import()` in the core; esbuild refused to
  bundle any project that had not installed the package, so "optional" was
  not true in practice. The renderer is now passed in.
- Server validators strip null bytes and wrap `atob` failures in
  `InvalidScreenshotError`, so a route handler only ever has to catch one
  error type.
- Sizes measured with esbuild, minified and gzipped, without `html-to-image`:
  `bugbottle` core 0.6 kB, `bugbottle/react` 3.2 kB (React external, element
  picker included), `bugbottle/server` 0.8 kB.
### Fixed

- The offline queue could skip a retry. The backoff timer called `flush`, and
  `flush` refuses to run while the clock reads before the attempt it scheduled;
  a timer firing a millisecond ahead of `Date.now()` therefore did nothing, and
  the report waited for the next `online` or visibility event. The timer now
  clears the backoff before it flushes. Found by the release run of 1.0.0, whose
  own test for the signed retry hit exactly that millisecond.

