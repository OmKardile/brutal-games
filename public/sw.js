// BRUTAL//GAMES service worker — app-shell precache + navigation fallback
// (roadmap slice 2, PWA). OFFLINE POLICY (deliberate):
//   - shell (this site's own pages/assets) caches on first visit
//   - API routes are NEVER cached (boards/auth/rewards must be live; offline
//     runs already fall back to the documented local-seed UNRANKED flow —
//     they cannot obtain server-signed run tokens, so they are structurally
//     unrankable: no new fraud surface)
//   - game engine chunks are cached on first PLAY (runtime cache), so a
//     revisit installs instantly and plays offline
//   - cross-origin (analytics beacon, Turnstile) passes through untouched
const VERSION = 'brutal-v1'
const SHELL_CACHE = `${VERSION}-shell`
const RUNTIME_CACHE = `${VERSION}-runtime`

// app shell: the pages a cold offline visit needs
const SHELL_URLS = [
  '/',
  '/games',
  '/daily',
  '/manifest.json',
  '/logo.svg',
  '/offline.html',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(SHELL_URLS.map((u) => cache.add(new Request(u, { cache: 'reload' })))),
    ).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // POSTs (scores, runs) are never cached
  const url = new URL(req.url)

  // same-origin only; API never cached (live boards, auth, rewards)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // page navigations: shell cache first, then network, then offline page
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            const copy = res.clone()
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
            return res
          })
          .catch(() => caches.match('/offline.html').then((p) => p || Response.error())),
      ),
    )
    return
  }

  // static assets: cache-first with runtime fill (game chunks land here)
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok && (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/og/') || url.pathname.startsWith('/images/'))) {
              const copy = res.clone()
              caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => undefined)
            }
            return res
          })
          .catch(() => Response.error()),
    ),
  )
})
