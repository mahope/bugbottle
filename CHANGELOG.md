# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may
change the API; the changelog says so when they do.

## Unreleased

The annotator, request signing and the comparison page. Recorded here rather
than under 0.6.0, where they were first written down: all three landed after
that tag was cut.

### Added

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
