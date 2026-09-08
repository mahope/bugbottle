# Contributing

Thanks for looking. bugbottle is small on purpose, and the bar for adding to it
is "does this make a report more useful without making the library bigger for
people who do not need it".

## Setting up

```bash
git clone https://github.com/mahope/bugbottle.git
cd bugbottle
npm ci
npm run check   # typecheck, test, build
```

Node 22 or newer is needed to run the tests (they run the TypeScript source
directly with `--experimental-strip-types`). Consumers of the package only
need Node 18.

## Before opening a pull request

- `npm run check` is green.
- New behaviour has a test. Anything that handles browser input has a test for
  the malformed case, not just the happy path.
- Nothing outside `src/html-to-image.ts` imports `html-to-image`. Bundlers
  resolve every import they see, so an import anywhere else becomes a hard
  dependency for everyone.
- The client entry points stayed small. Pack, install the tarball in a scratch
  project without `html-to-image`, and bundle `bugbottle/react` with esbuild.
  It should build, and the budgets CI enforces are: bare core 1.5 kB gzipped,
  `bugbottle/react` 6 kB, `bugbottle/ui` 11.5 kB, `bugbottle/annotate` 2048
  bytes, `bugbottle/breadcrumbs`
  1.5 kB, `bugbottle/network` 1330 bytes, `bugbottle/perf` 1536 bytes,
  `bugbottle/queue` 1330 bytes,
  `bugbottle/triggers` 1300 bytes, `bugbottle/shake` 768 bytes,
  `bugbottle/sign` 512 bytes, `bugbottle/rrweb` 1024 bytes,
  `bugbottle/vue`, `bugbottle/svelte` and `bugbottle/solid` 1.5 kB each *over* a bundle of
  `buildReport`/`sendReport`/`captureScreenshot`/`pickElement` (the adapters
  are small; the core they share is not), `dist/bugbottle.js` 24 kB and
  `dist/bugbottle.slim.js` 20992 bytes. The
  panel and the script tag grew with the accessibility pass, and everything
  grew by about 0.45 kB in 0.6 when stack frames and the wider page context
  landed in code every consumer of the core runs. They grew again with the
  picture annotator, and the panel gave most of it back when `annotate` became
  a function you hand in rather than a boolean: `src/annotate.ts` (1441 bytes)
  is now in the bundles that ask for it and no others, leaving the panel about
  720 bytes over what it weighed before — its own toolbar, that toolbar's CSS
  and eight English strings, none of which a bundler can drop from a static
  import. The script-tag build carries everything, including those strings in
  eight languages, so its budget did not come down. Every budget rise is argued
  in a comment beside it in `.github/workflows/ci.yml`; a new one needs the
  same, and so does every fall. `bugbottle/perf` then took the script tag past
  22 kB: the timings and the storage snapshot are opt-in behind `data-perf` at
  run time, but the script tag carries every recorder it can switch on. The bare
  core moved 1272 → 1310 bytes for it, which is the two registry reads in
  `buildReport` and nothing else — the observers, the store walk and the cookie
  parse are only ever bundled by an application that imports `bugbottle/perf`.
  `bugbottle/server` is budgeted at 1024 bytes and measures 582: it is a
  server entry, and everything in it — the sinks included — is tree-shaken away
  from a consumer that imports only the validators, so staying about half a
  kilobyte is the proof that no sink leaked into the shared path. CI also greps
  that minified bundle for `document`, `window.`, `navigator` and
  `localStorage` and fails on any of them, which is the only check the rule "a
  server bundle must never pull in DOM code" has ever had — one `document` is
  the rule broken and far too few bytes for a size budget to catch. `bugbottle/shake` is its own entry rather than a third
  function in `bugbottle/triggers`, which measures 1281 bytes against a 1300
  budget: a phone gesture is not something a desktop application should be made
  to carry. It measures 685 bytes, adds 94 to the panel (the wiring, not the
  module — `shake` is a function you hand in) and 572 to the script tag, which
  carries everything and must also expose `requestShakePermission`, since a page
  with no bundler has no other way to ask iOS. The optional contact field then
  took the panel from 11 086 to 11 342 bytes and the script tag from 23 072 to
  23 839, so the budgets are 11776 and 24576: one input, its label, its hint and
  the required check are about 256 bytes, and three locale strings in eight
  languages are most of the rest. The field is off by default and its markup is
  static, so those bytes are paid by every panel — a second entry point for one
  input would cost more than it saved.
  `bugbottle/rrweb` measures 711 bytes and costs the bare core 19 more
  (1316 → 1335): one registry read, and none of the adapter, because rrweb's
  `record` is handed in by the application rather than imported here. The
  script tag does not carry it at all — without a bundler there is no `record`
  to hand in. The pre-1.0 API audit (#62) then cost every client bundle a few
  dozen bytes: `initConsoleBuffer`, `initBreadcrumbs` and `initNetwork` return
  their `reset*`, so a bundler can no longer drop the stop from a page that
  only starts a recorder. The core went 1335 → 1384, breadcrumbs to 1321,
  the network log to 1250, and the two script tags to 24 128 and 20 576.
  The slim script tag is the one budget
  that was written down after the measurement rather than before it: #58 aimed
  at 18432 bytes and the file measures 20477, so the budget is 20992. Leaving
  the annotator, the timings snapshot, the shake gesture and the network log
  out took 3512 bytes off the 23 989 the full build weighs — less than the
  4.5 kB the four modules weigh separately, because in one bundle they share
  gzip's dictionary — and 18 kB was never reachable with the eight locales
  kept: of 55 kB minified, `src/locales.ts` is 16.5 kB and `src/ui/index.ts`
  15.9 kB, and neither shrinks by dropping a recorder. Both files are built by
  the same `scripts/build-iife.mjs` from the same settings, so anything that
  makes one smaller makes the other smaller too.
- The docs moved with the code: README section and API list, CHANGELOG under
  Unreleased, `docs/roadmap.md`, and the layout table in CLAUDE.md when a
  file is added.
- Any string a reporter can see goes through `src/locales.ts`, in every
  bundled language. The locale test fails on a missing key. A new control in
  `src/ui/` also has an accessible name, and that name is a locale string too.
- A change to `src/ui/` keeps `node scripts/a11y-audit.mjs` at zero axe
  violations, over all seven states, and a change to `site/` keeps
  `node scripts/a11y-site.mjs` at zero over its fourteen page-and-scheme runs —
  a console message counts there too. A change to `src/annotate.ts` also keeps
  `node scripts/annotate-smoke.mjs` green, which is the only place the blur is
  proved to destroy pixels rather than to cover them. All three need Chrome and
  `puppeteer-core`, so none of them is part of `npm run check` — but the
  `browser` job runs them on every push and pull request, so a violation is
  caught whether or not anybody remembered. Run them by hand to see a failure
  before CI does.
- `CHANGELOG.md` has a line under *Unreleased*.

## What CI runs

`.github/workflows/ci.yml` has three jobs, and a pull request needs all three:

- **Node 22 / Node 24** — `npm run typecheck`, `npm test`, `npm run build`,
  `npm run build:docs`, the check that the committed `dist/` matches the build,
  and `npm pack --dry-run`.
- **Bundles without html-to-image** — packs the tarball, installs it in a
  scratch project that has no `html-to-image`, bundles every entry point with
  esbuild and weighs each against its budget, and greps the server bundle for
  DOM globals.
- **Browser audits** — builds, generates the site, then runs `npm run a11y`
  (axe over the panel's seven states and the site's fourteen page-and-scheme
  runs, with the real security headers served) and `npm run smoke:annotate`
  (the blur destroyed the pixels it covered) in the Chrome the runner image
  ships. `puppeteer-core` is installed globally there and downloads no browser;
  `scripts/chrome.mjs` finds the executable through `CHROME_BIN`, `CHROME_PATH`
  or the usual paths, which is the same lookup a local run uses. The axe
  reports are uploaded as an artifact when the job fails, and only then.

## What fits

Things that make the evidence in a report better, cheaper, or safer: more
context, better validation, privacy controls, framework adapters that are a
few lines over `buildReport`/`sendReport`. See `docs/roadmap.md` for what is
planned and `docs/research-features.md` for the reasoning behind it.

Things that do not fit in the core: a UI, a dashboard, a hosted backend, a
session-replay engine. Some of those may become separate entry points or
separate packages; open an issue first so we can talk about the shape.

## Style

Match what is there. TypeScript strict, double quotes, trailing commas,
British spelling (`normalise`), comments that explain why rather than what.
Tests are named as plain sentences describing behaviour.

## Reporting a security issue

See [SECURITY.md](./SECURITY.md). Please do not open a public issue for
anything that could expose a reporter's data.
