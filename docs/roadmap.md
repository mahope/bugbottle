# Roadmap

Short version. The reasoning is in `research-features.md` and
`research-alternatives.md` (September 2026).

Guiding rule, borrowed from Sentry: every addition is a tree-shakeable module
you import, never a boolean flag in the core. CI enforces the budgets: the
bare core under 1 kB gzipped, `bugbottle/react` under 5 kB, `bugbottle/ui`
under 8 kB, `bugbottle/breadcrumbs` under 1.5 kB, `bugbottle/network` under
1.2 kB, the script-tag build under 14 kB.

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
bugbottle.dev in English and Danish.

**0.5** — screenshot masking: field values, `contenteditable` text,
`data-bugbottle-mask` text and `data-bugbottle-block` regions are hidden while
the picture is taken and restored afterwards, on by default, `mask: false` to
switch it off. rrweb attribute names. And `bugbottle/network`: the failed and
slow requests before the report, `fetch` and `XMLHttpRequest` patched, no
bodies and no headers ever, URLs scrubbed, `normaliseNetwork` and a
"Requests" table in `toMarkdown`. And `handleReport` in `bugbottle/server`:
one universal receiver from web `Request` to `Response` — authorisation, a
body ceiling, every validator, optional scrubbing, a screenshot policy,
`store` and ordered sinks with `toResend`/`toWebhook`/`toGithub`, CORS and an
in-memory rate limit — with `expressHandler` for Express. Hardened after a
review: a body deadline as well as a body ceiling, a per-sink deadline, a
capped and clipped rate-limit map, 405 for anything that is not a POST, and a
screenshot store that may fail without taking the report with it.

**Unreleased** — `report.schema.json` generated from the types by
`scripts/build-schema.ts`, shipped in the package and served at
bugbottle.dev/schema/report.json, so a receiver can be built in any language
without the library. And the Linear sink (`createLinearIssue`, `toLinear`).

**Alongside** — the WordPress plugin `mahope/bugbottle-wordpress` (panel plus
endpoint, private post type, admin, email, Danish and English), and the GitHub
Action `mahope/bugbottle@v0` that validates exported reports in CI.

## 0.5 — evidence and delivery

- **Stack normalisation** for uncaught errors — `{ file, line, col, fn }`
  frames alongside the raw stack.
- `fetch(..., { keepalive })` with `sendBeacon` fallback; offline queue in
  `localStorage`, flushed on `online`.
- Dedup and rate limit by fingerprint.

## 0.6 — adapters and triggers

- Vue, Svelte and Solid adapters, each a few lines over `buildReport`.
- Triggers: keyboard shortcut, auto-open on uncaught error (opt-in, deduped),
  shake-to-report in its own entry.
- React error boundary adapter; performance snapshot from buffered
  `PerformanceObserver` entries; storage snapshot (keys and lengths only).
- Optional HMAC signature (WebCrypto) verified by the server helper. Documented
  honestly as spam deterrence, not authentication.
- More sinks: Jira, GitLab. Sentry envelope.

## 1.0 — adoptable

- `bugbottle/ui` annotation: rectangle/arrow/blur on the screenshot preview.
  The blur tool doubles as a privacy feature.
- `create-bugbottle` scaffold for a receiving endpoint.
- Playground and StackBlitz demo; rrweb adapter.
- Freeze the report schema and the `beforeSend` contract.

## Explicitly not planned

A hosted backend, a dashboard, or a full session-replay engine in the core.
