bugbottle is one small piece of a crowded field, and it is not the most
capable thing in it. This page places it next to five tools people actually
reach for, so you can tell in a minute whether you want a library or a
product. Every figure below was checked on 7 September 2026 against the page
linked in its row; prices and features move, so follow the link before you
decide anything.

| Tool | Licence | Hosted or your endpoint | What it captures | Size in your bundle | Price |
|---|---|---|---|---|---|
| **bugbottle** | MIT, client and server helpers alike ([LICENSE](https://github.com/mahope/bugbottle/blob/main/LICENSE)) | Your endpoint. There is no bugbottle server to send anything to | Console errors and warnings, page context, the element pointed at, click and navigation breadcrumbs, failed and slow requests, an optional DOM screenshot the reporter can mark with a rectangle, an arrow or a destructive blur ([docs](/docs/)) | About 1.4 kB gzipped for the core, 5.5 kB for the React hook, 12 kB for the ready-made panel ([budgets in CI](https://github.com/mahope/bugbottle/blob/main/CONTRIBUTING.md)) | Free |
| **[Marker.io](https://marker.io)** | Commercial | Hosted. Reports land in Marker.io and are pushed to your tracker | Annotated screenshot, session replay, console and network logs, browser and environment details ([console logs](https://marker.io/blog/console-logs)) | Not published | From $39/mo; console, network and replay start on the $149/mo Team plan ([pricing](https://marker.io/pricing)) |
| **[Jam](https://jam.dev)** | Commercial | Hosted. A Jam is a link on jam.dev | Screen recording, console, network, device and browser details, the actions leading up to the bug, all from the moment you press record ([jam.dev](https://jam.dev)) | Nothing — it is a browser extension, not a script in your app | Free tier, then $14 per creator per month ([pricing](https://jam.dev/pricing)) |
| **[Sentry User Feedback](https://docs.sentry.io/platforms/javascript/user-feedback/)** | SDK is MIT ([sentry-javascript](https://github.com/getsentry/sentry-javascript)) | Sentry's ingest. The widget is yours to replace, the backend is not | The message plus screenshot and attachments, joined to the error, the release, the trace and the replay Sentry already has ([docs](https://docs.sentry.io/platforms/javascript/user-feedback/)) | Not published as one number: the widget is loaded on top of the browser SDK, which is the larger part | Free developer plan, then from $26/mo ([pricing](https://sentry.io/pricing/)) |
| **[BugPin](https://github.com/aranticlabs/bugpin)** | AGPL-3.0 server, MIT widget ([repository](https://github.com/aranticlabs/bugpin)) | Self-hosted: its own Bun, Hono and SQLite service, or nothing | Annotated screenshot, console errors, network activity, page metadata, with an offline queue in front of the send ([repository](https://github.com/aranticlabs/bugpin)) | Under 150 kB gzipped for the widget, in a shadow root ([repository](https://github.com/aranticlabs/bugpin)) | Free; you run the server |
| **[rrweb](https://github.com/rrweb-io/rrweb)** | MIT ([repository](https://github.com/rrweb-io/rrweb)) | Neither. It is a recording primitive with no backend and no UI | Every DOM mutation and input event, as a stream you replay later ([repository](https://github.com/rrweb-io/rrweb)) | Tens of kilobytes for the recorder, and the events keep arriving for as long as you record | Free |

## What the others do that bugbottle does not

Marker.io and Jam both hand a non-technical reporter something bugbottle
cannot: in Jam's case a video of what they did, and in both cases a place for
the report to land with a queue, an assignee and a history. bugbottle now has
the drawing — a rectangle, an arrow and a blur over the screenshot — but it
still ends at the JSON it posts to your endpoint. The nearest thing to a place
it lands is
[`examples/inbox`](https://github.com/mahope/bugbottle/tree/main/examples/inbox):
a dependency-free Node server that writes each report to disk and serves a
read-only list behind one password. That is an example you copy and own, not a
queue with owners and a history, and it is deliberately as far as this project
goes.

Neither needs a developer to install anything in the application at all — Jam
is a browser extension, which means it works on a site you do not own, and on
the third-party page your bug turned out to be on.

Sentry User Feedback is the tool to beat when you already run Sentry, because
it is the only one in this table that ties the sentence someone typed to the
stack trace, the release and the session replay of the same moment. bugbottle
sends a report; Sentry sends a report into a case file that was already open.

BugPin gives you the dashboard and the triage that bugbottle deliberately
does not ship, and you can still run it on your own hardware. rrweb records
far more than bugbottle ever will: it is the recorder underneath several of
the products above, and if what you need is to watch the minute before the
bug, nothing here replaces it.

## When to pick something else

Pick Jam or Marker.io if the people reporting bugs are not developers and what
unblocks them is a place the report lands in — a queue, an owner, a status —
rather than a route in your own application. Pick Sentry User Feedback if you
already pay Sentry, because a second store of reports
next to the one you check every morning is a store nobody checks. Pick BugPin
or another self-hosted product if you want a dashboard and are happy to run a
service and its database. Pick rrweb if the question is "what did they do
before it broke" rather than "what is broken", and you have somewhere to put
several megabytes of events.

Pick bugbottle when you already have an API, a database and an inbox, and the
only missing piece is the few kilobytes that turn "it's broken" into a JSON
report you can act on: no dashboard, no account, no vendor that can shut down
or reprice, and nothing between the browser and a route you wrote. That is a
narrower job than any product on this page does, and it is the whole of what
this library is for.

## The wider field

The five above are the ones worth standing next to; the September 2026 survey
they came from covers about twenty more — Userback, BugHerd, Gleap,
OpenReplay, Highlight.io, FasterFixes and the rest — with the same figures and
the same sources. It lives in the repository as
[docs/research-alternatives.md](https://github.com/mahope/bugbottle/blob/main/docs/research-alternatives.md).
