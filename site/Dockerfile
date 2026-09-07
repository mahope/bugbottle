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

# The lockfile first, so the install layer survives a README edit.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY README.md ./
COPY scripts/build-docs.mjs ./scripts/
RUN node scripts/build-docs.mjs


FROM nginx:alpine

COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY site/index.html site/style.css site/docs.css site/demo.js site/docs.js site/og.png site/panel.png /usr/share/nginx/html/
COPY site/da/ /usr/share/nginx/html/da/
COPY --from=docs /build/site/docs/ /usr/share/nginx/html/docs/
COPY dist/ /usr/share/nginx/html/dist/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
