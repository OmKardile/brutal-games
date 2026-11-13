# compact.md — project state snapshot

Last updated: 2026-11-13 (v0.7.1 — security program phase 1: audit + threat model). Read this before working in the repo.

## What this is
BRUTAL//GAMES — Next.js 16 browser arcade (fan tribute to github.com/ahwootech/BRUTAL):
five games — ARENA, STACK, REFLEX, DODGE, MERGE — served through a reusable game
framework (game-kit), a portal (/games hub + per-game SEO pages + categories + /daily),
per-game leaderboards, a server-authoritative daily-challenge system, and an optional
player rewards program (monthly ad-revenue share, INR/UPI, manual payouts).

## Stack & conventions
- Bun runtime. Next 16 App Router, standalone output, `typescript.ignoreBuildErrors: true`
  (still keep `bunx tsc --noEmit` clean in src/ — KNOWN pre-existing exception:
  `src/game/merge.ts(616)` type error shipped in v0.6.0; engines are off-limits, fix
  only during the proposed engine migration).
- Tailwind 4 + shadcn/ui. Night/day theme: `<html data-theme>` + CSS vars
  (globals.css) + engine palettes (src/game/theme.ts); night default; live mid-run swap.
- Prisma 6 + SQLite at `db/custom.db` (WAL). Schema sync: `bun run db:push` (NOT
  migrations). Money = int paise (`*Minor` suffix). Reward + daily windows = IST
  (src/lib/rewards/ist.ts; daily tz is configurable via PortalSetting, default IST).
- Client pages are `'use client'` components; route handlers zod-validated,
  `export const dynamic = 'force-dynamic'`. Next 16: `await cookies()`, `await params`.
- Tests: `bun test tests/` (102 tests: rewards 52, game-kit 27, daily 23).
  tsconfig excludes `tests/` (bun-types).
- Static assets in JSX/canvas MUST go through `assetUrl()` (src/lib/assets.ts).
- Docs updated with every change: README, CHANGELOG (versioned), technical,
  business, decisions (ADR log), help, compact.

## Game architecture (v0.7.0)
- `src/game/` — canvas ENGINES (arena/stack/reflex/dodge/merge). DO NOT EDIT.
  Wrapped, never modified.
- `src/game-kit/` — reusable framework: fixed-timestep loop, UnifiedInput,
  CanvasScaler (16:9, DPR≤2), AudioHost (wraps Sfx), safe storage, seeded rng
  (logic/cosmetic streams), juice, Pool, perf overlay, input-log recorder,
  `adapter/` (PortalAdapter + enforced AdRules; Noop/OwnPortal/Poki+CrazyGames stubs).
- `src/games/<slug>/` — game PACKAGE: manifest.ts (metadata + plausibility
  ceilings), content.ts (unique SEO copy), shim.ts (wraps the engine into the
  kit contract: seed injection, rAF-gate pause, adapter signals), page.tsx (the
  RUNNER — former app page, full game UX, hosted by GameStage).
- `src/components/portal/GameStage.tsx` — poster (zero game code) → lazy runner
  on Play click; daily flow (seed fetch, UNRANKED fallback, run submission,
  input log), RewardsHud for ALL games, fullscreen, Android back-button exit.
- Routes: `/games`, `/games/[slug]` (SSG), `/games/category/[genre]` (SSG),
  `/daily`, `/about` `/contact` `/help`, not-found. Legacy `/play /stack /reflex
  /dodge /merge` = 308 redirects (next.config, query preserved) + meta-refresh
  stubs for the static export.
- SEO: unique per-game copy (150-300 words + how-to + tips + FAQ), JSON-LD
  (VideoGame+WebApplication co-typed, BreadcrumbList, ItemList), sitemap.ts +
  robots.ts (absolute URLs via src/lib/site.ts: APP_URL → RENDER_EXTERNAL_URL),
  OG images 1200×630 (`bun run og:gen`, sharp). metadataBase set in layout.
- Analytics: OwnPortalAdapter → sendBeacon to NEXT_PUBLIC_ANALYTICS_ENDPOINT
  (optional, Plausible/Umami-style; nothing stored locally). Events: game_load,
  play_start, run_end, daily_start, daily_complete, share_click, ad_shown,
  ad_failed. Consent banner ships disabled (NEXT_PUBLIC_CONSENT_BANNER=on).

## Daily challenges (v0.7.0)
- Seed = FNV-1a(slug:dateKey:DAILY_SALT) server-side (falls back to
  SESSION_SECRET; dev fallback warns). GET /api/daily/seed. Client offline
  fallback seed → stored UNRANKED.
- POST /api/daily/run: zod + rate limit (12/min/IP) + today-only +
  plausibility (manifest maxScorePerSecond/minRunSeconds + 5s grace) +
  seed-match check. Input logs stored capped 16k chars, NOT verified (v1
  limitation, documented).
- DailyRun append-only (best-per-player boards), DailyStreak (server for
  signed-in; guest localStorage `brutal.daily.streak`; merged on login —
  approximation documented in src/lib/daily/streaks.ts), PortalSetting KV.
- Determinism honesty: engines own variable-dt rAF loops; the shim seeds
  Math.random during a run = PARTIAL determinism (spawns seeded, timing not).
  Full determinism only for kit-native games; engine migration proposed
  separately. No cash for leaderboard rank, ever (rewards stay engagement-based).

## Rewards program (unchanged since 0.3.0, all working)
- `src/lib/auth/` cookie sessions (sha256 tokens), scrypt, email verify/reset
  (Resend/Brevo), Google OAuth slot. `src/lib/rewards/` ledger (append-only,
  idempotency keys, reversals), payout math, heartbeat (signed tokens),
  fraud (flag-only), payouts (pool-locked).
- APIs: `/api/auth/*`, `/api/rewards/*`, `/api/admin/*` (role-guarded),
  `/api/scores` (5 games), `/api/daily/*`, `/api/health`.
- Invariants: ledger append-only; payouts only from locked pools; points never
  reference ads; fraud flag-only; REWARDS_ENABLED default false.

## Environment (.env)
DATABASE_URL, APP_URL (or RENDER_EXTERNAL_URL), SESSION_SECRET (REQUIRED in
prod, ≥32 chars — fail-hard), DAILY_SALT (falls back to SESSION_SECRET; required
in prod), TRUSTED_PROXY=1 (behind any reverse proxy — rightmost-untrusted XFF
parsing; unset = headers ignored, fail-safe), TRUSTED_PROXIES (extra CIDRs),
TURNSTILE_SITE_KEY/SECRET_KEY, HIBP_CHECK=1 (optional breached-password
rejection), NAME_BLOCKLIST (optional extra banned words), RESEND_API_KEY or
BREVO_API_KEY + MAIL_FROM, GOOGLE_CLIENT_ID/SECRET,
NEXT_PUBLIC_ANALYTICS_ENDPOINT/SITE (optional), NEXT_PUBLIC_CONSENT_BANNER
(optional, default off).

## Local accounts (dev db)
- admin@brutal.local / brutal-admin-123 (ADMIN, verified)
- player1@brutal.local / player-pass-123 (verified, UPI playerone@okhdfc)
- Demo: 25 scores across 5 games; 2026-11 pool locked (₹50,000 revenue).

## Deployment
- **Render (primary):** render.yaml + Dockerfile (bun, standalone, SQLite at
  file:/data/brutal.db). Free plan = ephemeral disk + 15-min spin-down.
  Repo: https://github.com/OmKardile/brutal-games
- **GitHub Pages (static arcade):** STATIC_EXPORT=1 build; API routes stripped;
  boards fall back to localStorage; daily runs → local UNRANKED. For correct
  absolute sitemap/canonicals set APP_URL to the Pages origin.

## Security program (v0.9.0, active directive)
- **docs/threat-model.md** is the contract; **docs/anti-cheat.md** is the
  layer architecture + ops runbook; SECURITY.md = operations.
  Phase 1 (audit) DONE. **Phase 2 DONE (v0.8.0)** — ADR-021/022/023.
  **Phase 3 DONE (v0.9.0)** — ADR-024.
- Phase 3 shipped: HMAC-signed run tokens (userId/game/seed/nonce/server
  startedAt/kid; offline verify before DB; key-id rotation via RUN_TOKEN_KEYS,
  fallback derived from SESSION_SECRET; 6h stale window; duration from the
  SIGNED startedAt); heartbeat hash-chain challenge (echo sha256(prev
  challenge), rotated per beat — replays/dumb scripts 409 BAD_CHALLENGE);
  beatLog activity signals (frames→speed-hack/headless flags, input-entropy
  flag — flag-only); ranked dailies require seed-bound token claims; ranked
  scores statistically classified (z vs population + own-history multiple;
  watch/anomaly flags; <5 own samples exempt).
- Phase 2 recap: argon2id+rehash-on-login+min-10+HIBP; per-account+per-IP
  login backoff+Turnstile escalation+dummy-verify; persistent SQLite rate
  limiter + trusted-proxy clientIp; CSRF Origin+JSON everywhere; secrets
  fail-hard in prod; freeze revokes sessions; /api/scores locked (session +
  run token, single-use claim, plausibility vs server clock; tokenless =
  display-only; guests = local board); account-callsign board names
  (nameKey unique + policy); /api/auth/sessions + /api/auth/profile; deps
  pruned -21; SECURITY.md.
- Still open from the audit: H2 headers (phase 6), H5 admin 2FA/audit/self-
  approval (phase 5), H8 payout races (phase 5), M1 privacy hashing/retention
  (phase 4), M3/M4 board integrity/moderation + pending verification (phase
  4), M6 payout gating (phase 4/5), M7 monitoring/runbook (phase 6), M8
  hygiene (partial: deps done, gitleaks/audit cadence phase 8), M9 payouts
  kill switch (phase 5), L1 dead /api route (phase 6).
- Caddyfile ships a dev-only `?XTransformPort=` open local-proxy handler —
  must never reach production (phase 6 ships a hardened template).
- Next phases (each: docs+CHANGELOG+tests, then WAIT FOR OK):
  4 risk score/leaderboard integrity/device signals → 5 payout integrity/admin
  2FA+audit/kill switch → 6 headers/Caddy/backups/monitoring/runbook →
  7 replay (deferred) → 8 abuse-test suite + scans + red-team.
- REWARDS_ENABLED stays FALSE until phases 2-6 + 8 pass (ADR-020).
- Standing rules: localStorage never carries value; server clock decides
  durations; authz only in route handlers (no middleware exists — keep it);
  flags not auto-bans (only auto-HOLD at high risk); engines untouched.

## Known gaps / next steps
- Engine migration onto the kit loop (proposed separately — unlocks full
  determinism + replay verification).
- Poki/CrazyGames stubs must be finished ONLY against their official SDK docs.
- Standalone per-game export (self-contained dist/<slug>/index.html, <8 MB) —
  phase 6, on request only.
- Google OAuth + email delivery untested end-to-end (no external creds).
- Settings cache in-memory (single instance only); rate limiter now persistent.
- Legal review before real payouts / consent banner activation / ads.txt.
