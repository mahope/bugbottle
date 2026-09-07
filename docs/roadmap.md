# Roadmap

Short version. The reasoning is in `research-features.md` and
`research-alternatives.md` (September 2026).

Guiding rule, borrowed from Sentry: every addition is a tree-shakeable module
you import, never a boolean flag in the core. The core entry stays under 1 kB
gzipped and `bugbottle/react` under 3.5 kB.

Already in 0.3: console buffer, page context, injectable screenshot renderer,
element picker (`pickElement`), framework-agnostic `buildReport`/`sendReport`,
server validators for every field, eight locales (`bugbottle/locales`), and
the optional themed panel (`bugbottle/ui`) — pulled forward from 1.0 because
"brand it and translate it" turned out to be the first thing integrators ask.

## 0.4 — evidence and safety

- **`toMarkdown(report)`** in `bugbottle/server` — a report rendered for a
  human or an agent: selector, text and position of each element, page,
  console tail. This is what a scheduled agent session reads each morning.

- **Network log** — patch `fetch`/`XMLHttpRequest`; method, URL, status,
  duration, sizes; no bodies by default. Its own entry point.
- **Breadcrumbs** — clicks (short selector + trimmed text), navigation,
  form submits, visibility changes, on one timeline with console entries.
- **Scrubber pipeline** — `beforeSend(report)` hook, built-in patterns for
  emails, bearer tokens, card numbers, `?token=` query values, and a header
  deny-list. Required before the network log ships.
- **Input masking** in screenshots — `data-bugbottle-mask` / `-block`
  attributes, `maskAllInputs` default on. Same conventions as rrweb.
- **Stack normalisation** for uncaught errors — `{ file, line, col, fn }`
  frames alongside the raw stack.
- **Size budget in CI** — bundle without `html-to-image`, fail over the limit.
- **`report.schema.json`** generated from the types, so a receiver can be
  built without the library.

## 0.5 — delivery and handoff

- `fetch(..., { keepalive })` with `sendBeacon` fallback; offline queue in
  `localStorage`, flushed on `online`.
- Dedup and rate limit by fingerprint.
- Optional HMAC signature (WebCrypto) verified by the server helper. Documented
  honestly as spam deterrence, not authentication.
- `handleReport(request: Request)` — one universal receiver for Next.js, Hono,
  Workers, Bun, Deno, with an Express wrapper.
- Sinks over `toMarkdown`: GitHub Issues, Slack, Linear. Server-side only;
  tokens never reach the browser.
- Triggers: keyboard shortcut, auto-open on uncaught error (opt-in, deduped).
- React error boundary adapter; performance snapshot from buffered
  `PerformanceObserver` entries; storage snapshot (keys and lengths only).

## 1.0 — adoptable

- Vue, Svelte and Solid adapters, each a few lines over `buildReport`.
- `bugbottle/ui` annotation: rectangle/arrow/blur on the screenshot preview.
  The blur tool doubles as a privacy feature.
- `create-bugbottle` scaffold for a receiving endpoint.
- Playground and StackBlitz demo.
- Remaining sinks (GitLab, Jira, Discord, Resend email), Sentry envelope,
  rrweb adapter, shake-to-report.
- Freeze the report schema and the `beforeSend` contract.

## Explicitly not planned

A hosted backend, a dashboard, or a full session-replay engine in the core.
