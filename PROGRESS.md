## Færdige i nat
- [x] #1 Measure the console buffer before optimising (52ed5ab) — `bench/console-buffer.bench.ts` + `bench/README.md`. ~1.45M entries/s for strings/Errors, ~0.85M entries/s for deep objects (JSON.stringify-bound), ~0.67 µs added latency per call. Not worth optimising; measurement-only per acceptance criteria, no code change to console-buffer.ts.

## BLOCKED
(none yet)
