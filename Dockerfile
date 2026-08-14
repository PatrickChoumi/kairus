# Kairus ships as one container: the Node server serves the built client, so
# there is a single origin, no CORS to configure and no second deploy target.

FROM node:22-bookworm-slim AS build

# better-sqlite3 is a native addon and needs a toolchain at install time.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/package-lock.json server/
COPY client/package.json client/package-lock.json client/
RUN npm ci --prefix server && npm ci --prefix client

COPY server server
COPY client client

# The identifier reported by /api/health. `.dockerignore` leaves .git out, so
# the build cannot read the commit itself; hosts that pass one make the answer
# directly comparable to `git log`. Without it the client falls back to a hash
# of what it emitted, which still changes whenever the application does.
ARG RAILWAY_GIT_COMMIT_SHA=""
ARG SOURCE_COMMIT=""
ARG GITHUB_SHA=""
ENV RAILWAY_GIT_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA \
    SOURCE_COMMIT=$SOURCE_COMMIT \
    GITHUB_SHA=$GITHUB_SHA

RUN npm run build --prefix client \
  && npm run build --prefix server \
  && npm prune --omit=dev --prefix server


FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    CLIENT_DIST=/app/client/dist \
    DATA_DIR=/data \
    PORT=4000

WORKDIR /app

COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/client/dist client/dist

# The SQLite database lives in /data. There is deliberately no VOLUME
# instruction: Railway rejects Dockerfiles that declare one, and every host
# worth using mounts its volume at this path from the outside anyway.
RUN mkdir -p /data && chown -R node:node /data /app
EXPOSE 4000

USER node
CMD ["node", "server/dist/index.js"]
