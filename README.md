# BRUTAL//GAMES

Five free browser games in one brutal arcade — a fan-made tribute to
[BRUTAL](https://github.com/ahwootech/BRUTAL), the open-source C# game framework by ahwoo.

- **BRUTAL//ARENA** (`/games/arena`) — top-down twin-stick wave shooter. Canvas engine,
  WebAudio synth SFX, upgrade drafting, killstreaks, Overdrive, bosses.
- **BRUTAL//STACK** (`/games/stack`) — one-tap isometric tower stacker. Drop the block, slice
  the overhang, chain PERFECT drops (rising pentatonic chimes) to regrow the tower. Instant retry.
- **BRUTAL//REFLEX** (`/games/reflex`) — timing strike. Stop the sweeping blade inside the
  shrinking zone; chain perfects up the chime ladder.
- **BRUTAL//DODGE** (`/games/dodge`) — one-button gauntlet. Hold to climb, release to fall,
  thread the gates, graze for CLOSE bonuses.
- **BRUTAL//MERGE** (`/games/merge`) — drop-merge pit. Fuse circles up an 11-tier chain,
  ride the combo window, detonate the SINGULARITY.

Every game runs in night and day mode (live-switchable, canvases included), on keyboard,
mouse, touch and gamepad (twin-stick + rumble) — plug in a pad and press any button to link it.
Daily challenges (`/daily`): same seed for everyone that day, per-game daily leaderboard,
streaks, Wordle-style share, WhatsApp challenge links (`?daily=1` deep link — same
seed for the recipient) and daily mutators for STACK (server-derived score-rule
twists like PERFECT HEAVY or STREAK MASTER; the plausibility ceiling scales with
them so honest runs are never flagged). Admins get a retention read-out
(DAU/D1 cohorts) computed from existing tables — no new tracking.

India-first performance: **lite mode** auto-detects devices that can't hold ~50fps and
drops page effects (animations, blurs) — engines untouched; a QUALITY toggle lets you
pin AUTO / LITE / FULL. The site is an **installable PWA**: install it from the
browser (Android Chrome shows INSTALL APP; iOS: Share → Add to Home Screen), the
app shell precaches, and any game you've played loads **offline** — offline daily runs
play on a local seed and stay UNRANKED, so the boards stay honest. Data-friendly by
design: games load only when you press PLAY.

Plus an optional rewards program: players earn points for genuine play and receive a
proportional share of a monthly revenue pool. Rewards: `/rewards` (needs an account).

Every game submits runs to a shared per-game leaderboard (`/api/scores?game=arena|stack|reflex|dodge|merge`)
plus a per-day daily leaderboard (`/api/daily/board?game=…&dateKey=…`).

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
| `og:gen` | Regenerate 1200×630 OG/Twitter images into `public/og/` |

## Project layout

```
src/app/            pages (landing, games hub + per-game + category + daily, auth, rewards,
                    terms, privacy, about/contact/help, admin)
src/app/api/        route handlers (health, auth/, rewards/, admin/, scores/, daily/)
src/game/           canvas game engines (arena, stack, reflex, dodge, merge) — DO NOT edit;
                    new games build on the kit instead
src/game-kit/       reusable game framework: loop, input, canvas scaler, audio host, rng,
                    storage, juice, pooling, perf overlay + adapter/ (PortalAdapter +
                    enforced ad/gameplay rules; Noop, OwnPortal, Poki/CrazyGames stubs)
src/games/          game packages: manifest + SEO content + engine shim per slug + registry
src/lib/            env, db, auth (session/password/email/google), captcha, rate-limit, assets,
                    scores-client (online board + static-site local-board fallback),
                    daily/ (seed, board, streaks)
src/lib/rewards/    rewards domain: ledger, payout math, heartbeat, fraud, config, IST utils
src/components/     shadcn/ui + Turnstile + RewardsHud + portal (GameStage, ConsentBanner…)
prisma/schema.prisma data model
Dockerfile + render.yaml   one-click Render deploy (bun, standalone, SQLite)
tests/              bun test suites (rewards, game-kit, daily)
scripts/            seed-admin, backup-db, docker-start, verify-schema, gen-og-images
QA.md               pre-ship checklist (run before any game ships)
```

## Documentation

- [technical-documentation.md](technical-documentation.md) — architecture, data model, APIs, security
- [business-documentation.md](business-documentation.md) — reward program mechanics + admin runbook
- [docs/threat-model.md](docs/threat-model.md) — security threat model + phased hardening plan
- [docs/anti-cheat.md](docs/anti-cheat.md) — anti-cheat layers A-F: architecture + operations runbook
- [docs/incident-runbook.md](docs/incident-runbook.md) — security incident playbook (freeze, rotate, communicate)
- [docs/roadmap.md](docs/roadmap.md) — post-security growth/retention build queue (ADR-029)
- [SECURITY.md](SECURITY.md) — security controls overview, PR review checklist, disclosure contact
- [decisions.md](decisions.md) — architecture decision records
- [help.md](help.md) — player & admin FAQ
- [CHANGELOG.md](CHANGELOG.md) — versioned history
- [QA.md](QA.md) — pre-ship checklist (run before any game ships)
- [compact.md](compact.md) — state summary for future sessions

## Security & fair leaderboards

The browser is hostile: every client-sent score, duration and heartbeat is
untrusted. Since v0.8 (hardening phase 2):

- **Global boards are account-gated.** Posting to `/api/scores` requires an
  account; a RANKED entry additionally requires a server-issued, HMAC-SIGNED
  run token (`POST /api/run/start` at run start — binds user, game and daily
  seed to the server clock; single-use; key-id rotation via `RUN_TOKEN_KEYS`).
  Guests keep a per-browser local board with a "sign in to rank" hint.
- **Board names are account callsigns** — one per account, case-insensitive
  unique, sanitized + blocklisted, settable on /rewards. No impersonation.
- Passwords are argon2id (min 10 chars); login has per-account/per-IP
  exponential-backoff lockout + captcha escalation; rate limiting persists in
  SQLite; every mutation route checks Origin + JSON content-type; production
  boots only with real secrets (`SESSION_SECRET`, `DAILY_SALT`).
- Deploys behind a reverse proxy must set `TRUSTED_PROXY=1` (see
  .env.example); production Caddy template in `deploy/Caddyfile` (auto-HTTPS,
  body caps, hardened headers); container runs non-root on loopback.
- Full security-header set (strict CSP, HSTS, …) on the dynamic deploy;
  structured security logging + webhook alerts; incident runbook at
  [docs/incident-runbook.md](docs/incident-runbook.md).

A fan tribute, not affiliated with ahwoo. Rewards payouts involve real money and require
legal/tax review before going live — see business-documentation.md. The security-hardening
program's engineering gates are ALL GREEN (phases 2-6 + 8: auth hardening, signed run
tokens, risk scoring + moderation, transactional payouts, admin 2FA + audit, kill
switches, security headers, incident runbook, and a 26-attack HTTP abuse suite —
[docs/threat-model.md](docs/threat-model.md)); `REWARDS_ENABLED` stays off pending the
program's own go/no-go. Replay verification (phase 7) is deferred until the engines are
deterministic — documented, not faked.
