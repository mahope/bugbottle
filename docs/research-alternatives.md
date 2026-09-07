# Competitive landscape — September 2026

Research run 2026-09-07 while preparing 0.1.0. Sources are linked inline;
prices and star counts are as of that date.

## Comparison

| Tool | Licence / model | Hosting | Evidence captured | Integration | Price / stars |
|---|---|---|---|---|---|
| **Marker.io** | Commercial | Hosted only | Screenshot+annotations, console, network, session replay, env | Script tag / npm SDK | $39–149/mo; console+network+replay gated to $149 Team ([marker.io](https://marker.io/blog/console-logs)) |
| **Userback** | Commercial | Hosted | Screenshot, video, console (Company tier), replay (Business) | Script / npm | ~$7/user/mo base |
| **BugHerd** | Commercial | Hosted | Pinned screenshot, env | Script / extension | $50/mo 5 users |
| **Jam.dev** | Commercial | Hosted | Console, network, device, actions, instant replay, video | Chrome extension | Free 30 Jams/mo; $14/creator/mo ([jam.dev/pricing](https://jam.dev/pricing)) |
| **BetterBugs** | Commercial | Hosted | Console, network, system, AI debugger | Extension + SDK widget | Free individual tier |
| **Bird Eats Bug** | Commercial | Hosted | Recording, console, network | Web SDK / extension | $10–20/user/mo |
| **Sentry User Feedback** | OSS SDK (MIT/FSL backend) | Sentry backend required | Screenshot, tags, attachments; `captureFeedback()` headless API | npm widget or own UI | Free dev tier; $26+/mo ([docs](https://docs.sentry.io/platforms/javascript/user-feedback/)) |
| **PostHog Surveys/Replay** | MIT core | Cloud or self-host (feature-limited) | Replay, surveys | npm/script | Usage-based |
| **Highlight.io** | Apache-2.0, effectively frozen | Hosted service shut Feb 2026 → LaunchDarkly | Replay, errors, logs | npm | Self-host "technically possible, limited development" |
| **OpenReplay** | AGPL core + proprietary EE | Self-host (1–2 days) or cloud | Full replay, console, network | npm/script | ~10k+ stars; heavy infra |
| **rrweb** | MIT | Library only, no backend | DOM recording primitive | npm | ~19.3k stars |
| **Gleap** | Commercial SDK | Hosted | Screenshot, replay, console, network | npm/script | $39 Hobby / $149 Team |
| **Usersnap / Feedbucket / Ybug / feedback.fish** | Commercial | Hosted | Screenshot+annotation; console on paid tiers | Script snippet | $10–389/mo |
| **Instabug → Luciq / Shakebugs** | Commercial | Hosted | Mobile-first | Mobile SDKs | Demo-only / $0–125 |
| **Crikket** | AGPL-3.0 | Self-host or cloud | Screenshot, recording, repro steps, console, network | Extension + capture SDK | 140 stars ([github](https://github.com/redpangilinan/crikket)) |
| **BugPin** | AGPL server / MIT widget | Self-host (Bun+Hono+SQLite) | Screenshot+annotation, console errors, network, metadata, offline queue | Script tag / npm, Shadow DOM, <150 KB gz | 32 stars ([github](https://github.com/aranticlabs/bugpin)) |
| **BugDrop** | MIT | Cloudflare Worker → GitHub Issues | html-to-image screenshot, annotations, optional console, system info | Single sync script tag | 53 stars ([github](https://github.com/mean-weasel/bugdrop)) |
| **FasterFixes** | AGPL dashboard / MIT widget | Self-host | Screenshot, DOM selector, React component tree, console, network; MCP server | `@fasterfixes/core` + `/react` | Free self-host, $20/mo Pro ([github](https://github.com/manucoffin/faster-fixes)) |
| **BugReel** | BSL | Cloud or self-host | Recording, console, AI-structured report | Extension | Free ≤5 users |
| **BugShot** | MIT | No backend; posts to tracker with your creds | Screenshot, recording, console, network, CSS diffs | Chrome extension only | 14 stars |
| **bugbottle** | MIT | None (BYO endpoint) | Console ring buffer, page context, element picker, optional screenshot | npm, framework-agnostic, React hook, server validators | 0.1.0 |

Unverified (npm returned 403 during research): `simple-bug-reporter`,
`@medanosol/react-feedback-report`, `@pullreque.st/button`, `@siteping/widget`.
Check manually before publishing a comparison.

## Key insights

1. **The market has split in two camps, and neither is headless.**
   Visual-feedback tools (Marker.io, BugHerd, Userback, Ybug) sell a widget
   plus a dashboard; developer-context tools (Jam, BetterBugs, BugShot,
   BugReel) are Chrome extensions. Both assume they own the UI and, except
   BugShot, the backend.
2. **Console/network capture is the paywall lever.** Marker.io gates it at
   $149/mo, Userback at Company tier, Ybug on paid plans, Gleap Team at
   $149/mo. What bugbottle captures for free is what incumbents monetise.
3. **"Open source" in this space mostly means AGPL server + MIT widget**
   (BugPin, FasterFixes, Crikket, OpenReplay). You still run their server.
   Nothing MIT-licensed lets you keep your existing API as the sink.
4. **Every OSS option ships a UI and a Shadow-DOM widget.** No one offers
   "just the capture and the payload" — the primitive layer between rrweb
   (too low-level, replay only) and a full widget.
5. **Sentry is the closest headless precedent**: `captureFeedback()` lets you
   use your own UI, but it is welded to Sentry's ingest. bugbottle is that API
   without Sentry.
6. **Hosted-OSS risk is now a live argument.** Highlight.io's hosted service
   shut down Feb 2026 after the LaunchDarkly acquisition; Instabug went
   demo-only pricing as Luciq. "Your endpoint, your data, no vendor to
   disappear" is concrete in 2026.
7. **The real gap: tiny + headless + BYO backend + typed payload contract.**
   Underserved: internal tools and admin panels that already have an API,
   agencies wanting a bug button in client sites without a per-site SaaS
   seat, Next.js/Remix apps that want a route handler, not a dashboard. The
   server-side validators are a distinct feature nobody else ships.
8. **Weakness to own honestly:** no network capture, no replay, no
   annotations. Extensions will always capture more. Position as "the
   smallest thing that turns 'it's broken' into a reproducible payload".

## Positioning

Tagline candidates (field examples: Crikket "the context engineers actually
need", BugPin "bug reports that actually help you fix things"):

- *Headless in-app bug reports. Your UI, your endpoint, a few kilobytes.* ← used
- *Turn "it's broken" into a JSON report — console, context, screenshot —
  POSTed to your own API.*
- *Sentry's captureFeedback, without Sentry.* (sub-heading material)

Make explicit in the README: a "what it is not" block; the payload schema and
the server helper as the product; MIT for both client and helper; npm
keywords `bug-report`, `headless`, `bring-your-own-backend`, `error-context`.
