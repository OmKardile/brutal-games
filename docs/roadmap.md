# Growth & Retention Roadmap — post-security order of operations

Status: accepted 2026-11-14 (ADR-029) · Sequences everything after security v0.10.1

One theme per phase, one PR per phase, small reviewable steps. Every phase ends with:
update README, technical-documentation.md, business-documentation.md, decisions.md
(when a decision is made), help.md, compact.md, CHANGELOG (versioned) — the
standing docs discipline. Nothing here may regress an abuse-suite attack
(`tests/security/abuse-suite.test.ts` must stay green after every phase).

## Strategy — cheap loops first, expensive rails last

1. Ship what is nearly free on top of the security/daily architecture (share
   links, retention read-out, mutators).
2. Ship the India-first performance work (lite mode, PWA) before any new
   server surface.
3. Only then new multiplayer-ish surfaces (goals, leagues) and, last, the
   determinization epic (phase-7 replay verification + ghost races together).
4. Rewards ideas fold into the existing rewards program docs; cash stays
   gated (`REWARDS_ENABLED=false`, ADR-020/ADR-028) until the program's own
   go/no-go + legal/tax sign-off.

## Engineering gates (kill-switch between phases)

Gate G1 — traffic proof. Each phase's exit dashboard answers: did visits or
D1 move? If a phase did not move its metric, we do not build the follow-on
that depends on it — we fix or revert. Metrics source: the slice-0 read-out
(see below) + NEXT_PUBLIC_ANALYTICS_ENDPOINT events (share_click, run_end,
daily_start, daily_complete, game_load, play_start — all already wired in
OwnPortalAdapter).

Gate G2 — no new payout surface. No phase may create a new way to move money
or a new dependency between points and money. Referrals earn cosmetics or
streak shields only — never cash (multi-account farming economics, ADR-025).

Gate G3 — no client-authoritative state. Anything that lands on a public
board or affects a shared counter is computed server-side from validated
data. Standing rule: localStorage never carries value.

Gate G4 — existing abuse surface never grows silently. Any new input (league
names, community-goal points, ghost replays) gets rate limits, zod validation,
plausibility checks and a fraud-flag type in the same PR that introduces it.

Gate G5 — engines stay untouched until the migration epic. Phase H is the one
exception and it is engine work by definition.

## The sequence

### Slice 0 — Retention read-out (prereq, ~0.5–1 day) — SHIPPED v0.12.0

Why first: "prove one game" (the core thesis) needs its measurement half.
Today no user-retention telemetry exists anywhere in the repo.

- Server-side computations from existing tables — no new tracking, no new
  client code: DAU (distinct DailyActivity rows per dateKey), D1/D7 (share of
  a dateKey's players whose userId or guest-name appears on a later dateKey),
  runs per daily player (DailyRun count), streak-length histogram
  (DailyStreak).
- Display: one new ADMIN tab `stats` next to settings. API: GET
  /api/admin/stats (role-guarded, zod-validated date range, rate-limited —
  gate G4 applies to admin surfaces too).
- Exit: admin can see DAU/D1/D7 for the trailing 30 days.

### Slice 1 — Growth loop: WhatsApp challenge links + daily mutators (see build prompt below, ~1–2 days) — SHIPPED v0.12.0

Exit: wa.me share works from a finished daily run; one game (the flagship —
STACK, broadest audience, most determinism-independent) runs mutators with
per-mutator plausibility multipliers; share_click shows up in analytics; D1
baseline visible in the stats tab.

### Slice 2 — India-first performance (lite mode + PWA install, ~2–3 days) — SHIPPED v0.13.0

Shipped shape: QualityMonitor degrades PAGE effects only (engines off-limits
in v1 — they own their particles/DPR; `[data-quality]` CSS kill-switches +
QUALITY toggle, DPR caps staged for phase H). PWA: manifest + app-shell SW
(API never cached; offline runs structurally unrankable), offline.html
fallback, generated icons, production-only registration.

Exit: FPS watcher auto-drops quality tier (particles/shake/DPR/resolution);
installable (manifest + icons + service-worker app shell); offline run =
UNRANKED, no new fraud surface (offline runs cannot obtain server-signed run
tokens — structurally unrankable). Web push stays out of this slice.

### Slice 3 — Festival calendar + seasonal SEO pages (~1–2 days, India-first)

Diwali/Holi/Navratri/Ganesh Chaturthi/Independence Day. Reuses the slice-1
mutator system (calendar-driven mutator sets + themed titles). No real
tournament/team/player names or logos (trademark). Each festival gets an SEO
landing page under /games/category/ or /daily/festivals. No new payout
surface.

### Phase A — Cosmetic progression (~2 days, retention without money)

Server-awarded trails/skins/titles from validated run outcomes (cosmetic-only
per gate G2). Procedurally drawn — zero asset weight. Ledger discipline:
append-only award events, idempotency keys (existing PointEvent pattern
minus money). Exit: cosmetics visible on daily boards, zero client-authoritative
state (gate G3).

### Phase B — Streak shields (~0.5 day)

One missed day does not kill a streak. Rules: server-side shield award (max 1
per week), gifting ships only if a friend-graph exists — it does not, so v1 =
earn-only. Exits: streak churn point instrumented in stats tab.

### Phase C — Community goals (~1 day, one server counter)

"Everyone together needs N points today to unlock tomorrow's special
mutator." The counter sums only validated run-end scores (pending=false) —
bots inflate nothing. Gate G4: goal thresholds derived server-side from the
seed hash (same derivation as slice 1), client input = none.

### Phase D — City & college leagues (~2 days)

Self-declared city/college (one per account, switchable monthly — rate-limited
to prevent board-squatting) → weekly boards. Names ride the existing
leet-normalized blocklist moderation queue. Payout-adjacent: NO (gate G2).
Exit: one city rivalry measurable in D1 lift.

### Phase E — Highlight clips (1 week+; gated on iOS Safari QA)

canvas.captureStream + MediaRecorder, 10 s rolling buffer, branded outro.
Android Chrome first-class; iOS Safari behind a capability check (fallback =
share the score card image). RAM guard: buffer only on devices that passed
the lite-mode performance bar.

### Phase H — Determinization epic — replay verification (phase 7) + ghost races (~1–2 weeks, the only engine-touching phase)

131 Math.random/Date.now call sites across the five engines keep replay
verification honestly deferred (docs/threat-model.md, ADR-024/028). This
phase migrates engines onto the kit's fixed-timestep loop (the engine
migration already proposed in compact.md), which unlocks TWO payoffs from
ONE epic: (1) server-side replay verification of stored input logs (already
stored, 16K cap — the evidence trail becomes the judge), and (2) ghost races
— replay a friend's or the top player's run as a translucent ghost. Feels
like multiplayer, no realtime server.

- Ghost v1: daily runs only (input logs exist there), one ghost per run,
  derived from the daily board's top entry or a challenge-link sender.
- Gate G3: ghost playback is server-replayed or clearly labeled
  UNVERIFIED — client-supplied ghosts never affect boards.
- Exit: abuse suite extended with replay-forgery attacks (gate G4).

### Phase F — i18n (Hinglish/Hindi UI + regional SEO pages, ~1 week)

String extraction first (game UI already lives in manifests + runner
components), Hinglish default variant, then Hindi. Regional SEO landing
pages (low-competition queries) ship before full UI i18n.

### Phase J — Monthly game jams for Indian student devs (ops, not code)

Featured winners + revenue share. Builds game supply before full dev
submissions open. Only after growth slices prove traffic (gate G1).

### Rewards-track ideas (folded into the rewards program docs, no code now)

- Show only past payouts — "Last month we paid ₹X to Y players" reads
  straight from the existing locked MonthlyPool/PayoutRequest tables via the
  reconciliation endpoint. Never projected earnings (farming magnet).
- Payout choice (cash/voucher/recharge/donate) — requires CA/tax sign-off
  first (business-documentation.md); reduces UPI payout review load.
- No cash referral bonuses — ever (gate G2).
- Opt-in daily reminders (web push) — only after PWA install exists (iOS
  needs home-screen install); one message per day, easy off-switch.

## Sequence dependency table

| Phase | Depends on | Unlocks | Gate to proceed |
|-------|-----------|---------|-----------------|
| 0 read-out | — | all measurement | — |
| 1 share+mutators | 0 | 3 (calendar), C (goals) | G1 baseline recorded |
| 2 lite+PWA | — | E (clips buffer), push reminders | G1 lite-mode FPS lift |
| 3 festival calendar | 1 (mutator system) | seasonal SEO traffic | G1 |
| A cosmetics | 1 | J (jam prizes) | G1 |
| B shields | 0 | — | G1 churn-point data |
| C community goals | 1 | — | G1 |
| D leagues | 0 | — | G1 + G4 moderation QA |
| E clips | 2 (perf bar) | — | iOS Safari QA pass |
| H determinization | G1 proving traffic justifies the epic | phase-7 replay + ghosts | abuse suite green |
| F i18n | G1 traffic | regional SEO | — |
| J jams | A (prizes) | game supply | G1 |

## Master order

0 → 1 → 2 → 3 → A → B → C → D → E → H → F → J,
with the rewards-track ideas entering only via the rewards go/no-go.

## Appendix — build prompt embedded at the head of the queue (slice 1)

> **Slice 1 build prompt — WhatsApp challenge links + daily mutators + D1/D7
> stats (v0.11.0).** In /home/z/my-project (Next.js 16 App Router, Bun,
> Prisma+SQLite, zod route handlers). Three features, one PR, engines
> untouched:
>
> 1. **WhatsApp challenge links.** GameStage.tsx already has shareGame()
> with navigator.share (GameStage.tsx:317) and a ?daily=1 deep link
> (GameStage.tsx:123). Extend it: after a daily run ends, add a "Challenge a
> friend" button that opens https://wa.me/?text=<msg> where <msg> = "I scored
> X on today's BRUTAL//STACK daily (mutator name). Beat me: <absUrl>/games/
> stack?daily=1". Fallback where navigator.share is unavailable (desktop) =
> copy-to-clipboard. Track share_click via the existing adapter
> (OwnPortalAdapter). No new API, no new state.
>
> 2. **Daily mutators (STACK only).** Server: derive a mutator from the
> existing daily seed hash (src/lib/daily/seed.ts) — same derivation pattern,
> zero new client-trusted input. Mutator set v1 (4): big blocks (wider),
> fast drops, narrow timing window, wind drift. Serve via GET /api/daily/seed
> response extension {mutator}. Client: GameStage passes mutator to the STACK
> shim via ctx.daily; the shim maps it to the engine's existing tuning
> constants where possible (no engine edits — wrap at the shim). CRITICAL:
> per-mutator plausibility multipliers in games/stack/manifest.ts (e.g. fast
> drops = maxScorePerSecond x1.3) so the /api/daily/run plausibility check
> does not flag honest fast-drop runs. Add a mutator label to the daily board
> UI and the share text.
>
> 3. **D1/D7 stats.** New GET /api/admin/stats (role-guarded, zod date-range
> param, rate-limited): DAU per dateKey, D1/D7 cohort return from
> DailyActivity + DailyRun.createdAt. New `stats` tab in admin/page.tsx
> (client component, existing tab pattern). No new tracking, no new client
> telemetry — server tables only.
>
> Docs with the PR: README (share + mutator + stats sections),
> technical-documentation.md, business-documentation.md, help.md (how to
> share/challenge), compact.md, CHANGELOG 0.11.0. Tests: mutator derivation
> determinism (same seed → same mutator), plausibility multiplier table
> coverage, admin stats math against a seeded fixture DB. Gates: G1 (record
> baseline), G3 (mutator server-derived), G4 (zod + rate limit on the new
> admin route).
