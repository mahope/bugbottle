# The landing page and the documentation, served as static files.
#
# The build context is the repository ROOT, not this directory, for two
# reasons: the demo on the page runs the real library, so `dist/` is copied in
# and imported over HTTP, and the documentation is generated from `README.md`
# at image build time by the first stage below. Build it with:
#
#   npm run build
#   docker build -f site/Dockerfile -t bugbottle-site .
#
# Nothing under site/docs/ is committed. The README is the only copy of that
# text, and generating it here means a README edit ships with the next deploy
# without anyone remembering a step.

FROM node:22-alpine AS docs

WORKDIR /build

# For the `<lastmod>` dates in the sitemap, which come from the commit that
# last touched each source file. Builder stage only; nothing of it reaches the
# image that is served.
RUN apk add --no-cache git

# The lockfile first, so the install layer survives a README edit.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY README.md ./
# Both scripts, not one. `build-docs.mjs` imports `./page-descriptions.mjs` for
# the per-page `<meta name="description">` strings, so copying only the entry
# point fails the build with ERR_MODULE_NOT_FOUND — see the note on the
# `site/docs/` copy below. `tests/site-image.test.ts` reads this list and fails
# when a `scripts/*.mjs` the build imports is not named here, so a module added
# later cannot leave the image broken.
COPY scripts/build-docs.mjs scripts/page-descriptions.mjs scripts/protect-at.mjs ./scripts/
# The changelog is its own Markdown too, rendered into site/docs/changelog/,
# so it has to be here or the script fails on a file it cannot read.
COPY CHANGELOG.md ./
# Every Markdown the run reads: the two comparison pages, the Danish
# getting-started and privacy pages, and the two that are their own files
# rather than README sections (`/self-hosted/` and `/support/`). Each is a
# `source:` in the script's `STANDALONE` list, and a `source:` that is not
# copied here is a build that fails on a file it cannot read — which is what
# took the site down from 27/9 23:32, when `/support/` was added and this line
# was not updated. `tests/site-image.test.ts` pins the two lists together.
COPY site/compare.md site/self-hosted.md site/support.md ./site/
COPY site/da/sammenlign.md site/da/kom-i-gang.md site/da/privatliv.md ./site/da/
# The panel shot, for the same reason and not for its own sake: `build-docs.mjs`
# reads the picture's own IHDR to give the `<img>` its intrinsic `width` and
# `height`, so an `<img>` whose size it cannot measure renders without them and
# the paragraph under it jumps once the file lands. That is the layout shift the
# performance floor in CLAUDE.md is about, and it is invisible from here: the
# docs stage still succeeds and the page still serves the picture, so nothing in
# a green build says the attributes are missing. Live did exactly that between
# 28/9 13:5x and 17:30 — `/docs/install/` answered 200 with the image and without
# its size, while the same build in the repository has both.
# `tests/site-image.test.ts` reads the README for the pictures it points at and
# fails when one is not named here, so a second shot cannot repeat this quietly.
COPY site/panel-narrow.png ./site/
# The history, for the sitemap's dates. Last, because it changes with every
# commit and would otherwise invalidate everything below it.
#
# The pattern is `.git*` rather than `.git`, and .dockerignore rides along in
# front of it, because a `COPY` whose sources match nothing is an error and
# this one has to be allowed to match nothing: a source export has no
# repository, and a git worktree has a `.git` file pointing at one it cannot
# reach from in here. A wildcard needs at least one match to be legal, and
# .dockerignore is the cheapest file that always exists.
#
# GIT_DIR is the directory the COPY below writes into, and it is correct: a
# `COPY` whose source is a *directory* copies that directory's **contents**,
# not the directory itself, so `.git`'s `HEAD`, `objects` and `refs` land
# directly in `/build/gitdir` and `/build/gitdir` is the repository. Measured
# in `alpine` with git 2.54, not reasoned about: `COPY .git* ./gitdir/` leaves
# `/gitdir/HEAD` and `/gitdir/objects`, there is no `/gitdir/.git`, and
# `GIT_DIR=/gitdir git log -1` answers with the real commit date.
#
# A previous version of this file pointed GIT_DIR at `/build/gitdir/.git` on the
# theory that the COPY nested the directory. It does not, so that value made
# git answer `fatal: not a git repository` — the identical symptom the original
# was meant to fix, reintroduced. The test that shipped with it built the
# assumed layout by hand with `cpSync`, so it agreed with the assumption by
# construction and could not have caught it. `tests/site-image.test.ts` now
# derives the layout from what `COPY` does rather than from what a reader
# expects it to do.
#
# The history is only half the answer, and the half that is easy to miss: a
# deploy platform that clones with `--depth 1` has one commit, and
# `git log -1 -- <file>` in a shallow repository answers with **that** commit's
# date for every path — a shallow clone has no history to walk, so the path
# filter matches nothing and git reports the tip. That is the same lie as
# "today", wearing a different hat: every URL would carry the date of the
# deploy instead of the date of the commit that produced it. `lastmod()` in
# `build-docs.mjs` asks `git rev-parse --is-shallow-repository` and refuses to
# answer per-file from a history that cannot answer, which is what makes the
# fallback honest rather than merely valid.
#
# When what arrived is not a repository at all — a source export, or a worktree
# whose `.git` file points at a path that does not exist in here — git still
# fails, the script still catches it, and every page is dated today. That
# fallback is the one honest answer available, and it is now the *only* path
# that reaches it.
ENV GIT_DIR=/build/gitdir
COPY .dockerignore .git* ./gitdir/
RUN node scripts/build-docs.mjs


FROM nginx:alpine

COPY site/nginx.conf /etc/nginx/conf.d/default.conf
# The one copy of the security headers, included by every block in nginx.conf.
COPY site/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY site/index.html site/style.css site/docs.css site/demo.js site/docs.js site/og.png site/panel.png site/panel-narrow.png site/panel-da.png site/panel-da-narrow.png /usr/share/nginx/html/
# The theme playground, loaded by /docs/languages-and-branding/ alone. Its own
# line rather than the list above, because it belongs to one page and the
# generated documentation is what asks for it.
COPY site/playground.js /usr/share/nginx/html/
# The queue stub for the Plausible script every page loads; a file because the
# Content-Security-Policy allows no inline script.
COPY site/plausible-init.js /usr/share/nginx/html/

# The two faces the page is set in, served from this host so the footer's
# promise about external requests stays true.
COPY site/fonts/ /usr/share/nginx/html/fonts/
# Named rather than `site/da/`, so the Markdown sources of the Danish
# comparison and getting-started pages are not served next to the pages
# generated from them.
COPY site/da/index.html /usr/share/nginx/html/da/
COPY --from=docs /build/site/docs/ /usr/share/nginx/html/docs/
# One line per `out:` in the script's `STANDALONE` list, and both halves of a
# pair are needed: the `COPY` above feeds the build its `source:`, this one
# puts the page it generated where nginx serves it. A `source:` without its
# `out:` is the quieter half of that bug — the build succeeds and the page is
# still a 404, which is how `/self-hosted/` and `/support/` stayed missing
# after their Markdown was added.
COPY --from=docs /build/site/compare/ /usr/share/nginx/html/compare/
COPY --from=docs /build/site/self-hosted/ /usr/share/nginx/html/self-hosted/
COPY --from=docs /build/site/support/ /usr/share/nginx/html/support/
COPY --from=docs /build/site/da/sammenlign/ /usr/share/nginx/html/da/sammenlign/
COPY --from=docs /build/site/da/kom-i-gang/ /usr/share/nginx/html/da/kom-i-gang/
COPY --from=docs /build/site/da/privatliv/ /usr/share/nginx/html/da/privatliv/
COPY --from=docs /build/site/sitemap.xml /build/site/robots.txt /usr/share/nginx/html/
COPY dist/ /usr/share/nginx/html/dist/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
