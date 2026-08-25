## Færdige i nat
- [x] #1 Measure the console buffer before optimising (52ed5ab) — `bench/console-buffer.bench.ts` + `bench/README.md`. ~1.45M entries/s for strings/Errors, ~0.85M entries/s for deep objects (JSON.stringify-bound), ~0.67 µs added latency per call. Not worth optimising; measurement-only per acceptance criteria, no code change to console-buffer.ts.
- [x] #2 Test the React hook (b6b7b60) — `tests/use-bug-report.test.ts`, 4 new tests (21 total). Rendered via `react-test-renderer` + `act` (added as a devDependency only — no DOM available or needed) instead of react-dom/jsdom. The screenshot-failure test relies on `captureScreenshot`'s existing "requires a browser environment" guard rather than mocking a module.

## BLOCKED
(none yet)
