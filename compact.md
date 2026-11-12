# compact.md — project state snapshot

Last updated: 2026-11-13 (v0.4.1, Render deploy + static-site asset fixes). Read this before working in the repo.

## What this is
BRUTAL//GAMES — Next.js 16 browser arcade (fan tribute to github.com/ahwootech/BRUTAL):
BRUTAL//ARENA (`/play`, wave shooter) + BRUTAL//STACK (`/stack`, one-tap tower stacker),
shared per-game leaderboards, and a player rewards program (monthly ad-revenue share,
INR/UPI, manual payouts).

## Stack & conventions
- Bun runtime. Next 16 App Router, standalone output, `typescript.ignoreBuildErrors: true`
  (still keep `bunx tsc --noEmit` clean in src/).
- Tailwind 4 + shadcn/ui. Design language: `bg-[#070709]`, red-500/amber-400 accents,
  stone text, mono font, wide uppercase tracking, thin borders `border-stone-800/80`.
- Prisma 6 + SQLite at `db/custom.db` (WAL). Schema sync: `bun run db:push` (NOT
  migrations). Money = int paise (`*Minor` suffix). Reward windows = IST
  (`src/lib/rewards/ist.ts`).
- Client pages are `'use client'` components fetching JSON APIs; route handlers are
  zod-validated, `export const dynamic = 'force-dynamic'`. Next 16: `await cookies()`,
  `await params`.
- Tests: `bun test tests/` (52 tests; ledger tests push schema to a temp SQLite).
  tsconfig excludes `tests/` (bun-types).
- Static assets in JSX/canvas MUST go through `assetUrl()` (src/lib/assets.ts) or inline
  `process.env.NEXT_PUBLIC_BASE_PATH` — root-absolute paths 404 on the GitHub Pages
  sub-path build (that was bug 0.4.1).
- Docs must be updated with every change: README, CHANGELOG (versioned),
  technical-documentation, business-documentation, decisions (ADR log), help, compact.

## Map
- `src/game/` canvas engines — DO NOT touch for rewards; the play page hosts a passive
  `<RewardsHud>` (input listeners + heartbeat client). `/play?wave=N` deep link exists.
  `engine.ts` = ARENA, `stack.ts` = STACK (one-tap isometric stacker).
- `src/lib/auth/` session (own cookie sessions, sha256 tokens — no next-auth runtime),
  password (scrypt), email (Resend/Brevo HTTP or console in dev), google (OAuth slot).
- `src/lib/scores-client.ts` shared board client: `/api/scores` online, localStorage
  fallback when the API is absent (static deploy).
- `src/lib/assets.ts` `assetUrl()` — base-path-aware public asset URLs.
- `src/lib/rewards/` ist, config (RewardSetting overrides, lazy-seeded defaults),
  points (append-only ledger, idempotency keys, streaks, daily caps),
  payout-math (pure), heartbeat (server timestamps, signed session tokens),
  runs (plausibility vs server-measured duration), challenge (deterministic/day),
  fraud (flag-only), payouts (balance, lock, request), format.
- APIs: `/api/auth/*`, `/api/rewards/*`, `/api/admin/*` (role-guarded), `/api/scores`,
  `/api/health` (Render probe).
- Pages: `/` landing, `/play` `/stack`, `/login` `/signup` `/forgot-password` `/reset-password`
  `/verify-email`, `/rewards`, `/terms`, `/privacy`, `/admin`.
- `scripts/`: seed-admin.ts (only promotion path; verified emails only),
  backup-db.ts (VACUUM INTO), docker-start.sh (container boot), verify-schema.ts.

## Deployment
- **Render (primary, full app):** `render.yaml` + `Dockerfile` (bun, standalone, SQLite at
  `file:/data/brutal.db`). One-click: https://render.com/deploy?repo=https://github.com/OmKardile/brutal-games
  Free plan = ephemeral disk + 15-min spin-down; boot script re-pushes schema and seeds
  admin from ADMIN_EMAIL/ADMIN_PASSWORD. Paid disk block commented in render.yaml.
  Repo: https://github.com/OmKardile/brutal-games (push PAT lacked `workflow` scope —
  workflow file therefore shipped as `docs/deploy-pages-workflow.yml`).
- **GitHub Pages (static arcade):** https://omkardile.github.io/brutal-games/ from the
  `gh-pages` branch (Pages source: legacy/branch). Rebuild runbook in README.

## Invariants (don't break)
- Ledger append-only: corrections = negative ADMIN_VOID rows linked by reversalOfId.
- Payouts only from locked pools; leftover from caps stays unpaid; holdUntil
  snapshotted at request; month sums clamp ≥ 0 per user.
- Points never reference ads (compliance hard rule); ads never in reward UI.
- Fraud signals flag-only; freezing/voiding are human actions.
- REWARDS_ENABLED default false; when off nothing earns and UI hides.

## Environment (.env)
DATABASE_URL, APP_URL, SESSION_SECRET, TURNSTILE_SITE_KEY/SECRET_KEY (dev test keys ok),
RESEND_API_KEY or BREVO_API_KEY + MAIL_FROM (optional), GOOGLE_CLIENT_ID/SECRET (optional).

## Local accounts (dev db)
- admin@brutal.local / brutal-admin-123 (ADMIN, verified)
- player1@brutal.local / player-pass-123 (verified, UPI playerone@okhdfc)
- Demo data: 2026-11 pool locked (₹50,000 revenue), one PAID payout ₹500, fraud flags
  from curl testing (HEADLESS_SUSPECT, DUPLICATE_DEVICE) sit OPEN in the review queue.
- Sandbox dev db has REWARDS_ENABLED=true for demo; code default is false.

## Known gaps / next steps
- Google OAuth + email delivery untested end-to-end (no external creds in sandbox).
- Render free tier: SQLite is ephemeral (resets on deploy/spin-down); leaderboard data
  only persists after attaching a disk on a paid instance.
- Rate limiter + settings cache are in-memory (single instance only).
- VPN/datacenter detection = static admin list; IPv6 exact-match only.
- KYC fields configurable but not enforced; legal/tax review required before real payouts
  (see business-documentation.md).
