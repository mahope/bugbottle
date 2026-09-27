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
- [x] **2. `/docs/angular/`** — 15 suggest. `ErrorHandler` +
  `provideBrowserGlobalErrorListeners()`, script tag (ingen adapter nødvendig).
  Forventning: samme mønster som nr. 1, anden framework.
  27/9, `ceo/angular-guide`. **MÅL: `/docs/angular/` baseline 0 besøgende
  (siden findes ikke) pr. 2026-09-27.** Sammenlign 25/10 og 25/11.
- [x] **3. `/docs/nuxt/`** — 11 suggest. `vue:error`, `app:error`,
  `<NuxtErrorBoundary @error>`, `error.vue`, `fatal: true`-forskellen.
  Adapteren findes allerede, så det er ren dokumentation.
  27/9, `ceo/nuxt-guide`. **MÅL: `/docs/nuxt/` baseline 0 besøgende
  (siden findes ikke) pr. 2026-09-27.** Sammenlign 25/10 og 25/11.
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

## Fund fra Nuxt-iterationen (27/9) — de tre ting der gør siden bedre end de andre to

Kilderne er læst i `nuxt/nuxt` på `main` (samme version som `Recipes` bruger,
4.5.2) — `packages/nuxt/src/app/{entry.ts,nuxt.ts,composables/error.ts}`,
`components/{nuxt-root.vue,nuxt-error-boundary.vue}` og
`plugins/chunk-reload*.client.ts` — plus de udgivne `.d.ts` fra
`nuxt@4.5.2` og `@nuxt/schema@4.5.2`. **Ikke** docs-siden, som er det de fleste
koperier. Den siger for eksempel ingenting om `app:chunkError`.

1. **`config.errorHandler` og `vue:error` er ikke det samme, og hvilken af
   dem der ser en fejl afhænger af hvor fejlen opstod.** `nuxt-root.vue`'s
   `onErrorCaptured` kalder altid `vue:error`, og returnerer `undefined` for en
   almindelig klientfejl — så Vue *også* kalder `config.errorHandler` med det
   **samme** objekt. Men `<NuxtErrorBoundary>` returnerer `false` og kalder
   `vue:error` selv, så **kun** hooken ser den. Siden bruger derfor begge plus
   en `WeakSet`, så én hændelse er én rapport. Det er samme slags fund som
   Angular-sidens `onViewError`.
2. **Fælden der afgør om integrationen virker overhovedet:**
   `applyPlugins` (nuxt.ts:436-446) genkaster med det samme, medmindre
   `payload.error` allerede er sat — og så **stopper løkken**. Alle plugins
   efter den der kastede kører aldrig, også din. Symptomet er ikke en fejl, det
   er `error.vue`: en fuld side med et statusnummer og ingen konsol-linje, på
   en side ingen kan rapportere fra, fordi panelet er en af de plugins der ikke
   blev indlæst. `enforce: "pre"` er svaret. `enforce: "post"` er værre, og
   `dependsOn` hjælper kun mellem to plugins der begge findes.
3. **Den fejl Nuxt håndterer med vilje og aldrig viser nogen:**
   `app:chunkError`, typet `({ error }: { error: any }) => HookResult`, brugt af
   tre indbyggede plugins (`nuxt:chunk-reload`, `-immediate`, `-crawler`) der
   alle bare kalder `reloadNuxtApp`. Udløseren er en hashed chunk-URL der ikke
   findes længere fordi et deploy kom ud — præcis den klasse fejl en person
   melder ind, som vi ikke kan se. `experimental.emitRouteChunkError` er typet
   `false | "manual" | "automatic" | "automatic-immediate"` i `@nuxt/schema` —
   fire værdier, mens dokumentationen kun nævner to. Det er en konverterings-
   og tillidsmulighed, ikke en teknisk detalje.

**Bekræftet at en bruger-sat `config.errorHandler` overlever:**
`entry.ts:71-74` fjerner Nuxts *egen* standardhandler ved `app:suspense:resolve`,
men kun hvis den stadig er den samme reference (`handleVueError`, mærket
`__nuxt_default`). En handler sat i en plugin står der stadig efter hydration.

**Åben i18n-mismatch (ikke løst, samme som på de to andre sider):** de tre
framework-siderseksers er kun på engelsk. `site/da/kom-i-gang/` er dansk, resten
er ikke. Ikke en fejl, men det er den næste stor danske overbygning hvis
Mads vil have den.

## Fund fra Angular-iterationen (27/9) — genbruges af nr. 4

Kilderne er læst i `@angular/core@22.2.0`'s **types og FESM-bundle** (ikke
angular.dev, der er client-renderet og returnerer en tom skal til webfetch) samt
`adev/src/content/best-practices/error-handling.md` i angular/angular.
Verifieret: `ErrorHandler`, `provideBrowserGlobalErrorListeners()` og
`afterNextRender` er alle eksporterede offentlige API'er i 22.2.0.

- **Det mønster, der gør Angular-siden bedre end Next.js-siden:** Angular
  *lukker* fejlvejen. Alt frameworket fanger ender i `ErrorHandler`, og
  `provideBrowserGlobalErrorListeners()` føder vinduets `error` og
  `unhandledrejection` ind i samme sted — JSDoc'en kalder det "an environment
  initializer which forwards unhandled errors to the ErrorHandler". Ét
  injectable ser altså begge halvdele. Angulars egen guide fylder det med
  `trackEvent` + `console.error`, som er rigtigt for en udvikler og ikke er
  en rapport.
- **Fælden, ingen guide nævner, og som afgør om det virker:** en fejl i en
  service-metode du selv kalder, og en `resource()`-fejl nobody læser, når
  *ingen* handler. Frameworkets egen tekst siger det. Derfor er reporterens
  egen knap den større halvdel af opsætningen, ikke `ErrorHandler`.
- **Fælden nr. 2:** `ErrorHandler` findes ikke endnu, når der kastes fra en
  constructor før første render. `afterNextRender` løser mount-tidspunktet
  (og kører aldrig på serveren, hvilket er gratis SSR-beskyttelse), så tjenesten
  må huske et `open()`-kald og åbne ved mount.
- **Fælden nr. 3:** `onViewError?` er en optional hook på `ErrorHandler` for
  fejl i en components egen view. Dropper man den, taber man de mest synlige.
- **API-gap fundet (ikke bygget, kræver major/minor):** `mountBugbottle` har ingen
  public måde at forudfylde beskeden på for en anden kalder end sin egen
  `onUncaughtError`-lytter — `open()` tager ingen argumenter. En
  framework-fanget fejl åbner derfor panelet tomt, selv om beskeden er kendt.
  Se ❓ nedenfor.

## ❓ Til Mads

- **`mountBugbottle().open()` kan ikke forudfylde beskeden.** Panelets egen
  `openOnError: { prefill: true }` kan det, men kun for vinduesfejl, og kun
  fordi panelet selv ringer `openForError`. Ethvert andet kald — en
  framework-`ErrorHandler`, en `onShortcut`, din egen knap — får et tomt felt,
  selv om den kender beskeden. Fixet er lille (en valgfri
  `open({ prefill })`, ~40 bytes på `bugbottle/ui`), men det **rører et
  eksisterende eksports signatur**, så efter vores egne navneregler er det en
  minor, ikke en patch. Bygge det, eller lade framework-siderne pege på
  `bugbottle/triggers` og lægge fejlen i `extra` i stedet?
  **Nuxt-siden gør problemet større end de to andre:** `error.vue` er en hel
  separat side load, hvor panelet slet ikke er mounted, så en rapport derfra er
  nødt til at være en knap. Den beslutning tager nummer 4 (Astro) med sig, fordi
  den har samme fejl-side.
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

- **2026-09-27, iteration 3** (`ceo/nuxt-guide`). Landede `/docs/nuxt/` som
  tredje frameworkside under `Integrations`. 36 docs-sider (fra 35).
  Læst Nuxts *kilde* (`entry.ts`, `nuxt.ts`, `composables/error.ts`,
  `nuxt-root.vue`, `nuxt-error-boundary.vue`, `chunk-reload*.client.ts`) og de
  udgivne `.d.ts` for `nuxt@4.5.2` — samme version `Recipes` allerede bruger.
  Se "Fund fra Nuxt-iterationen"; de tre fund er hver især noget ingen guide
  siger, og de gør siden bedre end de to forgangne.
  - `dist/` er uændret af builden, byte for byte — ingen eksport rørte sig,
    så ingen budget flyttede.
  - **Tre ting jeg rettede i mit eget udkast,** som er værd at huske næste gang
    en frameworkside skrives: (1) en `nuxtApp.hook("app:beforeMount", …)` som
    "teardown" er **forkert** — den fyrer før `onNuxtReady` overhovedet har lavet
    widgeten, så den sletter ingenting; (2) `showError` **pakker** fejlen i en
    ny `NuxtError` før den kalder `app:error`, så en `WeakSet` på fejlobjektet
    kan ikke fange `app:error`-dobbeltoptaget for en fatal fejl (harmløst,
    fordi `open()` er idempotent); (3) `enforce: "pre"` er ikke kosmetik — den er
    den eneste grund til at pluginet kører overhovedet.
  - ⚠️ **`npm run a11y` og `npm run smoke:annotate` kunne ikke køre:** samme
    grund som i iteration 2, ingen Chrome på maskinen. Siden er ren Markdown —
    ingen nye DOM-elementer, ingen ny CSS, ingen nye controls — så a11y-auditten
    rammer ikke denne ændring, og CI's `browser`-job kører den på hvert push.

- **2026-09-27, iteration 2** (`ceo/angular-guide`). Landede `/docs/angular/`
  som anden frameworkside under `Integrations`. 35 docs-sider (fra 34).
  Læst Angulars egen fejlhåndteringsguide og verificérede hver API-reference
  mod `@angular/core@22.2.0`'s typer i stedet for mod angular.dev, som er
  client-renderet. Se "Fund fra Angular-iterationen" — den er skrevet til at
  genbruges af Nuxt- og Astro-siderne.
  - ⚠️ **`npm run a11y` kunne ikke køre her:** ingen Chrome på maskinen
    (`findChrome()` returnerer en Windows-sti, `/Applications/Google Chrome.app`
    findes ikke, ingen `CHROME_BIN`). `npm run smoke:annotate` heller ikke.
    Begge er ikke en del af `npm run check` og CI's `browser`-job kører dem på
    hvert push — så de fanges der, ikke her. Jeg har bevidst ikke tilføjet
    uauditérede DOM-elementer for at komme uden om det: det `<a id>`-anker jeg
    først havde lagt på "Errors with no-window-event" var hverken linket til
    eller nødvendigt (headingslug'en giver samme id) og blev fjernet.
  - `dist/` er uændret af builden, byte for byte — ingen eksport rørte sig, så
    ingen budget flyttede.

- **2026-09-27, iteration 1** (research + første opgave). Planen oprettet.
  Fund: kategorien har nul søgning, framework-integrationssiderne mangler.
  Landede `/docs/nextjs/` som ny README-sektion + ny `Integrations`-gruppe i
  sidebaren (`scripts/build-docs.mjs` `GROUPS`).
  Bemærk: `## Next.js` slugifierer til `nextjs`, så siden hedder
  `/docs/nextjs/` (ikke `next-js`) — samme skrivemåde som nextjs.dev.

## Deploy-noter

- `VERIFICÉR DEPLOY: /docs/nextjs/ + Integrations-gruppen i sidebaren
  20867c0 2026-09-27 ~15:57` — første batch-vindue efter merge er 17:30
  2026-09-27. Verificér **indhold**, ikke HTTP 200: siden skal findes i
  `https://bugbottle.dev/sitemap.xml`, og `https://bugbottle.dev/docs/nextjs/`
  skal vise guiden med `error.tsx`-eksemplet og "Integrations" i sidebaren.
  Sidstmod for `/docs/nextjs/` i sitemap'en skal være 2026-09-27.
  *(Skrevet 16:24; vinduet er ikke gået endnu, så intet at verificere.)*

- `VERIFICÉR DEPLOY: /docs/angular/ (ny integrationsside, 35 sider i
  sitemap'en) 937367d, merge f0d23c1, 2026-09-27 17:47` — vinduet 17:30 var
  lukket da vi mergede, så næste er 21:30. Verificér **indhold**:
  `https://bugbottle.dev/sitemap.xml` skal liste
  `https://bugbottle.dev/docs/angular/`, siden skal vise Angular-guiden med
  `provideBugbottle`/`BugbottleErrorHandler`, og `Integrations`-gruppen i
  sidebaren skal have to sider. Sidstmod for `/docs/angular/` skal være
  2026-09-27. Begge nye sider og `nextjs`-siden kan verificeres i samme
  kørsel.


- `VERIFICÉR DEPLOY: /docs/nuxt/ (tredje integrationsside, 36 sider i
  sitemap'en) 118efbb, 2026-09-27 ~18:5x` — næste batch-vindue er 21:30
  2026-09-27. Verificér **indhold**: `https://bugbottle.dev/sitemap.xml` skal
  liste `https://bugbottle.dev/docs/nuxt/`, siden skal vise Nuxt-guiden med
  `enforce: "pre"` og `app:chunkError`, og `Integrations`-gruppen i sidebaren
  skal have tre sider. Sidstmod for `/docs/nuxt/` skal være 2026-09-27.
  **Alle tre deploy-noter kan verificeres i én kørsel** (nextjs, angular, nuxt).
