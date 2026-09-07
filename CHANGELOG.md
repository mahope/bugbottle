# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may
change the API; the changelog says so when they do.

## Unreleased

## 0.4.0

The evidence release: what happened before, where it went, and what must never
leave the browser. One breaking change: `Locale` now requires an `email` key
(every bundled locale has it; a hand-written one needs the two strings).

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
