# syntax=docker/dockerfile:1

# --- build stage -----------------------------------------------------------
FROM node:24.18.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
# Native build toolchain for better-sqlite3.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# --- runtime stage ---------------------------------------------------------
FROM node:24.18.0-bookworm-slim
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
ENV DATABASE_URL=/data/local.db
ENV PORT=3000
# Set FMP_API_KEY at runtime, or configure it in-app at /settings.

# node_modules is copied as-is (keeps drizzle-kit so migrations can run at boot).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/.npmrc /app/drizzle.config.ts ./

VOLUME ["/data"]
EXPOSE 3000

# Apply migrations to the mounted SQLite DB, then start the Node server.
CMD ["sh", "-c", "pnpm db:migrate && node build"]
