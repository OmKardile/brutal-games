# Security Policy — BRUTAL//GAMES

How we secure a game portal that pays real money (INR/UPI) and runs public
leaderboards. The governing document is **[docs/threat-model.md](docs/threat-model.md)**
(assets, attackers, threats, phased hardening plan, standing rules). This file
is the operational companion: what's in place, how to review changes, and how
to report vulnerabilities.

Core principle: **the browser is hostile.** Everything a client sends —
scores, durations, heartbeats, "tab is visible", localStorage XP — is untrusted.
The strongest controls live server-side and on the payout path. We do not spend
effort on client obfuscation.

## Controls in place (status after phase 2)

| Area | Control | Where |
|---|---|---|
| Passwords | argon2id via `Bun.password` (legacy scrypt still verifiable, transparent rehash-on-login), min length 10, no composition rules, optional breached-password check (HIBP k-anonymity, `HIBP_CHECK=1`, fails open) | `src/lib/auth/password.ts` |
| Login brute force | per-account AND per-IP consecutive-failure lockout with exponential backoff (5 fails → 15s, doubling to 60min, 15min decay), Turnstile demanded after 3 failures, dummy-verify timing equalizer, generic error messages | `src/app/api/auth/login/route.ts`, `src/lib/rate-limit.ts` |
| Rate limiting | persistent sliding-window limiter in SQLite (`RateLimitBucket`) — survives restarts; separate buckets per surface (login, signup, reset, resend, heartbeat, run-start, run-end, score-submit, payout, upi, consent, daily-run per-IP and per-user) | `src/lib/rate-limit.ts` |
| Client IP | trusted-proxy model: without `TRUSTED_PROXY=1` forwarding headers are ignored entirely; with it, the client IP is the rightmost untrusted `X-Forwarded-For` hop (private ranges + `TRUSTED_PROXIES` skipped) — spoofed leftmost entries never win | `src/lib/env.ts` |
| CSRF | every state-changing route checks Origin/Host allowlist (Sec-Fetch-Site/Referer fallbacks) AND requires `Content-Type: application/json`; layered with SameSite=Lax cookies | `src/lib/http.ts` (`csrfBlocked`) |
| Sessions | httpOnly cookies, sha256-at-rest tokens, Secure on https, rotation window, full invalidation on password change/freeze, session list + "log out everywhere(except here)" | `src/lib/auth/session.ts`, `/api/auth/sessions` |
| Authorization | re-checked INSIDE every route handler (never middleware alone — CVE-2025-29927 class), frozen accounts blocked everywhere | `src/lib/auth/guard.ts` |
| Score integrity | POST `/api/scores` requires an account; RANKED additionally requires a run-session token from `POST /api/run/start` (single-use, server-clock duration, manifest plausibility ceiling); tokenless entries are display-only and excluded from the competitive board; guests get the local-board fallback | `src/lib/scores/service.ts`, `src/lib/rewards/heartbeat.ts` |
| Board names | account callsigns only (`User.nameKey` unique — one callsign per account, one account per callsign), sanitized (control/zero-width/bidi stripped), reserved-name + leet-aware profanity blocklist | `src/lib/names.ts` |
| Secrets | `SESSION_SECRET` (≥32 chars) and `DAILY_SALT` are required in production — fail-hard, no code fallbacks; `.env*` gitignored; repo + full history scanned clean | `src/lib/env.ts`, `src/lib/daily/seed.ts` |
| Ledger & pools | append-only `PointEvent` ledger, unique idempotency keys, one-reversal-per-original, LOCKED-pool immutable snapshots, hold periods | `src/lib/rewards/*` (pre-existing, tested) |
| Fraud | flag-only signals (duplicate device/IP, VPN list, headless UA, anomalies) into a manual review queue — never auto-ban | `src/lib/rewards/fraud.ts` |

All phases shipped (0.8.0 → 0.10.1): signed run tokens with key rotation,
heartbeat hash-chain challenges, plausibility + statistical flags, risk
scoring with auto-HOLD + pending verification + board moderation, payout
transactionality + gating + admin TOTP 2FA/audit log + kill switches,
security headers + hardened Caddy template + incident runbook, and the
HTTP-level abuse suite (26 attacks, all failing safely).

## Security review checklist (every PR that touches auth/money/api)

- [ ] Inputs: zod strict schemas; no client-sent value used as money/time/identity
- [ ] Authorization checked inside the handler (`authUser`/`requireAdmin`), not middleware
- [ ] State-changing routes call `csrfBlocked(req)` before parsing the body
- [ ] New buckets added to the persistent limiter where abuse is conceivable
- [ ] Client-reported durations/scores only ever ADVISORY — server clock decides
- [ ] Money paths: transactions, idempotency keys, no negative balances, hold respected
- [ ] User text rendered as text (no `dangerouslySetInnerHTML` on user content)
- [ ] No secrets in code, logs, or error messages sent to clients
- [ ] Privacy: collect minimum; hash what you don't need raw
- [ ] `bun test` green; abuse cases for new endpoints added (tests/security/)
- [ ] Affected docs updated (threat model + technical docs + CHANGELOG)

## Scans + review cadence

- **Pre-commit secret scan:** `.githooks/pre-commit` (installed via
  `git config core.hooksPath .githooks`); gitleaks for full-history scans —
  repo + history currently clean.
- **Dependency updates:** Dependabot (`.github/dependabot.yml`, weekly);
  review bump PRs against the checklist above. Run `bun audit` before
  releases; triage: runtime deps get patched immediately, dev-toolchain
  findings ride the weekly train.
- **Deploy-time (need a public URL):** OWASP ZAP baseline scan +
  Mozilla Observatory against the live origin after every infra change.
- **Abuse regression:** `bun run build && bun test tests/security/` before
  any change that touches auth, scores, payouts or the run-token flow.

## Reporting a vulnerability

**Do not open public issues for security problems.** Email the maintainer
(Omkar Kardile — see https://omkardile.is-a.dev/ for current contact) with:

1. Description and impact
2. Reproduction steps (curl commands / PoC)
3. Affected routes or files

Please give us 90 days before public disclosure. We will acknowledge within
72 hours and keep you posted on the fix. Reports about the rewards program's
pre-launch state are welcome — `REWARDS_ENABLED` is false and no real money
moves yet, which is exactly when we want to hear about problems.

## Scope notes

- Production runs on Bun behind a reverse proxy; the app must never be exposed
  directly on a public port without `TRUSTED_PROXY` configured correctly.
- The static GitHub-Pages export has no API at all (local boards only) — out
  of scope for server-side issues.
- Social engineering of the manual UPI payout step is a known residual risk,
  mitigated by hold periods + review (two-person rule lands in phase 5).
