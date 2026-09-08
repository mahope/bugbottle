# bugbottle

Headless in-app bug reporting for the browser, published to npm as `bugbottle`.
Public, MIT, zero runtime dependencies. Extracted from the feedback bubble in
two client apps; those are the first consumers to migrate.

## What it is, in one breath

A console ring buffer + page context + optional DOM screenshot, assembled into
a JSON report and POSTed to an endpoint the user owns. React, Vue, Svelte and
Solid adapters wrap it; server-side validators check what arrives. No UI, no backend, no hosted service.

## Layout

| Path | Role | May import |
|---|---|---|
| `src/report-core.ts` | Types, limits, server validators. Pure. | nothing |
| `src/console-buffer.ts` | `console.error/warn` + `window` error patching, ring buffer, stack frames on the uncaught ones | report-core, stack |
| `src/stack.ts` | `parseStack(stack)` — one expression turning `error.stack` into at most ten `{ file, line, col, fn? }` frames, V8 and Firefox/Safari alike. Imported only by console-buffer, which keeps the parsing out of report-core; it does not make the core bundle smaller, since console-buffer is in it | report-core (types and limits) |
| `src/capture.ts` | `captureScreenshot(renderer)`, `collectContext()` | mask, report-core |
| `src/mask.ts` | `applyMask(root, options)` — hides field values and marked regions for the length of one render, returns the restore | nothing |
| `src/element-picker.ts` | `pickElement()`, `describeElement()`, `buildSelector()` | report-core |
| `src/breadcrumbs.ts` | `initBreadcrumbs()` — clicks, navigation, submits, visibility. Own entry point | element-picker, registry, report-core |
| `src/network.ts` | `initNetwork()` — the failed and slow requests, `fetch` and `XMLHttpRequest` patched. Own entry point. Never bodies, never headers | registry, report-core, scrub |
| `src/perf.ts` | `initPerf()` — the Web Vitals from buffered `PerformanceObserver` entries (LCP last candidate, CLS without recent input, INP as the worst interaction), the navigation milestones, long tasks, the JS heap where it exists, plus the storage snapshot: key names and value lengths, cookie names, values only for an opt-in allow-list. Own entry point. Never a cookie value, on any setting | registry, report-core |
| `src/rrweb.ts` | `attachRrweb(record, options?)` — an adapter over the application's own rrweb `record`, typed structurally so nothing is imported and rrweb is not a dependency. A rolling buffer of whole checkout groups (`checkoutEveryNms` 10 s, because a replay can only be cut at a full snapshot), trimmed at the window and again at `maxBytes`, oldest group first; `maskAllInputs: true` unless overridden, `data-bugbottle-mask` mapped to rrweb's `maskTextSelector` and `data-bugbottle-block`/`data-bugbottle` to its `blockSelector`. Own entry point. The report gains `replay: { events, seconds }` | registry, report-core (types) |
| `src/queue.ts` | `createQueue()` — a durable queue in front of the endpoint, flushed on init, `online` and visibility, with backoff. Own entry point. Imports `send.ts` nowhere: one `fetch` of its own. The storage is a seam (`QueueStorage`: one `update` that reads, changes and writes back as one step and throws when refused — there is no `read`, because anything read outside a read-modify-write is stale the moment another tab commits), `localStorage` its default, and it may answer with a promise — `later()` is the one bridge between the two, and commits are chained so two of them cannot read the same stale array. A refused write is answered rather than surrendered to: the reports are written again without their screenshots, each carrying `SCREENSHOT_NOTE` in `notes` | report-core (types) |
| `src/queue-idb.ts` | `createIdbStorage()` — the queue's reports in IndexedDB, handed to `createQueue` as `storage`. Own entry point, imported by nothing: a share of the disk rather than five megabytes for the origin, so a 2 MB report keeps its picture, and one `readwrite` transaction per `update`, which the browser orders across tabs — the multi-tab claim is a lock there rather than a lease. No library; a browser without IndexedDB makes the queue memory-only and the reports are still sent. `onversionchange` closes the connection and the next write opens a fresh one, so another tab’s upgrade is neither blocked nor fatal | queue (types only) |
| `src/triggers.ts` | `onShortcut(combo, handler)` and `onUncaughtError(handler, options)` — the two ways into the panel that need no button. Own entry point. Listeners only: never renders, never sends | fingerprint |
| `src/shake.ts` | `onShake(handler, options?)` — a `devicemotion` listener with gravity filtered out, three alternating threshold crossings in a second, a cool-down, and nothing measured while the page is hidden. Plus `requestShakePermission()`, the only thing that prompts, and only when the application calls it from a gesture. Own entry point. Listener only: never renders, never sends | triggers (the `ListenerHost` type alone, so nothing at run time) |
| `src/fingerprint.ts` | `fingerprint(report)` + `stableHash(text)` — one identity for a report, computed the same way in the browser and on the server. Imported by nothing in the core entry, so it is tree-shaken when unused | nothing |
| `src/react/boundary.ts` | `BugReportBoundary` (catches a render error, renders your fallback with a `report()`) and `createRootErrorHandlers` for React 19. No JSX — `tsc` alone builds this package | send, fingerprint |
| `src/registry.ts` | Five slots: `initBreadcrumbs`, `initNetwork`, `initPerf` (twice, for the timings and the storage snapshot) and `attachRrweb` register getters, `send.ts` reads them. Keeps the core free of the recorders | report-core (types) |
| `src/send.ts` | `buildReport`, `sendReport` — framework-agnostic | capture, console-buffer, report-core |
| `src/html-to-image.ts` | The one file that imports `html-to-image` | capture (types only) |
| `src/locales.ts` | `Locale` type + en/da/sv/nb/de/nl/fr/es, `resolveLocale`. `enMessages` is separate so the hook does not drag every locale in. `resolveLocale` takes the map to look in as its third argument, so a merged map reaches the optional languages without the default one growing, and looks the tag up with `Object.hasOwn` because a `?lang=__proto__` off the URL would otherwise be answered with `Object.prototype` | nothing |
| `src/locales-extra.ts` | it/pl/pt/fi/uk and `localesExtra`, in the same `Locale` shape. Own entry point, imported by nothing — a locale is data and data is carried whole, so the five would otherwise be in every bundle that shows a panel. `pt` is European Portuguese and `pt-BR` resolves to it through the region-dropping `resolveLocale` already does. Neither script-tag build carries it | locales (the types alone, so nothing at run time) |
| `src/report-state.ts` | `createReportState(options)` — the form as a state machine with no framework in it: `getState`, `subscribe`, `actions`, `setOptions`, `destroy`, plus `statusText`. The four adapters are bindings over it | capture, element-picker, send, queue (types), locales, report-core |
| `src/react/` | `useBugReport` hook — `useSyncExternalStore` over report-state | report-state, report-core |
| `src/vue/` | `useBugReport` composable — refs and computeds over report-state, `vue` an optional peer (>=3). Own entry point | report-state, report-core |
| `src/svelte/` | `createBugReport` — a readable store (the contract implemented here, not imported) plus the actions, `svelte` an optional peer (>=4) and only for its `Readable` type. Own entry point | report-state, report-core |
| `src/solid/` | `createBugReport` — one signal over the machine, everything else an accessor over it, plus the actions; `onCleanup` unsubscribes with the owner, `solid-js` an optional peer (>=1.8). Own entry point | report-state, report-core |
| `src/annotate.ts` | `createAnnotator(canvas, dataUrl, options)` — rectangle, arrow and blur over the attached picture, undo, pointer and keyboard input, `toDataUrl()`. Own entry point. The blur pixelates by reading the region back out of the canvas, so the original pixels leave with it. No strings: the panel supplies the labels | nothing |
| `src/ui/` | `mountBugbottle` — optional shadow-DOM panel over the same core; themed via `--bb-*` vars | everything above |
| `src/scrub.ts` | `scrubReport` + `BUILTIN_SCRUBBERS`. Imported by nothing in the core, so it is tree-shaken when unused | nothing |
| `src/sign.ts` | `createSigner({ key, header? })` — the `sign` function `sendReport` takes, HMAC-SHA-256 over `<timestamp>.<body>` through WebCrypto, sent as `t=<ms>,v1=<hex>`. Plus `computeSignature` and `hmacHex`, which `src/server/handle.ts` verifies with, so both sides compute the digest the same way. Own entry point; imported by nothing in the core | nothing |
| `src/global.ts` | Entry for the IIFE `dist/bugbottle.js`: `window.bugbottle` + `data-*` auto-mount. Built by `scripts/build-iife.mjs` (esbuild), excluded from the tsc emit | everything |
| `src/global-slim.ts` | Entry for the second IIFE `dist/bugbottle.slim.js`: the same panel and the same eight locales without the annotator, the timings snapshot, the shake gesture and the network log. Reads the same attributes; `data-annotate`, `data-perf`, `data-shake` and `data-network` are ignored and warned about once on the console, in English, because that is a message to whoever wrote the script tag. Same build script, same settings, same version define; excluded from the tsc emit | global-shared, everything but annotate/perf/shake/network |
| `src/global-shared.ts` | `readOptions(data, endpoint)` and `bootstrap(autoMount, preflight?)` — the `data-*` reading and the boot the two script-tag entries have in common, written once so the full build does not grow when the slim one changes. `preflight` runs before the console is patched, so a developer message stays out of the ring buffer. Excluded from the tsc emit | breadcrumbs, console-buffer, locales, queue, scrub, sign, ui (types) |
| `src/sinks/` | Server-only delivery: `sendReportEmail` (Resend), `sendReportWebhook` (json/slack/discord), `createGithubIssue`, `createLinearIssue` (GraphQL, so a rejected mutation arrives as a 200 with `errors` and still throws), `jiraSink`, `gitlabSink`, `sentrySink`, `teamsSink`, `smtpSink` (all below), the shared `SinkError`. One `fetch` each — except the SMTP one, which is a socket — keys and URLs are arguments, never `process.env` | markdown, locales, report-core |
| `src/sinks/chat.ts` | `readReport(raw)` — the handful of things a chat message shows (title, message, facts, five console entries, selector, timestamp), read once out of an untrusted body — plus `clip` (which counts characters rather than UTF-16 units, so a clip never leaves the lone surrogate that draws as U+FFFD), `resolveUrl` and the `ChatSink`/`ChatSinkContext`/`UrlFrom` types the three chat sinks share. A data URL is never a picture address: neither service will fetch one | report-core |
| `src/sinks/slack.ts` | `slackSink(options)` — a factory returning a `ReportSink` that posts one Block Kit message per report to an incoming webhook: header, escaped `mrkdwn` message, up to ten fields, fenced console, `image`, `context`, an "Open report" button. `buildSlackMessage` builds the body without sending it, and `escapeSlack` is the `&`/`<`/`>` escape. Every limit clips, none fails | chat, error |
| `src/sinks/discord.ts` | `discordSink(options)` — the same over one embed: title, description, colour by report type, fields, `image`, `url`, `timestamp`, footer. `buildDiscordMessage` builds the body. The 6000-character embed budget is spent on the description last, because the facts are what somebody triages from | chat, error, report-core (types) |
| `src/sinks/teams.ts` | `teamsSink(options)` — one Adaptive Card per report on a Microsoft Teams **Workflows** webhook; the Office 365 connector webhooks are retired, so the card travels inside a Bot Framework message (`{ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content }] }`) rather than on its own. Schema 1.5: bold title, the message as a wrapping `TextBlock`, a `FactSet`, five console entries in a monospace `TextBlock`, `Image`, a subtle time-and-selector line, `Action.OpenUrl`. `escapeTeams` turns every string into plain text, *after* the clipping so a clip cannot leave a stray backslash. Workflows answers 202, so every 2xx is a success — except a 200 whose body opens with `Webhook message delivery failed`, which is how a retired connector webhook refuses, and which would otherwise be logged as a delivery. `webhookUrl` goes through `new URL` at construction, so a mistyped credential fails where it was configured rather than inside a `fetch` error that quotes it. The 28 kB a webhook accepts is a hard refusal rather than a clip, so `buildTeamsMessage` measures the JSON and, while it is over, drops the console, then facts from the back, then — only when the *floor*, the same card with nothing clippable left in it, is still over — the screenshot address and the button, and then clips the message; no validated report reaches it on its own, only a long stored-screenshot address can, and an address cannot be clipped, which is why it is measured against the floor rather than against the card as it stands. The comment at the top names the date the schema and the cap were checked | chat, error |
| `src/sinks/jira.ts` | `jiraSink(options)` — one Jira Cloud issue per report over REST v3, basic auth from `email:apiToken` encoded UTF-8 safe. The only sink that does not send Markdown: v3 takes the Atlassian Document Format, so `buildJiraDescription` builds the node tree — paragraph, bullet list of facts and the element, code block of the console — from the report rather than by parsing `toMarkdown` back. A newline in a paragraph is a `hardBreak` node, never a newline inside the `text` node, which is what ADF has no shape for. `messageFromJiraBody` joins `errorMessages` and the per-field `errors`, which is how a refused create names the field. No attachments: those are a second multipart request. The comment at the top names the doc date it was checked against | chat, error, report-core |
| `src/sinks/gitlab.ts` | `gitlabSink(options)` — one GitLab issue per report, the Markdown from `toMarkdown` verbatim, the token in `PRIVATE-TOKEN`. `host` defaults to gitlab.com so self-hosted is one option; a namespaced `projectId` is URL-encoded into the one segment and labels are comma-joined, which is the shape the API takes. `messageFromGitlabBody` reads the flat message, the object keyed by field and `error` alike, because GitLab answers 404 rather than 403 for a project a token cannot see | chat, error, markdown |
| `src/sinks/smtp.ts` | `smtpSink(options)` — one mail per report over one connection, spoken to a mail server directly on `node:net`/`node:tls`: EHLO, STARTTLS when it is offered, AUTH PLAIN or LOGIN, MAIL/RCPT/DATA, QUIT, with a deadline on every phase rather than on the conversation. The only sink that is not an HTTP API and the only Node-only one; nothing else in `bugbottle/server` imports it, so the entry still bundles without `node:net`. `buildMessage` is RFC 5322 with `foldHeader` (fold at a space, never through a token, CR and LF stripped so a `Reply-To` read off the report cannot smuggle a `Bcc`; an address header has only its display name encoded, because an RFC 2047 word is a phrase and a `From` that is all phrase has no address in it, and an encoded word is split at the 75 characters RFC 2047 §2 allows), `dotStuff` (RFC 5321 §4.5.2, the first line included) and a `multipart/alternative` of the report as `text/plain` and as `text/markdown`. A part is 7bit while it is ASCII and quoted-printable otherwise, never base64: the `×` in a viewport size must not make the whole body unreadable on the wire — and a base64 body would make dot-stuffing dead code. **AUTH over an unencrypted connection is refused** unless `allowInsecureAuth` is set, and no credential ever reaches an error message. `requireTls` refuses the *report* on the same terms — a stripped STARTTLS is a line missing from an unauthenticated EHLO reply, and an account with no credentials would otherwise notice nothing — defaulting to true on port 587 and wherever credentials are set. The deadline is on the writes as well as the reads: a server that stops reading says nothing at all. `SinkError` carries the server's reply code and line; `SMTP_NO_REPLY` (0) is the status when there was no reply at all | chat, error, locales, markdown, report-core |
| `src/sinks/sentry.ts` | `sentrySink(options)` — one envelope per report on a DSN's ingest endpoint, Sentry, GlitchTip and Bugsink alike. Takes the DSN apart, builds the event (message, level, tags, `contexts.feedback`, the three recorders as one sorted breadcrumb timeline, elements in `extra`) and the attachment item for the screenshot, then POSTs the bytes with `X-Sentry-Auth`. `buildSentryEvent` and `buildSentryEnvelope` are exported; `SentrySinkError` carries `retryAfter` and `X-Sentry-Rate-Limits`. The comment at the top names the doc version it was written against, and the three places it knowingly departs from it | chat, error, report-core |
| `site/` | The landing page (EN + DA), static, served by nginx from `site/Dockerfile` on Dokploy. Not part of the npm package | dist (at image build) |
| `site/playground.js` | The theme playground on `/docs/languages-and-branding/` alone: labelled controls over a real panel mounted with `trigger: false` into an `inert` stage, printing the `mountBugbottle({ theme })` call and the CSS block. Vanilla JavaScript, loaded through the `PAGE_SCRIPTS` hook in `scripts/build-docs.mjs` (keyed on the slug). It has no list of `--bb-*` names of its own: the build reads them out of the README's table and writes them onto the controls, and fails when a control names a `theme` key the table does not list. No inline style anywhere — `style.setProperty` on the host, `data-pos` and `data-scheme` beside it | dist, docs.css (at run time) |
| `site/fonts/` | The four woff2 faces the site is set in — Newsreader 600, Source Sans 3 400/400i/600, latin only. Taken from Google Fonts and **served from this host**: the footer promises no external request, so a `fonts.googleapis.com` link is not an option. `site/README.md` has the recipe | nothing |
| `site/docs/` | **Generated, never committed.** One page per README section, written by `scripts/build-docs.mjs` (marked, pinned) in the Dockerfile's `node:22-alpine` builder stage, plus `search.json`, the index the sidebar's search field fetches on first focus. The README is the only copy of that text; a new `##` section must be placed in the script's `GROUPS` or the build fails, and so does a heading that slugifies to the same name as another one, which used to lose a whole section to `new Map` without a word, and so does a `PAGE_SCRIPTS` key naming a slug no section has, which used to drop the playground off a renamed page in silence | README.md (at image build) |
| `site/docs/changelog/` | **Generated, never committed**, by the same run: `CHANGELOG.md` as a page, one `<h2>` per release anchored at the version with hyphens for dots (`#0-9-0`), the list of releases above the first one, and the `<h3>` headings under a release deliberately without ids. Listed under About beside the comparison, through the same `extras` array, because it is not a README section either. Both landing pages' version stamp links to the current release's anchor, and `scripts/release.mjs` moves that link with the version | CHANGELOG.md (at image build) |
| `site/compare/`, `site/da/sammenlign/`, `site/sitemap.xml`, `site/robots.txt` | **Generated, never committed**, by the same `scripts/build-docs.mjs` run. The comparison pages come from `site/compare.md` and `site/da/sammenlign.md` — every vendor claim links its source and the figures are dated; the sitemap lists every URL with `hreflang` alternates on the two bilingual pairs | site/compare.md, site/da/sammenlign.md (at image build) |
| `site/da/kom-i-gang/` | **Generated, never committed**, by the same run, from `site/da/kom-i-gang.md`: the one Danish way in — three routes to a first report (the pinned jsDelivr script tag, the WordPress plugin, a bundler with the React/Vue/Svelte/Solid hook), the privacy part in Danish, and links into the English reference. A `STANDALONE` entry with no `otherUrl`, so it claims no `hreflang`: `/docs/install/` is the nearest English page and is not the same page. `indexed: false` keeps it out of `site/docs/search.json`. `scripts/release.mjs` edits the Markdown so its script tag names the current version, and `scripts/a11y-site.mjs` audits it | site/da/kom-i-gang.md (at image build) |
| `src/server/` | Re-exports of report-core, markdown and the sinks for `bugbottle/server` | report-core, markdown, sinks |
| `src/server/handle.ts` | `handleReport(request, options)` — `Request` in, `Response` out: 405 for anything but POST, authorise, body cap and body deadline, the optional HMAC `signature` check over the raw text, every validator, `extra`, scrub, screenshot policy, `store`, ordered sinks under a per-sink deadline. Plus `ValidatedReport` and the `toResend`/`toWebhook`/`toGithub`/`toLinear` sink helpers. The replay cache is bucketed by the *signed second* and bounded inside each one (128 digests, 640 seconds), because the signing key is public: a flood of valid signatures must not be able to evict an honest digest dated any other second. `signature.store` (`has`/`add(digest, expiresAt)`) replaces it with a shared one; `t=` is `/^\d{1,16}$/` and the digest is verified over the timestamp as it was sent. The same seam twice more, for the fleet that wants one answer: `rateLimit.store` (`hit(key, windowMs)` → the count) and `dedupe.store` (`get`/`set(key, entry, expiresAt)`, expiry the store's job). Both check what the store answered with before believing it — a finite number from `hit`, an entry shape from `get` — because a raw `"3"` or a bare string compared with `>` or read as an entry would switch the limit off, or make every report a duplicate, without a word. Both fail **open** through `onError` — an honest report is never refused because a shared store blinked — where the replay store fails closed | report-core, markdown, scrub, sinks |
| `src/server/file-store.ts` | `fileStore({ dir, maxReports?, screenshots? })` — the `store` function `handleReport` takes, backed by a directory, plus `list()`, `read(id, { screenshot? })` and `remove(id)`. One JSON file per report named `<receivedAt>-<id>.json` with the decoded PNG beside it as `<id>.png`, an index built by one walk on the first call that needs it — one walk, shared by every caller that arrives before it finishes, and never replaced afterwards, only added to and spliced from, because a write holds it across an `await` — and kept up to date by every write and delete, and `maxReports` deleting the oldest first. The only module under `src/server/` that reaches for Node, and nothing the validators reach imports it, so the validator-only bundle still mentions neither `node:fs` nor `readFile`. Every write is a tmp file renamed into place, so a crash leaves a `.tmp` nothing lists rather than half a report; an id is matched against the `randomUUID` shape **before** a path is built, and the `receivedAt` that is the other half of the name keeps only the characters a timestamp is made of, which together are the whole traversal defence; a picture is signature-checked in its bytes before it is written under a `.png` name, and a failed one is dropped while the report is stored | report-core, handle (types only) |
| `src/server/express.ts` | `expressHandler(options)` — builds a web `Request` from an Express `req` and writes the `Response` back, counting and streaming-decoding a raw body itself. Structural types, no `@types/express`. A signed route mounted behind `express.json()` cannot be verified at all, so it calls `onError` once per handler naming the parser and answers the same 401 | server/handle |
| `scripts/build-schema.ts` | Generates `dist/report.schema.json` from `BugReport` with ts-json-schema-generator, switches the dialect to 2020-12, applies the `MAX_*` limits, and serialises with sorted keys so the committed dist is stable. Run by `npm run build` after tsc; `tests/schema.test.ts` imports it rather than reading the built file | report-core |
| `scripts/build-openapi.ts` | Generates `dist/openapi.json`, an OpenAPI 3.1 description of the report endpoint, from the schema above (3.1 is a superset of 2020-12, so the `$defs` move into `components/schemas` and only the `$ref` targets are rewritten) and from `handleReport`'s answers. Sorted keys like the schema, and run by `npm run build` straight after it; `tests/openapi.test.ts` imports it and exercises the handler for every status it can answer | build-schema, sign, server/handle |
| `scripts/chrome.mjs` | `findChrome()` and `loadPuppeteer()` — the one answer the five browser scripts share. `CHROME_BIN` then `CHROME_PATH`, then the runner's `/usr/bin/google-chrome`, a distribution Chromium, macOS and Windows, then the same names on PATH; `puppeteer-core` from this repository or from the global root. Nothing downloads a browser | nothing |
| `scripts/a11y-audit.mjs` | Serves `dist/` on a scratch page, mounts the panel and runs the pinned `axe-core` over seven states through `puppeteer-core`. The first half of `npm run a11y`; not part of `npm run check`, because it needs a browser, but CI's `browser` job runs it on every push and pull request | dist (at run time), chrome |
| `scripts/a11y-site.mjs` | The same audit aimed at the pages rather than the widget: both landing pages, the documentation index, one deep documentation page, the search field on results, the theme playground with four controls moved, the two comparison pages, the Danish getting-started page and the changelog, in both colour schemes, failing on a console message as well as on a violation. The second half of `npm run a11y`; needs `npm run build:docs` first, and runs in CI's `browser` job beside the panel audit | site, dist (at run time), chrome |
| `scripts/capture-panel.mjs` | The four hero pictures: the real panel, opened on the real page over the demo section, clipped wide and narrow at 2x from `/` and again from `/da/` (where the panel speaks Danish), each under a 150 kB budget. `npm run shot:panel` | site, dist (at run time), chrome |
| `scripts/render-og.mjs` | `site/og.png` from `site/og.svg` at 1200x630, with the two faces loaded as data URLs and `document.fonts.ready` awaited before the shutter. `npm run shot:og` | site (at run time), chrome |
| `scripts/annotate-smoke.mjs` | The pixel proof of the blur in a real Chrome: paints a noisy picture, drags a blur and a rectangle over it, decodes the export and checks that every block in the region is flat, none of them is the original, and nothing outside changed. `npm run smoke:annotate`, and the last step of CI's `browser` job | dist (at run time), chrome |
| `scripts/measure-sinks.mjs` | The "Server bundle" column of the README's sinks table: packs the package, installs the tarball in a scratch project with the pinned esbuild, bundles one entry per sink with the recipe from `ci.yml` (`--bundle --minify --format=esm --platform=node`) and gzips each. Prints the rows and the date. Dev-only and deliberately outside `npm run check` — it wants the network and about a minute; run it after `npm run build` when a sink changes | dist (packed at run time) |
| `tests/` | `node:test`, run on the TypeScript source directly. `tests/report-fixtures.ts` holds the payloads shared by `handle.test.ts` and `schema.test.ts`. `tests/fuzz.test.ts` is "the server trusts nothing" as a test: a seeded, hand-rolled generator (no dependency) pushes thousands of hostile reports through every `normalise*`, `validateReport`, `collectExtra`, `scrubReport`, `toMarkdown` and `handleReport`, asserting that nothing throws, every output is inside its `MAX_*`, no output carries a null byte or a prototype the sender chose, and `handleReport` answers 400/413 rather than 500. `FUZZ_ITERATIONS` (2000) and `FUZZ_SEED` are the two knobs; a failure prints both, and the case it found is written up beside it as a named regression test | |
| `action/` | GitHub Action (`mahope/bugbottle@v0`) validating exported JSON reports. Zero deps, rules inlined from report-core; `tests/action.test.ts` pins them together | nothing |
| `examples/vanilla-js/` | No-build round trip: Node server + plain HTML form, serves `../../dist` | |
| `examples/inbox/` | Where reports land: `handleReport` → `fileStore` → `reports/<time>-<id>.json` + `<id>.png`, then a read-only list and detail behind one basic-auth password from `INBOX_PASSWORD`, refusing to start without it. The detail page renders `toMarkdown` through a tiny subset — structure read from the Markdown, every piece of text escaped first, so report text is never injected. Since #82 the storage is `fileStore` in the library rather than a copy here, so this file is routing, the password and the HTML; `MAX_REPORTS` (2000) is passed to it as `maxReports`. No `package.json` on purpose: `import "bugbottle/server"` self-references the root package, so `node examples/inbox/server.mjs` runs with nothing installed. `PORT`, `HOST` (loopback unless told otherwise) and `REPORTS_DIR` are read from the environment, and `GET /health` is public — `ok` and nothing else, because the platform's check runs before anybody has the password. Since #84 it also notifies through the library's own sinks from the environment alone: `NOTIFY_WEBHOOK` (`slackSink`/`discordSink`/`teamsSink`/`sendReportWebhook`, chosen by the URL's host or by `NOTIFY_KIND`) and `NOTIFY_SMTP_HOST`/`_PORT`/`_USER`/`_PASS`/`_FROM`/`_TO` (`smtpSink`). The example writes no delivery code, only the two addresses a sink cannot work out — `/r/<id>` and `/r/<id>.png` under `PUBLIC_URL`, since a sink runs with no request to ask — and a `WeakMap` from the report object to the id `store` answered with, which is the only place the id and the report meet | dist (at run time) |
| `examples/inbox/Dockerfile`, `compose.yml`, `.env.example`, `Caddyfile` | The example on a VPS: `node:22-alpine`, non-root, reports on a named volume at `/data`, the password from an env file and compose refusing to start without it, the published port on loopback because basic auth over plain HTTP sends the password every time. The build context is the repository **root** and the image is `package.json` + `dist/` + the two files of the example — the layout the self-reference resolves against — so nothing is installed at image build time; `npm pack` would carry the same `dist/` twice. The README's "Deploy it" walks through Dokploy | package.json, dist, examples/inbox (at image build) |
| `dist/` | **Committed** (force-added; `.gitignore` still lists it) so `npm install github:…#vX.Y.Z` and jsDelivr work without npm. Rebuild and `git add -f dist` in **every push to main** — CI fails when the build differs from the committed dist (a mixed dist once shipped a link-time SyntaxError) | |

Twenty entry points in `package.json#exports`: `.`, `./react`, `./vue`,
`./svelte`, `./solid`, `./server`,
`./html-to-image`, `./locales`, `./locales-extra`, `./ui`, `./breadcrumbs`,
`./network`,
`./perf`, `./annotate`, `./queue`, `./queue-idb`, `./triggers`, `./shake`,
`./sign`,
`./rrweb` — plus `./report.schema.json` and `./openapi.json`, which are data
rather than code.
`tests/exports.test.ts` pins that count: an entry added here without the
README's API section and this paragraph following it fails the suite. Keep them separate:
a server bundle must never pull in DOM code, and a client bundle must never
pay for a module it did not import. CI enforces the first half: it bundles
`bugbottle/server` down to one validator and fails if that bundle passes 1024
bytes gzipped or if its minified text mentions `document`, `window.`,
`navigator` or `localStorage`. Every reporter-facing string goes through a `Locale`;
never hard-code English in `src/ui/` or the hook.

## Definition of done

A change is done when the code, its tests, **and its documentation** land
together: the README section and API list, `CHANGELOG.md` under Unreleased,
`docs/roadmap.md` ("Already shipped" moves when something ships), this file's
layout table and sizes, and CONTRIBUTING's budgets. Mads' standing rule
(2026-09-07): "Husk altid at opdatere readme.md og docs også". An issue is
not closed and a branch is not merged with the docs lagging.

## Rules that are not obvious from the code

- **Never import `html-to-image` outside `src/html-to-image.ts`.** Bundlers
  resolve every import they see, so an import anywhere else makes it a hard
  dependency for everyone. Verified empirically with esbuild; see CHANGELOG.
- **Masking mutates the live DOM, so it must always be undone.** A renderer
  clones the page inside itself, where we cannot reach the clone, so
  `applyMask` swaps values in the real document and `captureScreenshot`
  restores them in a `finally` that covers both render attempts. Anything added
  there must be restorable and must not throw on a root that is not an element:
  `tests/capture.test.ts` passes a bare object as the root.
- **Screenshots fail open.** A failed or oversized picture turns the attachment
  off and explains why. It never blocks the report. The message is the
  valuable part.
- **The server trusts nothing.** Every field from the browser is
  attacker-controlled input about to hit storage. Validators clip lengths,
  strip null bytes (Postgres refuses them), and check the PNG signature in the
  decoded bytes, not the declared type.
- **`log` and `debug` are not recorded**, and this is a feature. They are where
  stray user data ends up.
- **`collectContext` sends path + query only** — no origin, no fragment. The
  optional facts around it (language, timezone, screen, colorScheme, online,
  connection) are the whole list: no canvas, no fonts, no device enumeration,
  nothing that identifies a person beyond what the user agent already does.
- **A stack frame is a position, never source text.** `parseStack` keeps
  `file`, `line`, `col` and `fn` and nothing else, and no code anywhere reads
  the line it points at. Resolving a frame is the reader's job, with their own
  source maps; a report that carried source would carry whatever was on screen
  in that file.
- **Privacy text in the README is load-bearing.** The "Please read this part"
  section exists because a public media bucket once nearly exposed screenshots.
  Do not soften or shorten it.
- **No new control in `src/ui/` without a label and a locale string.** Every
  control the reporter can reach carries an accessible name, and that name
  comes from `UiTexts` in all eight languages — never a hard-coded English
  word, and never an icon on its own. The same goes for anything the panel
  announces: it is a locale string or it is not said. The panel is a dialog
  with a focus trap, so a control added outside `panel` is unreachable while
  it is open; check `tests/ui-a11y.test.ts` and re-run
  `node scripts/a11y-audit.mjs` (zero axe violations, seven states).
- **The contact field is off by default, everywhere.** `contact` on a report is
  personal data the application asked for, so nothing switches it on for
  anybody: not the panel, not the script tag, not an adapter. It is free text
  and no code validates it — only the Resend reply-to and Sentry's
  `contact_email` ask whether it looks like an address, and a line that does
  not is still delivered as a fact. `scrubReport` redacts it only when asked,
  and then whole.
- **Source files must not contain literal null bytes.** Use `\u0000` in code
  and `String.fromCharCode(0)` in tests. A literal NUL breaks tooling.

## Commands

```bash
npm run check       # typecheck → test → build → docs, in that order; run before "done"
npm test            # node --test on tests/*.test.ts (needs Node 22+)
npm run build       # tsc → dist/ (ESM + .d.ts + source maps) → report.schema.json → openapi.json → both IIFEs
npm run build:docs  # site/docs/ (the changelog included), /compare/, /da/sammenlign/, sitemap.xml, robots.txt; fails on an ungrouped, a ghost or a duplicated `##` section
npm run a11y        # axe-core over the panel and over the site pages, in a real Chrome; needs a build and build:docs first
                    # CI's `browser` job runs this and smoke:annotate on every push and pull request
npm run shot:panel  # re-capture the hero pictures from the current panel
npm run shot:og     # re-render site/og.png from site/og.svg
npm run smoke:annotate  # the blur really pixelates, in a real Chrome; needs a build first
node scripts/measure-sinks.mjs  # the README's sink sizes; needs a build and the network
npm pack --dry-run  # confirm only dist/, README, LICENSE, package.json ship
```

Bundle-size check when touching the client: pack, install the tarball in a
scratch project **without** `html-to-image`, and bundle `bugbottle` and
`bugbottle/react` with esbuild. Both must succeed; `bugbottle/react` must
stay under 6144 bytes gzipped and `bugbottle/ui` under 11776 bytes (CI enforces
both; about 5.6 kB and 11.5 kB with masking, the queued state, the triggers,
the accessibility pass, the 0.6 evidence, the contact field and the two recorder
seams), and the bare core
under 1536 bytes
(about 1.4 kB). The core budget was 1 kB and 0.8 kB measured until 0.6: the
stack parser costs about 250 bytes gzipped and the six optional context facts
about 190, and both are on by default, so the core, the hook, the panel and the
script tag all carry them. The react budget is measured on the hook
alone; `BugReportBoundary` costs about 370 bytes more for the applications that
import it. `bugbottle/ui` moved from 8 kB to 9 kB when the panel started
importing `bugbottle/triggers`, so a keyboard shortcut works with no wiring,
and to 9.25 kB when those triggers learnt about shadow roots.
`bugbottle/triggers` is budgeted at 1300 bytes (measures 1281): a
standalone 2.7 kB minified module has no compression dictionary to share, and
the shadow-DOM fix — the composed path plus the focus chain through
`shadowRoot.activeElement` — added about 130 bytes to the 1133 it used to be.
`bugbottle/breadcrumbs` is budgeted at 1.5 kB rather than 1 kB: about 0.5 kB
of its bundle is `buildSelector`, which an app that also points at elements
already pays for — the marginal cost there is around 0.55 kB.
`bugbottle/network` is budgeted at 1330 bytes and measured 1174 when it landed;
the review fixes (one `loadend` listener per instance, an era guard on
in-flight requests, and a reset that only unpatches what is still ours) cost
about 100 bytes more. It imports `scrubUrl` alone, so the rest of `scrub.ts` is
tree-shaken away. `bugbottle/perf` is budgeted at 1536 bytes (1280 until the replay fixes moved
the UTF-8 length and the null-byte walk into report-core) and measures
1236: five observers, the navigation entry, two store walks and a cookie parse,
importing nothing but four constants. The core moved 1272 → 1310 bytes for it,
and that 38 bytes is the whole cost to a consumer who never imports it — two
registry reads in `buildReport`. `bugbottle/rrweb` is budgeted at 1024 bytes (768 until the cap counted UTF-8
bytes, which took it to 767) and measured 711 when it landed: the rolling
buffer, the checkout trim and the byte cap, importing two types and nothing at
run time, since rrweb's `record` is handed in by the application. It cost the
core 19 bytes (1316 → 1335 measured locally) for one registry read, and the
script tag nothing at all — the IIFE does not export it, because a page with no
bundler has no `record` to hand in. `bugbottle/queue` is budgeted at 1600 bytes and measures
1553: it imports only a type, so that number is the module itself. It was
986 against a 1024 budget until the multi-tab fix — every write re-reads
storage and merges by report id, and a report is claimed before it is
delivered — which is a read-modify-write, a claim and a release where there
used to be one `setItem` — and 1313 until #85 made the storage a seam and gave
a refused write an answer. That last 240 bytes is what the issue hoped would be
a hundred: `later()` bridging a synchronous storage and an asynchronous one in
one code path, the commit chain that keeps two of them off the same stale
array, the second write with the pictures dropped, and the note that says so.
`bugbottle/queue-idb` is budgeted at 1024 bytes and measures 654: one open, one
transaction helper and two methods, importing two types and nothing at run
time. It is a second entry rather than an option on the first because the
default must not carry a storage it will never use. `bugbottle/vue`, `bugbottle/svelte` and
`bugbottle/solid` are budgeted
at 1536 bytes each, but *marginally*: a bundle of any of them weighs about
5.4 kB,
nearly all of it the capture, the picker and the send that any form pays for,
so CI subtracts a bundle of `buildReport`/`sendReport`/`captureScreenshot`/
`pickElement` and checks the difference — 1321, 1192 and 1270 bytes when Solid
landed. `bugbottle/sign` is budgeted at 512
bytes and measures about 370: two WebCrypto calls and a hex loop, importing
nothing. `bugbottle/shake` is budgeted at 768 bytes and measures 685: one
listener, a high-pass filter over three axes and the iOS permission call,
importing nothing but a type. It is its own entry rather than a third function
in `bugbottle/triggers`, which has nineteen bytes of room left, and because a
phone gesture is not something a desktop application should be made to carry.
The panel takes it as a function handed in, like the annotator, so
`bugbottle/ui` moved 10 997 → 11 091 (the wiring, not the module) and the IIFE
22 501 → 23 073 with its budget at 23552 — that build carries every module and
has to expose `requestShakePermission`, since a page with no bundler has no
other way to ask iOS. The IIFE budget was 19456 bytes gzipped
before the annotator (about 18 kB with the queue, the triggers, the
accessibility pass and the 0.6 evidence); masking, the queue and the triggers
each cost it roughly half a kilobyte to a kilobyte. The panel budget went from 9 kB to 10 kB for #35. `bugbottle/annotate` is budgeted at
2048 bytes and measures 1441: a canvas, three tools and an undo stack, with
nothing imported. #36 then took the panel budget from 10 kB to 12 kB and the
IIFE from 18432 to 20992 bytes, because the panel imported the annotator
whether or not anybody marked a picture. #39 undid that half: `annotate` is a
function the application hands in, like `screenshot`, `scrub` and `sign`, so
those 1441 bytes are in a bundle only when `createAnnotator` is passed to
`mountBugbottle`, and the panel budget came back to 11 kB (measures 10 997
against the 10 229 it weighed before the annotator existed; #48 added about
fifty bytes for Escape leaving the editor and the longer sentence the canvas
reads out). #42 then added `bugbottle/perf` to the script tag behind `data-perf`, which
cost about 1.08 kB — the module is carried whether or not the attribute is
present — so the IIFE measured 22501, and 23073 once #43 added
`bugbottle/shake` and `requestShakePermission` to the namespace, which is why
its budget was 23552 then (24576 now, see #51 below); the eight
languages leave little room, so measure before lengthening a locale string. The 720 bytes in
between are the panel's own half — the toolbar, its CSS, the open/close wiring
and eight English strings — and they cannot be tree-shaken out of a static
import, so 10 kB is not reachable again with the feature in the panel; a
dynamic import would only move the cost onto a network round trip in the middle
of a report. The IIFE is the build that carries
everything, so it imports the annotator itself, hands it to the panel through
`mount`, and pays for the eight locale strings in eight languages on top, one
of them a sentence because it is where the annotator says its keys to a screen
reader. Measure before you write a budget down: #36 recorded 11971 and 20450
for files that measured 12126 and 21042 with the pinned esbuild, and CI was red
on main until the review after it corrected the number. #51 then took the panel
from 11 086 to 11 342 bytes and the IIFE from 23 072 to 23 839, with the
budgets at 11776 and 24576: the optional contact field is an input, its label,
its hint and the required check (about 256 bytes) plus three locale strings,
which the script tag carries in eight languages. It is off by default and its
markup is static, so every panel pays those bytes; a second entry point for one
input would cost more than it saved.

#85 then cost the two script-tag builds 186 and 236 bytes — 24 238 → 24 424
and 20 650 → 20 886 — for the queue's storage seam and its quota fallback,
which both builds carry like every other module, and took their budgets to
25088 and 21504. The slim build pays slightly more for the same code, because
it has less around it to share a dictionary with.

#58 then added the second IIFE. `dist/bugbottle.slim.js` leaves out the
annotator, `bugbottle/perf`, `bugbottle/shake` and `bugbottle/network` and
measures 20477 gzipped against the full build's 23989, so its budget is 20992.
The issue aimed at 18432 and that was never reachable with the eight locales
kept: of 55 kB minified, `src/locales.ts` is 16.5 kB and `src/ui/index.ts`
15.9 kB, and neither shrinks by dropping a recorder. The 3512 bytes that did
come off are less than the four modules weigh separately, because in one bundle
they share gzip's dictionary, and two of their costs stay behind on purpose —
the annotator's eight locale strings in eight languages, which are data, and
the panel's own annotator toolbar, which is a static import. Moving the shared
`data-*` reading into `src/global-shared.ts` cost the full build 52 bytes
(23 937 → 23 989) and left its budget at 24576.

#62 then cost both files a little over a hundred bytes — 23 989 → 24 128 and
20 460 → 20 576 — and the client entries a few dozen each: the core 1335 →
1384, `bugbottle/breadcrumbs` 1321, `bugbottle/network` 1250,
`bugbottle/queue` 1296, `bugbottle/react` 5657, `bugbottle/ui` 11 433. The
whole rise is one rule: `initConsoleBuffer`, `initBreadcrumbs` and
`initNetwork` return their `reset*`, so the stop is reachable from the start
and a bundler can no longer drop it from a page that never calls it.

#70 then gave the panel `network` and `perf` on the same hand-it-in seam as
`annotate` and `shake`, so that `data-network` and `data-perf` have mount
options of the same name. Types only: `src/ui/` imports neither recorder, and
the wiring is two ternaries and two calls — `bugbottle/ui` 11 431 → 11 485,
the full IIFE 24 128 → 24 174, the slim one 20 575 → 20 638. The slim build
pays too, because it carries the same panel; no budget moves.

#74 added `bugbottle/locales-extra`, which CI prints and never budgets: it is
data, and its weight is the five languages in it — 4721 bytes gzipped for all
five, 1138 for one of them on its own, since a bundler drops the rest. The
number that mattered is what it cost everything else, and that is three bytes
of minified JavaScript: `resolveLocale` gained the map to look in as a third
argument, so `dist/bugbottle.js` went 65 292 → 65 295 and
`dist/bugbottle.slim.js` 56 251 → 56 254. Nothing imports the entry, which is
the whole point — eight languages in every panel is already generous.

`bugbottle/server` is budgeted at 1024 bytes gzipped, and CI greps the same
minified bundle for `document`, `window.`, `navigator` and `localStorage`,
failing on any of them. Everything else in the entry is tree-shaken away from a
consumer that imports only the validators: that bundle is 583 bytes gzipped
with the Sentry, Jira, GitLab, Teams and SMTP sinks and `fileStore` exported,
which is the proof that no sink leaked into the shared path — and for the SMTP
one also the proof that `node:net` and `node:tls` stayed out. #82 added `fileStore`
and with it the first `node:fs`, `node:path` and `node:crypto` imports under
`src/server/`; the bundle went 584 → 583 bytes and its minified text mentions
none of the three, nor `readFile` — worth greping for those four alongside the
DOM names when anything under `src/server/` gains an import. The grep is the sharper of the two — one
`document` is a rule broken and far too few bytes for a size budget to notice.
Read the size with one caveat: the *emitted* bundle is byte-for-byte
the same 1025 minified bytes whether or not the new sinks are exported, but
esbuild picks its short identifier letters from the whole module graph, so a
new module can move the gzipped figure a byte or two without a line of code
reaching the bundle. Diff the minified output before believing a rise. A bundle
that does import `sentrySink` weighs 4224 bytes gzipped — the sink, the
report-core validators it reads the body with, and nothing else; `jiraSink`
alone weighs 2798, `gitlabSink` alone 4528 (`toMarkdown` is most of it), and
both together 5613. `smtpSink` alone weighs 8037 with `node:net` and `node:tls`
external: the client itself is a small part of that, and the rest is
`toMarkdown` and the locale it reads the subject and the intro out of.

UI changes need a headless smoke test as well as unit tests: there is no DOM
in `node:test`. Serve `dist/` from a scratch page, drive it with the global
`puppeteer-core` and Chrome, and check the posted body.
`scripts/a11y-audit.mjs` is that procedure written down: it serves `dist/`,
mounts the panel with everything showing and runs the pinned `axe-core` over
seven states (closed, open light, open dark, annotator light, annotator dark,
contact light, contact dark),
exiting non-zero on a violation. `scripts/a11y-site.mjs` is the same procedure
aimed at `site/`: eight pages in two colour schemes, and a console message counts
as a failure there too. Site changes also carry a performance floor —
Lighthouse mobile on `/` must stay at or above 95, and it measured 97 with no
layout shift — but measure it against a server that gzips text, because nginx
does and an ungzipped measurement is about six points lower for reasons that
have nothing to do with the page. `scripts/annotate-smoke.mjs` is the same
procedure aimed at pixels rather than at the accessibility tree: only a real
canvas can say whether the blur destroyed what it covered.

None of the three is part of `npm run check`, because each needs a browser and
`npm run check` must run anywhere. They are not optional for that reason: the
`browser` job in `.github/workflows/ci.yml` builds, generates the site and runs
`npm run a11y` and `npm run smoke:annotate` on the Chrome the `ubuntu-latest`
image ships, on every push and every pull request, uploading the axe reports as
an artifact when it fails. `scripts/chrome.mjs` is what makes the same command
work in both places: `CHROME_BIN`, `CHROME_PATH`, then the usual Linux, macOS
and Windows paths. So run them by hand while working — the failure is easier to
read locally — and know that forgetting is caught.

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
  Relative imports use the `.ts` extension; the build rewrites them.
- No linter or formatter is configured. Match the existing style: two spaces,
  double quotes, trailing commas, ~100-column lines.
- British spelling in identifiers and prose (`normalise`, `licence`).
- Comments explain *why*, in full sentences. The existing tone is calm and
  specific; keep it.
- Tests describe behaviour in plain language: `test("a very long message is clipped")`.
- Every exported function that touches browser input gets a test for the
  malformed case, not just the happy path.
- **Naming, settled by the pre-1.0 audit** (`docs/api-audit-1.0.md`, #62):
  - A function is a verb (`captureScreenshot`, `buildReport`, `resolveLocale`);
    a value is a noun (`locales`, `DISCORD_COLOURS`).
  - Every `init*` returns its `stop()` — the matching `reset*` — and so does
    every `on*` and `attach*`.
  - An optional capability is handed in, never imported by the module that uses
    it: `screenshot`, `annotate`, `shake`, `scrub`, `sign`, `queue`.
  - One name per idea in an option object: `endpoint` for the address we POST
    to, `headers`, `credentials`, `fetch`, `signal`, `timeoutMs` for the
    request, `onError` for a failure handed back, `maxEntries` for a ring
    buffer's length, `maxBytes` for a payload's size, `store` for a pluggable
    backing store, `before*` for a last look. A third party's address and
    credentials keep the vendor's own words (`webhookUrl`, `host`, `site`,
    `dsn`, `token`, `apiKey`, `apiToken`).
  - A ceiling is `MAX_<what>`, a default is `DEFAULT_<what>`, and the vendor
    goes after the prefix: `MAX_SLACK_TEXT`, never `SLACK_MAX_TEXT`.
  - Every `data-*` attribute is a mount option of the same name.
  - Nothing is exported without being named in the README's API section; a
    group line ("the `MAX_*` limits") covers a family.
  - A rename never removes: add the new name, keep the old one working with an
    `@deprecated` JSDoc naming the version and the removal issue, test both,
    and let the new name win where both are given.

## Releasing

Version bump in `package.json` and `CHANGELOG.md`, update the `#vX.Y.Z`
refs in the README install section, `npm run build` and `git add -f dist`,
commit, then `npm run release -- patch|minor|major` (npm version + push
--follow-tags). `.github/workflows/release.yml` runs `npm run check`, creates the
GitHub release with generated notes and publishes with provenance through npm Trusted Publishing (OIDC, no token;
configured on npmjs.com under the package Settings → Trusted Publisher for
this repository and `release.yml`). 0.3.0 was published by hand with 2FA.

Never publish from a dirty tree, and never publish without `npm run check`
green — `prepublishOnly` enforces the second.

## Roadmap and research

`docs/roadmap.md` is the short version. `docs/research-alternatives.md` and
`docs/research-features.md` are the September 2026 landscape and feature
research this roadmap came from. Read them before proposing a feature.
`docs/api-audit-1.0.md` is the whole public surface read once before the API
freezes, with a verdict per export and the naming rules above; read it before
adding an export or an option, and before renaming one.
