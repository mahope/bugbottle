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
- [ ] **7. CTR-måling — BLOCKED: kræver Search Console-eksport fra Mads**
  (28 dage, pr. side). Uden den kan vi ikke skrive en CTR-baseline pr. side, og
  så er §1–§2 umålelige. Billigste vækst, når tallene kommer. Står under ❓.
- [x] **8. `/docs/wordpress/` + link fra `/da/kom-i-gang/`.** 27/9,
  `ceo/wordpress-page`. Kilden er pluginnets *kode*, ikke dets readme:
  `class-settings.php` (indstillingsnavne + standarder), `class-assets.php`
  (mount-kaldet), `class-rest.php` (ruter + grænse), `readme.txt` (resten).
  Se "Fund fra WordPress-iterationen" — de tre fund, der ikke stod i planen.
  **MÅL: `/docs/wordpress/` baseline 0 besøgende (siden findes ikke) pr.
  2026-09-27.** Sammenlign 25/10 og 25/11. 38 docs-sider (fra 37).

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

## ❓ Til Mads

- **`mountBugbottle().open()` kan ikke forudfylde beskeden.** Panelets egen
  `openOnError: { prefill: true }` kan det, men kun for vinduesfejl, og kun
  fordi panelet selv ringer `openForError`. Ethvert andet kald — en
  framework-`ErrorHandler`, en `onShortcut`, `astro:hydration-error`, din egen
  knap — får et tomt felt, selv om den kender beskeden. Fastslået i `src/ui`
  (linje 218: `open(): void`), så det er ikke en forglemt mulighed.
  Fixet er lille (en valgfri `open({ prefill })`, ~40 bytes på `bugbottle/ui`),
  men det **rører et eksisterende eksports signatur**, så efter vores egne
  navneregler er det en minor, ikke en patch. Og det er ikke længere et
  hjørnesag: **alle fire frameworksider rammer det**, og Astro-siden rammes
  hårdest, fordi `componentUrl` + fejlteksten er hele pointen med at lytte på
  begivenheden. Bygge det, eller lade siderne pege på `bugbottle/triggers` og
  lægge fejlen i `extra` i stedet?
- **Fejl-siden-problemet er besvaret, så det behøver ikke en beslutning mere.**
  Alle fire sider løser det samme sted: en fejl-side er en separat side load
  uden layout, så panelet kan ikke være mountet, og integrationen er én knap.
  Siderne siger det eksplicit. Det eneste åbne spørgsmål er om knappen skal
  kunne forudfylde beskeden — altså punktet ovenfor.
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
- **Stripe.** Der er ingen `docs/stripe-kontrakt.md` i repoet og ingen
  `FUNDING.yml`, ingen `/support`-side. Vi sælger intet. Skal jeg foreslå
  betalte, licenskontrollerede open-core-tilføjelser under `❓`?

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
