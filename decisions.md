# Decisions (ADR log)

Short records of why, newest last. Status: all Accepted.

## ADR-001 — Money as int paise, IST calendar windows
SQLite has no safe decimal type; floats are banned for money. All amounts are int paise.
The program targets India (UPI), so "daily" and "monthly" boundaries are Asia/Kolkata.
**Consequence:** every money field carries a `Minor` suffix; date helpers in
`src/lib/rewards/ist.ts` are the only place offsets are computed.

## ADR-002 — Payouts come only from locked pools
Points are not money. Money is credited exclusively when a month is locked
(`PoolDistribution` snapshot). Available balance = credited − non-rejected payout
requests. **Consequence:** zero-revenue months provably pay zero; estimate UI is a
display-layer computation, clearly labeled.

## ADR-003 — Lightweight own sessions instead of next-auth
next-auth 4.x predates Next 16/React 19; forcing it risks peer-dependency and
App-Router churn. A ~120-line cookie-session module (random token, sha256 at rest,
httpOnly cookie, 30-day sliding expiry) covers all needs and is fully testable.
Google OAuth is implemented directly (authorization-code flow) as a config slot.
**Consequence:** next-auth stays installed but unused; remove when convenient.

## ADR-004 — Append-only ledger with reversal rows
No edits, no deletes. Corrections are negative `ADMIN_VOID` rows linked to the original
via `reversalOfId` (unique — max one reversal per original). Month sums clamp per-user
at ≥ 0 so reversals can never inflate others' shares or create negative payouts.

## ADR-005 — Admin via seed CLI only, no auto-promotion
Admin accounts are created/promoted only by `bun run seed:admin` (env credentials).
Promoting an existing account requires that account to be email-verified. No
ADMIN_EMAILS request-time auto-promotion — that would be a privilege-escalation path.

## ADR-006 — Cloudflare Turnstile, not a self-hosted captcha
Standard widget on signup and payout. Dev: official always-pass test keys; when
`TURNSTILE_SECRET_KEY` is unset, verification is bypassed with a console warning;
on network failure it fails closed in production, open in dev.

## ADR-007 — Heartbeat hardening set
Server-side timestamps only; beats faster than 0.75× interval rejected; hashed
play-session tokens issued at run start; one open session per user; 30-min idle expiry;
240-beat session cap; points require tab visible AND real input events. Combined with
the low daily cap, the economics of farming are poor and the signals are reviewable.

## ADR-008 — Cap-clamp leftover stays unpaid
When per-player caps clamp shares, the residue remains in the pool (tracked as
`leftoverMinor`, visible in the admin preview). Alternative (redistribute) was rejected:
iterative redistribution is complex, audit-hostile, and the residue is small by design.

## ADR-009 — Post-lock fraud handling
Locked distributions are immutable. Confirmed fraud after lock ⇒ admin rejects the
player's PENDING payout for that month (tracked as `voidedMinor`). Paid payouts are
never clawed back — manual recovery is a business action outside the system.

## ADR-010 — Flag-only anti-fraud
Device fingerprints, IP clustering, VPN/datacenter lists, and headless-UA heuristics
open `FraudFlag`s for human review. Nothing auto-freezes or auto-voids. False
positives on fingerprinting are common; the cost of a manual queue is lower than the
cost of wrongly banning real players.

## ADR-011 — 18+ declaration before earning or payout
The program is money-adjacent; `User.adultDeclaredAt` gates `awardPoints` and payout
requests. Stored as a timestamp for audit.

## ADR-012 — Hold period snapshotted per request
`holdUntil` = request time + `HOLD_PERIOD_DAYS` at creation. Later settings changes do
not unlock existing requests (tested). Prevents admins-from-the-future pressure and
gives a stable player promise.

## ADR-013 — Master flag REWARDS_ENABLED, default off
One switch in `RewardSetting` (seeded from code default false). When off: awardPoints
returns `blocked:DISABLED`, reward APIs 403, HUD/landing/rewards UI hides. Deployments
opt in deliberately.

## ADR-014 — SQLite WAL + VACUUM INTO backups
WAL gives concurrent reads during writes and better crash safety; set at db.ts import
(idempotent) — note: must use `$queryRawUnsafe` because the pragma returns a row.
Backups use `VACUUM INTO` which is safe on a hot database and checkpoints WAL.

## ADR-015 — Tests: pure payout math + real temp-DB ledger tests
`bun test` (zero new deps). Payout math is pure functions. Ledger tests push the real
schema to a temp SQLite file and run the actual award/void code paths, so idempotency
and reversal semantics are tested against the same Prisma client used in production.
