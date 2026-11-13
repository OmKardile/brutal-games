# Technical documentation

## Runtime & architecture

Single Next.js 16 App Router app (standalone output) served by bun behind Caddy.
One process, one SQLite database — the in-memory rate limiter and lazy settings cache
are safe because of this. If you scale to multiple instances, the limiter and settings
cache must move to shared state (known limitation, intentional for v1).

```
Browser ── Caddy (:81) ── Next.js (bun, :3000)
                              ├── /api/auth/*     sessions, email, google
                              ├── /api/rewards/*  earning + payouts (player)
                              ├── /api/admin/*    pool/payouts/flags/users/settings
                              └── Prisma ── db/custom.db (SQLite, WAL)
```

The canvas game engine (`src/game/`) is dependency-free and untouched by the rewards
system: the play page mounts a passive `RewardsHud` component that listens to window
input events and drives the heartbeat API. No engine API changes.

## Data model (prisma/schema.prisma)

| Model | Role |
|---|---|
| `User` | identity: scrypt hash, role PLAYER/ADMIN, status ACTIVE/FROZEN, `emailVerified`, `adultDeclaredAt` (18+), `upiId` |
| `Session` | cookie token (random) → sha256 hash, 30-day sliding expiry |
| `EmailToken` | one-time verify (72h) / reset (1h) tokens, hashed |
| `PointEvent` | append-only ledger. `points` ±, `reason`, unique `idempotencyKey`, `reversalOfId` (unique → one reversal per original) |
| `DailyActivity` | per-user-per-IST-day rollup; enforces `DAILY_POINT_CAP`; streak marker |
| `PlaySession` | heartbeat session: hashed token, server timestamps, beat counter, idle expiry (30 min), beat cap (240) |
| `MonthlyPool` | month (IST), net revenue (paise), share %, status DRAFT→LOCKED, `leftoverMinor`, `voidedMinor` |
| `PoolDistribution` | immutable per-user snapshot at lock: points, raw share, capped share |
| `PayoutRequest` | PENDING→APPROVED→PAID/REJECTED, `holdUntil` snapshot, transaction ref |
| `FraudFlag` | flag-only signals → manual review queue |
| `DeviceFingerprint` | hashed device signals + last IP, per user |
| `RewardSetting` | key→JSON overrides of code defaults (admin editable) |

Money is int paise everywhere. Reward days/months are Asia/Kolkata (IST) —
`src/lib/rewards/ist.ts` converts to UTC ranges for queries.

## Key invariants

- **Ledger append-only.** No `update`/`delete` on `PointEvent` anywhere in the codebase.
  Corrections are negative `ADMIN_VOID` rows linked via `reversalOfId`.
- **Idempotency everywhere.** Heartbeat key `hb:{session}:{beat}`, run key `run:{session}`,
  streak key `streak:{user}:{date}`, challenge key `challenge:{user}:{date}`. Replays
  return the original event.
- **Server timestamps only.** Clients never send times; the server derives all durations
  from `PlaySession.startedAt/lastBeatAt`.
- **Pool-only payouts.** `available = Σ locked distributions − Σ non-rejected payouts`.
  Zero revenue ⇒ zero pool ⇒ zero payouts. Caps clamp; leftover stays in the pool and is
  visible in the admin preview before locking.
- **Month clamping.** A user's month sum is clamped ≥ 0, so a fraud reversal of last
  month's points can never inflate other players' shares or create negative payouts.

## API surface

Auth: `POST /api/auth/{signup,login,logout,resend-verification,forgot-password,reset-password}`,
`GET /api/auth/{me,verify-email}` (verify-email is the email link), Google:
`GET /api/auth/google/{start,callback}` (inactive without env keys).
Rewards (session required): `POST /api/rewards/{consent,upi,payout}`,
`GET /api/rewards/{summary,events,payout}`,
`POST /api/rewards/{session/start,heartbeat,run-end}`.
Public: `GET /api/rewards/config`, `GET /api/scores`, `POST /api/scores`.
Admin (ADMIN role): `GET|POST /api/admin/{pool,payouts,flags,settings}`,
`GET /api/admin/pool/preview`, `GET|POST /api/admin/users[/id]`.

All bodies are zod-validated. Rate limits (in-memory sliding window): login 10/min/IP,
signup 5/h/IP, heartbeat 10/min + interval check, payout 3/day, session starts 30/h.

## Security notes

- Passwords: node:crypto scrypt (N=16384), `timingSafeEqual` verification.
- Sessions: 32-byte random tokens, httpOnly/SameSite=Lax cookies, sha256 at rest,
  reset kills all sessions.
- No account enumeration: signup and forgot-password return generic responses.
- Turnstile on signup + payout. Dev bypass when `TURNSTILE_SECRET_KEY` unset;
  fail-closed in production on network errors.
- Anti-fraud signals never auto-punish: they open `FraudFlag`s for manual review.
  Freezing/voiding is always a human action.
- Known limits: run stats are client-reported (mitigated by session-duration
  plausibility checks + daily caps + review); VPN/datacenter detection is a static
  admin-editable list (no GeoIP service); IPv6 list matching is exact-match only.

## Testing

`bun test tests/` — 52 tests. `payout-math.test.ts` (pure edge cases: zero revenue,
zero points, caps, rounding residue, thresholds), `ledger.test.ts` (real temp SQLite DB:
idempotency, daily-cap clamps, streaks, reversal semantics, month clamping, gates),
`rewards-logic.test.ts` (heartbeat timing, run plausibility, IST boundaries, IP/CIDR
matching, fingerprint stability, challenge determinism).

## Operations

- **Schema changes:** edit `prisma/schema.prisma` → `bun run db:push`.
- **Backups:** `bun run db:backup [dest]` (SQLite `VACUUM INTO`, safe while running).
  Schedule externally (cron) — WAL is checkpointed into the backup.
- **Admin bootstrap:** `bun run seed:admin` (env `ADMIN_EMAIL`/`ADMIN_PASSWORD` or args).
  Promotion of an existing account requires that account to be email-verified.
  There is no other promotion path.
- **Email:** set `RESEND_API_KEY` or `BREVO_API_KEY` (+ `MAIL_FROM`). Without a key,
  emails print to the server console (dev only).
- **Google login:** set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`; button appears automatically.
- **Env vars:** see `.env.example`.

## Deployment

Two supported targets share one codebase:

- **Render (full app):** `render.yaml` blueprint + `Dockerfile` (oven/bun, Next
  standalone, Prisma/SQLite at `file:/data/brutal.db`). Boot sequence in
  `scripts/docker-start.sh`: `prisma db push` (schema sync, idempotent) → optional
  admin seed (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) → standalone server. Health probe:
  `GET /api/health` (checks SQLite with `SELECT 1`). `APP_URL` falls back to
  Render's injected `RENDER_EXTERNAL_URL`. Free plan = ephemeral filesystem +
  15-min spin-down; persistence requires a paid instance + the commented `disk:`
  block in `render.yaml`.
- **GitHub Pages (static arcade):** `STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/repo`
  build; server-only routes are stripped first (runbook in README). The board
  client falls back to a per-browser localStorage leaderboard.

**Rule:** every reference to a file in `/public` (JSX, canvas, metadata) must be
base-path aware — `assetUrl()` from `src/lib/assets.ts`, or inline
`process.env.NEXT_PUBLIC_BASE_PATH` in the engines. Root-absolute paths 404 on
the Pages sub-path build (bug fixed in 0.4.1).

## Game framework & portal (v0.7.0)

### Architecture

```
/games/[slug] (SSR SEO page)
  └── GameStage (client, poster → lazy runner)
        └── src/games/<slug>/page.tsx (runner — full game UX)
              ├── buildCtx()  → ctx { input, audio, adapter(rules), events, daily }
              └── shim.ts createGame(ctx) → wraps the ENGINE (src/game/*, untouched)
                    ├── daily seed → patched Math.random during the run
                    ├── pause/resume → rAF gating (+ window resize nudge on fullscreen)
                    └── phase transitions → adapter.gameplayStart/Stop (enforced)
```

Engines are never edited. The kit (`src/game-kit/`) owns: fixed-timestep loop,
unified input (touch-action none, no long-press/zoom, first-input signal),
canvas scaler (16:9, DPR ≤ 2, safe-area), audio host (unlock-on-gesture,
persisted mute, auto-mute on blur, ad suppression), safe storage (memory
fallback), seeded rng (independent logic/cosmetic streams), juice (trauma
shake, particles, tweens, hit-stop; prefers-reduced-motion), pooling, dev perf
overlay, and the input-log recorder.

### PortalAdapter & enforced rules (`src/game-kit/adapter/`)

One interface for ads/analytics/lifecycle. `createRuleEnforcedAdapter` wraps
any implementation with the non-negotiables: gameplayStart only from stopped
state and never during an ad; gameplayStop never back-to-back (queued during
ads); interstitials only at natural breaks with a 90 s min gap and none in the
first session minute; every ad race-times out at 5 s and the game continues;
pause+mute hooks fire around every ad; rewarded ads grant in-game perks only.
Noop (default) / OwnPortal (sendBeacon analytics, no network wired) / Poki +
CrazyGames stubs (method names to be verified against official SDK docs at
activation — never guessed).

Rewards hookup: GameStage mounts the passive RewardsHud on EVERY game (was
/play only); the adapter's phase signals and the heartbeat come from the same
transitions. Points stay engagement-based; ads never appear in reward flows.

### Daily challenges (`src/lib/daily/`)

| Model | Role |
|---|---|
| `DailyRun` | append-only completed runs (game, dateKey, userId?, name, score, durationMs, seedUsed int32 (uint32 \| 0), ranked, capped inputLog) |
| `DailyStreak` | per-user consecutive-day streak {current, longest, lastDateKey} |
| `PortalSetting` | KV overrides: DAILY_TZ (default Asia/Kolkata), interstitial gaps, ad timeout, log cap |

APIs: `GET /api/daily/seed?game=` (server seed; dateKey in configured tz),
`POST /api/daily/run` (zod + 12/min/IP rate limit + today-only + plausibility
vs manifest + seed-match; mismatch ⇒ stored UNRANKED),
`GET /api/daily/board?game=&dateKey=`, `GET /api/daily/summary?game=`.

Determinism posture (deliberate, documented): the shim seeds Math.random
during a run — spawn sequences match the day's seed for everyone; frame timing
does not (engines own variable-dt loops). Replay verification of stored input
logs is NOT implemented in v1. Anti-cheat = plausibility ceilings + rate
limits + seed checks + flag-only review, mirroring the rewards posture.

### SEO layer

Per-game SSG pages with unique 150-300 word copy, how-to-play (desktop /
mobile / gamepad), tips, FAQ, related games, last-updated. JSON-LD:
VideoGame+WebApplication co-typed, BreadcrumbList everywhere, ItemList on
categories, WebSite+Organization on home/about. aggregateRating is never
emitted (no real ratings — faking it risks manual action); FAQ markup is
intentionally omitted. Dynamic `sitemap.xml` (lastmod from manifests) and
`robots.ts` (blocks /api, /admin, /rewards, auth pages) use absolute URLs via
`src/lib/site.ts` (APP_URL → RENDER_EXTERNAL_URL). OG/Twitter images are
generated at 1200×630 via `bun run og:gen` (sharp, no webfonts). The game
container reserves its aspect ratio (CLS-safe) and game chunks lazy-load on
Play click — first paint ships zero game code.

### Known limitations

- `src/game/merge.ts(616)` has a pre-existing type error (v0.6.0); engines are
  off-limits — to be fixed only in the proposed engine migration.
- In-memory rate limiter/settings caches: single-instance only.
- Guest streak merge is an approximation (we keep {current, longest,
  lastDateKey}, not day-sets).
- Poki/CrazyGames stubs are unimplemented by policy until their official docs
  are consulted.
