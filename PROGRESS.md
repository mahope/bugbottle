## Færdige i nat
- [x] #1 Measure the console buffer before optimising (52ed5ab) — `bench/console-buffer.bench.ts` + `bench/README.md`. ~1.45M entries/s for strings/Errors, ~0.85M entries/s for deep objects (JSON.stringify-bound), ~0.67 µs added latency per call. Not worth optimising; measurement-only per acceptance criteria, no code change to console-buffer.ts.
- [x] #2 Test the React hook (b6b7b60) — `tests/use-bug-report.test.ts`, 4 new tests (21 total). Rendered via `react-test-renderer` + `act` (added as a devDependency only — no DOM available or needed) instead of react-dom/jsdom. The screenshot-failure test relies on `captureScreenshot`'s existing "requires a browser environment" guard rather than mocking a module.
- [x] #3 Put a size budget on the bundle in CI (20a603b) — `scripts/check-bundle-size.mjs` walks the static import graph from `dist/index.js` (no bundler step exists), sums bytes (10,216 today, budget 16,384), and fails if `html-to-image` ever shows up as a static import instead of `capture.ts`'s dynamic one. Wired into CI as `npm run size` after the build step; size recorded in README.

## BLOCKED
(none yet)
