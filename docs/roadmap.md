# Roadmap

Short version. The reasoning is in `research-features.md` and
`research-alternatives.md` (September 2026).

Guiding rule, borrowed from Sentry: every addition is a tree-shakeable module
you import, never a boolean flag in the core. CI enforces the budgets: the
bare core under 1.5 kB gzipped, `bugbottle/react` under 5.5 kB, `bugbottle/ui`
under 10 kB, `bugbottle/breadcrumbs` under 1.5 kB, `bugbottle/network` under
1.3 kB, `bugbottle/queue` under 1.3 kB, `bugbottle/triggers` under 1.3 kB,
`bugbottle/vue` and `bugbottle/svelte` under 1.5 kB each over the shared core,
`bugbottle/sign` under 512 bytes, the script-tag build under 18 kB. The core budget was 1 kB until 0.6, when stack
frames and the wider context added about 0.45 kB that every consumer pays for.

## Already shipped

**0.3** — console buffer, page context, injectable screenshot renderer,
element picker (`pickElement`), framework-agnostic `buildReport`/`sendReport`,
server validators for every field, eight locales (`bugbottle/locales`), the
optional themed panel (`bugbottle/ui`), `toMarkdown` for issue bodies and
agent digests. The panel has since had an accessibility pass — focus trap and
return, a `radiogroup` with arrow keys, named controls, live-region
announcements, contrast in both schemes — audited with `axe-core` at zero
violations (`npm run a11y`).

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

**0.6** — stack frames on uncaught errors and unhandled rejections
(`ConsoleEntry.stack`, at most ten `{ file, line, col, fn? }`, one parser for
V8, Firefox and Safari, never any source text), and six optional context facts:
language, time zone, screen with pixel ratio, colour scheme, online state and
effective connection type — each guarded, each clipped by `normaliseContext`,
all of them in the facts table and in the schema.

**0.6** — `report.schema.json` generated from the types by
`scripts/build-schema.ts`, shipped in the package and served at
bugbottle.dev/schema/report.json, so a receiver can be built in any language
without the library. And the Linear sink (`createLinearIssue`, `toLinear`).

**0.6** — `bugbottle/queue`: an offline queue in `localStorage` with
exponential backoff, flushed on `online`, on returning to the tab and on
creation, dropping what the server refuses and keeping what it could not
answer. Plus `keepalive` and `onFailure` on `sendReport`, a `queue` option on
the hook and the widget with a `queued` status and locale message, and
`data-queue` on the script tag.

**0.6** — `bugbottle/triggers`: a keyboard shortcut (`mod+shift+b`, quiet
while the reporter is typing) and an opt-in auto-open on uncaught errors,
deduplicated by fingerprint so a render loop opens one panel. `shortcut` and
`openOnError` on `mountBugbottle`, `data-shortcut` and `data-open-on-error` on
the script tag, and `ui.openedByError` in all eight locales. `BugReportBoundary`
and React 19's `createRootErrorHandlers` in `bugbottle/react`. And the shared
`fingerprint(report)`, which `handleReport` uses for `dedupe: { windowMs }` —
a repeat answers 200 `{ id, duplicate: true }` without storing or delivering it
twice.

**0.6** — `bugbottle/vue` (`useBugReport`, a composable over refs) and
`bugbottle/svelte` (`createBugReport`, a readable store plus the actions), over
the new framework-agnostic `createReportState` in `src/report-state.ts` that
the React hook was refactored onto — one state machine, three bindings, about
1.3 and 1.2 kB gzipped over the core a form pays for anyway. Both peers are
optional.

**0.6** — `bugbottle/sign`: an optional HMAC-SHA-256 over `<timestamp>.<body>`
with a shared key (`createSigner`, WebCrypto, 366 bytes gzipped), a `sign` seam
on `sendReport` and every adapter, `data-sign-key` on the script tag, and
`signature` on `handleReport` — key rotation, a five-minute skew window, a
constant-time compare and a replay cache, all four failures answering one
`401 { error: "Bad signature" }`. Documented honestly: a key in the browser is
public, so it is spam deterrence beside a rate limit and never authentication.

**Alongside** — the WordPress plugin `mahope/bugbottle-wordpress` (panel plus
endpoint, private post type, admin, email, Danish and English), and the GitHub
Action `mahope/bugbottle@v0` that validates exported reports in CI.

## 0.5 — evidence and delivery

- `fetch(..., { keepalive })` with `sendBeacon` fallback; offline queue in
  `localStorage`, flushed on `online`.
- Rate limit by fingerprint. (Dedup by fingerprint shipped, client and server.)
- `report.schema.json` generated from the types, so a receiver can be built
  without the library.

## 0.6 — adapters and triggers

- Solid adapter. (Vue and Svelte shipped; see "Already shipped".)
- Shake-to-report in its own entry. (The keyboard shortcut, the auto-open and
  the React error boundary shipped; see "Already shipped".)
- Performance snapshot from buffered `PerformanceObserver` entries; storage
  snapshot (keys and lengths only).
- Optional HMAC signature (WebCrypto) verified by the server helper. Documented
  honestly as spam deterrence, not authentication. (Shipped as `bugbottle/sign`;
  see "Already shipped".)
- More sinks: Jira, GitLab. Sentry envelope.

## 1.0 — adoptable

- `bugbottle/ui` annotation: rectangle/arrow/blur on the screenshot preview.
  The blur tool doubles as a privacy feature.
- `create-bugbottle` scaffold for a receiving endpoint.
- Playground and StackBlitz demo; rrweb adapter.
- Freeze the report schema and the `beforeSend` contract.

## Explicitly not planned

A hosted backend, a dashboard, or a full session-replay engine in the core.
