# Roadmap

Short version. The reasoning is in `research-features.md` and
`research-alternatives.md` (September 2026).

Guiding rule, borrowed from Sentry: every addition is a tree-shakeable module
you import, never a boolean flag in the core. CI enforces the budgets: the
bare core under 1 kB gzipped, `bugbottle/react` under 4 kB, `bugbottle/ui`
under 8 kB, `bugbottle/breadcrumbs` under 1.5 kB, the script-tag build under
12 kB.

## Already shipped

**0.3** — console buffer, page context, injectable screenshot renderer,
element picker (`pickElement`), framework-agnostic `buildReport`/`sendReport`,
server validators for every field, eight locales (`bugbottle/locales`), the
optional themed panel (`bugbottle/ui`), `toMarkdown` for issue bodies and
agent digests.

**0.4** — sinks in `bugbottle/server` (Resend email, json/Slack/Discord
webhook, GitHub Issues), `bugbottle/breadcrumbs` (clicks, navigation,
submits, visibility, with `beforeBreadcrumb` and masking), `scrubReport` with
built-in patterns and `beforeSend`, the one-script-tag build with `data-*`
auto-mount, screenshot scale chosen up front with `onCapture` timing, email
strings in every locale, hook tests on happy-dom, the landing page at
bugbottle.mahoje.dk in English and Danish.

**Alongside** — the WordPress plugin `mahope/bugbottle-wordpress` (panel plus
endpoint, private post type, admin, email, Danish and English), and the GitHub
Action `mahope/bugbottle@v0` that validates exported reports in CI.

## 0.5 — evidence and delivery

- **Network log** — patch `fetch`/`XMLHttpRequest`; method, URL, status,
  duration, sizes; no bodies by default. Its own entry point, scrubbed by the
  same pipeline as everything else.
- **Input masking** in screenshots — `data-bugbottle-mask` / `-block`
  attributes, `maskAllInputs` default on. Same conventions as rrweb.
- **Stack normalisation** for uncaught errors — `{ file, line, col, fn }`
  frames alongside the raw stack.
- `fetch(..., { keepalive })` with `sendBeacon` fallback; offline queue in
  `localStorage`, flushed on `online`.
- Dedup and rate limit by fingerprint.
- `handleReport(request: Request)` — one universal receiver for Next.js, Hono,
  Workers, Bun, Deno, with an Express wrapper. Validation, scrubbing and a
  sink in one call.
- `report.schema.json` generated from the types, so a receiver can be built
  without the library.

## 0.6 — adapters and triggers

- Vue, Svelte and Solid adapters, each a few lines over `buildReport`.
- Triggers: keyboard shortcut, auto-open on uncaught error (opt-in, deduped),
  shake-to-report in its own entry.
- React error boundary adapter; performance snapshot from buffered
  `PerformanceObserver` entries; storage snapshot (keys and lengths only).
- Optional HMAC signature (WebCrypto) verified by the server helper. Documented
  honestly as spam deterrence, not authentication.
- More sinks: Linear, Jira, GitLab. Sentry envelope.

## 1.0 — adoptable

- `bugbottle/ui` annotation: rectangle/arrow/blur on the screenshot preview.
  The blur tool doubles as a privacy feature.
- `create-bugbottle` scaffold for a receiving endpoint.
- Playground and StackBlitz demo; rrweb adapter.
- Freeze the report schema and the `beforeSend` contract.

## Explicitly not planned

A hosted backend, a dashboard, or a full session-replay engine in the core.
