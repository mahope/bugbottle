# bugbottle

Headless in-app bug reporting for the browser, published to npm as `bugbottle`.
Public, MIT, zero runtime dependencies. Extracted from the feedback bubble in
two client apps; those are the first consumers to migrate.

## What it is, in one breath

A console ring buffer + page context + optional DOM screenshot, assembled into
a JSON report and POSTed to an endpoint the user owns. A React hook wraps it;
server-side validators check what arrives. No UI, no backend, no hosted service.

## Layout

| Path | Role | May import |
|---|---|---|
| `src/report-core.ts` | Types, limits, server validators. Pure. | nothing |
| `src/console-buffer.ts` | `console.error/warn` + `window` error patching, ring buffer | report-core |
| `src/capture.ts` | `captureScreenshot(renderer)`, `collectContext()` | mask, report-core |
| `src/mask.ts` | `applyMask(root, options)` — hides field values and marked regions for the length of one render, returns the restore | nothing |
| `src/element-picker.ts` | `pickElement()`, `describeElement()`, `buildSelector()` | report-core |
| `src/breadcrumbs.ts` | `initBreadcrumbs()` — clicks, navigation, submits, visibility. Own entry point | element-picker, registry, report-core |
| `src/network.ts` | `initNetwork()` — the failed and slow requests, `fetch` and `XMLHttpRequest` patched. Own entry point. Never bodies, never headers | registry, report-core, scrub |
| `src/queue.ts` | `createQueue()` — a `localStorage` queue in front of the endpoint, flushed on init, `online` and visibility, with backoff. Own entry point. Imports `send.ts` nowhere: one `fetch` of its own | report-core (types) |
| `src/triggers.ts` | `onShortcut(combo, handler)` and `onUncaughtError(handler, options)` — the two ways into the panel that need no button. Own entry point. Listeners only: never renders, never sends | fingerprint |
| `src/fingerprint.ts` | `fingerprint(report)` + `stableHash(text)` — one identity for a report, computed the same way in the browser and on the server. Imported by nothing in the core entry, so it is tree-shaken when unused | nothing |
| `src/react/boundary.ts` | `BugReportBoundary` (catches a render error, renders your fallback with a `report()`) and `createRootErrorHandlers` for React 19. No JSX — `tsc` alone builds this package | send, fingerprint |
| `src/registry.ts` | Two slots: `initBreadcrumbs` and `initNetwork` register getters, `send.ts` reads them. Keeps the core free of the recorders | report-core (types) |
| `src/send.ts` | `buildReport`, `sendReport` — framework-agnostic | capture, console-buffer, report-core |
| `src/html-to-image.ts` | The one file that imports `html-to-image` | capture (types only) |
| `src/locales.ts` | `Locale` type + en/da/sv/nb/de/nl/fr/es, `resolveLocale`. `enMessages` is separate so the hook does not drag every locale in | nothing |
| `src/react/` | `useBugReport` hook over send.ts | everything above |
| `src/ui/` | `mountBugbottle` — optional shadow-DOM panel over the same core; themed via `--bb-*` vars | everything above |
| `src/scrub.ts` | `scrubReport` + `BUILTIN_SCRUBBERS`. Imported by nothing in the core, so it is tree-shaken when unused | nothing |
| `src/global.ts` | Entry for the IIFE `dist/bugbottle.js`: `window.bugbottle` + `data-*` auto-mount. Built by `scripts/build-iife.mjs` (esbuild), excluded from the tsc emit | everything |
| `src/sinks/` | Server-only delivery: `sendReportEmail` (Resend), `sendReportWebhook` (json/slack/discord), `createGithubIssue`, `createLinearIssue` (GraphQL, so a rejected mutation arrives as a 200 with `errors` and still throws), the shared `SinkError`. One `fetch` each, keys and URLs are arguments — never `process.env` | markdown, locales, report-core |
| `site/` | The landing page (EN + DA), static, served by nginx from `site/Dockerfile` on Dokploy. Not part of the npm package | dist (at image build) |
| `site/docs/` | **Generated, never committed.** One page per README section, written by `scripts/build-docs.mjs` (marked, pinned) in the Dockerfile's `node:22-alpine` builder stage. The README is the only copy of that text; a new `##` section must be placed in the script's `GROUPS` or the build fails | README.md (at image build) |
| `src/server/` | Re-exports of report-core, markdown and the sinks for `bugbottle/server` | report-core, markdown, sinks |
| `src/server/handle.ts` | `handleReport(request, options)` — `Request` in, `Response` out: 405 for anything but POST, authorise, body cap and body deadline, every validator, `extra`, scrub, screenshot policy, `store`, ordered sinks under a per-sink deadline. Plus `ValidatedReport` and the `toResend`/`toWebhook`/`toGithub`/`toLinear` sink helpers | report-core, markdown, scrub, sinks |
| `src/server/express.ts` | `expressHandler(options)` — builds a web `Request` from an Express `req` and writes the `Response` back, counting and streaming-decoding a raw body itself. Structural types, no `@types/express` | server/handle |
| `scripts/build-schema.ts` | Generates `dist/report.schema.json` from `BugReport` with ts-json-schema-generator, switches the dialect to 2020-12, applies the `MAX_*` limits, and serialises with sorted keys so the committed dist is stable. Run by `npm run build` after tsc; `tests/schema.test.ts` imports it rather than reading the built file | report-core |
| `tests/` | `node:test`, run on the TypeScript source directly. `tests/report-fixtures.ts` holds the payloads shared by `handle.test.ts` and `schema.test.ts` | |
| `action/` | GitHub Action (`mahope/bugbottle@v0`) validating exported JSON reports. Zero deps, rules inlined from report-core; `tests/action.test.ts` pins them together | nothing |
| `examples/vanilla-js/` | No-build round trip: Node server + plain HTML form, serves `../../dist` | |
| `dist/` | **Committed** (force-added; `.gitignore` still lists it) so `npm install github:…#vX.Y.Z` and jsDelivr work without npm. Rebuild and `git add -f dist` in **every push to main** — CI fails when the build differs from the committed dist (a mixed dist once shipped a link-time SyntaxError) | |

Ten entry points in `package.json#exports`: `.`, `./react`, `./server`,
`./html-to-image`, `./locales`, `./ui`, `./breadcrumbs`, `./network`,
`./queue`, `./triggers` — plus `./report.schema.json`, which is data rather than code. Keep them separate:
a server bundle must never pull in DOM code, and a client bundle must never
pay for a module it did not import. Every reporter-facing string goes through a `Locale`;
never hard-code English in `src/ui/` or the hook.

## Definition of done

A change is done when the code, its tests, **and its documentation** land
together: the README section and API list, `CHANGELOG.md` under Unreleased,
`docs/roadmap.md` ("Already shipped" moves when something ships), this file's
layout table and sizes, and CONTRIBUTING's budgets. Mads' standing rule
(2026-09-07): "Husk altid at opdatere readme.md og docs også". An issue is
not closed and a branch is not merged with the docs lagging.

## Rules that are not obvious from the code

- **Never import `html-to-image` outside `src/html-to-image.ts`.** Bundlers
  resolve every import they see, so an import anywhere else makes it a hard
  dependency for everyone. Verified empirically with esbuild; see CHANGELOG.
- **Masking mutates the live DOM, so it must always be undone.** A renderer
  clones the page inside itself, where we cannot reach the clone, so
  `applyMask` swaps values in the real document and `captureScreenshot`
  restores them in a `finally` that covers both render attempts. Anything added
  there must be restorable and must not throw on a root that is not an element:
  `tests/capture.test.ts` passes a bare object as the root.
- **Screenshots fail open.** A failed or oversized picture turns the attachment
  off and explains why. It never blocks the report. The message is the
  valuable part.
- **The server trusts nothing.** Every field from the browser is
  attacker-controlled input about to hit storage. Validators clip lengths,
  strip null bytes (Postgres refuses them), and check the PNG signature in the
  decoded bytes, not the declared type.
- **`log` and `debug` are not recorded**, and this is a feature. They are where
  stray user data ends up.
- **`collectContext` sends path + query only** — no origin, no fragment.
- **Privacy text in the README is load-bearing.** The "Please read this part"
  section exists because a public media bucket once nearly exposed screenshots.
  Do not soften or shorten it.
- **Source files must not contain literal null bytes.** Use `\u0000` in code
  and `String.fromCharCode(0)` in tests. A literal NUL breaks tooling.

## Commands

```bash
npm run check       # typecheck → test → build → docs, in that order; run before "done"
npm test            # node --test on tests/*.test.ts (needs Node 22+)
npm run build       # tsc → dist/ (ESM + .d.ts + source maps) → report.schema.json → IIFE
npm run build:docs  # site/docs/ from README.md; fails on an ungrouped `##` section
npm pack --dry-run  # confirm only dist/, README, LICENSE, package.json ship
```

Bundle-size check when touching the client: pack, install the tarball in a
scratch project **without** `html-to-image`, and bundle `bugbottle` and
`bugbottle/react` with esbuild. Both must succeed; `bugbottle/react` must
stay under 5376 bytes gzipped and `bugbottle/ui` under 9.25 kB (CI enforces
both; about 5.2 kB and 9.3 kB with masking, the queued state and the triggers),
and the bare core under 1 kB (0.8 kB). The react budget is measured on the hook
alone; `BugReportBoundary` costs about 370 bytes more for the applications that
import it. `bugbottle/ui` moved from 8 kB to 9 kB when the panel started
importing `bugbottle/triggers`, so a keyboard shortcut works with no wiring,
and to 9.25 kB when those triggers learnt about shadow roots.
`bugbottle/triggers` is budgeted at 1300 bytes (measures about 1265): a
standalone 2.7 kB minified module has no compression dictionary to share, and
the shadow-DOM fix — the composed path plus the focus chain through
`shadowRoot.activeElement` — added about 130 bytes to the 1133 it used to be.
`bugbottle/breadcrumbs` is budgeted at 1.5 kB rather than 1 kB: about 0.5 kB
of its bundle is `buildSelector`, which an app that also points at elements
already pays for — the marginal cost there is around 0.55 kB.
`bugbottle/network` is budgeted at 1330 bytes and measured 1174 when it landed;
the review fixes (one `loadend` listener per instance, an era guard on
in-flight requests, and a reset that only unpatches what is still ours) cost
about 100 bytes more. It imports `scrubUrl` alone, so the rest of `scrub.ts` is
tree-shaken away. `bugbottle/queue` is budgeted at 1330 bytes and measures
about 1290: it imports only a type, so that number is the module itself. It was
986 against a 1024 budget until the multi-tab fix — every write re-reads
storage and merges by report id, and a report is claimed before it is
delivered — which is a read-modify-write, a claim and a release where there
used to be one `setItem`. The IIFE budget is 16640 bytes gzipped (16.5 kB with
the queue and the triggers); masking, the queue and the triggers each cost it
roughly half a kilobyte to a kilobyte.

UI changes need a headless smoke test as well as unit tests: there is no DOM
in `node:test`. Serve `dist/` from a scratch page, drive it with the global
`puppeteer-core` and Chrome, and check the posted body.

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
  Relative imports use the `.ts` extension; the build rewrites them.
- No linter or formatter is configured. Match the existing style: two spaces,
  double quotes, trailing commas, ~100-column lines.
- British spelling in identifiers and prose (`normalise`, `licence`).
- Comments explain *why*, in full sentences. The existing tone is calm and
  specific; keep it.
- Tests describe behaviour in plain language: `test("a very long message is clipped")`.
- Every exported function that touches browser input gets a test for the
  malformed case, not just the happy path.

## Releasing

Version bump in `package.json` and `CHANGELOG.md`, update the `#vX.Y.Z`
refs in the README install section, `npm run build` and `git add -f dist`,
commit, then `npm run release -- patch|minor|major` (npm version + push
--follow-tags). `.github/workflows/release.yml` runs `npm run check`, creates the
GitHub release with generated notes and publishes with provenance through npm Trusted Publishing (OIDC, no token;
configured on npmjs.com under the package Settings → Trusted Publisher for
this repository and `release.yml`). 0.3.0 was published by hand with 2FA.

Never publish from a dirty tree, and never publish without `npm run check`
green — `prepublishOnly` enforces the second.

## Roadmap and research

`docs/roadmap.md` is the short version. `docs/research-alternatives.md` and
`docs/research-features.md` are the September 2026 landscape and feature
research this roadmap came from. Read them before proposing a feature.
