# bugbottle

In-app bug reports that arrive with the evidence attached.

Error trackers catch what throws. They cannot catch what merely looks wrong,
and they never tell you what the person was doing when it did. *"The save
button does nothing"* is not a report anyone can act on.

bugbottle collects the context at the moment someone notices: the page, the
viewport, the recent console errors, and optionally a picture of what they were
looking at.

```bash
npm install bugbottle
npm install html-to-image   # optional, only if you want screenshots
```

- **Headless.** You render the form. The chrome around a feedback widget is
  exactly the part that differs between applications, so this owns the state,
  the capture and the submit — not your markup.
- **No dependencies.** `html-to-image` and `react` are optional peers, and
  `html-to-image` is loaded on demand, so it stays out of your bundle until
  somebody actually reports something.
- **Server helpers included.** The validation you need on the receiving end
  ships with it, because that is where the sharp edges are.

## Recording console errors

Call this once, as early as your app can manage. Anything that happens before
it is not in the buffer.

```ts
import { initConsoleBuffer } from "bugbottle";

initConsoleBuffer();
```

Only `error` and `warn` are recorded. `log` and `debug` are deliberately left
alone: they are noisy, and in most applications they are where stray user data
ends up. The original console functions are always called through, so nothing
disappears from your devtools.

## The form

```tsx
import { useBugReport } from "bugbottle/react";

function ReportForm() {
  const report = useBugReport({ endpoint: "/api/feedback" });

  return (
    <form onSubmit={(e) => { e.preventDefault(); void report.submit(); }}>
      {report.types.map((t) => (
        <button key={t} type="button" onClick={() => report.setType(t)}>
          {t}
        </button>
      ))}

      <textarea
        value={report.message}
        onChange={(e) => report.setMessage(e.target.value)}
      />

      <label>
        <input
          type="checkbox"
          checked={report.includeScreenshot}
          onChange={(e) => report.toggleScreenshot(e.target.checked)}
        />
        Attach a picture of this page
      </label>

      {report.screenshot && <img src={report.screenshot} alt="" />}

      <p role="status">{report.statusMessage}</p>
      <button disabled={report.isSending}>Send</button>
    </form>
  );
}
```

Call `report.open()` when the form appears, so the screenshot shows what they
were looking at rather than the form on top of it. Anything marked
`data-bugbottle` is left out of the picture — put it on your panel and your
trigger button.

Pass your own translated strings through `messages`; the defaults are English.

## Receiving a report

```ts
import {
  decodeScreenshotDataUrl,
  InvalidScreenshotError,
  isReportType,
  normaliseMessage,
  normaliseContext,
} from "bugbottle/server";

export async function POST(req: Request) {
  const user = await getUser();           // your auth
  if (!user) return new Response(null, { status: 401 });

  const payload = await req.json();
  const message = normaliseMessage(payload.message);
  if (!message) return new Response("Write a message first", { status: 400 });

  const type = isReportType(payload.type) ? payload.type : "other";
  const context = normaliseContext(payload.context);

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

  await save({ type, message, context, console: payload.console, screenshot });
  return Response.json({ ok: true }, { status: 201 });
}
```

`decodeScreenshotDataUrl` checks the declared type, the real PNG signature in
the decoded bytes, and a size ceiling — so a JPEG wearing a PNG label, a login
page returned as HTML, or a 40 MB payload never reaches your storage.

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

[`examples/receiving-endpoint`](examples/receiving-endpoint) is a complete,
runnable version of the above: auth, validation, upload to a private
S3-compatible bucket with a guard against public-policy buckets, and an
authenticated route that streams the picture back.

The capture renders from the DOM, not from the screen, so it can only ever show
the page the reporter is on — never another tab, another window, or the desktop
behind it. That is a deliberate limit rather than a missing feature.

## Bundle size

The widget's size is a feature, so it's checked in CI (`npm run size`,
`scripts/check-bundle-size.mjs`). There's no bundler step here — `dist/`
ships the ESM files tsc emits — so "the bundle" means `dist/index.js` plus
everything it statically imports: currently `console-buffer.js`,
`capture.js` and `report-core.js`, **~10.2 KB** total, against a 16 KB
budget. The check also fails if `html-to-image` ever becomes a static
import — it must stay the dynamic `import()` in `capture.ts`, which is the
whole reason it stays out of a consumer's bundle until someone actually
takes a screenshot.

## API

**`bugbottle`** — `initConsoleBuffer`, `getConsoleBuffer`, `resetConsoleBuffer`,
`captureScreenshot`, `collectContext`, and the shared types and limits.

**`bugbottle/react`** — `useBugReport`.

**`bugbottle/server`** — `decodeScreenshotDataUrl`, `normaliseMessage`,
`normaliseContext`, `isReportType`, `InvalidScreenshotError`.

## Licence

MIT
