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

## ADR-020 — Layered security & anti-cheat program (threat model as the contract)

Date: 2026-11-13 · Status: accepted

**Context.** The project pays real money (INR/UPI, ad-revenue share) and runs
public leaderboards — a cheating target. A full audit (docs/threat-model.md,
v0.7.1) confirmed `/api/scores` is open and name-based, the rate limiter is
in-memory, play-session tokens are not CSPRNG, heartbeat activity is
client-asserted, and the admin surface has no 2FA/audit log — while the
ledger/pool math underneath is solid and tested.

**Decision.**
1. The browser is hostile: every client-sent value (scores, durations,
   heartbeats, visibility, localStorage XP) is untrusted. Server-side and
   payout-path controls come first; no effort on client obfuscation.
2. Hardening proceeds in layers via the phased plan in docs/threat-model.md
   (§7), each phase ending with docs + CHANGELOG + tests and an explicit OK
   gate. Never rewrite working features — controls wrap the existing libs.
3. `REWARDS_ENABLED` stays false until phases 2-6 and 8 pass; a
   `REWARDS_PAYOUTS_PAUSED` kill switch ships in phase 5.
4. Replay verification (strongest anti-cheat layer) is DEFERRED until engines
   are deterministic (fixed timestep, seeded logic RNG — 131 Math.random/
   Date.now uses today). Until then: plausibility + statistics + review only.
   We document the gap; we never fake the layer.
5. localStorage stays cosmetic forever: pilot XP/achievements never carry
   value; anything earning points writes only to the server ledger.
6. Fraud signals flag for human review; the only automated action is a HOLD
   (freeze pending review) at high risk — never auto-bans, appeal path exists.

**Consequences.** Leaderboard submissions become session/token-gated (guests
keep the local-board fallback, mirroring the static export). Admin flows gain
2FA + audit logs. Persistent rate limiting and hashed device signals add two
small tables. The threat model is a living document, updated at every gate.

## ADR-021 — Passwords: argon2id via Bun.password, transparent legacy migration

Date: 2026-11-13 · Status: accepted (phase 2)

**Context.** Passwords were scrypt N=16384/r=8/p=1 with an 8-char minimum —
below the policy target (argon2id or scrypt N≥2^17; length 10+, no composition
rules). Production runs on Bun (Docker `oven/bun`, render.yaml), which ships
argon2id natively.

**Decision.** New hashes are argon2id PHC strings from `Bun.password.hash`.
Legacy `scrypt$…` hashes stay verifiable; `needsRehash()` lets the login route
upgrade them transparently on the Bun runtime. Non-Bun dev servers still hash
with scrypt (marked for upgrade). Policy: min length 10, max 200, NO
composition rules. Optional breached-password rejection via the HIBP
k-anonymity range API, gated behind `HIBP_CHECK=1`, failing open on network
errors. Login runs a dummy argon2 verify for unknown users (timing oracle fix).

**Consequences.** Zero migration work for users; hashes upgrade themselves at
next login. A non-Bun production runtime cannot verify argon2 (documented:
production is Bun).

## ADR-022 — Persistent rate limiting + trusted-proxy client IP

Date: 2026-11-13 · Status: accepted (phase 2)

**Context.** The limiter was an in-memory Map (reset on every restart/spin-up)
and `clientIp()` trusted the FIRST X-Forwarded-For entry verbatim — safe behind
the committed Caddy/Render (which overwrite the header) but spoofable under any
proxy that appends, or when the app is exposed directly.

**Decision.** Buckets live in SQLite (`RateLimitBucket`: sliding-window hit
array + consecutive-failure counter + lockedUntil) — restart-proof, same bucket
keys as before plus new per-user daily-run and score-submit buckets. On top of
the window limiter, login gets per-account AND per-IP exponential-backout
lockout (5 fails → 15s, doubling to 60min cap, 15min decay) with Turnstile
escalation after 3 fails. `clientIp()` becomes trust-gated: without
`TRUSTED_PROXY=1` forwarding headers are ignored (single 'direct' bucket —
fail-safe); with it, the client IP is the RIGHTMOST untrusted XFF hop (private
ranges + `TRUSTED_PROXIES` CIDRs skipped), immune to injected leftmost entries
under both overwrite and append proxy semantics.

**Consequences.** One extra table and one DB round-trip per limited request
(interactive transaction; single-process SQLite handles it). Misconfigured
deploys fail toward MORE limiting, never less. Deploys behind a proxy MUST set
`TRUSTED_PROXY=1` or everyone shares one bucket (documented in .env.example).

## ADR-023 — Score submissions: sessions + run tokens + account callsigns

Date: 2026-11-13 · Status: accepted (phase 2)

**Context.** `POST /api/scores` was fully public and name-based: anyone could
curl a 100M score under any name, including "ADMIN" or slurs (threat T1/T3).
Rewards play-sessions existed but were 18+/rewards-gated and non-CSPRNG.

**Decision.**
1. One unified run-session primitive: `POST /api/run/start` (auth required, NO
   rewards coupling) opens a PlaySession with a 32-byte CSPRNG token, bound to
   the game slug; one active session per account (new run aborts the old). The
   legacy `/api/rewards/session/start` delegates to the same lib; RewardsHud
   consumes the shared token via `run-session-client`.
2. `POST /api/scores` requires an account. RANKED entries must present the run
   token (single-use claim via `scoreClaimedAt`, order-independent from the
   rewards run-end) and pass the manifest plausibility ceiling against the
   SERVER-measured duration. Tokenless entries are stored display-only
   (ranked=false) and excluded from the competitive board + totals. Guests fall
   back to the per-browser local board — same as the static export — with a
   "sign in to rank" hint.
3. Board names are ACCOUNT callsigns, never client strings: `User.nameKey`
   (case-insensitive unique) with policy sanitization (control/zero-width/bidi
   stripped), reserved-name blocking (leet-aware) and a profanity blocklist
   (`NAME_BLOCKLIST` env extends it). First ranked post auto-assigns a
   PILOT-XXXX callsign; users set/change it on /rewards (`/api/auth/profile`).
   Daily-run boards use the same policy (guests: sanitized, not unique).

**Consequences.** Forged scores can no longer reach the ranked board without a
server-issued token tied to a measured run; impersonation on boards is
structurally impossible. Dynamic-deploy guests lose ranked global boards (the
approved UX trade-off). Extra columns: `HighScore.userId/ranked`,
`PlaySession.game/scoreClaimedAt`, `User.nameKey`; new `RateLimitBucket` table.
Phase 3 upgrades the token itself to HMAC-signed with key-id rotation and adds
heartbeat nonce chains + statistical checks.
