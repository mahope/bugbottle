# bugbottle — implementeringsplan

Dette er hele den delte state for oxloopet. Læs den først; skriv i den, så
næste iteration ikke skal opdage det samme igen.

## Gate-definition (første gang, 2026-09-27)

- **Gate:** `npm run check` = typecheck → test → build → build:docs.
  Må ikke have fejl **eller** advarsler.
- **Ud over gaten, når site/ eller README ændres:** `npm run a11y` (kræver
  `npm run build:docs` først) og `npm run smoke:annotate`.
  Kræver Chrome. Ikke en del af `check`, men CI's `browser`-job kører dem.
- **Bundle-budgeter** må ikke flyttes uden at måle først (CLAUDE.md).
- Bemærk: `npm run check` kører `build:docs`, som **fejler** på en `##`-sektion
  i README der ikke står i `scripts/build-docs.mjs` `GROUPS`. Det er den
  billigste måde at opdage en glemt docs-side.

## Deploy (noteret 2026-09-27)

- `site/Dockerfile` bygger **ikke** i CI. Ingen workflow i `.github/workflows`
  (kun `ci.yml` og `release.yml`) bygger eller skubber billedet — ingen
  docker-push, ingen dokploy-konfiguration i repoet.
- Konklusion: **bugbottle.dev deployes uden for dette repo** (Dokploy, manuelt
  eller et andet projekt, `mahope/hermes-passiv` er et kandidat vi ikke kan se).
  Følger batch-tiderne 07:30 / 12:30 / 17:30 / 21:30. Skal bekræftes af Mads —
  se ❓.
- `dist/` er committet, så et site-image bygget fra en commit altid har den
  bibliotekversion der hører til.

## Baseline — trafik (2026-09-27)

| Kilde | Tal | Bemærkning |
|---|---|---|
| Plausible (analytics.holstjensen.eu) | **HTTP 401 — ingen data** | Scriptet blev først lagt på bugbottle.dev i commit `58f8ecc` 27/9 kl. 15:53. Der er ingen historik at sammenligne med. Første rigtige baseline kan tidligst være 28 dage senere, ca. 25/10. |
| Cloudflare 28 d | 4 918 unikke besøgende-dage, 6 198 sidevisninger, 23 287 requests | Tæller bots. Brug til retning. |
| Cloudflare 7 d | 1 308 unikke | ca. 1/4 af 28-dages-tallet, stabil. |
| npm `bugbottle` | 412 downloads/30 d, 191/7 d | Klassen "downloads pr. uge" er 3-4 % af det unikke webtrafik. |
| GitHub ★ | 2 (bugbottle), 0 (wordpress), 0 (action) | |
| Search Console | **ikke leveret** | Mads skal eksportere pr. side. Uden CTR-baseline kan vi ikke måle §1–§2. |

**MÅL-baseline for `/docs/nextjs/`:** 0 besøgende (siden siden ikke findes).
Forventelse: første visninger i Google efter indeksering, 1-5 pr. uge i de
første måneder. Sammenlign 25/10 og 25/11.

## Fase 3 — trafik-drevet

### Det vigtigste fund

**Vi skriver om en kategori, ingen autocompletter på, og mangler sider i den
kategori, der har efterspørgsel.** Google Suggest-tællinger (hentet 27/9 via
`suggestqueries.google.com`, FETCHED):

| Søgning | Forslag |
|---|---|
| `nextjs error boundary` | **15** |
| `angular error handling` | **15** |
| `nuxt error handling` | **11** |
| `astro error handling` | 1 |
| `in app bug report widget` | **0** |
| `user feedback widget javascript` | **0** |
| `sentry alternative self hosted` | 4 (købsintens!) |

De 36 eksisterende sider ligger i den række, der har nul forslag. Sentry har en
side pr. framework for ~40 runtimes; vi har 4 adapter-sider og nul
framework-integrationssider.

**Hvorfor det er en reel mulighed:** de officielle docs for Next.js
(`error.js`), Angular (`ErrorHandler`) og Nuxt (`error-handler.ts`) stopper
alle ved `// Log the error to an error reporting service` + `console.error`.
Ingen af dem siger "send den til dit eget endpoint". FETCHET fra
nextjs.org, angular.dev, nuxt.com.

### Opgaver, prioriteret efter forventet effekt

- [x] **1. `/docs/nextjs/` — Next.js-guide.** 27/9, `ceo/nextjs-guide`.
  15 suggest, officiel docs punkterer, Next er det mest søgte framework.
  Dækker `error.tsx` (med `error.digest`-rådet, som er den reelle fælde),
  `global-error.tsx`, `useBugReport` i en client component, script-tag-genvejen
  og route handler-modtageren. Plus en "hvad skal du tjekke før du shipper".
  Forventning: første indeksering, og en side der fanger søgninger vi ellers
  taber til Sentry-doksen.
- [ ] **2. `/docs/angular/`** — 15 suggest. `ErrorHandler` +
  `provideBrowserGlobalErrorListeners()`, script tag (ingen adapter nødvendig).
  Forventning: samme mønster som nr. 1, anden framework.
- [ ] **3. `/docs/nuxt/`** — 11 suggest. `vue:error`, `app:error`,
  `<NuxtErrorBoundary @error>`, `error.vue`, `fatal: true`-forskellen.
  Adapteren findes allerede, så det er ren dokumentation.
- [ ] **4. `/docs/astro/`** — 1 suggest, billigst (framework-agnostisk, script
  tag). Lav prioritet.
- [ ] **5. `/compare/`: tilføj Sentry-SDK'en** (`@sentry/react` 29,3 mio
  downloads/uge mod vores 191 — FETCHET fra npm-downloads-API'en) som
  sammenligningsobjekt. `/compare/` sammenligner i dag produkter (Marker.io,
  Jam, Sentry User Feedback, BugPin, rrweb), ikke biblioteker.
  Bemærk: det kræver kildeangivelse + dato, ellers er det en udokumenteret
  påstand.
- [ ] **6. Privacy: "hvad gør jeg med data jeg *allerede* har sendt?"**
  Rollbar har en stærk GDPR-sektion om også at slette allerede sendt data.
  Vores `/docs/privacy-checklist/` dækker kun før-sending. Konverterings- og
  tillidsemulighed, især over for virksomhedskunder.
- [ ] **7. CTR-måling.** Kræver Search Console-eksport fra Mads. Skriv
  CTR-baseline pr. side ned, før noget ændres i en titel. Billigste vækst, når
  vi har tallene.

### Køen efter dette

- Script-tagonlysningen til Angular/Nuxt/Astro er den samme kode, så de fire
  sider kan deles.
- Verifikations-sektionen i hver frameworkside er et genbrugeligt mønster
  (Sentry har det på hver side). Skriv det en gang som et afsnit.

## ❓ Til Mads

- **Search Console-eksport.** Uden pr. side-visninger, klik, CTR og position kan
  Fase 3 ikke måles. Én CSV-eksport pr. side, 28 dage.
- **Deploy.** Hvordan kommer bugbottle.dev live? Intet i repoet bygger
  `site/Dockerfile`. Skal jeg skrive en `site-deploy.yml`, eller deployer
  Dokploy direkte fra repoet?
- **Pro-navn.** Foreslået i en tidligere fase, ikke besvaret endnu. Noget i
  retningen "Buge" / "Trygg" / "Skærg" — noget der ikke bare hedder "Pro",
  fordi bugbottle ikke er noget man *proficerer* på. Skal jeg skrive tre
  konkrete navne med domænetilgængelighed og prispositionering?
- **Stripe.** Der er ingen `docs/stripe-kontrakt.md` i repoet og ingen
  `FUNDING.yml`, ingen `/support`-side. Vi sælger intet. Skal jeg foreslå
  betalte, licenskontrollerede open-core-tilføjelser under `❓`?

## ❓ Til Mads — søstrepos

Begge findes og er ubrugte (FETET via `gh api` 27/9):

- `mahope/bugbottle-wordpress` — "WordPress plugin for bugbottle: the report
  panel and a receiving endpoint in one activation", 0 ★, sidste push 8/9.
  `/docs/github-action/` findes; **en WordPress-side mangler helt**, selv om
  pluginet er det mest konverterende produkt vi har (én aktivering = panel +
  modtager). Ny side + et link fra `kom-i-gang`.
- `mahope/bugbottle-action` — "GitHub Action: validate bugbottle JSON bug
  reports in CI. Zero dependencies.", 0 ★, sidste push 7/9.

Vi arbejder kun i dette repo, så begge er forslag.

## Opgraderinger

Ikke startet. `~/.local/oxloop/AFHAENGIGHEDER.md` er ikke læst endnu — gjort i
den iteration der tager første afhængighedsopgave. Nul runtime-afhængigheder i
biblioteket, så overfladen er devDependencies + Node-versionen i
`site/Dockerfile` (node:22) og CI.

## Log

- **2026-09-27, iteration 1** (research + første opgave). Planen oprettet.
  Fund: kategorien har nul søgning, framework-integrationssiderne mangler.
  Landede `/docs/nextjs/` som ny README-sektion + ny `Integrations`-gruppe i
  sidebaren (`scripts/build-docs.mjs` `GROUPS`).
  Bemærk: `## Next.js` slugifierer til `nextjs`, så siden hedder
  `/docs/nextjs/` (ikke `next-js`) — samme skrivemåde som nextjs.dev.
