# Changelog

All notable changes to BRUTAL//GAMES. Dates are UTC. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are ours, not semver-strict.

## [0.10.0] — 2026-11-13

### Security — hardening program phase 6 (headers, infra, monitoring, runbook)

Closes H2, C2, M7 (alerts/runbook) and L1/L4. `REWARDS_ENABLED` stays false.
Rationale: ADR-027.

**Security headers** (headers-only middleware — authorization still never
leaves route handlers)
- CSP (no third-party script hosts — Turnstile's origin only; object-src
  none; locked base-uri/form-action/frame-ancestors; tight connect-src with
  optional analytics origin), HSTS 180d, nosniff, Referrer-Policy,
  Permissions-Policy, X-Frame-Options SAMEORIGIN, COOP/CORP.
- Documented CSP trade-off: the portal is fully prerendered, so per-request
  nonces cannot be injected into static HTML — script-src carries
  'unsafe-inline' for Next's hydration bootstrap; everything else stays
  strict. Browser-verified: zero console errors or CSP violations on the
  landing and game pages.

**Infrastructure (C2 + L4)**
- New hardened production Caddy template (`deploy/Caddyfile`): auto-HTTPS,
  mirrored security headers, 1MB body cap, proxy timeouts, dotfiles/db/
  backups blocked, Server header hidden, app on localhost. The dev Caddyfile
  loses the `?XTransformPort=` open local-proxy handler for good.
- Dockerfile: non-root runtime (`USER bun`), app binds loopback only.

**Monitoring + incident response (M7)**
- Structured security-log stream (JSON events on stdout: auth.*, flag.*,
  payout.*, payout.kill_switch, admin.login_new_ip, reconciliation.mismatch
  — no secrets/PII) + `ALERT_WEBHOOK_URL` alerts (kill-switch flips,
  reconciliation mismatches, HIGH flags, admin logins from new IPs), wired
  into login/signup/reset, flag raising, freeze, payout lifecycle, settings
  flips and the reconciliation report.
- **docs/incident-runbook.md**: triage, payout freeze, session revocation,
  the full secret-rotation order (SESSION_SECRET → run-token keys → daily
  salt → fingerprint salt), fraud-response procedure, pool void/re-run, DB-
  leak response, user-communication template, post-mortem template, host
  checklist, alert catalog.

**Hygiene**: dead `GET /api` route removed (L1).

### Changed
- docs: ADR-027, threat-model status (H2/C2/M7/L1/L4 closed), README,
  technical docs, compact, .env.example (ALERT_WEBHOOK_URL), help link.

## [0.9.2] — 2026-11-13

### Security — hardening program phase 5 (payout integrity + admin hardening + kill switch + reconciliation)

Closes H5, H8, M9 and the reconciliation half of M7 from docs/threat-model.md.
`REWARDS_ENABLED` stays false. Rationale: ADR-026.

**Payout integrity (H8)**
- createPayoutRequest is TRANSACTIONAL: balance + open-request checks and the
  insert run in one transaction — concurrent requests can never double-reserve
  (verified by a parallel double-spend test: exactly one reservation survives).
- Client-supplied idempotency keys: replays return the original request.
- approve/reject/mark-paid re-check status inside the transaction; paying an
  already-paid request is impossible.

**Admin hardening (H5)**
- Mandatory TOTP 2FA (RFC 6238 on node:crypto — zero new deps; secrets
  AES-256-GCM encrypted at rest, displayed exactly once). ADMIN login requires
  password + 6-digit code once enrolled; admin routes return
  TOTP_SETUP_REQUIRED until 2FA is live (forced enrollment on first visit).
- Separate short-lived (1h, SameSite=Strict) HMAC admin-session cookie — a
  stolen session cookie alone never reaches admin routes. Optional
  ADMIN_IP_ALLOWLIST (env) pins admin access to known networks.
- Self-approval blocked outright; optional two-person approval above
  TWO_PERSON_THRESHOLD_MINOR (default 0 = disabled, single-admin reality).
- Append-only AdminAudit trail (who/what/when/before/after + IP) on every
  admin mutation — payouts, users, pools, flags, boards, settings, TOTP. New
  admin AUDIT tab.

**Kill switch (M9) + reconciliation**
- REWARDS_PAYOUTS_PAUSED: runtime-flippable payout freeze (creation +
  approve + mark-paid blocked; reject still frees money). Toggle in the admin
  settings tab — no redeploy.
- monthlyReconciliation(month): Σ non-rejected payouts vs Σ credited
  distributions (globally + per user), ok/issues verdict —
  GET /api/admin/reconciliation (phase 6 wires mismatch alerts).

**Client**: login page shows a 2FA code field for admin accounts (when the
server asks); admin console gains the enrollment/expired-session gates, the
AUDIT tab and the kill-switch toggle.

**Tests**: 199 pass (was 180) — new `tests/payout-integrity.test.ts`
(RFC 6238 vectors incl. the official SHA-1 test secret, window verification,
AES round-trip, admin-token issue/verify/expiry/forgery, concurrent
double-spend, idempotent replays, self-approval, two-person flow,
double-approve, kill switch incl. reject-still-works, reconciliation
ok/over-payment/no-pool, audit rows).

### Changed
- docs: ADR-026, threat-model status (H5/H8/M9 closed), technical docs,
  compact snapshot, help (admin FAQ), .env.example (ADMIN_IP_ALLOWLIST).
  Known gap: two-person payouts need ≥2 admins (threshold ships disabled).

## [0.9.1] — 2026-11-13

### Security — hardening program phase 4 (risk scoring, board integrity, account/device signals)

Anti-cheat Layers E-F from docs/threat-model.md §7 / docs/anti-cheat.md.
Closes M1 (privacy), M3/M4 (board integrity/moderation), M6 (payout gating).
`REWARDS_ENABLED` stays false. Rationale: ADR-025.

**Explainable risk scoring (`src/lib/risk.ts`)**
- Flags score LOW=3 / MEDIUM=10 / HIGH=25 per type (confirmed ×2, dismissed
  0); bands: 0-14 LOW (normal), 15-39 MEDIUM (manual review queue), 40+ HIGH
  = **auto-HOLD**: ranked entries go pending-verification and payouts are
  blocked pending review — never a ban, appeal path = flags queue + contact.
  Every assessment carries its full reason breakdown.

**Leaderboard integrity (M3/M4)**
- New entries that would enter a board's TOP-3 (and every ranked entry from a
  HIGH-risk user) are stored `pending` and hidden from boards + totals until
  verified. Pending entries from LOW-risk users auto-release after 24h
  (opportunistic sweep on board reads); admins can verify instantly.
- Moderation: soft-removal (removedAt/By/Reason — kept for audit, never
  rendered; ranks recompute on read) + restore. New admin BOARDS tab with
  pending + removed queues for global and daily boards.
- Players with a CONFIRMED fraud flag can never rank again — their
  submissions stay display-only (rankReason CONFIRMED_FRAUD).

**Payout gating + cooling (M6)**
- First payout requires: account age ≥72h, ≥3 distinct active days, non-HIGH
  risk (clear error codes: ACCOUNT_TOO_NEW / NEED_ACTIVITY / RISK_HOLD).
- New accounts (<48h) earn against a halved daily point cap (cooling).
- UPI destination uniqueness: normalized `User.upiKey` unique — one account
  per payout destination; reuse blocked with 409 + UPI_REUSE flag.

**Privacy (M1)**
- Fingerprints + IPs stored as keyed HMACs (FINGERPRINT_SALT /
  SESSION_SECRET-derived) — deterministic for clustering, not reversible;
  device signals purge after 90 days; raw IPs never persisted by new code.

**Tests**: 180 pass (was 161) — new `tests/risk-boards.test.ts` (risk bands,
pending top-3/hidden/verified, mid-board fast path, HIGH-risk pending,
confirmed-fraud unranked, removal + rank recompute, stale auto-release, UPI
constraint, cooling caps, payout gating incl. the happy path, HMAC
fingerprint/IP properties).

### Changed
- daily/board queries exclude pending + removed entries; admin console gains
  the BOARDS tab (6 tabs); docs updated (ADR-025, anti-cheat layer table,
  threat-model status, help payout FAQ). Known gap: account deletion deferred
  (payout records must outlive accounts — documented).

## [0.9.0] — 2026-11-13

### Security — hardening program phase 3 (signed run sessions + heartbeat hardening + score plausibility)

Anti-cheat Layers A-C from docs/threat-model.md §7, now documented end-to-end
in the new **docs/anti-cheat.md** (architecture + operations runbook). Closes
H3 and H4; the leaderboard path is now token-gated end to end. `REWARDS_ENABLED`
stays false. Rationale: ADR-024.

**Layer A — signed run sessions (`src/lib/run-token.ts`)**
- Run tokens are now HMAC-SHA256-signed payloads binding `userId, game, seed,
  nonce, SERVER startedAt, kid`. Signature verification runs BEFORE any DB
  access — forged/tampered/foreign-user tokens never touch SQLite.
- Key-id rotation: `RUN_TOKEN_KEYS="id:hex,…"` — last entry signs, all verify
  (append → deploy → retire). Unset: derived from SESSION_SECRET (ss-v1).
- Duration for plausibility is computed from the SIGNED startedAt
  (untamperable server clock); sessions older than 6h cannot be scored
  (STALE_SESSION). Single-use claims and one-run-per-account unchanged.

**Layer B — heartbeat integrity**
- Hash-chain challenge: run/start returns a challenge; every beat must echo
  `sha256(challenge)` and receives the next one. Replays and scripts that
  don't read responses fail with 409 BAD_CHALLENGE. (Breaking for cached
  pre-0.9 tabs: they stop earning until reload.)
- Activity signals (flag-only, last 48 beats kept): client rAF frame count
  vs server elapsed → SPEED_HACK (fast) / HEADLESS (slow) flags; ≥10 identical
  non-zero input counts → LOW_ENTROPY flag.

**Layer C — plausibility + statistics**
- Ranked DAILY submissions now require a run token that binds the exact
  server daily seed (plus the existing seed-match + manifest checks) —
  tokenless daily runs are display-only.
- Ranked global scores are classified against own history (last 20) and the
  game population (last 500): z≥5 AND 3× own max → ANOMALY flag (MEDIUM),
  z≥3 or 2× own max → LOW flag. Flag-only — entries stay ranked for human
  review; new accounts (<5 samples) exempt from statistical flagging.

**Client**
- run-session-client tracks the challenge; RewardsHud sends the chain echo +
  rAF frame count; game pages pass the daily seed to beginRun; GameStage
  includes the run token in daily submissions.

**Tests**: 161 pass (was 142) — new `tests/anti-cheat.test.ts` (sign/verify
round-trip, tamper rejection, key rotation, challenge chain incl. replay +
forged + foreign-token rejections, entropy/drift pure checks, daily seed
claims, stale sessions, statistical classification) and scores-service tests
re-based on the signed-token era.

### Changed
- docs/anti-cheat.md new (architecture + ops runbook); technical docs, README,
  help, compact, threat-model status updated (H3/H4 closed, T2/T4/T6 mitigated
  to "bounded/flagged"). .env.example documents RUN_TOKEN_KEYS.

## [0.8.0] — 2026-11-13

### Security — hardening program phase 2 (auth/session + API baseline + persistent rate limiting + `/api/scores` lock-down)

Closes the CRITICAL/HIGH findings C1, C3, H1, H6, H7 and mediums M2, M5 (+ L2,
L3) from docs/threat-model.md. `REWARDS_ENABLED` stays false. Full rationale in
ADR-021/022/023; operational summary in the new SECURITY.md.

**Passwords & login**
- argon2id via `Bun.password` for all new hashes; legacy scrypt hashes stay
  verifiable and are transparently rehashed on login (Bun runtime). Minimum
  length 10, no composition rules. Optional breached-password rejection via
  HIBP k-anonymity (`HIBP_CHECK=1`, off by default, fails open).
- Login brute-force defense: per-account AND per-IP consecutive-failure
  lockout with exponential backoff (5 fails → 15s, doubling to a 60min cap,
  15min decay), Turnstile demanded after 3 failures, dummy-verify so unknown
  emails cost the same KDF time (enumeration-timing fix).
- Freeze now revokes every session immediately; frozen accounts are rejected
  by `authUser()` everywhere (was: frozen users kept browsing).

**Rate limiting & IPs**
- Persistent SQLite-backed limiter (`RateLimitBucket` table) — survives
  restarts/spin-ups. Same buckets as before plus per-user daily-run,
  score-submit, run-start, profile buckets. Login lockout state persists too.
- Trusted-proxy `clientIp()`: without `TRUSTED_PROXY=1`, forwarding headers
  are ignored entirely (fail-safe); with it, the client IP is the rightmost
  untrusted `X-Forwarded-For` hop (private ranges + `TRUSTED_PROXIES`
  skipped) — spoofed leftmost entries never win. Reset endpoint moved to a
  per-IP bucket (was a single global bucket).

**CSRF & API baseline**
- Every state-changing route now checks the Origin/Host allowlist (with
  Sec-Fetch-Site/Referer fallbacks) AND requires `Content-Type:
  application/json` — one shared `csrfBlocked()` helper (auth, rewards,
  daily-run, scores, admin routes).
- `SESSION_SECRET` (≥32 chars) and `DAILY_SALT` fail HARD in production —
  no insecure code fallbacks anymore.
- Password reset (per-IP bucket) + signup + profile routes get the same
  breached-password option; Prisma query logging is dev-only now.

**Leaderboard lock-down (C3)**
- `POST /api/scores` requires an account. New `POST /api/run/start` opens a
  run session (CSPRNG token, game-bound, one active run per account, aborts
  the previous) — the SAME session powers rewards heartbeats (RewardsHud now
  shares it) and score submission.
- RANKED entries must present the run token: single-use claim
  (`scoreClaimedAt`, order-independent from rewards run-end), validated
  against the server-measured duration with the manifest plausibility
  ceiling. Tokenless entries are stored display-only and excluded from the
  competitive board + totals.
- Guests on dynamic deploys fall back to the per-browser local board (same
  as the static export) with a "SIGN IN TO RANK ON THE GLOBAL BOARD" hint on
  the game-over screen.
- Board names are now ACCOUNT CALLSIGNS (`User.nameKey`, case-insensitive
  unique): sanitized (control/zero-width/bidi stripped), reserved names
  (leet-aware: ADM1N/4dmin blocked) and a profanity blocklist (extend via
  `NAME_BLOCKLIST`). First ranked post auto-assigns PILOT-XXXX; set/change
  your callsign on /rewards. Impersonation on boards is structurally gone.

**Account management**
- New `GET/POST /api/auth/sessions`: list active sessions, "log out others" /
  "log out everywhere" (full invalidation). New `POST /api/auth/profile`:
  set/change the callsign. Both surfaced on /rewards.
- Login page renders Turnstile when the server escalates after repeated
  failures.

**Hygiene**
- Dependency prune (-21): next-auth (installed-but-unused per ADR-003),
  next-intl, @mdxeditor/editor, react-syntax-highlighter, recharts, cmdk,
  vaul, react-day-picker, embla-carousel, input-otp, uuid, dnd-kit ×3,
  @tanstack/react-query + react-table, zustand, react-markdown,
  @reactuses/core, date-fns, framer-motion; six unused shadcn ui components
  removed with them.
- New SECURITY.md (controls overview, PR security-review checklist,
  responsible-disclosure contact). .env.example documents TRUSTED_PROXY,
  TRUSTED_PROXIES, HIBP_CHECK, NAME_BLOCKLIST + production secret rules.

**Tests**: 142 pass (was 102). New: `tests/auth-hardening.test.ts` (argon2id
round-trip + legacy verify + rehash flags + policy, name sanitization/reserved/
blocklist/nameKey, CSRF origin/content-type matrix, backoff math),
`tests/rate-limit.test.ts` (sliding window, restart persistence, lockout
record/get/clear), `tests/scores-service.test.ts` (ranked-with-token,
tokenless display-only, token replay burned, foreign token, game mismatch,
aborted session, implausible score, callsign claim/uniqueness/auto-assign,
ranked-only boards, run-end/score-claim order independence).

### Changed
- README (security section + leaderboard rules), technical-documentation
  (new routes, schema, env vars), decisions.md (ADR-021/022/023), help.md
  (player-facing board changes), compact.md snapshot, threat-model.md
  (phase-2 findings marked fixed). Rewards remain OFF until phases 2-6+8 pass.

## [0.7.1] — 2026-11-13

### Added — security program phase 1: audit + threat model (docs only, no code changes)
- **`docs/threat-model.md`**: full security audit of the current codebase —
  assets, attacker profiles, complete route inventory (auth/rate-limit/
  validation per route), 20-card threat catalogue with impact / current
  mitigation / residual risk / planned layer, economics-of-cheating analysis,
  standing rules, residual-risk register, and the phased hardening plan
  (phases 2-8) that gates `REWARDS_ENABLED`.
- Audit verdicts on the suspected list: `/api/scores` POST confirmed open +
  name-based (CRITICAL, phase 2); pilot XP confirmed localStorage-only and
  value-free (rule written down); next-auth confirmed installed-but-unused
  (prune in phase 2); rate limiter confirmed in-memory (persistent SQLite
  limiter in phase 2); secrets scan of repo + full git history clean;
  `db/custom.db` NOT reachable from public/; engines confirmed
  non-deterministic (131 Math.random/Date.now uses — replay verification
  honestly deferred, phase 7).
- New findings ranked: SESSION_SECRET production fallback (C1), Caddyfile
  `XTransformPort` open local proxy (C2), no security headers (H2),
  client-asserted heartbeat activity (H3), non-CSPRNG play-session token (H4),
  admin gaps — no 2FA/audit log/self-approval block (H5), payout create/approve
  races (H8), unsalted fingerprints + raw-IP retention (M1), and more — each
  mapped to a phase in the plan.
- decisions.md: ADR-020 (layered anti-cheat program, browser-is-hostile
  principle, replay-verification prerequisite, rewards gating).

### Changed
- README + technical documentation link the threat model; compact.md snapshot
  updated to 0.7.1. help.md: no player/admin-facing change in this release.

## [0.7.0] — 2026-11-13

### Added — reusable game framework + portal + daily challenges
- New **game-kit** (`src/game-kit/`): fixed-timestep loop (clamped dt), unified input
  (keyboard/mouse/touch with touch-action none + no scroll/zoom/long-press), 16:9
  canvas scaler (DPR ≤ 2, safe-area insets), audio host (unlock on first touch, global
  mute persisted, auto-mute on blur) composing the existing WebAudio `Sfx`, safe
  storage wrapper (try/catch + in-memory fallback), seeded PRNG (mulberry32 + string
  hash, separate logic/cosmetic streams), juice utils (screen shake, particles,
  tweens, hit-stop; prefers-reduced-motion), object pooling, dev-only perf overlay.
- **PortalAdapter** layer (`src/game-kit/adapter/`): single point for all
  ad/portal/reward calls — `NoopAdapter` (default), `OwnPortalAdapter` (analytics
  sink + rewards hooks), Poki/CrazyGames typed stubs (method names to be verified
  against the official SDK docs at activation). The enforced rules live in
  `rules.ts`: gameplayStart only on first input, gameplayStop on every interruption,
  never back-to-back and never during an ad, interstitials only at natural breaks
  with a configurable min gap (default 90s) and none in the first session minute,
  5s ad timeout then continue, pause + mute around every ad, rewarded ads grant
  in-game perks only — never reward points.
- **Daily-seed system** (server-authoritative): `GET /api/daily/seed?game=` returns
  `{ dateKey, seed }` (seed = hash(slug + dateKey + DAILY_SALT), day boundary
  configurable, default Asia/Kolkata midnight). `POST /api/daily/run` (zod-validated,
  rate-limited, plausibility-checked against each game manifest's
  maxScorePerSecond/minRunSeconds) appends to a per-game-per-day leaderboard, stores
  a size-capped compressed input log (unverified in v1 — documented), and maintains
  streaks (server-side for signed-in players, localStorage for guests, merged on
  login). Offline fallback seeds are allowed but marked UNRANKED. Same seed for
  everyone that day; unlimited tries, best score counts. Wordle-style share with
  copy-link fallback and deep links `/games/<slug>?daily=<dateKey>`. No cash rewards
  for leaderboard rank (engagement-based rewards only — unchanged).
- **Game package contract** (`src/games/<slug>/`): manifest (slug, title, genre,
  controls, maxScorePerSecond, minRunSeconds, dailyEnabled) + `createGame(ctx)` host.
  All five existing engines are wrapped via shims — `src/game/*` is untouched.
- **Portal pages**: `/games` (hub), `/games/[slug]` (SSR SEO page + poster → lazy
  game load on Play click), `/games/category/[genre]`, `/daily`, `/about`,
  `/contact`, `/help`, custom 404. Legacy routes (`/play`, `/stack`, `/reflex`,
  `/dodge`, `/merge`) 301 to their new homes (client-redirect stubs keep the static
  export working).
- **SEO layer**: per-game server-rendered copy (unique 150–300 word description,
  how-to-play, tips, FAQ, related games, last updated), per-page titles/descriptions/
  canonicals, JSON-LD (`VideoGame`+`WebApplication` co-typed, `BreadcrumbList`,
  `ItemList` on category pages, `WebSite`+`Organization` on home), dynamic
  `sitemap.xml` with lastmod, `robots.txt` via `app/robots.ts` (blocks `/api`,
  `/admin`, `/rewards`), generated 1200×630 OG/Twitter images per game.
- **Branding**: "Designed & developed by Omkar Kardile" (omkardile.is-a.dev) in the
  site footer, About/Help pages, head author metadata and package.json — never
  inside game code.
- `QA.md` pre-ship checklist; `bun test` suites for the kit (rng determinism, loop
  clamping, adapter rule state machine, storage fallback, pooling) and the daily
  system (seed determinism, tz rollover, plausibility, streaks).

### Changed
- `RewardsHud` is now hosted by the shared `GameStage` on every game page (was:
  `/play` only) — identical passive heartbeat behavior.
- Landing/footer links point at `/games/*`; consent banner placeholder ships
  disabled (`NEXT_PUBLIC_CONSENT_BANNER`, legal review pending).

## [0.6.0] — 2026-11-13

### Added — three new games, night/day themes, landing remake
- New games: **BRUTAL//REFLEX** (`/reflex`, timing-strike — sweeping blade +
  shrinking zone, perfect-streak chime ladder, zone regrow comeback, slow-mo death,
  attract-mode menu), **BRUTAL//DODGE** (`/dodge`, one-button gauntlet —
  hold-to-climb physics, gates + drifting blocks, near-miss CLOSE bonuses, baited
  orbs, 500m milestones, shatter + slow-mo death), **BRUTAL//MERGE** (`/merge`,
  drop-fuse pit — circle physics with 2 substeps, 11-tier fusion chain, combo ×6
  window, danger-line 3s countdown, tier-11 SINGULARITY detonation). Game-feel per
  the gamedev skill notes: trauma shake, hit-stop, importance-tier feedback.
- **Night/day themes for the whole site AND every game canvas**: ThemeProvider
  (night default / bone day) with localStorage + pre-paint init script; CSS variable
  tokens in globals.css; shared `src/game/theme.ts` palettes — all five engines
  render both modes with live mid-run switching; per-game accent identities
  (red/amber/cyan/violet/lime) tuned per mode; ThemeToggle in the nav and every
  game HUD/menu.
- **Awwwards-style landing remake**: mega display type (Anton) with RGB-split
  layers + mouse parallax, animated color-field blobs, dual marquee ribbons, bento
  game grid with per-game SVG art, scroll reveals, count-up stats band, tabbed
  leaderboard for all 5 games, bestiary, briefing, pilot card, mega footer.

### Changed
- `GameId` + `/api/scores` extended to five games; demo board re-seeded
  (scores were wiped by an earlier `db push`); layout metadata + Anton font.

## [0.5.0] — 2026-11-13

### Added — controller support (both games)
- New shared `src/game/gamepad.ts`: Gamepad API reader with radial deadzones
  (analog walk/run), edge-triggered buttons, trigger-as-button handling, a
  throttled dual-rumble wrapper, and a React-friendly `subscribeGamepads()`
  connection watcher. Standard mapping preferred, others best-effort; SSR-safe.
- ARENA twin-stick controls: left stick / d-pad moves (analog), right stick
  aims with a laser + diamond reticle, RT/R2/LT/RB/A fire, B/LB/L3 dash,
  Y/R3 overdrive, Start/Select pause, A/X/Y pick upgrades (mirrors 1/2/3),
  A or Start restarts after death, B abandons a paused run. Move-only play
  gets soft auto-aim (fire stays on the trigger). Mouse and pad coexist —
  whichever was touched last owns aiming.
- Haptics: rumble on dash, overdrive, kills (throttled), tank/boss kills,
  taking damage, death and boss spawn; strong events always cut through.
- STACK: any face/shoulder/trigger button drops the block, A or Start
  starts/retries, rumble on drops (perfects scale with streak, regrow,
  altitude milestones, collapse).
- UI: live "PAD LINKED" badge on both games, GAMEPAD mapping card in the
  arena menu, pad hints in STACK rules and in-play tip.

## [0.4.1] — 2026-11-13

### Fixed — static-site (GitHub Pages) asset bugs
- Every landing-page image and the arena floor texture 404'd on the static site:
  root-absolute `/images/...` paths are now base-path aware (`assetUrl()` in
  `src/lib/assets.ts`, applied to all `<Image>` srcs and the engine's floor
  photo). Paths resolve under `/brutal-games/` in static builds and stay
  unchanged in dynamic mode (localhost, Render).
- Favicon now ships from the local `/logo.svg` instead of an external CDN URL.

### Added — Render deployment (full app)
- `render.yaml` blueprint + `Dockerfile` (Bun, Next standalone, Prisma/SQLite)
  with `scripts/docker-start.sh`: schema auto-sync and optional first-admin
  seed at container boot. One-click deploy link in the README.
- `/api/health` readiness probe (used by the Render health check).
- `APP_URL` falls back to Render's injected `RENDER_EXTERNAL_URL`, so the
  blueprint deploys with zero manual prompts.
- Free-plan trade-offs documented in `render.yaml`: spin-down after 15 min
  idle, ephemeral SQLite (recreated at boot), plus the paid `disk:` upgrade
  path for persistence.

### Changed
- GitHub Pages deploy workflow now shipped as `docs/deploy-pages-workflow.yml` —
  files under `.github/workflows/` can't be pushed with the current token (no
  `workflow` scope); the manual `gh-pages` runbook stays the default. README
  deployment section rewritten: Render is the primary target.

## [0.4.0] — 2026-11-13

### Added — second game + public deployment
- New game **BRUTAL//STACK** (`/stack`): one-tap isometric tower stacker. Overhang slicing
  with falling debris, PERFECT-drop streaks (rising pentatonic chimes, ring pulses,
  screen shake) and a regrow comeback mechanic at 3+ streak. Altitude milestones every
  10 blocks, instant tap-anywhere retry, WebAudio synth SFX, zero new dependencies.
- Per-game leaderboards: `HighScore.game` (`arena` | `stack`), `/api/scores?game=…`.
- Landing page: "CHOOSE YOUR GAME" section, STACK nav link, cross-links between games.
- Static deployment: `STATIC_EXPORT=1` build mode (basePath-aware), GitHub Actions
  workflow deploying the public arcade to GitHub Pages; the leaderboard falls back to
  a per-browser local board when the API is absent. `.env.example` added.
- Repo hygiene: `db/`, workspace artifacts untracked; secrets never committed.

## [0.3.0] — 2026-11-12

### Added — Player Rewards program (ad revenue share)
- Accounts: email+password signup/login (scrypt), email verification + password reset
  (Resend/Brevo HTTP APIs or dev console), Google OAuth as a config slot, own lightweight
  cookie sessions (no next-auth runtime dependency).
- Anti-fraud: device fingerprints, IP clustering, VPN/datacenter IP list, headless-UA
  detection — all flag-only, manual review queue, no auto-punishment.
- Points ledger: append-only, idempotency keys, reversals (voids) as linked negative
  entries; daily point cap (IST days); daily login streaks; run-completion points with
  server-side plausibility checks; deterministic daily challenges.
- Heartbeat earning: signed play-session tokens, server timestamps only, faster-than-
  interval beats rejected, tab-visible + real input activity required.
- Monthly pools: admin enters net INR revenue (paise), previews distribution, locks the
  month (immutable snapshot). Pro-rata payouts, per-player cap (leftover stays unpaid
  and is shown in preview), minimum payout threshold with carry-over.
- Payouts (v1, manual): UPI ID (format-validated), verified email + 18+ declaration
  required, configurable hold period before approval, admin approve/reject/mark-paid
  with transaction reference. Zero-revenue months pay zero; payouts come only from the pool.
- Compliance: points never depend on ads; no ad-linked UI; ad placements untouched.
- Cloudflare Turnstile on signup and payout requests (test keys in dev).
- Master feature flag `REWARDS_ENABLED` (default off): when off, nothing is earned and
  all reward UI is hidden.
- Admin console `/admin`: pool wizard, payout queue, fraud-flag queue, user search with
  ledger/freeze/void actions, settings editor.
- Player pages: `/rewards` (points, clearly-labeled estimate, ledger, UPI, payout
  requests), `/terms`, `/privacy`; small points HUD on `/play` (zero engine changes).
- Tests: 52 bun tests — payout math edge cases (zero revenue, caps, zero points,
  rounding, thresholds), ledger integration (idempotency, daily cap, streaks, reversals,
  month clamping), heartbeat/run-stat/IP/fingerprint validation.
- SQLite WAL mode + `db:backup` script (`VACUUM INTO`); admin seed CLI
  (`bun run seed:admin`, no auto-promotion path).
- Docs set: README, technical/business documentation, decisions, help, compact.

### Changed
- Landing page: "no signup" claims softened (account is optional, gameplay unchanged);
  REWARDS nav link and footer links appear only while the program is enabled.

## [0.2.x] — 2026-11-11

- Real-world imagery on the landing page and play menu (arena backdrop, hero, boss art).
- Landing page conversion pass; share hooks; deep-link `?wave=` runs; audio + pause
  polish; leaderboard aggregates.

## [0.1.0] — 2026-11-11

- Initial game: canvas wave shooter (grunt/darter/splitter/spitter/tank/boss), upgrade
  drafting between waves, combos, Overdrive, WebAudio SFX, leaderboard, localStorage
  pilot XP/achievements.
