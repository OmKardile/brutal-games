# BRUTAL//GAMES — full app: both games, shared SQLite leaderboard, accounts,
# optional rewards program. Bun runtime · Next.js standalone output · Prisma.
# Used by render.yaml (Render blueprint); works on any Docker host too.
FROM oven/bun:1

# Prisma needs openssl; ca-certificates for outbound TLS (Turnstile, mail APIs).
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) dependencies first (cached layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# 2) sources, Prisma client, standalone build
COPY . .
RUN bun run db:generate && bun run build

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
# Render sets PORT (10000 by default) — the standalone server honours it.
EXPOSE 10000

# 3) boot: sync SQLite schema, optional admin seed, serve
CMD ["sh", "scripts/docker-start.sh"]
