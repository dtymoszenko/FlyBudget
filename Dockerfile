# FlyBudget self-hosted server: the web app and API in one container, with a
# password login (server mode). See docs: https://flybudget.org/docs/self-hosting
#
#   docker compose up -d        (see docker-compose.yml)
#
# Base images are pinned by digest; Dependabot keeps them up to date.

# ---- Build: compile the client and bundle the server (runs on the build machine's
# own architecture; the output is plain JS/HTML, so it works on every platform) ----
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

WORKDIR /src

# Dependencies first so Docker can cache them. The .npmrc files block install scripts.
COPY client/.npmrc client/package.json client/package-lock.json client/
COPY server/.npmrc server/package.json server/package-lock.json server/
RUN npm ci --prefix client --no-audit --no-fund \
 && npm ci --prefix server --no-audit --no-fund

COPY client/ client/
COPY server/ server/

RUN npm run build --prefix client \
 && server/node_modules/.bin/esbuild server/src/index.ts --bundle --platform=node --target=node24 \
      --external:better-sqlite3 --format=cjs --outfile=dist/server.js

# The only runtime dependency: better-sqlite3, which ships prebuilt binaries for
# every platform. Keep just the Linux (glibc) ones.
RUN mkdir -p dist/node_modules \
 && cp -r server/node_modules/better-sqlite3 dist/node_modules/ \
 && cd dist/node_modules/better-sqlite3 \
 && rm -rf deps src binding.gyp \
 && find prebuilds lib -regextype posix-extended \
      -regex '.*/(darwin|win32|linuxmusl)-[^/]*' -delete

# ---- Runtime ----
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# tini runs as PID 1 so `docker stop` shuts the server down cleanly
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir /data && chown node:node /data && chmod 700 /data

WORKDIR /app
COPY --from=build /src/dist/ ./
COPY --from=build /src/client/dist/ ./client/
COPY --from=build /src/server/src/db/migrations/ ./migrations/

ENV NODE_ENV=production \
    FLYBUDGET_SERVER_MODE=true \
    FLYBUDGET_HOST=0.0.0.0 \
    PORT=3001 \
    DB_PATH=/data/budget.db \
    MIGRATIONS_PATH=/app/migrations \
    CLIENT_DIST=/app/client

# Runs as the image's unprivileged "node" user (uid 1000), never root
USER node
VOLUME /data
EXPOSE 3001

HEALTHCHECK --interval=60s --timeout=10s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>{process.exitCode=r.ok?0:1},()=>{process.exitCode=1})"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
