# bugbottle — vanilla JS example

No build step, no React. Shows the two halves of a report:

1. `server.mjs` — a Node http server that receives a report and validates it
   with `bugbottle/server`. Run it:

   ```bash
   npm install
   node server.mjs
   ```

2. `index.html` — a plain form that captures a screenshot with html-to-image
   (loaded on demand from esm.sh) and posts the JSON.

Open http://localhost:8787, write a message, send, and watch the server print
the validated report.
