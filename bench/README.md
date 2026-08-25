# Benchmarks

```bash
npm run bench            # console buffer
npm run bench:capture    # screenshot capture — needs a headless Chromium,
                          # see the "capture-screenshot" section below
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

## capture-screenshot

`captureScreenshot` (issue #4) renders the whole DOM to PNG via
`html-to-image`, and retries once at half scale (`pixelRatio: 0.5`) if the
first result is over the size ceiling — so the worst case is two full
renders. `html-to-image` draws the DOM through an SVG `foreignObject` onto a
canvas, which needs real layout and a real canvas — jsdom provides neither
(see issue #6, blocked for the same reason), so this drives an actual
headless Chromium via `playwright-core` rather than `node:test`.

Measured on a 1280×800 viewport, median of 8 runs per case (one warmup run
discarded). Both the primary render and the retry are always measured for
every case, regardless of whether a real capture would be large enough to
trigger a retry — the goal is knowing what the retry *costs*, not
reproducing the (payload-size-dependent) decision to take it.

| page                     | primary render (p50) | retry render (p50) |
| ------------------------ | --------------------- | -------------------- |
| small page               | ~8 ms                 | ~8 ms                 |
| long page (400 sections) | ~760 ms               | ~765 ms               |
| many images (300 imgs)   | ~185 ms                | ~183 ms                |

### Findings

- Page size dominates completely: a long page (400 text sections, well within
  what a real app's scrollable content could look like) takes ~760 ms to
  capture — long enough that a reporter would notice the wait. A small,
  form-sized page captures in single-digit milliseconds.
- **The retry is not a cheap discount.** Halving `pixelRatio` only changes the
  final canvas raster step; the expensive part — walking the live DOM,
  inlining computed styles and images into an SVG `foreignObject` — happens
  identically both times. Retry render time tracks primary render time within
  measurement noise on every page size tested. The issue's "worst case is two
  full renders" framing is accurate, not pessimistic.
- **This means an oversized first capture roughly doubles the wait**, on top
  of already being the slowest thing the widget does. That is a real cost on
  long or image-heavy pages, worth fixing — but per this issue's acceptance
  criteria, the fix itself is out of scope here. Follow-up opened: #8, picking
  the scale up front from a size estimate (e.g. DOM node count or serialised
  content length) rather than rendering twice.
