Sætter du bugbottle på et websted i EU, skal du kunne svare på tre spørgsmål,
før nogen spørger: hvad bliver der indsamlet, hvor havner det, og hvor længe
bliver det liggende. Siden her svarer felt for felt, og hvert svar står i koden
og ikke bare i et løfte. Det er ikke juridisk rådgivning; det er den
opgørelse, en jurist ville have brug for for at kunne give dig noget.

Det andet spørgsmål har det korteste svar, så det kommer først: **en rapport
bliver sendt til den rute, du selv har skrevet, og ingen andre steder hen.** Der
findes ingen bugbottle-server, ingen konto og ingen nøgle at oprette. Biblioteket
laver ét `fetch` til en adresse, du selv ejer, og derfra havner rapporten præcis
dér, hvor din `store` og dine `sinks` lægger den: din database, din mappe, dit
Slack, dit issue-system. Ingenting i pakken taler med en server, du ikke selv
har peget på.

Den engelske udgave af siden her er
[A privacy checklist](/docs/privacy-checklist/).

## Hvad en rapport kan indeholde

Hver række herunder er et felt på øverste niveau i den JSON, der bliver sendt —
formen står i [The payload](/docs/the-payload/). "Slået til som udgangspunkt"
betyder: med panelet eller hooket monteret og uden at du har sat andet op.
Kontakterne i kolonnen "Afbryderen" er dem, der holder feltet ude af rapporten
fra begyndelsen; [scrubberen](/docs/please-read-this-part/#scrubbing) og
serverens egne indstillinger kommer bagefter og er kun nævnt, hvor de er den
vigtigste knap.

| Felt | Slået til som udgangspunkt | Kan indeholde personoplysninger | Afbryderen | Hvor det havner |
|---|---|---|---|---|
| `type` | Altid | Nej — enten `bug`, `idea` eller `other` | Ingen; det er brugerens valg mellem tre ord | Din rute, og overskriften i hver sink |
| `message` | Altid | **Ja** — brugeren skriver frit og indsætter fra udklipsholderen | Ingen: det *er* rapporten. `scrubReport` slører de mønstre, den kender, og `beforeSend` kan kassere hele rapporten | Din rute, og derefter din `store` og dine sinks |
| `contact` | Nej — slået fra i hooket, panelet og script-tagget, indtil du beder om det | **Ja**, per definition: du har spurgt, hvordan man får fat i et menneske | Lad `contact` stå tom, og lad `data-contact` blive væk fra tagget. `scrubReport(report, { contact: true })` slører hele linjen | Din rute; Resend-sinken bruger den som svaradresse, hvis den ligner en mailadresse |
| `context` | Altid | Nogle gange — sti og forespørgselsstreng fra siden, så feltet er personhenførbart præcis når dine egne adresser er det (`/patienter/1234`) | Ingen for selve objektet. `query`-scrubberen slører værdier under `token`, `key`, `secret`, `password` og `auth`, og domænet og fragmentet bliver aldrig samlet op | Din rute, og derefter din `store` og dine sinks |
| `console` | Kun mens `initConsoleBuffer()` optager — script-tagget starter den for dig | **Ja** — en fejlbesked indeholder det, der blev sat ind i den. `console.log` og `console.debug` bliver aldrig optaget, og det er netop dér, løse værdier plejer at ende | Lad være med at kalde `initConsoleBuffer()`; `includeConsole: false` holder det ude af én rapport | Din rute, og derefter din `store` og dine sinks |
| `elements` | Nej — først når brugeren peger på noget | **Ja** — selektoren, elementets synlige tekst og dets `data-*`-attributter | `elementPicker: false` på panelet; intet vedhæfter et element af sig selv | Din rute, og derefter din `store` og dine sinks |
| `screenshotDataUrl` | Nej — først når du selv giver den en renderer. Med en er den slået til for fejlrapporter, og brugeren kan fjerne fluebenet | **Ja**, mere end noget andet her bortset fra en optagelse: det er det, der stod på skærmen. Feltværdier bliver [maskeret](/docs/please-read-this-part/#masking) først | Ingen renderer; `screenshotFor`; brugerens eget flueben; `handleReport({ screenshot: "drop" })` på serveren | Din rute; `fileStore` afkoder billedet ved siden af JSON'en som `<id>.png`. Læs [Please read this part](/docs/please-read-this-part/), før du gemmer det nogen steder |
| `breadcrumbs` | Kun mens `initBreadcrumbs()` optager — script-tagget starter den | **Ja** — et klik bærer elementets tekst med sig, et sideskift bærer stien | Lad være med at kalde `initBreadcrumbs()`; `includeBreadcrumbs: false` for én rapport | Din rute, og derefter din `store` og dine sinks |
| `network` | Nej — `initNetwork()` eller `data-network` på script-tagget | **Ja** — metode, adresse, statuskode og varighed. Aldrig et indhold og aldrig et header-felt, men en adresse kan bære et id eller et token; `scrubUrl` kører hen over den | Lad den blive slået fra; `includeNetwork: false` for én rapport | Din rute, og derefter din `store` og dine sinks |
| `perf` | Nej — `initPerf()` eller `data-perf` | Nej — LCP, INP, CLS, TTFB og to indlæsningstider, alt sammen tal | Lad den blive slået fra; `includePerf: false` for én rapport | Din rute, og derefter din `store` og dine sinks |
| `storage` | Nej — samme afbryder som `perf` | Kun hvis du beder om det: nøglenavne og værdilængder, og *navnene* på cookies. En værdi kommer kun med for en nøgle, du har skrevet i `allowValues`, og en cookieværdi kommer aldrig med uanset indstilling | Lad `initPerf` være slået fra, eller lad `allowValues` stå tom; `includePerf: false` dækker begge dele | Din rute, og derefter din `store` og dine sinks |
| `replay` | Nej — `attachRrweb(record)` med din egen rrweb | **Ja**, og mere end noget andet: det er en film af et menneske, der bruger dit program | Lad være med at kalde `attachRrweb`; rrwebs egen maskering, som adapteren sætter til `maskAllInputs: true`; `includeReplay: false`; `handleReport({ replay: "drop" })` på serveren | Din rute og din `store`. Ingen sink sender en optagelse videre nogen steder |
| `notes` | Når der er en | Nej — bibliotekets egen bemærkning om rapporten, for eksempel at køen ikke kunne gemme et skærmbillede | Ingen | Din rute, og derefter din `store` og dine sinks |

Det, du selv lægger på med `extra`, står ikke i tabellen, for det er kun dig,
der ved, hvad der er i det. Det bliver lagt ind på øverste niveau i den samme
JSON og rejser med på samme måde.

## Hvor længe det bliver liggende

bugbottle gemmer ingenting. I browseren lever en rapport i hukommelsen, indtil
den er sendt; [køen](/docs/when-the-network-is-down/) beholder en mislykket
rapport i `localStorage`, til den kommer af sted, og sletter den, når den gør.
Efter afsendelsen er opbevaringen modtagerens ansvar, og modtageren er dig. Der
findes ingen maksimal alder nogen steder i pakken og ingen oprydning, der kører
af sig selv.

`fileStore` har et loft, men det er et diskloft og ikke en politik: `maxReports`
(2000 som standard) sletter de ældste filer, når mappen bliver for stor, og `0`
beholder det hele. Alder indgår ikke. Er dit svar "slet efter 90 dage", så skriv
det — `reports.list()` giver dig `receivedAt` for hver rapport, og
`reports.remove(id)` sletter både JSON-filen og billedet. En `store` mod en
database er det samme stykke arbejde med et `DELETE`.

To beslutninger hører til i samme omgang. Hvor længe et skærmbillede skal leve,
er værd at svare på for sig: billedet er den del, der ældes dårligst, og det
koster ikke meget at slette det tidligt. Og en rapport, der allerede er sendt
videre til Slack eller til et issue-system, er blevet kopieret — sletter du din
egen række, forsvinder kopien ikke, og fra det øjeblik en sink har sendt den af
sted, lever den efter det systems regler og ikke efter dine.

## Ingen cookies, ingen fingeraftryk, ingen tredjepart

- **Ingen cookies.** Biblioteket sætter ingen og læser ingen. Det eneste sted,
  en cookie overhovedet bliver rørt, er `initPerf`, som lister *navnene* på
  cookies, så du kan se, hvad siden bar rundt på; en cookieværdi kommer aldrig
  med, uanset indstilling.
- **Ingen fingeraftryk.** Konteksten er sidens sti og forespørgselsstreng,
  vinduets størrelse, browserens user agent og — når browseren tilbyder dem —
  sproget, tidszonen, skærmens størrelse og pixelforhold, lys eller mørk
  visning, om browseren troede, den var på nettet, og forbindelsens type. Det er
  hele listen. Intet canvas, ingen skrifttyper, ingen liste over enheder, ingen
  form for identifikator, og der bliver ikke gemt noget nogen steder, som kan
  genkende den samme browser to gange.
- **Ingen tredjepart.** Pakken har ingen afhængigheder, når den kører, og
  klienten laver ét kald: det `POST` til din egen rute. `html-to-image` og
  `rrweb` er valgfri, du rækker dem selv ind, og de kører inde på din side.
  Dine sinks kører på din server og taler med de tjenester, du har sat op, med
  de nøgler du selv har givet dem som argumenter — aldrig hentet ud af miljøet
  bag din ryg.

Webstedet [bugbottle.dev](https://bugbottle.dev) lover det samme om sig selv, og
her er løftet håndhævet i stedet for påstået. `site/security-headers.conf`
lægger den her linje på hvert eneste svar:

```
Content-Security-Policy: default-src 'self'; img-src 'self' data:;
  style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none';
  base-uri 'self'; form-action 'self'
```

`default-src 'self'` betyder, at intet script, ingen stilart, ingen skrifttype,
intet billede og ingen forbindelse må komme andre steder fra end den server:
sidens to skrifttyper ligger på den selv, der er ingen statistik at blokere, og
browseren afviser det første kald, der ville bryde løftet. De to direktiver, der
er bredere, hører til demopanelet og ikke til siden — `data:`-billeder, fordi et
skærmbillede ankommer som en data-adresse, og indlejret stil, fordi panelet
lægger sin stilart ind i en shadow root. Det er webstedets politik og ikke
bibliotekets: din egen applikation skriver sin egen, og bugbottle har ikke brug
for andet i den end en `connect-src`, der tillader din rute.

## Hvad du kan skrive i din privatlivspolitik

Tilpas det her, og streg så de sætninger, der handler om de felter, du har ladet
være slået fra:

> **Fejlrapporter.** Når du melder en fejl i [Applikation], modtager vi den
> besked, du skriver, og — hvis du udfylder feltet — den måde, du beder os om at
> kontakte dig på. Sammen med den modtager vi tekniske oplysninger om den side,
> du stod på: adressen inde i [Applikation], størrelsen på dit vindue, din
> browsers user agent og de fejlbeskeder, siden allerede havde noteret. Vedhæfter
> du et skærmbillede, modtager vi et billede af siden, som du så den, hvor
> indholdet af formularfelter er skjult. Vi bruger det udelukkende til at finde
> og rette den fejl, du har meldt. Det bliver gemt på vores egne systemer, [bliver
> delt med [issue-system], som vi bruger til at holde styr på rettelser,] og
> bliver slettet efter [90] dage.

Tre vaner er mere værd end selve afsnittet. Sig det dér, hvor brugeren står,
lige ved knappen, og ikke kun i en politik, ingen åbner. Beskriv det, du har
slået til, og ikke det, biblioteket kan. Og når svaret ændrer sig — at slå
skærmbilleder eller optagelser til er en ændring af svaret — så ret afsnittet i
samme release.

Vil du have det hele på engelsk, med resten af dokumentationen omkring sig,
ligger den samme side som [A privacy checklist](/docs/privacy-checklist/). Er du
lige begyndt, er [Kom i gang](/da/kom-i-gang/) den korte danske vej fra
ingenting til den første rapport.
