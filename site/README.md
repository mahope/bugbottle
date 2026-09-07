# site/

The site at [bugbottle.dev](https://bugbottle.dev): a landing page in English
at `/` and Danish at `/da/`, the English documentation at `/docs/`, and a
comparison page in both languages at `/compare/` and `/da/sammenlign/`. The
landing pages are static HTML written by hand; the documentation, the
comparison, `sitemap.xml` and `robots.txt` are generated when the image is
built. No framework, no analytics, no
cookies, and no external request of any kind — the fonts are the system stack
and the favicon is an inline SVG.

| File | Role |
|---|---|
| `index.html` | English page |
| `da/index.html` | Danish page — same structure, same sections, written for a Danish reader rather than translated |
| `style.css` | Shared by every page. Colour tokens on `:root`, redefined once for dark mode |
| `docs.css` | The documentation pages only, loaded after `style.css` and leaning on its tokens |
| `demo.js` | Mounts the real `bugbottle/ui` panel with a fake `fetch`, plus the scroll reveal and the copy buttons on the code slabs |
| `docs.js` | The documentation pages only: copy buttons, and the current heading in "On this page" |
| `docs/` | **Generated, never committed.** Written by `scripts/build-docs.mjs`; see "The documentation" below |
| `compare.md` | The English "Compared with" page, as Markdown. The only prose on the site that is neither the landing page nor the README |
| `da/sammenlign.md` | The same page in Danish, written for a Danish reader rather than translated |
| `compare/`, `da/sammenlign/` | **Generated, never committed.** The two pages above, rendered by `scripts/build-docs.mjs`; see "The comparison" below |
| `sitemap.xml`, `robots.txt` | **Generated, never committed.** Written by the same script; see "The sitemap and robots.txt" below |
| `panel.png` | A real capture of the panel open on this page, in the hero. See "The hero screenshot" below |
| `og.svg` | Source of the OpenGraph picture. Not served |
| `og.png` | 1200x630, rendered from `og.svg`; `og:image` on both pages |
| `nginx.conf` | Replaces `conf.d/default.conf`: `/health`, caching, gzip |
| `Dockerfile` | A `node:22-alpine` stage that generates `docs/`, then `nginx:alpine` plus these files and `dist/` |

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
colours and the report card cannot drift from the page. It is drawn in the
light palette — the pale green ground, bottle green ink, seal red on the four
marks — because a link preview lands in a timeline that has already chosen a
background, and the light page is the one a first visit gets. The report card
is the only dark thing in it, exactly as on the page. Edit the SVG and render
it again with the global `puppeteer-core` and Chrome:

```js
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630 });
await page.setContent(`<!doctype html><meta charset="utf-8">` + svgSource);
await page.screenshot({ path: "site/og.png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
```

## The documentation

`/docs/` is generated from `README.md` by `scripts/build-docs.mjs`, which runs
in the first stage of the Dockerfile. Nothing it writes is committed:
`site/docs/` is gitignored, so there is exactly one copy of that text and a
README edit is live the next time the site is deployed, with no step for anyone
to forget. Build it on its own while working on the styles:

```bash
npm run build:docs   # writes site/docs/
```

The script slices the README at its `##` headings and renders one page per
section with `marked`, pinned to an exact version. It tracks fenced code blocks
while it slices, because "Feeding reports to an agent" contains a Markdown
sample with `##` headings of its own. The prose above the first heading becomes
`/docs/install/`, without the H1, the shields.io badge row or the line linking
back to this site.

The one editorial decision lives in the script: `GROUPS` puts each section in
Get started, Evidence, Server, Privacy, Reference or About, and that order is
also the order of the sidebar and of the previous/next links. A README section
that is not placed there **fails the build** rather than quietly becoming a page
nothing links to — so adding a `##` to the README means adding a slug to
`GROUPS`.

Each page gets the same header and footer as the landing page, a sidebar
marking the current page, an anchor on every subheading, a copy button on every
code block, previous/next links, and an "Edit this page on GitHub" link to the
section it came from. Links written for GitHub are rewritten: `#anchor` becomes
the page that now holds that anchor, and a relative path becomes a blob URL.
Images become their alt text, so the footer's promise about external requests
stays true.

Only two things happen in the browser, both in `docs.js`: the copy buttons, and
marking the current heading in "On this page". Which page is current, the
anchors and the pager are written into the HTML, so a reader without JavaScript
still gets a finished page.

To check the pages after a change, serve the image and drive it with the global
`puppeteer-core` and Chrome: every page should load with no console error, mark
exactly one page in the sidebar, and copy the first code block to the clipboard
when its button is pressed. Note that headless Chrome refuses
`navigator.clipboard.writeText` even with the permission granted — `docs.js`
falls back to a selection and `execCommand`, which is the path that check
actually exercises — and that Windows hands the text back with CRLF line
endings, so compare normalised.

## The comparison

`/compare/` and `/da/sammenlign/` place bugbottle next to Marker.io, Jam,
Sentry User Feedback, BugPin and rrweb. They are the one page a reader weighing
the library up is looking for, and the one page that talks about other people's
products, which is why they live on the site and not in the package README.

The text is `site/compare.md` and `site/da/sammenlign.md`, rendered by
`scripts/build-docs.mjs` through the same Markdown renderer the documentation
uses, with the landing page's header and footer and `docs.css`, but no sidebar
and no previous/next: it is one long read rather than a chapter. The Danish
page is written for a Danish reader, not translated sentence by sentence.

Two rules hold the page together, and both are the point of it:

- **Every claim about someone else's product links to their page**, in the
  table cell that makes the claim. The reader should be able to check any
  number without leaving the row it is in.
- **The figures carry a date.** They were taken on 7 September 2026 from the
  research in `docs/research-alternatives.md`, and the first paragraph says so.
  Prices move; a comparison that does not say when it was true is a
  comparison nobody can trust. Refresh both pages and the date together, or
  leave them alone.

The English page is also listed in the documentation sidebar under About,
which is the `extras` array on that group in the script rather than a slug,
because it is not a README section.

## The sitemap and robots.txt

`site/sitemap.xml` and `site/robots.txt` are written by the same script run and
gitignored like `site/docs/`, so a new documentation page cannot be added
without appearing in the sitemap. The sitemap lists absolute
`https://bugbottle.dev` URLs: the two landing pages, the documentation index
and every documentation page, and the two comparison pages. The pairs that
exist in both languages — the landing pages, and the two comparison pages —
carry `xhtml:link` alternates for `en`, `da` and `x-default` in both
directions; the documentation exists in English only and carries none.

`robots.txt` allows everything and names the sitemap. nginx has a location for
each: the sitemap is served as `application/xml` (its `types { }` block empties
the MIME map so `default_type` wins over nginx's own `text/xml`), the robots
file as `text/plain` and unlogged.

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

Then check the things that must answer 200:

```bash
curl -si localhost:8089/ | head -1
curl -si localhost:8089/da/ | head -1
curl -si localhost:8089/health | head -1
curl -si localhost:8089/dist/ui/index.js | head -1
curl -si localhost:8089/docs/ | head -1
curl -si localhost:8089/docs/api/ | head -1
curl -si localhost:8089/compare/ | head -1
curl -si localhost:8089/da/sammenlign/ | head -1
curl -si localhost:8089/sitemap.xml | head -3
curl -si localhost:8089/robots.txt | head -3
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
