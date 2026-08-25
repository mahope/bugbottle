# Benchmarks

```bash
npm run bench
```

## console-buffer

`initConsoleBuffer` patches `console.error` and `console.warn` to push a
serialised entry into a ring buffer before calling through to the original
function. The worry (issue #1) was that `JSON.stringify` on every non-string
argument, on every error a host application logs — including bursts during a
failing render loop — might be expensive enough to matter.

Measured on Node v26.7.0, Apple Silicon, `console.error`/`console.warn`
silenced so terminal I/O isn't part of what's timed. 200,000 iterations per
throughput case (5,000 warmup), 50,000 iterations per latency case. Each
argument is built once and reused across the loop, so what's timed is
`serialise()` + `push()`, not the cost of constructing a fresh `Error` (which
captures a stack trace) or object literal on every call.

| args                     | throughput      |
| ------------------------ | --------------- |
| string                   | ~1.45M entries/s |
| `Error`                  | ~1.46M entries/s |
| deep object (JSON.stringify) | ~0.85M entries/s |

| call                     | latency        |
| ------------------------ | -------------- |
| unpatched `console.error`| ~0.01 µs/call  |
| patched (bugbottle)      | ~0.68 µs/call  |
| **added latency**        | **~0.67 µs/call** |

### Findings

- `JSON.stringify` on a deep object is the slowest path, as expected, but
  it's still ~0.85M entries/second — roughly 1.2 µs per call. A render loop
  logging errors as fast as a synchronous JS loop can run would need to
  sustain that for a noticeable fraction of a second before a human could
  perceive it.
- The added latency per `console.error` call is well under a microsecond
  (~0.67 µs). For comparison, a single `JSON.stringify` call alone typically
  costs more than this on non-trivial objects — most of what's being paid for
  here is the serialisation itself, not the ring-buffer bookkeeping around it.
- **No optimisation is warranted.** The buffer's cost is not something a host
  application would feel, even under an error burst. This issue is
  measurement-only, per its acceptance criteria — closing without a code
  change to `console-buffer.ts`.
