# bugbottle

[![npm](https://img.shields.io/npm/v/bugbottle)](https://www.npmjs.com/package/bugbottle)
[![CI](https://github.com/mahope/bugbottle/actions/workflows/ci.yml/badge.svg)](https://github.com/mahope/bugbottle/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/licence-MIT-blue)](./LICENSE)

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
npm install github:mahope/bugbottle#v0.3.0
```

```js
import { initConsoleBuffer, buildReport, sendReport } from "https://cdn.jsdelivr.net/gh/mahope/bugbottle@v0.3.0/dist/index.js";
```

- **Headless.** You render the form. The chrome around a feedback widget is
  exactly the part that differs between applications, so this owns the state,
  the capture and the submit — not your markup.
- **Bring your own backend.** There is no dashboard and no hosted service to
  sign up for. A report is a JSON body on a `fetch`; the receiving end is a
  route handler you write, with the validation helpers shipped alongside.
- **Nothing in your bundle you did not ask for.** Zero dependencies. The core
  is about 0.6 kB gzipped; with the element picker and the React hook, 3.4 kB;
  the optional ready-made panel, 6 kB. `html-to-image` is only pulled in by
  the module that imports it.
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
`captureScreenshot` retries at half scale when the first render is larger than
a server would accept, and throws `ScreenshotTooLargeError` if that is still
too big. Treat either as "send without the picture".

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

## Feeding reports to an agent

A report with a selector, the element's text, the page path and the last few
console errors is usually enough context for a coding agent to find the code
and propose a fix without a conversation. A pattern that works well: store
reports as they arrive, and have a scheduled agent session each morning pull
yesterday's, group them by application, and present them for a yes / no / how
decision — then let it carry on from the ones approved. The reporter never
had to describe where the button was; the payload already says.

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
  "screenshotDataUrl": "data:image/png;base64,…"   // only when attached
}
```

## API

**`bugbottle`** — `initConsoleBuffer`, `getConsoleBuffer`, `resetConsoleBuffer`,
`captureScreenshot`, `collectContext`, `pickElement`, `describeElement`,
`buildSelector`, `buildReport`, `sendReport`, `ScreenshotTooLargeError`,
`SendFailedError`, the server validators below, and the shared types and limits.

**`bugbottle/react`** — `useBugReport`.

**`bugbottle/html-to-image`** — `htmlToImage`, a `ScreenshotRenderer`.
Requires `html-to-image`.

**`bugbottle/ui`** — `mountBugbottle`, and the `MountOptions`, `Theme`,
`Brand` and `BugbottleWidget` types.

**`bugbottle/locales`** — `en`, `da`, `sv`, `nb`, `de`, `nl`, `fr`, `es`,
`locales`, `resolveLocale`, and the `Locale`, `Messages`, `UiTexts` types.

**`bugbottle/server`** — `decodeScreenshotDataUrl`, `normaliseMessage`,
`normaliseContext`, `normaliseConsole`, `normaliseElements`, `isReportType`,
`InvalidScreenshotError`, `REPORT_TYPES` and the `MAX_*` limits.

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
