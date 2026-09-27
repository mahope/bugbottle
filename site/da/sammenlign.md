bugbottle er en lille brik i et godt besat felt, og det er ikke den mest
avancerede brik. Siden her stiller biblioteket op ved siden af seks værktøjer,
folk rent faktisk bruger, så du på et minut kan se, om du har brug for et
bibliotek eller et produkt. Alle tal er tjekket den 7. september 2026 på den
side, der er linket til i hver række — undtagen rækken for `@sentry/react`,
der er tjekket den 27. september 2026; priser og funktioner flytter sig, så
følg linket, før du beslutter noget.

| Værktøj | Licens | Hostet eller dit eget endepunkt | Hvad det opsamler | Størrelse i din bundle | Pris |
|---|---|---|---|---|---|
| **bugbottle** | MIT, både klienten og serverhjælperne ([LICENSE](https://github.com/mahope/bugbottle/blob/main/LICENSE)) | Dit eget endepunkt. Der findes ingen bugbottle-server at sende til | Konsolfejl og advarsler, sidens kontekst, elementet brugeren peger på, klik og navigation som brødkrummer, fejlede og langsomme kald,  og et skærmbillede hvis du slår det til, som brugeren kan markere med rektangel, pil eller en destruktiv sløring ([dokumentation](/docs/)) | Cirka 1,4 kB gzippet for kernen, 5,5 kB for React-hooket, 12 kB for det færdige panel ([budgetterne i CI](https://github.com/mahope/bugbottle/blob/main/CONTRIBUTING.md)) | Gratis |
| **[Marker.io](https://marker.io)** | Kommerciel | Hostet. Rapporterne lander hos Marker.io og skubbes videre til dit issue-system | Skærmbillede med tegninger ovenpå, session replay, konsol- og netværkslog, browser og miljø ([om konsollogs](https://marker.io/blog/console-logs)) | Ikke oplyst | Fra 39 $/md.; konsol, netværk og replay følger først med på Team til 149 $/md. ([priser](https://marker.io/pricing)) |
| **[Jam](https://jam.dev)** | Kommerciel | Hostet. Et jam er et link på jam.dev | Skærmoptagelse, konsol, netværk, oplysninger om browser og maskine, og de handlinger der gik forud for fejlen ([jam.dev](https://jam.dev)) | Ingenting — det er en browserudvidelse, ikke et script i din app | Gratis niveau, derefter 14 $ pr. bruger pr. måned ([priser](https://jam.dev/pricing)) |
| **[Sentry User Feedback](https://docs.sentry.io/platforms/javascript/user-feedback/)** | SDK'et er MIT ([sentry-javascript](https://github.com/getsentry/sentry-javascript)) | Sentrys ingest. Brugerfladen må du gerne skifte ud, backenden ikke ([dokumentation](https://docs.sentry.io/platforms/javascript/user-feedback/)) | Beskeden plus skærmbillede og vedhæftninger, koblet på den fejl, den release, det trace og det replay Sentry allerede har ([dokumentation](https://docs.sentry.io/platforms/javascript/user-feedback/)) | Ikke oplyst som ét tal: widgetten ligger oven på browser-SDK'et, som fylder mest | Gratis udviklerplan, derefter fra 26 $/md. ([priser](https://sentry.io/pricing/)) |
| **[`@sentry/react`](https://www.npmjs.com/package/@sentry/react)** | MIT ([licens](https://github.com/getsentry/sentry-javascript/blob/main/LICENSE.md)) | Sentrys ingest. Selvhostet Sentry er et andet produkt og en anden regning | Hver uafhandlet fejl, hvert uafhandlet `Promise` og hvert konsolkald med brødkrummer, releasen og miljøet; `captureFeedback` hæfter en skrevet rapport på den fejl, den skete ved siden af ([dokumentation](https://docs.sentry.io/platforms/javascript/)) | **33,2 kB gzippet** for `init` alene, **95,8 kB** med `replayIntegration()` og `captureFeedback` i bundtet — 2,8 gange hele bugbottle-panelet og otte gange det ([målt](https://github.com/mahope/bugbottle/blob/main/scripts/measure-competitors.mjs)) | Gratis udviklerplan, derefter 26 $/md. for Team; **50 session replays pr. måned** på alle planer ([priser](https://sentry.io/pricing/)) |
| **[BugPin](https://github.com/aranticlabs/bugpin)** | AGPL-3.0 på serveren, MIT på widgetten ([repo](https://github.com/aranticlabs/bugpin)) | Selvhostet: sin egen tjeneste i Bun, Hono og SQLite — eller ingenting | Skærmbillede med tegninger, konsolfejl, netværkskald, sidens metadata og en offline-kø foran afsendelsen ([repo](https://github.com/aranticlabs/bugpin)) | Under 150 kB gzippet for widgetten, pakket i en shadow root ([repo](https://github.com/aranticlabs/bugpin)) | Gratis; du driver selv serveren |
| **[rrweb](https://github.com/rrweb-io/rrweb)** | MIT ([repo](https://github.com/rrweb-io/rrweb)) | Ingen af delene. Det er en optager uden backend og uden brugerflade | Hver eneste DOM-ændring og inputhændelse som en strøm, du kan afspille bagefter ([repo](https://github.com/rrweb-io/rrweb)) | Nogle titusinder af bytes for selve optageren, og hændelserne bliver ved med at komme, så længe du optager | Gratis |

## Hvad de andre kan, som bugbottle ikke kan

Marker.io og Jam giver en ikke-teknisk kollega noget, bugbottle ikke kan: hos
Jam en video af det, de gjorde, og hos dem begge et sted, rapporten lander, med
en kø, en ansvarlig og en historik. bugbottle kan nu selve tegningen — et
rektangel, en pil og en sløring oven på skærmbilledet — men den slutter
stadig ved den JSON, den sender til dit eget endepunkt. Det nærmeste, der
findes på et sted, rapporten lander, er
[`examples/inbox`](https://github.com/mahope/bugbottle/tree/main/examples/inbox):
en Node-server uden afhængigheder, som skriver hver rapport til disken og
viser en skrivebeskyttet liste bag én adgangskode. Det er et eksempel, du
kopierer og selv ejer — ikke en kø med ansvarlige og en historik — og det er
med vilje så langt, det her projekt går.

Ingen af dem kræver, at en udvikler installerer noget i applikationen — Jam er en
browserudvidelse og virker derfor også på et website, du ikke selv ejer, og på
den tredjepartsside, fejlen viste sig at ligge på.

Sentry User Feedback er svær at slå, hvis du i forvejen kører Sentry. Det er
det eneste værktøj i tabellen, der binder den sætning, brugeren skrev, sammen
med stacktracet, releasen og optagelsen fra samme øjeblik. bugbottle sender en
rapport; Sentry lægger rapporten ind i en sag, der allerede var åben.

SDK'en underneden er den, alle faktisk installerer: `@sentry/react` havde
29 251 063 downloads i ugen til 26. september 2026, og bugbottle havde 191 i
samme uge ([npms download-API](https://github.com/npm/download-counts), slået op
27. september 2026). Den sammenligning er ikke en pointscore — CI-kørsler og
transitive installationer blæser det store tal op, og én npm-pakke er ikke et
produkt — men den er det ærlige svar på det spørgsmål, den her side findes
for: hvad tager et JavaScript-hold fat i, når det vil have brugere til at
rapportere fejl. Og omkostningen ved det greb er dem, siden her er til for.
Den vejer 33,2 kB gzippet, før den har optaget noget som helst, hvilket er to
og en halv gang bugbottles hele panel, og 95,8 kB når session replay og
`captureFeedback` er med i bundtet — otte gange panelet, sendt til nogens
ingest, faktureret pr. hændelse, og med 50 session replays pr. måned inkluderet
på alle planer også den gratis. Betaler du allerede for Sentry, er intet af
det et argument: du har købt de bytes og den kvote i forvejen, og et ekstra
sted at lægge rapporter ved siden af det, du læser hver morgen, er et sted,
ingen læser. Gør du ikke, er det prisen på at finde ud af, om det er værd det.

BugPin giver dig det dashboard og den triagering, bugbottle med vilje ikke har
med, og du kan stadig køre det på dit eget jern. Og rrweb optager langt mere,
end bugbottle nogensinde kommer til: det er optageren under flere af
produkterne ovenfor, og skal du kunne se minuttet før fejlen, er der ikke
noget her, der erstatter det.

## Hvornår du skal vælge noget andet

Vælg Jam eller Marker.io, hvis dem der melder fejl ikke er udviklere, og det
der får dem videre er et sted, rapporten lander — en kø, en ejer, en status —
frem for en rute i din egen applikation. Vælg Sentry, SDK'en eller
produktet, hvis du allerede betaler for det, for et ekstra sted at kigge
efter rapporter er et sted, ingen får kigget. Vælg BugPin eller et andet
selvhostet produkt, hvis du vil have et dashboard og gerne vil drive en
tjeneste og en database. Vælg rrweb, hvis spørgsmålet er "hvad gjorde de, lige
inden det gik galt" snarere end "hvad er galt", og du har et sted at lægge
adskillige megabyte hændelser.

Vælg bugbottle, når du allerede har et API, en database og en indbakke, og det
eneste, der mangler, er de få kilobyte, der gør "der er noget galt" til en
JSON-rapport, du kan handle på: intet dashboard, ingen konto, ingen
leverandør der kan lukke eller sætte prisen op, og ingenting mellem browseren
og en rute, du selv har skrevet. Det er en smallere opgave end noget produkt
på denne side løser, og det er præcis hele opgaven for det her bibliotek.

## Resten af feltet

De seks her er dem, det giver mening at stille sig op ved siden af. Den
kortlægning fra september 2026, de kommer fra, dækker en snes mere — Userback,
BugHerd, Gleap, OpenReplay, Highlight.io, FasterFixes og de øvrige — med de
samme tal og de samme kilder. Den ligger i repoet som
[docs/research-alternatives.md](https://github.com/mahope/bugbottle/blob/main/docs/research-alternatives.md)
og er skrevet på engelsk.
