/*
 * Kairus service worker.
 *
 * The shell is cached so the app opens instantly and survives a lost network.
 * Messages are never cached: they are live data, and stale messages would be
 * worse than none.
 */

const SHELL = 'kairus-shell-v1'
const RUNTIME = 'kairus-runtime-v1'
const PRECACHE = ['/', '/mark.svg', '/mark-maskable.svg', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== SHELL && key !== RUNTIME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/*
 * A message arriving while the application is closed. The payload was
 * encrypted for this browser alone — the push service that carried it could
 * not read it.
 */
self.addEventListener('push', (event) => {
  let notice = { title: 'Kairus', body: 'nouveau message', conversation: null }
  try {
    if (event.data) notice = { ...notice, ...event.data.json() }
  } catch {
    // A payload we cannot parse is still worth announcing.
  }

  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      icon: '/mark.svg',
      badge: '/mark.svg',
      // One conversation, one notification: a burst must not stack up.
      tag: notice.conversation ? `kairus-${notice.conversation}` : 'kairus',
      renotify: true,
      data: { conversation: notice.conversation },
    }),
  )
})

/** Tapping it brings the open tab forward rather than opening a second one. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const conversation = event.notification.data && event.notification.data.conversation
  const target = conversation ? `/?c=${conversation}` : '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue
        client.postMessage({ t: 'open-conversation', conversation })
        return client.focus()
      }
      return self.clients.openWindow(target)
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket')) return

  // Navigations: try the network, fall back to the cached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(SHELL).then((cache) => cache.put('/', copy))
          return response
        })
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    )
    return
  }

  // Build output is content-hashed, so a cache hit is always correct.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          void caches.open(RUNTIME).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
