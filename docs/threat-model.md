# Threat model — BRUTAL//GAMES

Phase 1 of the security-hardening program (audit + threat model + plan). No code
changed in this phase. Audit basis: clean tree at `df2716a`, v0.7.0, 102/102
tests green. Every claim below was verified against the current source in
Nov 2026; file references are live code paths.

> **STATUS UPDATE — phase 2 SHIPPED (v0.8.0):** C1, C3, H1, H6, H7, M2, M5,
> L2, L3 are FIXED (argon2id + login lockout/escalation, persistent SQLite
> rate limiting, trusted-proxy clientIp, CSRF baseline on all mutations,
> fail-hard production secrets, /api/scores lock-down with run tokens,
> account-callsign board names, freeze kills sessions, sessions/profile
> endpoints, SECURITY.md, deps pruned). H3, H4 are PARTIALLY fixed (CSPRNG
> token + unified run sessions landed; HMAC binding, key-id rotation, nonce
> chains and statistics remain phase 3). See ADR-021/022/023, CHANGELOG 0.8.0.
> Route table below reflects the PRE-0.8 state and is refreshed at each gate.

Core principle (governs everything below): **the browser is hostile.** Anything
the client sends — scores, durations, heartbeats, "tab is visible", localStorage
XP — is untrusted. Strongest controls live server-side and on the payout path.
We do not spend effort on client obfuscation.

---

## 1. Assets and what they are worth

| Asset | Value | Exposure today |
|---|---|---|
| Payout pool (monthly INR via UPI) | Real money. Pool = 30% of net ad revenue (e.g. ₹50,000 revenue → ₹15,000 pool), per-player cap ₹1,000/month | **Zero active** — `REWARDS_ENABLED=false` by default; no pool has ever paid out against live revenue |
| Points ledger → future pool share | Claim on next month's pool; max ~3,000 pts/account/month (100/day cap) | Schema live, earning off until enabled |
| Leaderboard integrity (5 game boards + daily boards) | Reputation/retention; the product's core loop for competitive players | **Live and attackable now** (`/api/scores` open) |
| Player accounts (email+password, sessions) | Payout destination, streaks, identity | Live |
| Admin console (`/admin`, role-guarded APIs) | Full money control: pools, payouts, freezes, settings | Live, single admin, no 2FA |
| PII: emails, raw IPs, user agents, device signals, UPI IDs | Privacy/DPDP liability; phishing value | Live in DB |
| Availability of the single Bun process + SQLite file | Uptime; free-tier Render is already ephemeral | Live |
| localStorage pilot XP/achievements (`brutal.pilot`) | Cosmetic only — server never reads it, carries **no value** and must never gain any (rule, §8) | Live, correctly inert |

Money and leaderboards make this a cheating target. The rewards program is
feature-complete behind its flag, so hardening must land **before** the flag
ever flips — the flag is the last line of defense, not the first.

## 2. Attacker profiles

1. **Casual cheater / script kiddie** — opens devtools, POSTs a fake score to
   feel good on the board. No persistence, no tooling beyond curl. Already
   possible today via `/api/scores`.
2. **Points farmer (scaled)** — scripted multi-account heartbeat/run farming to
   harvest pool share. Bounded per account by the 100/day cap; threat comes from
   N accounts. Needs: cheap accounts (email+password), HTTP-only client.
3. **Payout fraudster** — targets the money path: multi-account pooling to one
   UPI ID, stolen accounts with changed UPI, social-engineering the manual
   payout step.
4. **Leaderboard vandal / griefers** — poison boards with slurs or
   impersonation, demotivating honest players (integrity attack, no money).
5. **Account thief** — credential stuffing / brute force against
   `/api/auth/login` (10/min/IP in-memory limiter only).
6. **Admin attacker** — phish the single admin account; with it, full control
   of pools, payouts, user freezes. No 2FA today.
7. **Infrastructure attacker** — hits Caddy directly (see the open local-proxy
   handler, §4-C2), or floods the single process (no body-size limits).

Non-goals as attackers: we do not defend against a fully compromised host
(physical/VM compromise is out of scope; we harden the app surface and document
host checklist items).

## 3. Trust boundaries and attack surface

```
Browser (untrusted) ── Caddy :81 ── Next.js (bun :3000, localhost only)
                        │            ├── /api/auth/*      (public + session)
                        │            ├── /api/scores      (FULLY PUBLIC)
                        │            ├── /api/daily/*     (public/optional session)
                        │            ├── /api/rewards/*   (session + 18+ + flag)
                        │            └── /api/admin/*     (ADMIN role, in-handler check)
                        └── SQLite db/custom.db (outside public/, gitignored)
```

Route inventory (verified Nov 2026; RL = in-memory sliding window):

| Route | Auth | Rate limit | Input validation | Finding |
|---|---|---|---|---|
| `POST /api/scores` | **none** | **none** | zod (name ≤16, score ≤100M) | **C3 — open, name-based, no plausibility** |
| `GET /api/scores` | none | none | game enum | fine (read-only) |
| `POST /api/auth/signup` | none | 5/h/IP | zod + Turnstile (optional) | session issued pre-verification; Turnstile bypass when unset |
| `POST /api/auth/login` | none | 10/min/IP | zod | no per-account lockout; no Turnstile escalation; minor timing oracle |
| `POST /api/auth/forgot-password` | none | 5/h/IP | zod | generic response ✓ |
| `POST /api/auth/reset-password` | none | 20/min **global bucket** | zod + single-use hashed token | global bucket DoS-able; kills sessions ✓ |
| `GET /api/auth/verify-email` | none | none | hashed single-use token | OK |
| `POST /api/auth/resend-verification` | session | 3/h/user | — | OK |
| `POST /api/auth/logout`, `GET /api/auth/me` | session / none | — | — | OK |
| `POST /api/rewards/session/start` | session + 18+ + flag | 30/h/user | zod | **H4 — token from non-CSPRNG** |
| `POST /api/rewards/heartbeat` | session + flag | 10/min/user | zod | **H3 — activity is client-asserted** |
| `POST /api/rewards/run-end` | session + flag | 30/h/user | zod + plausibility vs server clock | decent; client stats still bounded only by generous ratios |
| `POST /api/rewards/payout` | session + flag | 3/day/user | zod + Turnstile + verified email + 18+ + UPI + hold | **H8 — check-then-create race** |
| `POST /api/rewards/upi` | session | 10/h/user | regex | no cross-account uniqueness/clustering |
| `POST /api/rewards/consent` | session | 5/h/user | zod literal | OK |
| `GET /api/rewards/{summary,events,config}` | session / public | — | — | own data only ✓ |
| `GET|POST /api/admin/{users,users/[id],pool,pool/preview,payouts,flags,settings}` | ADMIN, checked **inside each handler** (no middleware trust) | none | zod | **H5 — no 2FA, no audit log, self-approval possible** |
| `GET /api/daily/seed` | none | 60/min/IP | game enum | seed public by design ✓ |
| `POST /api/daily/run` | optional session | 12/min/IP | zod + today-only + manifest plausibility + seed-match→ranked | **M3 — no per-user RL, no history stats** |
| `GET /api/daily/{board,summary}` | none / optional | 60/min/IP | — | read-only ✓ |
| `GET /api/health` | none | none | — | OK |
| `GET /api` | none | none | — | dead "Hello, world" route (L1) |

No `src/middleware.ts` exists — authorization is (correctly) re-checked inside
every route handler, so the middleware-bypass class (e.g. CVE-2025-29927) does
not apply today. Rule going forward: keep it that way; never move authz into
middleware alone.

## 4. Findings

### Verified suspects (from the directive)

| Suspect | Verdict | Evidence |
|---|---|---|
| `/api/scores` open and name-based | **CONFIRMED — live, CRITICAL (C3)** | `src/app/api/scores/route.ts` POST: no auth, no rate limit, no plausibility; `{name, score≤100M, wave, kills, game}` straight to `db.highScore.create`. The daily-run route has zod+RL+plausibility; this legacy route (v0.1.0) got none of it |
| Pilot XP/achievements in localStorage | **CONFIRMED, correctly inert** | `src/game/pilot.ts` — localStorage only; no server route reads it; rewards points live solely in the server-side `PointEvent` ledger. Needs a written never-carries-value rule (§8) so future features can't regress it |
| next-auth installed but unconfigured | **CONFIRMED** | `package.json` ships `next-auth ^4.24.11`; ADR-003 keeps it "installed but unused". Pure dependency surface — remove |
| Rate limiter in-memory | **CONFIRMED** | `src/lib/rate-limit.ts` — `Map` of hit arrays; resets on every restart (documented as a v1 limitation). Restart = fresh login/signup/forgot buckets |
| Secrets in repo/history | **CLEAN** | `.env*` gitignored (only `.env.example` with empty placeholders committed); `db/` ignored; full-history scan for AKIA/sk-/xox/AIza/PEM/ghp patterns = zero hits; Turnstile values in `.env.example` are Cloudflare's public always-pass test keys (documented as such); dev passwords in `compact.md` are local fixtures only |
| `db/custom.db` reachable from public/ | **NO** | DB lives at repo root `db/` (gitignored, never committed); Next standalone serves only `public/` (images/og only); Caddy reverse-proxies, serves no files |
| Engine uses Math.random/Date.now | **CONFIRMED — 131 hits across all 5 engines** | `src/game/{engine,stack,reflex,dodge,merge,audio,gamepad}.ts`; variable-dt rAF loops; honestly documented (ADR-017). Daily shim seeds `Math.random` during a run (partial determinism). **Consequence: replay verification (Layer D) stays deferred until the engine migration; we use Layer C only and do not fake Layer D** |

### New findings

**Critical**

- **C1 — `SESSION_SECRET` has a hard-coded production fallback.**
  `src/lib/env.ts`: `process.env.SESSION_SECRET ?? 'dev-insecure-session-secret'`.
  If a self-hosted deploy forgets the var, every "signed" token is signed with a
  public constant and daily seeds (`src/lib/daily/seed.ts` falls back to
  `SESSION_SECRET` → `'insecure-dev-salt'`) become predictable by anyone who
  reads the repo. Render's blueprint auto-generates the secret, but the code
  must fail hard in production instead of silently weakening.
- **C2 — Caddyfile proxies to arbitrary localhost ports.**
  `Caddyfile` first handler: any request with `?XTransformPort=N` is proxied to
  `localhost:N`. This is a dev-sandbox artifact committed into the repo: on any
  host that runs this file as-is it is an SSRF-style open proxy into loopback
  services. Must never ship; production Caddy config gets a hardened template
  (no transform handler, body limits, timeouts, no dotfiles).
- **C3 — `/api/scores` accepts forged scores from anyone** (see table above).

**High**

- **H1 — Password hashing below policy.** scrypt N=16384/r=8/p=1
  (`src/lib/auth/password.ts`; OWASP recommends N≥2^17 or argon2id) and an
  8-char minimum (policy target: 10+, no composition rules). No rehash-on-login.
  Bun ships `Bun.password` (argon2id) — migration is cheap and per-hash.
- **H2 — Zero security headers.** No CSP, HSTS, nosniff, Referrer-Policy,
  Permissions-Policy, COOP or frame-ancestors anywhere (next.config.ts, layout,
  Caddy). React escapes user text today and `dangerouslySetInnerHTML` is used
  only on static data (JsonLd, theme init) — headers are the blast-radius cap
  for future regressions and for third-party ad/analytics scripts.
- **H3 — Heartbeat "activity" is client-asserted.** `processHeartbeat` trusts
  `payload.visible` and `payload.inputEvents`. A farmer needs no browser:
  `POST session/start` then a 30s loop of `{visible:true, inputEvents:1}` earns
  the full 100/day cap. Bounded by caps (§6) but invisible to any signal —
  no input-timing entropy, no frame-time drift, no statistical baseline.
- **H4 — Play-session token is neither signed nor CSPRNG.**
  `startPlaySession` builds it from `sha256(userId:Date.now():Math.random())` —
  a non-cryptographic RNG, and docs call it "signed" (it isn't: no HMAC, no
  key, no binding to game/seed/startedAt). It is effectively an opaque bearer
  token with weak entropy. Also: heartbeat lacks the hash-chain nonce /
  monotonic sequence the spec requires, so a scripted client can drive beats at
  its own pace within interval rules.
- **H5 — Admin surface is one password away from the money.** No TOTP 2FA, no
  IP allowlist, no separate short-lived admin session, **no audit log** for
  freeze/unfreeze/void/settings/pool/lock actions (only `reviewedBy` on payout
  rows), and `POST /api/admin/payouts` **does not block self-approval** (an
  admin who is also a player can approve their own payout) nor implement a
  two-person rule above a threshold.
- **H6 — Rate limiting is memory-only + IP extraction trusts the client when
  directly exposed.** `clientIp()` (`src/lib/env.ts`) takes the FIRST value of
  `X-Forwarded-For` (or `X-Real-IP`) verbatim. Behind the committed Caddy this
  is safe (it overwrites XFF with `{remote_host}`), and Render sets it
  correctly — but any direct exposure (bun start on a public port, a
  misconfigured proxy that appends) makes every IP-bucketed limit trivially
  bypassable with a spoofed header. Needs a trusted-proxy mode + rightmost-XFF
  parsing.
- **H7 — No CSRF Origin/Host check and no content-type requirement** on
  state-changing routes. `SameSite=Lax` cookies are the only defense (good, but
  single-layer; ancient browsers and certain subdomain situations still slip).
- **H8 — Payout create/approve are check-then-write without transactions.**
  `createPayoutRequest` does balance check → count open → create in separate
  awaits; two concurrent requests can both pass and double-reserve. Admin
  approve does status-check → update non-atomically (double-approve race).
  No idempotency key, no per-(user,month) uniqueness, no `BEGIN IMMEDIATE`.

**Medium**

- **M1 — Privacy: fingerprints are unsalted, IPs/UAs stored raw, no retention
  limit.** `fingerprintOf()` = plain sha256 of low-entropy signals (UA, lang,
  tz, screen, platform, cores, mem) — reconstructible by dictionary; spec wants
  HMAC with a server salt. `DeviceFingerprint.ip`, `FraudFlag.details` (raw IPs)
  and session `ip` are stored indefinitely with no 90-day purge or delete-on-
  request flow.
- **M2 — Display names: no profanity/impersonation filter, no uniqueness.**
  Leaderboards are name-based (`HighScore`, guest `DailyRun` keyed by name);
  anyone can post as "ADMIN" or with slurs. Client-side sanitization only.
- **M3 — Daily-run integrity gaps.** Only per-IP rate limit (12/min); no
  per-user cap; no statistical anomaly detection (z-score vs own history /
  population); no "pending verification" state for new top scores; UNRANKED
  (offline-seed) runs still render on boards. `durationMs` is client-reported
  (plausibility anchors to it); no server-side run-session clock for dailies.
- **M4 — No moderation/removal path for poisoned boards.** `HighScore` and
  `DailyRun` are append-only with no admin void/remove action and no rank
  recompute; a confirmed cheater's entries stay forever. (Append-only ledger is
  right for money; boards need a moderation layer on top.)
- **M5 — Login brute-force gaps.** Per-IP 10/min only (resets on restart, H6);
  no per-account lockout/backoff, no Turnstile after repeated failures, no
  breached-password check; login timing differs between existing/missing users
  (minor oracle, L2-adjacent).
- **M6 — Payout gating gaps.** No minimum account age / distinct-active-days
  before first payout; no new-account point cooling (first-N-hours cap/hold);
  no unique constraint on normalized UPI across accounts; no payout velocity
  limits per account/device/UPI cluster.
- **M7 — No monitoring, alerts, reconciliation or incident runbook.** No
  structured security-event log, no alerting (signup bursts, heartbeat
  anomalies, hold floods, admin login from new IP), no monthly reconciliation
  report (Σpayouts ≤ pool), `docs/incident-runbook.md` doesn't exist yet.
- **M8 — Dev hygiene.** 80+ direct dependencies incl. unused heavyweights
  (`next-auth`, `next-intl`, `@mdxeditor/editor`, `react-syntax-highlighter`,
  `recharts`, `uuid`, dnd-kit…); no `bun audit` cadence, no Dependabot/Renovate,
  no gitleaks pre-commit; `db:push` runs with `--accept-data-loss`; Prisma
  `log:['query']` in production (noisy, PII-adjacent); Docker runs as root.
- **M9 — Only one kill switch.** `REWARDS_ENABLED` exists; a payouts-specific
  `REWARDS_PAYOUTS_PAUSED` (freeze money movement without killing the whole
  program) does not.

**Low**

- L1 — dead `GET /api` "Hello, world" route.
- L2 — login user-enumeration timing (dummy-verify fix is one line).
- L3 — `authUser()` doesn't reject FROZEN users (award/payout paths do check;
  frozen users keep browsing authenticated endpoints).
- L4 — host/container hardening not documented (non-root container, firewall,
  SSH keys, fail2ban, .env perms 600, encrypted off-site backups + tested
  restore).
- L5 — guest daily streak is client-asserted and merged on login (cosmetic).
- L6 — no `SECURITY.md` / responsible-disclosure contact yet.

### What is already solid (do not rebuild)

- **Ledger**: append-only `PointEvent`, unique idempotency keys, one-reversal-
  per-original, per-user month clamp ≥ 0 — all tested against a real temp DB.
- **Pool math**: payouts only from LOCKED pools; immutable distribution
  snapshots; leftover stays unpaid; hold snapshotted per request; zero-revenue
  ⇒ zero payout (pure functions, edge-case tested).
- **Heartbeat server clock**: client never sends timestamps; interval, idle
  expiry, beat cap (240), one-open-session-per-user.
- **Run plausibility**: rewards run stats checked against the server-measured
  session duration (`statsPlausible`), implausible ⇒ void + ANOMALY flag.
- **Daily system**: server-authoritative seeds, today-only, manifest ceilings
  (`maxScorePerSecond`/`minRunSeconds`), seed-mismatch ⇒ UNRANKED, capped input
  logs stored for future verification (honestly documented as unverified).
- **Auth hygiene**: zod everywhere, generic login/forgot responses, hashed
  single-use email tokens with expiry, reset kills all sessions, Turnstile on
  signup+payout (fail-closed in prod), session cookies httpOnly+SameSite=Lax,
  sha256-at-rest tokens, admin role re-checked in every handler, admin creation
  via seed CLI only (ADR-005).
- **Fraud posture**: flag-only signals → manual review queue (no auto-bans —
  deliberately, per ADR-010).
- **Repo hygiene**: no secrets in history, `.env*` + `db/` ignored, lockfile
  committed, engines untouched by rewards code.

## 5. Threat catalogue

Format: attack → impact → current mitigation → **residual risk** → planned
layer (phase). Phases are defined in §7.

| # | Attack | Impact | Today | Residual | Fix (phase) |
|---|---|---|---|---|---|
| T1 | `curl POST /api/scores` with score=100M under any name | Board integrity destroyed for all 5 games | **None — works today** | Full | Auth + run-token + plausibility (2, 3) |
| T2 | Same, but score chosen just under a plausible ceiling (fake-but-plausible daily run) | Daily board integrity; demotivates honest players | Manifest ceilings + seed-match + 12/min/IP | High (ceilings generous, duration client-reported) | Run-token + server clock + z-score stats + pending-verification + moderation (3, 4) |
| T3 | Board vandalism: slurs / impersonation ("ADMIN") in `name` | Reputation, player trust | Length cap + trim + toUpperCase only | Full | Name policy filter + uniqueness-for-ranked (2, 4) |
| T4 | HTTP-only heartbeat farm (no browser): session/start + 30s beat loop | Points → pool share; ≤100 pts/day/account | Caps only; signals see nothing | Bounded-but-invisible | Hash-chain nonce + activity heuristics + entropy/drift flags + risk score (3, 4) |
| T5 | Multi-account farming (N emails, one device/IP) | Pro-rata capture of the pool at scale (per-account cap ₹1,000/mo is the only bound) | Duplicate-device/IP flags (≥5 accounts/IP), manual review | High — flags are advisory; no cooling; no payout gating by account age | UPI/device/IP clustering + account-age + distinct-days gates + velocity + hold (4, 5) |
| T6 | Play-session token prediction/forgery | Free heartbeats/run-ends under a victim account | Token is bearer + hashed at rest | Low feasibility (Math.random entropy) but real | randomBytes CSPRNG + HMAC binding + key-id rotation + nonce chain (3) |
| T7 | Concurrent payout requests (double-reserve) | Balance integrity; over-reservation blocks legit payouts | check-then-create, no tx | Medium (needs auth + timing) | Transactional create + idempotency + per-(user,month) unique + concurrency tests (5) |
| T8 | Admin approves own payout / single rogue admin | Direct theft of pool | reviewedBy recorded only | Full (single-admin trust) | Self-approval block + two-person rule above threshold + TOTP + audit log (5) |
| T9 | Phish admin password | Full money control (pool, payouts, freeze, settings) | Nothing beyond password | Full | TOTP 2FA + separate admin session + IP allowlist option + new-IP alert (5, 6) |
| T10 | Credential stuffing / brute force login | Account theft → UPI swap → payout theft | 10/min/IP in-memory (reset on restart); scrypt verify | Medium | Per-account lockout/backoff + Turnstile escalation + persistent RL + breached-password check (2) |
| T11 | Spoof `X-Forwarded-For` (when app directly exposed) | Bypass every IP bucket (login, signup, daily) | None in direct mode; safe behind committed Caddy/Render | Deploy-dependent | Trusted-proxy mode + rightmost-XFF + hardened Caddy template (2, 6) |
| T12 | CSRF on state-changing routes (session-riding) | Unwanted payout/UPI/consent actions | SameSite=Lax only | Low-medium | Origin/Host check + JSON content-type requirement (2) |
| T13 | Deploy without `SESSION_SECRET` | Forgeable "signed" tokens + predictable daily seeds (repo-known fallback) | Warning-free fallback | Deploy-dependent, catastrophic | Fail-hard in production (C1) (2) |
| T14 | SSRF-ish via Caddy `?XTransformPort=N` | Reach any localhost service on hosts running the committed Caddyfile | None (handler is live in repo) | Sandbox artifact, must not ship | Remove handler + hardened Caddy template (6) |
| T15 | XSS payload in display name / user text | Session theft, defacement | React escaping; no user-content innerHTML | Low (regression-prone) | CSP with nonces + name sanitization (2, 6) |
| T16 | Signup burst / bot accounts | Pollutes flags, inflates future pools, mail cost | 5/h/IP + Turnstile (optional) | Medium | Persistent RL + Turnstile hard-required + cooling (2, 4) |
| T17 | DoS: oversized bodies, expensive endpoints, global reset-bucket burn | Availability | None (no body limits; reset bucket is global) | Full | Body size limits + timeouts + per-IP buckets (2, 6) |
| T18 | Stat-freeze on SQLite / process crash | Availability | WAL, hot backups script | Acceptable | Backups + tested restore + host checklist (6) |
| T19 | Privacy: IP/UA/fingerprint retention forever, unsalted hashes | DPDP liability; linkage attacks | /privacy page exists; no purge job | Full | HMAC-salted fingerprints + hashed IPs + 90-day purge + delete flow (4, 6) |
| T20 | Post-lock fraud reversal shifting shares | Money integrity | Month clamp ≥ 0 per user + immutable snapshots + voidedMinor tracking | Low (tested) | Reconciliation report + alerts (5, 6) |

## 6. Economics of cheating (why layers, not one wall)

Per-account bounds today: 100 pts/day cap → ~3,000 pts/month max; payout cap
₹1,000/month; minimum payout ₹100; hold 14 days; manual UPI payout. A single
scripted account is barely worth the effort — **the threat model is N
accounts**. 50 farmed accounts at full cap can mathematically capture most of a
small pool (150k pts vs a modest honest base), bounded only by the ₹1,000/player
cap and the pool itself. Therefore:

- points must never be cheap to accrue invisibly (T4 layer 3),
- accounts must be non-trivial to multiply (device/IP/UPI clustering, cooling —
  T5/T16 layer 4),
- and money must move slowly, auditably and reversibly (hold, two-person,
  reconciliation — T7/T8 layer 5).

Kill switches bound the worst case: `REWARDS_ENABLED` (exists) +
`REWARDS_PAYOUTS_PAUSED` (to add) mean an ongoing incident can be frozen
without a redeploy while review happens.

## 7. Phased plan

Guiding constraints: layer onto existing code, never rewrite working features;
engines (`src/game/*`) stay untouched through phase 6; after every phase:
update the 7 docs + CHANGELOG (versioned), run `bun test`, summarize, **wait
for OK**. Rewards stay OFF (`REWARDS_ENABLED=false`) until phases 2–6 and 8
pass; `REWARDS_PAYOUTS_PAUSED` ships in phase 5.

**Phase 1 — Audit + threat model + plan (this document).** No code changes.

**Phase 2 — Auth/session hardening + API baseline + persistent rate limiting +
lock down `/api/scores`.**
- argon2id via `Bun.password` (rehash-on-login; scrypt verify kept for
  transition), min length 10, no composition rules; optional breached-password
  check (k-anonymity HIBP API, config-gated).
- Per-account AND per-IP failure lockout with exponential backoff + Turnstile
  after repeated failures; dummy-verify for constant-ish timing.
- Persistent rate limiting in SQLite (`RateLimitBucket` table, same buckets as
  today + admin + daily-run-per-user), in-memory LRU in front; trusted-proxy
  `clientIp` (env-configured; rightmost untrusted hop; ignore client headers
  when not behind a proxy).
- CSRF baseline: Origin/Host allowlist check + `Content-Type: application/json`
  requirement on every state-changing route (one shared helper).
- `SESSION_SECRET` (and `DAILY_SALT`) fail-hard in production; no code fallback.
- Freeze kills sessions; session list + "log out everywhere"; cookie Secure
  where https; admin cookie SameSite=Strict groundwork.
- `/api/scores` lock-down per spec: POST requires session; ranked submission
  requires a run-session token (generalized from rewards play-sessions, no 18+
  coupling); anonymous/guest submissions become display-only UNRANKED (guests
  keep the localStorage-board fallback exactly like the static export).
  *UX trade-off flagged for the gate: dynamic-deploy guests lose ranked global
  boards — confirm at OK.*
- Name policy: control-char/zero-width strip, length cap, reserved-name block,
  profanity list (editable), uniqueness enforced for ranked entries.
- Dependency prune (next-auth + other unused), `SECURITY.md` (review checklist,
  disclosure contact), `.env.example` extended.
- Tests: lockout/backoff, CSRF rejections, name policy, scores lock-down,
  limiter persistence across "restart".
- Docs: SECURITY.md new; README/technical/decisions/help/compact updated.

**Phase 3 — Signed run sessions + heartbeat hardening + score plausibility.**
- `POST /api/run/start` (generalized, session-auth): HMAC-signed single-use
  token, key-id for rotation, binding `userId, game, seed, difficulty, nonce,
  server startedAt`; one active run per account; new run invalidates the old;
  CSPRNG (`randomBytes`).
- Score submit (scores + daily/run + rewards run-end) must present the token;
  server clock decides duration; reject reused/expired/mismatched/too-early/
  too-late.
- Heartbeat: hash-chain nonce echo + monotonic sequence (replays/parallel
  scripts fail); per-minute cap; no points while hidden; input-activity
  heuristics (entropy floor, frame-time drift vs server elapsed → speed-hack
  flag).
- Statistical layer: score vs own history + population z-score; sudden jumps;
  impossibly consistent timings → flag (never auto-reject).
- `docs/anti-cheat.md` (architecture + runbook for the layers).
- Tests: forged/reused/tampered token, seed mismatch, impossible score/duration,
  heartbeat flood/replay/parallel, entropy floor.

**Phase 4 — Risk scoring, flags, leaderboard integrity, account/device
signals.**
- Explainable risk score combining signals; Low=normal, Medium=manual review,
  High=auto-HOLD (freeze pending review, never auto-ban) + appeal path; every
  reason logged.
- New top-N scores show "pending verification" until checked; cheater entries
  removable (moderation rows + rank recompute); flagged/assisted runs never
  ranked.
- Fingerprints: HMAC with server salt; IPs hashed (HMAC) in new rows; 90-day
  purge job; delete-on-request flow.
- UPI: unique normalized ID per account + cluster flag; new-account cooling
  (first-N-hours points held); minimum account age + distinct active days
  before first payout.
- Tests: risk-score transitions, hold+appeal, board removal/recompute, UPI
  reuse, cooling windows.

**Phase 5 — Payout integrity, hold, admin hardening, kill switches,
reconciliation.**
- Transactional payout create/approve (interactive tx, `BEGIN IMMEDIATE`
  semantics), idempotency keys, per-(user,month) constraint, negative-balance
  guard, concurrent-request tests.
- Admin: mandatory TOTP 2FA, separate short-lived admin session, optional IP
  allowlist, full audit log model (who/what/when/before/after) on every admin
  action, self-approval blocked, optional two-person approval above threshold.
- `REWARDS_PAYOUTS_PAUSED` kill switch (admin-flippable, no redeploy).
- Monthly reconciliation report (Σpayouts ≤ pool per month; ledger sums match)
  + mismatch alert.
- Tests: concurrent double-spend, self-approval rejection, audit-log coverage,
  kill switch behavior, reconciliation math.

**Phase 6 — Headers, infra, backups, monitoring, runbook.**
- Security headers: strict CSP with nonces (allowlist ad/analytics hosts when
  they exist — documented risk), HSTS, nosniff, Referrer-Policy,
  Permissions-Policy, COOP, `frame-ancestors 'self'` on portal pages.
- Caddy production template: auto-HTTPS, body-size limits, timeouts, Server
  header hidden, dotfiles/db/backup paths blocked, **no XTransformPort
  handler**; app binds localhost only.
- Host checklist (documented, not assumed): firewall 80/443, SSH key-only,
  fail2ban, unattended security updates, non-root container (`USER` in
  Dockerfile), `.env` 600, DB outside served dirs, encrypted off-site backups
  with a TESTED restore.
- Structured security logs (auth failures, flags, risk changes, payout state
  changes, admin actions; no PII/secrets; 90-day retention) + alerts
  (email/webhook: signup bursts, heartbeat anomalies, score outliers, many
  holds, admin login from new IP, reconciliation mismatch).
- `docs/incident-runbook.md`: freeze payouts, revoke sessions, rotate secrets,
  void + re-run a pool, user comms template, post-mortem template.
- Remove dead `/api` route; quiet Prisma query logging in prod.

**Phase 7 — Replay verification (DEFERRED by design).**
Requires deterministic engines (fixed-timestep, seeded RNG for logic, no
`Date.now` in game logic — 131 violations today across `src/game/*`). The
engine-migration proposal (compact.md "known gaps") is the unlock. Until then:
Layer C only. We do not fake this layer, and no code ships in this phase —
it is tracked here so the prerequisite is explicit. The stored input logs
(`DailyRun.inputLog`, size-capped) become verifiable the day the engines move
onto the kit loop (game-kit already ships a seeded RNG with separate
logic/cosmetic streams).

**Phase 8 — Abuse-test suite + scans + red-team pass.**
- `bun test` abuse suite (new `tests/security/`): every attack in §5 simulated
  and asserted to FAIL SAFELY — forged score (no token / reused / expired /
  tampered / seed-mismatched), impossible score or duration, faster-than-min
  submissions, heartbeat flood/replay/parallel, concurrent payouts
  (double-spend), UPI reuse, admin self-approval, IDOR attempts, admin routes
  as normal user, CSRF from foreign origin, XSS payloads in names, oversized
  bodies, XFF spoofing, login brute force, enumeration probes.
- Playwright/scripted browser: real-flow sanity (signup→play→submit) so locks
  don't break honest players.
- Scans: gitleaks (pre-commit hook), `bun audit` cadence, Dependabot/Renovate
  config, OWASP ZAP baseline, Mozilla Observatory on headers.
- Manual red-team: attempt to farm points and forge a leaderboard score with
  the shipped defenses; document what worked; fix blockers before any reward
  enablement.

**Gate: `REWARDS_ENABLED` stays false until phases 2–6 and 8 pass.** Phase 7
remains open (deferred) and does not block enabling, but the threat model
records that leaderboard integrity above Layer C is unavailable until it lands.

## 8. Standing rules (extracted from this model)

1. localStorage is cosmetic and NEVER carries value — pilot XP stays
   client-side forever; anything that earns points must be server-ledger-only.
2. Client-reported time is advisory; the server clock decides durations.
3. Fraud signals flag, humans decide (except the auto-HOLD on high risk, which
   freezes pending review — never bans).
4. Authorization lives inside route handlers/server actions, never middleware
   alone.
5. Money moves only from locked pools, inside transactions, behind holds, with
   two eyes above the threshold, audited.
6. Engines (`src/game/*`) stay untouched until the migration proposal is
   accepted; anti-cheat lives in shims, APIs and libs.
7. No secrets in code — env only, fail-hard on missing production secrets; key
   rotation supported (session secret, daily salt, run-token HMAC keys).
8. Privacy by default: hash what you don't need, purge at 90 days, export and
   delete on request.

## 9. Residual risk register (after the full plan)

| Risk | Why it remains |
|---|---|
| Sophisticated replay-compatible cheating | Layer D deferred (non-deterministic engines); statistical layer only raises the cost |
| Client-side signals always bypassable | Headless/automation detection is flag-only by design; determined attackers emulate input |
| Single-instance SQLite | No horizontal scale; DoS resilience is bounded (mitigated by limits + monitoring, not eliminated) |
| Manual payout human error | UPI payment happens out-of-band; mitigated by two-person rule + reconciliation, not eliminated |
| Third-party ad scripts widen XSS surface | Future networks allowed by CSP allowlist; documented trade-off at enablement time |
| Legal/tax/KYC posture | Out of scope for engineering; business-documentation.md gates real payouts on legal sign-off |
| False positives in clustering | Accepted by design (flag-only + appeal); cost of wrongly banning a real player exceeds fraud leakage at current caps |

## 10. Living document

This model is updated at every phase gate. Findings that change severity, new
attack surface (new games, new routes, ad networks, portals) and incident
learnings get folded back in. Companion docs: `SECURITY.md` (from phase 2),
`docs/anti-cheat.md` (phase 3), `docs/incident-runbook.md` (phase 6).
