# Two Rooms and a Boom — one image that serves the built PWA, the card art, the API and the
# WebSocket on a single port (see docs/PLAN.md, "Deployment with Docker Compose").
#
#   docker compose up -d --build      ->  http://<host-ip>:8080
#
# The publisher's print-and-play PDFs in printable_files/ are excluded by .dockerignore: only the
# extracted card assets ship.

# ---- build -----------------------------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# better-sqlite3 is a native module and node:22-slim ships no toolchain: `npm ci` dies in node-gyp with
# "Could not find any Python installation to use" (g++/make are missing too). These are build-stage
# only — the runtime image below stays slim, and it copies the already-compiled node_modules.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# tsc (server + client) + vite build + esbuild bundle -> dist/ and dist-server/
RUN npm run build

# ---- runtime ---------------------------------------------------------------------------------------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/data/games.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
