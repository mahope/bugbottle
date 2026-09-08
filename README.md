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
npm install github:mahope/bugbottle#v0.12.0
```

```js
import { initConsoleBuffer, buildReport, sendReport } from "https://cdn.jsdelivr.net/gh/mahope/bugbottle@v0.12.0/dist/index.js";
```

- **Headless, in your framework.** You render the form — with the React hook,
  the Vue composable, the Svelte store, the Solid accessors, or the three plain
  functions underneath them. The chrome around a feedback widget is exactly the part
  that differs between applications, so this owns the state, the capture and
  the submit — not your markup.
- **Bring your own backend.** There is no dashboard and no hosted service to
  sign up for. A report is a JSON body on a `fetch`; the receiving end is a
  route handler you write, with the validation helpers shipped alongside.
- **Nothing in your bundle you did not ask for.** Zero dependencies. The core
  is about 1.5 kB gzipped; with the element picker and the React, Vue, Svelte
  or Solid adapter, 5.7 kB; the optional ready-made panel, 11.5 kB; the picture
  annotator 1.4 kB on top of it, and only for the applications that ask for it;
  breadcrumbs 1.3 kB; the network log
  1.2 kB; the timings and storage snapshot 1.2 kB; the offline queue 1.3 kB;
  shake-to-report 0.6 kB;
  the everything script tag, 24.2 kB, and the slim one 20.6 kB. `html-to-image` is only pulled in by the module that
  imports it, the annotator only by the panel you handed it to, and the
  scrubber only by the code that calls it.
- **Sends itself onward.** Email through Resend, a Slack, Discord or plain
  webhook, an issue in GitHub, GitLab, Jira or Linear, or an event in Sentry —
  eleven server-side sinks over one Markdown rendering, keys never in the
  browser.
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

An uncaught error or a rejection also carries its stack, normalised to at most
ten frames of `{ file, line, col, fn? }` — V8, Firefox and Safari all write it
differently, and one small parser reads all three. A frame is a position and
nothing else: no line of source is ever read or sent, so resolving it stays
your side, with your own source maps. Entries from `console.error` carry no
frames; the browser gives none.

In a server-rendered app, make sure this runs in the browser only — it patches
whichever `console` it finds.

Every recorder in the package returns its own stop, so a hot-reloaded module or
a test can undo what it started without importing a second name:

```ts
const stop = initConsoleBuffer();
stop(); // the real console back, the buffer empty
```

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

Every adapter also carries `contact` and `setContact`, for a form that asks
how to reach the reporter — an ordinary input bound the way `message` is:

```tsx
<input
  type="email"
  value={report.contact}
  onChange={(e) => report.setContact(e.target.value)}
/>
```

Nothing validates it, and an empty one is left out of the body entirely, so a
form without such a field sends no `contact` key at all. In Vue it is a
writable ref (`v-model="contact"`), in Svelte `$form.contact` with
`form.setContact(…)`, in Solid the accessor `contact()`. It is personal data
once you ask for it: see [Please read this part](#please-read-this-part).

Other options: `initialType`, `screenshotFor` and `consoleFor` (which report
types get a picture and the console; bugs only by default), `extra` (fields
merged into the body — an app version, a tenant id), `headers` and
`credentials` (for an authenticated or cross-origin endpoint), `timeoutMs`,
`onSent`, `parseError`, and `messages` for translated strings. The defaults are English.

## The form (Vue)

The same state machine, as refs. `type` and `message` are writable, so
`v-model` works on them directly.

```vue
<script setup lang="ts">
import { useBugReport } from "bugbottle/vue";
import { htmlToImage } from "bugbottle/html-to-image"; // optional

const report = useBugReport({
  endpoint: "/api/feedback",
  screenshot: htmlToImage, // leave out to disable screenshots
});
</script>

<template>
  <form data-bugbottle @submit.prevent="report.submit()">
    <button v-for="t in report.types" :key="t" type="button" @click="report.setType(t)">
      {{ t }}
    </button>

    <textarea v-model="report.message" />

    <label v-if="report.canScreenshot">
      <input
        type="checkbox"
        :checked="report.includeScreenshot"
        @change="report.toggleScreenshot(($event.target as HTMLInputElement).checked)"
      />
      Attach a picture of this page
    </label>
    <img v-if="report.screenshot" :src="report.screenshot" alt="" />

    <button type="button" @click="report.pickElement()">
      {{ report.isPicking ? "Click anything to attach it — Esc to stop" : "Point at the element" }}
    </button>
    <ul>
      <li v-for="(el, i) in report.elements" :key="i">
        <code>{{ el.selector }}</code> {{ el.text }}
        <button type="button" @click="report.removeElement(i)">×</button>
      </li>
    </ul>

    <p role="status">{{ report.statusMessage }}</p>
    <button :disabled="report.isSending">Send</button>
  </form>
</template>
```

Call `report.open()` when the form appears. The subscription is torn down with
the effect scope the composable was called in — the component, normally; call
`report.destroy()` yourself if you called it outside one. `vue` is an optional
peer dependency, so nothing about it reaches a project that does not use it.

## The form (Svelte)

The same state machine, as a readable store: `$form` for the values, the
methods on `form` for everything the reporter does.

```svelte
<script lang="ts">
  import { createBugReport } from "bugbottle/svelte";
  import { htmlToImage } from "bugbottle/html-to-image"; // optional
  import { onDestroy, onMount } from "svelte";

  const form = createBugReport({
    endpoint: "/api/feedback",
    screenshot: htmlToImage, // leave out to disable screenshots
  });

  onMount(() => form.open());
  onDestroy(() => form.destroy());
</script>

<form data-bugbottle on:submit|preventDefault={() => form.submit()}>
  {#each $form.types as t}
    <button type="button" on:click={() => form.setType(t)}>{t}</button>
  {/each}

  <textarea value={$form.message} on:input={(e) => form.setMessage(e.currentTarget.value)} />

  {#if $form.canScreenshot}
    <label>
      <input
        type="checkbox"
        checked={$form.includeScreenshot}
        on:change={(e) => form.toggleScreenshot(e.currentTarget.checked)}
      />
      Attach a picture of this page
    </label>
  {/if}
  {#if $form.screenshot}<img src={$form.screenshot} alt="" />{/if}

  <button type="button" on:click={() => form.pickElement()}>
    {$form.isPicking ? "Click anything to attach it — Esc to stop" : "Point at the element"}
  </button>
  <ul>
    {#each $form.elements as el, i}
      <li><code>{el.selector}</code> {el.text}
        <button type="button" on:click={() => form.removeElement(i)}>×</button>
      </li>
    {/each}
  </ul>

  <p role="status">{$form.statusMessage}</p>
  <button disabled={$form.isSending}>Send</button>
</form>
```

`svelte` is an optional peer dependency, and only its `Readable` type is used:
the store contract is one function, implemented here, so the adapter adds no
runtime dependency at all.

## The form (Solid)

The same state machine, as accessors: every value is a function, so the JSX
tracks exactly what it reads.

```tsx
import { createBugReport } from "bugbottle/solid";
import { htmlToImage } from "bugbottle/html-to-image"; // optional
import { For, Show, onMount } from "solid-js";

function FeedbackForm() {
  const form = createBugReport({
    endpoint: "/api/feedback",
    screenshot: htmlToImage, // leave out to disable screenshots
  });

  onMount(() => form.open());

  return (
    <form data-bugbottle onSubmit={(e) => (e.preventDefault(), form.submit())}>
      <For each={form.types}>
        {(t) => (
          <button type="button" onClick={() => form.setType(t)}>
            {t}
          </button>
        )}
      </For>

      <textarea value={form.message()} onInput={(e) => form.setMessage(e.currentTarget.value)} />

      <Show when={form.canScreenshot()}>
        <label>
          <input
            type="checkbox"
            checked={form.includeScreenshot()}
            onChange={(e) => form.toggleScreenshot(e.currentTarget.checked)}
          />
          Attach a picture of this page
        </label>
      </Show>
      <Show when={form.screenshot()}>{(src) => <img src={src()} alt="" />}</Show>

      <button type="button" onClick={() => form.pickElement()}>
        {form.isPicking() ? "Click anything to attach it — Esc to stop" : "Point at the element"}
      </button>
      <ul>
        <For each={form.elements()}>
          {(el, i) => (
            <li>
              <code>{el.selector}</code> {el.text}
              <button type="button" onClick={() => form.removeElement(i())}>
                ×
              </button>
            </li>
          )}
        </For>
      </ul>

      <p role="status">{form.statusMessage()}</p>
      <button disabled={form.isSending()}>Send</button>
    </form>
  );
}
```

The subscription is torn down with the owner the function was called in — the
component, normally; call `form.destroy()` yourself if you called it outside
one. `solid-js` is an optional peer dependency, so nothing about it reaches a
project that does not use it.

## Catching render errors (React)

When a component throws, there is no screen left to point at — but there is a
message, a stack and a component stack, which is the best evidence a bug report
ever carries. `BugReportBoundary` catches it and hands your fallback the error
and a `report()` function:

```tsx
import { BugReportBoundary } from "bugbottle/react";

<BugReportBoundary
  endpoint="/api/feedback"
  fallback={(error, report, sending) => (
    <div role="alert">
      <p>This part of the page stopped working.</p>
      <button onClick={report} disabled={sending}>
        {sending ? "Sending…" : "Tell us what happened"}
      </button>
    </div>
  )}
>
  <Orders />
</BugReportBoundary>;
```

`report()` sends a bug report whose message is the error, its stack and the
component stack, and resolves `true` when the endpoint accepted it — so the
button can say "sent". Nothing is sent until it is called: a report is a
message from a person, and sending one on their behalf without asking is
telemetry, which this library is not. `onReport(error, id)` and
`onError(error)` are there for the surrounding application.

Calling it twice files one report: a second call while the first is in flight
gets the same promise, and a call after a successful send does nothing, because
it is the same render error either way. A send that failed can be tried again.
The third argument, `sending`, is true while one is in flight, for a button
that should say so.

For the errors that reach the root, React 19 takes two handlers, and
`createRootErrorHandlers` builds both:

```ts
import { createRoot } from "react-dom/client";
import { createRootErrorHandlers } from "bugbottle/react";

createRoot(node, createRootErrorHandlers({ endpoint: "/api/feedback" })).render(<App />);
```

These do send by themselves, because there is nobody left to ask. Each distinct
error is sent once per `dedupeMs` (60 000 by default, by the same fingerprint
the client and the server share), so a component that throws on every render
sends one report rather than a thousand. Say so in your privacy notice, and
pass `scrub: scrubReport` if a message could carry anything personal.

## Opening it without a button

A form nobody can find is a form nobody uses, and a floating button is not
always wanted. `bugbottle/triggers` is two listeners, under 1.3 kB gzipped
together and importing nothing but the fingerprint hash:

```ts
import { onShortcut, onUncaughtError } from "bugbottle/triggers";

const offKeys = onShortcut("mod+shift+b", () => widget.open());
const offErrors = onUncaughtError((error) => {
  console.warn("uncaught", error.fingerprint);
  widget.open();
});
```

`mod` is Command on a Mac and Control everywhere else, so one string covers
both. The shortcut never fires while the reporter is typing in a field or a
`contenteditable` region, and a match is `preventDefault`ed so the browser does
not also act on it. "Typing" includes typing inside a shadow root: a keystroke
that crosses a shadow boundary is retargeted to the host on the way out, so the
check reads `event.composedPath()[0]` as well as `target`, and follows
`document.activeElement` down through every `shadowRoot.activeElement`. That
covers the panel this package ships, which lives in one. `onUncaughtError`
listens for `error` and
`unhandledrejection`, describes each one the same way, and calls you at most
once per fingerprint (message plus the first stack frame) per `dedupeMs` —
60 000 by default — which is what makes it safe to open a panel from. Pass
`ignore` to drop the ones you already know about. Both return the unsubscribe.

The ready-made panel wires both for you. The shortcut is on by default:

```ts
const widget = mountBugbottle({
  endpoint: "/api/feedback",
  shortcut: "mod+shift+b", // the default; `false` installs no listener
  openOnError: { prefill: true },
});
```

The shortcut opens the panel and closes it again — except while the caret is in
the panel's own box, where the keystroke belongs to the reporter and Escape or
the close button is the way out.

`openOnError` is off unless you ask for it: a panel that appears uninvited is a
decision about your product, not a default. Switched on, an uncaught error
opens the panel with the type set to bug and the locale's `openedByError` line
where the intro usually is — "Something went wrong on this page. Want to tell
us what you were doing?" — and `{ prefill: true }` also puts the error message
in the box, without overwriting anything the reporter has already written. They
still have to press send. Closing the panel puts the ordinary intro back.

From the script tag it is `data-shortcut` (`data-shortcut="off"` for none) and
`data-open-on-error` (any value, or `"prefill"`).

### Shake to report

On a phone there is no keyboard, and shaking the device is what people already
expect from a bug reporter. `bugbottle/shake` is that gesture in 685 bytes
gzipped, importing nothing:

```ts
import { onShake, requestShakePermission } from "bugbottle/shake";

const off = onShake(() => widget.open());
```

A shake is three crossings of 15 m/s² with alternating direction inside one
second, measured on whichever axis moves most once gravity has been filtered
out. Alternation is what separates a shake from a drop — falling onto a desk is
one large reading in one direction — and after a shake the detector is quiet for
three seconds, so one gesture opens one panel however long the reporter keeps
shaking. `threshold` and `cooldownMs` change both; `windowMs` changes the
second. Nothing is measured while the page is hidden: the listener comes off on
`visibilitychange` and goes back on when the page returns. On a laptop it simply
never fires, which is why no media query switches it off.

**iOS needs a gesture, and only Safari has the gate.** Since iOS 13, Safari
delivers no motion events at all until `DeviceMotionEvent.requestPermission()`
has been called from inside a user gesture — a real click or tap — and granted.
`onShake` never calls it: a permission prompt nobody asked for is worse than a
feature nobody found, and the browser would refuse it outside a gesture anyway.
Put it on a button of your own:

```ts
button.addEventListener("click", async () => {
  const state = await requestShakePermission();
  // "unsupported" is every browser but Safari, where motion simply arrives.
  if (state === "denied") showTheButtonInstead();
});
```

`requestShakePermission()` resolves to `"granted"`, `"denied"` or
`"unsupported"`, and a call Safari rejects because it did not come from a
gesture is reported as `"denied"` rather than thrown. Two more facts worth
knowing: motion is a secure-context feature, so a page served over plain HTTP
gets no events whatever the permission says; and until permission is granted
`onShake` is installed and silent, which is exactly what it looks like on a
desktop.

The panel takes the detector the way it takes the annotator — a function you
hand in, so nobody pays for a gesture they never use:

```ts
import { onShake } from "bugbottle/shake";

mountBugbottle({
  endpoint: "/api/feedback",
  shake: onShake, // or { on: onShake, threshold: 12, cooldownMs: 5000 }
});
```

It is off by default, because of the permission dance above. A shake opens the
panel; it never closes it, since the gesture that would close it is the one that
shook it open. From the script tag it is `data-shake` — presence enables it,
and a number tunes the threshold (`data-shake="12"` is a lighter flick). That
build also exposes `window.bugbottle.requestShakePermission()`, which is the
only way a page with no bundler can ask iOS.

## The form (anything else)

Every adapter is a thin layer over three functions that work anywhere:

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

## When the network is down

The report that matters most is the one written while the application was
broken — and that is exactly the one a failed `fetch` throws away.
`bugbottle/queue` keeps it instead:

```ts
import { createQueue } from "bugbottle/queue";
import { useBugReport } from "bugbottle/react";

const queue = createQueue({ endpoint: "/api/feedback" });
const form = useBugReport({ endpoint: "/api/feedback", queue });
```

A send that fails is written to `localStorage`, and the reporter is told the
truth in their own language: "Saved — it will be sent when you are back
online". `form.status.kind` is `"queued"` rather than `"error"`, and
`statusMessage` is the `queued` string of the locale. `mountBugbottle` takes
the same `queue` option and shows its ordinary thank-you panel with that line.

The queue drains when it is created, when the browser fires `online`, and when
the tab becomes visible again. A failed attempt backs off exponentially, from
one second to five minutes. A 5xx or a network error keeps the report; a 4xx
drops it, because the server has already said this report is not acceptable and
retrying it would only fail again more quietly — nothing is ever queued on a
4xx in the first place.

```ts
const queue = createQueue({
  endpoint: "/api/feedback",
  storageKey: "bugbottle:queue", // where in localStorage
  maxEntries: 5,                 // the oldest is evicted first
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  headers: { Authorization: `Bearer ${token}` },
});

queue.size();          // how many are waiting
await queue.flush();   // resolves with how many are still waiting
queue.clear();         // throw them away
queue.destroy();       // remove the listeners; the reports stay in storage
```

The cap was called `maxItems` until 0.9, the one recorder that did not call it
`maxEntries`. That name still works and is deprecated; it goes in 1.0.

### When the quota runs out

`localStorage` is a few megabytes for the whole origin, shared with whatever
else the application keeps there, and a screenshot as a data URL is a megabyte
or two on its own. A write is refused sooner than anyone expects — and until
0.13 a refused write meant the report reached storage nowhere and was gone on
the next reload, which is exactly what an outage ends in.

It costs the picture instead. When the storage refuses a write, the queue
writes the same reports again without their screenshots and leaves a line on
each one it took a picture from:

```jsonc
"notes": ["Screenshot dropped: it did not fit in the offline queue."]
```

`notes` is part of the payload. The server validates it like every other field
— at most five notes, 200 characters each, `normaliseNotes` — and `toMarkdown`
prints them above the evidence, so whoever reads the report can tell "no
screenshot was taken" from "a screenshot was taken and would not fit". It is
written by the library about the report, never by the reporter.

Nothing is dropped on a guess: a picture that fits is kept whole. Only when the
second write is refused as well does the queue go memory-only for the life of
the page. If `localStorage` is unavailable from the start, as in Safari's
private mode, it starts there rather than refusing to work — and either way,
what is already stored is still read and still delivered.

### Somewhere else to keep them

`storage` replaces `localStorage` with anything that can read the queue and
change it. One other implementation ships, in its own entry point:

```ts
import { createQueue } from "bugbottle/queue";
import { createIdbStorage } from "bugbottle/queue-idb";

const queue = createQueue({
  endpoint: "/api/feedback",
  storage: createIdbStorage(), // databaseName, storeName, storageKey
});
```

IndexedDB has room for the pictures — a share of the free disk rather than five
megabytes for everything on the origin — so a 2 MB report is queued whole. Its
read-write transactions are ordered per database and across tabs, so the claim
below is decided by the database rather than by whichever tab wrote last. What
it costs is timing: every step is asynchronous, so a report queued in the last
milliseconds before the tab is closed may not reach the disk, where
`localStorage` always does. Which of the two matters more depends on whether
your reports carry pictures.

It is a separate entry point because the default must not pay for it:
`bugbottle/queue` is about 1.5 kB and this is another 650 bytes, only for those
who ask for it. A browser with no IndexedDB at all makes the queue memory-only,
and the reports are still sent.

Your own storage is two functions:

```ts
import type { QueueStorage } from "bugbottle/queue";

const storage: QueueStorage = {
  read: () => readTheArray(),                            // now or later
  update: (change) => writeBack(change(readTheArray())), // throws when refused
};
```

`update` reads, applies `change` and writes the result back as one step, so a
storage that can be atomic gets to be, and it answers with what is now stored.
Either function may return a promise. A refused write throws, or rejects, and
that is what starts the fallback above.

### Two tabs, one queue

`localStorage` belongs to the origin, not the tab, and it cannot be changed
atomically. The queue takes that seriously: each report is given a random id
when it is queued, and every write re-reads the stored array and merges by id
rather than replacing it. Before a report is delivered it is claimed — a
timestamp written into storage that asks the other tabs to leave it alone for
30 seconds — and a successful delivery removes it by id from a freshly read
array. So a second tab does not lose your reports, deliver them again, or put
back one you have just sent.

The honest limit: this is a lease, not a lock. Two tabs that read, decide and
write within the same few milliseconds can both claim one report and post it
twice. The window is the length of one read-modify-write, the failure is a
duplicate rather than a loss, and `fingerprint(report)` is there if duplicates
matter to your storage. A tab closed mid-delivery leaves its claim behind, and
the next tab picks the report up 30 seconds later. `createIdbStorage()` closes
that window: reading the queue and writing the claim happen inside one
IndexedDB transaction, and the browser orders those across tabs.

Without a queue, a send can still survive the page closing under it:

```ts
await sendReport("/api/feedback", report, { keepalive: true });
```

`keepalive` is passed to `fetch` only when the serialised body is under 60 kB.
The browser caps every keepalive body a page has in flight at 64 KiB together,
and a larger one makes `fetch` reject rather than send — so this is for a
report going out during unload, not for one with a screenshot attached. For
anything larger, the queue is the answer.

Below the two integrations, `SendOptions` has the seam they are built on:
`onError(report, error)` runs after a failed send, before the error reaches
you, and is awaited.

```ts
await sendReport("/api/feedback", report, {
  onError: (failed) => queue.enqueue(failed),
});
```

It was called `onFailure` until 0.9. That name still works and is deprecated;
it goes in 1.0, and where both are given `onError` is the one that runs.

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
floating one, or `trigger: false` and call `open()` yourself. About 11.3 kB
gzipped, no framework.

`contact: true` adds one more field, under the message: how to reach the
reporter. It is off by default, because asking for an address is a promise to
answer and that promise is yours to make. `contact: "required"` refuses to
send without it, through the same inline error an empty message gets. The
field is an ordinary text input with `inputmode="email"`, for the keyboard it
brings up on a phone; the type is deliberately not `email`, because that plus
`required` would mark a phone number invalid and a screen reader would announce
it as an error. Nothing validates what is typed — "call me on 12345678" is a
perfectly good answer, and it arrives as `contact` on the report either way. It is
personal data once it is on: see [Please read this part](#please-read-this-part).

"Edit picture" over the attached screenshot is the one thing the panel does
not carry by itself: hand in `createAnnotator` and you get the button, leave
it out and the canvas editor is not in your bundle at all. See
[Marking the picture](#marking-the-picture).

| Option | Effect |
|---|---|
| `endpoint` | Where the report is POSTed. **Required**. |
| `screenshot` | A `ScreenshotRenderer`. Without it the screenshot row is not rendered. |
| `annotate` | `createAnnotator` from `bugbottle/annotate` renders "Edit picture"; omitted or `false`, nothing leads to an editor and none of it is bundled. |
| `contact` | `true` adds an optional field asking how to reach the reporter; `"required"` refuses to send without it. Off by default. What they type travels as `contact` on the report. |
| `elementPicker` | `false` leaves the picker out. Default true. |
| `locale`, `texts`, `messages` | The language, and per-string overrides of it. |
| `theme`, `brand` | Colours, radius, position; the name and logo in the header. |
| `types`, `initialType` | Which report types to offer, and which starts selected. |
| `consoleFor`, `screenshotFor` | Per type: attach the console, tick the screenshot box. Both default to bugs only. |
| `mask` | What to hide in the screenshot; `false` photographs the page as it is. See [Masking](#masking). |
| `trigger` | `false` for no floating button, or an element or selector to use your own. |
| `shortcut` | The combination that opens the panel. Default `mod+shift+b`; `false` installs no listener. |
| `shake` | Open the panel when the phone is shaken. Off by default; hand in `onShake` from `bugbottle/shake`, or `{ on: onShake, threshold, cooldownMs }`. See [Shake to report](#shake-to-report). |
| `network` | Record the failed and slow requests while the panel is mounted. Off by default; hand in `initNetwork` from `bugbottle/network`, or `{ on: initNetwork, all, slowMs, maxEntries, ignore, beforeRequest }`. The panel's `endpoint` is passed on unless you name one. The same switch as `data-network`. See [What the network did](#what-the-network-did). |
| `perf` | Record the Web Vitals and the storage snapshot while the panel is mounted. Off by default; hand in `initPerf` from `bugbottle/perf`, or `{ on: initPerf, vitals, storage, allowValues, maxKeys }`. The same switch as `data-perf`. See [Performance and storage](#performance-and-storage). |
| `openOnError` | Open the panel on an uncaught error; `{ prefill: true }` also fills the box. |
| `queue`, `scrub`, `sign`, `beforeSend` | The same seams the plain functions take. |
| `extra`, `headers`, `credentials`, `timeoutMs`, `fetch`, `parseError` | Passed through to `buildReport` and `sendReport`. |
| `container`, `onSent`, `onError` | Where to mount, and what to do afterwards. |

**Accessibility.** The panel is meant to be switched on without an
accessibility regression, so it behaves like a dialog rather than a floating
div. While it is open, focus is trapped inside the shadow root — Tab wraps at
both ends — and Escape closes it; closing puts focus back on whatever opened
it, the floating trigger or your own control. The report types are a
`radiogroup` the arrow keys walk through, one stop in the tab order, and so
are the drawing tools. Every
control has a name: the trigger, the close button, the group of types, the
screenshot note (as `aria-describedby` on the checkbox), each remove
button, which is named after the element it removes rather than being one of
several buttons called "Remove", and every control of the picture editor —
whose canvas carries a name that also says which keys work on it, since
nothing on screen mentions them. Closing the editor puts focus back on the
button that opened it. A polite live region announces status
messages, and announces the element picker starting and stopping, with the way
out — that mode hides the panel and changes the pointer, neither of which a
screen reader reports. Targets are at least 24x24, focus rings are visible in
both colour schemes, the dark scheme lightens the accent and the error red so
they hold their contrast, and `prefers-reduced-motion` is respected. axe-core
reports no violations on the panel open in either scheme, closed, with the
picture editor open in either scheme, or with the contact field on in either
scheme; run the
audit yourself with `npm run build && npm run a11y` (Chrome and
`puppeteer-core` required). All of the announced text comes from the locale,
so it is announced in the reporter's language.

## One script tag

For a site with no build step — a WordPress theme, a static page, a client
site somebody else deploys — `dist/bugbottle.js` is a self-contained bundle
that mounts the panel from the tag itself, the annotator included. About
23.9 kB gzipped:

```html
<script
  src="https://cdn.jsdelivr.net/npm/bugbottle@0.12.0/dist/bugbottle.js"
  data-endpoint="/api/feedback"
  data-locale="da"
  data-primary="#e11d48"
  data-brand="Mahope"
></script>
```

`dist/` is committed, so the same file is on jsDelivr from the git tag as well:
`https://cdn.jsdelivr.net/gh/mahope/bugbottle@v0.12.0/dist/bugbottle.js`. Pin a
version in either form; `@latest` is a way to have a stranger's next release
run on your page.

### Two builds

There are two files, and they are the same panel:

| File | Gzipped | What is in it |
|---|---|---|
| `dist/bugbottle.js` | 24.2 kB | Everything: the annotator, the timings and storage snapshot, shake-to-report and the network log, all switchable from an attribute. |
| `dist/bugbottle.slim.js` | 20.6 kB | The same panel, the console, breadcrumbs, the element picker, the offline queue, the scrubber, the signer and all eight locales — without those four. |

```html
<script
  src="https://cdn.jsdelivr.net/npm/bugbottle@0.12.0/dist/bugbottle.slim.js"
  data-endpoint="/api/feedback"
></script>
```

From the git tag it is
`https://cdn.jsdelivr.net/gh/mahope/bugbottle@v0.12.0/dist/bugbottle.slim.js`.

The slim build reads every attribute in the table below except four, which it
ignores because the code behind them is not in it: **`data-annotate`**,
**`data-perf`**, **`data-shake`** and **`data-network`**. Write one and it says
so on the console once, in English — that is a message to whoever wrote the
script tag, not to the reporter, so it is not translated. `window.bugbottle`
is the same namespace without `createAnnotator`, `initPerf`, `onShake`,
`requestShakePermission` and `initNetwork`.

The saving is smaller than the four modules weigh on their own, because inside
one bundle they share gzip's dictionary, and two of their costs stay behind on
purpose: the annotator's labels are in all eight locales, which are data, and
the panel's own annotator toolbar is a static import. Every language still
works in the slim build; that is the trade it makes.

| Attribute | Effect |
|---|---|
| `data-endpoint` | Where the report is POSTed. **Required** — without it nothing mounts. |
| `data-locale` | Language tag through `resolveLocale`. Defaults to `<html lang>`, then English. |
| `data-position` | `bottom-right` (default), `bottom-left`, `top-right`, `top-left`. |
| `data-primary` | Accent colour of the button and the primary action. |
| `data-brand` | Name in the panel header. |
| `data-logo` | Image URL shown before the title and on the trigger. |
| `data-trigger` | Selector for your own button. Without it, the floating one is rendered. |
| `data-contact` | Present, with any value, asks the reporter how to reach them; `required` also refuses to send without it. Off without the attribute. |
| `data-scrub` | Present, with any value, redacts the report with `scrubReport` before it is sent. |
| `data-network` | Present, with any value, records the failed and slow requests. The same switch as the panel's `network` option. See "What the network did". |
| `data-perf` | Present, with any value, records the Web Vitals and lists what is in the browser's stores — names and lengths, never values. The same switch as the panel's `perf` option. See "Performance and storage". |
| `data-sign-key` | Signs the body with this key. A key in the page source is public, so this deters spam rather than authenticating anybody; see [Signing requests](#signing-requests). |
| `data-queue` | Present, with any value, keeps a failed report in `localStorage` and sends it when the browser is online again. See "When the network is down". |
| `data-extra` | JSON object merged into every report, e.g. `data-extra='{"appVersion":"1.4.2"}'`. |
| `data-mask="off"` | Stops masking the screenshot. Only matters once you give `mount` a renderer; see [Masking](#masking). |
| `data-annotate="off"` | Leaves out "Edit picture" and its rectangle, arrow and blur. This build carries the annotator, so the attribute only switches it off; it does not make the file smaller. Only matters once you give `mount` a renderer; see [Marking the picture](#marking-the-picture). |
| `data-shortcut` | The combination that opens the panel. `mod+shift+b` unless you say otherwise; `off` installs no listener. |
| `data-shake` | Present, with any value, opens the panel when the phone is shaken; a number is the threshold in m/s² (`data-shake="12"` is a lighter flick). On iOS nothing arrives until the page calls `window.bugbottle.requestShakePermission()` from a button of its own. See "Shake to report". |
| `data-open-on-error` | Present, with any value, opens the panel on an uncaught error. `prefill` also fills the message in. |

The tag also patches the console immediately and starts breadcrumbs, so an
error thrown before the page finishes loading is still in the report.

There is no screenshot in this build. A renderer means `html-to-image`, which
is far larger than everything else here put together, and forcing it on every
page that only wants the panel is the wrong trade. The bundle exposes the
building blocks on `window.bugbottle` — `mount` (`mountBugbottle`),
`initConsoleBuffer`, `initBreadcrumbs`, `initNetwork`, `initPerf`,
`createQueue`,
`locales`, `resolveLocale`, `scrubReport`, `buildReport`, `sendReport`,
`pickElement`, `createAnnotator`, `onShortcut`, `onUncaughtError`,
`onShake`, `requestShakePermission` and
`version` — so a
page that wants pictures can load `html-to-image` itself and call
`window.bugbottle.mount({ endpoint, screenshot })`. Leave `data-endpoint` off
the tag and nothing mounts on its own:

```html
<script src="https://cdn.jsdelivr.net/npm/bugbottle@0.12.0/dist/bugbottle.js"></script>
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
  src="https://cdn.jsdelivr.net/npm/bugbottle@0.12.0/dist/bugbottle.js"
  integrity="sha384-…"
  crossorigin="anonymous"
  data-endpoint="/api/feedback"
></script>
```

jsDelivr shows the hash on the file's page, or compute it yourself:
`curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`. The hash
changes with every version, so it has to be updated with the version.

## Languages and branding

Every string a reporter sees lives in a `Locale`: six status `messages` and
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

### Five more languages, imported on purpose

A locale is data, and data is carried whole: everything that imports
`bugbottle/locales` pays for all eight languages in it. Italian, Polish,
Portuguese, Finnish and Ukrainian are in a second entry so that a site in one of
them can have its own language without every other site growing. Import the
whole map, or the single language the site is in:

```ts
import { en, locales, resolveLocale } from "bugbottle/locales";
import { localesExtra } from "bugbottle/locales-extra";

const all = { ...locales, ...localesExtra };
mountBugbottle({ endpoint, locale: resolveLocale(navigator.language, en, all) });
```

`resolveLocale` takes the map to look in as its third argument, so nothing about
this reaches a bundle that does not ask for it — not the core, and not either
script-tag build, which still carry the eight. `pt` is European Portuguese and
`pt-BR` resolves to it, the way `da-DK` resolves to `da`.

### Branding and theme

The panel's look comes from `theme` and from `brand` (`name`, `logo` as an
image URL or inline SVG). Every value in `theme` is also a CSS custom property
on the host element, so a stylesheet can restyle the panel without touching
JavaScript:

```css
[data-bugbottle="ui"] { --bb-primary: #0f766e; --bb-font: "Inter", sans-serif; }
```

The whole list, and nothing else:

| CSS variable | `theme` key | What it is |
| --- | --- | --- |
| `--bb-primary` | `primary` | The brand colour: the button, the send action, the marks the annotator draws |
| `--bb-on-primary` | `onPrimary` | The text and icons that sit on the brand colour |
| `--bb-bg` | `background` | The panel's ground |
| `--bb-text` | `text` | The ink |
| `--bb-muted` | `muted` | Hints, notes and the status line |
| `--bb-border` | `border` | The rules around the panel and its fields |
| `--bb-radius` | `radius` | The corner radius, as a CSS length |
| `--bb-font` | `font` | The font stack the panel is set in |
| `--bb-shadow` | `shadow` | The shadow under the panel |
| `--bb-z` | `zIndex` | Where the panel sits against the application |
| — | `position` | Which corner it lives in: `"bottom-right"` (the default), `"bottom-left"`, `"top-right"` or `"top-left"` |
| — | `scheme` | `"light"`, `"dark"` or `"auto"` — `"auto"` follows the reader's system setting |

The last two are not custom properties: they are the `data-pos` and
`data-scheme` attributes on the host, which the panel's own stylesheet reads.

The [theme playground](https://bugbottle.dev/docs/languages-and-branding/#branding-and-theme)
on the documentation site restyles a real panel as you move these controls and
prints the `mountBugbottle` call and the CSS block to copy.

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
`initBreadcrumbs` returns that same function as its `stop()`, so a caller that
started the recorder can undo it without importing a second name.

## What the network did

Breadcrumbs say what the reporter did; `bugbottle/network` says what the
browser did about it. "The save button does nothing" is a different report
when it arrives with the 500 from `POST /api/orders` that caused it. It is a
separate entry point too, and opt-in: it patches `fetch` and
`XMLHttpRequest`, which is a bigger promise than adding a listener.

```ts
import { initNetwork } from "bugbottle/network";

initNetwork({ endpoint: "/api/feedback" });
```

Only the interesting requests are kept: a status of 400 or more, a request
that failed before it got a status (`status: 0`, `error: true`), and anything
slower than `slowMs` — 2000 ms by default. A fast 200 is the request that
worked, and there are hundreds of those in a session; recorded, they would
evict the one that explains the report. The last 30 are kept.

```jsonc
[
  { "ts": "2026-09-07T08:12:31.004Z", "method": "POST", "url": "/api/orders", "status": 500, "ms": 812 },
  { "ts": "2026-09-07T08:12:33.900Z", "method": "GET", "url": "/api/orders/42", "status": 0, "ms": 30, "error": true },
  { "ts": "2026-09-07T08:12:36.100Z", "method": "GET", "url": "https://api.stripe.com/v1/charges", "status": 200, "ms": 3400 }
]
```

`buildReport` attaches them on its own while the recorder is active, as
`network`; pass `includeNetwork: false` to leave them out of one report.
`toMarkdown` renders them as a "Requests" table.

**Never recorded: request or response bodies, and never headers.** That is
where tokens, cookies and personal data live, and a bug report is not the
place for any of them. What is left is the method, the URL, the status and the
duration. The URL keeps its path and query with sensitive query values
redacted (`?token=…` becomes `?token=[redacted]`); a cross-origin URL keeps
its origin, because which host failed is half the answer.

```ts
initNetwork({
  endpoint: "/api/feedback",
  slowMs: 2000,
  all: false,
  maxEntries: 30,
  ignore: (url) => url.startsWith("/api/analytics"),
  beforeRequest: (entry) =>
    entry.url.startsWith("/admin") ? null : { ...entry, url: entry.url.replace(/\/\d+/, "/:id") },
});
```

- `all: true` records every request, not only the failed and the slow ones.
- `beforeRequest` sees every entry before it is stored. Return null to drop
  it, or a changed one to redact it. A hook that throws drops the entry and
  never reaches your application.
- Requests to `endpoint` are skipped, so a report never describes its own
  delivery. `ignore` replaces that check when you need a different rule.

The patched `fetch` always calls the original and hands back its result
untouched, rejections included; `XMLHttpRequest` is timed with `loadend`, the
one event that fires for every ending. `getNetwork()` returns a copy of what
has been recorded, and `resetNetwork()` empties it and puts both globals back
as it found them. `initNetwork` returns that same function as its `stop()`.

The ready-made panel can start it for you: `network: initNetwork` on
`mountBugbottle` records for as long as the panel is mounted and stops on
`destroy()`, and the panel's own `endpoint` is passed on so a report never
describes its own delivery. `{ on: initNetwork, all: true }` tunes it. The
panel never imports the module — you hand it in — so a page that records
nothing carries nothing. From the script tag it is `data-network`, which is
the same switch.

## Performance and storage

Two questions a report almost never answers and almost always needs to: was it
slow, and what state was the browser in? `bugbottle/perf` answers both without
bundling `web-vitals`. It is a separate entry point and opt-in, and it should
be called as early as your app can manage — ideally in the same module that
mounts the panel.

```ts
import { initPerf } from "bugbottle/perf";

const stop = initPerf();
```

The observers are created with `buffered: true`, so the LCP that was painted
while your application was still booting is delivered anyway; the browser's
buffer is finite, which is why "as early as you can" is not a formality.

`report.perf` carries the Web Vitals the browser has already measured, the
milestones from the navigation entry, the long tasks and — on Chromium only —
the JS heap. Every field is optional, because every field is a measurement
that may not have happened, and a figure that was never measured is left out
rather than sent as a zero.

```jsonc
{
  "lcp": 3412,          // milliseconds, the last candidate the browser reported
  "cls": 0.081,         // cumulative layout shift, three decimals
  "inp": 210,           // the worst interaction, in milliseconds
  "ttfb": 128,
  "domContentLoaded": 641,
  "load": 1200,
  "longTasks": { "count": 3, "totalMs": 480 },
  "memory": { "usedMB": 32, "limitMB": 2048 }
}
```

Two simplifications, said plainly because a number in a bug report is only
worth what its definition is. **CLS** here is the sum of every shift that did
not follow a recent input, where the Web Vitals definition takes the worst
session window instead: on a page that shifts repeatedly this reads high
rather than low, which is the safe direction for evidence. **INP** here is the
worst interaction, where the real metric is roughly the 98th percentile: on
the handful of interactions a session usually has these are the same number,
and on a long session this over-reports rather than hides. `first-input` is
observed too, so a browser without the `event` type still contributes its FID.

`report.storage` says what was in the browser's stores at the moment the
report was written — not when `initPerf` ran, because what matters is the
state the reporter was actually in.

```jsonc
{
  "local": [{ "key": "theme", "length": 4 }, { "key": "authToken", "length": 132 }],
  "session": [{ "key": "cart", "length": 7 }],
  "cookies": ["session", "consent"],
  "values": { "tenant": "acme" }
}
```

**Key names and value lengths, never values, and cookie names without cookie
values.** That a key called `authToken` is present and 132 characters long is
usually the whole answer to "why was I logged out"; its contents are the
session itself, and a bug report is not a place to put one. The one exception
is `values`, and it is opt-in per key:

```ts
initPerf({
  allowValues: ["tenant", "featureFlags"],  // nothing travels unless it is named here
  maxKeys: 50,                              // keys listed per store; 50 is also the ceiling
  storage: false,                           // measure the timings only
  vitals: false,                            // snapshot the storage only
});
```

`allowValues` looks each name up in `localStorage` first and then
`sessionStorage`, and clips what it finds to 200 characters. A cookie value is
never included, whatever the allow-list says. Run `scrubReport` over the report
as well if the allow-listed keys can hold anything written by a person: the
scrubber redacts `storage.values` and the cookie names, and leaves the key
names and lengths alone, since those are the shape of the store and the point
of the snapshot.

`buildReport` attaches both blocks on its own while `initPerf` is measuring, as
`perf` and `storage`; pass `includePerf: false` to leave them out of one
report. `toMarkdown` renders a "Performance" table and a collapsed "Storage"
block. `initPerf` returns the `stop()` that disconnects the observers and
unregisters both — the same thing `resetPerf()` does. The ready-made panel
takes it the same way the network log is taken: `perf: initPerf` on
`mountBugbottle` starts it on mount and stops it on `destroy()`, and
`{ on: initPerf, storage: false }` tunes it. In the one-script-tag build it is
`data-perf` on the script tag, which is the same switch.

## Replay with rrweb

If your application already records with [rrweb](https://github.com/rrweb-io/rrweb),
the half-minute before the reporter opened the panel can travel with the
report. `bugbottle/rrweb` is an adapter and not a recorder: rrweb is not a
dependency and is never imported here, so you hand your own `record` in, the
same way you hand the screenshot renderer in.

```ts
import { record } from "rrweb";
import { attachRrweb } from "bugbottle/rrweb";

const stop = attachRrweb(record);                       // 30 s, 512 KiB
// or
attachRrweb(record, { seconds: 15, maxBytes: 256 * 1024 });
```

### Please read this part too

A replay is a recording of a person using your software: what they typed, what
they had on screen, in what order and how long it took them. Everything the
["Please read this part"](#please-read-this-part) section says about
screenshots applies here, and applies twice — a screenshot is one moment and a
replay is all of them. Turn this on for your own staff, on your own staging
environment, or on an application whose users have been told; do not turn it on
quietly on a page that shows one person's data to another.

Two specifics worth knowing before you do.

`scrubReport` does not look inside a replay. The scrubber works field by field
over a report it understands, and rrweb's event payload is somebody else's
format — walking it and rewriting strings would corrupt the recording as often
as it redacted anything. **rrweb's own masking is the whole control here.**
This adapter therefore sets `maskAllInputs: true` unless you override it, and
maps the markers you already use for screenshots onto rrweb's selectors:
`data-bugbottle-mask` becomes `maskTextSelector`, and `data-bugbottle-block`
becomes `blockSelector` alongside `data-bugbottle`, so the panel never films
itself. Everything else rrweb offers — `maskTextClass`, `maskInputFn`,
`ignoreClass` — goes through `recordOptions`:

```ts
attachRrweb(record, { recordOptions: { maskTextClass: "sensitive" } });
```

And the receiver has the last word. `handleReport` takes `replay: "drop"`,
which throws the recording away before anything is scrubbed, deduplicated,
stored or rendered — the setting for a deployment whose client has rrweb wired
up before its storage policy is decided.

### How the buffer holds thirty seconds

rrweb emits events for as long as it runs, and a report wants the recent past
only. The adapter asks rrweb for a fresh full snapshot every ten seconds
(`checkoutEveryNms`), and a full snapshot is the only place a recording can be
cut: everything after one is a diff against it, so dropping events out of the
middle leaves something that will not play. The buffer therefore keeps whole
checkout groups and drops the oldest — first when it is entirely outside the
window, then again while the serialised buffer is over `maxBytes`. The newest
group is never dropped, so `seconds` is a floor and not a promise: you get at
least what you asked for, up to ten seconds more, and less than that only in
the first seconds after the page loaded.

If one snapshot alone is over the cap — a page too large to record at that
size — nothing is attached at all, on the same principle as an oversized
screenshot: half a replay is not half as useful, it is useless.

`buildReport` attaches the buffer on its own while `attachRrweb` is recording,
as `replay: { events, seconds }`; pass `includeReplay: false` to leave it out
of one report. `attachRrweb` returns the `stop()` that stops the recorder,
empties the buffer and unregisters it — the same thing `resetRrweb()` does.

On the server, `normaliseReplay` keeps the events that are objects with a
numeric `type` and `timestamp`, strips null bytes, recomputes `seconds` from
what survived, and drops the whole replay when it serialises to more than
`MAX_REPLAY_BYTES` (1 MB). That cap and `maxBytes` are both UTF-8 bytes, not
characters: a recording of a page written in Chinese weighs up to three times
its length. `toMarkdown` prints one line — `Replay: 240 events
over 32 s (attached)` — because the events are for a player and not for a
reader. `store` writes them with the rest of the report; no sink uploads them
anywhere.

The one-script-tag build does not carry this. Without a bundler there is no
`record` to hand in, and the adapter is three lines for anybody who has one.

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
| Contact | anna@example.com |
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

### Marking the picture

A screenshot of the whole page rarely says which part of it is wrong. The
reporter can mark it before sending: a rectangle to point at something, an
arrow to point from somewhere, and a blur.

The blur is the privacy tool as much as the marking one. It does not put a
frosted rectangle over the region — it reads those pixels back out of the
canvas, averages them in 12-pixel blocks and paints the averages on top, so
the original pixels are gone from the exported PNG. Whoever receives the
report cannot recover what was under it. That is the tool to reach for when a
picture caught a customer name the masking rules did not know about. The
region is rounded outwards to whole pixels before it is averaged, so a drag
covers a fraction of a pixel too much rather than a fraction too little.

In the ready-made panel it is a button, "Edit picture", that appears once a
picture is attached; it opens a toolbar and the canvas in place of the
preview. The panel does not import the annotator — you hand it in, the way you
hand in a screenshot renderer, a scrubber or a signer, so that a panel nobody
marks a picture in does not ship a canvas editor:

```ts
import { mountBugbottle } from "bugbottle/ui";
import { createAnnotator } from "bugbottle/annotate";

mountBugbottle({ endpoint: "/api/feedback", screenshot: htmlToImage, annotate: createAnnotator });
```

Leave `annotate` out (or pass `false`) and nothing on screen leads to an
editor. The script tag is the build that carries everything, so it wires the
annotator up for you and `data-annotate="off"` is how you switch it off there.
Sending with the editor still open keeps the marks: the picture is folded back
into the report either way, so a blur cannot be lost by skipping "Done".
Escape in the editor leaves the editor rather than the panel — it is the way
out that drops the marks nobody confirmed, puts the preview back and returns
focus to "Edit picture"; while a mark is being drawn it still abandons that
mark, and with the editor closed it still closes the panel.

With your own form, use the annotator directly. It is its own entry point,
about 1.4 kB gzipped, and it draws on a canvas you supply:

```ts
import { createAnnotator } from "bugbottle/annotate";
import { buildReport, sendReport, captureScreenshot } from "bugbottle";
import { htmlToImage } from "bugbottle/html-to-image";

const picture = await captureScreenshot(htmlToImage);
const annotator = createAnnotator(canvas, picture);
await annotator.ready; // the canvas is now the size of the picture

toolbar.onclick = (e) => annotator.setTool(e.target.value); // "rect" | "arrow" | "blur"
undoButton.onclick = () => annotator.undo();

// When the reporter is finished, the marked picture is the attachment.
const report = buildReport({
  type: "bug",
  message: message.value,
  screenshotDataUrl: annotator.toDataUrl(),
});
await sendReport("/api/feedback", report);
```

`createAnnotator(canvas, dataUrl, options)` takes `tool`, `colour` (defaults
to the computed `--bb-primary`), `lineWidth`, `blockSize` and an `onChange`
called with the number of marks. It returns `ready`, `setTool`, `getTool`,
`undo`, `clear`, `count`, `toDataUrl` and `destroy`. Drawing is by pointer, so
a mouse, a pen and a finger all work; Backspace or Delete undoes and Escape
abandons the mark being drawn — with nothing being drawn the key is left to
travel, so the form around the canvas can decide what it means. Nothing in it is a string the reporter reads,
so it needs no locale of its own — the panel supplies the labels around it.

## Receiving a report

`handleReport` is the whole endpoint. It validates every field with the helpers
below, optionally scrubs, decides what happens to the screenshot, stores the
report and runs the sinks you configured — and answers with a `Response`:

```ts
import { handleReport, toResend } from "bugbottle/server";

export const POST = (req: Request) =>
  handleReport(req, { sinks: [toResend({ apiKey, from: "bugs@acme.com", to: "team@acme.com" })] });
```

That works unchanged in a Next.js route handler, Hono, Cloudflare Workers, Bun
and Deno: they all speak the web `Request`. Nothing about it is magic, and
everything is an option:

```ts
export const POST = (req: Request) =>
  handleReport(req, {
    authorize: async (r) => Boolean(await getUser(r)),     // false → 401
    maxBodyBytes: 4 * 1024 * 1024,                         // over it → 413
    bodyTimeoutMs: 15_000,                                 // slower than that → 408
    scrub: true,                                           // redact on the way in
    screenshot: async (bytes) => await putPrivate(bytes),  // returns a URL
    store: async (report, screenshot) => await db.reports.insert(report),
    sinks: [toGithub({ token, owner: "acme", repo: "app", labels: ["bug"] })],
    sinkTimeoutMs: 10_000,                                 // a hung sink is a failed sink
    onSinkError: (err) => logger.warn({ err }, "sink failed"),
    cors: "https://app.acme.com",                          // answers OPTIONS too
    rateLimit: { limit: 20, windowMs: 60_000 },
    dedupe: { windowMs: 60_000 },                          // the same report twice → 200
  });
```

Only a `POST` carries a report: anything else is answered with `405`, and an
`OPTIONS` preflight is answered before that when `cors` is set — reflecting the
`Access-Control-Request-Headers` the browser asked for, so your own header
(a CSRF token, a tracing id) needs no configuration here.

The body is bounded in two directions. `maxBodyBytes` is counted on the stream
as well as read from `content-length`, which is a claim rather than a fact, and
`bodyTimeoutMs` (15 s by default) bounds the whole read, so a sender that
dribbles one byte at a time is answered with `408` instead of holding the
connection open. `sinkTimeoutMs` (10 s by default) does the same for a
delivery: a sink that has not answered by then is abandoned and counted in
`sinkErrors` and `onSinkError` exactly like one that threw, and the sink is
handed an `AbortSignal` in its context that it can pass to `fetch`.

`store` receives a `ValidatedReport` — `{ type, message, context, console,
elements, breadcrumbs, network, extra, receivedAt }`, plus `contact` when the
form asked for one and the reporter answered — and the decoded PNG when
there was one. `extra` is every top-level key the client sent that bugbottle
does not know about, so a tenant id or a build number arrives without a schema
change; strings are clipped to 500 characters, numbers and booleans pass, and
nested objects are dropped, as are `__proto__`, `constructor` and `prototype`,
which mean something to the language rather than to you. The reply is
`201 { id }` when `store` returned an
id and `202 {}` when it did not; `respond` replaces it.

`screenshot` decides what happens to the picture: `"keep"` (the default) hands
the bytes to `store` and to the sinks, `"drop"` never decodes it, and a
function stores it and returns a URL that reaches `toMarkdown` and the sinks as
`screenshotUrl`. Only `"keep"` hands bytes on — with a function, `store` and
the sinks see the URL and no bytes, so the same picture is never both uploaded
and attached. A rejected picture never fails the report, and neither does a
storage bucket that is down: a `screenshot` function that throws reaches
`onError` and the report is stored and delivered without a `screenshotUrl`.

`rateLimit` counts in memory by default, so it is per instance: fine per
serverless isolate against one looping browser, and not a shared limit across a
fleet — see *Running more than one instance* below when it has to be.
The default key is the first entry of `x-forwarded-for`, falling back to
`cf-connecting-ip` — **both are headers, which means both are things the
caller can write**. It is only a limit if a proxy you control overwrites
`x-forwarded-for` on the way in; behind anything else, one client varies the
header and gets a fresh allowance every request. The key is clipped to 64
characters and the bucket map is capped at 10 000 entries (expired buckets
evicted first, then the oldest) so that a forged header cannot grow the map,
but the honest fix is to count something you issued:

```ts
rateLimit: {
  limit: 20,
  windowMs: 60_000,
  key: (req) => sessionIdFrom(req.headers.get("cookie")) ?? "anonymous",
}
```

`dedupe` answers a repeat of the same report with `200 { id, duplicate: true }`
— the id of the first one — without running `store` or the sinks again. What
counts as the same report is `fingerprint(report)` from `bugbottle`: the type,
the message and the first console error, hashed. The client computes it the
same way from the same function, so a fingerprint written down by a sink means
the same thing on both sides. It is compared after scrubbing, so two reports
that differ only in what was redacted are one report. Pass `key` to decide for
yourself. Like the rate limit it is in memory by default, so it is per
instance: it stops one browser sending the same crash forty times, not two
instances behind a load balancer storing it twice. *Running more than one
instance* is how you make it the second thing.

For Express, `expressHandler` builds the `Request` and writes the `Response`
back:

```ts
import express from "express";
import { expressHandler, toWebhook } from "bugbottle/server";

app.post(
  "/api/bug-report",
  express.json({ limit: "5mb" }),
  expressHandler({ sinks: [toWebhook({ endpoint: process.env.SLACK_WEBHOOK_URL!, format: "slack" })] }),
);
```

It reads an already-parsed `req.body` when a parser ran and the raw stream when
none did, so `express.json()` is convenient rather than required. A raw stream
is counted against `maxBodyBytes` as it arrives: over the ceiling the adapter
answers `413` and calls `req.destroy()` rather than buffering the rest of a
body it has already refused.

### A directory of files

`store` is a function you write, and for a great many deployments the function
you write first is "put it on the disk". `fileStore` is that written once:

```ts
import { fileStore, handleReport } from "bugbottle/server";

const reports = fileStore({ dir: "./reports", maxReports: 2000 });

export const POST = (req: Request) => handleReport(req, { store: reports.store });
```

One JSON file per report, named `<arrival time>-<id>.json` so the directory
sorts by age, with the decoded PNG beside it as `<id>.png`. The split keeps the
JSON readable — a megabyte of base64 in the middle of a file makes it
unopenable — and deleting a report is deleting two files nobody has to parse.
`maxReports` (2000 by default) deletes the oldest once the directory is over
it, because an inbox with no ceiling is a disk that fills; `0` keeps
everything, which is a decision about a disk rather than a default.
`screenshots: false` keeps the JSON and never writes a picture at all.

Three more calls are there for whoever builds a page over the directory:

```ts
const listed = await reports.list();          // newest first, one small entry each
const found = await reports.read(id, { screenshot: true });
await reports.remove(id);                     // the JSON and the picture
```

`list()` answers `{ id, file, title, type, url, receivedAt, screenshot }` per
report — the strings a list shows, without reading every file for them. The
directory is walked once, on the first call that needs it, and kept up to date
by every write and delete after that; `read(id)` then reads exactly the one
file that was asked for, and only fetches the picture when you ask for it.

Two of its properties are worth saying out loud, because they are the reasons
not to write this yourself:

- **Every write is a rename.** The bytes go to a temporary name and are renamed
  into place, which is atomic within a directory. A process killed halfway
  through four megabytes leaves a `.tmp` file that no listing looks at, never a
  truncated report or half a screenshot.
- **An id is a UUID or it is nothing.** `read` and `remove` take an id that
  came out of a URL, which makes it attacker-controlled text on its way to a
  path. It is matched against the shape `crypto.randomUUID()` writes *before*
  any path is built, so `../../etc/passwd` is answered with `null` rather than
  normalised and hoped about. The picture is checked the same way: what gets
  written under a `.png` name has a PNG signature in its bytes, whatever the
  caller called it, and one that does not is dropped while the report is
  stored — screenshots fail open here as everywhere else.

It is a directory, not a database: one process is assumed to be the only thing
writing to it, because the index is held in memory. Two instances over one
volume want the real thing. `examples/inbox` is `fileStore` plus a password, a
list and a detail page, and is the shortest way to see it working.

### Signing requests

An endpoint that anybody can POST to will eventually be found by somebody with
a loop. `bugbottle/sign` puts an HMAC-SHA-256 on the body and `handleReport`
checks it, so the obvious rubbish is refused before a row is written.

Read this paragraph before you turn it on. **A key that ships to a browser is
public.** It is in the bundle, and anyone who opens the network tab or the
JavaScript can copy it. Signing is spam deterrence, not authentication: it
raises the price of posting to your endpoint from "curl in a loop" to "read
their bundle and implement HMAC", and it makes a captured body unusable a
second time. It is worth having beside `rateLimit` and `authorize`. It is not a
reason to skip either of them, and it is no protection at all against somebody
who wants in.

In the browser, pass the signer as `sign` wherever the endpoint is configured
— the hook, the composable, the store, the panel, `sendReport` directly:

```ts
import { createSigner } from "bugbottle/sign";

useBugReport({
  endpoint: "/api/bug-report",
  sign: createSigner({ key: import.meta.env.VITE_BUGBOTTLE_SIGN_KEY }),
});
```

With the script tag, it is one attribute:

```html
<script src="https://cdn.jsdelivr.net/npm/bugbottle@0.12.0/dist/bugbottle.js"
        data-endpoint="/api/bug-report"
        data-sign-key="the-key-your-server-knows"></script>
```

On the server:

```ts
export const POST = (req: Request) =>
  handleReport(req, {
    signature: { key: process.env.BUGBOTTLE_SIGN_KEY! },
    rateLimit: { limit: 20, windowMs: 60_000 },
    store: async (report) => await db.reports.insert(report),
  });
```

The header is `X-Bugbottle-Signature: t=<unix ms>,v1=<hex>`, where the hex is
the HMAC-SHA-256 of `<t>.<body>` — the timestamp, a full stop, and the exact
JSON that was sent. The timestamp is inside the signed message rather than
merely beside it, so moving it to slip past the window breaks the signature.
Any language can verify it: it is a plain HMAC.

Everything about the check is an option:

```ts
signature: {
  key: [newKey, oldKey],   // any key in the list is accepted, which is how you rotate one
  header: "X-Sig",         // default X-Bugbottle-Signature
  maxSkewMs: 5 * 60_000,   // default; the clock may be wrong in either direction
  require: true,           // default whenever `signature` is set
  store,                   // optional; the default is in memory, per instance
}
```

`t` is digits and nothing else — `t=0x1`, `t= 1` and `t=1e12` are bad
signatures, not clever spellings of a timestamp — and the digest is checked
over the characters that arrived rather than over our idea of the same number.

Missing when required, wrong, outside the skew window, or already seen: all
four answer `401 { error: "Bad signature" }`, and they answer it identically,
because telling a caller *which* part they got wrong is telling them how to get
it right.

**What the replay cache actually promises.** Every accepted signature is
remembered until the timestamp it signed ages out of the skew window — which is
later than its arrival, because the window runs in both directions. By default
that memory is a `Map` in the process, bounded at 128 digests per *signed
second* and 640 seconds at a time. The per-second bound is the part worth
understanding: the key is public, so anybody can mint valid signatures as fast
as they can compute HMACs, and against one global ceiling that was a way to
push your reporter's digest out of the cache and post their captured body
again. Making room inside one second means a flood can only displace digests
dated the same second it floods. So the guarantee is: a body captured from an
honest report cannot be replayed at the instance that accepted it, unless the
attacker also floods the exact second that report was signed in — and even then
only within the window, and only at that one instance. Two instances behind a
load balancer do not share the cache, and a serverless isolate that has just
started has an empty one.

Hand in a `signature.store` when that is not enough — several instances, or a
window wider than 640 seconds. It is one of the three seams in *Running more
than one instance* below, and the only one that fails **closed**: a store that
throws answers 500 rather than accept a signature nobody managed to check.
Only a signature that already verified is ever written, so nobody can fill your
store with digests of their own choosing.

Two things will surprise you if nobody says them:

- **A browser without `crypto.subtle` sends the report unsigned.** WebCrypto is
  missing on very old browsers and on any page served over plain HTTP. Nothing
  throws and nothing is queued; the report goes out without the header, and a
  server with `require` on refuses it. Set `require: false` while you find out
  whether that is anybody, and note that a signature which *is* present is
  verified whatever `require` says — a wrong one is a claim, not an omission.
- **The offline queue posts unsigned.** `bugbottle/queue` re-POSTs a finished
  body with its own `fetch` and no signer, and a report written during an
  outage is delivered long after any sensible skew window anyway. Signing and
  queueing do not go together; pick one per endpoint.

With Express, mount the signed route **without** a body parser:

```ts
app.post("/api/bug-report", expressHandler({ signature: { key: signKey } }));
```

The signature covers the exact text the browser sent. `express.json()` hands
the adapter an object, which it has to re-serialise, and
`JSON.stringify(JSON.parse(x))` is not `x` — key order, spacing and number
formatting all move, and the HMAC moves with them. Without a parser the adapter
reads the raw stream itself and verifies what actually arrived.

Mount it the other way and every signed report is a 401 that looks exactly like
a forged one. So the adapter says so: the first such request calls `onError`
with a line naming `express.json()`, once per handler, and still answers the
same 401. Give `expressHandler` an `onError` — it is where the explanation
goes.

### Running more than one instance

Three things `handleReport` remembers between requests are a `Map` in the
process: the rate-limit buckets, the dedupe fingerprints and the replay cache.
That is honest and it is per instance. Two containers behind a load balancer
each hand out the whole allowance, store the same crash twice and keep separate
replay caches, and a serverless isolate that has just started remembers
nothing at all.

Each of them is a seam, and nothing is bundled: the store is your client, and
its methods may be synchronous or return promises.

```ts
// Redis-shaped, but any key-value store with a TTL does. `redis` here is
// whatever client you already have; bugbottle does not depend on one.
handleReport(req, {
  rateLimit: {
    limit: 20,
    windowMs: 60_000,
    store: {
      // Count this request and answer with the total inside the window.
      hit: async (key, windowMs) => {
        const count = await redis.incr(`bb:rl:${key}`);
        if (count === 1) await redis.pexpire(`bb:rl:${key}`, windowMs);
        return count;
      },
    },
  },
  dedupe: {
    windowMs: 60_000,
    store: {
      // Anything `get` answers with is a duplicate; expiry is the store's job.
      get: async (key) => {
        const value = await redis.get(`bb:dup:${key}`);
        return value === null ? undefined : (JSON.parse(value) as { id?: string });
      },
      set: async (key, entry, expiresAt) =>
        void (await redis.set(`bb:dup:${key}`, JSON.stringify(entry), "PXAT", expiresAt)),
    },
  },
  signature: {
    key: process.env.BUGBOTTLE_SIGN_KEY!,
    store: {
      has: async (digest) => (await redis.exists(`bb:sig:${digest}`)) === 1,
      // `expiresAt` is the epoch millisecond the signature stops being
      // acceptable anyway, so it is exactly how long the row needs to live.
      add: async (digest, expiresAt) =>
        void (await redis.set(`bb:sig:${digest}`, "1", "PXAT", expiresAt)),
    },
  },
});
```

All three are called `store`, inside `rateLimit`, `dedupe` and `signature`.
They were `rateLimitStore`, `dedupeStore` and `replayStore` until 0.9; those
names still work, are deprecated, and go in 1.0.

**Two of them fail open and one fails closed, and that is deliberate.** A
rate-limit store that throws lets the report through: refusing an honest
reporter with a `429` because Redis blinked loses the one report that was worth
having, and the error reaches `onError` so you find out. So does one whose
`hit` answers with anything but a finite number — `"3"`, `null`, nothing at
all — because `"3" > 30` is false and so is `NaN > 30`, and a limit switched
off in silence is worse than one that says so. A dedupe store that
throws lets it through as well, on both halves — a duplicate costs a row and an
email, a refusal costs the report — and so does one whose `get` answers with
something that is not an entry, since a raw unparsed value taken at face value
would make every report a duplicate. A signature store that throws answers `500`,
because the alternative is accepting a signature nobody managed to check
against what has already been seen, which is exactly the replay the cache
exists to stop.

Nothing else in `handleReport` keeps state between requests, so with all three
handed in, a fleet answers as one endpoint. Give each of them a key prefix of
its own, as above, and let the store expire the rows: every write says when it
stops mattering.

### The manual path

If you want to see and control every step — or you already have a handler —
call the validators yourself. This is the same sequence `handleReport` runs:

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

This too works unchanged in a Next.js route handler, Hono, Cloudflare Workers,
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

### An OpenAPI document

If your APIs are gated on an OpenAPI description, you do not have to write this
one. `bugbottle/openapi.json` is an OpenAPI 3.1 document generated at build
time from the same two sources as everything else on this page: the report
schema is its request body, ceilings and all, and its responses are the ones
`handleReport` gives — `201 { id }`, `202 {}` without a store, `200` for a
duplicate, and the `400`, `401`, `405`, `408`, `413`, `429` and `500` answers
with the `{ error }` they carry. The `X-Bugbottle-Signature` header is a
security scheme described for what it is: spam deterrence, not authentication.

```bash
curl -s https://bugbottle.dev/schema/openapi.json | jq .paths
```

```ts
import openapi from "bugbottle/openapi.json" with { type: "json" };
```

The path in it is `/api/bug-report`, the one this page's examples use. Yours is
wherever you mounted the route, so rename it after importing; nothing in the
library reads it. No server is listed, because there is no bugbottle server to
list — the endpoint is yours.

## Recipes

The endpoint is the same everywhere; only the sentence that produces a
`Request` differs. Here is that sentence, once per framework, with the file
path the framework expects. Checked in September 2026 by installing each
framework beside a packed `bugbottle` and running `tsc --noEmit` over the
snippet: Next 16.3.4, SvelteKit 2.70.3, Nuxt 4.5.2 (h3 1.15.11), Astro 7.3.1,
React Router 7.18.3 and 8.3.1, and Hono 4.13.7, all on TypeScript 5.9.

Deno, Bun and Cloudflare Workers are not on the list because they need no
recipe: they hand you a web `Request` and take a `Response`, so the first
example in [Receiving a report](#receiving-a-report) is already the whole
handler.

### Next.js (App Router)

`app/api/feedback/route.ts`:

```ts
import { handleReport, toResend } from "bugbottle/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleReport(request, {
    maxBodyBytes: 4 * 1024 * 1024,
    sinks: [
      toResend({
        apiKey: process.env.RESEND_API_KEY!,
        from: "bugs@acme.com",
        to: "team@acme.com",
      }),
    ],
  });
}
```

The line that matters is `runtime`. `"nodejs"` is the default and the one to
keep when `store` talks to a database; `"edge"` runs this handler unchanged,
since nothing in `bugbottle/server` needs a Node built-in. A route handler is
handed the body unparsed, so the Pages Router's `api.bodyParser.sizeLimit` has
nothing to do with it and `maxBodyBytes` is the only ceiling — and the bytes
reach `handleReport` exactly as they were sent, so `signature` verifies.
The client goes in a `"use client"` component rendered from the root layout.

### SvelteKit

`src/routes/api/feedback/+server.ts`:

```ts
import type { RequestHandler } from "@sveltejs/kit";
import { handleReport, toWebhook } from "bugbottle/server";

export const POST: RequestHandler = ({ request }) =>
  handleReport(request, {
    maxBodyBytes: 4 * 1024 * 1024,
    sinks: [toWebhook({ endpoint: process.env.SLACK_WEBHOOK_URL!, format: "slack" })],
  });
```

The export is named after the method and typed `RequestHandler`; `./$types`
gives the same type once `svelte-kit sync` has run, and `$env/dynamic/private`
is the SvelteKit way to read the same variable as `process.env`. `event.request`
is the untouched web `Request`, so signing works.
The client goes in `+layout.svelte`, inside `onMount`.

### Nuxt

`server/api/feedback.post.ts`:

```ts
import { defineEventHandler, toWebRequest } from "h3";
import { handleReport, toGithub } from "bugbottle/server";

export default defineEventHandler((event) =>
  handleReport(toWebRequest(event), {
    maxBodyBytes: 4 * 1024 * 1024,
    sinks: [
      toGithub({
        token: process.env.GITHUB_TOKEN!,
        owner: "acme",
        repo: "app",
        labels: ["bug"],
      }),
    ],
  }),
);
```

The line that matters is `toWebRequest(event)`: Nitro hands you an `H3Event`
rather than a `Request`, and that turns one into the other. `.post.ts` in the
filename is the method, so there is no `if` to write. Nuxt auto-imports both
functions — the import line is for the type-checker and for whoever reads the
file. The raw body survives as long as nothing called `readBody(event)` first,
which consumes the stream signing needs.
The client goes in a `.client.ts` plugin under `plugins/`.

### Astro

`src/pages/api/feedback.ts`:

```ts
import type { APIRoute } from "astro";
import { handleReport, toLinear } from "bugbottle/server";

export const prerender = false;

export const POST: APIRoute = ({ request }) =>
  handleReport(request, {
    maxBodyBytes: 4 * 1024 * 1024,
    sinks: [
      toLinear({ apiKey: process.env.LINEAR_API_KEY!, teamId: process.env.LINEAR_TEAM_ID! }),
    ],
  });
```

`export const prerender = false` is the line to remember: in a static build an
endpoint without it is run once at build time and there is nothing left to POST
to. It needs an adapter, so the route runs on a server. `context.request` is
the web `Request` as it arrived, so signing works.
The client goes in a `<script>` in the layout — one island, no framework.

### React Router 7 (and Remix)

`app/routes/api.feedback.ts`:

```ts
import type { ActionFunctionArgs } from "react-router";
import { handleReport, toResend } from "bugbottle/server";

export async function action({ request }: ActionFunctionArgs) {
  return handleReport(request, {
    maxBodyBytes: 4 * 1024 * 1024,
    sinks: [
      toResend({
        apiKey: process.env.RESEND_API_KEY!,
        from: "bugs@acme.com",
        to: "team@acme.com",
      }),
    ],
  });
}
```

It is an `action`, not a `loader`: a loader only ever sees a GET. Remix v2 is
the same file with the import from `@remix-run/node`, and React Router's
framework mode generates the same shape as `Route.ActionArgs` in
`./+types/api.feedback` if you prefer the typed route. Nothing has read the
body when `action` runs, so signing works — leave `request.formData()` and
`request.json()` alone here.
The client goes in the root route's component, or in `entry.client.tsx`.

### Hono

Anywhere in the app:

```ts
import { Hono } from "hono";
import { handleReport, toWebhook } from "bugbottle/server";

const app = new Hono<{ Bindings: { SLACK_WEBHOOK_URL: string } }>();

app.post("/api/feedback", (c) =>
  handleReport(c.req.raw, {
    maxBodyBytes: 4 * 1024 * 1024,
    sinks: [toWebhook({ endpoint: c.env.SLACK_WEBHOOK_URL, format: "slack" })],
  }),
);

export default app;
```

`c.req` is Hono's own wrapper; `c.req.raw` is the web `Request` underneath it,
which is what `handleReport` wants. `Bindings` types `c.env` — on Workers those
are the bindings, on Node and Bun read `process.env` instead. The raw body is
untouched, so signing works, provided no middleware in front of this route has
already read it.
The client mounts wherever your HTML is served from; Hono only serves it.

### WordPress

No recipe: the plugin at
[github.com/mahope/bugbottle-wordpress](https://github.com/mahope/bugbottle-wordpress)
is the endpoint, the panel and an admin list of what arrived. One activation.

## Sending it somewhere

Storing the report is one thing; seeing it is another. Eleven sinks live in
`bugbottle/server`, ten of them a formatter over one `fetch` call and the
eleventh a small SMTP client, none with a dependency of its own. None of them reads your environment: the key, the URL
and the token are arguments, so it is visible at the call site where the secret
came from — and so nothing can drift into a browser bundle.

The eleven at a glance, before the prose walks through them one by one:

| Sink | Export | What you need | The picture | Self-hosted | One report becomes | Server bundle |
|---|---|---|---|---|---|---|
| Resend | `sendReportEmail` | An API key and a verified sender | Attached as `screenshot.png`, from the bytes you pass | No | An email | 5.6 kB |
| SMTP | `smtpSink`, `sendReportSmtp` | A host, a port and an account | A link, from `screenshotUrl` | Yes — any mail server you can reach | An email | 7.8 kB |
| Webhook | `sendReportWebhook` | A URL, and headers if it wants them | Whatever the report carried: `json` passes it through untouched | Yes — the endpoint is yours | A POST of the report plus its Markdown | 4.5 kB |
| Slack | `slackSink` | An incoming-webhook URL | A link, in an `image` block | No | A Block Kit message | 2.4 kB |
| Discord | `discordSink` | A webhook URL | A link, as the embed's image | No | One embed, coloured by report type | 2.4 kB |
| Teams | `teamsSink` | A Workflows webhook URL | A link, in an `Image` element | No | An Adaptive Card | 2.7 kB |
| GitHub | `createGithubIssue` | A fine-grained token with issues write | A link from the body | No — github.com only | An issue | 4.7 kB |
| GitLab | `gitlabSink` | A token with `api` scope and a project id | A link from the facts table | Yes — pass `host` | An issue | 4.9 kB |
| Jira | `jiraSink` | A site, the account email, an API token and a project key | A link, as a fact | No — Jira Cloud's v3 API | An issue | 2.9 kB |
| Linear | `createLinearIssue` | An API key and the team's UUID | A link from the description | No | An issue | 4.8 kB |
| Sentry | `sentrySink` | A DSN | Attached, in the same envelope | Yes — GlitchTip and Bugsink speak the same protocol | An event, or a feedback item | 4.2 kB |

The sizes are a server bundle that imports that one export and nothing else,
minified and gzipped: `node scripts/measure-sinks.mjs` reproduces them, and
these were measured on 8 September 2026 with esbuild 0.24.0. The four small
ones build their own structure — blocks, an embed, a card, a node tree — while
the rest render the report with `toMarkdown`, which is most of the difference.
None of the numbers is a budget CI enforces; they are here so the cost of a
sink is known before it is imported, and every one of them is dwarfed by the
framework already in a server bundle.

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

When the report carries a `contact` line that looks like an email address, it
becomes the mail's `reply_to`, so answering the report answers the person who
wrote it. A line that is not an address — "call me on 12345678" — is left in
the body as a fact row and no `reply_to` is sent, because Resend refuses the
whole send rather than ignoring one. Pass `replyTo` to override the address,
or `replyTo: false` to send none at all.

`sendReportWebhook` posts to anything with a URL. `json` sends the report as it
arrived plus a `markdown` field, which is what Make, n8n and your own intake
endpoint want; `slack` sends `{ text }` and `discord` sends `{ content }`,
clipped to the 2000 characters Discord accepts:

```ts
import { sendReportWebhook } from "bugbottle/server";

await sendReportWebhook(payload, {
  endpoint: process.env.SLACK_WEBHOOK_URL!,
  format: "slack",
});
await sendReportWebhook(payload, {
  endpoint: process.env.DISCORD_WEBHOOK_URL!,
  format: "discord",
});
await sendReportWebhook(payload, {
  endpoint: process.env.INTAKE_URL!,
  headers: { "X-Token": process.env.INTAKE_TOKEN! },
});
```

The address was `url` until 0.9, where everything else in the package calls it
`endpoint`. That name still works and is deprecated; it goes in 1.0. A vendor's
own address keeps the vendor's own word — `webhookUrl` for the Slack, Discord
and Teams sinks below, `host` for GitLab, `site` for Jira, `dsn` for Sentry.

### Your own SMTP server

`smtpSink` is the same email without Resend. Most people running their own
endpoint already have an SMTP account — their host's, Postmark's, Mailgun's, a
Postfix or Stalwart box on the same machine — and no reason to sign up for
anything to send one message a day. It speaks the protocol itself over
`node:net` and `node:tls`: EHLO, STARTTLS when the server offers it, AUTH,
one message, QUIT. Zero dependencies, like everything else here, and Node-only
— it is the one sink that needs those two modules, and nothing else in
`bugbottle/server` imports it, so a worker runtime is unaffected until you ask
for it by name.

```ts
import { handleReport, smtpSink } from "bugbottle/server";

export async function POST(req: Request) {
  return handleReport(req, {
    sinks: [
      smtpSink({
        host: "smtp.example.com",          // your account, your configuration
        port: 587,                         // 465 for implicit TLS, 587 for STARTTLS
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
        from: "bugs@example.com",
        to: ["team@example.com", "ops@example.com"],
        timeoutMs: 10_000,                 // per phase, not for the whole conversation
      }),
    ],
  });
}
```

The subject, the intro and the `Reply-To` work exactly as they do for Resend:
the subject comes from the report's title and the locale unless you pass
`subject`, and a `contact` line that looks like an address becomes the
`Reply-To` so answering the mail answers the person who wrote the report.
`replyTo` overrides it and `replyTo: false` sends none. The body is a
`multipart/alternative` of the report as plain text and the same report
labelled `text/markdown`, so a mail client shows the readable half and a script
that fetches the mailbox back out gets the Markdown with its tables intact.
There are no attachments: store the screenshot yourself and pass
`screenshotUrl`, which is linked from the facts table.

`port` decides the rest. Left unset it is 587, and `secure` follows it: true
for 465, where TLS starts with the first byte, and false otherwise, where the
connection upgrades itself as soon as the server advertises STARTTLS. `tls`
is handed to `tls.connect`, for a self-signed certificate on a box you run
(`tls: { rejectUnauthorized: false }`) or a pinned CA. A refusal throws
`SinkError` with the server's own reply code and line — `550 5.1.1 …
Recipient address rejected` reaches your log as it was said — and a failure
that never got a reply, such as a hang or a refused connection, throws one with
a status of `0`.

**AUTH is refused over a connection that is not encrypted.** If the server
offers no STARTTLS and you did not connect on an implicit-TLS port, the
password would go to the wire in base64, which is not encryption: every hop
between you and the mail server could read it, and one of those hops is
whatever else runs on the network. So the sink throws before sending anything
rather than authenticating in the clear. `allowInsecureAuth: true` switches
that off, and it is meant for exactly one case — a mail server on the same
host, reached over the loopback interface, that wants a password anyway. If you
find yourself setting it for a server somewhere else, the answer is a port that
does TLS, not the flag.

**The report itself is refused in the clear too, on the ports that carry mail
across a network.** STARTTLS is advertised in an EHLO reply nothing has
authenticated yet, so anything on the path can strip it out of the list and the
conversation carries on unencrypted — with the whole report in it. Where no
credentials are set, the AUTH refusal above never fires and nothing else would
notice. So `requireTls` gives up before MAIL FROM when the connection never
became encrypted. Left unset it is true on the submission port (587) and
whenever `user` and `pass` are set, and false otherwise, which leaves the relay
on `localhost:25` working as it did; `allowInsecureAuth` lowers the default
with it, because it already names a server you decided to trust. Set
`requireTls: true` on any other port that leaves the machine, and
`requireTls: false` only for a server you can see from where you are standing.

Credentials never reach a log or an error message: an AUTH failure is reported
with the server's reply, never with what was sent, because the base64 of an
AUTH LOGIN step is the password in a thin disguise.

`timeoutMs` is a deadline on every phase, and that includes the writes: a
server that stops reading closes its TCP window rather than saying anything,
and without a deadline there the message body would stall for ever. Nothing in
the conversation can now block longer than one phase's worth.

### Slack and Discord

A report that lands in the team's chat within a second is a report that gets
read. `slackSink` and `discordSink` are the richer version of the two webhook
formats above: instead of a wall of Markdown they post one structured message
per report — the title, the message, the facts in columns, the last five
console entries, the picture when there is a URL for it, and a button to the
full report. Both are factories, so they go straight into `sinks`:

```ts
import { handleReport, slackSink, discordSink } from "bugbottle/server";

export const POST = (req: Request) =>
  handleReport(req, {
    screenshot: async (bytes) => await putPrivate(bytes),   // returns a URL
    store: async (report) => await db.reports.insert(report),
    sinks: [
      slackSink({
        webhookUrl: process.env.SLACK_WEBHOOK_URL!,   // the URL is the credential
        username: "bugbottle",
        iconEmoji: ":beetle:",
        // Both are optional, and both are functions of the report, so the URL
        // can be built from whatever you stored.
        screenshotUrl: (r) => signedUrlFor(r),
        reportUrl: (r) => `https://app.acme.com/reports/${idOf(r)}`,
      }),
      discordSink({
        webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
        reportUrl: (r) => `https://app.acme.com/reports/${idOf(r)}`,
      }),
    ],
  });
```

Slack gets a Block Kit message: a header, the message as `mrkdwn` with `&`,
`<` and `>` escaped, a section of up to ten fields, the console in a fenced
block, an `image` block, a `context` line with the time and the selector the
reporter pointed at, and an `actions` button. Discord gets one embed, coloured
by report type — red for a bug, green for an idea, grey for anything else —
with the same facts as fields, the screenshot as `image`, the report link as
the embed's `url`, and the selector in the footer.

Both services cap everything they are given: 50 blocks and 3000 characters per
text object on Slack, 6000 characters across an embed on Discord. Every one of
those is a clip rather than a failure — a report that arrives truncated is
still read, and a report that 400s because a stack trace was one character too
long is not. On Discord the description is what gives way first, because the
facts are what somebody triages from.

Neither service will fetch a data URL, so a screenshot only appears when you
have stored the picture and can hand back an address. Read "Please read this
part" before that address becomes a public one: a link in a channel is only as
private as what it points at, and a chat workspace is a wider audience than an
issue tracker.

Both take an injected `fetch`, so a test asserts the payload without a network,
and both use the `AbortSignal` `handleReport` hands them, so `sinkTimeoutMs`
really does end the request. If you would rather post the message yourself —
through a bot token, into a thread — `buildSlackMessage(report, options)` and
`buildDiscordMessage(report, options)` return the body without sending it.

### Microsoft Teams

`teamsSink` is the same idea for a Teams channel, with one wrinkle: the Office
365 connector webhooks that used to take a card are retired. The way in now is
a **Workflows** webhook — in the channel menu, *Workflows* → "Post to a channel
when a webhook request is received" — which gives you a URL that expects a Bot
Framework message with an Adaptive Card attached. The sink builds both:

```ts
import { handleReport, teamsSink } from "bugbottle/server";

export const POST = (req: Request) =>
  handleReport(req, {
    screenshot: async (bytes) => await putPrivate(bytes),   // returns a URL
    store: async (report) => await db.reports.insert(report),
    sinks: [
      teamsSink({
        webhookUrl: process.env.TEAMS_WEBHOOK_URL!,   // the URL is the credential
        // Both are optional, and both are functions of the report, so the URL
        // can be built from whatever you stored.
        screenshotUrl: (r) => signedUrlFor(r),
        reportUrl: (r) => `https://app.acme.com/reports/${idOf(r)}`,
        buttonText: "Open report",                    // the default
      }),
    ],
    respond: ({ id }) => Response.json({ id }, { status: 201 }),
  });
```

The card is schema 1.5: a bold title, the message as a wrapping `TextBlock`,
the facts as a `FactSet`, the last five console entries in a monospace block,
an `Image` when there is a URL to fetch, a subtle line with the time and the
selector, and an `Action.OpenUrl` when you give a `reportUrl`. A `TextBlock`
renders a subset of Markdown, so every string is escaped into plain text first
— `*.tsx` stays `*.tsx` rather than turning half the card italic. There are no
inputs and no `Action.Submit`: a webhook has nowhere to send an answer.

Workflows replies `202 Accepted` with an empty body, so the sink treats every
2xx as success. That 202 means the flow was queued and not that the card
rendered — if nothing appears in the channel, look at the flow's run history in
Power Automate rather than at the status code.

A Workflows message is capped at **28 kB**, and Teams refuses a larger one
outright rather than clipping it for you. No report can reach that on its own —
report-core has already clipped the message to 4000 characters, the page and
the user agent to 500, and five console entries to 500 each — but a screenshot
address is whatever your storage hands back, and a long enough one leaves no
room. So the card is measured before it is sent and, while it is over,
the console goes first, then the facts from the back, then the reporter's own
words: the console is in the stored report in full, and a truncated sentence
still says what went wrong.

Teams fetches the picture itself, so a data URL is ignored here too, and "Please
read this part" applies with more force than anywhere else in this section: a
channel is the widest audience a report gets. `buildTeamsMessage(report,
options)` returns the message without sending it, if you would rather post it
through a bot.

### Sentry, GlitchTip and Bugsink

If your team already runs Sentry, bugbottle can be the feedback layer over it
rather than a second place to look. `sentrySink` posts one envelope per report
to the DSN's ingest endpoint — the same protocol GlitchTip and Bugsink speak,
so a self-hosted install works with nothing changed but the DSN. There is no
Sentry SDK behind it: one `fetch` and a formatter, like every other sink.

```ts
import { handleReport, sentrySink } from "bugbottle/server";

export const POST = (req: Request) =>
  handleReport(req, {
    // The bytes are handed to the sink, so the picture travels in the envelope
    // rather than as a link to storage you had to arrange first.
    screenshot: "keep",
    store: async (report) => await db.reports.insert(report),
    sinks: [
      sentrySink({
        dsn: process.env.SENTRY_DSN!,
        release: process.env.BUILD_SHA,
        environment: "production",
        // Optional, and functions of the report, so they come from whatever
        // your application knew about the person who reported.
        contactEmail: (r) => emailOf(r),
        contactName: (r) => nameOf(r),
      }),
    ],
  });
```

What arrives is an event with the report's message, `level` `error` for a bug
and `info` for an idea or anything else, `tags` for the type, the page and the
viewport, and a `contexts.feedback` carrying the message, the page and the
contact details — which is what Sentry ≥ 24.x shows as User Feedback. The
evidence travels as breadcrumbs, in one timeline sorted oldest first: the
console buffer as `console` breadcrumbs with `warn` respelt as Sentry's
`warning`, the recorded clicks, submits, navigations and visibility changes as
`ui.*` and `navigation`, and the failed and slow requests as `http` breadcrumbs
with `url`, `method`, `status_code` and `duration`. The pointed-at elements and
the optional context facts go in `extra`. The screenshot is an attachment item
in the same envelope, `screenshot.png`, which is the one delivery in this
library that carries the picture itself.

Everything is capped, and every cap is a clip rather than a failure: a hundred
breadcrumbs, 8 kB of message (4096 characters in the feedback context, which is
that spec's own limit) and a megabyte of envelope. When the envelope is over,
the attachment goes first and the breadcrumbs second, and what went is written
on the event as a `bugbottle_truncated` tag so the reader knows the event is
not the whole report.

Two things are worth knowing before you wire it up. The first is that the sink
sends an `event` item by default rather than the `feedback` item Sentry's
feedback specification describes: the feedback item is what puts a report in
Sentry's own User Feedback list, but GlitchTip and Bugsink do not know the type
and drop what they cannot parse. Pass `itemType: "feedback"` on a real Sentry
to opt into it — where it is also a separate rate-limit category from your
errors. The second is that a 429 is answered honestly: `SentrySinkError`
carries `retryAfter` in seconds (sixty when the server sent no usable header,
which is what Sentry's transport specification says to assume) and the raw
`X-Sentry-Rate-Limits`, so a caller can back off with a number rather than a
guess. It is still a `SinkError`, so a handler that catches those catches this.

A DSN with a typo in it throws when the sink is built rather than on the first
report, so a mistake fails where it was written down. And if you would rather
send the envelope yourself — through a proxy, or with a Sentry SDK already on
the server — `buildSentryEvent(report, options)` returns the event for
`captureEvent` and `buildSentryEnvelope(report, options)` returns the bytes.

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

`createLinearIssue` does the same for Linear, which is where a lot of small
teams already track what is broken. Linear takes ids rather than names, so the
team, the project and the labels are UUIDs from your workspace, and the API key
goes in the header as it is — no `Bearer` prefix:

```ts
import { createLinearIssue } from "bugbottle/server";

const { identifier, url } = await createLinearIssue(payload, {
  apiKey: process.env.LINEAR_API_KEY!,
  teamId: "6f0a…",                       // required
  projectId: "b21c…",                    // optional
  labelIds: ["9d4e…"],                   // optional
  screenshotUrl,                         // where you stored the picture
});
```

The title and the body follow the same rules as the GitHub sink, and Linear
cannot take an attachment either, so `screenshotUrl` is again a link to storage
you control.

Linear answers over GraphQL, which fails differently from the rest: a rejected
mutation still comes back with a `200` and puts the reason in an `errors`
array. The sink reads it and throws `SinkError` anyway, so a mistyped team id
is a failure you can see rather than an issue that was never created.

### Jira Cloud

`jiraSink` files the report in a Jira project. It is a factory like the chat
sinks, so it goes straight into `sinks`, and it is the one sink here that does
not send Markdown: Jira Cloud's REST v3 takes the Atlassian Document Format in
`description`, a JSON node tree rather than text. The conversion is built from
the report and kept to three shapes — a paragraph for the reporter's own words,
a bullet list for the facts and the element, and a code block for the last
twenty console entries. Where the reporter pressed return, the paragraph gets a
`hardBreak` node, because ADF has no newline inside a text node and a message
that carried one would be collapsed onto a single line or refused outright:

```ts
import { handleReport, jiraSink } from "bugbottle/server";

export const POST = (req: Request) =>
  handleReport(req, {
    screenshot: async (bytes) => await putPrivate(bytes),   // returns a URL
    store: async (report) => await db.reports.insert(report),
    sinks: [
      jiraSink({
        site: "acme",                          // or acme.atlassian.net, or the full URL
        email: process.env.JIRA_EMAIL!,        // the account the token belongs to
        apiToken: process.env.JIRA_API_TOKEN!,
        projectKey: "SUP",
        issueType: "Bug",                      // default; must exist in the project
      }),
    ],
    respond: ({ id }) => Response.json({ id }, { status: 201 }),
  });
```

The two credentials are the basic auth pair Jira wants, base64-encoded here and
UTF-8 safe, so a token with an accent in it does not throw on the way out. The
summary is the report's type and its first line — `Bug: The save button does
nothing` — clipped to the 255 characters Jira keeps, unless you pass `title`.
`facts` adds bullets of your own, and `maxConsoleEntries` shortens the code
block, which Jira renders in full with no way to collapse it. A `contact` line
on the report is the bullet directly under the type, where the Markdown sinks
put it too.

A refused create names the field: Jira answers with an `errorMessages` list and
an `errors` object keyed by field, and both are joined into the `SinkError`
message, so "issuetype: Specify an issue type" is what you read rather than
"status 400". `buildJiraDescription(report)` returns the document on its own if
you would rather send it yourself.

Jira cannot take the picture in the create request either — attachments are a
second, multipart request against the new issue — so the screenshot is stored
by you first and `screenshotUrl` becomes one of the facts. `handleReport`
passes the URL its `screenshot` function returned, so the option is only needed
when you send the report yourself.

### GitLab

`gitlabSink` is the simplest of the issue sinks, because a GitLab description
is Markdown and `toMarkdown` already produces it: the body goes over verbatim,
facts table and collapsed console block and all. Self-hosted GitLab is the same
API on another host, so `host` is an option and defaults to gitlab.com:

```ts
import { handleReport, gitlabSink } from "bugbottle/server";

export const POST = (req: Request) =>
  handleReport(req, {
    screenshot: async (bytes) => await putPrivate(bytes),   // returns a URL
    store: async (report) => await db.reports.insert(report),
    sinks: [
      gitlabSink({
        host: "https://gitlab.example.com",    // omit for gitlab.com
        projectId: "acme/app",                 // or the numeric id
        token: process.env.GITLAB_TOKEN!,      // personal, group or project, `api` scope
        labels: ["bug", "from-bugbottle"],
      }),
    ],
    respond: ({ id }) => Response.json({ id }, { status: 201 }),
  });
```

The token travels in GitLab's own `PRIVATE-TOKEN` header rather than in
`Authorization`. A namespaced `projectId` is URL-encoded into the one path
segment, so `acme/app` reaches the API as `acme%2Fapp` instead of being read as
two segments. Labels are joined with commas, which is the shape the API takes,
and GitLab creates the ones that do not exist yet.

One thing to know when a report does not arrive: GitLab answers `404` rather
than `403` for a project the token cannot see, so a wrong project and a
too-narrow scope look alike from the outside. The `SinkError` message is
GitLab's own — `404 Project Not Found`, or `title: can't be blank` for a
validation failure, which arrives as an object keyed by field.

GitLab cannot take the picture in the create request either: an upload is a
separate request whose answer you then reference from the Markdown. So the
screenshot is stored by you first and `screenshotUrl` is linked from the facts
table, the same as for GitHub and Linear.

All eleven throw `SinkError`, carrying the HTTP status and the response body —
or, for SMTP, the reply code and the server's own line — when the service
answers with anything but success. Catch it around the sink
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

The optional contact field is personal data you asked for: store it like one —
keep it where the rest of the report is kept, delete it when the report goes,
and pass `scrubReport(report, { contact: true })` if reports end up anywhere
more public than the inbox.

The context is the mild part of a report by comparison. It is the page path and
query, the viewport, the user agent, and — when the browser offers them — the
language, the time zone, the screen size and pixel ratio, the colour scheme,
whether the browser thought it was online, and the effective connection type.
Together they say which environment the bug happened in; none of them says more
about the person than the user agent already does, and nothing is collected
beyond that list: no canvas, no fonts, no device enumeration, no identifier of
any kind. The origin and the fragment of the URL are still left out.

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

Three limits worth knowing before you rely on it:

- **A closed shadow root cannot be masked.** Masking walks open shadow roots,
  so an input inside an ordinary web component is covered. A component that
  attached its root with `{ mode: "closed" }` exposes no `shadowRoot` to walk,
  and nothing inside it can be reached — by us or by anything else. Use
  `exclude` on the host element instead.
- **A focused textarea loses its caret position during the capture.** Swapping
  the value for bullets and back moves the selection to the end of the field.
  The text is unchanged; the cursor is not where it was.
- **A blocked replaced element is hidden rather than overlaid.** An `img`,
  `canvas`, `video`, `iframe`, `input`, `embed`, `object` or `svg` renders no
  children, so `data-bugbottle-block` hides the element for the length of the
  render and draws the rectangle over the box it occupied. The layout still
  holds, but the covered area is a flat rectangle rather than the element with
  a rectangle on top of it.

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
whole), `keep` (built-ins to switch off by name), `replacement`, and `contact`:

```ts
scrubReport(report, {
  patterns: [/\bACME-\d+\b/g],
  keep: ["email"],          // "email" | "bearer" | "jwt" | "card" | "iban" | "query"
  replacement: "[redacted]",
  contact: true,            // redact the contact line, whole. Off by default.
});
```

`contact` is the one scrubber that is off unless you ask, and the only one that
replaces a whole field rather than what matched: an address the reporter typed
into a field asking for one is not a leak, and redacting it by default would
break the feature it belongs to — but a phone number or a handle is not caught
by any pattern, so when reports go somewhere more public than the inbox, the
line goes whole or not at all.

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
  "contact": "anna@example.com",       // only when the form asked and they answered
  "context": {
    "url": "/orders/42?tab=notes",     // path and query; no origin, no fragment
    "viewport": "1440x900",
    "userAgent": "Mozilla/5.0 …",
    "language": "en-GB",               // everything below is best-effort and
    "timezone": "Europe/Copenhagen",   // left out when the browser has no answer
    "screen": "2560x1440@2",
    "colorScheme": "dark",             // "dark" | "light"
    "online": true,
    "connection": "4g"
  },
  "console": [                         // bugs only by default, newest last
    { "ts": "2026-09-07T08:12:31.004Z", "level": "error", "message": "TypeError: …",
      "stack": [                       // uncaught errors and rejections only, max 10
        { "file": "https://app.test/assets/main.js", "line": 12, "col": 9, "fn": "saveOrder" }
      ] }
  ],
  "elements": [                        // only when the reporter pointed at something
    { "selector": "form#checkout > button:nth-of-type(2)", "tag": "button", "text": "Save order",
      "rect": { "x": 912, "y": 640, "width": 118, "height": 36 }, "attributes": { "type": "submit" } }
  ],
  "breadcrumbs": [                     // only while bugbottle/breadcrumbs is recording
    { "ts": "2026-09-07T08:12:30.400Z", "kind": "navigation", "from": "/orders/1", "to": "/orders/2" }
  ],
  "network": [                         // only while bugbottle/network is recording
    { "ts": "2026-09-07T08:12:31.004Z", "method": "POST", "url": "/api/orders", "status": 500, "ms": 812 }
  ],
  "replay": {                          // only while bugbottle/rrweb is recording
    "events": [{ "type": 2, "timestamp": 1757232751004, "data": {} }], "seconds": 31
  },
  "notes": [                           // the library's own words about the report,
    "Screenshot dropped: it did not fit in the offline queue."   // max 5, 200 chars
  ],
  "screenshotDataUrl": "data:image/png;base64,…"   // only when attached
}
```

The same shape as a JSON Schema (2020-12), generated from the TypeScript types
at build time so it cannot drift from what the library sends:
[bugbottle.dev/schema/report.json](https://bugbottle.dev/schema/report.json),
shipped in the package as `bugbottle/report.schema.json`. It carries the JSDoc
as `description`s and the `MAX_*` ceilings as `maxLength`/`maxItems`, so a
receiver written in another language can enforce the same limits the validators
do. Extra top-level fields are allowed, exactly as `handleReport` allows them.

```ts
import Ajv from "ajv/dist/2020.js";
import schema from "bugbottle/report.schema.json" with { type: "json" };

const valid = new Ajv().compile(schema)(payload);
```

## API

**`bugbottle`** — `initConsoleBuffer`, `getConsoleBuffer`, `resetConsoleBuffer`,
`captureScreenshot` (with `CaptureInfo`, `DEFAULT_BYTES_PER_PIXEL_ESTIMATE` and
the `MaskOptions` of its `mask` option, whose defaults are
`DEFAULT_MASK_SELECTOR`, `DEFAULT_BLOCK_SELECTOR` and `DEFAULT_MASK_COLOUR`),
`collectContext`, `pickElement`, `describeElement`, `buildSelector`,
`buildReport`, `sendReport`, `scrubReport`, `scrubUrl`, `BUILTIN_SCRUBBERS`,
`fingerprint`, `stableHash`,
`ScreenshotTooLargeError`, `SendFailedError`, `SendTimeoutError`,
`toMarkdown` (with `MarkdownOptions`; it and the validators live in
`bugbottle/server` as well, which is where they belong — see
`docs/api-audit-1.0.md`), the server
validators below, and the shared types and limits — including the `StackFrame`
type, `MAX_STACK_FRAMES`, `MAX_STACK_STRING_LENGTH`, `MAX_CONTACT_LENGTH` and
`MAX_CONTEXT_LENGTHS`.

The option and payload types come with them: `BugReport`, `ReportContext`,
`ReportType`, `ConsoleEntry`, `ConsoleLevel`, `ElementRef`, `Breadcrumb`,
`BreadcrumbKind`, `NetworkEntry`, `PerfSnapshot`, `StorageSnapshot`,
`StorageKeyRef`, `ReplayCapture`, `ReplayEvent`, `BuildReportInput`,
`SendOptions`, `SendResult`, `CaptureOptions`, `ConsoleBufferOptions`,
`PickOptions`, `ScrubOptions`, `Scrubber`, `ScrubberName`, `FingerprintInput`,
and the two defaults `DEFAULT_SEND_TIMEOUT_MS` (15 s) and `DEFAULT_REPLACEMENT`
(what a scrubber writes in place of what it found).

**`dist/bugbottle.js`** — the everything script-tag build: `window.bugbottle` with
`mount`, `initConsoleBuffer`, `initBreadcrumbs`, `initNetwork`, `initPerf`,
`createQueue`,
`locales`,
`resolveLocale`, `scrubReport`, `createSigner`, `buildReport`, `sendReport`,
`pickElement`,
`onShortcut`, `onUncaughtError`, `onShake`, `requestShakePermission`,
`version`, and
`data-*` auto-mount. See "One script tag".

**`dist/bugbottle.slim.js`** — the same build without `createAnnotator`,
`initPerf`, `onShake`, `requestShakePermission` and `initNetwork`, and so
without `data-annotate`, `data-perf`, `data-shake` and `data-network`, which it
warns about once on the console. See "Two builds".

**WordPress** — the plugin at
[github.com/mahope/bugbottle-wordpress](https://github.com/mahope/bugbottle-wordpress)
bundles this build, adds the receiving endpoint, stores reports as a private
post type with an admin list, and emails them if you want. One activation.

**`bugbottle/annotate`** — `createAnnotator`, and the `Annotator`,
`AnnotatorOptions` and `AnnotateTool` types. See "Marking the picture".

**`bugbottle/breadcrumbs`** — `initBreadcrumbs`, `getBreadcrumbs`,
`resetBreadcrumbs`, `isBreadcrumbsActive`, and the `BreadcrumbsOptions` type.

**`bugbottle/network`** — `initNetwork`, `getNetwork`, `resetNetwork`,
`isNetworkActive`, and the `NetworkOptions` and `NetworkEntry` types.

**`bugbottle/perf`** — `initPerf`, `getPerf`, `getStorageSnapshot`,
`resetPerf`, `isPerfActive`, and the `PerfOptions`, `PerfSnapshot`,
`StorageSnapshot` and `StorageKeyRef` types. See "Performance and storage".

**`bugbottle/queue`** — `createQueue`, `SCREENSHOT_NOTE`, and the `Queue`,
`QueueOptions`, `QueueStorage`, `QueuedReport` and `MaybePromise` types. See
"When the network is down".

**`bugbottle/queue-idb`** — `createIdbStorage` and the `IdbStorageOptions`
type: the queue's reports in IndexedDB rather than `localStorage`, where a
screenshot fits. See "When the network is down".

**`bugbottle/rrweb`** — `attachRrweb`, `getReplay`, `resetRrweb`,
`isRrwebAttached`, `DEFAULT_REPLAY_SECONDS`, `DEFAULT_REPLAY_MAX_BYTES`,
`REPLAY_CHECKOUT_MS`, `REPLAY_MASK_SELECTOR`, `REPLAY_BLOCK_SELECTOR`, and the
`RrwebOptions`, `RrwebRecord`, `RrwebRecordOptions`, `RrwebEvent`,
`ReplayCapture` and `ReplayEvent` types. See "Replay with rrweb".

**`bugbottle/sign`** — `createSigner`, `computeSignature`, `hmacHex`,
`DEFAULT_SIGNATURE_HEADER`, and the `SignerOptions` type. See "Signing
requests".

**`bugbottle/triggers`** — `onShortcut`, `onUncaughtError`, `parseShortcut`,
`matchesShortcut`, `isEditableTarget`, `eventSource`, `deepActiveElement`,
`isApplePlatform`, `describeUncaught`,
`DEFAULT_SHORTCUT`, `DEFAULT_DEDUPE_MS`, and the `Shortcut`, `ShortcutEvent`,
`ShortcutOptions`, `UncaughtError`, `UncaughtErrorOptions` and `ListenerHost`
types.

**`bugbottle/shake`** — `onShake`, `requestShakePermission`,
`DEFAULT_SHAKE_THRESHOLD`, `DEFAULT_SHAKE_COOLDOWN_MS`,
`DEFAULT_SHAKE_WINDOW_MS`, and the `ShakeOptions` and `ShakeEvent` types. See
"Shake to report".

**`bugbottle/react`** — `useBugReport`, `BugReportBoundary`,
`createRootErrorHandlers`, `describeRenderError`, and the
`BugReportBoundaryProps`, `ReportErrorOptions`, `RootErrorHandlerOptions` and
`RootErrorHandlers` types.

**`bugbottle/vue`** — `useBugReport`, a composable over refs, and the
`UseBugReportOptions` and `BugReportStatus` types. Optional peer `vue` >= 3.

**`bugbottle/svelte`** — `createBugReport`, a readable store plus the actions,
and the `BugReportView`, `UseBugReportOptions` and `BugReportStatus` types.
Optional peer `svelte` >= 4.

**`bugbottle/solid`** — `createBugReport`, accessors over the same machine plus
the actions, and the `UseBugReportOptions` and `BugReportStatus` types.
Optional peer `solid-js` >= 1.8.

**`bugbottle/html-to-image`** — `htmlToImage`, a `ScreenshotRenderer`.
Requires `html-to-image`.

**`bugbottle/ui`** — `mountBugbottle`, and the `MountOptions` (whose
`annotate` takes `createAnnotator` itself, whose `shake` takes `onShake`, and
whose `network` and `perf` take `initNetwork` and `initPerf`),
`Theme`, `Brand` and `BugbottleWidget` types.

**`bugbottle/locales`** — `en`, `da`, `sv`, `nb`, `de`, `nl`, `fr`, `es`,
`locales`, `resolveLocale`, `enMessages` (the English `messages` on their own,
so the hook can default without dragging eight languages in), and the `Locale`,
`Messages`, `UiTexts`, `EmailTexts` types.

**`bugbottle/locales-extra`** — `it`, `pl`, `pt`, `fi`, `uk` and
`localesExtra`, the five optional languages in the same `Locale` shape. Nothing
imports this entry, so a site that does not ask for it never carries it.

**`bugbottle/server`** — `handleReport`, `expressHandler`, `fileStore`
(with `DEFAULT_MAX_REPORTS` and the `FileStore`, `FileStoreOptions`,
`StoredReport` and `StoredReportFile` types), `toResend`,
`toWebhook`, `toGithub`, `toLinear`, `validateReport`, `collectExtra`, `resetRateLimits`,
`resetDedupe`, `resetSignatures`, `fingerprint`, `stableHash`,
`decodeScreenshotDataUrl`, `normaliseMessage`, `normaliseContact`,
`looksLikeEmail`,
`normaliseContext`, `normaliseConsole`, `normaliseElements`,
`normaliseBreadcrumbs`, `normaliseNetwork`, `normalisePerf`,
`normaliseStorage`, `normaliseReplay`, `normaliseNotes`, `isReportType`, `toMarkdown`,
`scrubReport`, `scrubUrl`,
`sendReportEmail`, `sendReportWebhook`, `createGithubIssue`,
`createLinearIssue`, `smtpSink`, `sendReportSmtp`, `buildMessage`,
`foldHeader`, `dotStuff`, `DEFAULT_SMTP_PORT`, `DEFAULT_SMTP_TIMEOUT_MS`,
`SMTP_TLS_PORT`, `SMTP_NO_REPLY`, the `SmtpSink`, `SmtpSinkOptions` and
`SendReportSmtpResult` types, `jiraSink`, `buildJiraDescription`, `jiraBaseUrl`,
`jiraAuthHeader`, `messageFromJiraBody`, `DEFAULT_JIRA_ISSUE_TYPE`,
`MAX_JIRA_CONSOLE_ENTRIES`, `MAX_JIRA_SUMMARY`, the `JiraSink`,
`JiraSinkOptions`, `CreateJiraIssueResult`, `AdfDoc` and `AdfNode` types,
`gitlabSink`, `messageFromGitlabBody`, `DEFAULT_GITLAB_HOST`,
`MAX_GITLAB_DESCRIPTION`, `MAX_GITLAB_TITLE`, the `GitlabSink`,
`GitlabSinkOptions` and `CreateGitlabIssueResult` types,
`slackSink`, `discordSink`, `teamsSink`, `buildSlackMessage`,
`buildDiscordMessage`, `buildTeamsMessage`, `escapeSlack`, `escapeTeams`,
`DISCORD_COLOURS`, `TEAMS_CARD_SCHEMA`, `TEAMS_CARD_VERSION`,
`TEAMS_CARD_CONTENT_TYPE`, the `MAX_SLACK_*`,
`MAX_DISCORD_*` and `MAX_TEAMS_*` limits (the vendor-first `SLACK_MAX_*` and
`DISCORD_MAX_*`
spellings still exist, deprecated, and go in 1.0), `MAX_CHAT_CONSOLE_ENTRIES`, the `SlackSinkOptions`,
`DiscordSinkOptions`, `TeamsSinkOptions`, `ChatSink`, `ChatSinkContext` and
`UrlFrom` types,
`sentrySink`, `buildSentryEvent`, `buildSentryEnvelope`, `parseSentryDsn`,
`sentryAuthHeader`, `clipBytes`, `SentrySinkError`, `SENTRY_CLIENT`,
`SENTRY_CLIENT_NAME`, `SENTRY_CLIENT_VERSION`, `SENTRY_VERSION`,
`DEFAULT_SENTRY_RETRY_AFTER`, the `MAX_SENTRY_*` limits, and the
`SentrySinkOptions`, `SentrySinkContext`, `SentryDsn`, `SentryEnvelope`,
`SentryItemType` and `SentryTruncation` types,
`InvalidScreenshotError`, `SinkError`, `SinkTimeoutError`, `REPORT_TYPES`,
the `DEFAULT_MAX_BODY_BYTES`, `DEFAULT_BODY_TIMEOUT_MS` and
`DEFAULT_SINK_TIMEOUT_MS` defaults, the `ValidatedReport`,
`HandleReportOptions`, `HandleReportResult`, `RateLimitOptions`,
`RateLimitStore`, `DedupeOptions`, `DedupeStore`, `DedupeEntry`,
`SignatureOptions`, `ReportSink` and
`SinkContext` and `ReplayStore` types, `DEFAULT_SIGNATURE_SKEW_MS`,
`MAX_SIGNATURE_ENTRIES`, `MAX_SIGNATURE_ENTRIES_PER_SECOND`,
`MAX_SIGNATURE_SECONDS`,
`BAD_SIGNATURE_ERROR`, the two refusal messages `EMPTY_MESSAGE_ERROR` and
`TOO_LARGE_ERROR`, the `StackFrame` type, and the `MAX_*` limits, including
`MAX_STACK_FRAMES`, `MAX_STACK_STRING_LENGTH`, `MAX_CONTEXT_LENGTHS`,
`MAX_EXTRA_KEYS`, `MAX_EXTRA_STRING_LENGTH`, `MAX_DEDUPE_ENTRIES`,
`MAX_RATE_LIMIT_BUCKETS` and `MAX_RATE_LIMIT_KEY_LENGTH`.

Each sink's options and result travel with it: `SendReportEmailOptions` and
`SendReportEmailResult`, `SendReportWebhookOptions` (and its
`SendReportWebhookTarget` and `WebhookFormat`) with `SendReportWebhookResult`,
`CreateGithubIssueOptions` with `CreateGithubIssueResult`,
`CreateLinearIssueOptions` with `CreateLinearIssueResult`, and the `FetchLike`
every one of them takes as `fetch`. `expressHandler` brings the two structural
types it reads an Express request and response through, `ExpressRequestLike`
and `ExpressResponseLike`.

**`bugbottle/report.schema.json`** — the JSON Schema for the payload, also
served at [bugbottle.dev/schema/report.json](https://bugbottle.dev/schema/report.json).

**`bugbottle/openapi.json`** — the OpenAPI 3.1 description of the report
endpoint, generated from that schema and from `handleReport`'s answers, also
served at [bugbottle.dev/schema/openapi.json](https://bugbottle.dev/schema/openapi.json).

Ships as ESM with TypeScript declarations. Node 18+ on the server; any
evergreen browser on the client.

## Releasing

`npm run release -- patch` (or `minor`/`major`) bumps the version, commits and pushes the tag.
CI publishes to npm and creates the GitHub release.

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

`examples/inbox` is the next step: the same round trip, but the reports stay.
A dependency-free Node server that receives them with `handleReport`, writes
each one to disk as JSON beside its PNG, and serves a read-only inbox — a
list, a detail page with the rendered Markdown and the picture, copy as
Markdown, delete — behind one password from `INBOX_PASSWORD`, which it refuses
to start without. Small enough to run one per client site on a €4 VPS behind
Caddy, and honest about being an example rather than a product: no accounts,
no search, no assignment.

```bash
npm run build
INBOX_PASSWORD=$(openssl rand -base64 24) node examples/inbox/server.mjs
```

It ships with a `Dockerfile`, a `compose.yml` and a `Caddyfile`, so putting one
on a VPS is `docker compose up` and a domain; its README walks through Dokploy
in eight lines. Reports land on a named volume, the image runs as a non-root
user and installs nothing, and `GET /health` is public for the platform's
check.

Read `examples/inbox/README.md` before you put one on the internet — the
screenshots are on disk, so the disk is the bucket the privacy section above
is about.

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
