# Help / FAQ

## Players

**Do I need an account to play?**
No. The game is fully playable without one. An account unlocks the optional
rewards program — and, since v0.8, posting to the GLOBAL leaderboard.

**How do leaderboards work? (v0.8)**
Signed-in players rank on the global board when their run is backed by a
server-issued run token (issued automatically when a run starts and validated
against the server's own clock). Guests still see the global board, but their
own scores land on a per-browser LOCAL board — the game-over screen shows a
"SIGN IN TO RANK ON THE GLOBAL BOARD" hint. Daily challenge boards work the
same for everyone (seed-verified runs rank).

**What's a callsign?**
Your board name. It's tied to your account (one per player, case-insensitive
unique), so nobody can post as you — or as "ADMIN". Set or change it on
`/rewards`. Reserved words, hate speech and lookalike spellings are blocked.

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
First payouts also require the account to be at least 3 days old with play on 3
different days (anti-farming rules), and each UPI ID can only be linked to one
account. Requests are held for a review period (default 14 days), then an admin
approves and pays manually to your UPI. You'll see the status (PENDING → APPROVED →
PAID) in the payout history.

**Why is my score "pending verification"?**
New top scores (top-3 territory) and scores from accounts under review are held
briefly before appearing on the public board — usually released automatically
within 24h, instantly once an admin verifies. Nothing is deleted automatically;
if a run of yours was removed by mistake, contact us and it gets restored.

**How do I secure my account?**
Use a password of at least 10 characters that you don't reuse. You can see every
active session on `/rewards` and log out everywhere with one click. Repeated failed
logins temporarily lock the account (protection against brute force) and may ask
for a captcha.

**Why did my points disappear / account freeze?**
Confirmed fraud voids points: multiple accounts, bots, scripted activity, or forged run
data. Suspicious cases go to human review first — if you were flagged by mistake,
nothing is auto-punished; contact us and it gets sorted.

**Something feels wrong on the play page.**
The rewards HUD is intentionally tiny (top-left). It never blocks gameplay, and if the
program is disabled it disappears entirely.

## Admins

**Why is the console asking for 2FA?** Since v0.9.2 every admin account MUST
enroll TOTP two-factor auth (generate a secret in the console, add it to any
authenticator app, confirm one code). Admin logins then need password + code,
and admin sessions expire after 1 hour — that is deliberate: the console
controls real money.

**Payouts are frozen — did something break?** Check SETTINGS for the
REWARDS_PAYOUTS_PAUSED kill switch. It freezes payout creation and approval
(losing nothing) during an incident and can be flipped back at runtime.
Rejecting still works so money can be freed. Every change you make is
recorded in the AUDIT tab (who/what/when/before/after).

**Self-approval:** you cannot approve a payout for your own player account —
another admin has to (two-person rule above TWO_PERSON_THRESHOLD_MINOR, off
by default while there is a single admin).

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

**What are mutators?**
Some days the STACK daily runs a special scoring rule — PERFECT HEAVY (perfect
drops count double), STREAK MASTER (your best streak IS the score), and
similar. The mutator is derived from the day's seed server-side, so everyone
plays the same twist. The label shows in-game and on the daily banner, and the
scoring ceiling scales with it — an honest great run is never flagged.

**How do I challenge a friend?**
Finish a daily run and hit CHALLENGE A FRIEND — WhatsApp opens with your
score, the day's mutator and a link that opens the SAME seeded challenge for
them. Same seed, same rules: the score gap is pure skill.

**The game won't load / is slow.**
Games load ONLY when you press PLAY (that's by design — the page stays light).
If it's still slow: close heavy tabs, avoid low-power mode, try day mode, or
add ?perf=1 to the URL to see the fps overlay. On mobile, use the fullscreen
button in the top-right of the game. The site also auto-detects slow devices
(LITE mode — page animations switch off to save frames); the QUALITY button
in-game lets you pin AUTO / LITE / FULL.

**Can I play offline / install it?**
Yes: install the arcade from your browser (Android Chrome: the INSTALL APP
button; iOS Safari: Share → Add to Home Screen). The app shell caches, and
any game you've already played loads offline. Offline daily runs use a local
seed and count as UNRANKED — leaderboards stay honest. Boards and accounts
need a connection; the games don't.

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
