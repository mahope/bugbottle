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
- [x] **4. `/docs/astro/`** — 1 suggest, billigst (framework-agnostisk, script
  tag). Lav prioritet. 27/9, `ceo/astro-guide`. **MÅL: `/docs/astro/`
  baseline 0 besøgende (siden findes ikke) pr. 2026-09-27.** Sammenlign
  25/10 og 25/11. Se "Fund fra Astro-iterationen" — den stærkeste af de
  fire, fordi kilden er en *uundokumenteret* API.
- [x] **5. `/compare/`: tilføj Sentry-SDK'en** (`@sentry/react`) som
  sammenligningsobjekt. 27/9, `ceo/sentry-sdk-compare`. Se "Fund fra
  Sentry-SDK-rækken" — og bemærk at tallene er **målt, ikke citeret**.
  **MÅL: `/compare/` og `/da/sammenlign/` baseline 0 pr. 2026-09-27**
  (Plausible 401; Cloudflare 6 198 sidevisninger/28 d på hele sitet).
  Sammenlign 25/10.
- [x] **6. Privacy: "hvad gør jeg med data jeg *allerede* har sendt?"**
  Ny sektion i begge privatlivssider. Se "Fund fra privacy-iterationen" — to
  fund, der var **ikke** i planen: `fileStore.list()` har ikke `contact`, og
  panelet viser ikke rapport-id'et.
  27/9, `ceo/privacy-erasure`. **MÅL: `/docs/privacy-checklist/` og
  `/da/privatliv/` baseline 0 (Plausible 401; Cloudflare 6 198 sidevisninger/28 d
  på hele sitet) pr. 2026-09-27.** Sammenlign 25/10. Effekten forventes ikke at
  komme fra trafikken men fra tilliden i salgsfasen — en virksomhedskundes
  privacyfunktion spørger om denne side, før den spørger om features.
- [x] **9. `/docs/react/` — React uden meta-framework.** 27/9, `ceo/react-page`.
  Se "Fund fra React-iterationen" — de tre fælder, ingen af dem i Reacts egen
  dokumentation. **MÅL: `/docs/react/` baseline 0 besøgende (siden findes ikke)
  pr. 2026-09-27.** Sammenlign 25/10 og 25/11. 39 docs-sider (fra 38).
- [x] **10. `/docs/vue/` — Vue uden meta-framework.** 28/9, `ceo/vue-page`.
  10 suggest, `bugbottle/vue` er en selvstænd adapter, og `vue:error` var kun
  dokumenteret som halvdelen af Nuxt-siden. Se "Fund fra Vue-iterationen" —
  fire fund, alle fra de **publicerede produktionsbuilds**
  (`@vue/runtime-core@3.5.43` + `vue-router@5.3.1`), ingen fra docs.
  **MÅL: `/docs/vue/` baseline 0 besøgende (siden findes ikke) pr. 2026-09-27.**
  Sammenlign 25/10 og 25/11. 40 docs-sider (fra 39), 159 søgeposter (fra 150).
- [x] **11. `/support/` + `.github/FUNDING.yml`.** 28/9, `ceo/support-page`.
  Datagrund: produktfasens regel om donationslinks var ikke opfyldt — planens egen
  ❓-punkt sagde "ingen `FUNDING.yml`, ingen `/support`-side. Vi sælger intet", og
  det er det dyreste hull i et open-core-produkt: i dette felt sælger
  konkurrenterne præcis det bugbottle ikke har (et dashboard bag en plan), så
  en læser, der leder efter en pris, finder i stedet ingenting og konkluderer, at
  noget er holdt hemmeligt. Siden siger positionen: ingen Pro, ingen
  team-licens, intet supportkontrakt, og en donation låser intet op i produktet.
  Den svarer på de to spørgsmål, der afgør om nogen overhovedet shipper det på
  arbejde (hvad pengene går til / hvad de ikke køber) og på procurementlisten
  (kommerciel brug, DPA, SLA, sikkerhedskontakt, hvor rapporterne ender).
  **MÅL: `/support/` baseline 0 besøgende (siden findes ikke) pr. 2026-09-27.**
  Sammenlign 25/10. Effekten forventes ikke at komme som trafik — den kommer som
  tillid i salgsfasen, på samme måde som opgave 6.
- [x] **12. `/docs/react-router/` — React Router v7, v8 og Remix.** 10 suggest
  målt 28/9 (`react router error boundary` 10, `remix error boundary` 2,
  `sveltekit error handling` 4, `solidstart` 0, `qwik` 0) — **tredjestørste
  efterspørgsel i rækken efter Next.js og Angular**, og de er konkrete:
  "react router 7 error boundary", "… props", "… not working", "… 404",
  "… redirect", "react-router declarative error boundary". Remix *blev* React
  Router, så én side dækker begge navne, og `bugbottle/react` passer i forvejen
  til den. Kilden er de publicerede builds af `react-router@8.4.0` +
  `7.18.4`, `@remix-run/react@2.17.5` og `react-dom@19.3.0` — **ikke** deres
  dokumentation, men den *ene* undtagelse: deres egen
  `docs/how-to/error-reporting.md` er konkurrentens svar, og siden starter med
  den og siger hvor den holder op. **MÅL: `/docs/react-router/` baseline 0
  besøgende (siden findes ikke) pr. 2026-09-27.** Sammenlign 25/10 og 25/11.
  41 docs-sider (fra 40), 176 søgeposter (fra 165). 28/9, `ceo/react-router-guide`
  (anden commit end `ceo/keep-react-console-line`, samme iteration). Se "Fund fra
  React-Router-iterationen" — otte fund, og **den stærkeste af alle siderne,
  fordi den eneste, der fik os til at finde en fejl i vores egen kode.**
- [x] **13. `/docs/svelte/` — Svelte 5 og SvelteKit.** 28/9,
  `ceo/svelte-page`. Den **eneste adapter uden egen side**
  (`bugbottle/svelte` har 1536 B marginalt budget og to halve sektioner i
  "Get started", ingen `/docs/svelte/`). Efterspørgslen målt 28/9 00:5x
  (Google Suggest, samme metode som 27/9): `sveltekit error handling` 4,
  `svelte error handling` 3, `svelte error boundary` 3, `sveltekit onerror` 0,
  `svelte 5 error handling` 0. **Lavere end de sider vi allerede har lavet**
  (nextjs/angular 15, nuxt 11, react/vue/react-router 10), så den er skrevet
  på adapter-gapet, ikke på efterspørgslen — og det er et ægte hull: to
  sider der ligner hinanden mere og mere, fordi de er de eneste der *ikke*
  handler om den adapter. Målt i samme kørsel og **ikke** valgt:
  `laravel error handling` **10** (højere!), men forslagene er PHP undtagelse,
  ikke en JS-reporter, så en side der svarer på den søgning ville være
  tynd og emaljeagtig; `solid error handling` 0; `inertia js error
  handling` 1. Se "Fund fra Svelte-iterationen" — fire fund fra
  `svelte@5.57.1`'s boundary-runtime, og de er **alle fire i kode, ingen i
  docs**. **MÅL: `/docs/svelte/` baseline 0 besøgende (siden findes ikke)
  pr. 2026-09-28.** Sammenlign 25/10 og 25/11. 42 docs-sider (fra 41), 184
  søgeposter (fra 176).
- [x] **17. Søgningssætning for hver side — den billigste vækst, der
  findes.** 28/9, `ceo/page-descriptions`. Datagrund: **40 af 48 sider havde en
  `<meta name="description">` der endte i en ellipse**, fordi builden tog sidens
  første afsnit klippet ved 157 tegn, og seks af dem skrev om sitet i stedet for
  om siden (`NestJS is the sixth framework in this row`, `Every other page on
  this list is about a browser`, `this package does not yet have a page for`).
  Fase 3 siger at dårlig CTR ved en god position er den billigste vækst, fordi
  trafikken er der allerede — og det er præcis den, vi havde ødelagt på hver en
  af de 50 sider. Søgeordene er skrevet ind i sætningen, så de ligner det folk
  indtaster: `error.tsx`, `fastifyHandler`, `svelte:boundary`, `bodyLimit`.
  Bygningen fejler nu på en side uden sætning, på en klippet en og på en der
  taler om sitet. **MÅL: `/docs/` samlet baseline 0 besøgende pr. 2026-09-28**
  (Plausible 401; Cloudflare 6 351 sidevisninger/28 d). Kan ikke måles før
  Search Console-eksporten (opgave 7). Sammenlign 25/10 og 25/11.
  Se "Fund fra description-iterationen" i loggen.
- [x] **18. `/docs/express/` — server-side, den framework vi allerede har en
  export til.** 10 suggest målt 28/9 02:0x (`express error handling
  middleware`), og **Express er den eneste server-framework uden en side**,
  selv om `expressHandler` er den mest brugte export i `bugbottle/server`.
  Genstanden er ikke gentaget kode: Fastify- og NestJS-siderne fandt begge den
  *samme* 100 kB / 1 MiB body-limit-fælde, fordi de er Express-arvinge, så
  siden skal begynde med den og med `rawBody` på en signeret rute. Research
  først (planen: læs `express@5`'s published build, ikke Express' docs — de otte
  forgående sider er alle bygget på den metode). **MÅL: `/docs/express/`
  baseline 0 pr. 2026-09-28.** Sammenlign 25/10 og 25/11.
  28/9, `ceo/express-guide`. **Ingen ny export** — siden dokumenterer den
  eksisterende adapter. Se "Fund fra Express-iterationen": fem fund, og **to er
  nye fejlklasser for hele rækken** (den afviste forespørgsel, og stacktrace i
  svaret). 46 docs-sider (fra 45), 217 søgeposter (fra 209).
- [x] **19. `x-forwarded-proto` i URL'en adapteren bygger — lille rettelse i
  `src/server/express.ts`.** Fundet i Express-iterationen (punkt 5): adapteren
  tog `x-forwarded-proto` i frifart, når den bygger den `Request` den sender
  videre, uanset `trustProxy` — altså læser den ét forwarding-header
  ubetinget, imens ratelimitten læser socketen med mindst samme omhu. Bag en
  proxy der ikke sætter headeren er URL'en `http://` for en rapport sendt over
  HTTPS. **Det er ikke en sikkerhedshull** (signaturen er over kroppen,
  ratelimitten er over adressen, validererne rører ikke URL'en), men det er en
  asymmetri mellem hvad vi logger og hvad vi tæller, og det er den slags der
  senere læses som sandhed i en log. **Accept:** URL'en bygges af samme
  `trustProxy`-beslutning som ratelimitten, `tests/server.test.ts` får en test
  der viser `https://` ved `trustProxy: { header: "x-forwarded-proto" }` og
  `http://` uden den, og en diff på de to adaptere så de ikke driver fra hinanden
  igen. Lille nok til én iteration; **må ikke** trække et budget med sig — kun
  `bugbottle/server`, hvis det overhovedet flytter noget (det gør det ikke: det
  er `handleReport`'s path, som validator-bundlen aldrig når). 28/9,
  `ceo/trusted-proto`. **Accept holdt, med to rettelser til opgaven:** (1) testene
  ligger i `tests/handle.test.ts` — der findes ingen `tests/server.test.ts`, og
  det er dér begge adaptere allerede er testet; (2) `Fastify`-adapteren havde
  **samme linje**, så rettelsen gik i begge, gennem én ny funktion
  `clientScheme` i `src/server/handle.ts` ved siden af `clientAddress` — så
  "samme beslutning som ratelimitten" er nu kode, ikke to linjer der ligner
  hinanden. Målt: ingen budget flyttede sig (IIFE'erne er uændrede, fordi
  serverkoden ikke er i dem), 893 tests grønne.

- [x] **20. `dist/server/fastify.js` er aldrig blevet committet — den
  publicerede server-entry kastede på import.** Fundet i iterationen med
  opgave 19, som en følge af `npm run check` og ikke af research. `dist/` er
  `.gitignore`'et og force-addet i stedet, så de fire filer
  `fastifyHandler` skabte da den export landede (`fastify.js`, `fastify.d.ts` og
  to maps) landede **utrackede** — mens `dist/server/index.js` lige ved siden af,
  som *er* tracket, har importeret `./fastify.js` siden. Bevis, ikke formodning:
  `git archive HEAD dist | tar -x` ud i en tom mappe og
  `import('/tmp/…/dist/server/index.js')` svarer
  `ERR_MODULE_NOT_FOUND: Cannot find module '…/dist/server/fastify.js'`. Altså:
  **`npm install github:mahope/bugbottle` og jsDelivr — de to veje der tager det
  committede `dist` som det er, uden et byggetrin — gav `ERR_MODULE_NOT_FOUND`
  på `bugbottle/server`.** Ikke én export brudt, hele entry'en, og alle sinks med
  den. Build grøn, `npm test` grøn, `git diff --quiet -- dist` grøn: en `git
  diff` kan ikke se en fil, der aldrig blev addet, fordi `dist/` er
  gitignore'et. **Rettet:** de fire filer er committede (208 mod 204 trackede), og
  `scripts/check-dist.mjs` spørger det spørgsmål, en diff ikke kan: `git
  ls-files` mod en walk af `dist/`, med `git add -f` i beskeden. Det kører som
  sidste trin i `npm run check` og i CI's `check`-job (der nu kalder scriptet
  i stedet for den indlejrede diff-linje), så den næste `fastifyHandler` kan
  ikke lande samme sted. **Accept:** `npm run check` grøn, `check-dist` med
  grønt resultat på 208 filer, og import fra et `git archive`-udtræk svarer OK.
  Bemærk til Mads: hvis nogen har installeret fra GitHub siden 28/9 kl. 02:4x,
  har `bugbottle/server` ikke virket for dem. **Ingen release endnu** — det er
  en patch, og den skal med i næste version.
- [x] **21. `widget.open({ message })` — panelen kan få en besked lagt i
  forvejen.** 28/9, `ceo/open-prefill`. **Datagrund:** ikke trafik, men det
  mest genbrugelige fund i hele planen — det stod under ❓ i *fire* iterationer
  og blev nævnt i hver en af dem, fordi det rammer alle framework-siderne, der
  åbner panelet fra en krog. Kilden er de **otte åbne kaldesætninger i README's
  egne kode-eksempler**, hvoraf to bar en kommentar, der sagde det samme:
  ``// `open()` takes no arguments, so the box opens empty.`` (Astro og
  SvelteKit). Den kommentar var sand, og alle otte kaldesætninger sendte en
  rapport, hvis reporter skulle skrive beskeden selv — i det øjeblik hvor
  vedkommende ser en side gå i stykker. **Det er konvertering, ikke features:**
  den dyrebeste del af en rapport er den linje, og den var tom. **Accept:**
  `open({ message })` på `BugbottleWidget`, klippet til `MAX_MESSAGE_LENGTH`
  (samme tal serveren gemmer, så intet tabes), aldrig over en igangværende
  klitring; `openOnError: { prefill }` fylder nu gennem **samme linje**, så de
  to kan ikke glide fra hinanden; ikke-tekst ignoreres i stedet for at blive
  `[object Object]` (et `ErrorHandler` får `unknown`); de fem sider hvis
  snippets kalder `open()` fra en fejlkrog (Vue, Nuxt, Astro, SvelteKit,
  Angular) er rettet, så ingen side documenteerer en adfærd der ikke længere
  findes. **Målt:** `bugbottle/ui` 11 596 → **11 625** (+29, budget 11 776),
  `dist/bugbottle.js` **24 688** (budget 25 088), `dist/bugbottle.slim.js`
  **21 104** (budget 21 504) — ingen budget flyttede sig. 896 tests grønne.
  **Navnet er `message`, ikke `prefill`**, se ❓: `prefill` er allerede en
  *boolsk* indstilling i `openOnError`, og en nøgle der betyder en streng ét sted
  og et flag et andet er præcis den fejl `docs/api-audit-1.0.md` #69 eksisterede
  for at rette. `message` er rapportens eget felt, så nøglen siger hvad den
  indeholder. Det er en **minor** (signaturen på en eksisterende export), ikke en
  patch.
- [x] **22. `/self-hosted/` — siden der svarer på "sentry alternative" og
  "self hosted error tracking".** 28/9, `ceo/self-hosted-page`.
  **Datagrund:** målt 28/9 05:3x (Google Suggest, samme metode som de ni
  forgående iterationer) — `sentry alternative` **10** (første forslag er
  "sentry alternatives", derefter "sentry alternatives open source", "… free",
  "sentry alternative self hosted"), `open source error tracking` **10**
  ("open source error monitoring", "open source error logging tools"),
  `bug report tool` **10** ("bug report tool open source", "bug reporting tools
  in software testing"), `self hosted error tracking` **7** ("self hosted error
  monitoring", "self hosted error logging", "self hosted vs hosted"),
  `error reporting javascript` 6 ("javascript error reporting library").
  Altså: den **eneste** kategori vi har en række sider i (tolv frameworksider
  + `/compare/`) uden en side til. Og den er den mest **købsintente** i hele
  målingen — en læser der skriver "sentry alternatives open source" er ved at
  vælge en erstatning, ikke ved at lære noget. `/compare/` er en tabel, og en
  tabel er et svart svar på "hvad skal jeg køre selv"; spørgsmålet handler om
  drift. **Siden** siger det ærligt modsat de fleste: der er **intet at
  self-hoste** (ingen container, ingen database, ingen version), fordi
  bagenden er to eksporterede funktioner og en rute du allerede har. Den har de
  tre former (rute i eksisterende app / `examples/inbox` i en container /
  WordPress-plugin'et, én aktivering), de **operationsmål** der er sande
  (2000 rapporter i `DEFAULT_MAX_REPORTS`, retention fra som 0 og `prune()` er
  noget *du* schedulerer, 2 MiB base64 i `MAX_SCREENSHOT_BYTES` under et loft på
  4 MiB), de **fem fælder** der er egenskaber ved *din* deployment og ikke
  ved frameworket (samme fem som på Express-, Fastify-, NestJS-siderne, samlet
  i én tabel med links), og en ærlig "hvad du får ikke" (ingen kø, ingen
  alarmering, ingen tidsserier, replay kun hvis du medbringer rrweb, ét browser-
  kørsel i CI). Alt med tal fra konstanter i koden, ingen vendor-påstande. 55
  URL'er i sitemap'en (fra 54), 6 søgeposter (side + 5 headings), sidebar-post i
  About, link fra BugPin-afsnittet i `/compare/`. **MÅL: `/self-hosted/`
  baseline 0 besøgende (siden findes ikke) pr. 2026-09-28.** Sammenlign 25/10
  og 25/11. Se "Fund fra self-hosted-iterationen" i loggen.

- [x] **23. `/docs/global-errors/` — `window.onerror` og
  `unhandledrejection`.** 28/9, `ceo/global-error-events`. **Datagrund:** målt
  28/9 06:2x (Google Suggest, samme metode som de tø forgående iterationer) —
  `window onerror` **10**, `window.onerror` 10, `javascript error handling` 10,
  `catch javascript errors` 6, `uncaught exception javascript` 6,
  `onunhandledrejection` 5. Det er **den største ucoverede klynge i hele
  målingen**, og den eneste hvor forespørgslen er en *kode-linje* læseren
  vil skrive frem for et framework-navn. De tretten frameworksider begynder alle
  et niveau over de to events — på frameworkens egen krog — så de to events der
  ringbufferen faktisk sidder på, har aldrig haft en side. Siden siger de to
  signaturers asymmetri (`onerror` får fem argumenter, `addEventListener` ét
  `ErrorEvent`), de **fem** ting der afgør om noget indfanget er brugbart (en
  ressource-`error` på et element der ikke bobler, `Script error.` for et
  cross-origin script, et cross-origin-rejection der **ikke fyrer noget event
  overhovedet** fordi det ville lække grunden, en Workers egen globale scope,
  og `event.error` der er hvad der blev kastet), og hvad en ufanget fejl
  faktisk lægger i en rapport: én linje til læseren og højst ti frames, som er
  **positioner og aldrig kildekode**. Kilde: MDN, læst 28/9. **MÅL:
  `/docs/global-errors/` baseline 0 besøgende (siden findes ikke) pr.
  2026-09-28.** Sammenlign 25/10 og 25/11. 47 docs-sider (fra 46), 228
  søgeposter (fra 217). **Ingen kodeændring** — begge IIFE'er vejer 24 688 /
  21 104 gzipped, uændrede, `check-dist` grøn på 208 filer, 896 tests grønne.

- [ ] **7. CTR-måling — BLOCKED: kræver Search Console-eksport fra Mads**
  (28 dage, pr. side). Uden den kan vi ikke skrive en CTR-baseline pr. side, og
  så er §1–§2 umålelige. Billigste vækst, når tallene kommer. Står under ❓.
- [x] **15. `/docs/fastify/` + `fastifyHandler`-export.** 28/9,
  `ceo/fastify-handler`. Se "Fund fra Fastify-iterationen". **MÅL:
  `/docs/fastify/` baseline 0 besøgende (siden findes ikke) pr. 2026-09-28.**
  Sammenlign 25/10 og 25/11. 44 docs-sider (fra 43), 202 søgeposter (fra 194).
- [x] **16. `/docs/nestjs/` — NestJS.** 28/9, `ceo/nestjs-page`. Målt igen
  28/9 02:2x (Google Suggest, samme metode): `nestjs exception filter` **10**,
  `nestjs error handling` **10**, `nestjs interceptor` 10, `nestjs middleware`
  10, `nestjs filter` 10, `nestjs http exception` 4, `nestjs catch exception` 3,
  `nestjs global exception filter` 1, `nestjs useGlobalFilters` 1 — altså
  **samme bånd som de fire sider vi lige har lavet**, og de er konkrete
  (dependency injection, best practices, not working, prisma, graphql, flere
  filtre). Kilden er de publicerede builds af `@nestjs/core@11.2.6` +
  `@nestjs/platform-express@11.2.6` + `body-parser`, **ikke** docs.nestjs.com.
  **Ingen ny export**: Nest's default platform *er* Express, så `@Req()`/
  `@Res()` er det par `expressHandler` allerede læser. Se "Fund fra
  NestJS-iterationen" — fire fund i koden, og det første er en fejl der
  **ikke kan rapporteres overhovedet**.
  **MÅL: `/docs/nestjs/` baseline 0 besøgende (siden findes ikke) pr.
  2026-09-28.** Sammenlign 25/10 og 25/11. 45 docs-sider (fra 44), 209
  søgeposter (fra 202).

### Fund fra global-errors-iterationen (28/9) — den første side om de to events
  selv, og den sjette skrivning af det samme mønster

Metoden var målingen igen (Google Suggest, `suggestqueries.google.com`,
FETCHET 28/9 06:2x) og **kilden var MDN denne gang** — `Window: error event` og
`Window: unhandledrejection event`, begge læst 28/9. Det er første gang de otte
framework-siders metode (læs det publicerede build, ikke dokumentationen) ikke
er den rigtige, og det er rigtigt: der er ingen build at læse for to browser-
events, og MDN *er* kilden. Siden blev skrevet fordi emnet har **null** sider,
ikke fordi fundene var nye.

**Fire ting der var nye for os, alle med kilde:**

1. **`onerror`-propertyet og `addEventListener` har to forskellige
   signaturer.** `onerror` får `(message, source, lineno, colno, error)`,
   `addEventListener` får ét `ErrorEvent` med de samme fem felter. Det er det
   **eneste** handler-property på `window` der får mere end ét argument, og
   det er grunden til at kode der virker i det ene, virker ikke i det andet.
   Vores egen kode bruger `addEventListener` — det er derfor
   `console-buffer.ts` læser `e.message`/`e.filename`/`e.lineno` på eventet
   og ikke på fem løse argumenter.
2. **`return true` i `onerror` slår konsollinjen fra**, mens alle andre
   handler-properties annullerer ved `return false`. En læser der kopierer
   mønsteret fra en anden event og skriver `return false`, får en fejl i to
   udgange.
3. **Et cross-origin rejection fyrer `unhandledrejection` slet ikke.** MDN
   siger det direkte: "Promise rejections that originate from a cross-origin
   script won't fire this event", fordi eventet bærer grunden. Det er det eneste
   sted hvor browseren **med vilje** skjuler en fejl, og der er ingen fix fra
   siden — kun en CORS-overskrift på det script der *kaster*. Skrevet op som sådan.
4. **`unhandledrejection` bobler op i konsollen medmindre `preventDefault()`.**
   Altså: en læser der skriver sin egen handler og *også* vil beholde
   browserens egen røde linje, skal ikke kalde `preventDefault()` — og en der
   gør, mister den.

**To fund der bekræfter noget, vi vidste, fra en ny vinkel:**

- **Ressource-fejl er et andet event end script-fejl.** MDN's egen sætning er
  "fired on a Window object when a resource failed to load **or** couldn't be
  used", hvilket er tvetydet, og siden siger derfor kun det sikkert kendte: et
  `error` på et element bobler ikke, så en `window`-lytner uden `capture: true`
  ser det aldrig, og `event.error` er `undefined`. **Jeg skrev ikke "MDN siger
  at det ikke bobler", fordi den side ikke siger det** — det er en skrivefejl
  af slagsen "find en kilde eller skriv det som det er det".
- **En Workers globale scope er et andet objekt med de samme to events**, og
  vores `initConsoleBuffer` lytter kun når `typeof window !== "undefined"`
  (`src/console-buffer.ts:100-109`). Altså: **en rapport kan ikke indeholde
  worker-fejl**, og det er skrevet på siden i stedet for at være en skjulest fejl
  i et produkt der ellers ikke nævner Workers.

**Mønstret der er blevet en regel (sjette skrivning):** "dækker siden, hvad der
sker med konsollen?" findes nu i React, Nuxt, Hono, Vue, Astro og denne side. Det
er ikke længere en ting hver frameworkside husker — det er **en** afsnit, der
skal skrives, fordi det er den ofte oversete halvdel af en fejlkrog.

**Næste kandidater i kategorien** (målt samme kørsel, ikke valgt):

- **`datadog alternative` 10** — det største **uafdækkede** købsintente
  emne efter `/self-hosted/` (som svarede på `sentry alternative` 10 og
  `open source error tracking` 10). Samme form som sammenligningen: en række i
  `/compare/` målt med `scripts/measure-competitors.mjs` på
  `@datadog/browser-rum` + `errorTracking`, daterede kilder, og ærlig
  tekst om at Datadog er et overvågningsprodukt med APM og ikke et
  rapportværktøj. **Forbehold:** to produkter med forskellige formål i én tabel
  kan blive den tynde sammenligning, `/self-hosted/` blev skrevet imod. Skal
  researches før den skrives.
- `error monitoring tool` 9, `error reporting tool` 5, `user feedback tool` 5
  — generiske købsforespørgsler. **Ingen ny side:** de er besvaret af
  `/self-hosted/`, `/compare/` og forsiden, og tre sider der svarer på samme
  generiske søgning er tre tynde sider.
- `error boundary` 10 og `react error boundary` 10 — dækket af
  `/docs/catching-render-errors-react/` (React) og `/docs/react/`. En
  *generisk* "hvad er en error boundary"-side ville være tynd, fordi
  error boundaries er React's ord; skriv den kun hvis nogen kan gøre den til en
  sammenligning af de tre klasser (krog i frameworket / fejl i din egen kode
  ingen krog ser / fejl i en fejl-side), og den klassifikation findes allerede
  i planens egen "Køen efter dette".
- `cloudflare workers error handling` — målt **1** i denne kørsel mod **5** i
  Hono-iterationen samme dag. Et tal der bevæger sig fire pladser på en dag er
  ikke et tal at bygge en side på; Hono-siden dækker Workers i dag.

### Fund fra NestJS-iterationen (28/9) — den sjette fejlklasse, og hvor den ikke kan

Fire fund, alle læst i de publicerede builds. Ingen af dem er i Nests egen
dokumentation, og det første er en klasse fejl vi ikke kan rapportere.

1. **En `BaseExceptionFilter` kan ikke samle en rapport.** Den kører på
   serveren og har aldrig set console-ringbufferen, DOM'en, screenshotet eller
   den sætning en person skrev. Den *forwarder* en serverfejl; den opsamler
   ikke en rapport. Siden siger det i første afsnit, fordi det er den fejl
   alle otte sider før denne har undgået at sige: en ramme skal have den
   fejlklasse den kan se, og en browserreporter skal have den *ikke* har.
2. **Standard body-limit er 100 kB — fyrre gange for lille.**
   `get-body-parser-options.util.js` sætter ingen `limit`, så `express.json()`
   arver body-parsers `102400 // 100kb default`. En rapport med screenshot er
   2 MB base64 og bliver 413'et **før controlleren køres**; `http-errors`
   sætter både `status` og `statusCode`, så `isHttpError` genkender den og
   Nest svarer 413 i *sine* felter. `handleReport`'s eget loft er 4 MiB.
   Fastify-siden fandt samme fejl med 1 MiB; **den mønsterfejl gentager sig
   én for hvert server-framework, og den er usynlig** fordi alle rapporter
   under loftet ankommer. Fix: `app.useBodyParser("json", { limit: "5mb" })`.
   Med `@nestjs/platform-fastify` findes metoden ikke — adapteren logger
   "does not support `.useBodyParser`" — hvilket er grunden til at Fastify og
   Nest er to sider.
3. **En signeret rute kræver `rawBody: true`, og det er ikke nok.**
   `rawBody` sætter en `verify`-funktion der gemmer bytes på `req.rawBody` —
   bedre end Fastify, hvor der skal registreres en parser. Men `expressHandler`
   læser `req.body` og serialiserer et objekt, så de verificerede bytes er
   ikke de signerede. Ruten skal selv bygge en `Request` af `req.rawBody`
   (verificeret i Node 22: `new Request(url, { body: buffer })` tager et
   `Buffer` som `BodyInit`). Det er **det eneste sted i pakken hvor det er
   rigtigt at bygge `Request` manuelt** i stedet for som sidste udfugt.
4. **Et filter uden `@Catch()`-argument fanger alt og vinder.**
   `selectExceptionFilterMetadata` er
   `filters.find(({ exceptionMetatypes }) => !exceptionMetatypes.length || …)`
   over et `filters.reverse()`-et array, så første match vinder og det er den
   **sidst registrerede**. Regelmodellen er modsat middleware's: den
   specifikke filter først, catch-all sidst. Plus: `getArgByIndex(1)` er en
   *parameter* (metodens anden argument) for et filter monteret på én rute,
   ikke svaret; `BaseExceptionFilter.logger` er `static` og logger altid som
   `ExceptionsHandler`; `ExternalExceptionFilter` logger og **kaster videre**,
   så et rapporterende filter der ikke selv svarer lader rapportstatus aldrig
   ankomme.

**Ikke gjort, og hvorfor:** det ville være en `nestHandler`-export. Den er
unødvendig (punkt 2 i kilderne: platformen *er* Express), og en export der
kun er en genindpakning ville være dyrere end den er værd. Skrevet i ❓ hvis
Mads vil have en controller-dekorator i stedet.

**Køen efter dette:** de otte framework-sider er på plads (nextjs, angular,
nuxt, astro, react, vue, react-router, svelte, wordpress, hono, fastify,
nestjs — tolv). Næste mål er derfor ikke en tredje framework-side.

- [x] **8. `/docs/wordpress/` + link fra `/da/kom-i-gang/`.** 27/9,
  `ceo/wordpress-page`. Kilden er pluginnets *kode*, ikke dets readme:
  `class-settings.php` (indstillingsnavne + standarder), `class-assets.php`
  (mount-kaldet), `class-rest.php` (ruter + grænse), `readme.txt` (resten).
  Se "Fund fra WordPress-iterationen" — de tre fund, der ikke stod i planen.
  **MÅL: `/docs/wordpress/` baseline 0 besøgende (siden findes ikke) pr.
  2026-09-27.** Sammenlign 25/10 og 25/11. 38 docs-sider (fra 37).
- [x] **14. `/docs/hono/` — den første *server*-side.** 28/9,
  `ceo/hono-page`. **Ny akse, målt 28/9 01:3x (Google Suggest, samme metode):
  `fastify error handling` 10, `hono middleware` 10, `express error handling
  middleware` 8, `hono error handling` 7, `hono error handler` 5,
  `cloudflare workers error handling` 5, `nodejs error reporting` 6,
  `self hosted error tracking` 7** — altså samme bånd som react-router (10) og
  vue (10), og **nul sider i hele kategorien**: `Server`-gruppen har
  `receiving-a-report`/`recipes`/`sending-it-somewhere`, men ingen side nævner
  et server-framework, selv om missionen siger "server-validatorer til flere
  frameworks". Hono er valgt over Fastify (10) fordi `handleReport` *er* en
  `Request`→`Response`-funktion, så Hono og Cloudflare Workers kræver **nul
  lim** — mens Fastify kræver et nyt `fastifyHandler`-export, altså en minor
  med kode først. Siden dækker begge roller: modtager *og* afsender.
  Se "Fund fra Hono-iterationen" — fire fund i `hono@4.13.9`'s build, ingen i
  docs, og det første er en fejl **der ikke kan rapporteres overhovedet**.
  **MÅL: `/docs/hono/` baseline 0 besøgende (siden findes ikke) pr.
  2026-09-28.** Sammenlign 25/10 og 25/11. 43 docs-sider (fra 42), 194
  søgeposter (fra 184).

### Fund fra Express-iterationen (28/9) — fem fund, og to klasser rækken ikke havde set

Kilderne er `express@5.2.1`'s publicerede build plus de to pakker der gør
interessant arbejde: `body-parser@2.3.0`, `router@2.2.0` og
`finalhandler@2.1.1`. **Ingen af de fem find er i Express' egen dokumentation**,
og ingen af dem er synlige i `bugbottle/server`. Det første bekræfter den
fælde Fastify- og NestJS-siderne allerede havde fundet — **på det niveau hvor
den opstår** — og de to sidste er klasser, de otte forgående sider ikke rummer.

1. **100 kB, og det er body-parsers, ikke Express'.**
   `102400 // 100kb default` i `body-parser/lib/utils.js` `normalizeOptions`,
   og `express.json` *er* `bodyParser.json` (`lib/express.js:77`). Fire gange
   under Fastifys 1 MiB og **fyrre gange** under `handleReport`'s eget
   `DEFAULT_MAX_BODY_BYTES`. Fejlen er 413 i body-parsers form, før ruten er
   kaldt, så `expressHandler` svarer aldrig. **Siden skal begynde med den**,
   fordi den er fælden både Fastify og Nest arvede.
2. **En signeret rute kan ikke ligge bag `express.json()` — og `verify` er ikke
   udvejen.** Det interessante er *hvorfor*: body-parser sætter
   `opts.encoding = verify` (`lib/read.js:99`) for at rå bufferen, men kører
   `parse` bagefter, så `req.body` er stadig et objekt og HMAC'en stadig en
   anden. **Bytene var tilgængelige; de blev blot ikke gemt hvor adapteren kikker.**
   Udvejen er `express.raw({ type: "application/json" })` — og fælden i fælden er
   at `express.raw()` uden muligheder matcher `application/octet-stream`, så en
   JSON-rapport slet ikke parses. Den virker alligevel, fordi adapterens egen
   rå-læser overtager, altså ved et held. Skriv `type`.
3. **Express 5 videresender et rejected promise** (`isPromise(ret)` i både
   `router/lib/layer.js:119` og `router/index.js:650`) — det **eneste** framework
   i rækken hvor én fejlhandler i roden ser route-rejections uden en krog. Og
   samme linje kører i `handle_error`, så den anden side af mønsteret er den
   skarpe kant: en `async` fejlhandler der afviser videresender *rejectionen*,
   ikke den fejl den fik. Samme fælde som Fastifys `setErrorHandler`, ad anden
   vej. **Nyttig for `Køen efter dette`:** Express er den eneste af de ni
   frameworker hvor "én reporter i roden" faktisk virker for alt.
4. **To klasser, rækken ikke havde.** (a) `finalhandler` `req.socket.destroy()`er
   når headers er sendt (`finalhandler/index.js:118-121`), så en fejl *efter* det
   første svar når reporteren som en **netværksfejl uden status** — det er det
   eneste sted `handleReport`s egen fejlhåndtering ikke kan hjælpe, fordi
   fejlen sker efter bytene er væk. Og (b) `getErrorMessage` svarer med
   `err.stack` når `env !== 'production'`, og `env` er
   `process.env.NODE_ENV || 'development'` — så en app der aldrig sætter den
   svarer hver uhåndteret 500 med **hele stacktrace'en i kroppen**. På en
   bug-report-rute er det vores egen filstruktur, udleveret til den der
   postede en formular. Begge klasser er generelle nok til at de bør genovervejes
   på de andre otte sider.
5. **`X-Powered-By` er tændt som standard** (`app.enable('x-powered-by')` i
   konstruktøren), og `trust proxy` er `false` som standard — sidstnævnte er
   præcis derfor adapteren sender `req.socket.remoteAddress` først, og det er
   den rigtige rækkefølge i Express (på en standard-app er de to ens, på en app
   med `trust proxy` er socketen den `handleReport` ikke blev bedt om at tro).
   **Én asymmetri i vores egen adapter, fundet her:** URL'en den bygger tager
   `x-forwarded-proto` i frifart, uanset `trustProxy`, så bag en proxy der ikke
   sætter den ser handleren en `http://`-URL for en rapport sendt over HTTPS.
   Det ændrer hvad der logges, ikke hvad der accepteres, og ratelimitten er
   upåvirket — men det er skrevet ned, fordi en asymmetri mellem "hvad vi logger"
   og "hvad vi tæller" er præcis den slags fejl man senere læser en log og
   stoler på. **Ikke rettet i denne iteration** (dokumentationsopgave); et
   lille fix kunne være at lade URL'en bruge samme `trustProxy`-beslutning.

### Fund fra Vue-iterationen (28/9) — den billigste side med de hårdeste fund

Kilderne er `@vue/runtime-core@3.5.43`'s **publicerede build**
(`dist/runtime-core.esm-bundler.js` for læsbarheden, `dist/runtime-core.cjs.prod.js`
til at bevise at fundene overlever en produktionsbuild) og
`@vue/server-renderer@3.5.43` — ikke `vuejs.org`, og ikke
`vue-router`'s dokumentation. Metoden er den sjette gang den holder: den bedste
påstand er en, kilden modsiger.

**1. `app.config.errorHandler` *sletter* Vues egen konsollinje.** `handleError`
gør `return` i `if (errorHandler) { … return; }` **før** `logError`, som er
hvor `console.error(err)` ligger. Det er den linje ringbufferen optager, så en
handler uden `console.error` giver en rapport med tom konsol. Samme fælde som
Nuxt-siden, og derfor siger snippet'et det samme to gange. **Bonusfund fra
samme gren:** Vue kalder din handler med `instance: null`
(`callWithErrorHandling(errorHandler, null, 10, …)`), så en handler der *kaster*
ikke kan løbe ind i sig selv — den falder forbi hele blokken ovenfor og lander
i `logError`. Det er svaret på "kan min reporter hænge appen?".

**2. `onErrorCaptured` der returnerer `false` sletter fejlen helt.** Sløjfen er
`let cur = instance.parent` og `if (hook(...) === false) return;`. Altså: app-
handleren kaldes aldrig, `logError` nås aldrig, intet kastes i production.
Ingen rapport, ingen konsol, intet. **Samme sløjf siger hvorfor app-handleren
er bedre end en capturing hook overhovedet:** den starter ved *forældren*, så en
krog i den komponent der kaster aldrig ser sin egen fejl, og rodkomponenten har
ingen forælder at blive fanget af. `onErrorCaptured` på `App.vue` dækker
intet.

**3. I production kaster intet.** `logError` kaster i dev (`throwInDev`) og
gør `console.error(err)` i en build. **Der er ingen crash at hænge en rapport
op på** — det er argumentet for ringbufferen over et screenshot alene.Og
`console.warn` står **0 gange** i `runtime-core.cjs.prod.js` (`console.error`
2 gange): alle Vue-warnings er kodet ud af en production build, så en konsol
fuld af warnings i dev er en produktionskonsol uden én af dem. Tredje
argument ændrer form: `errorInfo` er en sætning i dev
(`"component event handler"`) og en **URL** i production
(`https://vuejs.org/error-reference/#runtime-${type}`), og nummeret er
indekset i samme array — siden giver tabellen 0/1/2/3/5/6/13/14/16, fordi det
er den ene ting i en rapport der overlever buildet.

**4. En `beforeEach`-guard der kaster er ikke en Vue-fejl overhovedet.**
`vue-router@5.3.1`'s `triggerError` har to udfald og ingenting mere: kalder
`router.onError`-abonnenter, **eller** `console.error(error)` hvis der ikke er
nogen. Så at montere den dokumenterede `router.onError`-toast **fjerner
konsollinjen** — samme bytte som `errorHandler`. Derefter
`Promise.reject(error)`: en `router.push()` uden catch bliver en
`unhandledrejection` (ringbufferen dækker den), en `await`et `push()` i en
`try` forsvinder i din egen catch, og **tilbage/fremad-knappen ender i
`.catch(noop)`**. Siden har den halvdel som sit eget afsnit, fordi den er en
helt anden tragt med sine egne regler.

**5. Den eneste Vue-fejl ingen krog ser: hydration mismatch.**
`logMismatchError` i production builden er `console.error("Hydration completed
but contains mismatches.")` — en nøgen streng, **én gang pr. app**, uden
error-objekt og uden stack, og den går **aldrig gennem `handleError`**. Den
ligger i rapportens konsolsektion, og det er alt: ingen stack, ingen position.
Siden siger det ærligt frem for at love en pointer.

**SSR-grænsen (samme som de andre sider, men skarpere):**
`@vue/server-renderer`'s `renderComponentVNode` gør
`Promise.resolve(res).then(…).catch(shared.NOOP)` på den asynkrone gren — så
et afvist `async setup()` eller `onServerPrefetch` **slipses på serveren**, og
undertræet renderer alligevel, altså HTML med et hul og 200. Synkrone
renderfejl gør derimod `Vue.handleError(err, instance, 1)` på en
*server*-instance, som en browser-reporter aldrig ser.

**⚠️ `npm run a11y` og `npm run smoke:annotate` kunne ikke køre** (igen ingen
Chrome på maskinen). Siden er ren Markdown — ingen nye DOM-elementer, ingen ny
CSS, ingen nye controls. CI's `browser`-job kører begge på hvert push.

**Næste iteration:** de fire (nu fem) frameworksider har hver et afsnit om
fejlsiden, hvor panelet ikke kan være mountet, og de løser det alle med den
samme knap. `open({ prefill })` er stadig det mest genbrugelige fund i hele
planen — **det rammer nu fem sider**, ikke fire.

## Fund fra React-iterationen (28/9) — dokumentationen er forkert, ikke bare tynd

Opgaven var formuleret som "React mangler en side". Det viste sig at være det
for svage krav, fordi to React-sektioner allerede findes i "Get started" (formen
og renderfejlene), så en side der genfortalte dem ville være den sjette side
der ligner de andre fem. Siden blev derfor bygget som **tre fælder og intet
andet**, og alle tre er læst i `react-dom@19.3.0`'s **produktionsbuild**
(react 19.3.0, hentet fra npm-tarballen og grebet med `tar -xzO` — ingen
installation, ingen filer uden for repoet). Det er samme metode som de tre
forgående framework-iterationer, og den er betalt for.

**1. `onCaughtError`/`onUncaughtError` er IKKE dev-only.** Påstanden er
udbredt ( blogs, og folk der har læst typerne). I produktionsbuildet kalder
`logCaughtError` og `logUncaughtError` handlerne direkte, ingen `__DEV__`-guard,
og der er ingen anden sti i dev-builden som prod mangler. Standarderne er
`defaultOnCaughtError` → `console.error(error)` og `defaultOnUncaughtError` →
`reportGlobalError(error)`. **Konsekvens for os:** React 19 *kan* være en
produktions-fejlsti, så `createRootErrorHandlers` er ikke en dev-legetøj, og
den tekst der skal med i privatlivsnotatet er den rigtige. `hydrateRoot`
tager de samme to nøgler (samme `RootOptions`), verificeret på linje 18612.

**2. En error boundary er stadig en klasse i React 19** — og det er *kildefil*:
`initializeClassErrorUpdate` læser `fiber.type.getDerivedStateFromError` og
`inst.componentDidCatch`, og `logCaughtError` nås kun fra de to grene. Det er
også hvorfor `BugReportBoundary` er bygget med `createElement` uden JSX, så
den samme fund-flade kan genbruges i en kommende ❓-svar. Samme funktion siger
noget om *tidspunkt*: `logCaughtError` kaldes fra boundaryens update-**callback**,
altså **efter** at fallback er tegnet. En rapport fra `onCaughtError` beskriver
et sidestade brugeren aldrig har set.

**3. Den fælde der koster en række i indbakken pr. renderfejl:** monteres
`BugReportBoundary` sammen med `createRootErrorHandlers`, sendes den samme
fejl **to gange**. `createRootErrorHandlers` returnerer den *samme* funktion for
begge nøgler, og `dedupeMs` husker kun fejl den selv har sendt; boundaryen
sender på klik gennem en helt anden sti. React giver svaret:
`onCaughtError` får `info.errorBoundary` (boundary-instansen, `null` når ingen
klasse-boundary fangede den), og caught-casen er præcis den `BugReportBoundary`
allerede tilbyder at rapportere. Siden løser det med **én nøgle**
(`onCaughtError: () => {}`).

**API-gap fundet (ikke bygget, samme slags som `open({ prefill })`):** React
sender `errorBoundary` i info-objektet, men `RootErrorHandlers`' type i
`src/react/boundary.ts:190-191` erklærer kun `componentStack`. Siden skriver
derfor en one-liner der *ignorerer* første argument i stedet for at læse det,
og siger eksplicit hvorfor. En valgfri felt-tilføjelse til en eksisterende
eksporteret type er en **minor** efter vores egne navneregler, ikke en patch,
så den ligger under ❓.

**Baseline for rækken (Google Suggest, hentet 27/9, samme metode som
27/9-iterationen):** `react error boundary` **10**, `vue error handling` 10,
`sveltekit error handling` 7, `svelte error handling` 6, `remix error handling`
2, `solid start error handling` **0**. React valgt over Vue fordi vi *allerede*
har den største adapter (5,6 kB budget) og to sektioner om den, men ingen side
— og fordi `vue:error` allerede er dokumenteret på Nuxt-siden. **Vue er det
næste emne, hvis tiden er til det**, fordi 10 suggest er lige så højt og
`bugbottle/vue` er en selvstænd adapter; `solid start` er bevidstsprunget over
(0 forslag).

### Fund fra WordPress-iterationen (27/9) — tre ting, ingen af dem i readme'en

Opgaven sagde "hvilke `data-*` attributer pluginet læser". **Det læser ingen.**
Det er det første fund, og det er et godt eksempel på, hvorfor opgaven sagde at
læse kilden: `class-assets.php`'s docblock siger det eksplicit — mount-kaldet er
eksplicit, ikke drevet af attributer, fordi indstillingerne er et JSON-objekt med
indlerede `theme`- og `brand`-former, og at presse dem gennem attributter kun for
at parse dem ud igen igen køber intet. En læser der har læst "One script tag"
oveni ville ellers have ledt efter `data-endpoint` og ikke fundet den. De
`data-*`-attributter findes ét sted, og det er på **din egen markup**:
`data-bugbottle-mask` og `data-bugbottle-block` i et tema.

**Fund 2: pluginnet er ikke i WordPress-katalogen.** Tjekket 27/9:
`api.wordpress.org/plugins/info/1.0/bugbottle.json` svarer
`{"error":"Plugin not found."}`, og `wordpress.org/plugins/bugbottle/` sender
videre til søgesiden. Readme'en siger stadig "Plugins → Add New, søg efter
Bugbottle" først, og det er den instruktion, en ny bruger følger og ikke kommer
videre med. Siden siger det rigtige, og `/da/kom-i-gang/` rute 2 er rettet med
— samme fejl, to steder, én iteration.

**Fund 3: en tabel, der erstatter en opsummering.** Hver indstilling på
indstillingssiden er præcis én option fra "The panel", med standardværdien fra
`class-settings.php`'s `defaults()`. Det er det korteste kortlægning i hele
dokumentationen, fordi der intet står imellem. To af dem er værd at fremhæve, fordi
de er *mindre* end de ser ud til: en tom **Keyboard shortcut** er *ingen*
genvej, ikke standarden, og `false` er måden biblioteket får at vide det på; og
**Only for logged-in users** og **Accept reports from visitors who are not
logged in** er begge slået fra, hvilket tilsammen betyder at en udlogget
besøgende slet ikke ser panelet.

**Målt, ikke gengivet:** `assets/bugbottle.js` er 66 500 B / 24 648 B gzip i
*vores* `dist/` (readme'en siger 66 496 B til pluginets kopi — fire bytes, samme
build, og jeg gætter ikke på hvorfor). Skærmbilledescriptet er ~15 kB, 6 kB over
ledningen, og indlæses kun når Screenshots er slået til, fordi panelbuildet
bevidst ikke har en renderer med.

### Køen efter dette

De fire frameworksider er på plads, og de ligner hinanden mere end de burde
(WordPress-siden er en anden slags, så den tæller ikke med her):
- Script-tagonlysningen til Angular/Nuxt/Astro er den samme kode, så de fire
  sider kan deles.
- Verifikations-sektionen i hver frameworkside er et genbrugeligt mønster
  (Sentry har det på hver side). Skriv det en gang som et afsnit.
- **Alle fire sider har en fejl-side, hvor panelet ikke er mounted** — Next.js
  `error.tsx`/`global-error.tsx`, Angular/Nuxt/Astro's 500-side. Alle fire
  løser det med det samme: én knap. Det er ét afsnit, ikke fire.
- **Astro-siden viste, at frameworkernes fejlveje danner tre klasser:**
  (1) kast i frameworket, som har en krog; (2) **en fejl i din egen kode som
  ingen krog ser** — Angulars `resource()`, Nuxts `useFetch().error.value`,
  Astros `action()`; (3) fejl i en *fejl-side*, hvor frameworket er væk.
  Sorter fremover nye sider efter den inddeling. Den er mere brugbar end
  frameworklisten, fordi den fortæller hvilken slags opsætning siden kræver,
  og den er allerede betalt for.
- **React-Router-siden har nu betalt de to første punkter ovenfor, så de er
  ikke længere "bør skrives" — de er skrevet.** (1) Den færdige
  fejl-side-knap ligger i `root.tsx` med `BugReportBoundary` +
  `useRevalidator().revalidate()`, og **grunden er læst ud af deres egen kilde**
  (`BoundaryShell` skriver sit eget `<html>`). (2) Verifikations-sektionen er
  fem kast i træk i stedet for fire, fordi der er to sider, der *ikke* kan have
  en fælles kode (de er forskellige frameworks). Den tredje opgave —
  "skriv script-tagonlysningen en gang" — er **stadig ikke gjort**: den er nu
  betalt for **tre** gange (Vue + React Router + Svelte) og er næste
  iteration, hvis intet med større trafik-effekt står foran.
- **Ny klasse fundet 28/9, som hører hjemme i inddelingen:** en framework der
  **ikke** har en krog i en bestemt mode. React Router har to af tre, Astro
  har nul, Vue har én der sletter konsollen. En side skal derfor starte med
  "hvor mange kroge har den her framework, og hvilke", ikke med "hvilken
  krog".

## Fund fra Sentry-SDK-rækken (27/9) — hvorfor tallene er målt

Opgaven sagde "kræver kildeangivelse + dato". Det viste sig at være det *for
svage* krav, fordi hele problemet med at sammenligne et bibliotek med et
produkt er et tal, ingen har målt.

**Før:** `/compare/` sagde "Ikke oplyst" i størrelseskolonnen for alle rækker
der ikke var bugbottle, og det var sandt og ubrugeligt. En læser der skal vælge
mellem et panel på 12 kB og et SDK den aldrig har set størrelsen på, kan ikke
tage det valg. Så den ene celle hvor vi citerer en konkurrent, må vi kunne
reproducere.

**Derfor `scripts/measure-competitors.mjs`.** Samme opskrift som
`measure-sinks.mjs` og som `ci.yml` bruger: `esbuild@0.24.0` (CI's egen
pindede version, ikke devDependency'ens 0.28.2 — mål skal kunne sammenlignes),
`--bundle --minify --format=esm --platform=browser`, gzip. To entries, for ét
tal ville skjule valget: den blotte `init` er hvad en app betaler den dag den
tilføjer SDK'et, og den anden tilføjer de to integrationer en
sammenligning om fejlrapportering faktisk handler om.

**Målt 27/9 på `@sentry/react@11.0.0`:**

| Entry | gzip |
|---|---|
| `init` alene | 33 997 B (33,2 kB) |
| `init` + `replayIntegration()` + `captureFeedback` | 98 145 B (95,8 kB) |

Altså **2,8 × hele bugbottle-panelet** (12 kB) for at intet er optaget endnu, og
**8 ×** med replay og `captureFeedback` i bundtet. Det er det tal, der flytter
beslutningen, og det var derfor ukendt.

**To ting der viste sig at være værre end forventet, begge med kilde:**

- **Session replay er 50 optagelser pr. måned på *alle* planer** — også den
  gratis udviklerplan og også Team til 26 $/md. ([sentry.io/pricing](https://sentry.io/pricing/),
  hentet 27/9). Replay er den halvdel af Sentry der er dyrest i bandwidth, og
  det er ikke en ekstra der kan købes ud over et abonnement. Det står i
  plandefinitionen, ikke i prislisten.
- **`captureFeedback` ligger i SDK'et** (verificeret ved at bundle den og ved
  eksportlisten: `captureFeedback`, `feedbackIntegration`, `sendFeedback` …).
  Så den Sentry User Feedback-række ovenfor ikke længere beskriver en widget
  der lægger sig oven på en større pakke — den er *i* pakken. Den påstand er
  ændret til det præcise.

**Downloads, med den forbehold de har fortjent:** `@sentry/react` 29 251 063 og
`@sentry/browser` 38 408 910 i ugen 20.–26. september, mod bugbottles 191
(npm-downloads-API'en, samme uge for begge). Siden skriver udtrykkeligt at det
**ikke er en pointscore** — CI-kørsler og transitive installationer blæser det
store tal op, og ét npm-pakke er ikke et produkt. Det er derfor også den
modsatte halvdel, der står eksplicit: betaler du allerede Sentry, er de bytes
og den kvote købt, og intet af det er et argument. En sammenligningsside der
kun kan argumentere den ene vej, er en reklame.

**Live-stjernen er 2, så det her er ikke et selvskud.** Sentry er det største
navn i feltet; det er derfor den række, en læser sammenligner os imod. Vi
skal ikke udpege fire små værktøjer og håbe på at ingen læser regner.

## Fund fra Astro-iterationen (27/9) — den stærkeste af de fire sider

Kilden er `withastro/astro` på tag `astro@7.3.5` (Astro 7 er den aktuelle
store minor; 7.3.5 var `latest` 27/9) — `packages/astro/src/runtime/server/astro-island.ts`,
`core/errors/default-handler.ts`, `core/middleware/astro-middleware.ts`,
`core/routing/internal/astro-designed-error-pages.ts`,
`actions/runtime/{client,server,types}.ts` — **ikke** docs-siden, som for
Astro er den eneste, der findes. Og det er pointen:

- **Astro har ingen fejlhåndtering overhovedet at koble til.** Ingen
  `ErrorHandler`, ingen `error.tsx`, ingen `vue:error`, og **ingen
  error-handling-guide blandt de 30 engelske guider** (tjekket i hele
  `withastro/docs`-treeet). Sådan er siderne i den række bygget op forskudt:
  de tre foregående slog alle en krog i frameworket, og her findes den ikke.
  Det er derfor siden vinder på noget andet.
- **`astro:hydration-error` er en rigtig, offentlig, uundokumenteret
  begivenhed.** `handleHydrationError` i `astro-island.ts:122-137` sender en
  `CustomEvent` med `cancelable: true`, `bubbles: true`, `composed: true` og
  `detail: { error, componentUrl }`. Nævnt **0 gange** i hele `withastro/docs`.
  Den dækker præcis den fejlkunike kun en Astro-side har: **en island der
  aldrig bliver interaktiv.** Den tegner server-HTML, ligner virksom, gør
  intet — "filteret virker ikke", umulig at reproducere. Det er den bedre
  halvdel af opsætningen, fordi den dækker en fejltype de tre andre sider
  ikke kan have.
- **Fælden der ødelægger beviset: `preventDefault()`.** `dispatchEvent`
  returnerer `false` når en lytter annullerer, og da springer Astro sin egen
  `console.error("[astro-island] Error hydrating …")` over. Den linje er
  præcis hvad `console`-ringbufferen optager, altså det meste af rapporten.
  Siden siger eksplicit "lyt, rapportér, og lad Astro skrive sin linje".
  Helt samme slags fælde som Angular-sidens `onViewError`.
- **Fælden der skjuler sit eget bevis: `500.astro` køres med din middleware.**
  I `renderDefaultError` får fejlrenderingen sin egen `FetchState` med
  `skipMiddleware` kopieret fra kalleren, middleware kører, og *kaster
  middleware*, fanger Astro det og renderer `500.astro` igen med
  `skipMiddleware: true`. En middleware der læser `Astro.locals.user` uden
  guard tager altså din egen 500-side med, og besøgeren får platformens nøgne
  500. `errorState.initialProps = { error }`, så proppen er dokumenteret;
  `error` er `unknown` med vilje, fordi alt kan kastes.
- **Actions fejler ved at *returnere*, ikke at kaste.** `action()` giver
  `{ data, error }` og kaster ikke, så en fejlet action når ingen
  fejlbegivenhed overhovedet. Astro siger det selv ("all errors are passed to
  the `error` object on an action result") og kalder `.orThrow()` til
  "prototyping or using a library that will catch errors for you" — det er os.
  `ActionError` har `code` (fast sæt), `status` fra `ActionError.codeToStatus`,
  og `fields` ved valideringsfejl; `isInputError` er den snævre. Samme klasse
  problem som Nuxt-sidens `useFetch().error.value`.
- **Script-tagen har én fælde de andre sider ikke har: `is:inline`.** Astro
  bundler og hæver en `<script>` uden den, så den kører før `<body>` findes.
- **Med `<ClientRouter />` overlever dokumentet en navigation.** Alt ovenfor
  skal derfor sidde på `astro:page-load`, som fyrer på første load også, så
  der skal ikke være en "første gang"-gren. Det er den samme tanke som
  Nuxt-sidens `onNuxtReady`.

⚠️ **`npm run a11y` og `npm run smoke:annotate` kunne ikke køre** (igen ingen
Chrome på maskinen, `findChrome()` returnerer en Windows-sti). Siden er ren
Markdown — ingen nye DOM-elementer, ingen ny CSS, ingen nye controls — så
a11y-auditten rammer ikke ændringen, og CI's `browser`-job kører den på hvert
push.

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

## Fund fra privacy-iterationen (27/9) — to ting ingen havde sagt

Opgaven bad om Rollbars GDPR-afsnit. Det viste sig at være **for svagt igen**,
fordi det er *biblioteket* der skal svare, ikke en leverandørs compliance-side:
Rollbars side er om *deres* kunder, og den eneste sande påstand dér er
"180 dages retention" og "ødelæg krypteringsnøglen". Alt det brugbare kom fra at
læse vores egen kode for at se, hvad en modtager overhovedet kan svare på.

**1. `fileStore.list()` har ikke `contact` — og det er derfor opgaven findes.**
`StoredReport` er `id`, `file`, `title`, `type`, `url`, `receivedAt`,
`screenshot`: alt en oversigtsside har brug for, intet der identificerer et
menneske. Så det eneste greb en rapport har på en person er `contact` — som er
**slået fra som standard overalt** (CLAUDE.md's regel, og den er rigtig), og som
altså forsvinder i den kolonne, du ville lede i. Konsekvensen er skarpere end
privatliv: hvis du lover at slette en persons rapporter, er løftet ikke opfyldeligt
uden et index, og det er ikke en funktion i pakken. Sektionen siger det, og siger
det i den retning der hjælper: slå `contact` til *hvis* du vil kunne svare.

**2. Panelet viser ikke rapport-id'et, så en bruger kan ikke citere et nummer.**
`handleReport` svarer `201 {"id": …}` når `store` gav et id, `sendReport` læser
det, og `report-state` har både `onSent(id)` og `status: {kind:"sent", id}`. Men
`src/ui/index.ts` nævner det ingen steder — panelet skriver det ikke ud. Altså:
"reference B-4711" i din indbakke kan ikke laves om til noget, brugeren kan citere,
uden at *din* egen bekræftelse indeholder det. Det er en linje markup i
applikationen, ikke en mangel i biblioteket — men det er præcis den slags
ting, der gør en afdeling spørge "kan vi overhovedet finde en rapport fra en
kunde?" med et ja, der er lidt for let.

**Tredje fund, der blev en tabel:** en sink er en kopi. Slack og Discord kan
slettes med en bot-token men **ikke** med den webhook-adresse en sink får
(indgående webhook kan poste, ikke slette, og ved aldrig beskedens id), en sendt
mail kan ikke kaldes tilbage, og et issue er en rekord i et andet system. To
af disse er hentet/verificeret i koden (sinks' egen kode, `sentrySink`'s
attachment-item), resten er skrevet som platformejerskab, ikke som
-API-påstande — jeg ville ikke skrive "GitHub har et DELETE-endpoint" ned uden
at have læst det i dokumentationen, og et afgrænset opslag i REST-dokumentationen
gav ikke svaret inden for rimelig tid, så påstanden blev taget ud.

**En ting der også blev rettet:** privacy-sidens skabelon manglede hele
sætningen om adgang og sletning. Den er der nu, og den er skrevet som en
sætning man kan strege — fordi den er en *love* om et svar, ikke en beskrivelse
af et felt.

**Ny test:** `tests/privacy-checklist.test.ts` piner nu de to siders
afsnitslister mod hinanden. Siderne er én side med et hreflang-par, og den
 almindelige måde den går forkert på er et afsnit på den ene side. Parrene står
udskrevet i testen, fordi de to sprog ikke deler prosa.

## Fund fra React-Router-iterationen (28/9) — forskningen er færdig, siden er ikke skrevet

Læst i de publicerede builds, som altid: `react-router@8.4.0` (seneste — **v8
er ude, v7-linjen ender på 7.18.4**; API'et er det samme i begge, `onError` er
verificeret i begge), `react-dom@19.3.0`'s produktionsbundle, og
`@remix-run/react@2.17.5`. Plus **deres egen** `docs/how-to/error-reporting.md`,
som er pakken med svaret og ender i `myReportError(error, location, errorInfo)` —
altså præcis det sted, hvor bugbottle hører hjemme. Siden skal bygge videre på
disse otte fund:

1. **Der er tre modes, og de svarer forskelligt.** Framework mode
   (`HydratedRouter`) og data mode (`createBrowserRouter` + `RouterProvider`)
   har begge `onError`. **Declarative mode (`<Routes>` / `useRoutes`) har ingen
   router-krog overhovedet** — `useRoutes` kalder `useRoutesImpl(routes,
   locationArg)` uden `dataRouterOpts`, så `RenderErrorBoundary` bliver aldrig
   monteret (`hooks.js`: betingelsen er `dataRouterState && (…)`). Der fanger
   React Router intet; fejlen lander i din egen boundary. Det er planens
   tredje fejlklasse, og den har en anden opsætning end de to andre.
2. **`onError` er en erstatning for konsollinjen på datadelen, ikke en
   tilføjelse.** `router.js` rummer `console.error` **0 gange** — en fejl fra en
   loader, action eller middleware har ingen anden log, og `onError` er det
   eneste sted den kommer ud. `RenderErrorBoundary.componentDidCatch` har derimod
   et `else console.error("React Router caught the following error during render", error)`,
   så en *render*-fejl taber linjen kun hvis React ikke logger den — og i
   React 19 gør den (`defaultOnCaughtError` = `console.error(error)` også i
   produktion). Samme regel som på de andre frameworksider: log den tilbage.
3. **En 404 du kastede med vilje kommer ind som en crash.** `isRouteErrorResponse`
   er stadig eksporteret i v8, og handleren kan ikke kende forskel uden den.
   Kilden skal springe den over (eller sende den som sin egen type) — ellers
   fyller en bevidst `throw new Response("Not found", { status: 404 })` inboxen.
4. **`info.params` er rod-matchets params** — `params: newState.matches[0]?.params ?? {}`
   — så den er `{}` i enhver app hvis rod-route ikke har et dynamisk segment.
   Brug `pattern` (eller `useParams()` i boundaryen) til at vide hvilken route
   det var.
5. **En route uden egen `ErrorBoundary` fanges af den nærmeste forfader**, og
   `RenderErrorBoundary` er kun monteret når
   `match.route.ErrorBoundary || match.route.errorElement || index === 0`.
   `getDerivedStateFromProps` beholder fejlen indtil **location ændres** eller en
   revalidation går tilbage til idle — så en "prøv igen"-knap, der bare
   re-renderer, rydder ikke siden, og hvert forsøg der fejler igen sender en
   rapport. Serverens `dedupe` på fingerprint er svaret.
6. **Fejlsiden, hvor panelet ikke er mounted.** Framework-mode's standard er
   `RemixRootDefaultErrorBoundary`, og den gør `console.error(error)` og renderer
   sit eget `<html>/<head>/<body>` med inline styles og et script, der logger
   "💿 Hey developer 👋". **Ringbufferen overlever, panelet gør ikke** — samme
   svar som de fire andre sider (én knap i `root.tsx`), og her er grunden læst
   ud af deres egen kilde. Remix v2 har præcis samme klasse.
7. **Remix v2 har ingen client-krog overhovedet.** `RemixBrowserProps` i
   `@remix-run/react@2.17.5` er `export interface RemixBrowserProps {}` — tom.
   Så `onError` er en v7+-ting, og en Remix-v2-app må bruge Reacts egne
   root-handlers eller lægge knappen i `errorBoundary`-eksporten.
8. **Serveren: `handleError` i `entry.server.tsx`, og `request.signal.aborted` er
   ikke valgfrit.** Der er ingen browser på serveren, så svaret er en POST med
   `{ message }` — `validateReport` kræver **kun** `message` (verificeret i
   `src/server/handle.ts:1031`), og en ukendt topniveau-nøde bliver `extra`, så
   stacken kommer med som `extra.stack`. Seks linjer.

Plus: deres `docs/how-to/error-reporting.md` siger "make sure to still log the
error" — hvilket er den samme halve sandhed Vue-siden skrev om. Vi siger
hvorfor, og vi siger at `console.error` er den linje ringbufferen læser.

## Fund fra Svelte-iterationen (28/9) — fire fund i boundary-runtime'en, ingen i docs

Kilderne er `svelte@5.57.1`'s **publicerede kilde** (ikke builden, men de er
samme filer — `src/internal/client/dom/blocks/boundary.js` og
`src/internal/server/renderer.js`) og `@sveltejs/kit@2.70.3`'s
`src/runtime/client/client.js` + `src/exports/internal/index.js`. Plus
`svelte.dev/docs/svelte/svelte-boundary`, som er den *ene* officielle kilde og
**bekræfter alle fire fund** — det er første gang de to siger det samme, så
denne side er bygget på "kilden modsiger" og endte med "kilden bekræfter".
Bemærk at domænet siger **5.3.0** for elementet, ikke 5.0: en læser der læser
migraveguiden og bruger 5.2 har ikke boundary'en.

**1. En boundary uden `onerror` og uden `failed` kaster fejlen videre.**
`boundary.js:446-451`, kommentaren er Sveltes egen: *"If we have nothing to
capture the error, or if we hit an error while rendering the fallback, re-throw
for another boundary to handle"* → `if (!this.#props.onerror &&
!this.#props.failed) throw error;`. **Modsat form af Vue-fundet:** der
sluger hooken, her slipper boundary'en. Konsekvens for en side: en boundary
tilføjet for sit `pending`-snippet er **ikke i fejlstien**, så en læser der
har monteret den og troer den dækker, sender ingen rapporter. Samme kommentar
er halvdel to: **en fejl i `failed`-snippet'en kastes videre** — altså en
fallback der læser en egenskab på en serialiseret fejl (fund 2) kaster selv.

**2. På en SSR-side kaldes `onerror` med en KOPI.** `#hydrate_failed_content`
tager *"the deserialized error from the server's hydration comment"* og
`queue_micro_task(invoke_onerror)` — kommentaren er igen Sveltes: *"`onerror`
may mutate state, which is disallowed while hydrating"*. Docs bekræfter:
*"called upon hydration with the deserialized error object"*. Rapporten
indeholder altså `{ message }` og ingen stack, og `instanceof TypeError` er
**falsk på clienten og sand på serveren for samme fejl** — den slags der
ikke kan findes ved at læse docs.

**3. Boundary'en gør intet på serveren, og SvelteKit har ikke lukket hullet.**
Docs: *"By default, error boundaries have no effect on the server"*; siden 5.51
er der `transformError` på `render()`, og docs siger at *frameworket* skal
koble den på: *"SvelteKit will add support for this in the near future, via
the handleError hook"*. Verificeret 28/9 i `@sveltejs/kit@2.70.3`:
`transformError` står **0 gange** i hele pakken. Så en renderfejl i en
SvelteKit-app er en 500, og boundary'en er ikke indblandet.

**4. `reset` er idempotent.** `#create_reset` vogter på `did_reset` og
returnerer efter et dev-kun `svelte_boundary_reset_noop()`. En "prøv igen"-knap
der dobbeltklikkes renderer altså én gang — og den *anden* `onerror` er en
rapport mere, som serverens `dedupe` på fingerprint er svaret på. Samme
slags som React-Router-fund 5.

**SvelteKit-delen (kort, men den er præcis de andre sideres regel):**
`handle_error` i `client.js` har `if (error instanceof HttpError) return
error.body;` på **første linje** — en bevidst `error(404, …)` når aldrig
`handleError`, hvilket er rigtigt og grunden til at hooken ikke må være en
"rapportér alt"-kontakt. `?? { message }` er hvad `+error.svelte` får at
rendere, når hooken returnerer intet. De **to** `console.error` i klientens
fejlveje (`client.js:1574` reroute-hook, `client.js:2077` "This will cause a
full page reload") er **begge `DEV`-guardede**, og `handle_error` har nul
— så en client-navigationsfejl logges af din hook eller af ingen.
`unhandledrejection` står **0 gange** i `@sveltejs/kit@2.70.3`.

## Fund fra Hono-iterationen (28/9) — fire fund i `hono@4.13.9`, fire i kode

Metoden er den sjette gang den samme: `npm pack hono@4.13.9`, læs
`dist/hono-base.js`, `dist/http-exception.js` og de fire adapter-entries — ikke
hono.dev. Den viste sig endnu engang at være den stærkeste, fordi **to af de fire
fund er fejl, ingen guide nævner, og den ene slet ikke kan rapporteres.**

1. **En route der glemmer `return` er en 404, ikke en 500** —
   `res ?? this.#notFoundHandler(c)` (`hono-base.js` linje 303). En handler der
   returnerer `undefined` uden at finalisere konteksten får
   `c.text("404 Not Found", 404)`. Altså: ingen throw, ingen `console.error`,
   intet `onError` ser, **ingen rapport mulig**. Det er det eneste failure mode
   på hele siden, hvor en reporter ikke kan hjælpe, og det ligner en forkert
   URL. Derfor står det som et *punkt i "What to check"*, ikke som en rettelse.
2. **`throw "ikke en Error"` springer hele `onError` over.** `#handleError`
   (linje 273-278) gør `if (err instanceof Error) … throw err` — alt andet
   kastes *ud af appen*. En reporter i `onError` ser ingenting, og platformen
   rapporterer en unhandled rejection i stedet for din 500. Ikke løseligt med
   en option; kun et `try`/`catch` eller en proceshandler.
3. **En kastet `HTTPException` når aldrig konsollen.** Standardhandleren
   tjekker `"getResponse" in err` *før* `console.error(err)` (linje 10-16), så
   en bevidst 404/401 er korrekt stillet uden log — og følgen for os er at en
   `onError`, der rapporterer alt hvad den får, **indsender hver eneste 404 som
   en bug**. Siden giver `err instanceof HTTPException`-filteret.
4. **`onError` erstatter konsollinjen** (`onError = (handler) => { this.
   errorHandler = handler }`, linje 162-165) — og `console.error(err)` ligger
   i modulens *default*-handler. Fjerde framework i rækken (Vue, Nuxt, Reacts
   `onCaughtError`, nu Hono). Mønstret er nu dokumenteret fire steder; det er
   ved at være en regel, ikke en undtagelse.

**To fund uden for fejlstien, der ændrer opsætningen:**

- **`buildReport` virker uden DOM.** `collectContext()` svarer
  `{ url: "", viewport: "", userAgent: "" }` når `window` mangler
  (`src/capture.ts:225`), og `initConsoleBuffer` patcher
  `console.error`/`console.warn` ubetinget og springer kun `window`-lytterne
  over (`src/console-buffer.ts:100-109`) — dens egen JSDoc siger allerede "on
  the server that is the server's". En Worker kan altså sende en *rigtig*
  rapport med en rigtig ringbuffer. Det er en egenskab biblioteket altid har
  haft, og ingen side har brugt den; nu er den dokumenteret for første gang.
- **`hono/cloudflare-workers` og `hono/deno` indeholder ingen HTTP-handler.**
  De eksporterer `getConnInfo`, `serveStatic`, `upgradeWebSocket`, `toSSG` —
  fordi `Hono` selv *er* en fetch-handler (`fetch = (request, …) => …` er en
  property på klassen, linje 331), så `export default app` er hele historien.
  Kun `bun` (`getBunServer`), `vercel` og `aws-lambda` (`handle`, som er
  `(app) => (req) => app.fetch(req)`) har en adapter. Den tabel er næsten
  sikkert det, der får folk til at sidde fast første gang.

**Konsekvens for resten af rækken:** den nye klasse fra Astro-iterationen
("hvor mange kroge har den her framework") får en *fjerde* variant her, fordi
Hono har **én** krog, og den dækker ikke to af de tre fejlklasser: en glemt
`return` og et ikke-`Error`-kast. Fremover: en serverside-side skal begynde med
"hvad kan frameworken overhovedet se", ikke med "hvilken krog".

**Næste kandidater i kategorien** (samme måling, ikke valgt endnu):
`fastify error handling` 10 kræver et nyt `fastifyHandler`-export (minor, kode
først); `@hono/node-server` + `fileStore` på Node er en *anden* historie end
Workers og kunne være en sektion i `/docs/recipes/` i stedet for en side;
`cloudflare workers error handling` 5 kan lægges ind i Hono-siden som en
D1/KV-`store`-opskrift, hvis ikke den bliver for lang.

## Fund fra Fastify-iterationen (28/9) — to fejl, ingen af dem kan ses fra koden

Metoden er den syvende gang den samme: `npm pack fastify@5.12.5`, læs
`lib/content-type-parser.js`, `lib/error-handler.js`, `lib/log-controller.js`,
`lib/handle-request.js`, `lib/request.js` og `lib/config-validator.js` — ikke
fastify.dev. Den blev endnu engang stærkest, fordi **den største fælde ikke
handler om fejl overhovedet**: den afgør om rapporten når serveren.

1. **`bodyLimit` er 1 048 576 som standard, og parseren afviser FØR routen
   køres.** Det står to steder: i `defaultInitOptions` og som schema-default i
   `config-validator.js`. `rawBody` gør `if (contentLength > limit) done(new
   FST_ERR_CTP_BODY_TOO_LARGE())` — altså før `handler(request, reply)` nogensinde
   kaldes. **En rapport med screenshot er derfor en 413 i Fastifys egen
   fejlform, som `fastifyHandler` aldrig ser**, mens `handleReport` ville have
   accepteret den samme krop: `DEFAULT_MAX_BODY_BYTES` er 4 MiB, fire gange
   større. Standarden er ikke forkert til en JSON-API, og mismatchet er
   **stille** — hvert under-et-megabyte-report ankommer, så ruten ser sund ud
   indtil den første person vedhæfter et billede. Det er den eneste fælde på
   siden der fejler i produktion og ikke i dev.
2. **En signeret rute kan ikke monteres bag standardparseren.** `application/json`
   registreres i `ContentTypeParser`-konstruktøren, så kroppen er et objekt når
   routen kører, og re-serialisering giver andre bytes og en anden HMAC. **Der
   er ingen "montér den ikke bag en parser"-udvej som hos Express**, fordi
   parseren er frameworkets egen og altid kører. Udvejen er en
   `{ parseAs: "string" }`-parser, og adapteren tager dens streng ordret, så de
   verificerede bytes er de signerede. Samme `onError`-én-gang-som-de-Express
   gør, fordi en monteringsfejl og en forfalsket signatur er ens på ledningen.
3. **`console.error` står 0 gange i hele `lib/` og `fastify.js`.** Den fjerde
   (nu: femte) side i rækken om en krog der erstatter frameworkets egen
   fejloutput, og **den første hvor der ikke er nogen konsol at erstatte**:
   `defaultErrorHandler` kalder `defaultErrorLog`, som skriver til `reply.log` —
   pino, med pinos formatering og pinos destination. En handler der erstatter
   default'en slår altså ikke terminalen ihjel, den flytter output et sted hen,
   og hvor afhænger af din logger-konfiguration. `console.log` og `console.warn`
   er også 0.
4. **En fejl i `setErrorHandler` fanges, ikke krasjet — og går til
   forælderscope.** `handleError` gør `reply[kReplyNextErrorHandler] =
   Object.getPrototypeOf(errorHandler)` før den kalder, og `buildErrorHandler`
   bygger hver scope med `Object.create(parent)`. Altså: en reporter på root
   fanger en fejl i en rute i et plugin, fordi vandringen ender ved root. Samme
   linje er grunden til at en kastende handler i *root* ikke looper — forældren
   er `rootErrorHandler`, hvis `func` er `undefined`. Og `if (result !==
   undefined) reply.send(result)` betyder at en handler der **returnerer**
   bestemmer svaret; et promise går gennem `wrapThenable`, så et afvist async-
   kald rapporteres som sig selv.

**To ting der ændrede adapterens form, ikke bare siden:**

- **`request.ip` findes slet ikke på en standard-instans.** `buildRequest`
  returnerer `buildRegularRequest` medmindre `trustProxy` er sat — det er
  `buildRequestWithTrustProxy` der definerer `ip`, `ips`, `host` og
  `protocol`. Så på en standard-instans er `request.ip` `undefined`, og
  socketen skal derfor være første valg **af en strukturel grund**, ikke en
  præference. Det er samme rækkefølge som `express.ts` og samme begrundelse.
- **Fastify er den anden Node-side, og den er en modsætning til Hono.** Hono
  *er* en fetch-handler, så `handleReport` kræver nul lim; Fastify predater
  web-API'et og kræver en adapter. Det er derfor `fastifyHandler` er en
  **export** og ikke en README-linje: de to Node-frameworks i rækken har
  modsatte svar, og det er præcis det en læser skal finde.

**Køen efter denne side:** `express error handling middleware` har **10
suggest** (28/9) og *er* dækket — af `expressHandler` og to afsnit i
"Receiving a report", men **ikke som side**. Det er samme valg som Vue blev
valgt på: en adapter der findes to steder, ingen side. NestJS (10) er den
største helt udækkede, se opgave 16.

⚠️ **`npm run a11y` kunne ikke køre** (se Note om Chrome nedenfor). Siden er ren
Markdown — ingen nye DOM-elementer, ingen ny CSS, ingen nye controls — så
a11y-auditten rammer ikke ændringen, og CI's `browser`-job kører begge dele på
hvert push.

**Note om Chrome (alle iterationer siden nr. 2):** `findChrome()` returnerer en
Windows-sti på denne maskine, `/Applications/Google Chrome.app` findes ikke, og
`CHROME_BIN` er ikke sat. Det er **ikke** en fejl i repoet, og det er heller
ikke noget en senere iteration bør prøve igen for hver side — hverken `a11y`
eller `smoke:annotate` kan køre her. CI's `browser`-job dækker dem.

## ❓ Til Mads

- **`createRootErrorHandlers` slettede konsollinjen den erstattede — rettet
  28/9.** Reacts egen standard for `onCaughtError` er én `console.error(error)`,
  også i `react-dom@19.3.0`'s **produktions**bundle (læst ud af den for at være
  sikker), og at give en funktion for den nøgle *erstatter* standarden. En app
  der brugte root-handlerne — altså det `React`-siden anbefaler til en plain
  React-app — havde derfor ingen konsolindgang tilbage for præcis de fejl den
  rapporterede, og ringbufferen læser netop den linje. Rettet: begge handlers
  skriver `console.error(error)` før de sender. Fundet kom fra
  React-Router-undersøgelsen, ikke fra en fejlrapport, og det er det tredje
  eksempel på samme mønster (Vue, Nuxt, nu os) — **mønstret er værd at kigge
  efter i hvert framework-afsnit: dækker siden "hvad sker der med konsollen?"**
- **`mountBugbottle().open()` kunne ikke forudfylde beskeden — bygget 28/9 som
  `open({ message })`.** Se opgave 21. Panelet har haft `openOnError: { prefill:
  true }` siden starten, som fylder kassen med * vinduesfejlens* besked, men
  intet for de andre otte kaldesætninger — og to af dem bar en kommentar i
  README, der sagde det højt. **Besvaret, og det er `message` og ikke
  `prefill`:** de to ord betyder ikke det samme her. `openOnError.prefill` er et
  flag ("fyld kassen med vinduesfejlens besked"), `open().prefill` ville være
  indholdet, og CLAUDE.md's navneregler forbyder en nøgle der betyder to ting.
  `message` er feltet i rapporten, så nøglen siger hvad den rummer. Det eneste
  åbne spørgsmål er **releaseformen**: næste version er nu en minor (1.1.0) for
  den her og ikke en patch (1.0.2) for de to patches i *Unreleased* — se
  ❓-punktet om Stripe nederst.
- **Fejl-siden-problemet er besvaret, så det behøver ikke en beslutning mere.**
  Alle fire sider løser det samme sted: en fejl-side er en separat side load
  uden layout, så panelet kan ikke være mountet, og integrationen er én knap.
  Siderne siger det eksplicit. Det eneste åbne spørgsmål er om knappen skal
  kunne forudfylde beskeden — altså punktet ovenfor.
- **`RootErrorHandlers` mangler `errorBoundary`.** React 19 sender den catching
  boundary i `info.errorBoundary` (`onCaughtError`), så det er den måde man
  undgår at `BugReportBoundary` + `createRootErrorHandlers` sender den samme
  renderfejl to gange — fund fra React-iterationen. Vores type erklærer kun
  `componentStack`, så siden bruger en one-liner der ignorerer argumentet.
  En valgfri felt-tilføjelse til en eksporteret type er en **minor** efter
  `docs/api-audit-1.0.md`'s regler, så den er ikke shippet i en patch. Samme
  spørgsmål som `open({ prefill })` ovenfor: bygge den nu til 1.1.0, eller
  lade den ligge til en minor der samler begge?
- **Search Console-eksport.** Uden pr. side-visninger, klik, CTR og position kan
  Fase 3 ikke måles. Én CSV-eksport pr. side, 28 dage.
- **Deploy.** Hvordan kommer bugbottle.dev live? Intet i repoet bygger
  `site/Dockerfile`. Skal jeg skrive en `site-deploy.yml`, eller deployer
  Dokploy direkte fra repoet?
- **Pro-navn.** Foreslået i en tidligere fase, ikke besvaret endnu. Noget i
  retningen "Buge" / "Trygg" / "Skærg" — noget der ikke bare hedder "Pro",
  fordi bugbottle ikke er noget man *proficerer* på. Skal jeg skrive tre
  konkrete navne med domænetilgængelighed og prispositionering?
- **Panelet skal vise rapport-id'et.** Fund 2 ovenfor: serveren svarer det, der
  er plads til det i `status.id`, og panelet bruger det ikke. En synlig
  reference ("Rapport B-4711") er præcis den slags tillid, en virksomhedskunde
  efterspørger, og det er en ny streng i alle otte sprog — måske 100-200 bytes
  på `bugbottle/ui` og på begge IIFE'er mod budgetterne 11 776 / 25 088 /
  21 504. Eller er det bedre som en **option** (`showReportId`), der kun koster
  noget for dem der slår den til? Det er en minor, ikke en patch, fordi det er
  et nyt mount-option. Skal jeg bygge det, eller lade applikationen selv skrive
  id'et i sin egen bekræftelse?
- **Stripe.** Der er ingen `docs/stripe-kontrakt.md` i repoet, og vi sælger
  intet. **Delvist besvaret 28/9:** `.github/FUNDING.yml` og `/support/` findes nu,
  bygget på det ene betalingslink missionen oplyser
  (`donate.stripe.com/7sYeVcbn50wieFM8gDbMQ0c`) — det er det **eneste** link i
  hele koden, og der er ingen Stripe-nøgle og intet produkt oprettet. Det åbne
  spørgsmål er uændret: skal jeg foreslå betalte, licenskontrollerede
  open-core-tilføjelser under ❓? `/support/` er lavet som et svar på den anden
  halvdel af spørgsmålet — en læser, der gerne vil betale, skal kunne se *at* det
  ikke kan, uden at spørge.

## ❓ Til Mads — søstrepos

Begge findes og er ubrugte (FETET via `gh api` 27/9):

- `mahope/bugbottle-wordpress` — "WordPress plugin for bugbottle: the report
  panel and a receiving endpoint in one activation", 0 ★, sidste push 8/9.
  `/docs/github-action/` findes; **en WordPress-side manglede helt**, selv om
  pluginet er det mest konverterende produkt vi har (én aktivering = panel +
  modtager). Landet 27/9 som `/docs/wordpress/` + rettelse i `kom-i-gang`.
  **To ting i pluginrepoet, der bør rettes der (ikke her):** (1) `readme.txt`'s
  Installationsafsnit siger "Plugins → Add New, søg efter Bugbottle" først, og
  det er ikke i katalogen — API'et svarer `{"error":"Plugin not found."}` tjekket
  27/9, så den instruktion fører en ny bruger ud i en blindgyde; (2) skal
  pluginnet *indsendes* til wordpress.org, er det en tredjepartsansøgning, som
  kun Mads kan lave. Den er en medvirkende grund til at siden siger det samme,
  indtil den ligger.
- `mahope/bugbottle-action` — "GitHub Action: validate bugbottle JSON bug
  reports in CI. Zero dependencies.", 0 ★, sidste push 7/9.

Vi arbejder kun i dette repo, så begge er forslag.

## Opgraderinger

**Sikkerhed tjekket 27/9 (iteration 6): `npm audit` → 0 sårbarheder**, hverken i
dev- eller i production-afhængigheder. Det er forventeligt: biblioteket har nul
runtime-afhængigheder, så `package-lock.json` rummer kun byggeværktøjet.
`~/.local/oxloop/AFHAENGIGHEDER.md` er stadig ikke læst; det er den næste
iteration, der tager første afhængighedsopgave. Overfladen er devDependencies +
Node-versionen i `site/Dockerfile` (node:22) og CI.

## Log

- **2026-09-28, iteration 19** (`ceo/global-error-events`). Opgave 23. Se opgaven
  og "Fund fra global-errors-iterationen". **Første gang metoden var en anden:**
  målt som altid med Google Suggest, men kilden var MDN og ikke et publiceret
  build — fordi der ikke findes et build af to browserevents, og det er *MDN* der
  definerer dem. Det gav fire ting, hvoraf to var nye for os (de to signaturers
  asymmetri, og at et cross-origin rejection slet ikke fyrer `unhandledrejection`)
  og to bekræftede noget vi vidste, men som siden nu siger højt i stedet for at
  være en skjulest mangel: **en rapport kan ikke indeholde worker-fejl**, fordi
  `initConsoleBuffer` kun lytter når `window` findes. Skrev ned i planen, at jeg
  *ikke* har kilde til "en ressource-`error` bobler ikke" (MDN's sætning er
  tvetydet om netop det), så siden siger kun det sikkert kendte — en læsers
  tillid er her mere værd end endnu en autoritativ klingende påstand.
  `SLUG_OVERRIDES` fik sin anden indgang: `## window.onerror and
  unhandledrejection` slug'ifies til `windowonerror-…` fordi `slugify` sletter
  punktum, så overskriften står som den er i README (den er en sætning i en
  liste af andre) og URL'en er `/docs/global-errors/`. 47 docs-sider, 228
  søgeposter, ingen budget flyttede sig, 896 tests grønne, `check-dist` grøn på
  208 filer.
- **2026-09-28, iteration 18** (`ceo/self-hosted-page`). Opgave 22. Se opgaven.
  Metoden holdt for tiende gang: målt først (Google Suggest), skrevet på
  konstanter i koden, og **ikke** gentaget fra en sibling-side. Den nye klasse
  her er ikke en framework men en **deploymentform** — de fem fælder i
  Express-, Fastify- og NestJS-iterationerne (body-limit, rå krop på en
  signeret rute, `trustProxy` mod ratelimitten, PNG-signatur i bytene,
  `store` som utroværdigt input) er hverken frameworks eller bibliotekets
  skyld, men egenskaber ved *din* udrulning. De lå i tre sider, som en læser
  først efter at have læst to andre sider ville finde dem; nu ligger de i én
  tabel på den side, en "self hosted"-søgning lander på. **Næste mål er derfor
  ikke en fjortonde frameworkside** (sådan som det stod i køen efter
  NestJS), og den tredje punkt-punkt i "Køen efter dette" — *skriv
  script-tagonlysningen en gang* — er stadig betalt for tre gange (Vue, React
  Router, Svelte) og ulavet. Den er næste iteration hvis intet med større
  trafik-effekt står foran; den er **ikke** trafik, den er kvalitet i de sider
  vi allerede har.
- **2026-09-28, iteration 17** (`ceo/open-prefill`). Opgave 21. Se opgaven.
  - **Køen var tom, så valget var mellem to ting planen selv navngiver:** den
    fælles script-tag-opløsning (betalt for tre gange, DRY, ingen trafik) og
    `open({ message })` (fire iterationer under ❓, otte kaldesætninger i
    README, to med en kommentar der sagde at kassen var tom). Den anden er
    valgt, fordi den er **konvertering**: en rapport er en besked fra en
    person, og de otte kaldesætninger bad præcis den person skrive den dyrebeste
    linje selv — i det øjeblik hvor de kigger på en side gå i stykker. Alt
    andet i køen er docs-arbejde, der forbedrer sider, der allerede ranker;
    dette fik alle otte til at sende en tyndere rapport.
  - **Eksisterende kode, der lærer.** Den lægde ikke op i `report-state.ts`,
    fordi `open()` der ikke er "åbn panelet" men "kald når formularen åbner, så
    screenshotet viser hvad de kiggede på" — panel-layoutet er frameworkens
    job i de adapters, og det er kun `mountBugbottle` der ejer et panel. Så
    funden var smallere end den så ud: **én fil, én metode, ~30 byte.**
  - **Et navnevalg, der var svært at få rigtigt.** `open({ prefill })` var
    formuleringen i ❓, og den er forkert af navnereglerne: `prefill` er
    allerede en *boolsk* indstilling i `openOnError` ("fyld med vinduesfejlens
    besked"), så den nøgle ville have betydet en streng i det ene sted og et
    flag i det andet. `message` er rapportens eget felt. Samme regel som #69
    gjaldt i `screenshotUrl`/`screenshotUrlFrom` — samme løsning: ét navn pr.
    idé, og navnet siger hvad det rummer.
  - **Én regel, to steder, én implementering.** `openForError` havde sin egen
    `if (prefill && !textarea.value.trim())`-linje, som nu kalder `open()` med
    beskeden. Det er ikke en refaktorering for skønnedens skyld: den
    `openOnError`-tekst der stod i hver en framework-side var håndskrevet, og
    to steder der ligner hinanden er præcis hvad de otte forgangne sider fandt
    fejl i.
  - **Klipningen er tabsfri, og det er derfor den er med.** `MAX_MESSAGE_LENGTH`
    er det tal serveren gemmer alligevel, så `slice` før den sender taber
    intet — men en 200 kB stack-lignende tekst i en kasse på fire rækker er
    ubrugelig for den person der skal læse den. Samme argument som textarea'en
    uden `maxlength` har: skriveren bestemmer, hvad der kommer med, og
    serverens klip er kontrakten.
  - **Ikke-tekst ignoreres i stedet for at blive `[object Object]`.** Et `ErrorHandler`
    får `unknown`, så det er et rigtigt input, ikke en paranoid case — testen
    kører `undefined`, `null`, et tal, `{}`, en liste og `true` gennem
    `open({ message })` og kræver at kassen er tom hver gang.
  - ⚠️ **`npm run a11y` og `npm run smoke:annotate` kunne ikke køre** (igen
    samme grund som i de otte forgangne iterationer: `puppeteer-core` findes
    ikke i det globale npm-root). Ændringen tilføjer ingen DOM, ingen CSS, ingen
    control og ingen lokale-streng, og teksten i en `textarea` er hverken et
    axe-regel-emne eller noget `scripts/a11y-audit.mjs` læser pixels på. CI's
    `browser`-job kører begge på hvert push.
  - **En drift fundet ved at køre `scripts/api-table.mjs` (den skal have været
    kørt i samme ændring, og var ikke):** den frosne export-tabel i
    `docs/api-audit-1.0.md` manglede **tre** navn fra Fastify-iterationen
    (`fastifyHandler`, `FastifyReplyLike`, `FastifyRequestLike`) — altså den
    opgave, der lagde adapteren i, kørte ikke regeringeringen, som CLAUDE.md siger
    er forskellen på at vedligeholde en API-tabel og at tro man gør det.
    Regenereret her, så tabellen igen er sand; `bugbottle/ui` er uændret, fordi
    `open` stadig hedder `open` (kun signaturen har fået et valgfrit argument,
    og tabellen tæller navne).
  - **Næste iteration:** `npm run a11y` skal køres i CI og resultaterne læses
    ved næste iterations start (ét kald, ingen polling). Køen er ellers tom;
    den næste reelle opgave er den fælles script-tag-opløsning, som nu er
    betalt for **fire** gange.

- **2026-09-28, iteration 16** (`ceo/trusted-proto`). Opgave 19 + opgave 20. Se
  opgaverne og "Fund fra dist-iterationen" nedenfor.
  - **En fejl af den dyreste slags, fundet ved at køre gaten og ikke ved at
    læse kode.** `npm run check` kørte `tsc`, som emitterede
    `dist/server/fastify.js` — og `git status` viste intet, fordi `dist/` er
    gitignore'et og filen aldrig var blevet addet. Først da jeg ville se
    `git diff --stat dist/` for at skrive budget-ændringerne ned, holdt jeg op:
    `dist/server/fastify.js` var der, `dist/server/express.js` var ændret, og
    **kun den første var et problem**. Beviset er reproducerbart og står i
    opgave 20: et `git archive HEAD dist` ud i en tom mappe kaster
    `ERR_MODULE_NOT_FOUND` på `import "bugbottle/server"`. Det er den
    installationvej, `npm install github:mahope/bugbottle` og jsDelivr, der er
    dokumenteret i README og i CLAUDE.md som grunden til at `dist/` er
    committet overhovedet — og den har været brudt siden Fastify-iterationen i
    nat. **Mønstret er værd at huske:** en gitignore'et mappe der holdes oppe af
    `git add -f` er den eneste slags "committed" kode, hvor *tilføjelse* kan
    fejle stille, og derfor er der nu et script der spørger om det hver gang.
  - **`git diff` er ikke et fuldstændighedstjek, og det er derfor det ikke er
    nok.** Det svarer på "er der noget ændret?" og ikke på "er der noget
    mangler?" — to forskellige spørgsmål om to forskellige fejl, og den anden
    er den der brød entry'en. CI's trin hed "dist is committed and current", og
    det var præcist, hvad det testede. Nu hed trinets krop ét kalds `npm run
    check:dist`, og navnet på spørgsmålet ligger i scriptet.
  - **`clientScheme` er i `handle.ts`, ikke i `express.ts`.** Den skal kunne
    svare det samme som `clientAddress`, og de to skal ikke kunne komme i
    uoverensstemmelse senere — derfor bor de ved siden af hinanden, og derfor
    hedder den `client*` og ikke `forwardedProto`: den *er* klientens adresse,
    bare dens anden halvdel. Den er **ikke** eksporteret fra
    `src/server/index.ts`, så det offentlige API er uændret: en patch ændrer
    adfærd, hvor adfærden var en fejl, og tilføjer ikke navne.
  - **En 500 til en reporter, som ingen havde rapporteret.** Headeren blev
    skrevet direkte ind i den URL, `new Request` parser den, og
    `x-forwarded-proto: javascript:alert(1)` (eller `https://evil.example`, eller
    `%zz`) kastede i adapteren — svaret var det 500-svar, `handleReport` aldrig
    når, fordi oversættelsen dør først. Rettelsen lukker det, fordi kun `https`
    eller intet kommer igennem. Der er en test på præcis de fem værdier.
  - **En ting opgaven havde skrevet om, der viste sig at være forkert:**
    acceptkriteriet sagde `tests/server.test.ts`. Den fil findes ikke; begge
    adaptere testes i `tests/handle.test.ts` (89 tests, nu 92). Skrevet ned, så
    næste iteration ikke leder efter en fil, der ikke findes.

- **2026-09-28, iteration 15** (`ceo/page-descriptions`). Opgave 17: en
  søgningssætning for hver side. Se opgaven.
  - **Fundet ved at læse den genererede HTML, ikke ved at læse koden** — det er
    den sjette gang metoden holder, og her kommer den fra det færdige produkt:
    `grep -o '<meta name="description" content="[^"]*"' site/docs/*/index.html`
    viste **40 af 48 sider med en ellipse** i slutningen, fordi
    `build-docs.mjs` tog beskrivelsen som **sidens første afsnit** klippet ved
    157 tegn. Det er et afsnit, der er skrevet til en læser der lige har klikket,
    kvæst midt i en sætning, og Google skriver den om når den ikke holder.
  - **Den skarpeste del af fundet er ikke længden, men perspektivet.** Seks sider
    skrev om *vores site* i stedet for om sig selv: `NestJS is the sixth
    framework in this row`, `Every other page on this list is about a browser`,
    `Fastify is the framework with the most server-side search behind it that
    this package does not yet have a page for` (den påstand er oven i kullet
    modsagt af, at siden findes), `the most careful error handling of the ones
    above`, `closer … than any other framework in this README`, `That is the
    whole difference from the three frameworks above`, og de tre
    `the-form-*`-sider der alle begynder med `The same state machine`. Under en
    titel i en resultatliste er hver af dem meningsløse. To var desuden for
    korte til at sige noget: `licence` var `MIT`, og `recording-console-errors`
    var `Call this once, from client-side code, as early as your app can manage`.
  - **Rettelsen er en ny fil og fire linjer kode.** `scripts/page-descriptions.mjs`
    er 50 nøgle → sætning, og `pageDescription(slug, body)` i builden bruger den
    og falder tilbage på `describe()`. Fallback'en er ikke en fejl man tåler men
    en fejl man **finder**: `build:docs` kaster nu på (1) en side uden skrevet
    sætning, (2) en over 158 tegn eller med `…`, (3) en der rammer en af syv
    selvreferencerende fraser. Samme slags gate som de fire den allerede havde
    (ugrupperet `##`-sektion, spøgelsesslug, duplikat, side uden
    search-post) — altså i **builden**, ikke i en test, fordi builden er den der
    kender slugene. `install` kom med, selv om dens første afsnit allerede var
    brugbart: en fallback der må være rigtig er en fallback man kommer til at
    regne med, og bygningen kan ikke kende rigtig fra heldig.
  - **De to landingsider er skrevet i hånden** (`site/index.html` 186 tegn,
    `site/da/index.html` 202) og er derfor kortet manuelt til 147 og 157. De er
    de to vigtigste sider på sitet og de eneste, ingen gate rører.
  - **Søgeindekset er uændret: 209 poster.** Beskrivelsen er ikke søgbar tekst,
    så en ny sætning på hver side lå ikke bare det interne søgefelt bedre — den
    flyttede null.
  - `npm run check` grøn: **889 tests** (uændret — ingen kode i biblioteket rørte
    sig), 0 fejl, 0 advarsler. **`dist/` uændret byte for byte**, IIFE'en stadig
    24 645 / 21 063 mod budgetterne 25 088 / 21 504: ingen export, intet budget.
  - ⚠️ **`npm run a11y` og `npm run smoke:annotate` kunne ikke køre:** ingen
    Chrome på maskinen, syvte iteration i træk. Ændringen rører **kun `<head>`**,
    ingen DOM, ingen CSS, ingen controls, ingen synlig tekst — a11y-auditten
    kan ikke ramme den. CI's `browser`-job kører begge dele på hvert push.
  - **MÅL: `/docs/` samlet (50 sider) baseline 0 besøgende pr. 2026-09-28**
    (Plausible 401, Cloudflare 6 351 sidevisninger/28 d på hele sitet). Kan ikke
    måles før Search Console-eksporten (opgave 7) kommer, fordi CTR kræver
    visninger pr. side og ikke kan læses af en trafikrapport. Sammenlign 25/10 og
    25/11.
  - Næste iteration: de otte åbne `VERIFICÉR DEPLOY`-noter, hvis 07:30-vinduet er
    kørt (kl. 03:2x var de alle merged **inden** vinduet, så de er ikke forfalne
    endnu). Ellers opgave 18.

- **2026-09-28, iteration 12** (`ceo/fastify-handler`). Opgave 15:
  `/docs/fastify/` + `fastifyHandler`-export. Se "Fund fra Fastify-iterationen".
  - **Valgt på et tal, ikke på en kvote:** `fastify error handling` har **10
    suggest** målt 28/9 02:0x (Google Suggest, samme metode som de seks
    foregående) — samme bånd som react-router (10) og vue (10), og de var de to
    højest prioriterede sider i rækken. `express error handling middleware`
    har også 10, men er dækket af `expressHandler` og to afsnit i "Receiving a
    report", så den er et opgave 16-kandidat (adapter uden side) frem for et
    mål. Målt i samme kørsel, **ikke valgt**: `nestjs exception filter` **10**
    (se opgave 16), `koa error handling` 5, `hapi error handling` **0**,
    `solid error handling` 0, `inertia js error handling` 1.
  - **Første gang et fund ikke handler om fejl.** De tre foregående
    serversider handler om kroge; den største fælde her er Fastifys
    `bodyLimit` på 1 MiB, som afviser en rapport med screenshot **før ruten
    køres**. Den er derfor formuleret som en fejl i *mountingen* og ikke som en
    fælde i koden, og den er den eneste på de elleve sider der fejler i
    produktion og ikke i dev — de andre ti kan ses ved at læse koden.
  - **Et API-gap fundet og lukket i samme iteration:** de to Node-frameworks i
    rækken har modsatte svar. Hono *er* en fetch-handler, så `handleReport`
    kræver nul lim; Fastify predater web-API'et og kræver en adapter. Uden
    `fastifyHandler` var den eneste Node-side en læser kun kan bruge hvis de
    skriver oversættelsen selv — hvilket er præcis det `expressHandler` blev
    lavet for. Samme regel som altid: en ny *export* er en minor, ikke en
    patch, så det er skrevet i CHANGELOG under Unreleased og **ikke** bumpet
    i version endnu.
  - `npm run check` grøn: **889 tests** (fra 881), 0 fejl, 0 advarsler.
    **44 docs-sider** (fra 43), **202 søgeposter** (fra 194).
  - **`dist/` ændret kun i `dist/server/`.** IIFE'en er uændret byte for byte
    (24 645 / 21 063 mod budgetterne 25 088 / 21 504) — ingen kode i
    bibliotekets klientdel rørte sig, så intet at lægge ved siden af. Den nye
    adapter ligger i `bugbottle/server`, som de to script-tag-builds ikke
    rører.
  - **Validator-only-bundlen er uændret: 582 B gzipped, 1025 minified** (mod
    budgetten 1024), målt med CI's egen opskrift (`normaliseConsole`,
    esbuild 0.24.0, `--platform=node`). De otte forbudte symboler er alle
    stadig væk, `node:fs`/`node:path`/`readFile`/`randomUUID` inklusive — så
    `fastifyHandler` bliver tree-shaket væk ligesom sinksene, hvilket er det
    den skal. **Bemærk til næste måling:** den første måling i denne iteration
    brugte `validateReport` i stedet for CI's `normaliseConsole` og gav 2813 B,
    altså 4,8× budgetten — fordi `validateReport` trækker hele `handle.ts` med
    sig. **Brug CI's indgang, ellers måler man en anden ting.**
  - **En reel mangel fundet og rettet:** Hono-siden (iteration 11) var landet
    **uden CHANGELOG-post**, så den ville være forsvundet i
    udgivelsesnoterne. Samme fejl som Astro-siden havde, og samme fælde — en
    frameworkside er dokumentation. Rettet her, fordi det er samme slags
    dokumentation og der lå en ren changelog-commit klar. **Regel for de
    næste sider: `rg -n <sidetitel> CHANGELOG.md` som en del af gaten.**
  - Næste iteration: opgave 16 (`/docs/nestjs/`, 10 suggest) **kræver research
    først** — et Nest-filter er den sjette fejlklasse i rækken, så siden skal
    begynde med "hvad kan frameworket overhovedet se", og det er ikke fundet
    endnu. Ellers: de syv åbne `VERIFICÉR DEPLOY`-noter, hvis 07:30-vinduet er
    kørt.

- **2026-09-28, iteration 13** (`ceo/hono-page`). Opgave 14: `/docs/hono/` —
  **den første server-side i rækken**, niende side under `Integrations`, og
  dermed en helt ny trafikakse: *backend- og Workers-søgninger*, hvor vi før
  havde nul sider. 43 docs-sider (fra 42), 194 søgeposter (fra 184).
  - **Hvorfor Hono og ikke Fastify,** selvom begge målte 10: `handleReport` er
    `Request`→`Response`, så Hono og Cloudflare Workers kræver nul lim, mens
    Fastify kræver et nyt `fastifyHandler`-export før siden overhovedet kan
    være sand. En side der dokumenterer kode vi ikke har skrevet, er den
    tyndeste slags side, og Fase 3 siger eksplicit at tynde sider kan skade
    hele domænet.
  - Se "Fund fra Hono-iterationen" — fire fund i `hono@4.13.9`'s build. Det
    første er en fejl **der ikke kan rapporteres overhovedet** (en glemt
    `return` giver 404, ikke 500), så siden ender med en kontrolliste hvor det
    første punkt er en *test* og ikke en rettelse. Det er et andet slags
    afsnit end de andre sider har, og det er ærligt: en reporter kan ikke
    løse alt.
  - `dist/` er uændret af builden, byte for byte — ingen eksport rørte sig, så
    ingen budget flyttede. IIFE'en målte 24 645 / 21 063 gz mod budgetterne
    25 088 / 21 504.
  - ⚠️ **`npm run a11y` og `npm run smoke:annotate` kunne ikke køre:** ingen
    Chrome på maskinen (samme grund som iteration 2 og 3). Siden er ren
    Markdown plus én tabel — ingen nye DOM-elementer, ingen ny CSS, ingen nye
    controls — så a11y-auditten rammer ikke denne ændring, og CI's
    `browser`-job kører den på hvert push.
  - Næste iteration: kategorien er åben, se "Næste kandidater" i
    Hono-afsnittet. `fastifyHandler` er den eneste af dem der kræver kode først,
    og den er en minor.

- **2026-09-28, iteration 12** (`ceo/svelte-page`). Opgave 13: `/docs/svelte/`
  som **tredje** adapter-side (react, vue, svelte) og **otte** side under
  `Integrations`. 42 docs-sider (fra 41), 184 søgeposter (fra 176). Læst
  `svelte@5.57.1` + `@sveltejs/kit@2.70.3` (npm-tarballer, ingen installation)
  og `svelte.dev/docs/svelte/svelte-boundary`. Se opgaven og "Fund fra
  Svelte-iterationen".
  - **Første gang de to kilder er enige.** Alle fire fund er læst i boundary'ens
    runtime (`boundary.js:446-451`, `#hydrate_failed_content`,
    `#create_reset`) **og** bekræftet af svelte.dev — efter fire iterationer
    hvor den bedste påstand var en kilden modsiger. Bevares som metode: læs
    runtime'en, men få bekræftelsen fra den officielle side, fordi den
    officielle side også siger **hvornår** (`5.3.0`, ikke 5.0) og hvad den
    *ikke* dækker (event handlers, `setTimeout`).
  - `npm run check` grøn: 881 tests, 42 docs-sider, `dist/` **uændret** byte for
    byte (IIFE 24 645 / 21 063 mod budgetterne 25 088 / 21 504) — ingen eksport
    rørte sig, så ingen budget flyttede.
  - **Ingen deploy-verifikation i denne iteration:** de fem åbne noter er alle
    merget **efter** vinduet 21:30 (22:24–00:2x), og næste vindue er 07:30
    2026-09-28. De er ikke forfalne, så de lukkes i morgen aften.
  - Næste iteration: **"skriv script-tagonlysningen en gang"**, betalt for tre
    gange nu (Vue, React Router, Svelte). Den er DRY, ikke trafik, så den tages
    først når køen er tom — medmindre der dukker en side op med mere end de
    3-4 suggest Svelte har.
  - Målt i samme kørsel, **ikke valgt**: `laravel error handling` 10 (højere
    end Svelte, men forslagene er PHP-undantagelser, ikke en JS-reporter),
    `solid error handling` 0, `inertia js error handling` 1, `solidstart` 0.

- **2026-09-28, iteration 11, anden del** (`ceo/react-router-guide`). Opgave 12:
  `/docs/react-router/`. Se opgaven og "Fund fra React-Router-iterationen".
  - **Siden skriver sig selv oveni konkurrentens egen guide.** Pakken kommer med
    `docs/how-to/error-reporting.md` — en hel side om præcis dette emne — som
    ender i `myReportError(error, location, errorInfo)`. **Det er det sted, hvor
    bugbottle hører hjemme**, og det er derfor siden er bygget som "deres guide
    med hullet lukket" fremad for som en konkurrence. Sådan rammer man også
    konkurrentens *egne* brugere: de lander på deres side, og vores side er den
    der svarer.
  - **Den eneste frameworkside, der fandt en fejl i vores egen kode** (se
    punktet ovenfor). Mønsteret er tre gange bekræftet nu, så det er skrevet
    ind som en regel for de næste sider i ❓.
  - **To klasser blandt de otte fund er nye for planen** og er lagt i "Køen
    efter dette" som en regel: (1) en frameworks **modes** — declarative mode
    i React Router har nul kroge, så opsætningen afhænger af *hvilken mode* appen
    bruger, ikke af hvilket framework; (2) en framework der **ikke** har en krog
    i en bestemt situation, som Astro viste først. Begge er mere brugbare for en
    læser end frameworklisten, fordi de fortæller hvilken slags opsætning siden
    kræver.
  - `npm run check` grøn: 881 tests, 0 fejl, 0 advarsler. 41 docs-sider (fra 40),
    176 søgeposter (fra 165). `dist/` uændret af builden byte for byte
    (IIFE 24 645 / 21 063) — ingen kode i biblioteket rørte sig i denne commit,
    så intet at `git add -f dist` (den første commit i iterationen gjorde det for
    `dist/react/boundary.*`).
  - ⚠️ **`npm run a11y` kunne ikke køre:** ingen Chrome på maskinen, femte
    iteration i træk. Siden er ren Markdown med **nul eksterne links** (derfor
    ingen `a11y-site.mjs`-tilføjelse nødvendig — support-siden havde en, fordi
    den har et payment-link), ingen nye DOM-elementer, ingen ny CSS. CI's
    `browser`-job kører begge dele på hvert push.
  - Næste iteration: **script-tagonlysningen som ét afsnit** (se køen — nu betalt
    for to gange), og så de åbne `VERIFICÉR DEPLOY`-noter hvis 07:30-vinduet er
    kørt.

- **2026-09-28, iteration 11** (`ceo/keep-react-console-line`). Opgave 12
  forsøgt, men først fundet: **en fejl i vores egen kode**, rettet og merged
  uden at siden er skrevet endnu. Se "Fund fra React-Router-iterationen" for de
  otte fund siden skal bygge på.
  - **Fundet kom fra at læse React 19's produktionsbundle igen, den syvende
    gang:** `defaultOnCaughtError(error) { console.error(error); }` — også i
    `react-dom-client.production.js`. `createRootErrorHandlers` giver begge nøgler
    en funktion, og det *erstatter* standarden. Altså: den React-side, der anbefaler
    root-handlerne til en plain React-app, slettede præcis den konsolindgang,
    ringbufferen optager, for de fejl den rapporterede. Rettet med én linje
    (`console.error(error)` før senden) + test + README-afsnit + CHANGELOG.
  - **Mønstret er tre gange bekræftet nu** (Vue `errorHandler`, Nuxt
    `showError`, nu vores egen React-handler): en reporter der *erstatter* en
    loglinje, tager beviset med. Skriv det som en fast regel for alle
    frameworksider, ikke som en pointe pr. side.
  - `npm run check` grøn: 881 tests, 0 fejl, 0 advarsler. IIFE'en er uændret
    byte for byte (24 645 / 21 063) — denne kode er i `bugbottle/react`, ikke i
    script-taget. `dist/react/boundary.*` er ændret og committet.
  - Deploy-noterne fra i går (support, vue, react, wordpress) er **stadig åbne
    og ikke forfaldne**: merge 23:3x, det næste batch-vindue er 07:30 28/9.
    Denne iteration merger før det vindue og kan verificeres i samme kørsel.
  - Næste iteration: skrive `/docs/react-router/` — fundene er skrevet ned, så
    det er en ren skriveopgave.

- **2026-09-28, iteration 10** (`ceo/support-page`). Opgave 11: `/support/` +
  `.github/FUNDING.yml`. Se opgaven for datagrunden.
  - **Valget var ikke "tilføj en donationsknap", men "svar på det spørgsmål, en
    læser har, når der ikke står en pris".** Konkurrenterne i dette felt sælger
    et dashboard bag en plan. bugbottle har intet af det, så en side der bare
    sagde "donér her" ville være sværere at tro end ingen side: den ville lade
    alle undværende spørgsmålet stå åbent. Siden starter derfor med, hvad en
    donation **ikke** køber — ingen Pro, ingen licensnøgle, ingen prioritet i
    en kø, intet i panelet — og først derefter med, hvad den går til. Det er
    samme rækkefølge som privacy-siden: felt for felt, med kilden i koden.
  - **De gratis ting står først, fordi de er det reelle signal.** Et GitHub-stjerne
    på et repo med to stjerner er den største enkeltstående værdi her; det står
    derfor som det første afsnit efter "hvad det ikke køber", og siden siger det
    ærligt, at det er det, der er målt på (★2, 0 forks).
  - **Ét link, to steder.** `site/support.md` og `.github/FUNDING.yml` peger på
    samme Stripe-payment-link, som er det eneste link missionen oplyser. Ingen
    nøgle i repoet, intet Stripe-produkt oprettet, ingen banner, intet i
    panelet. Det er holdt påtrængende på afstand pr. definitionen: kun en footer-
    linje på hver landingside + About-gruppen i sidebaren.
  - **Ingen dansk oversættelse, med vilje.** Som changelog-siden: en `STANDALONE`
    uden `otherUrl`, ingen `hreflang` i sitemap'en, og den danske landingpage
    linker til den med `hreflang="en"`. En dansk side ville sige det samme i
    samme rækkefølge, og så har vi to URL'e med samme tekst — som er præcis det,
    `hreflang` ikke må bruges til.
  - **Byggetjekket:** 48 URL'er i sitemap'en (fra 47), 165 søgeposter (fra 159) med
    ét opslag pr. `##`-afsnit. `dist/` er uændret af builden, byte for byte
    (IIFE 24 645 / 21 063 mod budgetterne 25 088 / 21 504) — ingen kode i
    biblioteket rørte sig, så intet at `git add -f dist`.
  - `npm run check` grøn: 880 tests, 0 fejl, 0 advarsler. CHANGELOG skrevet
    **inden** commit, plus CLAUDE.md-layouttabellen, README's "Who makes it" og
    `.gitignore` (den nye genererede mappe skal ignoreres, ellers lander den i
    git).
  - **`npm run a11y` kunne ikke køre** (fjerde iteration i træk — `findChrome()`
    returnerer en Windows-sti på denne maskine, så der er ingen Chrome). Siden er
    ren Markdown: ingen nye DOM-elementer, ingen ny CSS, ingen nye controls. Den
    er dog lagt i `scripts/a11y-site.mjs`'s `PAGES`, fordi den har et eksternt
    link midt i en artikel — CI's `browser`-job kører den på hvert push.
  - **Fandt en overdrivelse i min egen tekst ved selve gennemlæsningen, og den er
    rettet:** jeg havde skrevet at browserne testes "på hver ændring af panelet".
    CI kører *ét* browserjob — Chrome på `ubuntu-latest` — og ingen Firefox- eller
    Safari-kørsel findes. Bulletten siger nu det, der er sandt, og gør en
    Safari-bug til den konkrete vej den kommer ind ad. Det er præcis den slags
    påstand, siden bliver dømt på, så den skal være den rigtige slags.
  - **Næste iteration:** opgave 12, `/docs/react-router/` (10 suggest målt i
    denne iteration, tredjestørste i rækken efter Next.js og Angular, og de er
    konkrete: "react router 7 error boundary", "… props", "… not working").
    Remix blev React Router, så én side dækker begge navne.

- **2026-09-27, iteration 9** (`ceo/vue-page`). Opgave 10: `/docs/vue/` som
  tredje side under `Integrations` (react, vue, nextjs, angular, nuxt, astro,
  wordpress). Se "Fund fra Vue-iterationen" — fire fund fra de publicerede
  produktionsbuilds.
  - **Metoden holdt for sjette gang.** De tre stærkeste fund er alle
    *rettelser* af noget, læseren troede: at man kan sætte
    `app.config.errorHandler` uden at miste konsollen, at `onErrorCaptured`
    med `false` sletter fejlen, og at en kastende router-guard aldrig når
    Vues handler. Ingen af dem står i vuejs.org eller vue-router's docs, og
    alle tre er verificeret i `cjs.prod.js` — ikke bare i den læsbare build.
  - **`vue-router` er en devDependency-bygning, jeg læste den publicerede
    ud:** `vue-router.esm-bundler.js` er 163 bytes og re-eksporterer fire
    chunk-filer, så det første grep gav **nul resultater**. Den fulde kode
    ligger i `dist/vue-router.esm-browser.js` og i den minificerede
    `…prod.js`, hvor `triggerError` hedder `L`. **Et nul-resultat i et grep er
    ikke et "findes ikke"** — det var det, der næsten kostede fund 4.
  - **Tre sider deler nu én fejl.** `app.config.errorHandler` erstatter
    konsollen (Vue), `router.onError` erstatter konsollen (vue-router), og
    Nuxt fjerner sin egen default-handler ved hydration. Alle tre er samme
    bytte i tre lag, og det er derfor snippet'et logger linjen tilbage.
  - `dist/` er uændret af builden, byte for byte (IIFE 24 645 / 21 063 mod
    budgetterne 25 088 / 21 504) — ingen eksport rørte sig, så intet at
    `git add -f dist`. 40 docs-sider (fra 39), 159 søgeposter (fra 150).
  - `npm run check` grøn: 880 tests, 0 fejl, 0 advarsler. CHANGELOG skrevet
    **inden** commit.
  - Deploy-noterne for `/docs/react/` og `/docs/wordpress/` er stadig åbne og
    **ikke forfalne**: de blev merget 22:24 og 22:32, og det seneste
    batch-vindue (21:30) lå *før* begge. Næste er 07:30 28/9.
  - Næste iteration: `open({ prefill })` er det mest genbrugelige fund i
    hele planen (det rammer fem sider nu), **men** det rører et eksisterende
    eksports signatur, så det er en minor og en beslutning under ❓. Alternativt
    de fem frameworksiders fælles fejlside-afsnit, som er allerede betalt for.

- **2026-09-27, iteration 8** (`ceo/react-page`). Opgave 9: `/docs/react/` som
  sjette side under `Integrations`. Se "Fund fra React-iterationen" — tre
  fælder, alle læst i `react-dom@19.3.0`'s **produktionsbuild**.
  - **Metoden holdt for fjerde gang:** læs *buildet*, ikke dokumentationen.
    Som i Nuxt- og Astro-iterationen er den bedste påstand en, kilden modsiger,
    og den er her dobbelt så stærk fordi det er en korrigering af en påstand
    folk faktisk tror. Verificeret uden at installere noget: `curl` på
    npm-tarballen + `tar -xzO` til stdout (den første forsøg med `npm i` i en
    scratch-mappe blev blokeret af rettighederne, så læsningen skete i stedet
    som et greb i strømmen — samme resultat, nul filer).
  - **To React-sektioner findes allerede** i "Get started", så siden er bevidst
    kun de tre fælder og *linker* til dem. Det er grunden til at den ikke er
    "den sjette side der ligner de andre fem" — de to krydslinks er skrevet
    som `#the-form-react` / `#catching-render-errors-react` og buildens
    ankerkort gør dem til rigtige `/docs/…/`-URL'er (tjekket i den genererede
    HTML).
  - `dist/` er uændret af builden, byte for byte (IIFE 24 645 / 21 063 mod
    budgetterne 25 088 / 21 504) — ingen eksport rørte sig, så intet at
    `git add -f dist`. 39 docs-sider (fra 38), 150 søgeposter (fra 145).
  - `npm run check` grøn: 880 tests, 0 fejl, 0 advarsler.
  - CHANGELOG-entry skrevet **inden** commit — iteration 5's lære.
  - ⚠️ `npm run a11y` og `npm run smoke:annotate` kunne ikke køre: ingen Chrome
    på maskinen, som i iteration 2–7. Siden er ren Markdown — ingen nye
    DOM-elementer, ingen ny CSS, ingen nye controls. CI's `browser`-job kører
    begge på hvert push.
  - Næste iteration: **Vue** (10 suggest, `bugbottle/vue` er en selvstænd
    adapter, og `vue:error` er kun dokumenteret som en del af Nuxt-siden).
    Ellers ❓-punkterne, som kræver Mads.

- **2026-09-27, iteration 7** (`ceo/wordpress-page`). Opgave 8: `/docs/wordpress/`
  som femte side under `Integrations`, plus rettelsen i `/da/kom-i-gang/`. Se
  "Fund fra WordPress-iterationen".
  - **Deploy-verifikation først:** de tre åbne noter (privacy, compare, astro) er
    alle lukkede mod indhold, 21:47 — ét kørselsvindue dækker alle tre merges.
  - **Opgaven i planen var forkert på én punkt, og det er fundet der sparede
    en hel side misinformation.** Den sagde "hvilke `data-*` attributer
    pluginet læser". Svaret er *ingen*, og det står i `class-assets.php`'s
    egen docblock. **Skriv aldrig en opgave om et fremmed repo ud fra dets
    readme** — læs koden, som her gav tre fund og en rettelse af dansk tekst.
  - `dist/` er uændret af builden, byte for byte (IIFE 24 645 / 21 063 mod
    budgetterne 25 088 / 21 504) — ingen eksport rørte sig, så intet at
    `git add -f dist`. 38 docs-sider (fra 37), 145 søgeposter.
  - `npm run check` grøn: 880 tests, 0 fejl, 0 advarsler.
  - ⚠️ **`npm run a11y` og `npm run smoke:annotate` kunne ikke køre:** ingen
    Chrome på maskinen, som i iterationer 2–6. Ændringen er ren Markdown — ingen
    nye DOM-elementer, ingen ny CSS, ingen nye controls; de to eksisterende
    WordPress-links i README peger på en side i samme site. CI's `browser`-job
    kører begge på hvert push.
  - Næste iteration: `## ❓`-punkterne er de eneste åbne ting, der kræver Mads
    (Search Console-eksport, Stripe, deploy-konfiguration, rapport-id i
    panelet). Uden dem er den bedste brug af en iteration de fire delte
    frameworksiders fælles afsnit (script-tag-vejen, verifikationsmønstret,
    fejl-siden-knappen) — de er allerede betalt for, se "Køen efter dette".

- **2026-09-27, iteration 6** (`ceo/privacy-erasure`). Opgave 6: ny sektion i
  begge privatlivssider om den del af spørgsmålet, checklisten ikke kunne svare
  på — hvad der sker, når en *person* beder om de data, de allerede har sendt.
  Se "Fund fra privacy-iterationen".
  - **`dist/` er uændret af builden, byte for byte** (IIFE 24 645 / 21 063 mod
    budgetterne 25 088 / 21 504) — ingen eksport rørte sig, så ingen budget
    flyttede, og intet at `git add -f dist`.
  - Nyt: `tests/privacy-checklist.test.ts` har nu fire tests, hvoraf den nye
    pinner de to siders afsnitslister mod hinanden (README `###` mod
    `privatliv.md` `##`).
  - **Deploy-noterne fra iteration 4 og 5 er stadig åbne og ikke forfalne:**
    kl. 21:03 var de merget 19:35 og 20:10, og det næste batch-vindue er 21:30.
    Denne iterations merge kommer i samme kørsel, så alle tre kan verificeres
    sammen ved næste iterations start.
  - Næste iteration: opgave 8 (`/docs/wordpress/`) — den mest konverterende
    ting vi har ubeskrevet, og den har brug for pluginets `readme.txt` læst
    først, så teksten ikke gætter. Ellers opgave 7 (Search Console, kræver Mads).

- **2026-09-27, iteration 5** (`ceo/sentry-sdk-compare`). Opgave 5: den
  sjette række i `/compare/` og `/da/sammenlign/` — `@sentry/react`, målt i sted
  for citeret. Ny dev-script `scripts/measure-competitors.mjs`. Se "Fund fra
  Sentry-SDK-rækken".
  - **En reel mangel fundet og rettet:** Astro-guiden (iteration 4) var
    landet **uden CHANGELOG-entry**, så den ville have været væk i
    udgivelsesnoterne for 1.0.1→1.1.0. CLAUDE.md's "definition of done" siger
    at kode, tests *og* dokumentation lander samlet, og en frameworkside er
    dokumentation. Rettet her, fordi det er samme slags dokumentation og det
    var billigere end en ren plan-commit. **Til næste iteration: kør
    `rg -n <sidetitel> CHANGELOG.md` som en del af gaten på enhver docs-side.**
  - `dist/` er uændret af builden, byte for byte (IIFE 24 645 / 21 063 mod
    budgetterne 25 088 / 21 504) — ingen eksport rørte sig, så ingen budget
    flyttede.
  - Deploy-noten fra iteration 4 (`/docs/astro/`) er stadig åben og ** ikke
    forfalden**: merge 19:35, det næste batch-vindue er 21:30, og ingen kørsel
    har været siden merge-tidspunktet. Denne iterations merges (denne række og
    CHANGELOG) kommer i samme batch og kan verificeres sammen med Astro.
  - Næste iteration: opgave 6 (privacy: "hvad gør jeg med data jeg *allerede*
    har sendt?"), som er konverterings- og tillidsmulighed for virksomheder.

- **2026-09-27, iteration 4** (`ceo/astro-guide`). Landede `/docs/astro/`
  som fjerde frameworkside under `Integrations`. 37 docs-sider (fra 36).
  Læst `withastro/astro@7.3.5`'s kilde og hele `withastro/docs`-treeet. Se
  "Fund fra Astro-iterationen".
  - **Deploy-verifikation først:** alle tre åbne `VERIFICÉR DEPLOY`-noter er
    lukkede — nextjs, angular og nuxt er **alle live** (sitemap'en lister dem,
    `lastmod 2026-09-27`, og indholdet er det nye: `error.digest`,
    `provideBrowserGlobalErrorListeners`, `enforce: "pre"` og
    `app:chunkError`). `Integrations`-gruppen har tre sider i live-sidebaren.
  - `dist/` er uændret af builden, byte for byte — ingen eksport rørte sig,
    så ingen budget flyttede. IIFE'en målte 24 645 / 21 063 gz mod budgetterne
    25 088 / 21 504.
  - Næste iteration: opgave 5 (Sentry-SDK'en i `/compare/`).

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

- `VERIFICÉR DEPLOY: /docs/global-errors/ (47 sider i sitemap'en, ny side som
  nummer to i `Get started` — `window.onerror` og `unhandledrejection`, de to
  events ringbufferen lytter på, skrevet på MDN læst 28/9) 9f1d5e8, merge
  d078b28 ~06:4x, 2026-09-28` — næste batch-vindue er **07:30 2026-09-28**, samme som de
  elleve notes nedenfor, så **én kørsel dækker alle tolv**. Verificér
  **indhold**: `https://bugbottle.dev/docs/global-errors/` skal vise de to
  signaturer, de **fem** ting under "Five things that decide whether what you
  captured is any use" (elementets `error`, `Script error.`, at et cross-origin
  rejection ikke fyrer noget event, Workers, `event.error`), afsnittet "What an
  uncaught error puts in a report" med `ten frames`, og den vanilje snippet
  med `window.addEventListener("unhandledrejection"`. `description`-taggen skal
  begynde `window.onerror and unhandledrejection:` (helt, ingen ellipse),
  sitemap'en skal liste siden med `lastmod 2026-09-28`, og `Get started` i
  sidebaren skal have den som **post 2** (Install, Recording console errors,
  window.onerror…). **Ingen ny URL ud over denne**, og `dist/` rørte ændringen
  slet ikke — ingen kode, så IIFE'erne er uændrede (24 688 / 21 104 gzipped).

- `VERIFICÉR DEPLOY: /self-hosted/ (55 sider i sitemap'en, ny side under About
  — ny side under About
  — den sjette side med sin egen Markdown, og den første der svarer på
  "sentry alternative" / "self hosted error tracking") — 1535837, merge
  68f21a6 ~06:2x,
  2026-09-28` — næste batch-vindue er **07:30 2026-09-28**, samme som de ti
  notes nedenfor, så **én kørsel dækker alle elleve**. Verificér **indhold**:
  `https://bugbottle.dev/self-hosted/` skal vise de tre former (rute,
  `examples/inbox`, WordPress-plugin), tabellen med de fem fælder, teksten
  `DEFAULT_MAX_REPORTS` og `MAX_SCREENSHOT_BYTES`, `description`-taggen skal
  begynde `Self-hosted error reporting with no server to run` (ikke klippet),
  sitemap'en skal liste siden med `lastmod 2026-09-28`, og `About`-gruppen i
  sidebaren skal have **fire** poster (Compared with, Changelog, Support,
  Self-hosted). **Ingen ny URL ud over denne** — de øvrige 54 er uændrede,
  og `dist/` rørte denne ændring slet ikke, så IIFE'erne og budgetterne er
  uændrede (24 688 / 21 104 gzipped, `check-dist` grøn på 208 filer).

- `VERIFICÉR DEPLOY: /docs/express/ og /docs/fastify/ — to afsnit i
  "X-Powered-By er på" og "Hvilken adresse ratelimitten tæller" er skrevet om
  `x-forwarded-proto` igen, fordi adfærden er rettet (opgave 19) og den gamle
  sætning sagde, at asymmetrien fandtes. dc9a3ef, merge 7c2ccb7 ~04:5x,
  2026-09-28` — næste batch-vindue er **07:30 2026-09-28**, samme som de otte
  notes nedenfor, så **én kørsel dækker alle ti**. Verificér **indhold**:
  `https://bugbottle.dev/docs/express/` skal ikke længere sige "One asymmetry
  worth knowing … takes `x-forwarded-proto` at face value", og skal sige at
  skemaet kun kommer fra headeren når `trustProxy` siger det;
  `https://bugbottle.dev/docs/fastify/` skal have det afsnit der siger det
  samme. `description`-taggene er uændrede, så de skal begynde
  `expressHandler in Express` og `Receive a report in Fastify` — hvis de er
  klippet, er den forrige deploy af description-iterationen ikke landet, og
  det skal siges i stedet for at læses som en ny fejl. **Ingen ny URL** og ingen
  ændring i sitemap'en. `dist/` rørte denne ændring kun på
  `dist/server/{handle,express,fastify}.js`, som sitet ikke bruger — det er en
  statisk nginx-side, så intet af det synes på bugbottle.dev. Den **eneste**
  synlige forskel er de to afsnit.
- `KLAR TIL RELEASE: v1.1.0` (var `v1.0.2` indtil 28/9 05:3x) — **ikke**
  bumpet, kun her, fordi beslutningen er Mads'. Den bliver en **minor** og ikke en
  patch, fordi opgave 21 (`widget.open({ message })`) ændrer signaturen på en
  eksisterende export, og efter `docs/api-audit-1.0.md`'s egne regler kan det
  ikke ligge i en patch. **Spørgsmålet til Mads er derfor ændret:** de to patches
  nedenfor er stadig dem, der haster mest — især (1) — så hvis du hellere vil have
  1.0.2 ud *nu* med kun patches, så skal `open({ message })` holdes tilbage, og
  det er én commit at fjerne igen. `CHANGELOG.md`s *Unreleased* har nu fire
  poster, hvor de to nye er de
  der betyder mest: (1) det committede `dist` manglede
  `dist/server/fastify.js`, så **`bugbottle/server` har kastet
  `ERR_MODULE_NOT_FOUND` på import for alle der installerede fra GitHub eller
  jsDelivr siden 28/9 kl. 02:4x** — det er den, der haster; (2)
  `x-forwarded-proto` blev troet uden `trustProxy`, plus den 500 den lukker.
  Begge er patches, og *Unreleased* rummer desuden `/docs/express/`,
  `/support/`, søgningssætningerne på alle 50 sider og de otte framework-sider,
  som heller ikke er frigivet endnu. **Spørgsmålet til Mads:** frigives alt
  sammen som 1.1.0, eller er der grund til at holde docs-arbejdet tilbage fra
  en release der retter en brudt importvej? Bemærk at rettelsen først virker for
  en ny GitHub-installation **efter** at committen er nået GitHub — den ligger
  der nu, så `npm install github:mahope/bugbottle#<sha>` virker allerede, mens
  `#v1.0.1` stadig er brudt.

- `VERIFICÉR DEPLOY: de fem framework-siders kode-eksempler kalder nu
  open({ message }) — /docs/vue/, /docs/nuxt/, /docs/astro/, /docs/svelte/ og
  /docs/angular/ — og den kommentar der sagde "open() takes no arguments, so the
  box opens empty" er væk fra begge steder, hvor den stod (Astro og SvelteKit).
  31b3eda, merge b324f87 ~05:46, 2026-09-28` — næste batch-vindue er
  **07:30 2026-09-28**, samme som de ni notes ovenfor, så **én kørsel dækker
  alle ti**. Verificér **indhold**: `https://bugbottle.dev/docs/astro/` skal
  vise `widget.open({ message: ...never hydrated... })` og må **ikke** vise
  "takes no arguments"; `https://bugbottle.dev/docs/svelte/` skal vise
  `widget.open({ message: ...${pattern}... })` og må ikke vise den gamle
  kommentar; `https://bugbottle.dev/docs/vue/` skal vise `app.config.errorHandler`
  med `widget.open({ message:` og `router.onError` med `Route ${...} failed:`;
  `/docs/nuxt/` skal have `const open = (message?: string)`; `/docs/angular/`
  skal have `this.feedback.open({ message: error instanceof Error` i
  `handleError`. **Ingen ny URL og ingen ændring i sitemap'en** — det er fem
  eksisterende sider, kun `<pre>`-blokke og kommentarer. `description`-taggene er
  uændrede, så de skal begynde `vue:` / `nuxt:` / `astro:` / `svelte:` /
  `angular:` som før. `dist/` rørte denne ændring kun i `dist/ui/*` og de to
  IIFE'er; sitet indlæser IIFE'erne fra jsDelivr ved sit eget versionsnummer,
  så **det eneste synlige på bugbottle.dev er de fem eksempler**.

- `VERIFICÉR DEPLOY: /docs/express/ (46 sider i sitemap'en, ny
  integrationsside — den **tolvte** under Integrations, og den første side om
  den adapter der er mest brugt) 51fdf36, merge 80c6933 04:01,
  2026-09-28` — næste batch-vindue er **07:30 2026-09-28**. Kan verificeres i
  **samme kørsel som de otte notes nedenfor** (alle merge før 07:30). Verificér
  **indhold**: `https://bugbottle.dev/docs/express/` skal vise de fem fund
  (`102400` / "100kb default", `opts.encoding = verify`,
  `express.raw({ type: "application/json" })`, `isPromise(ret)`,
  `req.socket.destroy()`), teksten `DEFAULT_MAX_BODY_BYTES` og
  `req.socket.remoteAddress`, `description`-taggen skal begynde
  `expressHandler in Express` (ikke klippet, under 158 tegn), sitemap'en skal
  liste siden med `lastmod 2026-09-28`, og `Integrations`-gruppen i sidebaren
  skal have **tolv** sider med `/docs/express/` som nr. 12.
- **Bemærk til næste iteration: `npm run a11y` kan ikke køre lokalt her.**
  `scripts/chrome.mjs` slår `puppeteer-core` op i det globale npm-root
  (`/opt/homebrew/lib/node_modules`) og den findes ikke, så `npm run a11y` og
  `npm run smoke:annotate` fejler med `MODULE_NOT_FOUND` efter ~0 ms. Det er et
  lokalt miljøproblem, ikke en kodefejl: CI's `browser`-job kører begge på hvert
  push. **Lad være med at læse det som en rød gate lokalt** — `npm run check`
  er den gate, og den var grøn. Sider der kun er tekst (en docs-side) er lav
  risiko; det er en ændring i `src/ui/` eller `site/*.css` der kræver en
  browsermåling, og den skal ske i CI.

- `VERIFICÉR DEPLOY: alle 50 sider får en ny `<meta name="description">` (40
  af dem lå med en ellipse, seks talte om sitet), de to landingsider kortet i
  hånden, og `build:docs` fejler nu på en side uden sætning, på en klippet
  en og på en der taler om sitet — ae51bd2, merge 208b573, 28/9 ~03:5x` —
  **næste batch-vindue er 07:30 2026-09-28**. Kan verificeres i **én kørsel**
  med de otte notes nedenfor. Verificér **indhold**, ikke HTTP 200: hent
  `https://bugbottle.dev/docs/nestjs/` og læs `content=` i description-taggen,
  og tjek at den er hel (ingen `…`), under 158 tegn, og at den siger noget om
  siden: skal begynde `A NestJS exception filter runs on the server`. Samme
  stikprøve på `/docs/nextjs/` (begynder `error.tsx, global-error.tsx`),
  `/docs/fastify/` (`Receive a report in Fastify`), `/docs/hono/`,
  `/docs/svelte/`, `/docs/astro/`, `/docs/nuxt/`, `/docs/angular/`,
  `/docs/react/`, `/docs/vue/`, `/docs/react-router/`, `/docs/wordpress/` og
  `/da/privatliv/`. **Sidetallet i sitemap'en er uændret** (50 URL'er før og
  efter) — det er kun `<head>`, så der kommer ingen ny post.

- `VERIFICÉR DEPLOY: /docs/fastify/ (44 sider i sitemap'en, ny
  integrationsside under Integrations — **og den første `bugbottle/server`-
  export der ændrer noget i dist/**) a5bf5e9, merge ca. 02:4x,
  2026-09-28` — næste batch-vindue er **07:30 2026-09-28**. Kan verificeres i
  **samme kørsel som de syv notes nedenfor** (hono 02:0x, svelte 00:54,
  react-router 00:2x, support 23:3x, vue 23:04, react 22:32, wordpress 22:24 —
  alle merge før 07:30). Verificér **indhold**:
  `https://bugbottle.dev/sitemap.xml` skal liste
  `https://bugbottle.dev/docs/fastify/` med `lastmod 2026-09-28`, siden skal
  vise de fire fund (`1 048 576` / `FST_ERR_CTP_BODY_TOO_LARGE`,
  `addContentTypeParser`, `defaultErrorLog` / pino, `Object.getPrototypeOf`),
  teksten `fastifyHandler` og `bodyLimit: 5 * 1024 * 1024`, og
  `Integrations`-gruppen i sidebaren skal have **ti** sider med
  `/docs/fastify/` som nr. 10. Tjek også at `/docs/changelog/` har Fastify-
  **og** Hono-posten — den Hono-post manglede i sidste iteration.

- `VERIFICÉR DEPLOY: /docs/hono/ (43 sider i sitemap'en, ny integrationsside
  under Integrations, **første server-side** i rækken) b33195a, merge f40c4f2,
  2026-09-28 ca. 02:0x` — næste batch-vindue er **07:30 2026-09-28**. Kan
  verificeres i **samme kørsel som de syv notes nedenfor** (svelte 00:54,
  react-router 00:2x, support 23:3x, vue 23:04, react 22:32, wordpress 22:24 —
  alle merge før 07:30). Verificér **indhold**:
  `https://bugbottle.dev/sitemap.xml` skal liste
  `https://bugbottle.dev/docs/hono/` med `lastmod 2026-09-28`, siden skal vise
  de fire fund (`res ?? this.#notFoundHandler(c)`,
  `Context is not finalized`, `#handleError`/`instanceof Error`,
  `"getResponse" in err`) og teksten `c.req.raw`, `HTTPException`,
  `getBunServer`, `export default app`, og `Integrations`-gruppen i sidebaren
  skal have **ni** sider med `/docs/hono/` som nr. 9.

- `VERIFICÉR DEPLOY: /docs/svelte/ (42 sider i sitemap'en, ny integrationsside
  under Integrations, tredje i sidebaren efter React og Vue) d35f86d, merge
  ca. 01:2x, 2026-09-28` — næste batch-vindue er **07:30 2026-09-28**. Kan
  verificeres i **samme kørsel som de fem notes nedenfor** (react-router
  00:2x, support 23:3x, vue 23:04, react 22:32, wordpress 22:24 — alle merge
  før 07:30). Verificér **indhold**: `https://bugbottle.dev/sitemap.xml` skal
  liste `https://bugbottle.dev/docs/svelte/` med `lastmod 2026-09-28`, siden
  skal vise de fire fund (`!this.#props.onerror && !this.#props.failed`,
  "deserialised error object"/"deserialized error object", `transformError`,
  `did_reset`) og teksten `HttpError`, `unhandledrejection` og
  `svelte_boundary_reset_noop`, og `Integrations`-gruppen i sidebaren skal have
  **otte** sider med `/docs/svelte/` som nr. 3.

- `VERIFICÉR DEPLOY: /docs/react-router/ (41 sider i sitemap'en, ny
  integrationsside under Integrations) + `createRootErrorHandlers`' konsollinje
  (den giver sig i en rapport, ikke på siden) ceo/react-router-guide og
  ceo/keep-react-console-line, merge 4d6edfb og ca. 00:2x, 2026-09-28` — næste
  batch-vindue er **07:30 2026-09-28**. Kan verificeres i **samme kørsel som de
  fire notes nedenfor** (support 23:3x, vue 23:04, react 22:32, wordpress 22:24
  — alle merge før 07:30). Verificér **indhold**: `/docs/react-router/` skal
  indeholde `Three modes, three different answers` og
  `RemixBrowserProps`, og `/docs/react/` skal have den nye sætning om
  `onError`. Tilføj `VERIFICÉR DEPLOY: 1d800b9` hvis biblioteket skal tjekkes
  særskilt — `bugbottle/react` er det kun i `dist/react/boundary.js`, og
  IIFE'en er uændret, så en ren kontrol af sitet kan ikke se den.

- `VERIFICÉR DEPLOY: /support/ + footerlinket på begge landingsider +
  .github/FUNDING.yml (48 URL'er i sitemap'en) e00a09c, merge e26cba2,
  2026-09-27 23:3x` — næste batch-vindue er **07:30 2026-09-28**. Kan
  verificeres i **samme kørsel som de tre notes nedenfor** (Vue 23:04, React
  22:32, WordPress 22:24 — alle i samme batch). Verificér **indhold**:
  `https://bugbottle.dev/support/` skal have de fem afsnit ("What a donation
  does not buy", "What it goes to", "Supporting it without money", "Donating",
  "If you are buying this for a company"), teksten
  `donate.stripe.com/7sYeVcbn50wieFM8gDbMQ0c` **og ingen anden
  donate.stripe.com-adresse**, `https://bugbottle.dev/sitemap.xml` skal liste
  `https://bugbottle.dev/support/` med `lastmod 2026-09-28`, `About`-gruppen i
  `/docs/` skal have **tre** poster (Sammenlignet med, Changelog, Support), og
  footeren på `/` skal have `Support bugbottle` mens footeren på `/da/` skal
  have `Støt bugbottle`. Tjek også at der stadig står **én** betalingslink på
  hele sitet: siden skal være det eneste sted, der beder om penge.

- `VERIFICÉR DEPLOY: /docs/vue/ (ny integrationsside, 40 sider i
  sitemap'en, tredje i sidebaren) ef5a576, merge 26281b3, 2026-09-27 23:04` —
  næste batch-vindue er **07:30 2026-09-28**. Kan verificeres i **samme
  kørsel som de to notes nedenfor** (WordPress 22:24, React 22:32). Verificér
  **indhold**: `https://bugbottle.dev/sitemap.xml` skal liste
  `https://bugbottle.dev/docs/vue/` med `lastmod 2026-09-28`, siden skal vise
  de fire fund (`app.config.errorHandler` *sletter* konsollinjen,
  `onErrorCaptured` med `false`, `throwUnhandledErrorInProduction`,
  `router.onError`), teksten `vuejs.org/error-reference/#runtime-6` og
  `Hydration completed but contains mismatches.`,
  `Integrations`-gruppen i sidebaren skal have **syv** sider med `/docs/vue/`
  som nr. 2, og `/docs/changelog/` skal have Vue-posten.

- `VERIFICÉR DEPLOY: /docs/react/ (ny integrationsside, 39 sider i
  sitemap'en) 55e975c, merge 9f59905, 2026-09-27 22:32` — næste batch-vindue er
  **07:30 2026-09-28**. Kan verificeres i **samme kørsel som WordPress-noten
  nedenfor** (den blev merget 22:24, otte minutter før denne). Verificér
  **indhold**: `https://bugbottle.dev/sitemap.xml` skal liste
  `https://bugbottle.dev/docs/react/` med `lastmod 2026-09-28`, siden skal vise
  de tre fældes overskrifter ("The root handlers are not development-only",
  "An error boundary is still a class in React 19", "The two send the same
  error twice") og teksten `react-dom@19.3.0`, `errorBoundary` og
  `onCaughtError: () => {}`. `Integrations`-gruppen i sidebaren skal have **seks**
  sider med `/docs/react/` først, `/docs/changelog/` skal have React-posten, og
  de to krydslinks i side-introen skal pege på `/docs/the-form-react/` og
  `/docs/catching-render-errors-react/` — ikke på GitHub.

- `VERIFICÉR DEPLOY: /docs/wordpress/ (ny integrationsside, 38 sider i
  sitemap'en) + rettelsen i /da/kom-i-gang/ rute 2, 8bba482, merge f490b6c,
  2026-09-27 22:24` — næste batch-vindue er **07:30 2026-09-28**. Verificér
  **indhold**: `https://bugbottle.dev/sitemap.xml` skal liste
  `https://bugbottle.dev/docs/wordpress/` med `lastmod 2026-09-28`, siden skal
  vise `{"error":"Plugin not found."}` og "No `data-*` attributes are read" og
  `manage_options`, `Integrations`-gruppen i sidebaren skal have **fem** sider,
  og `/da/kom-i-gang/` skal sige at pluginnet **ikke** er i katalogen.

- ✅ **DEPLOY OK 2026-09-27 21:47.** De tre notes nedenfor er alle lukkede mod
  **indhold**, i én kørsel efter vinduet 21:30:
  - `/docs/privacy-checklist/` viser "When somebody asks for the data you already
    have", `/da/privatliv/` viser "Når nogen beder om de data, du allerede har" —
    begge nye afsnit er live, og begge står i sitemap'en med `lastmod 2026-09-27`.
  - `/compare/` har seks rækker, den sjette med `@sentry/react` og `33.2 kB` /
    `95.8 kB`; `/da/sammenlign/` har samme række med `33,2 kB` / `95,8 kB`, og
    tallet `29 251 063` står i afsnittet under tabellen på begge sprog.
  - `/docs/astro/` viser guiden med `astro:hydration-error` (5 gange) og
    `handleHydrationError` (2 gange), `Integrations`-gruppen har fire sider, og
    `/docs/recipes/` har stadig sit Astro-afsnit. `/docs/changelog/` har posterne
    for både Sentry-rækken og Astro-guiden.

- `VERIFICÉR DEPLOY: /docs/privacy-checklist/ + /da/privatliv/ (det nye afsnit
  "When somebody asks for the data you already have") b5bc51b, merge d07c357,
  2026-09-27 21:08` — næste batch-vindue er 21:30 2026-09-27. Kan verificeres i
  **samme kørsel** som de to notes nedenfor. Verificér **indhold**: begge sider
  skal have det nye afsnit, `/docs/privacy-checklist/` med overskriften "When
  somebody asks for the data you already have" og tabellen med otte rækker
  (Slack/Discord, Teams, mail, Sentry, issue-system, brugerens `localStorage`,
  backups), `/da/privatliv/` med "Når nogen beder om de data, du allerede har"
  og samme otte rækker, og begge skal have den nye sætning i politik-skabelonen
  om at bede om en kopi eller en sletning.

- ✅ **DEPLOY OK 2026-09-27.** Alle tre notes nedenfor er verificeret mod
  **indhold**, ikke HTTP 200, kl. 19:1x: `https://bugbottle.dev/sitemap.xml`
  lister `/docs/nextjs/`, `/docs/angular/` og `/docs/nuxt/` med
  `lastmod 2026-09-27`, de tre sider viser hver deres nye kode
  (`error.digest` / `provideBrowserGlobalErrorListeners` / `enforce: "pre"` +
  `app:chunkError`), og `Integrations`-gruppen i live-sidebaren har tre sider.
  Deployeren kørte altså engang mellem 17:47 og 19:1x — ét kørselsvindue
  dækker alle tre merges, som noterne forudså.

- `VERIFICÉR DEPLOY: /compare/ + /da/sammenlign/ (den sjette række,
  `@sentry/react`) og CHANGELOG, ce1a6c0, merge 5eee1aa, 2026-09-27 ~20:10` —
  næste batch-vindue er 21:30 2026-09-27. Kan verificeres i **samme kørsel**
  som Astro-noten nedenfor. Verificér **indhold**:
  `https://bugbottle.dev/compare/` skal have seks rækker i tabellen, den
  sjette skal starte med `@sentry/react` og vise `33.2 kB` og `95.8 kB`, og
  `/da/sammenlign/` skal have den samme række med `33,2 kB` og `95,8 kB`.
  Tallet 29 251 063 skal stå i afsnittet under tabellen på begge sprog, og
  `/docs/changelog/` skal have begge de nye poster.

- `VERIFICÉR DEPLOY: /docs/astro/ (fjerde integrationsside, 37 sider i
  sitemap'en) 20ec0c6, merge a264630, 2026-09-27 ~19:35` — næste
  batch-vindue er 21:30 2026-09-27. Verificér **indhold**:
  `https://bugbottle.dev/sitemap.xml` skal liste
  `https://bugbottle.dev/docs/astro/` med `lastmod 2026-09-27`, siden skal vise
  Astro-guiden med `astro:hydration-error` og `handleHydrationError`,
  `Integrations`-gruppen i sidebaren skal have fire sider, og
  `/docs/recipes/` skal stadig have sit `### Astro`-afsnit.

- `VERIFICÉR DEPLOY: /docs/nextjs/ + Integrations-gruppen i sidebaren
  20867c0 2026-09-27 ~15:57` — første batch-vindue efter merge er 17:30
  2026-09-27. Verificér **indhold**, ikke HTTP 200: siden skal findes i
  `https://bugbottle.dev/sitemap.xml`, og `https://bugbottle.dev/docs/nextjs/`
  skal vise guiden med `error.tsx`-eksemplet og "Integrations" i sidebaren.
  Sidstmod for `/docs/nextjs/` skal være 2026-09-27.

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

- `VERIFICÉR DEPLOY: /docs/nestjs/ (45 sider i sitemap'en, ny integrationsside
  i `Integrations`; `npm run check` grøn, 889 tests, 209 søgeposter fra 202,
  28/9 02:5x)` — næste batch-vindue er 07:30 2026-09-28. Verificér **indhold**:
  `https://bugbottle.dev/sitemap.xml` skal liste `https://bugbottle.dev/docs/nestjs/`,
  siden skal vise NestJS-guiden med `getBodyParserOptions`-kodeblokken og
  `useBodyParser`-fixet, og `Integrations` i sidebaren skal have tolv sider.
