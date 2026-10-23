// lot 69 in a real Chrome (test/cdp.mjs) on the real server: the board installs (the manifest, the icons, the two theme colours);
// "Notify me" asks for permission and stores the subscription (0600) and the hours; a push's notification (delivered to the service
// worker, as Chrome delivers one) shows its tag, and a tap on it opens that need's card with Approve, Change and Reject.
// The browser cannot reach a push service: pushManager.subscribe is stubbed, and the endpoint is never pushed to.
// Fails where Chrome is missing, unless OVERSEER_NO_BROWSER=1.
import assert from 'node:assert/strict'
import { createECDH, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { after, before, test } from 'node:test'
import { boards } from './fixtures/make.mjs'
import { browserTest, launch } from './test/cdp.mjs'
import { serve } from './server.mjs'

const { skip } = browserTest()
const TOKEN = randomBytes(32).toString('hex')
const EP = 'http://127.0.0.1:9/never' // a subscriber the server would push to; no test writes a need that pushes there
const sub = createECDH('prime256v1'); sub.generateKeys()
const P256DH = sub.getPublicKey().toString('base64url'), AUTH = randomBytes(16).toString('base64url')
let base, server, origin, page

// the needs-you fixture with one gate session (a workflow waits for approval), as the board exports it
const gateBoard = () => ({
  ...boards['needs-you'], at: Date.now(), nextPassAt: Date.now() + 150e3, repo: '/home/user/Repos/claude-mods',
  sessions: [{ sessionId: 's1', label: 'watch1', stage: 'gate', lot: 27, since: Date.now() - 60e3, lastText: '', tries: 0, gate: { name: 'band', agents: [{ label: 'opus thinks', model: 'opus' }, { label: 'sonnet builds', model: 'sonnet' }] } }],
  needs: [{ kind: 'gate', id: 's1', red: true, lot: 27, text: 'A workflow waits for your approval: band' }],
})
const pushJson = () => JSON.parse(readFileSync(`${base}/push.json`, 'utf8'))

before(async () => {
  if (skip) return
  base = mkdtempSync(`${tmpdir()}/ovpb-`)
  mkdirSync(`${base}/boards`)
  writeFileSync(`${base}/boards/r.json`, JSON.stringify(gateBoard()))
  writeFileSync(`${base}/web.json`, JSON.stringify({}))
  server = await serve({ dir: `${base}/boards`, requests: `${base}/requests`, tokenFile: `${base}/web.json`, token: TOKEN, port: 0, every: 50, pushInsecure: true, pushRetryMs: 60e3 })
  origin = `http://127.0.0.1:${server.address().port}`
  page = await launch()
  await page.send('Browser.grantPermissions', { permissions: ['notifications'], origin })
  await page.view({ width: 393, height: 659 })
  await page.goto(`${origin}/?t=${TOKEN}`) // the token becomes the cookie: a home-screen app's first load
})
after(async () => { await page?.close(); server?.closeAllConnections(); server?.close() })

test('the board installs: a manifest with standalone, icons, and a theme colour per theme', { skip }, async () => {
  const m = await page.evaluate(`fetch('/manifest.webmanifest').then(r => r.json())`)
  assert.equal(m.display, 'standalone')
  assert.equal(m.scope, '/')
  assert.match(m.start_url, new RegExp(`^/\\?t=${TOKEN}$`))
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/)
  assert.match(m.background_color, /^#[0-9a-f]{6}$/)
  for (const size of [192, 512]) assert.ok(m.icons.some(i => i.src === `/icon-${size}.png` && i.sizes === `${size}x${size}`), `icon ${size}`)
  for (const path of ['/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']) {
    const png = await page.evaluate(`fetch('${path}').then(r => r.arrayBuffer()).then(b => Array.from(new Uint8Array(b)))`)
    assert.deepEqual(png.slice(1, 4), [0x50, 0x4e, 0x47], `${path} is a PNG`)
    const width = ((png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19]) >>> 0
    assert.equal(width, path === '/apple-touch-icon.png' ? 180 : Number(path.match(/\d+/)[0]), `${path} width`)
  }
  const metas = await page.evaluate(`[...document.querySelectorAll('meta[name="theme-color"]')].map(m => [m.media, m.content])`)
  assert.equal(metas.length, 2)
  assert.ok(metas.some(([media, c]) => media.includes('light') && /^#[0-9a-f]{6}$/.test(c)), 'light')
  assert.ok(metas.some(([media, c]) => media.includes('dark') && /^#[0-9a-f]{6}$/.test(c)), 'dark')
  assert.equal(await page.evaluate(`!!document.querySelector('meta[name="apple-mobile-web-app-capable"][content="yes"]')`), true)
  assert.equal(await page.evaluate(`document.querySelector('link[rel="manifest"]').getAttribute('crossorigin')`), 'use-credentials')
})

test('Notify me asks for permission, stores the subscription at 0600, and saves the hours', { skip }, async () => {
  await page.evaluate(`(() => { PushManager.prototype.subscribe = async () => ({ endpoint: ${JSON.stringify(EP)}, toJSON: () => ({ endpoint: ${JSON.stringify(EP)}, keys: { p256dh: ${JSON.stringify(P256DH)}, auth: ${JSON.stringify(AUTH)} } }) }) })()`)
  await page.click('#phone [data-pp="menu"]') // the phone's project sheet holds Notify me
  await page.click('#phone #notify-btn')
  await page.waitFor(`document.querySelector('#notify-state').textContent === 'Notifications on'`, 8000)
  const s = pushJson()
  assert.equal(s.subs.length, 1)
  assert.equal(s.subs[0].endpoint, EP)
  assert.equal(statSync(`${base}/push.json`).mode & 0o777, 0o600)
  assert.equal(statSync(`${base}/push-keys.json`).mode & 0o777, 0o600)
  await page.evaluate(`(() => { const f = document.querySelector('#quiet-from'); f.value = '08:00'; f.dispatchEvent(new Event('change')); const t = document.querySelector('#quiet-to'); t.value = '20:00'; t.dispatchEvent(new Event('change')) })()`)
  await page.waitFor(`document.querySelector('#notify-state').textContent === 'Hours saved'`, 8000)
  assert.deepEqual(pushJson().hours, { from: '08:00', to: '20:00' })
})

// a push's notification, as Chrome gives it to the worker: the tag is the need's key
const PAYLOAD = JSON.stringify({ app: 'OVERSEER · claude-mods', title: 'Approve the workflow of task 27', body: 'A workflow waits for your approval: band. Tap to approve, change or reject.', tag: 'gate:s1', url: '/#need=gate%3As1&slug=r', slug: 'r', need: 'gate:s1' })
// the tap: the worker's notificationclick, dispatched in its own scope (a real NotificationEvent on the notification shown)
const TAP = action => `(async () => {
  const [n] = await self.registration.getNotifications({ tag: 'gate:s1' })
  const ev = new NotificationEvent('notificationclick', { notification: n, action: ${JSON.stringify(action)} })
  let pending = []
  ev.waitUntil = p => { pending.push(p) }
  self.dispatchEvent(ev)
  await Promise.all(pending)
  return (await self.registration.getNotifications({ tag: 'gate:s1' })).length
})()`

// the board's service worker registration, as Chrome reports it once ServiceWorker is enabled
async function registrationId() {
  await page.send('ServiceWorker.enable')
  const regs = () => [...page.events].reverse().find(e => e.method === 'ServiceWorker.workerRegistrationUpdated')?.params.registrations ?? []
  let rid
  for (let i = 0; i < 40 && !rid; i++) { rid = regs().find(r => r.scopeURL === `${origin}/`)?.registrationId; if (!rid) await page.wait(50) }
  assert.ok(rid, 'the board has its service worker registration')
  return rid
}

test('a push shows its tag; a tap on it closes the notification and opens that need\'s card with Approve, Change and Reject', { skip }, async () => {
  const rid = await registrationId()
  await page.send('ServiceWorker.deliverPushMessage', { origin, registrationId: rid, data: PAYLOAD })
  await page.wait(500)
  const shown = await page.evaluate(`navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.map(n => [n.tag, n.title]))`)
  assert.deepEqual(shown, [['gate:s1', 'Approve the workflow of task 27']])
  const worker = await page.worker('/sw.js')
  assert.equal(await worker.evaluate(TAP('')), 0, 'the tap closes the notification')
  await page.view({ width: 1280, height: 800 }) // the desktop review view
  await page.goto('about:blank') // a load from the link, not a hash change of the page that is open
  await page.goto(`${origin}/#need=gate%3As1&slug=r`) // the card at once
  await page.waitFor(`!!document.querySelector('#view-review:not([hidden]) .k-approval')`, 8000)
  const buttons = await page.evaluate(`[...document.querySelectorAll('#view-review .k-approval button')].map(b => b.textContent.trim())`)
  for (const label of ['Approve', 'Change', 'Reject']) assert.ok(buttons.some(t => t.endsWith(label)), `${label} on the card: ${buttons}`)
  await page.view({ width: 393, height: 659 }) // the phone: the same card opens in #phone
  await page.goto('about:blank')
  await page.goto(`${origin}/#need=gate%3As1&slug=r`)
  await page.waitFor(`!!document.querySelector('#phone [data-pp-card]')`, 8000)
  const phoneButtons = await page.evaluate(`[...document.querySelectorAll('#phone .pp-cardscr button')].map(b => b.textContent.trim())`)
  for (const label of ['Approve', 'Change', 'Reject']) assert.ok(phoneButtons.some(t => t.endsWith(label)), `${label} on the phone card: ${phoneButtons}`)
  assert.deepEqual(page.errors, [])
})

test('the Snooze action (Android, desktop) posts the snooze for that need to the server, and closes the notification', { skip }, async () => {
  await page.send('ServiceWorker.deliverPushMessage', { origin, registrationId: await registrationId(), data: PAYLOAD })
  await page.wait(300)
  const before = Date.now()
  const worker = await page.worker('/sw.js')
  assert.equal(await worker.evaluate(TAP('snooze')), 0, 'the snooze closes the notification too')
  let until
  for (let i = 0; i < 80 && !until; i++) { until = pushJson().snoozed?.r?.['gate:s1']; if (!until) await page.wait(50) }
  assert.ok(until, 'the server holds the snooze')
  assert.ok(until >= before + 59 * 60e3 && until <= before + 61 * 60e3, 'one hour')
})
