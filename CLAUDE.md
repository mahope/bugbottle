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
| `src/registry.ts` | Two slots: `initBreadcrumbs` and `initNetwork` register getters, `send.ts` reads them. Keeps the core free of the recorders | report-core (types) |
| `src/send.ts` | `buildReport`, `sendReport` — framework-agnostic | capture, console-buffer, report-core |
| `src/html-to-image.ts` | The one file that imports `html-to-image` | capture (types only) |
| `src/locales.ts` | `Locale` type + en/da/sv/nb/de/nl/fr/es, `resolveLocale`. `enMessages` is separate so the hook does not drag every locale in | nothing |
| `src/react/` | `useBugReport` hook over send.ts | everything above |
| `src/ui/` | `mountBugbottle` — optional shadow-DOM panel over the same core; themed via `--bb-*` vars | everything above |
| `src/scrub.ts` | `scrubReport` + `BUILTIN_SCRUBBERS`. Imported by nothing in the core, so it is tree-shaken when unused | nothing |
| `src/global.ts` | Entry for the IIFE `dist/bugbottle.js`: `window.bugbottle` + `data-*` auto-mount. Built by `scripts/build-iife.mjs` (esbuild), excluded from the tsc emit | everything |
| `src/sinks/` | Server-only delivery: `sendReportEmail` (Resend), `sendReportWebhook` (json/slack/discord), `createGithubIssue`, the shared `SinkError`. One `fetch` each, keys and URLs are arguments — never `process.env` | markdown, locales, report-core |
| `site/` | The landing page (EN + DA), static, served by nginx from `site/Dockerfile` on Dokploy. Not part of the npm package | dist (at image build) |
| `src/server/` | Re-exports of report-core, markdown and the sinks for `bugbottle/server` | report-core, markdown, sinks |
| `tests/` | `node:test`, run on the TypeScript source directly | |
| `action/` | GitHub Action (`mahope/bugbottle@v0`) validating exported JSON reports. Zero deps, rules inlined from report-core; `tests/action.test.ts` pins them together | nothing |
| `examples/vanilla-js/` | No-build round trip: Node server + plain HTML form, serves `../../dist` | |
| `dist/` | **Committed** (force-added; `.gitignore` still lists it) so `npm install github:…#vX.Y.Z` and jsDelivr work without npm. Rebuild and `git add -f dist` in **every push to main** — CI fails when the build differs from the committed dist (a mixed dist once shipped a link-time SyntaxError) | |

Eight entry points in `package.json#exports`: `.`, `./react`, `./server`,
`./html-to-image`, `./locales`, `./ui`, `./breadcrumbs`, `./network`. Keep them separate:
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
npm run check       # typecheck → test → build, in that order; run before "done"
npm test            # node --test on tests/*.test.ts (needs Node 22+)
npm run build       # tsc → dist/ (ESM + .d.ts + source maps)
npm pack --dry-run  # confirm only dist/, README, LICENSE, package.json ship
```

Bundle-size check when touching the client: pack, install the tarball in a
scratch project **without** `html-to-image`, and bundle `bugbottle` and
`bugbottle/react` with esbuild. Both must succeed; `bugbottle/react` must
stay under 5 kB gzipped and `bugbottle/ui` under 8 kB (CI enforces both;
4.5 kB and 7.4 kB with masking), and the bare core under 1 kB (0.9 kB).
The script-tag build is budgeted at 13 kB and measures 12.2 kB.
`bugbottle/breadcrumbs` is budgeted at 1.5 kB rather than 1 kB: about 0.5 kB
of its bundle is `buildSelector`, which an app that also points at elements
already pays for — the marginal cost there is around 0.55 kB.
`bugbottle/network` is budgeted at 1228 bytes and measures 1174; it imports
`scrubUrl` alone, so the rest of `scrub.ts` is tree-shaken away. The IIFE
budget is 13824 bytes gzipped (12600 at 0.4.0 plus the network log).

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
commit, tag `vX.Y.Z`, push the tag. `.github/workflows/release.yml` runs `npm run check` and
publishes with provenance through npm Trusted Publishing (OIDC, no token;
configured on npmjs.com under the package Settings → Trusted Publisher for
this repository and `release.yml`). 0.3.0 was published by hand with 2FA.

Never publish from a dirty tree, and never publish without `npm run check`
green — `prepublishOnly` enforces the second.

## Roadmap and research

`docs/roadmap.md` is the short version. `docs/research-alternatives.md` and
`docs/research-features.md` are the September 2026 landscape and feature
research this roadmap came from. Read them before proposing a feature.
