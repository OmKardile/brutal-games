# Changelog

All notable changes to BRUTAL//GAMES. Dates are UTC. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are ours, not semver-strict.

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
