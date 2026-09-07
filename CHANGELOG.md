# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may
change the API; the changelog says so when they do.

## Unreleased

### Added

- `fetch` option on `mountBugbottle`, passed through to `sendReport`. The panel
  could already be pointed at any endpoint, but not at a function — which is
  what a demonstration with no server behind it needs.
- `site/`: the landing page for <https://bugbottle.mahoje.dk> in English and
  Danish, served by `nginx:alpine` from `site/Dockerfile`. It is built from the
  repository root so the committed `dist/` can be copied into the image: the
  panel on the page is the real `bugbottle/ui`, mounted with a fake `fetch`
  that renders the payload it was given through `toMarkdown`. Nothing in
  `src/` refers to it and the npm package is unchanged.

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
