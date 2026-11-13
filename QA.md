# QA.md — pre-ship checklist

Run for EVERY game before it ships (and after any portal/adapter change).
Automate what you can: `bun test` covers the marked [auto] items; browser items
use devtools (or Playwright when installed — optional, never required).

Legend: [auto] = covered by `bun test tests/`, [dev] = devtools manual,
[perf] = devtools performance tab / throttled, [port] = portability (matters
before portal submission).

## Functional

- [ ] [dev] Loads, starts, restarts, and exits with no console errors
- [ ] [dev] Core loop is clear within 10 seconds with zero tutorial text
- [ ] [dev] Game over / level end / pause / resume work; state resets cleanly
      between runs (score, streaks, timers, boards all back to initial)
- [ ] [dev] Theme toggle (night/day) re-skins the live game on the next frame
- [ ] [auto] RNG: logic and cosmetic streams independent; same seed ⇒ same
      logic sequence (tests/game-kit.test.ts)

## Input & device

- [ ] [dev] Keyboard, mouse, touch (one thumb) all work; gamepad links and plays
- [ ] [dev] No page scroll / pinch zoom / double-tap zoom / long-press callout
      from the game surface (touch-action none; context menu suppressed)
- [ ] [dev] Portrait + landscape + resize + fullscreen all re-fit; safe-area
      insets respected (notch doesn't cover the HUD)
- [ ] [dev] Android back button exits to the hub instead of trapping the user
- [ ] [dev] Browsers: Chrome Android, Safari iOS, Samsung Internet, Firefox desktop
- [ ] [auto] Loop: fixed step regardless of display Hz; frame gaps clamped
      (no spiral of death); no stuck keys after alt-tab (blur clears input)

## Performance

- [ ] [perf] 60 fps with 4× CPU throttle (`?perf=1` overlay stays green)
- [ ] [perf] First playable under 3 s on throttled mid-range Android (poster
      loads instantly; engine lazy-loads on Play click)
- [ ] [perf] Game bundle under 5 MB (check the chunk that lazy-loads)
- [ ] [perf] 10-minute soak: heap stays flat in `?perf=1`, no leak growth,
      no periodic GC stutter

## Portability & compliance (before portal submission)

- [ ] [port] Network panel: ZERO external requests from the game module itself
      (ads/analytics/SDKs only ever originate from the adapter layer)
- [ ] [port] Works in incognito (storage blocked → in-memory fallback, no crash)
- [ ] [port] No ads, no branding, no outgoing links inside game code
      (portal submission requirement; site chrome lives outside the game stage)
- [ ] [auto] gameplayStart/Stop: never back-to-back, never during an ad,
      start only from stopped state (AdRules tests)
- [ ] [dev] gameplayStart fires on first real input — NOT on page load
- [ ] [dev] Pause + mute on tab blur; audio unlocks on first touch
- [ ] [auto] Interstitials: natural breaks only, 90 s min gap enforced, nothing
      in the first session minute, 5 s timeout continues the game
- [ ] [dev] Rewarded ads (when a network exists) grant in-game perks ONLY —
      never reward-program points

## Daily challenge

- [ ] [auto] Seed determinism: hash(slug + dateKey + salt) stable; same seed ⇒
      same rng sequence (tests/daily.test.ts)
- [ ] [auto] Day rollover at the configured timezone boundary (default
      Asia/Kolkata midnight)
- [ ] [dev] Offline/absent API: run proceeds with a local fallback seed and is
      marked UNRANKED on the board
- [ ] [auto] Score validation rejects impossible scores (maxScorePerSecond) and
      too-short runs (minRunSeconds); rate limits reject spam
- [ ] [auto] Streaks: consecutive-day logic, guest→login merge, no double count
- [ ] [dev] Share: Web Share API with copy-link fallback; deep link
      `/games/<slug>?daily=<dateKey>` resumes the same challenge
- [ ] [dev] Known v1 limitation: input logs are stored but NOT replay-verified
      (documented in technical-documentation.md — do not claim otherwise)

## SEO (portal pages)

- [ ] [dev] Rich Results Test passes on /games/<slug> (VideoGame+WebApplication)
- [ ] [dev] Unique title / meta description / H1 / canonical per page
- [ ] [dev] sitemap.xml valid with lastmod; robots.txt blocks /api /admin /rewards
- [ ] [perf] Lighthouse mobile (pre-play): Performance 90+, SEO 95+, CLS ≈ 0
      (game container + board slots reserve their space)
- [ ] [dev] Page is useful with JS disabled (all rankable text is server-rendered)

## Accessibility

- [ ] [dev] Sound toggle reachable; reduced-motion respected (shake/hit-stop off)
- [ ] [dev] Readable contrast in BOTH themes; focus states survive the game HUD
