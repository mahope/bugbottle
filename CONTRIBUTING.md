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
  It should build, and the budgets CI enforces are: bare core 1 kB gzipped,
  `bugbottle/react` 5 kB, `bugbottle/ui` 8 kB, `bugbottle/breadcrumbs`
  1.5 kB, `bugbottle/network` 1330 bytes, `dist/bugbottle.js` 14 kB.
- The docs moved with the code: README section and API list, CHANGELOG under
  Unreleased, `docs/roadmap.md`, and the layout table in CLAUDE.md when a
  file is added.
- Any string a reporter can see goes through `src/locales.ts`, in every
  bundled language. The locale test fails on a missing key.
- `CHANGELOG.md` has a line under *Unreleased*.

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
