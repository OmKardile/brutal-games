# Changelog

All notable changes to BRUTAL//GAMES. Dates are UTC. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are ours, not semver-strict.

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
