// The board's service worker (lot 69): it shows a need as a notification and opens that need's card. Its scope is / (served at /sw.js).
// Snooze is the one action a notification offers on Android and desktop (iOS shows none): it posts the snooze to the server.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : {}
  const note = self.registration.showNotification(d.title ?? 'Overseer', {
    body: d.body ?? '', tag: d.tag, icon: '/icon-192.png', badge: '/icon-192.png',
    data: { url: d.url ?? '/', slug: d.slug, need: d.need },
    actions: [{ action: 'snooze', title: 'Snooze 1 h' }],
  })
  e.waitUntil(note)
})

self.addEventListener('notificationclick', e => {
  const n = e.notification
  n.close()
  if (e.action === 'snooze') {
    const { slug, need } = n.data ?? {}
    // a random id: the server keeps one request file per id
    const id = Math.random().toString(36).slice(2, 12) || 'snooze'
    e.waitUntil(fetch('/push/snooze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, slug, need, until: Date.now() + 3600e3 }) }))
    return
  }
  const { url, need, slug } = n.data ?? {}
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const win = all.find(c => 'focus' in c)
    if (win) { try { await win.focus() } catch {} /* refused without a user gesture: the message still reaches the page */; return win.postMessage({ need, slug }) }
    return self.clients.openWindow(url ?? '/')
  })())
})
