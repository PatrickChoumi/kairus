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

# Mount a volume here: it holds the SQLite database.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
EXPOSE 4000

USER node
CMD ["node", "server/dist/index.js"]
