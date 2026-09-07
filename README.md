# bugbottle

[![npm](https://img.shields.io/npm/v/bugbottle)](https://www.npmjs.com/package/bugbottle)
[![CI](https://github.com/mahope/bugbottle/actions/workflows/ci.yml/badge.svg)](https://github.com/mahope/bugbottle/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/licence-MIT-blue)](./LICENSE)

[bugbottle.dev](https://bugbottle.dev) — the page, with a live demo of the panel ([in Danish](https://bugbottle.dev/da/)).

Headless in-app bug reports that arrive with the evidence attached.
Your UI, your endpoint, a few kilobytes.

Error trackers catch what throws. They cannot catch what merely looks wrong,
and they never tell you what the person was doing when it did. *"The save
button does nothing"* is not a report anyone can act on.

bugbottle collects the context at the moment someone notices — the page, the
viewport, the recent console errors, the element they point at, optionally a
picture of what they were looking at — and POSTs it as JSON to a route you
already own.

```bash
npm install bugbottle
npm install html-to-image   # optional, only if you want screenshots
```

Without npm, install the tagged release straight from GitHub, or import the
built files from the jsDelivr CDN — `dist/` is committed for exactly that:

```bash
npm install github:mahope/bugbottle#v0.4.0
```

```js
import { initConsoleBuffer, buildReport, sendReport } from "https://cdn.jsdelivr.net/gh/mahope/bugbottle@v0.4.0/dist/index.js";
```

- **Headless.** You render the form. The chrome around a feedback widget is
  exactly the part that differs between applications, so this owns the state,
  the capture and the submit — not your markup.
- **Bring your own backend.** There is no dashboard and no hosted service to
  sign up for. A report is a JSON body on a `fetch`; the receiving end is a
  route handler you write, with the validation helpers shipped alongside.
- **Nothing in your bundle you did not ask for.** Zero dependencies. The core
  is about 0.9 kB gzipped; with the element picker and the React hook, 4.5 kB;
  the optional ready-made panel, 7.4 kB; breadcrumbs 1.3 kB; the everything
  script tag, 12.2 kB. `html-to-image` is only pulled in by the module that
  imports it, and the scrubber only by the code that calls it.
- **Sends itself onward.** Email through Resend, a Slack, Discord or plain
  webhook, or a GitHub issue — server-side helpers over one Markdown
  rendering, keys never in the browser.
- **Your language, your brand.** Eight bundled locales, every string
  overridable, and a panel themed with a handful of CSS variables.
- **Server helpers included.** Every field a browser sends is checked before it
  reaches your database, because that is where the sharp edges are.

### What it is not

Not a dashboard, not session replay, not a hosted service. If you want
annotated issues filed in Jira by a vendor, look at Marker.io or Jam. If you
want to record everything a user does, look at rrweb. bugbottle is the smallest
thing that turns *"it's broken"* into a reproducible payload, and stays out of
the way otherwise. The optional panel in `bugbottle/ui` is a convenience over
the same core, not the product.

## Recording console errors

Call this once, from client-side code, as early as your app can manage.
Anything that happens before it is not in the buffer.

```ts
import { initConsoleBuffer } from "bugbottle";

initConsoleBuffer();
```

Only `error` and `warn` are recorded, along with uncaught errors and unhandled
promise rejections. `log` and `debug` are deliberately left alone: they are
noisy, and in most applications they are where stray user data ends up. The
original console functions are always called through, so nothing disappears
from your devtools.

In a server-rendered app, make sure this runs in the browser only — it patches
whichever `console` it finds.

## The form (React)

```tsx
import { useBugReport } from "bugbottle/react";
import { htmlToImage } from "bugbottle/html-to-image"; // optional

function ReportForm() {
  const report = useBugReport({
    endpoint: "/api/feedback",
    screenshot: htmlToImage, // leave out to disable screenshots
  });

  return (
    <form data-bugbottle onSubmit={(e) => { e.preventDefault(); void report.submit(); }}>
      {report.types.map((t) => (
        <button key={t} type="button" onClick={() => report.setType(t)}>
          {t}
        </button>
      ))}

      <textarea
        value={report.message}
        onChange={(e) => report.setMessage(e.target.value)}
      />

      {report.canScreenshot && (
        <label>
          <input
            type="checkbox"
            checked={report.includeScreenshot}
            onChange={(e) => report.toggleScreenshot(e.target.checked)}
          />
          Attach a picture of this page
        </label>
      )}

      {report.screenshot && <img src={report.screenshot} alt="" />}

      <button type="button" onClick={() => void report.pickElement()}>
        {report.isPicking ? "Click anything to attach it — Esc to stop" : "Point at the element"}
      </button>
      <ul>
        {report.elements.map((el, i) => (
          <li key={i}>
            <code>{el.selector}</code> {el.text}
            <button type="button" onClick={() => report.removeElement(i)}>×</button>
          </li>
        ))}
      </ul>

      <p role="status">{report.statusMessage}</p>
      <button disabled={report.isSending}>Send</button>
    </form>
  );
}
```

Call `report.open()` when the form appears, so the screenshot shows what they
were looking at rather than the form on top of it. Anything marked
`data-bugbottle` is left out of the picture and cannot be picked — put it on
your panel and your trigger button.

Other options: `initialType`, `screenshotFor` and `consoleFor` (which report
types get a picture and the console; bugs only by default), `extra` (fields
merged into the body — an app version, a tenant id), `headers` and
`credentials` (for an authenticated or cross-origin endpoint), `timeoutMs`,
`onSent`, `parseError`, and `messages` for translated strings. The defaults are English.

## The form (anything else)

The hook is a thin layer over three functions that work anywhere:

```ts
import { captureScreenshot, pickElement, buildReport, sendReport } from "bugbottle";
import { htmlToImage } from "bugbottle/html-to-image";

const screenshot = await captureScreenshot(htmlToImage); // PNG data URL
const element = await pickElement();                     // null if they pressed Escape
const report = buildReport({
  type: "bug",
  message,
  screenshotDataUrl: screenshot,
  elements: element ? [element] : [],
});
const { id } = await sendReport("/api/feedback", report);
```

`sendReport` resolves on a 2xx, throws `SendFailedError` (with `status` and
the parsed body) on anything else, gives up with `SendTimeoutError` after
15 seconds (`timeoutMs`), and lets network errors through untouched.
`captureScreenshot` estimates from the capture area whether a full-scale render
would be larger than a server would accept, and starts at half scale when it
would — rendering is expensive, so a page that was never going to fit should
not be rendered twice. It still retries at half scale if the estimate was
wrong, and throws `ScreenshotTooLargeError` if that is too big as well. Treat
either as "send without the picture". Pass `pixelRatio` to skip the estimate
and force a scale, `bytesPerPixelEstimate` to tune it for pages that compress
unusually well or badly, and `onCapture` to see what each capture cost:

```ts
await captureScreenshot(htmlToImage, {
  onCapture: ({ pixelRatio, length, attempts, ms }) => {
    console.info(`screenshot: ${length} chars at ${pixelRatio}x, ${attempts} render(s), ${ms}ms`);
  },
});
```

## The ready-made panel

If you would rather not build a form, `bugbottle/ui` mounts a floating button
and a small dialog in a shadow root, so your CSS and its CSS never meet:

```ts
import { initConsoleBuffer } from "bugbottle";
import { mountBugbottle } from "bugbottle/ui";
import { htmlToImage } from "bugbottle/html-to-image"; // optional
import { da } from "bugbottle/locales";

initConsoleBuffer();

const widget = mountBugbottle({
  endpoint: "/api/feedback",
  screenshot: htmlToImage,
  locale: da,
  brand: { name: "Mahope", logo: "/logo.svg" },
  theme: { primary: "#e11d48", radius: "8px", position: "bottom-left" },
  extra: { appVersion: "1.4.2" },
});

// widget.open(), widget.close(), widget.setLocale(en), widget.destroy()
```

It offers the three report types, a message, the screenshot checkbox (only
when a renderer is given), the element picker, and a thank-you state. Pass
`trigger: "#my-feedback-button"` to use your own button instead of the
floating one, or `trigger: false` and call `open()` yourself. About 6 kB
gzipped, no framework.

## One script tag

For a site with no build step — a WordPress theme, a static page, a client
site somebody else deploys — `dist/bugbottle.js` is a self-contained bundle
that mounts the panel from the tag itself. About 12 kB gzipped:

```html
<script
  src="https://cdn.jsdelivr.net/npm/bugbottle@0.4.0/dist/bugbottle.js"
  data-endpoint="/api/feedback"
  data-locale="da"
  data-primary="#e11d48"
  data-brand="Mahope"
></script>
```

`dist/` is committed, so the same file is on jsDelivr from the git tag as well:
`https://cdn.jsdelivr.net/gh/mahope/bugbottle@v0.4.0/dist/bugbottle.js`. Pin a
version in either form; `@latest` is a way to have a stranger's next release
run on your page.

| Attribute | Effect |
|---|---|
| `data-endpoint` | Where the report is POSTed. **Required** — without it nothing mounts. |
| `data-locale` | Language tag through `resolveLocale`. Defaults to `<html lang>`, then English. |
| `data-position` | `bottom-right` (default), `bottom-left`, `top-right`, `top-left`. |
| `data-primary` | Accent colour of the button and the primary action. |
| `data-brand` | Name in the panel header. |
| `data-logo` | Image URL shown before the title and on the trigger. |
| `data-trigger` | Selector for your own button. Without it, the floating one is rendered. |
| `data-scrub` | Present, with any value, redacts the report with `scrubReport` before it is sent. |
| `data-extra` | JSON object merged into every report, e.g. `data-extra='{"appVersion":"1.4.2"}'`. |
| `data-mask="off"` | Stops masking the screenshot. Only matters once you give `mount` a renderer; see [Masking](#masking). |

The tag also patches the console immediately and starts breadcrumbs, so an
error thrown before the page finishes loading is still in the report.

There is no screenshot in this build. A renderer means `html-to-image`, which
is far larger than everything else here put together, and forcing it on every
page that only wants the panel is the wrong trade. The bundle exposes the
building blocks on `window.bugbottle` — `mount` (`mountBugbottle`),
`initConsoleBuffer`, `initBreadcrumbs`, `locales`, `resolveLocale`,
`scrubReport`, `buildReport`, `sendReport`, `pickElement` and `version` — so a
page that wants pictures can load `html-to-image` itself and call
`window.bugbottle.mount({ endpoint, screenshot })`. Leave `data-endpoint` off
the tag and nothing mounts on its own:

```html
<script src="https://cdn.jsdelivr.net/npm/bugbottle@0.4.0/dist/bugbottle.js"></script>
<script>
  window.bugbottle.initConsoleBuffer();
  window.bugbottle.mount({
    endpoint: "/api/feedback",
    locale: window.bugbottle.locales.da,
    scrub: window.bugbottle.scrubReport,
  });
</script>
```

**Subresource integrity.** A CDN is a third party executing code on your
site. Pin the file with its hash so a swapped file cannot run:

```html
<script
  src="https://cdn.jsdelivr.net/npm/bugbottle@0.4.0/dist/bugbottle.js"
  integrity="sha384-…"
  crossorigin="anonymous"
  data-endpoint="/api/feedback"
></script>
```

jsDelivr shows the hash on the file's page, or compute it yourself:
`curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`. The hash
changes with every version, so it has to be updated with the version.

## Languages and branding

Every string a reporter sees lives in a `Locale`: five status `messages` and
the widget's `ui` labels. `bugbottle/locales` ships English, Danish, Swedish,
Norwegian, German, Dutch, French and Spanish, and `resolveLocale(navigator.language)`
picks one. Override any label, or write a locale of your own — the type tells
you what is required:

```ts
import { da, resolveLocale } from "bugbottle/locales";

useBugReport({ endpoint, messages: da.messages });

mountBugbottle({
  endpoint,
  locale: resolveLocale(navigator.language),
  texts: { title: "Hjælp os med at gøre det bedre", trigger: "Fejl?" },
  messages: { sent: "Tak — vi kigger på det i morgen tidlig" },
});
```

The panel's look comes from `theme` — `primary`, `onPrimary`, `background`,
`text`, `muted`, `border`, `radius`, `font`, `shadow`, `zIndex`, `position`,
and `scheme` (`"light"`, `"dark"` or `"auto"`) — and from `brand` (`name`,
`logo` as an image URL or inline SVG). The same values are CSS custom
properties on the host element (`--bb-primary`, `--bb-radius`, …), so a
stylesheet can restyle it without touching JavaScript:

```css
[data-bugbottle="ui"] { --bb-primary: #0f766e; --bb-font: "Inter", sans-serif; }
```

## Pointing at the element

Most reports are about one thing on the page. `pickElement()` turns the cursor
into a crosshair, highlights whatever is under it, and resolves with a
description of the element the reporter clicks: a short CSS selector, the tag,
the visible text, the position on the page, and the useful attributes (`id`,
`name`, `role`, `aria-label`, `href`, every `data-*`). Escape cancels. The click
is swallowed, so picking a button does not also press it.

```jsonc
{
  "selector": "form#checkout > button:nth-of-type(2)",
  "tag": "button",
  "text": "Save order",
  "rect": { "x": 912, "y": 640, "width": 118, "height": 36 },
  "attributes": { "type": "submit", "data-testid": "save-order" }
}
```

The selector prefers an `id` or a `data-testid` on the element or an ancestor,
then falls back to `tag:nth-of-type` steps, at most five deep. It is meant to
be read by a person or an agent, and to land on the right file — not to be a
stable locator for a test suite.

## What happened before

`bugbottle/breadcrumbs` records the last few things the reporter did, so the
report says what was happening when it broke — not only what broke. It is a
separate entry point: an application that does not import it does not carry it.

```ts
import { initBreadcrumbs } from "bugbottle/breadcrumbs";

initBreadcrumbs();
```

Four things are recorded and nothing else: clicks (a short selector and the
element's visible text), navigation (path and query, including `pushState` and
`replaceState`, which fire no event of their own), form submits (the selector
only) and visibility changes. The last 30 are kept.

```jsonc
[
  { "ts": "2026-09-07T08:12:29.100Z", "kind": "click", "target": "button#save-order", "text": "Save order" },
  { "ts": "2026-09-07T08:12:30.400Z", "kind": "navigation", "from": "/orders/1", "to": "/orders/2?tab=notes" },
  { "ts": "2026-09-07T08:12:31.000Z", "kind": "submit", "target": "form#checkout" },
  { "ts": "2026-09-07T08:12:34.700Z", "kind": "visibility", "to": "hidden" }
]
```

`buildReport` attaches them on its own while the buffer is recording, as
`breadcrumbs`; pass `includeBreadcrumbs: false` to leave them out of one
report. `toMarkdown` renders them as a "What happened before" list.

Deliberately absent: input values, keystrokes, and anything read out of a
field. A breadcrumb says *where* someone clicked, never *what they typed*. On
top of that, three controls are yours:

```ts
initBreadcrumbs({
  maxEntries: 30,
  beforeBreadcrumb: (crumb) =>
    crumb.to?.startsWith("/admin") ? null : { ...crumb, to: crumb.to?.replace(/\/\d+/, "/:id") },
});
```

- `beforeBreadcrumb` sees every breadcrumb before it is stored. Return null to
  drop it, or a changed one to redact it.
- Anything inside `[data-bugbottle]` is skipped entirely — that is the
  library's own furniture, including the panel from `bugbottle/ui`.
- Anything inside `[data-bugbottle-mask]` records its selector and no text, so
  a name, an address or an amount on a card never travels with the click.

`getBreadcrumbs()` returns a copy of the timeline, and `resetBreadcrumbs()`
empties it, removes the listeners and puts `history` back as it found it.

## Feeding reports to an agent

A report with a selector, the element's text, the page path and the last few
console errors is usually enough context for a coding agent to find the code
and propose a fix without a conversation. A pattern that works well: store
reports as they arrive, and have a scheduled agent session each morning pull
yesterday's, group them by application, and present them for a yes / no / how
decision — then let it carry on from the ones approved. The reporter never
had to describe where the button was; the payload already says.

`toMarkdown` from `bugbottle/server` renders a report for exactly that — or
for a GitHub issue, a Slack message, an email:

```ts
import { toMarkdown } from "bugbottle/server";

const body = toMarkdown(payload, {
  facts: { App: "checkout 1.4.2", User: user.id },
  screenshotUrl: await storeScreenshot(screenshot), // your private route
});
```

~~~markdown
## Bug: The save button does nothing

The save button does nothing

| | |
|---|---|
| Type | Bug |
| Page | `/orders/42?tab=notes` |
| Viewport | 1440x900 |
| Browser | Mozilla/5.0 … |
| Last console entry | 2026-09-07T08:12:31.004Z |
| App | checkout 1.4.2 |

### Element pointed at

- `form#checkout > button:nth-of-type(2)` — "Save order" (type="submit") at 912,640 118×36

<details><summary>Console (1 entry)</summary>

```text
2026-09-07T08:12:31.004Z [error] TypeError: x is not a function
```

</details>
~~~

## Screenshots

`captureScreenshot` takes a *renderer* rather than importing one. A bundler
resolves every import it can see, optional or not, so a built-in import of
`html-to-image` would make it a hard dependency for every application —
including the ones that never take a picture.

`bugbottle/html-to-image` is the ready-made renderer. Any function with the
same shape works in its place:

```ts
type ScreenshotRenderer = (
  root: HTMLElement,
  options: { filter: (node: Node) => boolean; pixelRatio: number },
) => Promise<string>; // PNG data URL
```

The capture renders from the DOM, not from the screen, so it can only ever
show the page the reporter is on — never another tab, another window, or the
desktop behind it. That is a deliberate limit rather than a missing feature.

What the reporter typed is hidden before the picture is taken; see
[Masking](#masking).

## Receiving a report

```ts
import {
  decodeScreenshotDataUrl,
  InvalidScreenshotError,
  isReportType,
  normaliseConsole,
  normaliseContext,
  normaliseElements,
  normaliseMessage,
} from "bugbottle/server";

export async function POST(req: Request) {
  const user = await getUser();           // your auth
  if (!user) return new Response(null, { status: 401 });

  const payload = await req.json();
  const message = normaliseMessage(payload.message);
  if (!message) return Response.json({ error: "Write a message first" }, { status: 400 });

  const type = isReportType(payload.type) ? payload.type : "other";
  const context = normaliseContext(payload.context);
  const console = normaliseConsole(payload.console);
  const elements = normaliseElements(payload.elements);

  let screenshot: Uint8Array | null = null;
  try {
    if (payload.screenshotDataUrl) {
      screenshot = decodeScreenshotDataUrl(payload.screenshotDataUrl);
    }
  } catch (err) {
    // A rejected picture must not fail the report — the message is the
    // valuable part.
    if (!(err instanceof InvalidScreenshotError)) throw err;
  }

  const { id } = await save({ userId: user.id, type, message, context, console, elements, screenshot });
  return Response.json({ id }, { status: 201 });
}
```

This works unchanged in a Next.js route handler, Hono, Cloudflare Workers,
Bun, Deno, or anything else built on the web `Request`. For Express, read
`req.body` instead.

The helpers never trust the browser. `normaliseMessage` and `normaliseContext`
trim, clip and strip null bytes (which Postgres refuses). `normaliseConsole`
drops anything that is not a well-formed entry and keeps the most recent 50;
`normaliseElements` does the same for pointed-at elements, keeping at most 10.
`decodeScreenshotDataUrl` checks the declared type, the real PNG signature in
the decoded bytes, and a size ceiling — so a JPEG wearing a PNG label, a login
page returned as HTML, or a 40 MB payload never reaches your storage.

If your response has an `id` field, the client hands it to `onSent`. If a
failed response has an `error` or `message` field, it is shown to the reporter.

## Sending it somewhere

Storing the report is one thing; seeing it is another. Three sinks live in
`bugbottle/server`, each a formatter over one `fetch` call, none with a
dependency of its own. None of them reads your environment: the key, the URL
and the token are arguments, so it is visible at the call site where the secret
came from — and so nothing can drift into a browser bundle.

`sendReportEmail` posts to Resend. It renders the report with `toMarkdown`,
attaches the decoded screenshot as `screenshot.png` when you pass the bytes,
and returns the message id:

```ts
import { decodeScreenshotDataUrl, sendReportEmail } from "bugbottle/server";
import { da } from "bugbottle/locales";

export async function POST(req: Request) {
  const payload = await req.json();
  // …validate as above, then store what you keep…

  await sendReportEmail(payload, {
    apiKey: process.env.RESEND_API_KEY!,   // your configuration, not the library's
    from: "bugs@example.com",
    to: "team@example.com",
    screenshot: screenshot ?? undefined,   // from decodeScreenshotDataUrl
    locale: da,                            // subject and intro in Danish
  });

  return Response.json({ id }, { status: 201 });
}
```

The subject comes from the report's title and the locale, unless you pass
`subject` yourself. The body is the Markdown, with a minimal HTML version
beside it.

`sendReportWebhook` posts to anything with a URL. `json` sends the report as it
arrived plus a `markdown` field, which is what Make, n8n and your own intake
endpoint want; `slack` sends `{ text }` and `discord` sends `{ content }`,
clipped to the 2000 characters Discord accepts:

```ts
import { sendReportWebhook } from "bugbottle/server";

await sendReportWebhook(payload, { url: process.env.SLACK_WEBHOOK_URL!, format: "slack" });
await sendReportWebhook(payload, { url: process.env.DISCORD_WEBHOOK_URL!, format: "discord" });
await sendReportWebhook(payload, {
  url: process.env.INTAKE_URL!,
  headers: { "X-Token": process.env.INTAKE_TOKEN! },
});
```

`createGithubIssue` files the report as an issue, which for a small team is
the whole backend: the report lands in the same list as everything else that is
broken, with the same labels and the same search. A fine-grained token with
issues write on the one repository is enough:

```ts
import { createGithubIssue } from "bugbottle/server";

const { number, url } = await createGithubIssue(payload, {
  token: process.env.GITHUB_TOKEN!,
  owner: "acme",
  repo: "app",
  labels: ["bug", "from-bugbottle"],
  screenshotUrl,                         // where you stored the picture
});
```

The title is the report's type and its first line — `Bug: The save button does
nothing` — unless you pass `title` yourself, and the body is the Markdown.

The GitHub API cannot take an attachment: pictures in an issue body are
uploads made by the web editor, and there is no public endpoint for that. So
the screenshot has to be stored by you first, and `screenshotUrl` links to it
from the body. Anyone who can read the issue then follows that link, which
means the storage decision below is the one that matters — a link out of an
issue is only as private as the address it points at.

All three throw `SinkError`, carrying the HTTP status and the response body,
when the service answers with anything but success. Catch it around the sink
rather than around the whole handler: a report you have already stored should
not be lost to a chat webhook that was revoked last week.

## Please read this part

A screenshot of your application contains whatever the reporter could see. In a
clinical system that can mean a patient photograph; in a payroll tool, a salary;
in yours, perhaps somebody's inbox or a half-written message they had not sent
yet.

Three things follow, and the library cannot do them for you:

1. **Put screenshots somewhere private.** If your object storage bucket has a
   public read policy — many media buckets do — anything you write to it can be
   fetched by anyone holding the URL. Use a separate bucket with no public
   policy.
2. **Serve them back through an authenticated route.** Never give a screenshot
   a public URL. Look the storage key up from the row rather than taking it from
   the request, so an id cannot be used to walk your bucket.
3. **Say so before the picture is taken.** Put it in the form, next to the
   checkbox — not in a policy nobody opens.

Requiring people to be signed in is worth considering too. An anonymous
screenshot is one nobody can be asked about later, and nobody can be told has
been deleted.

### Masking

Screenshots are masked before they are taken. Every `input` and `textarea`
value becomes bullets of the same length, placeholders are cleared, and
`contenteditable` text is bulleted too — so a picture of a checkout or an
intake form shows a filled-in form of the right shape without carrying the card
number or the diagnosis. Two attributes, borrowed from rrweb so a team that
already annotated its templates does not annotate them twice:

```html
<p data-bugbottle-mask>Ada Lovelace, born 1815</p>   <!-- text -> bullets -->
<div data-bugbottle-block><canvas id="revenue"></canvas></div>  <!-- covered -->
```

`data-bugbottle-mask` bullets the text of the element and everything inside it.
`data-bugbottle-block` covers the element with a solid rectangle of its exact
size, for a region whose shape says as much as its text: a chart, a photograph,
an avatar. The colour is the element's `--bb-mask` custom property, or `#999`.

The element stays where it is either way, so the layout of the screenshot is
unchanged. That is the difference from `exclude`, which removes the node and
takes the layout with it.

It is on by default and restored the moment the renderer returns, including
when it throws. Narrow it or switch it off per capture:

```ts
captureScreenshot(htmlToImage, {
  mask: { inputs: true, selector: "[data-private]", block: false },
});
captureScreenshot(htmlToImage, { mask: false });   // the page as it is
```

`useBugReport({ mask })` and `mountBugbottle({ mask })` pass the same option
through, and the script tag switches it off with `data-mask="off"`.

Masking is not encryption and it is not a substitute for the three points
above: it hides the fields it knows about, and a value your application paints
into a `div` is only hidden if you mark it. Buttons, checkboxes and the other
inputs that hold no typed text are left readable on purpose, because a
screenshot of a form with every label blacked out helps nobody.

### Scrubbing

The text of a report is written in a hurry, and it arrives carrying whatever was
on the clipboard: the failing request, the token somebody was debugging with, a
customer's email address. The page URL brings its own `?token=`. `scrubReport`
walks a report and replaces those with `[redacted]`.

```ts
import { buildReport, sendReport, scrubReport } from "bugbottle";

const report = buildReport({ type: "bug", message, scrub: scrubReport });
await sendReport("/api/feedback", report);
```

The same function works in the route handler, which is the safer place to put it
— it also covers reports from an older client:

```ts
import { scrubReport } from "bugbottle/server";

const clean = scrubReport(await request.json());
```

On by default: email addresses, `Bearer <token>`, JWTs (`eyJ…`), 13 to 19 digit
card numbers that pass the Luhn check, IBANs, and query values whose key matches
`/token|key|secret|password|auth/i`. They are applied to `message`,
`console[].message`, `context.url`, `elements[].text`, an element's `href` and
`data-*` attributes, and `breadcrumbs` if you add them. The pixels of the
screenshot are a separate job, done by the masking below.

An order number of 16 digits is kept, because it fails Luhn. Prose that happens
to say `key=value` is kept, because the query pattern only runs on URLs.

`scrubReport(report, options)` takes `patterns` (extra global regexes, redacted
whole), `keep` (built-ins to switch off by name) and `replacement`:

```ts
scrubReport(report, {
  patterns: [/\bACME-\d+\b/g],
  keep: ["email"],          // "email" | "bearer" | "jwt" | "card" | "iban" | "query"
  replacement: "[redacted]",
});
```

The scrubber is its own module and nothing else imports it, so a bundle that
does not use it does not carry it. Pattern matching is not a guarantee: it
catches the shapes it knows, and the reporter can still type something no regex
recognises. Treat it as one layer, not as the reason it is safe to store the
report anywhere.

### `beforeSend`

The last look at a report before it leaves the browser. Return it, return a
changed copy, or return `null` to drop it — nothing is requested, and
`sendReport` resolves `{ dropped: true, body: null, response: null }`. The name
and the contract are Sentry's.

```ts
useBugReport({
  endpoint: "/api/feedback",
  scrub: scrubReport,
  beforeSend: (report) => {
    if (report.message.includes("password")) return null;   // dropped silently
    return { ...report, tenant: currentTenant };
  },
});
```

The reporter sees the ordinary thank-you either way. They wrote the report in
good faith, and a message telling them it was discarded helps nobody. If you
want to know, count it yourself inside the hook.

## The payload

What arrives at your endpoint, with `extra` fields merged in at the top level:

```jsonc
{
  "type": "bug",                       // "bug" | "idea" | "other"
  "message": "The save button does nothing",
  "context": {
    "url": "/orders/42?tab=notes",     // path and query; no origin, no fragment
    "viewport": "1440x900",
    "userAgent": "Mozilla/5.0 …"
  },
  "console": [                         // bugs only by default, newest last
    { "ts": "2026-09-07T08:12:31.004Z", "level": "error", "message": "TypeError: …" }
  ],
  "elements": [                        // only when the reporter pointed at something
    { "selector": "form#checkout > button:nth-of-type(2)", "tag": "button", "text": "Save order",
      "rect": { "x": 912, "y": 640, "width": 118, "height": 36 }, "attributes": { "type": "submit" } }
  ],
  "breadcrumbs": [                     // only while bugbottle/breadcrumbs is recording
    { "ts": "2026-09-07T08:12:30.400Z", "kind": "navigation", "from": "/orders/1", "to": "/orders/2" }
  ],
  "screenshotDataUrl": "data:image/png;base64,…"   // only when attached
}
```

## API

**`bugbottle`** — `initConsoleBuffer`, `getConsoleBuffer`, `resetConsoleBuffer`,
`captureScreenshot` (with `CaptureInfo`, `DEFAULT_BYTES_PER_PIXEL_ESTIMATE` and
the `MaskOptions` of its `mask` option, whose defaults are
`DEFAULT_MASK_SELECTOR`, `DEFAULT_BLOCK_SELECTOR` and `DEFAULT_MASK_COLOUR`),
`collectContext`, `pickElement`, `describeElement`, `buildSelector`,
`buildReport`, `sendReport`, `scrubReport`, `BUILTIN_SCRUBBERS`,
`ScreenshotTooLargeError`, `SendFailedError`, `SendTimeoutError`, the server
validators below, and the shared types and limits.

**`dist/bugbottle.js`** — the script-tag build: `window.bugbottle` with
`mount`, `initConsoleBuffer`, `initBreadcrumbs`, `locales`, `resolveLocale`,
`scrubReport`, `buildReport`, `sendReport`, `pickElement`, `version`, and
`data-*` auto-mount. See "One script tag".

**WordPress** — the plugin at
[github.com/mahope/bugbottle-wordpress](https://github.com/mahope/bugbottle-wordpress)
bundles this build, adds the receiving endpoint, stores reports as a private
post type with an admin list, and emails them if you want. One activation.

**`bugbottle/breadcrumbs`** — `initBreadcrumbs`, `getBreadcrumbs`,
`resetBreadcrumbs`, `isBreadcrumbsActive`, and the `BreadcrumbsOptions` type.

**`bugbottle/react`** — `useBugReport`.

**`bugbottle/html-to-image`** — `htmlToImage`, a `ScreenshotRenderer`.
Requires `html-to-image`.

**`bugbottle/ui`** — `mountBugbottle`, and the `MountOptions`, `Theme`,
`Brand` and `BugbottleWidget` types.

**`bugbottle/locales`** — `en`, `da`, `sv`, `nb`, `de`, `nl`, `fr`, `es`,
`locales`, `resolveLocale`, and the `Locale`, `Messages`, `UiTexts`,
`EmailTexts` types.

**`bugbottle/server`** — `decodeScreenshotDataUrl`, `normaliseMessage`,
`normaliseContext`, `normaliseConsole`, `normaliseElements`,
`normaliseBreadcrumbs`, `isReportType`, `toMarkdown`, `scrubReport`,
`sendReportEmail`, `sendReportWebhook`, `createGithubIssue`,
`InvalidScreenshotError`, `SinkError`, `REPORT_TYPES` and the `MAX_*` limits.

Ships as ESM with TypeScript declarations. Node 18+ on the server; any
evergreen browser on the client.

## Licence

MIT

## A working example

`examples/vanilla-js` is a complete round trip with no build step: a Node
http server that receives and validates a report using `bugbottle/server`,
and a plain HTML form that captures a screenshot and posts it.

```bash
cd examples/vanilla-js
npm install
node server.mjs
```

Open http://localhost:8787, write a message, send, and watch the server print
the validated report.

## GitHub Action

Validate bug reports collected by the widget inside CI — useful when your
endpoint exports reports as JSON files (e.g. into a repository or artifact)
and you want malformed ones caught before they reach your issue tracker.

```yaml
- uses: mahope/bugbottle@v0
  with:
    reports-glob: "reports/*.json"     # required
    require-screenshot: false          # fail reports without a screenshot
    max-report-size-kb: 4096           # reject oversized report files
```

Outputs `valid-count` and `invalid-count`. The job fails if any report is
malformed or no files match. Zero dependencies — installs in about a second.

## Who makes it

Mads Holst Jensen, a freelance web and AI developer in Denmark. bugbottle came
out of client projects where "the save button does nothing" arrived by email
with nothing attached. [mahoje.dk](https://mahoje.dk) · mads@mahope.dk
