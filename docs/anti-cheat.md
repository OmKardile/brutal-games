# Anti-cheat architecture — BRUTAL//GAMES

Companion to [docs/threat-model.md](threat-model.md) (the contract) and
[SECURITY.md](../SECURITY.md) (operations). This document explains how the
anti-cheat layers work, what each layer catches, what it deliberately does
NOT do, and how to operate the system (review queue, flag triage, key
rotation).

Standing principle (ADR-020): the browser is hostile; fraud signals FLAG for
human review — the only automated action is a HOLD at high risk (phase 4);
nothing auto-bans. Replay verification (Layer D) stays deferred until the
engines are deterministic; we do not fake it.

## Layer map

| Layer | What it is | Status |
|---|---|---|
| A — Signed run sessions | HMAC-signed run tokens binding user+game+seed+server clock; single-use claims | **Live (0.9)** |
| B — Heartbeat integrity | Hash-chain challenge echo, server-clock beats, input/frame activity signals | **Live (0.9)** |
| C — Plausibility + statistics | manifest ceilings vs server duration; z-score vs own history + population | **Live (0.9)** |
| D — Replay verification | headless re-simulation of input logs | **Deferred** (engines non-deterministic; unlock = engine migration) |
| E — Account/device integrity | HMAC fingerprints + hashed IPs (90-day purge), UPI destination uniqueness, 48h cooling | **Live (0.9.1)** |
| F — Risk scoring + holds | explainable score (LOW/MEDIUM/HIGH), pending verification, auto-HOLD, appeal | **Live (0.9.1)** |

## Layer A — signed run sessions (src/lib/run-token.ts, rewards/heartbeat.ts)

**Flow.** `POST /api/run/start` (login required; no rewards coupling) opens a
`PlaySession` row and returns an HMAC-SHA256-signed token:

```
payload = { uid, game, seed, nonce, startedAt, kid }   // startedAt = SERVER clock
token   = base64url(payload) + "." + hex(HMAC-SHA256(key[kid], payload))
```

- Only `sha256(token)` is stored; the token itself never touches the DB.
- `seed` is bound for daily-challenge runs (the client passes the server seed
  it fetched; ranked dailies must present a token that binds exactly it).
- One open session per account — a new run aborts the previous server-side.
- **Verification** is offline (signature check) before any DB query: forged,
  tampered and foreign-uid tokens die without touching SQLite.
- **Single use:** ranked submissions claim the session (`scoreClaimedAt`);
  replays score as display-only. The rewards run-end (`endedAt`) and the score
  claim are order-independent — both can consume the same session once each.
- **Server clock decides duration:** the score plausibility ceiling is
  computed against the SIGNED payload's `startedAt` — untamperable.
- **Too-late:** sessions older than 6h cannot be scored (`STALE_SESSION`).

**Key rotation.** `RUN_TOKEN_KEYS="id1:hexKey,id2:hexKey"` — the LAST entry
signs; all entries verify. Rotation procedure: append the new key → deploy →
remove the retired key after in-flight runs (~hours) expire. Unset: a key is
derived from `SESSION_SECRET` (kid `ss-v1`) — fine for dev/single-key deploys.

## Layer B — heartbeat integrity (rewards/heartbeat.ts)

- Server timestamps only; beats faster than 0.75× interval rejected; idle
  expiry 30 min; 240-beat cap; burst guard 10/min; one open session/account.
- **Hash-chain challenge:** run/start returns `challenge`; every beat must
  echo `sha256(challenge)` and receives `nextChallenge`. The challenge rotates
  per beat, so replayed captures and scripts that don't read responses fail
  (`BAD_CHALLENGE` — 409).
- **Activity signals** (flag-only, stored in `PlaySession.beatLog`, last 48
  beats):
  - `frames` (client rAF count since run start) vs server-elapsed: >1.6×60fps
    → `ANOMALY/frame_time_drift_fast` (speed-hack signature); <8fps on an
    "active" session → `HEADLESS_SUSPECT/frame_time_drift_slow`.
  - ≥10 identical non-zero input counts → `ANOMALY/low_input_entropy`.
- No points while hidden or without input (unchanged since 0.3, now
  signal-checked).

## Layer C — plausibility + statistics

- **Manifest ceilings** (per game, `src/games/*/manifest.ts`): ranked scores
  must fit `score ≤ maxScorePerSecond × (serverDurationSec + 5s)`; dailies
  also enforce `minRunSeconds` and the exact seed match.
- **Statistical layer** (`src/lib/scores/stats.ts`, flag-only): a ranked
  score is classified against the player's own history (last 20) and the
  game population (last 500): `watch` (z≥3 or 2× own max) → LOW flag,
  `anomaly` (z≥5 AND 3× own max) → MEDIUM flag. New accounts (<5 own samples)
  are exempt from flagging (legit new players can pop off) — their gating
  comes from phase 4 cooling + phase 5 payout rules.
- **What is intentionally NOT auto-rejected:** statistically odd but
  plausible scores. They stay ranked and flagged; humans decide (phase 4 adds
  "pending verification" for top-N and a removal path).

## Layers E/F — risk scoring, holds, board integrity (src/lib/risk.ts, phase 4)

- **Score**: flags weigh LOW=3 / MEDIUM=10 / HIGH=25 per type (confirmed ×2,
  dismissed 0). Bands: 0-14 LOW, 15-39 MEDIUM (review queue), 40+ HIGH.
- **HIGH = auto-HOLD**: new ranked entries store `pending` (hidden from
  boards/totals until verified) and payout requests are blocked (RISK_HOLD).
  NEVER a ban; the appeal path is the flags queue + contact. Additionally,
  any entry that would enter a board's top-3 goes pending regardless of risk
  (cheap insurance on the most visible slots), auto-releasing after 24h for
  LOW-risk authors.
- **Moderation**: removed entries stay for audit (removedAt/By/Reason) and
  never render; ranks recompute on read; restore is one click (admin BOARDS
  tab). CONFIRMED-fraud users can never rank again (display-only).
- **Payout gating**: 72h account age + 3 distinct active days + non-HIGH risk
  before the first payout; <48h accounts earn at half cap (cooling); one UPI
  destination per account (upiKey unique, reuse flagged).
- **Privacy**: fingerprints and IPs stored as keyed HMACs (FINGERPRINT_SALT
  or SESSION_SECRET-derived) — deterministic for clustering, not reversible;
  device signals purge after 90 days.

## What each attack meets (mapping to threat model §5)

| Attack | Layers hit |
|---|---|
| `curl` a fake score (T1) | auth required → 401 |
| Poisoning a top-3 slot (T2/T3) | pending verification + moderation + callsign policy |
| Logged-in forged score, no token (T1) | display-only, off the ranked board |
| Replayed/intercepted token (T6) | HMAC verify + single-use claim |
| Token for another game/seed (T2) | payload binding (GAME/SEED mismatch) |
| Impossible score for real time (T1/T2) | manifest ceiling vs signed startedAt |
| Scripted heartbeat farm (T4) | challenge chain + interval rules + entropy/drift flags + caps |
| Speed-hacked engine (T2) | frame-drift flag (review), plausibility ceiling |
| Multi-account farm (T5) | device/IP hash clustering + UPI uniqueness + 72h/3-day payout gates + 48h cooling + risk HOLD |
| Deterministic replay forgery (T2) | NOT covered — Layer D deferred (documented gap) |

## Operations runbook

**Reviewing flags** (`/admin` → FLAGS): every flag carries `details` JSON with
the signal values (z-score, fps, input counts, seeds). Dismiss = noise;
Confirm = real (freeze/void is a separate human action on the user page).

**Rotating run-token keys:** append new key to `RUN_TOKEN_KEYS` → verify
old-key tokens still validate → after 24h remove the retired key. (Full
rotation procedure for SESSION_SECRET/DAILY_SALT is in the phase-6 incident
runbook.)

**Adjusting thresholds:** entropy N=10, drift bounds (0.25×–1.6×), stale
window 6h and the beat cap live in `src/lib/rewards/heartbeat.ts`; statistical
thresholds in `src/lib/scores/stats.ts`. Change + test + document — they are
deliberately constants, not admin-editable (no runtime-tunable anti-cheat
surface).

**False positives:** a flag never blocks a player. If a legit player trips a
signal (high-refresh monitor vs fps bound, accessibility tools vs input
entropy), dismiss the flag and note the cause — thresholds get tuned from
real incidents only.

## Known gaps (honest list)

- Layer D deferred: input logs (`DailyRun.inputLog`) are stored, size-capped,
  NOT verified (ADR-017/ADR-020).
- Frame-drift and entropy are advisory signals — a sophisticated client can
  report fabricated frames; the plausibility ceiling and caps bound the
  damage.
- The statistical layer needs population history; on day one of a new game's
  board it is quiet by design.
