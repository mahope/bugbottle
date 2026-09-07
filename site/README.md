# site/

The landing page for [bugbottle.dev](https://bugbottle.dev), in
English at `/` and Danish at `/da/`. Two static HTML files, one stylesheet, one
module. No framework, no build step for the page itself, no analytics, no
cookies, and no external request of any kind — the fonts are the system stack
and the favicon is an inline SVG.

| File | Role |
|---|---|
| `index.html` | English page |
| `da/index.html` | Danish page — same structure, same sections, written for a Danish reader rather than translated |
| `style.css` | Shared. Colour tokens on `:root`, redefined once for dark mode |
| `demo.js` | Mounts the real `bugbottle/ui` panel with a fake `fetch`, plus the scroll reveal and the copy buttons on the code slabs |
| `panel.png` | A real capture of the panel open on this page, in the hero. See "The hero screenshot" below |
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

## The hero screenshot

`panel.png` is a real capture, not an illustration: the panel open on this
page, message filled in, an element pointed at, taken headless at 2x with the
global `puppeteer-core` and Chrome and saved at `site/panel.png`. It carries
`width`/`height` on the `<img>` so the hero does not shift while it loads, and
it must stay under 150 kB.

The `<img>` sits inside a `.shot-frame`, which is what actually reserves the
space: the frame owns the aspect ratio (16/11 on a desktop, 5/4 on a phone)
and the picture fills it with `object-fit: cover` anchored to its right edge,
where the panel is. So the crop comes off the left, which is only the page
behind the panel at a size nobody can read. A replacement capture should keep
the panel at the right of the frame or the crop will cut it. Re-capture it whenever the panel's own look changes
enough that the screenshot stops matching — there is no build step that keeps
it in sync automatically.

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

## The copy buttons

Every `.slab` on the page gets a copy button, built in `demo.js` rather than
written into the two HTML files: the label then follows
`document.documentElement.lang` in one place, and a browser without
`navigator.clipboard` — or a page served over plain HTTP — never gets a button
that cannot do anything. The button on the demo payload starts hidden and
appears when there is a report to copy.

## Motion

One piece, which degrades to a finished page when it cannot run: `demo.js`
reveals sections with one `IntersectionObserver` as the reader scrolls to
them. The class that hides a section before it is revealed is set from
JavaScript, so a browser without it — or one asking for reduced motion —
never hides anything. Every animation and transition is switched off under
`prefers-reduced-motion`. A headless full-page screenshot that never scrolls
the real viewport will not trigger this — scroll through the page first, or
the shot will show sections stuck invisible below the fold.

## Version, sizes and the release date

The version number, the release date and the gzipped size of each entry
point are written into both pages by hand — in the hero stamp and the size
table — rather than templated at build time, since the page has no build
step of its own. Update all three (`site/index.html` and `site/da/index.html`)
whenever `package.json`'s version changes or the sizes in `CLAUDE.md`'s
bundle-size check move.

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
`bugbottle.dev` with TLS from Traefik. Because `dist/` is baked into the
image, a release that rebuilds `dist/` needs a redeploy for the demo to run the
new version.

## What this must not do

`site/` is not part of the npm package: `files` in `package.json` is `dist`
only, and nothing under `src/` may import from here.
