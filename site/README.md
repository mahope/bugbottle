# site/

The site at [bugbottle.dev](https://bugbottle.dev): a landing page in English
at `/` and Danish at `/da/`, the English documentation at `/docs/`, the
changelog at `/docs/changelog/`, and a comparison page in both languages at
`/compare/` and `/da/sammenlign/`. The
landing pages are static HTML written by hand; the documentation, the
changelog, the comparison, `sitemap.xml` and `robots.txt` are generated when
the image is built. No framework, no analytics, no
cookies, and no external request of any kind: the two typefaces are served
from this host and the favicon is an inline SVG.

| File | Role |
|---|---|
| `index.html` | English page |
| `da/index.html` | Danish page — same structure, same sections, written for a Danish reader rather than translated |
| `style.css` | Shared by every page. Colour tokens on `:root`, redefined once for dark mode |
| `docs.css` | The documentation pages only, loaded after `style.css` and leaning on its tokens |
| `demo.js` | Mounts the real `bugbottle/ui` panel with a fake `fetch`, a picture it draws itself and the annotator over it, plus the scroll reveal and the copy buttons on the code slabs |
| `docs.js` | The documentation pages only: copy buttons, the search field, the topic list closing on a phone, and the current heading in "On this page" |
| `playground.js` | The theme playground on `/docs/languages-and-branding/` and nowhere else: labelled controls over a real panel, and the code to copy. See "The theme playground" below |
| `fonts/` | The four woff2 faces the page is set in, latin only. See "The typefaces" below |
| `docs/` | **Generated, never committed.** Written by `scripts/build-docs.mjs`; see "The documentation" below |
| `docs/search.json` | **Generated, never committed.** The search index the field in the sidebar reads; see "The search" below |
| `compare.md` | The English "Compared with" page, as Markdown. The only prose on the site that is neither the landing page nor the README |
| `da/sammenlign.md` | The same page in Danish, written for a Danish reader rather than translated |
| `compare/`, `da/sammenlign/` | **Generated, never committed.** The two pages above, rendered by `scripts/build-docs.mjs`; see "The comparison" below |
| `docs/changelog/` | **Generated, never committed.** `CHANGELOG.md` rendered by the same script; see "The changelog" below |
| `sitemap.xml`, `robots.txt` | **Generated, never committed.** Written by the same script; see "The sitemap and robots.txt" below |
| `panel.png` | A real capture of the panel open on this page, in the hero. See "The hero screenshot" below |
| `panel-narrow.png` | The same capture clipped to the panel alone, used by the hero below 48rem |
| `panel-da.png`, `panel-da-narrow.png` | The same pair from `/da/`, where the panel is in Danish |
| `og.svg` | Source of the OpenGraph picture. Not served |
| `og.png` | 1200x630, rendered from `og.svg`; `og:image` on both pages |
| `nginx.conf` | Replaces `conf.d/default.conf`: `/health`, caching, gzip |
| `security-headers.conf` | The security headers, in one file because nginx does not merge them. Copied to `/etc/nginx/snippets/` and included by every block in `nginx.conf`; see "The security headers" below |
| `Dockerfile` | A `node:22-alpine` stage that generates `docs/`, then `nginx:alpine` plus these files and `dist/` |

## The typefaces

Two families, and no more: **Newsreader** at 600 for the headings, the hero
headline and the table captions, and **Source Sans 3** at 400, 400 italic and
600 for everything else, including the prose. Code stays in the system
monospace stack, which is a third family only in the sense that every machine
already has it.

The files came from Google Fonts and are **served from this host**, not linked
from `fonts.googleapis.com`. The footer promises that the page makes no
external request, and a stylesheet fetched from a third party would hand that
party the address of every reader of a page whose whole argument is that
nothing sits in the middle. It is also faster: no second connection to open
before the first line of text can be drawn.

Only the latin cut of each face is kept. `æ`, `ø` and `å` and every mark the
two languages use live inside `U+0000-00FF`, the `unicode-range` on each
`@font-face` says so, and a word outside that range falls back to the system
stack for that word rather than costing 60 kB more font.

To refresh a face, ask the API for it with a browser's user agent, take the
`/* latin */` block, and save the file it names into `fonts/`:

```bash
ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
curl -sA "$ua" 'https://fonts.googleapis.com/css2?family=Newsreader:wght@600&display=swap'
curl -sA "$ua" 'https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,600;1,400&display=swap'
# then curl each latin URL into site/fonts/<family>-<weight>.woff2
```

Ask for `Newsreader:wght@600` rather than for an optical-size range: the range
is served as one variable font of 60 kB, the single weight as 24 kB.

`index.html`, `da/index.html` and the shell in `scripts/build-docs.mjs` preload
the two faces the first screen needs, so `font-display: swap` swaps before the
page paints and Lighthouse measures no layout shift.

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

### The picture the demo draws

`html-to-image` is not loaded here and never will be: a public page has nowhere
private to put a photograph of whatever a visitor has on screen. But a panel
with no picture cannot show the part 0.7.0 added, so `demo.js` gives
`mountBugbottle` a `screenshot` renderer of its own — `drawDemoPicture`, which
paints a simplified picture of the demo section onto a canvas (the header band,
a heading, a few text bars, the button and the code slab) and returns it as a
PNG data URL. It ignores the `root` and the `filter` a real renderer uses,
because it renders no DOM; it honours `pixelRatio`, so the half-scale retry
`captureScreenshot` makes really does produce a smaller picture. The colours are
read from the page's own tokens with `getComputedStyle`, so the drawing follows
the page into dark mode.

`annotate: createAnnotator` from `/dist/annotate.js` comes with it, so "Edit
picture" appears and the rectangle, the arrow and the blur can be tried. The
data URL is allowed by `img-src 'self' data:`, which the policy already had.

Both pages say the picture is drawn rather than captured, and the checkbox and
its note are the one place the demo overrides the locale: "Attach the drawn
picture" and "The page draws a simplified picture of itself. Nothing is
photographed." — the bundled wording, "the picture shows this page as you see
it now", is true of a capture and would not be true here.

## The hero screenshot

`panel.png` is a real capture, not an illustration: the panel open on the
landing page, message filled in, an element pointed at, taken headless at 2x
with the global `puppeteer-core` and Chrome. `scripts/capture-panel.mjs` is
that procedure written down — it serves `site/` with `/dist/` mapped to the
repository's build, exactly as nginx does, drives the real panel, and clips
two frames out of one capture:

```bash
npm run build        # the demo runs the real dist/
npm run shot:panel
```

It stands the panel over the **demo section** rather than over the hero. The
picture ends up in the hero, so capturing there photographs the previous copy
of itself down the left edge; the demo section is also where the panel
belongs, and its flat plate keeps the file small. Both pictures carry
`width`/`height` on the element so the hero does not shift while they load,
and the script fails if either passes 150 kB.

There are two of them because a phone cannot use the wide one. The `<img>`
sits inside a `.shot-frame`, which is what reserves the space: on a desktop
the frame owns the ratio and `panel.png` fills it with `object-fit: cover`
anchored to its right edge, so the crop comes off the left, where there is
only page behind the panel at a size nobody can read. At 342 points across,
that crop leaves the panel too small to read, so below 48rem a `<source>`
hands the frame `panel-narrow.png` — the same capture clipped to the panel
alone — and the frame takes that picture's own proportions instead.

There are four files rather than two because the panel on `/da/` is in Danish.
An English panel in the Danish hero would be a picture of a different product,
so the script shoots both pages and writes `panel-da.png` and
`panel-da-narrow.png` beside the English pair.

Re-run the script whenever the panel's own look changes. Nothing keeps the
pictures in sync automatically, and a hero showing a panel the library no
longer draws is worse than no hero at all.

## The OpenGraph picture

`og.png` is `og.svg` screenshotted at 1200x630 with headless Chrome, so the
colours and the report card cannot drift from the page. It is drawn in the
light palette — the pale green ground, bottle green ink, seal red on the four
marks — because a link preview lands in a timeline that has already chosen a
background, and the light page is the one a first visit gets. The report card
is the only dark thing in it, exactly as on the page.

Edit the SVG and render it again:

```bash
npm run shot:og
```

`scripts/render-og.mjs` wraps the SVG in a document that declares the two
families from `site/fonts/` as data URLs and waits for `document.fonts.ready`
before the shutter. Without that the render would be a picture of the fallback
stack, which is not what the site looks like. Note that a family name with a
digit in it — `Source Sans 3` — has to be quoted inside the `font-family`
attribute, or the whole declaration is dropped and the text silently comes out
in Times.

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

The sidebar is a `<details>` written **open**, so a reader without JavaScript
gets the whole list at every width, which is what the page did before there
was one. On a phone `docs.js` closes it at load and renames its summary after
the page you are on: thirty-odd links standing between a reader and the
article they asked for are a wall, not a table of contents.

Four things happen in the browser, all in `docs.js`: the copy buttons, the
search field, that disclosure, and marking the current heading in "On this
page". Which page is
current, the anchors and the pager are written into the HTML, so a reader
without JavaScript still gets a finished page. The three words the copy button
says follow `document.documentElement.lang`, because the two comparison pages
load this same file and one of them is Danish.

To check the pages after a change, serve the image and drive it with the global
`puppeteer-core` and Chrome: every page should load with no console error, mark
exactly one page in the sidebar, and copy the first code block to the clipboard
when its button is pressed. Note that headless Chrome refuses
`navigator.clipboard.writeText` even with the permission granted — `docs.js`
falls back to a selection and `execCommand`, which is the path that check
actually exercises — and that Windows hands the text back with CRLF line
endings, so compare normalised.

## The theme playground

`/docs/languages-and-branding/#branding-and-theme` carries the one piece of the
documentation that is not README prose: a block of labelled controls — primary
colour, ground, ink, corner radius, font, position, colour scheme — beside a
real `bugbottle/ui` panel that is restyled as they move, with the
`mountBugbottle({ theme: … })` call and the CSS-variable block printed below it
for copying. `site/playground.js` is all of it, in vanilla JavaScript, loaded
by that page alone.

Three decisions worth knowing before editing it:

- **The variable names are not in the playground.** `scripts/build-docs.mjs`
  reads them out of the README's own "Branding and theme" table — the one the
  reader is looking at when they reach the controls — and writes them onto each
  control as `data-var`, so the CSS the playground prints is the CSS that table
  documents. What the script does hold is `PLAYGROUND_CONTROLS`, which says
  only *how* a value is edited, and it **fails the build** when a control names
  a `theme` key the table does not list. The two cannot drift apart quietly,
  and neither can be renamed on its own.
- **The panel is real and the stage is `inert`.** It is mounted with
  `trigger: false` and `shortcut: false` into a container the reader cannot
  focus, tab into or type in: it is a picture that happens to be the live
  component. Nothing is ever sent — there is no endpoint on this host — and
  because the stage is inert, the panel's dialog and focus trap do not fight
  the page around it. Two panels on one page is fine in any case: each mount
  gets its own shadow root, so the `bb-*` ids inside them do not clash.
- **No inline style, ever.** The stage and the controls are styled from
  `docs.css`; the theme reaches the panel through `style.setProperty` on the
  host and through its `data-pos` and `data-scheme` attributes, which is what
  the library itself does. The page's Content-Security-Policy allows inline
  style only because the panel needs it, and no page on this site has ever had
  any.

The page-specific script hook is `PAGE_SCRIPTS` in `scripts/build-docs.mjs`,
keyed on the slug: one shell serves thirty pages, so a file only one of them
needs is named there rather than added to `docs.js`. They are ES modules, since
this one imports the panel from `/dist/`.

The whole block is written `hidden` and unhidden by `playground.js` once it has
mounted a panel. A reader without JavaScript, or with `/dist/` missing, sees
the table and the prose and no empty boxes with copy buttons on them.

## The search

The field at the top of the sidebar — under the header on a phone, where the
sidebar is a box above the article — searches `docs/search.json`, written by
the same `scripts/build-docs.mjs` run and gitignored like the pages. It is a
flat `[{ url, title, heading, text }]`: one entry per page, then one per
heading inside it, in the order of the sidebar. `url` carries the anchor, so a
result opens the page at the part it matched.

`text` is the whole prose of that slice with the code blocks and the markup
taken out, not an opening sentence. A reader searches for a word they
remember, and the word worth remembering is as often in the middle of a
section as at the top of it: "replay" is a paragraph deep inside "Signing
requests" and finds it. Table rows are part of that prose — the cells joined
by spaces, the alignment row dropped — because several options are documented
in a table and nowhere else, and `elementPicker` was unsearchable while the
rows were thrown away. Underscores survive the markup stripping for the same
reason: `DEFAULT_MASK_SELECTOR` is exactly the word somebody types, and taking
the underscores out with the backticks around them made every
`SCREAMING_CASE` name in the documentation impossible to find. The file is about 110 kB, which is why `docs.js`
fetches it **on the first focus of the field** and never with the page — a
reader who does not search pays nothing, and nginx gzips it to a fifth.

Matching is a case-insensitive substring over the three fields, ranked title
before heading before text; inside a rank the entry that says the word most
often wins, which is the difference between a page that mentions something and
the page that is about it; a tie after that keeps the order of the sidebar.
The top eight are listed as plain links with an `aria-live="polite"` count
above them; when there were more, the count says so — "8 of 40 results" —
because a reader who cannot see the field would otherwise be told that a
truncated list is everything there is. Three details of that count are
deliberate. It is in the page from the moment the field is, empty and clipped
to nothing rather than `display: none`, since a live region that enters the
accessibility tree together with its first content is one several screen
readers never announce. Its text is written 250 ms after the list, so a word
typed at speed queues one announcement rather than one per letter — the list
itself is drawn immediately. And an unchanged sentence is not rewritten, so
nothing is said twice. Escape empties the field, Enter opens the first result,
and the form's submit is cancelled so it never reloads the page.

The field is built by `docs.js` rather than written into the HTML: a page
whose JavaScript never ran must not offer a box that cannot answer, and what
that reader has instead is the full list of pages, which is what the page had
before there was a search at all. The build fails when a page it wrote is
missing from the index, the same way it fails on a README section with no
group.

Nothing had to be added to `Dockerfile` for it: the image copies the generated
`site/docs/` tree as a directory, so a new file written into it ships with the
pages it belongs to.

## The accessibility audit

`scripts/a11y-site.mjs` is the check that a stylesheet cannot quietly break.
It serves `site/` and `dist/` the way nginx does — the security headers
included, parsed straight out of `site/security-headers.conf` — and runs the pinned
`axe-core` over both landing pages, the English landing page again with the
demo's panel open and the picture editor over it, the documentation index, one
deep documentation page, the documentation index again with the search field
holding results, the theme playground with a control moved, the two comparison pages and the changelog, in **both colour
schemes** — twenty runs. Three of those runs are states rather than pages. The
search state is a click, a word typed and a wait for the
list: the results are drawn from JavaScript and nothing else on the site would
notice a link with no accessible name in them. The annotator state opens the
panel, ticks the screenshot box, waits for the drawn picture and presses "Edit
picture": `scripts/a11y-audit.mjs` audits the same editor, but on a scratch page
with its own colours, and it is the site's colours and the site's renderer that
would break here. The playground state moves four of its controls first, because
the state worth auditing is the one the reader makes rather than the defaults. It fails on a console message as well as on a violation, because
a page that logs one is a page that is half-working and nothing else here
would notice.

```bash
npm run build && npm run build:docs
npm run a11y     # the panel audit, then this one
```

CI runs exactly that. The `browser` job in `.github/workflows/ci.yml` builds,
generates the pages and runs `npm run a11y` and `npm run smoke:annotate` in the
Chrome the `ubuntu-latest` image ships, so a stylesheet or a header that breaks
a page is caught on the pull request rather than by whoever remembers. The axe
reports are uploaded as an artifact when the job fails. Chrome is found by
`scripts/chrome.mjs` — `CHROME_BIN`, `CHROME_PATH`, then the usual Linux, macOS
and Windows paths — which is why the same command works on the runner and on a
desktop. The checkout is deep (`fetch-depth: 0`) because `npm run build:docs`
dates each page from the last commit that touched its source, and the sitemap's
`<lastmod>` is built out of those dates.

It scrolls each page before it looks, because the landing page reveals its
sections as the reader arrives at them and axe does not audit what is not
visible.

The pages must also stay fast: performance on `/` measured 97 on Lighthouse
mobile with no layout shift, against a floor of 95. Measure it against a
server that gzips text, as nginx does in the image — against one that does
not, the same page scores 89 and the difference is entirely `dist/`.

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

## The changelog

`/docs/changelog/` is `CHANGELOG.md`, rendered by the same script through the
same Markdown renderer as the comparison: one long article, no sidebar, no
previous/next. It lives under `/docs/` rather than beside the comparison
because it is documentation — it is the answer to "what moved" — and it is
listed in the sidebar and on the documentation index under About, in the same
`extras` array, for the same reason: it is not a README section.

Each `##` in the file is a release, and each becomes an `<h2>` whose id is the
version with hyphens for dots: `/docs/changelog/#0-9-0`, which is an anchor
anybody can guess and the two landing pages stamp into their "Version x.y.z,
released …" line. `scripts/release.mjs` moves that link with the version it
already moves. `Unreleased` keeps its own name and its own anchor. The
headings under a release — Added, Fixed, Changed — are `<h3>` with **no id at
all**, because a dozen elements answering to `#added` is eleven anchors that
go to the wrong place.

Above the first release is the list of every version, in the ruled column
"On this page" uses, so `docs.js` marks the release the reader is scrolling
through. A reader arrives at a changelog looking for one version, and without
the list that means scrolling past everything newer than it.

The page is in the search index by release: one entry for the file's
preamble, then one per version carrying the paragraph under its heading and
not the whole release. The changelog says of every feature what the
documentation says at greater length, and the ranking counts occurrences, so
indexing all of it would put thirteen release entries above the page that
actually documents whatever was searched for.

## The sitemap and robots.txt

`site/sitemap.xml` and `site/robots.txt` are written by the same script run and
gitignored like `site/docs/`, so a new documentation page cannot be added
without appearing in the sitemap. The sitemap lists absolute
`https://bugbottle.dev` URLs: the two landing pages, the documentation index
and every documentation page, the changelog, and the two comparison pages. The pairs that
exist in both languages — the landing pages, and the two comparison pages —
carry `xhtml:link` alternates for `en`, `da` and `x-default` in both
directions; the documentation exists in English only and carries none.

Every `<url>` carries a `<lastmod>`, and the date is the date of the commit
that last touched the file the page is generated from — `git log -1
--format=%cs -- <file>`, which prints exactly the `YYYY-MM-DD` the element
wants. The landing pages are dated by their own HTML, the comparison pages by
their own Markdown, the changelog by `CHANGELOG.md`, and the documentation index and every documentation
pages by `README.md`, since that is the only source they have. Never file
mtimes: a checkout resets every one of them, so mtimes would tell a crawler
that the whole site changed on the day it was last deployed.

That is why `.git` reaches the builder stage. It used to be excluded from the
context — it is about ten megabytes — but the docs stage now installs `git` and
copies the history in last, after the install and the sources, so a new commit
does not invalidate the layers above it. Neither the history nor `git` survives
into the `nginx:alpine` stage. The copy is written as
`COPY .dockerignore .git* ./gitdir/` with `ENV GIT_DIR=/build/gitdir`, because
a `COPY` whose sources match nothing is an error and this one has to be allowed
to match nothing: a wildcard needs one match to be legal, and `.dockerignore`
is the cheapest file that always exists to give it one. Where what arrives is
not a repository — a source export, a git worktree whose `.git` is a pointer
file to a directory outside the context — git fails, the script catches it, and
every page is dated today rather than losing the element, which is truthful for
a build that has just happened. A shallow clone is the one case that is neither:
it answers with its own tip commit for every file, so the whole site is dated
the day it was cloned.

The alternative was a JSON of precomputed dates, committed and read by the
build. It is the larger change and the worse one: a generated file in the tree
is a step someone has to remember, and the dates go stale the moment they
forget.

`robots.txt` allows everything and names the sitemap. nginx has a location for
each: the sitemap is served as `application/xml` (its `types { }` block empties
the MIME map so `default_type` wins over nginx's own `text/xml`), the robots
file as `text/plain` and unlogged.

## The security headers

Three headers — `X-Content-Type-Options: nosniff`, `Referrer-Policy:
no-referrer` and a `Content-Security-Policy` — and they live in
`site/security-headers.conf` rather than in
`nginx.conf`, because nginx does not merge `add_header` down the block chain.
A block inherits the enclosing set only for as long as it adds no header of its
own; the moment a `location` sets a `Cache-Control`, it replaces the
server-level set entirely. Every location on this site sets a cache header, so
until this file existed every location but `/health` served its files without
`Referrer-Policy` — `/robots.txt`, `/sitemap.xml`, `/dist/`, `/fonts/`,
`/style.css`, `/demo.js` and the pages themselves.

The Dockerfile copies the file to `/etc/nginx/snippets/security-headers.conf`
and every block in `nginx.conf` — the server block and each location inside it,
`/health` included — opens with `include snippets/security-headers.conf;`.
A header added to that file therefore reaches all of them. The one remaining
way to lose a header is to add a location that forgets the include, which is
why the include is the first line of every block rather than buried in one:
a missing first line is visible where a missing header is not. The check is in
"Building and running" below: `curl -sI` every kind of URL and compare.

### The Content-Security-Policy

```
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';
object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

The footer promises the page makes no external request. `default-src 'self'`
is that promise written where a browser enforces it: the site is static, it
self-hosts both typefaces and its copy of `dist/`, and it speaks to nothing
off-origin, so the strict default costs the site nothing and a third-party
script that ever appeared in one of these files would simply not run.

Two directives are wider than `'self'`, and both are the panel rather than the
pages. `img-src` allows `data:` because a screenshot arrives as a
`data:image/png;base64,` URL, is shown in an `<img>` before it is sent, and is
exported the same way by the annotator. `style-src` allows `'unsafe-inline'`
because `bugbottle/ui` renders into a shadow root, puts its stylesheet there as
a `<style>` element and sets the host's position and the `--bb-*` custom
properties through a style attribute; CSP judges both as inline style even
inside a shadow root. Measured on the image, with `style-src 'self'` and
nothing else: one `style-src-elem` violation, the host `position: static`
instead of `fixed`, the trigger `border-radius: 0px` instead of `999px`, and
the panel 800px wide with no padding — an unstyled form in the document flow.
Nothing in `site/*.html`, `demo.js`, `docs.js` or the generated documentation
carries an inline style or an inline script, so `'unsafe-inline'` is the
panel's cost alone; the pages themselves would be served by `style-src 'self'`
today. `object-src 'none'` because there are no plugins,
`frame-ancestors 'none'` because nobody frames this site, `base-uri 'self'` so
an injected `<base>` cannot re-point every relative URL, and
`form-action 'self'` because the site posts nowhere.

`scripts/a11y-site.mjs` parses this file and answers with the same headers, so
the audited pages see the policy that will be served and a blocked resource
fails the audit — Chrome logs one as a console error, and the script also
listens for `securitypolicyviolation` so the report names the directive.

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
curl -si localhost:8089/docs/search.json | head -1
curl -si localhost:8089/compare/ | head -1
curl -si localhost:8089/da/sammenlign/ | head -1
curl -si localhost:8089/docs/changelog/ | head -1
curl -si localhost:8089/sitemap.xml | head -3
curl -si localhost:8089/robots.txt | head -3
curl -si localhost:8089/fonts/sourcesans3-400.woff2 | head -1
curl -si localhost:8089/panel-narrow.png | head -1
```

`/health` returns `ok` as `text/plain` and is not logged — it is what the
container platform polls.

And that every one of them carries the same three security headers, which is
the thing an `add_header` in a `location` quietly takes away:

```bash
for p in / /robots.txt /sitemap.xml /dist/bugbottle.js /style.css /docs/          /fonts/sourcesans3-400.woff2 /schema/report.json /health /nope; do
  echo "== $p"
  curl -sI "localhost:8089$p" | grep -i -E 'x-content-type-options|referrer-policy|content-security-policy'
done
```

Three lines under every path — the 404 included, which is why `/nope` is in the
list — or something in `nginx.conf` has stopped including the snippet.

## Deploying

Dokploy application, Dockerfile build, `site/Dockerfile` with the repository
root as the context, port 80, health check path `/health`, domain
`bugbottle.dev` with TLS from Traefik. Because `dist/` is baked into the
image, a release that rebuilds `dist/` needs a redeploy for the demo to run the
new version.

## What this must not do

`site/` is not part of the npm package: `files` in `package.json` is `dist`
only, and nothing under `src/` may import from here.
