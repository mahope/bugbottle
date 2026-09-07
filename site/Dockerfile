# The landing page, served as static files.
#
# The build context is the repository ROOT, not this directory, because the
# demo on the page runs the real library: `dist/` is copied into the image and
# imported over HTTP. Build it with:
#
#   npm run build
#   docker build -f site/Dockerfile -t bugbottle-site .

FROM nginx:alpine

COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY site/index.html site/style.css site/demo.js site/og.png /usr/share/nginx/html/
COPY site/da/ /usr/share/nginx/html/da/
COPY dist/ /usr/share/nginx/html/dist/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
