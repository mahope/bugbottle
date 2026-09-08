# Roadmap

Short version. The reasoning is in `research-features.md` and
`research-alternatives.md` (September 2026).

Guiding rule, borrowed from Sentry: every addition is a tree-shakeable module
you import, never a boolean flag in the core. CI enforces the budgets: the
bare core under 1.5 kB gzipped, `bugbottle/react` under 6 kB, `bugbottle/ui`
under 11.5 kB, `bugbottle/annotate` under 2 kB, `bugbottle/breadcrumbs` under
1.5 kB, `bugbottle/network` under 1.3 kB, `bugbottle/queue` under 1.3 kB,
`bugbottle/perf` under 1.25 kB, `bugbottle/triggers` under 1.3 kB,
`bugbottle/vue`, `bugbottle/svelte` and `bugbottle/solid` under 1.5 kB each
over the shared core, `bugbottle/sign` under 512 bytes, `bugbottle/shake` and
`bugbottle/rrweb` under 768 bytes each, the script-tag build under 24 kB and
its slim twin under 20.5 kB. The core budget was 1 kB until 0.6, when stack
frames and the wider context added about 0.45 kB that every consumer pays for.

## Already shipped

**0.3** — console buffer, page context, injectable screenshot renderer,
element picker (`pickElement`), framework-agnostic `buildReport`/`sendReport`,
server validators for every field, eight locales (`bugbottle/locales`), the
optional themed panel (`bugbottle/ui`), `toMarkdown` for issue bodies and
agent digests. The panel has since had an accessibility pass — focus trap and
return, a `radiogroup` with arrow keys, named controls, live-region
announcements, contrast in both schemes — audited with `axe-core` at zero
violations (`npm run a11y`).

**0.4** — sinks in `bugbottle/server` (Resend email, json/Slack/Discord
webhook, GitHub Issues), `bugbottle/breadcrumbs` (clicks, navigation,
submits, visibility, with `beforeBreadcrumb` and masking), `scrubReport` with
built-in patterns and `beforeSend`, the one-script-tag build with `data-*`
auto-mount, screenshot scale chosen up front with `onCapture` timing, email
strings in every locale, hook tests on happy-dom, the landing page at
bugbottle.dev in English and Danish.

**0.5** — screenshot masking: field values, `contenteditable` text,
`data-bugbottle-mask` text and `data-bugbottle-block` regions are hidden while
the picture is taken and restored afterwards, on by default, `mask: false` to
switch it off. rrweb attribute names. And `bugbottle/network`: the failed and
slow requests before the report, `fetch` and `XMLHttpRequest` patched, no
bodies and no headers ever, URLs scrubbed, `normaliseNetwork` and a
"Requests" table in `toMarkdown`. And `handleReport` in `bugbottle/server`:
one universal receiver from web `Request` to `Response` — authorisation, a
body ceiling, every validator, optional scrubbing, a screenshot policy,
`store` and ordered sinks with `toResend`/`toWebhook`/`toGithub`, CORS and an
in-memory rate limit — with `expressHandler` for Express. Hardened after a
review: a body deadline as well as a body ceiling, a per-sink deadline, a
capped and clipped rate-limit map, 405 for anything that is not a POST, and a
screenshot store that may fail without taking the report with it.

**0.6** — stack frames on uncaught errors and unhandled rejections
(`ConsoleEntry.stack`, at most ten `{ file, line, col, fn? }`, one parser for
V8, Firefox and Safari, never any source text), and six optional context facts:
language, time zone, screen with pixel ratio, colour scheme, online state and
effective connection type — each guarded, each clipped by `normaliseContext`,
all of them in the facts table and in the schema.

**0.6** — `bugbottle/perf`: the Web Vitals the browser already measured (LCP,
CLS, INP with `first-input` as the fallback), the navigation milestones (TTFB,
DOM content loaded, load), long tasks by count and total, and the JS heap where
Chromium exposes it — all from buffered `PerformanceObserver` entries, with no
`web-vitals` dependency. Beside it a storage snapshot: `localStorage` and
`sessionStorage` key names with value lengths, and cookie names, capped at 50
keys per store and 100 cookies. Never values, except the keys named in
`allowValues`, and never a cookie value on any setting. `normalisePerf` and
`normaliseStorage` on the server, both blocks in the schema, a "Performance"
table and a collapsed "Storage" block in `toMarkdown`, and `scrubReport` over
the allow-listed values and the cookie names.

**0.6** — `bugbottle/shake`: `onShake(callback, options?)`, a `devicemotion`
detector with the gravity filtered out — three crossings of 15 m/s² with
alternating direction inside a second, then a three-second cool-down, and
nothing measured while the page is hidden. `requestShakePermission()` returns
`"granted"`, `"denied"` or `"unsupported"` and is the only thing that ever
prompts, from a button the application owns, because iOS 13 and later gate
motion behind a user gesture in Safari alone. The panel takes the detector the
way it takes the annotator — `shake: onShake`, or `{ on: onShake, threshold,
cooldownMs }` — and `data-shake` switches it on from the script tag. 685 bytes
gzipped against a 768-byte budget; the panel pays 94 bytes of wiring and none of
the module.

**0.8** — `jiraSink` and `gitlabSink`, for the teams on neither GitHub nor
Linear. Jira is the only sink that does not send Markdown: REST v3 takes the
Atlassian Document Format, so `buildJiraDescription` renders the report as a
node tree — a paragraph, a bullet list of facts and the element, a code block
of the last twenty console entries — and a refused create names the field,
because Jira's `errorMessages` and its per-field `errors` are both read.
`gitlabSink` sends the Markdown verbatim, defaults to gitlab.com with `host`
for a self-hosted instance, URL-encodes a namespaced project id into the one
segment, and comma-joins the labels. Neither takes an attachment: Jira wants a
multipart request against the created issue and GitLab a separate upload whose
answer is then referenced from the description, so both are a later job and the
screenshot travels as `screenshotUrl` in the meantime. The validator-only
`bugbottle/server` bundle is unchanged at 528 bytes gzipped.

**0.8** — `bugbottle/rrweb`: `attachRrweb(record, { seconds, maxBytes })`, a
rolling replay buffer over the application's own rrweb `record` — an adapter,
not a recorder, with rrweb neither imported nor depended on. A full snapshot
every ten seconds is what makes the buffer trimmable, since a replay can only
be cut at a checkout; whole checkout groups are dropped, oldest first, when
they fall outside the window and again over `maxBytes`. `maskAllInputs` is on
by default and the screenshot markers map onto rrweb's own selectors, because
the scrubber cannot walk somebody else's event format. `normaliseReplay` and a
1 MB ceiling on the server, `replay: "keep" | "drop"` on `handleReport`, one
line in `toMarkdown`, `ReplayCapture` in the schema. 711 bytes gzipped against
a 768-byte budget, and 19 bytes of registry read in the core.

**0.6** — `report.schema.json` generated from the types by
`scripts/build-schema.ts`, shipped in the package and served at
bugbottle.dev/schema/report.json, so a receiver can be built in any language
without the library. And the Linear sink (`createLinearIssue`, `toLinear`).

**0.6** — `bugbottle/queue`: an offline queue in `localStorage` with
exponential backoff, flushed on `online`, on returning to the tab and on
creation, dropping what the server refuses and keeping what it could not
answer. Plus `keepalive` and `onFailure` on `sendReport`, a `queue` option on
the hook and the widget with a `queued` status and locale message, and
`data-queue` on the script tag.

**0.6** — `bugbottle/triggers`: a keyboard shortcut (`mod+shift+b`, quiet
while the reporter is typing) and an opt-in auto-open on uncaught errors,
deduplicated by fingerprint so a render loop opens one panel. `shortcut` and
`openOnError` on `mountBugbottle`, `data-shortcut` and `data-open-on-error` on
the script tag, and `ui.openedByError` in all eight locales. `BugReportBoundary`
and React 19's `createRootErrorHandlers` in `bugbottle/react`. And the shared
`fingerprint(report)`, which `handleReport` uses for `dedupe: { windowMs }` —
a repeat answers 200 `{ id, duplicate: true }` without storing or delivering it
twice.

**0.6** — `bugbottle/vue` (`useBugReport`, a composable over refs),
`bugbottle/svelte` (`createBugReport`, a readable store plus the actions) and
`bugbottle/solid` (`createBugReport`, accessors torn down with the owner), over
the new framework-agnostic `createReportState` in `src/report-state.ts` that
the React hook was refactored onto — one state machine, four bindings, about
1.3, 1.2 and 1.27 kB gzipped over the core a form pays for anyway. All three
peers are optional.

**0.6** — `bugbottle/sign`: an optional HMAC-SHA-256 over `<timestamp>.<body>`
with a shared key (`createSigner`, WebCrypto, 366 bytes gzipped), a `sign` seam
on `sendReport` and every adapter, `data-sign-key` on the script tag, and
`signature` on `handleReport` — key rotation, a five-minute skew window, a
constant-time compare and a replay cache, all four failures answering one
`401 { error: "Bad signature" }`. Documented honestly: a key in the browser is
public, so it is spam deterrence beside a rate limit and never authentication —
which is also why the replay cache is bounded per signed second rather than
globally, and why `signature.replayStore` exists for the deployments that need
one answer across several instances.

**0.6** — `bugbottle/annotate`: `createAnnotator(canvas, dataUrl, options)`,
a rectangle, an arrow and a blur over the attached picture, with undo, pointer
and keyboard handling and a PNG export, in about 1.4 kB gzipped and with no
dependency. The blur pixelates in 12px blocks by reading the region back out
of the canvas, so the pixels are gone from the export rather than covered up —
it is the privacy tool as much as the marking one. The panel gained the "Edit
picture" flow over it: a labelled toolbar, the tools as a `radiogroup`, focus
back to the button that opened it, eight new strings in eight languages. The
panel does not carry the annotator, though — it takes `createAnnotator` as an
option, the same seam as `screenshot`, `scrub` and `sign`, so an application
that never marks a picture never bundles the canvas editor. The script tag is
the build that carries everything and hands it in itself, which is why
`data-annotate="off"` still switches the button off there.

**0.7** — `slackSink` and `discordSink` in `bugbottle/server`: one structured
message per report over an incoming webhook, Block Kit on one side and an
embed on the other, with the facts as fields, five console entries, the stored
screenshot as a picture and a link to the full report. Every Block Kit and
embed limit is a clip rather than a failure. Server-only, so they cost a
browser bundle nothing. Microsoft Teams is the same shape over Adaptive Cards
and is a later job: its incoming webhooks are being retired in favour of
Workflows, so the connector to write against is not the one to write today.

**0.8** — the optional contact field: `contact` on the report, off by default
everywhere, so a team can answer the person who wrote "the save button does
nothing". Free text — an address, a phone number, a handle — trimmed and
clipped at 200 characters, in the schema, in `createReportState` and all four
adapters, and in the panel as `contact: false | true | "required"`, where
`required` refuses a submit through the inline error an empty message already
uses. Three locale strings in eight languages and `data-contact` on the script
tag. It earns its keep at the far end: `reply_to` on the Resend mail when it
looks like an address, `contexts.feedback.contact_email` in Sentry on the same
test, a fact row in `toMarkdown` and so in the GitHub, GitLab and Linear
issues, the same row built by hand in the Jira document, and a
first field in Slack and Discord. `scrubReport(report, { contact: true })`
takes the line out whole for the teams that keep reports somewhere public.

**0.8** — `rateLimit.rateLimitStore` and `dedupe.dedupeStore` beside
`signature.replayStore`, so all three things `handleReport` remembers between
requests are seams rather than a `Map` in one process, and a fleet behind a
load balancer answers as one endpoint. `hit(key, windowMs)` for the limit,
`get`/`set(key, entry, expiresAt)` for the dedupe, sync or async, no dependency
and nothing bundled — the README shows a Redis-shaped example of each under
*Running more than one instance*. Both fail open, where the replay store fails
closed: an honest report is never refused because a shared store blinked.

**Alongside** — a second design pass over bugbottle.dev: two typefaces of its
own (Newsreader and Source Sans 3, served from the site rather than from
Google, so the page still makes no external request), one grid under the
landing page, the screenshot warning printed on the dark ground the code slabs
use, the documentation carrying the landing page's own header with a topic
list that collapses on a phone, and a language switch in the footer. Audited
with `scripts/a11y-site.mjs` — six pages, two colour schemes, zero violations
and no console message — and Lighthouse mobile at 97 with no layout shift.

**Alongside** — search over the documentation, from a field at the top of the
sidebar. The index is one entry per page and per heading, generated beside the
pages by `scripts/build-docs.mjs` and fetched on the first focus of the field
rather than with the page; matches are ranked title, heading, prose, top eight.
The field is built by `site/docs.js`, so a reader without JavaScript gets the
topic list they had before rather than a box that cannot answer. Documented in
`site/README.md` under *The search*.

**Alongside** — `dist/bugbottle.slim.js`, a second script-tag build: the same
panel and all eight locales without the annotator, the timings snapshot, the
shake gesture and the network log. 20.5 kB gzipped against the full build's
23.9. `data-annotate`, `data-perf`, `data-shake` and `data-network` are read,
ignored and warned about once on the console in English. Both files come out of
`scripts/build-iife.mjs` with the same settings and share their `data-*`
reading; 18 kB was the target and was not reachable with the locales kept —
they and the panel are two thirds of the file, and neither shrinks by dropping
a recorder.

**Alongside** — the WordPress plugin `mahope/bugbottle-wordpress` (panel plus
endpoint, private post type, admin, email, Danish and English), and the GitHub
Action `mahope/bugbottle@v0` that validates exported reports in CI.

**Alongside** — `examples/inbox`: a dependency-free Node server that receives
reports with `handleReport`, writes each one to disk as JSON beside its PNG,
and serves a read-only inbox — list, detail with the rendered Markdown and the
picture, copy as Markdown, delete — behind one password from `INBOX_PASSWORD`,
which it refuses to start without. The smallest honest answer to the thing the
comparison page says bugbottle lacks: a place the report lands. An example, not
a product, and never a hosted one — no accounts, no search, no assignment.

## 0.5 — evidence and delivery

- `fetch(..., { keepalive })` with `sendBeacon` fallback; offline queue in
  `localStorage`, flushed on `online`.
- Rate limit by fingerprint. (Dedup by fingerprint shipped, client and server.)
- `report.schema.json` generated from the types, so a receiver can be built
  without the library.

**0.6** — `sentrySink` in `bugbottle/server`: one envelope per report on the
DSN's ingest endpoint, so a team already running Sentry — or GlitchTip, or
Bugsink — can make bugbottle the feedback layer over it. The event carries a
`contexts.feedback`, the console buffer, the breadcrumbs and the recorded
requests as one sorted breadcrumb timeline, the pointed-at elements as `extra`,
and the screenshot as an attachment item in the same envelope, which no other
sink can do. A hundred breadcrumbs, 8 kB of message and a megabyte of envelope,
all of them clips rather than failures and each named on the event when it
bites. No SDK dependency.

## 0.6 — adapters and triggers

- Solid adapter. (Shipped as `bugbottle/solid`, beside Vue and Svelte; see
  "Already shipped".)
- Shake-to-report in its own entry. (Shipped as `bugbottle/shake`; the keyboard
  shortcut, the auto-open and the React error boundary shipped before it. See
  "Already shipped".)
- Performance snapshot from buffered `PerformanceObserver` entries; storage
  snapshot (keys and lengths only). (Shipped as `bugbottle/perf`; see "Already
  shipped".)
- Optional HMAC signature (WebCrypto) verified by the server helper. Documented
  honestly as spam deterrence, not authentication. (Shipped as `bugbottle/sign`;
  see "Already shipped".)
- More sinks: Jira, GitLab. (All of them shipped — Slack, Discord, the Sentry
  envelope, and now `jiraSink` and `gitlabSink`; see "Already shipped".
  Microsoft Teams and attachments on the two issue trackers are noted there as
  later jobs.)

## 1.0 — adoptable

- Annotation shipped early, in 0.6; see "Already shipped".
- `create-bugbottle` scaffold for a receiving endpoint.
- Playground and StackBlitz demo. (The rrweb adapter shipped early, in 0.8, as
  `bugbottle/rrweb`; see "Already shipped".)
- Freeze the report schema and the `beforeSend` contract.

## Explicitly not planned

A hosted backend, a dashboard, or a full session-replay engine in the core.
`examples/inbox` is as far as the second one goes, and it is an example you
copy and own rather than anything this project runs for you.
