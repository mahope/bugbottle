# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Until 1.0, minor versions may
change the API; the changelog says so when they do.

## Unreleased

## 0.1.0

First release. Extracted from the feedback bubble in two production apps.

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
