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

**What is the daily challenge?**
Every game has a seeded daily run — the same challenge for everyone that day
(the day rolls over at midnight IST). Unlimited tries, best score counts, and
consecutive days build a streak. Offline runs use a local seed and are marked
UNRANKED. Daily leaderboard rank never pays anything — it's pure bragging
rights.

**The game won't load / is slow.**
Games load ONLY when you press PLAY (that's by design — the page stays light).
If it's still slow: close heavy tabs, avoid low-power mode, try day mode, or
add ?perf=1 to the URL to see the fps overlay. On mobile, use the fullscreen
button in the top-right of the game.

**Where did /play and /stack go?**
They moved to /games/arena and /games/stack (plus /games/reflex, /games/dodge,
/games/merge). Old links redirect automatically.

## Hosting & deployment

**Where is the game hosted?**
Two places: a static arcade on GitHub Pages (landing + games, per-browser local
leaderboard) and the full app on Render (shared leaderboard, accounts, rewards) —
see the Deploy button in the README.

**Why did the leaderboard on Render reset?**
The Render free plan has an ephemeral filesystem: every deploy/restart/spin-down
wipes the SQLite file. The schema is re-created automatically at boot, so the site
keeps working. To keep data, upgrade the service to a paid plan and attach the
disk described in `render.yaml`.

**Why is the first request after idle so slow?**
Free Render services sleep after 15 minutes without traffic and take ~1 minute to
spin back up. A free uptime monitor pinging `/api/health` every 10 minutes avoids
most sleep periods.

**The images 404 on GitHub Pages but work locally?**
That was a bug fixed in 0.4.1 — asset paths must go through `assetUrl()`. Report
it if it reappears after adding new art.
