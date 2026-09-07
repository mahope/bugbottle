# Feature research — September 2026

Research run 2026-09-07 while preparing 0.1.0. The market (Gleap, Marker.io,
Jam, Sentry Feedback) converges on the same evidence bundle: screenshot +
console + **network log** + **breadcrumbs/replay** + env + privacy masking +
issue-tracker handoff. bugbottle's niche is the capture half of that,
headless, at Plausible/Umami-class size, with the handoff half as opt-in
server adapters.

Design rule to copy from Sentry: every feature is a tree-shakeable module you
import, never a boolean flag ([Sentry tree shaking](https://docs.sentry.io/platforms/javascript/configuration/tree-shaking/)).

Legend: Effort S/M/L · Value H/M/L · Size = gzipped impact on the entry that
imports it (0 if a separate subpath).

## Evidence capture

| # | Feature | Eff | Val | Size | Rationale |
|---|---|---|---|---|---|
| 0 | **Element picker** — click the element the report is about | S | **H** | ~1.4 KB | Shipped in 0.1. The single cheapest way to give a developer or agent the exact place. |
| 1 | **Network log** (patch `fetch` + `XMLHttpRequest`; method, URL, status, duration, sizes, no bodies by default; ring of ~50) | M | **H** | ~1 KB | Most-requested evidence after console; every commercial tool ships it. Fallback: `performance.getEntriesByType('resource')` (`responseStatus` Chromium-only). |
| 2 | **Breadcrumbs** (clicks with short selector + text, `pushState`/`popstate`, form submits, visibility change; one timeline with console) | S | **H** | ~0.7 KB | 80% of replay's value at 2% of the cost. Same model as `@sentry/browser` `beforeBreadcrumb`. |
| 3 | **Error enrichment**: stack → `{file,line,col,fn}` frames, `error.cause` chain, `AggregateError` | S | M | ~0.5 KB | Source-map resolution belongs on the server (helper accepting a lookup callback). |
| 4 | **React error boundary** adapter + `onCaughtError/onUncaughtError` with `componentStack` | S | M | 0 (react entry) | React 19 makes this a two-line adapter. |
| 5 | **Perf snapshot**: LCP/CLS/INP via buffered `PerformanceObserver`, long tasks, navigation timing | S | M | ~0.6 KB | Answers "was it slow?" without bundling `web-vitals`. |
| 6 | **Storage snapshot**: localStorage/sessionStorage keys + value lengths, cookie names; opt-in allow-list for values | S | M | ~0.3 KB | Reveals feature-flag/auth-state bugs, safe by default. |
| 7 | **DOM snapshot** (serialised HTML, inputs masked, scripts stripped) as companion to the screenshot | M | M | 0 (subpath) | Renders anywhere, unlike html-to-image with cross-origin CSS/fonts. |
| 8 | **Last-N-seconds mini-replay** via `MutationObserver` ring | L | M | 0 (subpath, 4–6 KB) | Sentry buffers 30–60 s pre-feedback; full rrweb is 35–50 KB. Better: an `attachRrweb(record)` adapter first; native mini-replay post-1.0. |

## Privacy

| # | Feature | Eff | Val | Size | Rationale |
|---|---|---|---|---|---|
| 9 | **Scrubber pipeline**: `beforeSend(report)`, built-in regexes (email, JWT, `Bearer`, card numbers, IBAN, `?token=`), header deny-list | S | **H** | ~0.6 KB | Table-stakes for GDPR; the network log is unshippable without it. Mirror Sentry's hook names. |
| 10 | **Input masking** in screenshots/DOM snapshot: `maskAllInputs` default on, `data-bugbottle-mask`/`-block`, `maskSelector` | S | H | ~0.3 KB | Same conventions as rrweb so teams reuse annotations. |
| 11 | **Consent gate**: capture is lazy, `start()` after consent; no cookies/IDs ever | S | M | ~0.2 KB | Keeps bugbottle out of cookie-banner territory. Document GDPR posture: data minimisation; retention is the endpoint owner's job. |

## Delivery

| # | Feature | Eff | Val | Size | Rationale |
|---|---|---|---|---|---|
| 12 | **Retry + offline queue**: backoff, `localStorage` queue, flush on `online`/next load | M | H | ~0.8 KB | Reports filed during the outage they describe are the ones that get lost. |
| 13 | **Unload-safe send**: `fetch(..., {keepalive:true})` with `sendBeacon` fallback; both capped at 64 KiB so oversized payloads go through the queue | S | M | ~0.3 KB | Cheap and a common footgun. |
| 14 | **Size budget + compression**: per-section caps, total cap (1 MB), `CompressionStream('gzip')` with `Content-Encoding: gzip`; server helper inflates | S | H | ~0.4 KB | 200 KB JSON → 15–30 KB, zero dependency. Screenshot as a second request rather than base64 in JSON. |
| 15 | **Dedup/rate limit** by fingerprint | S | M | ~0.3 KB | Prevents floods from an auto-trigger in a loop. |
| 16 | **HMAC-signed payloads** (WebCrypto SHA-256), verified in `/server` + Origin check | S | M | ~0.4 KB | A shared key in the client is spam deterrence only; say so. |
| 17 | Chunked screenshot upload | M | L | 0 | Only if #14 is not enough; defer. |

## Integrations (all in `bugbottle/server`, zero client impact)

| # | Feature | Eff | Val | Rationale |
|---|---|---|---|---|
| 18 | **`handleReport(request: Request)`** on web `Request`/`Response` → Next.js, Workers, Hono, Bun, Deno; Express wrapper | S | **H** | One adapter, five runtimes: parsing, gzip inflate, HMAC, size limit. |
| 19 | **`toMarkdown(report)`** and `toText` | S | H | Every sink is a formatter + one `fetch`; also what a scheduled agent reads. |
| 20 | **Sinks**: GitHub Issues, GitLab, Linear, Jira Cloud, Slack/Discord, generic webhook, Resend | S each | H (GitHub, Slack, Linear), M (rest) | Never from the browser — tokens leak. Marker.io's whole value prop is "formatted issue in Jira". |
| 21 | Sentry attachment / envelope (also hits Bugsink self-hosters) | M | M | bugbottle as the feedback layer over existing error tracking. |
| 22 | Notion | S | L | Community PR territory. |

## Developer experience

| # | Feature | Eff | Val | Size | Rationale |
|---|---|---|---|---|---|
| 23 | **Vue / Svelte / Solid adapters**, each <300 B over `buildReport`/`sendReport` | S | H | 0 | Core is already headless; adapters are marketing surface + types. |
| 24 | **Triggers**: keyboard shortcut, programmatic, auto-open on uncaught error (opt-in, deduped), shake-to-report (own subpath; iOS permission dance) | S | M | ~0.5 KB | |
| 25 | **Optional minimal UI** `bugbottle/ui`: floating button, dialog, screenshot preview with rectangle/arrow/blur annotation, Shadow DOM, ~5 KB | L | H | 0 | Many adopters want something on day one; separate entry so headless stays headless. Blur doubles as privacy. |
| 26 | **Build**: `size-limit`-style CI gate | S | H | — | Shipped in 0.1 as an esbuild step in CI. |
| 27 | `create-bugbottle` scaffold for a receiving endpoint | M | M | — | Removes the "where do I POST to" blocker. |
| 28 | Playground + StackBlitz, `report.schema.json` from the types | S | M | — | Schema lets third parties build receivers without the library. |

## Copy from the neighbours

- **Sentry**: `beforeSend`/`beforeBreadcrumb` naming, integration-based tree shaking, pre-event buffering.
- **rrweb-snapshot**: mask/block attribute conventions, `slimDOM`.
- **posthog-js**: slim core + lazy-loaded extension bundles.
- **Plausible/Umami**: size-as-marketing, no cookies/IDs, size printed in the README.
- **OpenTelemetry/AppInsights**: beacon fallbacks and 64 KiB splitting.

## Suggested roadmap

See `roadmap.md` for the maintained version.
