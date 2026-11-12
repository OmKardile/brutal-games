# Help / FAQ

## Players

**Do I need an account to play?**
No. The game is fully playable without one. An account only unlocks the optional
rewards program.

**How do I earn points?**
Sign in, confirm you're 18+, and just play — with the tab visible and real input.
Points land automatically: active play (every 30s heartbeat), daily login streaks,
run completions, and the daily challenge. There's a per-day cap; the HUD on the play
page shows your progress.

**What are points worth?**
Each month, a share (default 30%) of the game's net revenue becomes a pool that is
split between players pro-rata by points. Any number you see before the month closes
is an **estimate, not guaranteed**. If revenue is zero, payouts are zero.

**How do I get paid?**
In `/rewards`: verify your email, add your UPI ID, and request a payout once your
credited balance is at least the minimum (default ₹100; smaller balances carry over).
Requests are held for a review period (default 14 days), then an admin approves and
pays manually to your UPI. You'll see the status (PENDING → APPROVED → PAID) in the
payout history.

**Why did my points disappear / account freeze?**
Confirmed fraud voids points: multiple accounts, bots, scripted activity, or forged run
data. Suspicious cases go to human review first — if you were flagged by mistake,
nothing is auto-punished; contact us and it gets sorted.

**Something feels wrong on the play page.**
The rewards HUD is intentionally tiny (top-left). It never blocks gameplay, and if the
program is disabled it disappears entirely.

## Admins

**Monthly close:** `/admin` → POOL → enter month + net revenue (₹, from the ad network
report, net of fees) + share % → SAVE → PREVIEW → (review flags first if unsure) → LOCK.
Locking is final; the snapshot never recomputes.

**Payout queue:** PAYOUTS tab. APPROVE is blocked until the request's hold period
expires. After approving, pay via UPI out-of-band, then MARK PAID with the transaction
reference. REJECT frees the reserved amount back to the player's balance.

**A fraud flag appeared — what now?**
FLAGS tab. Open the user (USERS tab), inspect their ledger, devices, and IP history.
DISMISS if benign (fingerprint collisions happen), CONFIRM if fraud, then freeze the
account and/or void the offending ledger events (select them in the user panel and
VOID with a reason — this writes reversal rows, it never deletes history).

**Enabling/disabling rewards:** SETTINGS tab → REWARDS_ENABLED master switch.
When off, nothing is earned and all reward UI is hidden. All other knobs (caps,
thresholds, hold days, heartbeat interval, VPN IP list) are there too.

**Creating another admin:** `bun run seed:admin email password` on the server
(or ADMIN_EMAIL/ADMIN_PASSWORD env). Existing accounts can only be promoted if their
email is verified. There is no in-app promotion path.

**Backups:** `bun run db:backup` — safe while the app runs. Schedule it (cron) and
keep copies off-box; the file to back up is `db/custom.db` (WAL is checkpointed by
the script).

**Emails aren't sending.**
Set `RESEND_API_KEY` or `BREVO_API_KEY` (+ `MAIL_FROM`) in `.env`. Without a key,
verification/reset links print to the server console — fine for local dev only.

**Google login button missing?**
Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; it appears automatically.
