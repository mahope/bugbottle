# site/

The landing page for [bugbottle.mahoje.dk](https://bugbottle.mahoje.dk), in
English at `/` and Danish at `/da/`. Two static HTML files, one stylesheet, one
module. No framework, no build step for the page itself, no analytics, no
cookies, and no external request of any kind — the fonts are the system stack
and the favicon is an inline SVG.

| File | Role |
|---|---|
| `index.html` | English page |
| `da/index.html` | Danish page — same structure, same sections |
| `style.css` | Shared. Colour tokens on `:root`, redefined once for dark mode |
| `demo.js` | Mounts the real `bugbottle/ui` panel with a fake `fetch`, plus the scroll reveal |
| `og.svg` | Source of the OpenGraph picture. Not served |
| `og.png` | 1200x630, rendered from `og.svg`; `og:image` on both pages |
| `nginx.conf` | Replaces `conf.d/default.conf`: `/health`, caching, gzip |
| `Dockerfile` | `nginx:alpine` plus these files and `dist/` |

## The demo

The panel on the page is not a screenshot: it is `bugbottle/ui` from the
committed `dist/`, imported over HTTP from `/dist/ui/index.js`. It is mounted
with a `fetch` of its own instead of an endpoint — the fake fetch keeps the
request body, answers `201 {"id":"demo"}`, and `onSent` renders `toMarkdown` of
that body into the `<pre>`. So a visitor can open the bubble, point at an
element, press send, and read the exact payload that would have been posted.
Nothing is sent anywhere, and no endpoint exists on the host.

`mountBugbottle` takes that `fetch` option for exactly this reason; it is
passed straight through to `sendReport`.

Screenshots are switched off in the demo: `html-to-image` is not loaded, so no
renderer is given and the panel does not offer the checkbox.

## The OpenGraph picture

`og.png` is `og.svg` screenshotted at 1200x630 with headless Chrome, so the
colours and the report card cannot drift from the page. Edit the SVG and
render it again with the global `puppeteer-core` and Chrome:

```js
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630 });
await page.setContent(`<!doctype html><meta charset="utf-8">` + svgSource);
await page.screenshot({ path: "site/og.png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
```

## Motion

Two pieces, both of which degrade to a finished page when they cannot run: the
report card in the hero assembles itself with CSS `animation-delay` on each
row, and `demo.js` reveals sections with one `IntersectionObserver`. The class
that hides a section before it is revealed is set from JavaScript, so a browser
without it — or one asking for reduced motion — never hides anything. Every
animation and transition is switched off under `prefers-reduced-motion`.

## Building and running

The build context must be the repository root so `dist/` can be copied in.
Build `dist/` first.

```bash
npm run build
docker build -f site/Dockerfile -t bugbottle-site .
docker run -d -p 8089:80 --name bugbottle-site bugbottle-site
```

Then check the four things that must answer 200:

```bash
curl -si localhost:8089/ | head -1
curl -si localhost:8089/da/ | head -1
curl -si localhost:8089/health | head -1
curl -si localhost:8089/dist/ui/index.js | head -1
```

`/health` returns `ok` as `text/plain` and is not logged — it is what the
container platform polls.

## Deploying

Dokploy application, Dockerfile build, `site/Dockerfile` with the repository
root as the context, port 80, health check path `/health`, domain
`bugbottle.mahoje.dk` with TLS from Traefik. Because `dist/` is baked into the
image, a release that rebuilds `dist/` needs a redeploy for the demo to run the
new version.

## What this must not do

`site/` is not part of the npm package: `files` in `package.json` is `dist`
only, and nothing under `src/` may import from here.
