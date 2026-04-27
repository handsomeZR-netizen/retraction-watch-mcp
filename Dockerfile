FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/ingest/package.json packages/ingest/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund

FROM deps AS builder
COPY . .
RUN npm run build && npm run build:web

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3210 \
    RW_MCP_DB_PATH=/data/retraction-watch.sqlite \
    RW_SCREEN_CONFIG_DIR=/config \
    RW_SCREEN_DATA_DIR=/data/manuscripts

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1001 app

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/policies ./packages/core/policies
COPY --from=builder /app/packages/ingest/dist ./packages/ingest/dist
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

USER app
EXPOSE 3210
WORKDIR /app/apps/web
CMD ["node", "server.js"]
