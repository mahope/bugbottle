# bugbottle — vanilla JS example

No framework or database. Shows the two halves of a report:

1. `server.mjs` — a Node http server that delegates report validation and
   responses to `handleReport`. A backpressured Node-to-Request bridge lets
   the shared receiver stop reading at its byte limit or upload deadline.
   The server imports the repository's built receiver and serves its browser
   modules from `dist/`.
2. `index.html` — a plain form that records console errors, lets the reporter
   point at an element with `pickElement`, takes a screenshot with
   `captureScreenshot` (html-to-image loaded on demand from esm.sh), and posts
   the JSON with `buildReport` + `sendReport`.

From the repository root:

```bash
npm run build
cd examples/vanilla-js
npm install
node server.mjs
```

Open http://localhost:8787, press *Save order* to put an error in the buffer,
point at the button, write a message, send — and watch the server print the
validated report. There is no browser build step.

The shared defaults allow **4 MiB (4,194,304 bytes)** for the entire request
body and **15 seconds** for the whole upload, including pauses between chunks.
An oversized body receives 413 (`Report is too large`); a stalled upload
receives 408 (`Report took too long to arrive`). Reading stops without waiting
for the remainder, and the connection closes after the error response.
`createDemoServer({ maxBodyBytes, bodyTimeoutMs })` can override these defaults.

A valid report receives 201 with a generated id. Malformed JSON receives 400
(`Malformed JSON`), and an empty message receives 400 (`Write a message first`).
The shared contract normalises an unknown report type to `other`. Optional
fields, including contact, breadcrumbs and screenshot regions, follow the
same normalisation as every other receiver. An invalid optional screenshot
is dropped together with its region; the report is still accepted.

This is a **local demo**, listening on loopback only. Reports and screenshot
byte counts are printed to the terminal, not persisted; an id is only an
acknowledgement. Use synthetic data. Before exposing a receiver publicly,
configure authentication, rate limiting, suitable storage and privacy controls.
