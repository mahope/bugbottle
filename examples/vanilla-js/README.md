# bugbottle — vanilla JS example

No build step, no React. Shows the two halves of a report:

1. `server.mjs` — a Node http server that receives a report and validates
   every field with `bugbottle/server`. It also serves the library from the
   repository's `dist/`, so run `npm run build` in the root first, then:

   ```bash
   npm install
   node server.mjs
   ```

2. `index.html` — a plain form that records console errors, lets the reporter
   point at an element with `pickElement`, takes a screenshot with
   `captureScreenshot` (html-to-image loaded on demand from esm.sh), and posts
   the JSON with `buildReport` + `sendReport`.

Open http://localhost:8787, press *Save order* to put an error in the buffer,
point at the button, write a message, send — and watch the server print the
validated report.
