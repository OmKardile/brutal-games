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
| `User` | identity: argon2id hash (legacy scrypt verifiable), role PLAYER/ADMIN, status ACTIVE/FROZEN, `emailVerified`, `adultDeclaredAt` (18+), `upiId` + `upiKey` (unique normalized UPI), `nameKey` (unique callsign), `totpSecret`/`totpEnabledAt` (admin 2FA, AES-256-GCM at rest) |
| `Session` | cookie token (random) → sha256 hash, 30-day sliding expiry |
| `EmailToken` | one-time verify (72h) / reset (1h) tokens, hashed |
| `RateLimitBucket` | persistent rate-limit + lockout state: sliding-window hit array (JSON), consecutive-failure counter, `lockedUntil` (login backoff). Survives restarts |
| `PointEvent` | append-only ledger. `points` ±, `reason`, unique `idempotencyKey`, `reversalOfId` (unique → one reversal per original) |
| `DailyActivity` | per-user-per-IST-day rollup; enforces `DAILY_POINT_CAP`; streak marker |
| `PlaySession` | run session (0.8: ALL runs, not just rewards): HMAC-SIGNED token (uid/game/seed/nonce/server startedAt/kid — src/lib/run-token.ts; only sha256(token) stored), heartbeat hash-chain `challenge`, per-beat activity `beatLog` (input+frames, last 48), `scoreClaimedAt` (single-use ranked-score claim), `seed` binding for dailies |
| `HighScore` | global board entry; `userId`/`ranked` (0.8) + `pending` verification + soft-removal audit columns (0.9.1) |
| `MonthlyPool` | month (IST), net revenue (paise), share %, status DRAFT→LOCKED, `leftoverMinor`, `voidedMinor` |
| `PoolDistribution` | immutable per-user snapshot at lock: points, raw share, capped share |
| `PayoutRequest` | PENDING→APPROVED→PAID/REJECTED, `holdUntil` snapshot, `idempotencyKey` (unique — replays no-op), `approvedBy` (two-person rule), transaction ref |
| `FraudFlag` | flag-only signals → manual review queue |
| `DeviceFingerprint` | hashed device signals + last IP, per user |
| `RewardSetting` | key→JSON overrides of code defaults (admin editable) |
| `DailyRun` / `DailyStreak` / `PortalSetting` | daily challenges: per-day runs (seed-checked, size-capped input log, pending/removal moderation since 0.9.1), streaks, portal config |
| `AdminAudit` | append-only admin trail: who/what/when/target/before/after + IP (0.9.2) |

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
- **Ranked scores need a server-issued run token** (0.8). `POST /api/run/start` opens the
  session; the single-use claim (`scoreClaimedAt`) + manifest plausibility ceiling
  against the server-measured duration gate the ranked board. Board names are account
  callsigns (`User.nameKey` unique) — client-supplied names never reach ranked boards.
- **Pool-only payouts.** `available = Σ locked distributions − Σ non-rejected payouts`.
  Zero revenue ⇒ zero pool ⇒ zero payouts. Caps clamp; leftover stays in the pool and is
  visible in the admin preview before locking.
- **Month clamping.** A user's month sum is clamped ≥ 0, so a fraud reversal of last
  month's points can never inflate other players' shares or create negative payouts.

## API surface

Auth: `POST /api/auth/{signup,login,logout,resend-verification,forgot-password,reset-password,profile,sessions}`
(sessions also GET — list; `POST {revoke: others|all}` — log out everywhere),
`GET /api/auth/{me,verify-email}` (verify-email is the email link), Google:
`GET /api/auth/google/{start,callback}` (inactive without env keys).
Runs & boards: `POST /api/run/start` (session required — opens the run session,
returns the CSPRNG token; NO 18+/rewards coupling), `POST /api/scores`
(session required; `runToken` makes the entry ranked), `GET /api/scores`
(public, ranked entries only).
Rewards (session required): `POST /api/rewards/{consent,upi,payout}`,
`GET /api/rewards/{summary,events,payout}`,
`POST /api/rewards/{session/start (legacy compat → same lib as /api/run/start),heartbeat,run-end}`.
Daily: `GET /api/daily/{seed,board,summary}` (seed also returns the day's
`mutator` — null for games without a set), `POST /api/daily/run` (plausibility
ceiling scales by the mutator multiplier, ×1 on classic days).
Admin (ADMIN role + TOTP 2FA + 1h admin-session cookie):
`GET /api/admin/stats?days=7|30|90` (retention read-out — DAU/D1 cohorts
from DailyActivity ∪ DailyRun, no new tracking; v0.12.0),
`GET|POST /api/admin/{pool,payouts,flags,settings,boards}`,
`GET /api/admin/{audit,reconciliation}` (+ `?month=`),
`GET /api/admin/pool/preview`, `GET|POST /api/admin/users[/id]`,
`POST /api/admin/totp/{setup,enable}` (open during forced enrollment).

All bodies are zod-validated. All state-changing routes check the CSRF
baseline (Origin/Host + JSON content-type, `src/lib/http.ts`). Rate limits are
PERSISTENT (SQLite `RateLimitBucket`, survive restarts): login 10/min/IP +
per-account/per-IP backout lockout (5 fails → 15s → doubling to 60min) +
Turnstile after 3 fails; signup 5/h/IP; reset 20/min/IP; heartbeat 10/min +
interval check; payout 3/day; run-start 30/h; score-submit 30/h; daily-run
12/min/IP + 12/min/user; session-start 30/h; upi 10/h; consent 5/h;
profile 10/h. Client IP comes from the trusted-proxy parser (`TRUSTED_PROXY=1`
behind a reverse proxy; headers ignored otherwise).

## Security notes

- **Threat model + phased hardening plan: [docs/threat-model.md](docs/threat-model.md)**
  and **[SECURITY.md](SECURITY.md)** (controls overview + review checklist +
  disclosure contact) and **[docs/anti-cheat.md](docs/anti-cheat.md)** (layer
  architecture + ops runbook). Phases 1-3 shipped (0.7.1/0.8.0/0.9.0):
  auth/API-baseline/CSRF/persistent-RL/scores lock-down + signed run tokens +
  heartbeat hash-chain + plausibility/statistics + risk scoring with
  pending-verification boards, payout gating and privacy hashing (0.9.1).
  Rewards stay disabled until phases 2-6 + 8 pass.
- Passwords: argon2id via `Bun.password` (legacy scrypt verifiable + rehash-on-
  login), min length 10, no composition rules; optional HIBP breached-password
  rejection (`HIBP_CHECK=1`, k-anonymity, fails open). Login has per-account +
  per-IP exponential-backoff lockout, Turnstile escalation and a dummy-verify
  timing equalizer.
- Sessions: 32-byte random tokens, httpOnly/SameSite=Lax cookies, sha256 at rest,
  Secure on https, reset kills all sessions, freeze revokes all sessions,
  "log out everywhere" on /rewards. Frozen accounts are rejected by `authUser()`.
- CSRF: Origin/Host allowlist (Sec-Fetch-Site/Referer fallback) + JSON
  content-type requirement on every state-changing route, layered with
  SameSite=Lax.
- Secrets: `SESSION_SECRET` (≥32 chars) and `DAILY_SALT` fail HARD in
  production — no code fallbacks.
- No account enumeration: signup and forgot-password return generic responses;
  login burns the same KDF cost for unknown users.
- Turnstile on signup + payout + login-after-failures. Dev bypass when
  `TURNSTILE_SECRET_KEY` unset; fail-closed in production on network errors.
- Anti-fraud signals never auto-punish: they open `FraudFlag`s for manual review.
  Freezing/voiding is always a human action.
- Board names: account callsigns only — policy sanitization, reserved names
  (leet-aware), blocklist (`NAME_BLOCKLIST` env), case-insensitive uniqueness.
- Anti-cheat (0.9.1): explainable risk score (LOW/MEDIUM/HIGH; HIGH = auto-
  HOLD — pending entries + payout block, never a ban); top-3 and HIGH-risk
  entries pending verification (24h auto-release for LOW-risk; admin
  BOARDS moderation tab; confirmed-fraud users never rank); payout gating
  (72h account age + 3 active days + risk hold; 48h halved-cap cooling);
  unique UPI destination per account; HMAC-salted fingerprints/IPs with a
  90-day purge.
- Anti-cheat (0.9): run tokens are HMAC-signed with key-id rotation
  (`RUN_TOKEN_KEYS`); verification is offline (before any DB access); ranked
  dailies must bind the exact server seed; ranked scores are statistically
  classified (own history + population, flag-only); heartbeats carry a
  rotating challenge echo (replays → 409) plus frame-drift/input-entropy
  signals; sessions older than 6h cannot be scored.
- Headers (0.10.0): headers-only middleware (src/middleware.ts) sets strict
  CSP (no third-party script hosts; Turnstile origin only; prerendered pages
  cannot carry nonces — documented ADR-027), HSTS, nosniff, Referrer-Policy,
  Permissions-Policy, X-Frame-Options, COOP/CORP. Authorization NEVER lives
  in the middleware. Hardened Caddy template at deploy/Caddyfile; Dockerfile
  runs non-root on loopback. Security events stream as JSON logs
  (src/lib/security-log.ts) + ALERT_WEBHOOK_URL alerts; incident procedures
  in docs/incident-runbook.md.
- Known limits: statistical and activity signals are FLAG-ONLY (humans decide;
  Layer D replay verification is deferred until the engines are deterministic);
  VPN/datacenter detection is a static admin-editable list (no GeoIP service);
  IPv6 list matching is exact-match only.

## Testing

`bun test tests/` — 225 tests. `payout-math.test.ts` (pure edge cases: zero revenue,
zero points, caps, rounding residue, thresholds), `ledger.test.ts` (real temp SQLite DB:
idempotency, daily-cap clamps, streaks, reversal semantics, month clamping, gates),
`rewards-logic.test.ts` (heartbeat timing, run plausibility, IST boundaries, IP/CIDR
matching, fingerprint stability, challenge determinism), `auth-hardening.test.ts`
(argon2id + legacy scrypt + rehash flags + policy, name policy, CSRF matrix,
backoff math), `rate-limit.test.ts` (persistent sliding window, restart persistence,
lockout state machine), `scores-service.test.ts` (ranked-with-token, replay burn,
foreign/mismatched/aborted tokens, implausible scores, callsign claims,
ranked-only boards), `anti-cheat.test.ts` (token signing/rotation/tamper, heartbeat challenge chain + replay/forgery, entropy/drift, daily seed claims, statistical classification), `risk-boards.test.ts` (risk bands, pending/moderation flows, cooling, payout gating, UPI constraint, HMAC privacy), `payout-integrity.test.ts` (RFC 6238 vectors, admin-token crypto, concurrent double-spend, idempotency, self-approval, two-person, kill switch, reconciliation, audit), `tests/security/abuse-suite.test.ts` (the phase-8 gate: boots the real standalone build on a throwaway DB and fires 26 threat-catalogue attacks over HTTP — forged/replayed/tampered tokens, impossible scores, heartbeat flood/replay, CSRF, admin probes, name poisoning, UPI pooling, brute force, IP rotation, XFF spoofing, oversized payloads — all asserted to fail safely).

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

APIs: `GET /api/daily/seed?game=` (server seed; dateKey in configured tz; the
day's `mutator` id for games with a set — derived server-side from the same
hash family, zero client trust),
`POST /api/daily/run` (zod + 12/min/IP rate limit + today-only + plausibility
vs manifest × per-mutator multiplier + seed-match; mismatch ⇒ stored UNRANKED),
`GET /api/daily/board?game=&dateKey=`, `GET /api/daily/summary?game=`.

Mutators (v0.12.0, slice 1 — STACK v1, five): score-rule twists applied in
the SHIM's summary() so the submitted score already carries the mutator math
(engine untouched). `mutatorIdFor(slug, dateKey)` = deterministic rotation;
`applyMutator(id, {score, perfects, bestStreak})` = the transform (mirrored
in the runner's game-over card); `mutatorPlausibilityMultiplier(id)` scales
the manifest ceiling (2 on perfect-heavy/combo-hunt, else 1 — never
tightens). WhatsApp challenge links ride the same daily flow: `wa.me` share
of score + mutator + `?daily=1` deep link.

Retention read-out (v0.12.0, slice 0): `src/lib/daily/stats.ts` computes
DAU/D1 cohorts from DailyActivity ∪ DailyRun (guests by name key —
approximation documented in the module); `GET /api/admin/stats?days=`
serves it role-guarded to the admin `stats` tab. No new tracking.

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

## Post-security roadmap (v0.11.0)

The build queue after security v0.10.1 lives in
[docs/roadmap.md](docs/roadmap.md) (ADR-029): slice 0 — retention read-out
(DAU/D1/D7 from existing `DailyActivity`/`DailyRun` tables, new
`GET /api/admin/stats` + admin `stats` tab, no new tracking); slice 1 —
WhatsApp challenge links (`wa.me` deep links extending the existing
`navigator.share` flow) + STACK daily mutators derived server-side from the
seed hash (per-mutator plausibility multipliers in the manifest — a
"fast drops" day without them flags honest runs); then lite mode + PWA,
festival calendar, goals/leagues/clips, and last the determinization epic
(engines onto the kit's fixed-timestep loop = phase-7 replay verification
+ ghost races). Engineering gates G1-G5 sit between phases; the abuse suite
must stay green after every one.
