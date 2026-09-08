Der er tre veje fra ingenting til den første rapport, og de sender alle tre
den samme JSON til en rute, du selv ejer. Vælg den, der passer til det, du
allerede har: et script-tag på et websted uden byggetrin, pluginnet hvis det
er WordPress, eller pakken fra npm hvis du har en bundler og et framework.
Siden her er den korte danske vej igennem; den fulde dokumentation er på
engelsk og ligger under [/docs/](/docs/).

## Først: ruten, der tager imod

Uanset hvilken vej du vælger, ender rapporten det samme sted: en rute, du selv
har skrevet. Der findes ingen bugbottle-server at sende til, og det er med
vilje — dine rapporter rammer aldrig andres maskiner.

Kører du Node, Next.js, Hono, Bun, Deno eller Cloudflare Workers, gør
`handleReport` hele arbejdet: den tjekker hvert eneste felt, browseren har
sendt, og svarer med et `Response`.

```ts
import { handleReport } from "bugbottle/server";

export const POST = (req: Request) =>
  handleReport(req, {
    store: async (report) => await db.reports.insert(report),
  });
```

Ruten svarer `201 { id }`, når `store` gav et id tilbage, og `202 {}`, når den
ikke gjorde. Alt andet end `POST` får `405`. Du kan sende rapporten videre til
en indbakke, Slack, GitHub, GitLab, Jira, Linear eller Sentry med de færdige
`sinks` — se [Receiving a report](/docs/receiving-a-report/) og
[Sending it somewhere](/docs/sending-it-somewhere/).

Kører du noget andet end JavaScript på serveren, er rapporten bare et
JSON-legeme på et `POST`. Formen står i
[The payload](/docs/the-payload/), og der ligger et JSON-schema på
[/schema/report.json](/schema/report.json), du kan validere op imod. Tjek
længderne selv, og stol ikke på et eneste felt: alt i legemet kommer fra en
browser, du ikke bestemmer over.

Vil du hellere se det virke, før du skriver noget: eksemplet i
[examples/vanilla-js](https://github.com/mahope/bugbottle/tree/main/examples/vanilla-js)
er en Node-server og en almindelig HTML-formular uden byggetrin, og
[examples/inbox](https://github.com/mahope/bugbottle/tree/main/examples/inbox)
er den samme server med en skrivebeskyttet liste bag én adgangskode.

## Rute 1: ét script-tag

Til et websted uden byggetrin — et WordPress-tema, en statisk side, et
kundewebsted som en anden udruller. Filen monterer panelet ud fra sine egne
attributter, så der er ikke andet at skrive:

```html
<script
  src="https://cdn.jsdelivr.net/npm/bugbottle@0.9.0/dist/bugbottle.js"
  data-endpoint="/api/feedback"
  data-locale="da"
  data-primary="#e11d48"
  data-brand="Mahope"
></script>
```

`data-endpoint` er den eneste, der skal være der; uden den monterer
ingenting. `data-locale` er sproget — uden den følger panelet `<html lang>` og
falder tilbage på engelsk. Derudover findes blandt andre `data-position`,
`data-logo`, `data-trigger` (en CSS-selektor til din egen knap i stedet for
den flydende), `data-shortcut` (`mod+shift+b` som standard), `data-queue`
(gem rapporten, når forbindelsen er væk, og send den, når den er tilbage),
`data-network`, `data-scrub` og `data-extra`. Hele tabellen står i
[One script tag](/docs/one-script-tag/).

Pin altid en version. `@latest` er en måde at lade en fremmeds næste udgivelse
køre på din side. Og fordi et CDN er en tredjepart, der kører kode hos dig, er
det værd at låse filen med dens hash:

```html
<script
  src="https://cdn.jsdelivr.net/npm/bugbottle@0.9.0/dist/bugbottle.js"
  integrity="sha384-…"
  crossorigin="anonymous"
  data-endpoint="/api/feedback"
></script>
```

jsDelivr viser hashen på filens egen side, og hashen skifter med hver version,
så den skal opdateres sammen med den.

Der er to filer, og de er det samme panel: `dist/bugbottle.js` har det hele
med, mens `dist/bugbottle.slim.js` er den samme uden tegneværktøjet, uden
måletallene, uden ryst-for-at-rapportere og uden netværksloggen. Skriver du en
attribut, den slanke ikke kender, siger den det én gang på konsollen.

Der er ikke noget skærmbillede i den her vej som udgangspunkt. Et billede
kræver `html-to-image`, som fylder mere end resten af filen tilsammen, og det
skal en side, der bare vil have panelet, ikke hente. Vil du have billedet, kan
du hente det bibliotek selv og kalde `window.bugbottle.mount({ endpoint,
screenshot })` — se [One script tag](/docs/one-script-tag/).

## Rute 2: WordPress

Er det WordPress, er der et plugin, og så skal du hverken skrive en rute eller
et script-tag. Panelet og den rute, der tager imod, følges ad i én aktivering,
og rapporterne lander som en privat indholdstype i wp-admin.

1. Gå til **Plugins → Tilføj nyt** i wp-admin, søg efter »Bugbottle«,
   installér og aktivér. Eller hent `bugbottle.zip` fra den
   [seneste udgivelse på GitHub](https://github.com/mahope/bugbottle-wordpress/releases/latest)
   og læg den op under **Plugins → Tilføj nyt → Upload plugin**.
2. Gå til **Bug reports → Settings**, og sæt som minimum en modtager under
   **Email recipient** — ellers ligger rapporterne kun i wp-admin.

Pluginnet kræver WordPress 6.4 og PHP 8.1, og indstillingerne er dem, du ville
have skrevet i hånden ad de to andre veje: **Language** (`auto` følger sidens
sprog), **Primary colour**, **Position**, **Brand name** og **Logo URL**,
**Trigger selector** til din egen knap, **Keyboard shortcut**
(`mod+shift+b` som standard) og **Only for logged-in users**.

Fire af dem er værd at standse ved:

- **Screenshots** er slået fra, indtil du selv slår den til. Læs afsnittet om
  skærmbilleder længere nede, før du gør det.
- **Contact field** er også slået fra. Spørger du nogen om deres adresse, har
  du lovet dem et svar, og det løfte er sidens at give.
- **Timings and storage snapshot** noterer, hvad siden kostede, og hvilke
  nøgler der ligger i `localStorage` og `sessionStorage` — navnene og
  længderne, aldrig værdierne, og aldrig en cookieværdi overhovedet. Slået fra
  som udgangspunkt.
- **Accept reports from visitors who are not logged in** giver anonyme
  rapporter, med en grænse på ti i timen pr. IP-adresse. Også slået fra.

Ruten hedder `POST /wp-json/bugbottle/v1/report` og tager det almindelige
JSON-legeme, så din egen formular kan sende til den, selv hvis du slår panelet
fra. Vil du hænge noget på, er der to filtre, `bugbottle_show_panel` og
`bugbottle_panel_config`, og handlingen `bugbottle_report_stored`, når en
rapport er gemt. Det hele står i
[pluginnets README](https://github.com/mahope/bugbottle-wordpress) — v0.5.0 er
den nyeste, og den har det samme panel med som biblioteket her.

## Rute 3: med en bundler

Har du et byggetrin, installerer du pakken og bygger formularen i dit eget
framework. Det er hele pointen med biblioteket: det ejer tilstanden, det
opsamlede og afsendelsen — ikke dit markup.

```bash
npm install bugbottle
npm install html-to-image   # kun hvis du vil have skærmbilleder
```

Begynd at optage konsollen så tidligt, din applikation kan klare det. Det, der
sker inden, er ikke i bufferen:

```ts
import { initConsoleBuffer } from "bugbottle";

initConsoleBuffer();
```

Vil du ikke bygge en formular, monterer `bugbottle/ui` et færdigt panel i en
shadow root, så din CSS og dens CSS aldrig mødes:

```ts
import { initConsoleBuffer } from "bugbottle";
import { mountBugbottle } from "bugbottle/ui";
import { htmlToImage } from "bugbottle/html-to-image"; // valgfri
import { da } from "bugbottle/locales";

initConsoleBuffer();

const widget = mountBugbottle({
  endpoint: "/api/feedback",
  screenshot: htmlToImage,
  locale: da,
  brand: { name: "Mahope", logo: "/logo.svg" },
  theme: { primary: "#e11d48", radius: "8px", position: "bottom-left" },
});
```

Vil du hellere selv tegne formularen, er der et hook til hvert framework —
`useBugReport` fra `bugbottle/react` og `bugbottle/vue`, `createBugReport` fra
`bugbottle/svelte` og `bugbottle/solid`. Det er den samme tilstandsmaskine
med fire bindinger over sig:

```tsx
import { useBugReport } from "bugbottle/react";
import { htmlToImage } from "bugbottle/html-to-image"; // valgfri

function ReportForm() {
  const report = useBugReport({
    endpoint: "/api/feedback",
    screenshot: htmlToImage, // udelad den for at slå skærmbilleder fra
  });

  return (
    <form data-bugbottle onSubmit={(e) => { e.preventDefault(); void report.submit(); }}>
      <textarea
        value={report.message}
        onChange={(e) => report.setMessage(e.target.value)}
      />
      <p role="status">{report.statusMessage}</p>
      <button disabled={report.isSending}>Send</button>
    </form>
  );
}
```

Kald `report.open()`, når formularen dukker op, så skærmbilledet viser det, de
kiggede på, og ikke din egen formular oven på det. Alt, der er mærket
`data-bugbottle`, holdes uden for billedet og kan ikke peges på — sæt
attributten på dit panel og på din knap.

De øvrige tilvalg er de samme i alle fire: `initialType`, `screenshotFor` og
`consoleFor` (hvilke rapporttyper der får et billede og konsollen — kun fejl
som udgangspunkt), `extra` (felter, der lægges ind i hver rapport, for
eksempel en version eller et kunde-id), `headers` og `credentials`, `timeoutMs`,
`onSent`, `parseError` og `messages` til oversatte statuslinjer. Standarden er
engelsk, så sæt `messages: da.messages` fra `bugbottle/locales`, hvis
formularen skal svare på dansk.

Hele formularen med typer, elementvælger og skærmbillede står i
[The form (React)](/docs/the-form-react/) og i de tre tilsvarende afsnit for
[Vue](/docs/the-form-vue/), [Svelte](/docs/the-form-svelte/) og
[Solid](/docs/the-form-solid/).

## Skærmbilleder: læs det her, før du slår dem til

Et skærmbillede af din side indeholder alt det, den der melder fejlen kunne
se. I et journalsystem kan det være et billede af en patient; i et lønsystem
en løn; hos dig måske en andens indbakke eller en halvskrevet besked, der
aldrig blev sendt.

Derfor er skærmbilleder slået fra, indtil du selv slår dem til — hverken
script-tagget eller pluginnet tager et billede, du ikke har bedt om. Slår du
dem til, følger der tre ting med, som biblioteket ikke kan gøre for dig:

1. **Læg dem et privat sted.** Har dit fillager offentlig læseadgang — og det
   har mange steder, billeder ligger — kan alle med adressen hente det, du
   lægger i det. Brug et andet lager, der ikke er offentligt.
2. **Servér dem tilbage gennem en rute, der kræver login.** Giv aldrig et
   skærmbillede en offentlig adresse, og slå filnavnet op ud fra rækken i
   stedet for at tage det fra forespørgslen, så et id ikke kan bruges til at gå
   på opdagelse i lageret.
3. **Sig det, før billedet bliver taget.** Skriv det ved siden af afkrydsningen
   i formularen — ikke i en persondatapolitik, som ingen åbner.

Det, der er skrevet i felterne, bliver skjult, inden billedet tages: hvert
`input`, hvert `textarea` og alt `contenteditable` bliver til prikker i et
enkelt gennemløb og sat tilbage igen, så billedet viser en udfyldt formular af
den rigtige form uden værdierne. Alt andet, der ikke må være med, mærker du
selv med `data-bugbottle-mask` (teksten prikkes ud) eller
`data-bugbottle-block` (feltet dækkes helt). Andet skjules ikke: et navn i en
overskrift er et navn på billedet.

Selve konteksten er den milde del til sammenligning. Det er sidens sti og
forespørgselsstreng, vinduets størrelse, browserstrengen og — når browseren
har et svar — sproget, tidszonen, skærmstørrelsen, farveskemaet, om browseren
troede den var online, og forbindelsestypen. Hverken adressens domæne eller
dens fragment sendes med, og der samles ikke andet ind end den liste:
ingen canvas, ingen skrifttyper, ingen enhedsoptælling, ingen form for
identifikator. `console.log` og `console.debug` optages heller ikke, og det er
med vilje — det er dér, tilfældige brugerdata plejer at ende.

Hele afsnittet, med maskering og de indbyggede regler for at fjerne følsomme
værdier, står i [Please read this part](/docs/please-read-this-part/).

## Hvor du går videre

Dokumentationen er på engelsk og starter på [/docs/](/docs/). De afsnit, der
oftest er det næste, man mangler:

- [Recording console errors](/docs/recording-console-errors/) — hvad der bliver
  optaget, og hvad der med vilje ikke gør.
- [Pointing at the element](/docs/pointing-at-the-element/) — elementvælgeren
  og den selektor, den skriver.
- [What happened before](/docs/what-happened-before/) og
  [What the network did](/docs/what-the-network-did/) — brødkrummerne og de
  kald, der fejlede eller var langsomme.
- [When the network is down](/docs/when-the-network-is-down/) — køen, der
  gemmer en rapport, browseren ikke kunne sende.
- [Opening it without a button](/docs/opening-it-without-a-button/) —
  tastaturgenvejen og panelet, der åbner sig selv på en fejl.
- [Languages and branding](/docs/languages-and-branding/) — de otte sprog, de
  fem importerede og hvordan du skriver dine egne strenge.
- [Recipes](/docs/recipes/) — den færdige rute til Next.js, SvelteKit, Nuxt,
  Astro, React Router og Hono.
- [API](/docs/api/) — hele den eksporterede overflade på én side.

Er du stadig ved at vælge, ligger [Sammenlignet med](/da/sammenlign/) fem
værktøjer op ad hinanden på dansk. Og går noget galt, er
[et issue på GitHub](https://github.com/mahope/bugbottle/issues) det rigtige
sted — også hvis det er den her side, der er utydelig.
