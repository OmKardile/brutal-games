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

## ADR-013 — Render as the primary deployment target

Date: 2026-11-13 · Status: accepted

**Context.** The app needs API routes + a filesystem database, so static hosts
(GitHub Pages) can only serve the arcade without leaderboards/accounts. The
GitHub Pages attempt also surfaced a class of bugs: root-absolute asset paths
404 under a sub-path basePath.

**Decision.**
1. Deploy the full app to Render via a blueprint (`render.yaml` + `Dockerfile`,
   Bun runtime) — one-click for a public repo, no server config to maintain.
2. Accept the free plan's trade-offs: ephemeral SQLite (auto-recreated at boot)
   and 15-min spin-down; document both, and ship the paid `disk:` block as the
   explicit persistence upgrade path.
3. Keep GitHub Pages as a secondary static arcade via `STATIC_EXPORT=1` builds,
   with the local-board fallback.
4. All public-asset references must be base-path aware (`assetUrl()`), enforced
   by convention (0.4.1 fixed every violation).

**Consequences.** Free-tier data loss on every deploy is accepted for v1 — the
games remain fully playable and the board degrades to per-browser local mode
when the API is absent. Persistent leaderboards require the paid disk. The
workflow file cannot be committed with the current PAT (no `workflow` scope), so
Pages deploys stay manual (runbook in README).

## ADR-016 — Game package contract: engines are wrapped, never edited

Date: 2026-11-13 · Status: accepted

**Context.** Five engines live in `src/game/` with their own rAF loops,
Math.random usage and event emitters. A reusable framework needs a uniform
contract, but the engines are battle-tested and explicitly off-limits.

**Decision.** `src/game-kit/` defines the contract (ctx + handle); each game
package (`src/games/<slug>/`) provides a `shim.ts` that constructs the existing
engine on `ctx.canvas` and adapts: daily seed injection (patched Math.random
during a run), pause/resume via rAF gating, phase→adapter signal mapping.
Runners (`page.tsx` in the package) keep the full per-game UX and mount engines
ONLY through the shim. **Consequence:** engines stay frozen; portability comes
from the shim layer; engine migration to the kit loop is a separate proposal.

## ADR-017 — Daily seeds: server-authoritative, partial determinism, honest about it

Date: 2026-11-13 · Status: accepted

**Context.** Daily challenges need same-seed-for-everyone runs, but the
engines use variable-dt rAF loops — bit-identical replays are impossible via
a shim.

**Decision.** Seed = FNV-1a(slug + dateKey + DAILY_SALT), server-side, day
boundary configurable (default IST). The shim seeds Math.random during a run.
Anti-cheat is layered instead of relying on replays: manifest plausibility
ceilings (maxScorePerSecond, minRunSeconds), rate limits, seed-match checks
(mismatch ⇒ UNRANKED), capped input logs stored for future verification —
NOT verified in v1 and never claimed otherwise. **Consequence:** same seed ⇒
same spawn sequences; leaderboard integrity rests on plausibility + review,
same posture as the rewards run-completion checks.

## ADR-018 — Ads and analytics behind one enforced adapter

Date: 2026-11-13 · Status: accepted

**Context.** Portals (Poki/CrazyGames) and future ad networks each have their
own SDKs and strict rules; game code must never know about them.

**Decision.** A single `PortalAdapter` interface is the ONLY door to the
outside world. `createRuleEnforcedAdapter` wraps every implementation with the
hard rules (gameplayStart only from stopped, never during ads; interstitials
only at natural breaks, 90 s gap, first-minute block, 5 s timeout; pause+mute
hooks; rewarded grants in-game perks only — never reward points). Poki and
CrazyGames ship as stubs that refuse to guess SDK method names; they get
finished only against the official docs at activation. **Consequence:** adding
a portal or network is a config-level change; games and runners stay untouched.

## ADR-019 — SEO content is hand-written per game, rankable text lives in HTML

Date: 2026-11-13 · Status: accepted

**Context.** Crawlers cannot see inside a canvas; portal SEO needs unique,
substantive server-rendered content.

**Decision.** Every `/games/[slug]` page ships unique 150-300 word copy,
how-to-play, tips, FAQ (plain text — FAQ rich results are dead), related
games and last-updated, all in the HTML. JSON-LD co-types VideoGame +
WebApplication (VideoGame alone is ignored for software rich results);
aggregateRating never emitted (no real ratings exist — faking it risks manual
action). Games lazy-load on Play click so the SEO page stays fast (CWV: the
game container reserves its aspect ratio). OG images generated locally
(`bun run og:gen`). **Consequence:** adding a game requires authoring real
copy — autogen/thin pages are banned by policy.
