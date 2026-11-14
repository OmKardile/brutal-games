# compact.md — project state snapshot

Last updated: 2026-11-14 (v0.13.0 — slice 2: lite mode + installable PWA,
ADR-029). Read this before working in the repo.

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

## Daily challenges (v0.12.0)
- Seed = FNV-1a(slug:dateKey:DAILY_SALT) server-side (falls back to
  SESSION_SECRET; dev fallback warns). GET /api/daily/seed — response now
  also carries `mutator` (null for games without a set). Client offline
  fallback seed → stored UNRANKED.
- **Daily mutators (slice 1, STACK v1)**: five score-rule twists
  (CLASSIC/PERFECT HEAVY/STREAK MASTER/TALL TOWER/COMBO HUNT), derived
  server-side from `hashString(slug:mutator:dateKey:daily)` — same-day
  same-mutator for everyone, zero storage, zero client trust. Transform
  lives in the STACK shim summary() (engine untouched);
  `/api/daily/run` scales the plausibility ceiling by
  `mutatorPlausibilityMultiplier` (2 on perfect-heavy/combo-hunt days, else 1
  — never tightens). Tests pin transform math + multiplier behavior.
- **WhatsApp challenge loop (slice 1)**: after a daily run ends,
  CHALLENGE A FRIEND opens `wa.me` with score + mutator + `?daily=1` deep
  link (same seed for the recipient); share_click analytics ride the
  existing adapter (kind=challenge).
- POST /api/daily/run: zod + rate limit (12/min/IP) + today-only +
  plausibility (manifest ceilings × mutator multiplier + 5s grace) +
  seed-match check. Input logs stored capped 16k chars, NOT verified (v1
  limitation, documented).
- **Retention read-out (slice 0)**: GET /api/admin/stats?days=7|30|90 —
  DAU/D1 cohorts/runs/ranked-share from DailyActivity ∪ DailyRun (guests by
  name key, approximation documented in src/lib/daily/stats.ts); admin
  `stats` tab renders it. No new tracking.
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

## Security program (v0.10.1, COMPLETE)
- **docs/threat-model.md** is the contract; **docs/anti-cheat.md** is the
  layer architecture + ops runbook; SECURITY.md = operations.
  Phase 1 (audit) DONE. **Phase 2 DONE (v0.8.0)** — ADR-021/022/023.
  **Phase 3 DONE (v0.9.0)** — ADR-024. **Phase 4 DONE (v0.9.1)** — ADR-025.
  **Phase 5 DONE (v0.9.2)** — ADR-026. **Phase 6 DONE (v0.10.0)** — ADR-027.
  **Phase 8 DONE (v0.10.1)** — ADR-028. ALL ENGINEERING GATES GREEN
  (2-6 + 8; phase 7 replay stays deferred until deterministic engines).
- Phase 4 shipped: explainable risk score (3/10/25 per flag type, confirmed
  x2; bands 15=MEDIUM review, 40=HIGH auto-HOLD — pending entries + payout
  block, never bans); top-3 + HIGH-risk entries pending verification (admin
  BOARDS tab verify/remove/restore; 24h auto-release for LOW-risk; confirmed
  fraud = never ranks again); payout gating (72h age + 3 active days +
  non-HIGH risk; 48h halved-cap cooling; unique upiKey per account +
  UPI_REUSE flag); privacy (HMAC fingerprints + hashed IPs, 90-day purge).
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
- Phase 5 shipped: transactional payout create/approve (idempotency keys,
  in-tx re-checks, concurrent double-spend dead); mandatory admin TOTP 2FA
  (RFC 6238 node:crypto-only, AES-GCM at rest, forced enrollment) + 1h
  SameSite=Strict admin-session cookie + optional ADMIN_IP_ALLOWLIST;
  append-only AdminAudit on every admin mutation (AUDIT tab); self-approval
  blocked; optional two-person rule (TWO_PERSON_THRESHOLD_MINOR, default 0);
  REWARDS_PAYOUTS_PAUSED kill switch (runtime-flippable toggle);
  monthlyReconciliation + GET /api/admin/reconciliation.
- Phase 6 shipped: headers-only middleware (CSP/HSTS/nosniff/Referrer/
  Permissions/X-Frame/COOP/CORP; CSP is strict-static because the portal is
  fully prerendered — nonces impossible, documented ADR-027;
  browser-verified zero violations); deploy/Caddyfile hardened template
  (auto-HTTPS, body cap, timeouts, dotfile/db blocking, no XTransformPort —
  C2 closed, dev Caddyfile cleaned too); Dockerfile non-root + loopback
  bind; structured security-log (auth.*/flag.*/payout.*/kill_switch/
  reconciliation.mismatch) + ALERT_WEBHOOK_URL alerts; dead /api route
  removed; docs/incident-runbook.md (triage, freeze, rotation order, fraud
  response, pool re-run, comms + post-mortem templates, host checklist).
- Still open from the audit: M8 hygiene tail (gitleaks pre-commit,
  Dependabot/audit cadence — phase 8); phase 7 replay verification stays
  deferred (needs deterministic engines). Account deletion deferred (payout
  records must outlive accounts — runbook documents the purge/export path).
- Caddyfile ships a dev-only `?XTransformPort=` open local-proxy handler —
  must never reach production (phase 6 ships a hardened template).
- Phase 8 shipped: tests/security/abuse-suite.test.ts — boots the real
  standalone build on a throwaway DB and fires 26 threat-catalogue attacks
  over HTTP, all asserted to fail safely (TRUSTED_PROXY=1 lets each test
  control its client IP). Caught + fixed a REAL bug (scores route capped
  runToken at 200 chars vs ~250-char signed tokens — ranked submissions
  would have all failed). Pre-commit secret scan (.githooks/pre-commit;
  repo + full history scanned clean), Dependabot (.github/dependabot.yml),
  bun audit triaged (89 dev-chain findings; production zod updated), manual
  red-team pass logged in docs/anti-cheat.md (25 attack classes mitigated).
- REWARDS_ENABLED stays FALSE by decision; enabling awaits the program's
  go/no-go + legal/tax sign-off (business-documentation.md) — the
  engineering gates are complete.
- REWARDS_ENABLED stays FALSE until phases 2-6 + 8 pass (ADR-020).
- Standing rules: localStorage never carries value; server clock decides
  durations; authz only in route handlers (no middleware exists — keep it);
  flags not auto-bans (only auto-HOLD at high risk); engines untouched.

## Known gaps / next steps
- **The build queue is docs/roadmap.md (ADR-029)**: slices 0-2 SHIPPED
  (v0.12.0 stats read-out + WhatsApp challenge links + STACK mutators;
  v0.13.0 lite mode + PWA) → next: slice 3 (festival calendar reusing the
  mutator system + seasonal SEO pages) → cosmetics/shields/goals/leagues/
  clips → LAST the determinization epic (engine migration onto the kit loop
  = phase-7 replay verification AND ghost races together). Five gates
  (G1-G5) sit between phases; G1 traffic proof now has its instrument
  (the stats tab).
- **Lite mode (v0.13.0)**: game-kit/quality.ts QualityMonitor (production
  FPS EMA, one-way tiers, 8s cooldown) degrades PAGE effects only via
  [data-quality] CSS kill-switches — engines untouched. QUALITY toggle in
  GameStage (auto/lite/off, localStorage). dprCapFor() awaits phase H.
- **PWA (v0.13.0)**: manifest + sw.js (app-shell precache, runtime chunks,
  API NEVER cached — offline runs stay structurally unrankable) +
  offline.html fallback + icons via scripts/gen-pwa-icons.ts. SW registers
  in production only (PwaRegister). CSP already allows 'self' SW/manifest.
- Engine migration onto the kit loop (now phase H of the roadmap — unlocks
  full determinism + replay verification).
- Poki/CrazyGames stubs must be finished ONLY against their official SDK docs.
- Standalone per-game export (self-contained dist/<slug>/index.html, <8 MB) —
  phase 6, on request only.
- Google OAuth + email delivery untested end-to-end (no external creds).
- Settings cache in-memory (single instance only); rate limiter now persistent.
- Legal review before real payouts / consent banner activation / ads.txt.
