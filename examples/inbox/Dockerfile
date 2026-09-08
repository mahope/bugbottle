# The inbox as a container: one Node process, one volume, no build step.
#
# The build context is the repository ROOT, not this directory, because the
# example imports `bugbottle/server`. There is no `package.json` beside
# `server.mjs` on purpose — the import is a *self-reference*, resolved by
# Node against the nearest package.json, which is the library's own. So the
# image reproduces that layout and nothing else: package.json, dist/, and the
# two files of the example.
#
#   npm run build
#   docker build -f examples/inbox/Dockerfile -t bugbottle-inbox .
#   docker run --rm -e INBOX_PASSWORD=secret -p 8788:8788 -v inbox:/data \
#     bugbottle-inbox
#
# `npm pack` would work too, and it is the other honest answer, but it is
# bigger and longer: the tarball carries the same dist/, then `npm install`
# unpacks a second copy of it under node_modules/bugbottle and writes a
# lockfile and npm's metadata beside it. Copying is the same bytes once, with
# no npm run at image build time and nothing installed to go stale. The
# library has no runtime dependencies, so there is nothing an install would
# fetch.

FROM node:22-alpine

WORKDIR /app

# The package manifest is here for its `exports` map alone. Nothing is
# installed: bugbottle has no runtime dependencies, and neither has the
# example.
COPY package.json ./
COPY dist/ ./dist/
COPY examples/inbox/server.mjs examples/inbox/demo.html ./examples/inbox/

# The mount point, made before the volume is declared so its ownership is what
# Docker copies into a fresh named volume. A container that cannot write here
# is an inbox that accepts a report and loses it.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

# 0.0.0.0 because the proxy is on the other side of the container boundary;
# see the comment on `host` in server.mjs. REPORTS_DIR names the volume, so
# the one thing that must be persisted is explicit rather than implied by a
# path inside the example.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788 \
    REPORTS_DIR=/data

# Never root. The process reads its own files and writes one directory.
USER node

EXPOSE 8788

# The public route, so the check works before anybody has the password.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8788/health || exit 1

CMD ["node", "examples/inbox/server.mjs"]
