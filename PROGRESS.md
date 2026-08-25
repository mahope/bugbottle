# Morgenrapport 2026-08-26

✅ Færdigt: #1, #2, #3, #4, #5, #6 — alle seks `night-ok`-opgaver, samlet i
[PR #7](https://github.com/mahope/bugbottle/pull/7) mod `main` på branchen
`night/2026-08-bugbottle`. `npm run typecheck && npm test && npm run build`
er grønne (25 tests), plus `npm run size` (nyt CI-step).

🔒 BLOCKED: ingen.

❓ Kræver beslutning:
1. Merge [PR #7](https://github.com/mahope/bugbottle/pull/7) til `main` når
   den er set igennem — jeg merger aldrig selv.
2. Tre nye devDependencies blev tilføjet undervejs (alle dev-only, intet
   runtime-nyt): `react-test-renderer` (#2), `playwright-core` (#4, kræver
   `npx playwright install chromium` hvis Chromium ikke allerede er cachet
   lokalt — var det her på denne maskine), `jsdom` + `react-dom` (#6). Tjek
   at det er okay, eller sig til hvis du hellere vil have det som separate
   issues til diskussion.
3. #8 (opret under #4's arbejde, ikke `night-ok`) foreslår at estimere
   screenshot-skalering på forhånd i stedet for at rendere to gange — retry
   viste sig at koste stort set det samme som første render. Værd at
   prioritere, eller lade ligge?

📦 Klar til review: [PR #7](https://github.com/mahope/bugbottle/pull/7) — se
særligt #6's fix (en reel fokus-bug fanget af den nye test) og #4/#8's fund
(retry er ikke en billig genvej).

---

## Færdige i nat
- [x] #1 Measure the console buffer before optimising (52ed5ab) — `bench/console-buffer.bench.ts` + `bench/README.md`. ~1.45M entries/s for strings/Errors, ~0.85M entries/s for deep objects (JSON.stringify-bound), ~0.67 µs added latency per call. Not worth optimising; measurement-only per acceptance criteria, no code change to console-buffer.ts.
- [x] #2 Test the React hook (b6b7b60) — `tests/use-bug-report.test.ts`, 4 new tests (21 total). Rendered via `react-test-renderer` + `act` (added as a devDependency only — no DOM available or needed) instead of react-dom/jsdom. The screenshot-failure test relies on `captureScreenshot`'s existing "requires a browser environment" guard rather than mocking a module.
- [x] #3 Put a size budget on the bundle in CI (20a603b) — `scripts/check-bundle-size.mjs` walks the static import graph from `dist/index.js` (no bundler step exists), sums bytes (10,216 today, budget 16,384), and fails if `html-to-image` ever shows up as a static import instead of `capture.ts`'s dynamic one. Wired into CI as `npm run size` after the build step; size recorded in README.
- [x] #4 Measure screenshot capture time (9f77129) — `bench/capture-screenshot.bench.ts`, real headless Chromium via `playwright-core` (devDependency; jsdom can't do layout/canvas, same blocker as #6). Long page ~760ms, many-images ~185ms, small page ~8ms at 1280x800. Retry (half pixelRatio) tracks primary render cost within noise — not a cheap discount, since it re-walks the whole DOM. Opened #8 (unlabelled — needs a judgement call) to pick scale from an estimate up front instead of rendering twice.
- [x] #5 Ship a complete receiving-endpoint example (5d5e8a3) — `examples/receiving-endpoint/`. Hand-rolled S3-compatible client (SigV4 over fetch + Web Crypto, no SDK) so it works against AWS S3/R2/MinIO/Spaces/B2 unmodified; `assertBucketIsPrivate` refuses to upload unless all four S3 public-access blocks are confirmed on. Typechecked standalone against the repo's own `dist/*.d.ts`; not part of the root check gate (it's a reference to copy out, not shipped code).
- [x] #6 Optional prebuilt bubble for the React entry (9120f16) — `bugbottle/react/bubble` exports `BugBottleBubble`, built on `useBugReport`. Kept out of the headless path by construction (separate entry, not re-exported from `react/index.ts`); `check-bundle-size.mjs` now also proves it (walks the react graph, fails if `bubble.js` ever shows up, plus a size budget for that graph). Written with `createElement` not JSX, since `.ts` sources run directly under `node --experimental-strip-types`, which doesn't transform JSX — matches why the rest of the codebase avoids it too. `tests/bubble.test.ts` covers Escape-to-close, focus-in/focus-back, and radiogroup arrow-key nav against a real jsdom DOM (react-test-renderer can't do real focus/events). Writing that test caught a real bug — `close()` called `triggerRef.current?.focus()` before the re-render had remounted the trigger, so focus silently never returned; fixed by moving it into the effect's cleanup.

## BLOCKED
(none)
