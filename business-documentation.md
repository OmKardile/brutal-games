# Business documentation — rewards program

## The model

Players earn points through genuine engagement. Each month, `SHARE_PERCENT` (default 30%)
of the game's **net** ad revenue forms a pool. The pool is split between players
pro-rata by their valid points for the month. Payouts come only from that pool:
zero revenue means zero payouts, always.

Ad compliance (hard rules, enforced by design):
- Points never depend on ad impressions, clicks, or views.
- We never ask users to click or watch ads, and the game UI never mentions ads as the
  source of rewards — points are framed as rewards for playing.
- Ad placements are unchanged by this feature (the game currently ships none).

## How players earn (defaults, all admin-configurable)

| Activity | Points | Cap |
|---|---|---|
| Active play (heartbeat: tab visible + real input, every 30s) | 1 per beat | daily cap 100 |
| Daily login streak | 5 on day 1, +5/day up to 30 | within daily cap |
| Run completion | 2 per wave reached, max 30/run | within daily cap |
| Daily challenge (deterministic per day) | 20 | once/day |

The daily cap keeps worst-case farm value low. Fraud (multiple accounts, bots, forged
stats) voids points and freezes accounts after human review.

## Money flow

1. **Month ends** (IST calendar month).
2. **Admin enters net revenue** for the month in `/admin` (from the ad network report,
   net of refunds/fees, INR). Pool = floor(revenue × share%).
3. **Preview** shows the full distribution: per-player raw share, cap clamps, leftover.
4. **Lock** — snapshot is immutable. Leftover from cap clamps stays in the pool (unpaid),
   shown in the preview. Players see the credited amount in `/rewards`.
5. **Players request payouts** to a UPI ID. Requirements (0.9-0.10 hardening):
   verified email, 18+ declaration, amount ≥ minimum threshold (₹100 default;
   smaller balances carry over), no other pending request, account ≥72h old,
   play on ≥3 different days, no HIGH risk score (explainable flag score —
   see docs/anti-cheat.md), and a UPI destination not linked to any other
   account (one destination per account; pooling attempts are flagged).
   Requests are captcha-guarded and idempotent (replays return the original).
   New accounts (<48h) earn at half the daily cap (cooling).
   **Kill switch:** REWARDS_PAYOUTS_PAUSED freezes payout creation + approval
   at runtime without touching point earning (admin SETTINGS tab).
6. **Hold period** (default 14 days from request, snapshotted per request) before an
   admin may approve.
7. **Admin approves, pays manually via UPI, marks paid** with the transaction reference.
   Rejections free the reserved amount.

Voided points after a pool lock: the locked snapshot never changes. If fraud is
confirmed after lock, the admin rejects that player's pending payout for the month
(rejected amounts are tracked as `voidedMinor`). Already-paid payouts are not clawed back.

## Monthly admin runbook

1. Pull the net revenue figure from the ad network report for the closed month.
2. `/admin` → POOL → enter month + net revenue (₹) + share % → SAVE → PREVIEW.
3. Scan the preview: player count, cap clamps, leftover, any FROZEN players.
4. Review the FLAGS tab first if anything looks off; freeze/void as needed (users tab).
5. LOCK the month.
6. Work the PAYOUTS tab (requires admin 2FA — see below): after each
   request's hold expires, approve → pay via UPI →
   mark paid with the reference. Reject (with reason) anything suspicious.
7. Run `bun run db:backup` and store the file.

## Risk controls

- All fraud signals are flag-only → manual review; nothing auto-pays or auto-freezes.
- Suspicious payouts sit in the hold period; admins can reject any time.
- **Admin access since 0.9.2:** mandatory TOTP 2FA (password + 6-digit code
  at login; enrollment forced on first console visit), 1-hour admin
  sessions, optional ADMIN_IP_ALLOWLIST. Self-approval of your own payout is
  blocked; above TWO_PERSON_THRESHOLD_MINOR a second, DIFFERENT admin must
  finalize (off by default while there is a single admin). Every action is
  in the append-only AUDIT tab. Monthly money checks:
  GET /api/admin/reconciliation (Σ payouts vs Σ credited — mismatch alerts
  fire when ALERT_WEBHOOK_URL is set). Incident procedures:
  docs/incident-runbook.md.
- One account per person (device + IP clustering checks), verified email for payouts,
  18+ declaration for earning and payouts.
- Master kill-switch: `REWARDS_ENABLED` off stops all earning and hides all reward UI.

## Before real payouts (TODO — legal/tax)

This build is technically complete but **must not distribute real money** before:
- Legal review of the program terms and prize/gaming-law classification in India.
- Tax review: TDS thresholds, GST on the revenue share, withholding duties, reporting.
- KYC decision point (fields already configurable: `KYC_REQUIRED`, `KYC_FIELDS`) and a
  documented identity-verification process.
- A payout policy sign-off (who approves, spending limits, dispute handling).
- Data-retention and privacy sign-off for IPs/fingerprints (see /privacy).

Budget the pool from **net** revenue only. Treat the share percentage and caps as
levers to keep the program sustainable; changes apply going forward.

## Daily challenges & the rewards program (v0.7.0)

Daily challenges are a retention feature, not a payout feature. Hard rules:

- Daily leaderboard rank NEVER pays cash or points. Rewards stay
  engagement-based (heartbeat play time, login streaks, run completions,
  daily-challenge points as before) and are unaffected by daily rank.
- The daily system and the ad pipeline never interact: the PortalAdapter's
  ad slots are placeholders (no network is wired); analytics events go to an
  optional privacy-friendly endpoint. Points never reference ads, ad views,
  or daily rank.
- Streaks (daily) and login streaks (rewards) are separate concepts and are
  displayed separately; both roll over at IST midnight (daily tz is
  configurable via PortalSetting).

Portal readiness for ad networks (when revenue is planned):

1. Pick the network(s); read their SDK docs; finish the adapter stubs.
2. Legal review of the consent banner copy + ad disclosures (EU + India DPDP).
3. Enable `NEXT_PUBLIC_CONSENT_BANNER=on`, ship `ads.txt` at the root.
4. Set `NEXT_PUBLIC_ANALYTICS_ENDPOINT` (Plausible/Umami) for the event
   vocabulary (game_load, play_start, run_end, daily_start, daily_complete,
   share_click, ad_shown, ad_failed).
5. Interstitial policy is already enforced in code (natural breaks, 90 s gap,
   first-minute block, 5 s timeout) — configure gaps via PortalSetting.


## Post-security growth roadmap (v0.11.0)

The growth/retention build queue is [docs/roadmap.md](docs/roadmap.md)
(ADR-029). Rewards-track implications settled there:

- "Past payouts only" display (₹X to Y players last month) reads from the
  existing locked MonthlyPool/PayoutRequest tables via reconciliation —
  never projected earnings.
- Payout choice (cash / voucher / donate) stays parked until the CA/tax
  sign-off in the pre-payouts checklist; it reduces UPI review load but adds
  no new cash surface before then.
- Referral rewards are cosmetics/streak-shields only, never cash (gate G2 —
  multi-account farming economics; UPI uniqueness + fingerprints already
  defend that surface).
- `REWARDS_ENABLED` stays false through all of it; community goals, leagues
  and cosmetics carry no money by design.
