# compact.md — project state snapshot

Last updated: 2026-11-12 (v0.3.0, player rewards). Read this before working in the repo.

## What this is
BRUTAL//ARENA — Next.js 16 browser wave-shooter (fan tribute to github.com/ahwootech/BRUTAL)
with a player rewards program (monthly ad-revenue share, INR/UPI, manual payouts).

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
- Docs must be updated with every change: README, CHANGELOG (versioned),
  technical-documentation, business-documentation, decisions (ADR log), help, compact.

## Map
- `src/game/` canvas engine — DO NOT touch for rewards; the play page hosts a passive
  `<RewardsHud>` (input listeners + heartbeat client). `/play?wave=N` deep link exists.
- `src/lib/auth/` session (own cookie sessions, sha256 tokens — no next-auth runtime),
  password (scrypt), email (Resend/Brevo HTTP or console in dev), google (OAuth slot).
- `src/lib/rewards/` ist, config (RewardSetting overrides, lazy-seeded defaults),
  points (append-only ledger, idempotency keys, streaks, daily caps),
  payout-math (pure), heartbeat (server timestamps, signed session tokens),
  runs (plausibility vs server-measured duration), challenge (deterministic/day),
  fraud (flag-only), payouts (balance, lock, request), format.
- APIs: `/api/auth/*`, `/api/rewards/*`, `/api/admin/*` (role-guarded), `/api/scores`.
- Pages: `/` landing, `/play`, `/login` `/signup` `/forgot-password` `/reset-password`
  `/verify-email`, `/rewards`, `/terms`, `/privacy`, `/admin`.
- `scripts/`: seed-admin.ts (only promotion path; verified emails only),
  backup-db.ts (VACUUM INTO), verify-schema.ts.

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
- Rate limiter + settings cache are in-memory (single instance only).
- VPN/datacenter detection = static admin list; IPv6 exact-match only.
- KYC fields configurable but not enforced; legal/tax review required before real payouts
  (see business-documentation.md).
