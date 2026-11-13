# BRUTAL//GAMES

Two free browser games in one brutal arcade — a fan-made tribute to
[BRUTAL](https://github.com/ahwootech/BRUTAL), the open-source C# game framework by ahwoo.

- **BRUTAL//ARENA** (`/play`) — top-down wave shooter. Canvas engine, WebAudio synth SFX,
  upgrade drafting, killstreaks, Overdrive, bosses.
- **BRUTAL//STACK** (`/stack`) — one-tap isometric tower stacker. Drop the block, slice the
  overhang, chain PERFECT drops (rising pentatonic chimes) to regrow the tower. Instant retry.

Keyboard + mouse, touch (virtual sticks) and gamepad (twin-stick + rumble) all work in
both games — plug in a pad and press any button to link it.

Plus an optional rewards program: players earn points for genuine play and receive a
proportional share of a monthly revenue pool. Rewards: `/rewards` (needs an account).

Both games submit runs to a shared per-game leaderboard (`/api/scores?game=arena|stack`).

## Stack

Next.js 16 (App Router, standalone output) · React 19 · TypeScript · Tailwind CSS 4 + shadcn/ui ·
Prisma 6 + SQLite (`db/custom.db`, WAL mode) · Bun runtime · zod validation · `bun test`.
Deploys as a full app to Render (Dockerfile + render.yaml) or as a static arcade to GitHub
Pages (`STATIC_EXPORT=1` build, local-board fallback).

## Quickstart

```bash
bun install
cp .env.example .env          # fill in values (SESSION_SECRET required for prod)
bun run db:push               # create/sync the SQLite schema
bun run seed:admin            # create the first admin (env vars or args)
bun run dev                   # http://localhost:3000
bun test tests/               # reward math + ledger + validation tests
bun run db:backup             # hot backup of db/custom.db
```

Admin console: `/admin` (ADMIN role required). Rewards are **disabled by default** — flip
`REWARDS_ENABLED` in the admin settings tab (or `bun run seed:admin -- --enable-rewards`).

## Deployment

**Full app on Render (recommended — leaderboard, accounts, rewards).** The repo ships a
Render blueprint: [`Dockerfile`](Dockerfile) (Bun + Next standalone + Prisma/SQLite) and
[`render.yaml`](render.yaml). One-click deploy of the public repo:

> **https://render.com/deploy?repo=https://github.com/OmKardile/brutal-games**

Free-plan notes (full story in `render.yaml`):

- The service sleeps after 15 min without traffic; the first request afterwards takes
  ~1 min while it spins back up.
- The free filesystem is **ephemeral** — the SQLite database is recreated on every
  deploy/restart, so leaderboards/accounts reset. Schema sync and (optional) first-admin
  seeding run automatically at container boot. To persist data, upgrade to a paid
  instance and attach the commented-out `disk:` block in `render.yaml`.
- `SESSION_SECRET` is generated automatically; the public URL is picked up from Render's
  `RENDER_EXTERNAL_URL` (set `APP_URL` only for a custom domain).
- Optional vars (Dashboard → Environment): `ADMIN_EMAIL` + `ADMIN_PASSWORD`,
  `TURNSTILE_*`, `RESEND_API_KEY`/`BREVO_API_KEY` + `MAIL_FROM`, `GOOGLE_CLIENT_*`.

Any other Node/Bun host works the same way: `bun install && bun run db:push &&
bun run build && bun run start` with the env vars from `.env.example`. Back up
`db/custom.db` regularly (`bun run db:backup`).

**Static arcade on GitHub Pages (landing + games, no server).** The public arcade runs
from the `gh-pages` branch: https://omkardile.github.io/brutal-games/ — server-only
routes (auth, rewards, admin, the leaderboard API) are excluded from that build; the
games automatically fall back to a per-browser local leaderboard. To redeploy:

```bash
# build the static site from a clean tree:
cp -a src src-tmp
rm -rf src/app/api src/app/admin src/app/login src/app/signup \
       src/app/forgot-password src/app/reset-password src/app/verify-email src/app/rewards
STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/brutal-games bunx next build
rm -rf src && mv src-tmp src          # restore the full source
touch out/.nojekyll
# then commit the contents of out/ to the gh-pages branch and push
```

(A ready-made Actions workflow ships at [`docs/deploy-pages-workflow.yml`](docs/deploy-pages-workflow.yml);
to automate this on every push to `main`, copy it to `.github/workflows/deploy-pages.yml`
via the GitHub web UI (or with a `workflow`-scoped token), then switch Pages
Settings → Source to *GitHub Actions*.)

## Scripts

| Script | What it does |
|---|---|
| `dev` / `build` / `start` | Next.js dev / standalone build / production start (bun) |
| `test` | `bun test tests/` — payout math, ledger, heartbeat/validation logic |
| `db:push` / `db:generate` | Sync Prisma schema to SQLite / regenerate client |
| `db:backup` | `VACUUM INTO` hot backup to `db/backups/` |
| `seed:admin` | Create/promote the admin account (never auto-promoted) |
| `lint` | ESLint |

## Project layout

```
src/app/            pages (landing, play, stack, auth, rewards, terms, privacy, admin)
src/app/api/        route handlers (health, auth/, rewards/, admin/, scores/)
src/game/           canvas game engines: engine.ts (arena) + stack.ts (tower stacker)
src/lib/            env, db, auth (session/password/email/google), captcha, rate-limit, assets,
                    scores-client (online board + static-site local-board fallback)
src/lib/rewards/    rewards domain: ledger, payout math, heartbeat, fraud, config, IST utils
src/components/     shadcn/ui + Turnstile widget + RewardsHud (play-page heartbeat client)
prisma/schema.prisma data model
Dockerfile + render.yaml   one-click Render deploy (bun, standalone, SQLite)
tests/              bun test suites (+ legacy shell scripts)
scripts/            seed-admin, backup-db, docker-start, verify-schema
```

## Documentation

- [technical-documentation.md](technical-documentation.md) — architecture, data model, APIs, security
- [business-documentation.md](business-documentation.md) — reward program mechanics + admin runbook
- [decisions.md](decisions.md) — architecture decision records
- [help.md](help.md) — player & admin FAQ
- [CHANGELOG.md](CHANGELOG.md) — versioned history
- [compact.md](compact.md) — state summary for future sessions

A fan tribute, not affiliated with ahwoo. Rewards payouts involve real money and require
legal/tax review before going live — see business-documentation.md.
