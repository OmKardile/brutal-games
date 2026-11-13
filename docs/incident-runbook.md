# Incident runbook — BRUTAL//GAMES

Operational security playbook for the rewards program and the platform.
Companions: [threat model](threat-model.md) · [anti-cheat](anti-cheat.md) ·
[SECURITY.md](../SECURITY.md). Print this before an incident, not during.

## 0. Triage (first 5 minutes)

1. What is affected — money (payouts/pool), boards, accounts, availability?
2. Is it ongoing (active farming, attack) or discovered after the fact?
3. Severity: anything touching money or admin access = **critical**.

The three levers you will use most: **freeze payouts** (§1), **revoke
sessions** (§2), **rotate secrets** (§3). All are safe to pull first and
investigate second — none destroy data.

## 1. Freeze payouts (kill switch)

Admin console → SETTINGS → **REWARDS_PAYOUTS_PAUSED** → ON, then SAVE.
- Blocks payout CREATION and admin APPROVE/MARK-PAID instantly, at runtime.
- Reject still works (frees reserved money back to the pool).
- Points earning keeps running (players notice nothing).
- Full stop instead: flip **REWARDS_ENABLED** off (hides the whole program).
- Every flip is audited (AUDIT tab) and fires a `payout.kill_switch` alert.

## 2. Revoke sessions / lock an account

- **One player:** console → USERS → search → **FREEZE** (also revokes every
  session immediately; the account can no longer log in or earn).
- **Everyone (suspected session theft / XSRX):** there is no bulk revoke
  button by design — instead rotate `SESSION_SECRET` (§3), which invalidates
  every session cookie at once (users just log in again).
- **An admin account:** freeze it, then rotate `SESSION_SECRET` (admin
  session tokens are derived from it and die with it) and re-enroll 2FA if
  the TOTP secret may have leaked (regenerate via TOTP setup).

## 3. Rotate secrets

Rotate in this order, deploying between steps (zero-downtime rotation):
1. `SESSION_SECRET` — new random 32+ bytes. Kills ALL sessions + admin
   tokens. Keep the old value in `RUN_TOKEN_KEYS` verification position? No —
   run tokens are HMAC-keyed separately:
2. `RUN_TOKEN_KEYS` — append a NEW key (last position signs), deploy, wait
   ≤6h (max scorable session age), then remove the retired key.
3. `DAILY_SALT` — rotating changes future daily seeds. Rotate only at a day
   boundary or accept that the current day's seed changes mid-day (runs
   submitted with the old seed become unranked — acceptable).
4. `FINGERPRINT_SALT` — rotating orphans device-history clustering. Only on
   DB leak.
5. `TURNSTILE_SECRET_KEY` / mail keys — rotate at the provider, update env.

```bash
bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4. Confirmed cheating / fraud response

1. Evidence: FLAGS tab → review signals (z-scores, drift, entropy, clusters).
2. Adjudicate: CONFIRM the flag (or DISMISS for false positives — note why).
   Confirmed flags make future submissions display-only and raise the risk
   score (auto-HOLD at 40+).
3. Clean the boards: BOARDS tab → REMOVE the cheat entries (reason is kept in
   the audit trail; ranks recompute automatically; RESTORE if reversed).
4. Money: void the relevant points (USERS → void ledger events — reversal
   rows, append-only). If a pool is already locked, rejected payouts free
   their reservation into `voidedMinor` (stays unpaid).
5. Never ban silently: the player sees "under review" states and can appeal
   via the contact page; the appeal path is the flags queue + human judgment.

## 5. Void + re-run a month's pool

Only for a locked pool with fraud-tainted distributions:
1. Freeze payouts (§1).
2. Compute the damage: reconciliation report (`GET /api/admin/reconciliation
   ?month=YYYY-MM`) — issues list shows over-payments per user.
3. Void the offenders' ledger events for that month (append-only reversals).
4. The month's locked snapshot is IMMUTABLE by design — pay the difference
   manually only after legal/finance review, or carry the correction into the
   NEXT month's pool (documented deviation, requires founder sign-off).
5. Unfreeze payouts; write the post-mortem (§8).

## 6. Database leak / host compromise

1. Rotate EVERYTHING (§3) + provider keys (mail, Turnstile).
2. Assume password hashes are out: force password resets? We do not have
   bulk reset; communicate (§7) asking all users to reset + rotate from the
   reset flow (reset kills all sessions for that user).
3. Check for injected admins: `bun scripts/check-scores.ts`-style audit —
   verify ADMIN users list, 2FA enrollment state, admin audit trail for
   unknown actions.
4. Restore-from-backup only if integrity is broken (§ backups below); prefer
   forensics on a COPY.

## 7. User communications (template)

> **Subject: Security incident on BRUTAL//GAMES — action needed**
>
> Hi pilot,
>
> On {DATE} we detected {INCIDENT_TYPE} affecting {SCOPE}. As a precaution we
> have {ACTIONS_TAKEN: e.g. "paused payouts and forced session logouts"}.
>
> What this means for you: {IMPACT: e.g. "your points and balance are safe;
> leaderboard entries from {PERIOD} are under review"}.
>
> What to do: {USER_ACTION: e.g. "log in again; if you reused your password
> elsewhere, change it; request a password reset if you see anything odd"}.
>
> We take the integrity of the game and the rewards program seriously.
> Questions: {CONTACT}.
>
> — {SIGNATURE}, {DATE}

Honesty rules: state scope plainly, never claim "no impact" before forensics
finish, send an update when the post-mortem is done.

## 8. Post-mortem (within 7 days)

File as `docs/postmortems/YYYY-MM-DD-<slug>.md`:
- Timeline (UTC): detection → containment → resolution.
- What worked / what didn't (which layers caught it, which didn't).
- Root cause + contributing factors.
- Actions: code, config, process — each with an owner and a deadline.
- Threat-model update: fold new attack patterns back into
  docs/threat-model.md §5 and adjust layers if needed.

## 9. Host checklist (deploy target)

- [ ] Firewall: only 80/443 (+ SSH) exposed; app on localhost only
- [ ] SSH key-only auth, no root login, fail2ban or equivalent
- [ ] Unattended security updates
- [ ] App/container runs non-root (Dockerfile ships `USER bun`)
- [ ] `.env` permissions 600, never committed
- [ ] DB file outside any served directory (repo default: `db/`, gitignored)
- [ ] `TRUSTED_PROXY=1` set (behind Caddy/Render) — rightmost-XFF parsing
- [ ] Backups: `bun run db:backup` on a schedule, encrypted, OFF-SITE,
      and a **tested restore** (monthly: restore to /tmp, run `bun test`
      smoke against it, delete)
- [ ] `ALERT_WEBHOOK_URL` wired to a channel a human watches
- [ ] Log retention target 90 days; no secrets/PII in logs (by construction)

## 10. Alert catalog (ALERT_WEBHOOK_URL payloads)

| Alert | Severity | Meaning |
|---|---|---|
| `Kill switch flipped` | critical | REWARDS_ENABLED / PAYOUTS_PAUSED changed |
| `Reconciliation mismatch` | critical | payouts exceed credited distributions |
| `Admin login from a new IP` | critical | T9 — phished/stolen admin |
| `HIGH-severity flag raised` | warn | VPN/datacenter, headless, speed-hack signals |

Structured events (stdout JSON): auth.* (failures, lockouts, signups,
resets, freezes), flag.raised, payout.* (requested/approved/rejected/paid),
payout.kill_switch, admin.login_new_ip, reconciliation.mismatch.
