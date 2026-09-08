# bugbottle

Headless in-app bug reporting for the browser, published to npm as `bugbottle`.
Public, MIT, zero runtime dependencies. Extracted from the feedback bubble in
two client apps; those are the first consumers to migrate.

## What it is, in one breath

A console ring buffer + page context + optional DOM screenshot, assembled into
a JSON report and POSTed to an endpoint the user owns. React, Vue and Svelte
adapters wrap it; server-side validators check what arrives. No UI, no backend, no hosted service.

## Layout

| Path | Role | May import |
|---|---|---|
| `src/report-core.ts` | Types, limits, server validators. Pure. | nothing |
| `src/console-buffer.ts` | `console.error/warn` + `window` error patching, ring buffer, stack frames on the uncaught ones | report-core, stack |
| `src/stack.ts` | `parseStack(stack)` — one expression turning `error.stack` into at most ten `{ file, line, col, fn? }` frames, V8 and Firefox/Safari alike. Imported only by console-buffer, which keeps the parsing out of report-core; it does not make the core bundle smaller, since console-buffer is in it | report-core (types and limits) |
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
| `src/report-state.ts` | `createReportState(options)` — the form as a state machine with no framework in it: `getState`, `subscribe`, `actions`, `setOptions`, `destroy`, plus `statusText`. The three adapters are bindings over it | capture, element-picker, send, queue (types), locales, report-core |
| `src/react/` | `useBugReport` hook — `useSyncExternalStore` over report-state | report-state, report-core |
| `src/vue/` | `useBugReport` composable — refs and computeds over report-state, `vue` an optional peer (>=3). Own entry point | report-state, report-core |
| `src/svelte/` | `createBugReport` — a readable store (the contract implemented here, not imported) plus the actions, `svelte` an optional peer (>=4) and only for its `Readable` type. Own entry point | report-state, report-core |
| `src/annotate.ts` | `createAnnotator(canvas, dataUrl, options)` — rectangle, arrow and blur over the attached picture, undo, pointer and keyboard input, `toDataUrl()`. Own entry point. The blur pixelates by reading the region back out of the canvas, so the original pixels leave with it. No strings: the panel supplies the labels | nothing |
| `src/ui/` | `mountBugbottle` — optional shadow-DOM panel over the same core; themed via `--bb-*` vars | everything above |
| `src/scrub.ts` | `scrubReport` + `BUILTIN_SCRUBBERS`. Imported by nothing in the core, so it is tree-shaken when unused | nothing |
| `src/sign.ts` | `createSigner({ key, header? })` — the `sign` function `sendReport` takes, HMAC-SHA-256 over `<timestamp>.<body>` through WebCrypto, sent as `t=<ms>,v1=<hex>`. Plus `computeSignature` and `hmacHex`, which `src/server/handle.ts` verifies with, so both sides compute the digest the same way. Own entry point; imported by nothing in the core | nothing |
| `src/global.ts` | Entry for the IIFE `dist/bugbottle.js`: `window.bugbottle` + `data-*` auto-mount. Built by `scripts/build-iife.mjs` (esbuild), excluded from the tsc emit | everything |
| `src/sinks/` | Server-only delivery: `sendReportEmail` (Resend), `sendReportWebhook` (json/slack/discord), `createGithubIssue`, `createLinearIssue` (GraphQL, so a rejected mutation arrives as a 200 with `errors` and still throws), the shared `SinkError`. One `fetch` each, keys and URLs are arguments — never `process.env` | markdown, locales, report-core |
| `site/` | The landing page (EN + DA), static, served by nginx from `site/Dockerfile` on Dokploy. Not part of the npm package | dist (at image build) |
| `site/fonts/` | The four woff2 faces the site is set in — Newsreader 600, Source Sans 3 400/400i/600, latin only. Taken from Google Fonts and **served from this host**: the footer promises no external request, so a `fonts.googleapis.com` link is not an option. `site/README.md` has the recipe | nothing |
| `site/docs/` | **Generated, never committed.** One page per README section, written by `scripts/build-docs.mjs` (marked, pinned) in the Dockerfile's `node:22-alpine` builder stage. The README is the only copy of that text; a new `##` section must be placed in the script's `GROUPS` or the build fails | README.md (at image build) |
| `site/compare/`, `site/da/sammenlign/`, `site/sitemap.xml`, `site/robots.txt` | **Generated, never committed**, by the same `scripts/build-docs.mjs` run. The comparison pages come from `site/compare.md` and `site/da/sammenlign.md` — every vendor claim links its source and the figures are dated; the sitemap lists every URL with `hreflang` alternates on the two bilingual pairs | site/compare.md, site/da/sammenlign.md (at image build) |
| `src/server/` | Re-exports of report-core, markdown and the sinks for `bugbottle/server` | report-core, markdown, sinks |
| `src/server/handle.ts` | `handleReport(request, options)` — `Request` in, `Response` out: 405 for anything but POST, authorise, body cap and body deadline, the optional HMAC `signature` check over the raw text, every validator, `extra`, scrub, screenshot policy, `store`, ordered sinks under a per-sink deadline. Plus `ValidatedReport` and the `toResend`/`toWebhook`/`toGithub`/`toLinear` sink helpers | report-core, markdown, scrub, sinks |
| `src/server/express.ts` | `expressHandler(options)` — builds a web `Request` from an Express `req` and writes the `Response` back, counting and streaming-decoding a raw body itself. Structural types, no `@types/express` | server/handle |
| `scripts/build-schema.ts` | Generates `dist/report.schema.json` from `BugReport` with ts-json-schema-generator, switches the dialect to 2020-12, applies the `MAX_*` limits, and serialises with sorted keys so the committed dist is stable. Run by `npm run build` after tsc; `tests/schema.test.ts` imports it rather than reading the built file | report-core |
| `scripts/a11y-audit.mjs` | Serves `dist/` on a scratch page, mounts the panel and runs the pinned `axe-core` over five states through `puppeteer-core`. The first half of `npm run a11y`; not part of `npm run check`, because it needs a browser | dist (at run time) |
| `scripts/a11y-site.mjs` | The same audit aimed at the pages rather than the widget: both landing pages, the documentation index, one deep documentation page and the two comparison pages, in both colour schemes, failing on a console message as well as on a violation. The second half of `npm run a11y`; needs `npm run build:docs` first | site, dist (at run time) |
| `scripts/capture-panel.mjs` | The four hero pictures: the real panel, opened on the real page over the demo section, clipped wide and narrow at 2x from `/` and again from `/da/` (where the panel speaks Danish), each under a 150 kB budget. `npm run shot:panel` | site, dist (at run time) |
| `scripts/render-og.mjs` | `site/og.png` from `site/og.svg` at 1200x630, with the two faces loaded as data URLs and `document.fonts.ready` awaited before the shutter. `npm run shot:og` | site (at run time) |
| `scripts/annotate-smoke.mjs` | The pixel proof of the blur in a real Chrome: paints a noisy picture, drags a blur and a rectangle over it, decodes the export and checks that every block in the region is flat, none of them is the original, and nothing outside changed. `npm run smoke:annotate` | dist (at run time) |
| `tests/` | `node:test`, run on the TypeScript source directly. `tests/report-fixtures.ts` holds the payloads shared by `handle.test.ts` and `schema.test.ts` | |
| `action/` | GitHub Action (`mahope/bugbottle@v0`) validating exported JSON reports. Zero deps, rules inlined from report-core; `tests/action.test.ts` pins them together | nothing |
| `examples/vanilla-js/` | No-build round trip: Node server + plain HTML form, serves `../../dist` | |
| `dist/` | **Committed** (force-added; `.gitignore` still lists it) so `npm install github:…#vX.Y.Z` and jsDelivr work without npm. Rebuild and `git add -f dist` in **every push to main** — CI fails when the build differs from the committed dist (a mixed dist once shipped a link-time SyntaxError) | |

Thirteen entry points in `package.json#exports`: `.`, `./react`, `./vue`,
`./svelte`, `./server`,
`./html-to-image`, `./locales`, `./ui`, `./breadcrumbs`, `./network`,
`./annotate`, `./queue`, `./triggers`, `./sign` — plus `./report.schema.json`, which is data rather than code. Keep them separate:
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
- **`collectContext` sends path + query only** — no origin, no fragment. The
  optional facts around it (language, timezone, screen, colorScheme, online,
  connection) are the whole list: no canvas, no fonts, no device enumeration,
  nothing that identifies a person beyond what the user agent already does.
- **A stack frame is a position, never source text.** `parseStack` keeps
  `file`, `line`, `col` and `fn` and nothing else, and no code anywhere reads
  the line it points at. Resolving a frame is the reader's job, with their own
  source maps; a report that carried source would carry whatever was on screen
  in that file.
- **Privacy text in the README is load-bearing.** The "Please read this part"
  section exists because a public media bucket once nearly exposed screenshots.
  Do not soften or shorten it.
- **No new control in `src/ui/` without a label and a locale string.** Every
  control the reporter can reach carries an accessible name, and that name
  comes from `UiTexts` in all eight languages — never a hard-coded English
  word, and never an icon on its own. The same goes for anything the panel
  announces: it is a locale string or it is not said. The panel is a dialog
  with a focus trap, so a control added outside `panel` is unreachable while
  it is open; check `tests/ui-a11y.test.ts` and re-run
  `node scripts/a11y-audit.mjs` (zero axe violations, five states).
- **Source files must not contain literal null bytes.** Use `\u0000` in code
  and `String.fromCharCode(0)` in tests. A literal NUL breaks tooling.

## Commands

```bash
npm run check       # typecheck → test → build → docs, in that order; run before "done"
npm test            # node --test on tests/*.test.ts (needs Node 22+)
npm run build       # tsc → dist/ (ESM + .d.ts + source maps) → report.schema.json → IIFE
npm run build:docs  # site/docs/, /compare/, /da/sammenlign/, sitemap.xml, robots.txt; fails on an ungrouped `##` section
npm run a11y        # axe-core over the panel and over the site pages, in a real Chrome; needs a build and build:docs first
npm run shot:panel  # re-capture the hero pictures from the current panel
npm run shot:og     # re-render site/og.png from site/og.svg
npm run smoke:annotate  # the blur really pixelates, in a real Chrome; needs a build first
npm pack --dry-run  # confirm only dist/, README, LICENSE, package.json ship
```

Bundle-size check when touching the client: pack, install the tarball in a
scratch project **without** `html-to-image`, and bundle `bugbottle` and
`bugbottle/react` with esbuild. Both must succeed; `bugbottle/react` must
stay under 5632 bytes gzipped and `bugbottle/ui` under 12 kB (CI enforces both;
about 5.4 kB and 12.0 kB with masking, the queued state, the triggers, the
accessibility pass, the 0.6 evidence and the annotator), and the bare core
under 1536 bytes
(about 1.4 kB). The core budget was 1 kB and 0.8 kB measured until 0.6: the
stack parser costs about 250 bytes gzipped and the six optional context facts
about 190, and both are on by default, so the core, the hook, the panel and the
script tag all carry them. The react budget is measured on the hook
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
used to be one `setItem`. `bugbottle/vue` and `bugbottle/svelte` are budgeted
at 1536 bytes each, but *marginally*: a bundle of either weighs about 5.4 kB,
nearly all of it the capture, the picker and the send that any form pays for,
so CI subtracts a bundle of `buildReport`/`sendReport`/`captureScreenshot`/
`pickElement` and checks the difference. The IIFE budget is 19456 bytes gzipped
(about 18 kB with the queue, the triggers, the accessibility pass and the 0.6
evidence); masking, the queue and the triggers each cost it roughly half a
kilobyte to a kilobyte. The panel budget went from 9 kB to 10 kB for #35. `bugbottle/annotate` is budgeted at
2048 bytes and measures 1441: a canvas, three tools and an undo stack, with
nothing imported. #36 then took the panel budget from 10 kB to 12 kB and the
IIFE from 18432 to 20992 bytes (measured 11971 and 20450). The panel imports
the annotator unconditionally, so those 1441 bytes are paid by every
application that mounts the panel — `annotate: false` hides the button, it does
not shrink the bundle, and a dynamic import would only move the cost onto a
network round trip in the middle of a report. The toolbar and the editor state
are about 300 bytes more, and the IIFE carries the eight new locale strings in
eight languages on top, one of them a sentence because it is where the
annotator says its keys to a screen reader.

UI changes need a headless smoke test as well as unit tests: there is no DOM
in `node:test`. Serve `dist/` from a scratch page, drive it with the global
`puppeteer-core` and Chrome, and check the posted body.
`scripts/a11y-audit.mjs` is that procedure written down: it serves `dist/`,
mounts the panel with everything showing and runs the pinned `axe-core` over
five states (closed, open light, open dark, annotator light, annotator dark),
exiting non-zero on a violation. `scripts/a11y-site.mjs` is the same procedure
aimed at `site/`: six pages in two colour schemes, and a console message counts
as a failure there too. Site changes also carry a performance floor —
Lighthouse mobile on `/` must stay at or above 95, and it measured 97 with no
layout shift — but measure it against a server that gzips text, because nginx
does and an ungzipped measurement is about six points lower for reasons that
have nothing to do with the page. `scripts/annotate-smoke.mjs` is the same
procedure aimed at pixels rather than at the accessibility tree: only a real
canvas can say whether the blur destroyed what it covered.

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
