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
COPY scripts/build-docs.mjs ./scripts/
# The changelog is its own Markdown too, rendered into site/docs/changelog/,
# so it has to be here or the script fails on a file it cannot read.
COPY CHANGELOG.md ./
# The two comparison pages and the Danish getting-started page are their own
# Markdown, not README sections, and the same run writes sitemap.xml and
# robots.txt.
COPY site/compare.md ./site/
COPY site/da/sammenlign.md site/da/kom-i-gang.md site/da/privatliv.md ./site/da/
# The history, for the sitemap's dates. Last, because it changes with every
# commit and would otherwise invalidate everything below it.
#
# The pattern is `.git*` rather than `.git`, and .dockerignore rides along in
# front of it, because a `COPY` whose sources match nothing is an error and
# this one has to be allowed to match nothing: a source export has no
# repository, and a git worktree has a `.git` file pointing at one it cannot
# reach from in here. A wildcard needs at least one match to be legal, and
# .dockerignore is the cheapest file that always exists. GIT_DIR then points
# the script's `git log` at whatever arrived; when that is not a repository,
# git fails, the script catches it and dates every page today.
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

# The two faces the page is set in, served from this host so the footer's
# promise about external requests stays true.
COPY site/fonts/ /usr/share/nginx/html/fonts/
# Named rather than `site/da/`, so the Markdown sources of the Danish
# comparison and getting-started pages are not served next to the pages
# generated from them.
COPY site/da/index.html /usr/share/nginx/html/da/
COPY --from=docs /build/site/docs/ /usr/share/nginx/html/docs/
COPY --from=docs /build/site/compare/ /usr/share/nginx/html/compare/
COPY --from=docs /build/site/da/sammenlign/ /usr/share/nginx/html/da/sammenlign/
COPY --from=docs /build/site/da/kom-i-gang/ /usr/share/nginx/html/da/kom-i-gang/
COPY --from=docs /build/site/da/privatliv/ /usr/share/nginx/html/da/privatliv/
COPY --from=docs /build/site/sitemap.xml /build/site/robots.txt /usr/share/nginx/html/
COPY dist/ /usr/share/nginx/html/dist/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
