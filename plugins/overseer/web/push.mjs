// The board's phone half (lot 69), stdlib only: the icons and the manifest, the Web Push of a need (VAPID, RFC 8292; payload
// encryption aes128gcm, RFC 8291), the push text of the Push mockup (overseer/web/mockups/phone/Push.dc.html), the quiet hours,
// and push.json: the subscriptions, the hours, the needs sent, the snoozes. server.mjs owns one pusher and calls check() on each tick.
import { createECDH, createHash, createCipheriv, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { basename, dirname } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { pushNeeds } from './pushneeds.mjs'

// ---- colours: board.css is the source (its --ground and --act, oklch), turned into hex for the manifest, the metas and the icon
export function oklchHex(text) {
  const [L, C, H] = text.match(/[-\d.]+/g).map(Number)
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
  const srgb = c => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)))
  return '#' + lin.map(c => srgb(c).toString(16).padStart(2, '0')).join('')
}
let palette
export function colours() {
  if (palette) return palette
  const css = readFileSync(new URL('./board.css', import.meta.url), 'utf8')
  const all = name => [...css.matchAll(new RegExp(`--${name}:\\s*(oklch\\([^)]*\\))`, 'g'))].map(m => oklchHex(m[1]))
  palette = { ground: { light: all('ground')[0], dark: all('ground')[1] }, act: all('act')[0] }
  return palette
}

// ---- icons: a ring and a dot on --act, on the ground; a PNG drawn in memory (RGBA, 8 bits)
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const chunk = (type, data) => {
  const head = Buffer.alloc(8), t = Buffer.from(type, 'latin1')
  head.writeUInt32BE(data.length, 0); t.copy(head, 4)
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0)
  return Buffer.concat([head, data, tail])
}
export function icon(size) {
  const bg = rgb(colours().ground.light), fg = rgb(colours().act)
  const c = size / 2, R = size * 0.3, w = size * 0.07, dot = size * 0.13
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const cover = x => Math.min(1, Math.max(0, x + 0.5)) // a one-pixel edge
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c)
      const a = Math.max(cover(w / 2 - Math.abs(d - R)), cover(dot - d))
      const o = row + 1 + x * 4
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(bg[k] * (1 - a) + fg[k] * a)
      raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// The manifest: standalone, the board's start URL with the token (an iOS home-screen app has its own cookie jar).
export function manifest(token) {
  const c = colours()
  return {
    name: 'Overseer board', short_name: 'OVERSEER', start_url: `/?t=${token}`, scope: '/', display: 'standalone',
    theme_color: c.ground.light, background_color: c.ground.light,
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
  }
}

// ---- VAPID (RFC 8292): an ES256 token over the endpoint's origin, signed with the server's key
export function vapidKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return { privateJwk: privateKey.export({ format: 'jwk' }), publicJwk: publicKey.export({ format: 'jwk' }) }
}
// the public key as the browser wants it: the raw uncompressed point, base64url
export const publicRaw = keys => Buffer.concat([Buffer.from([4]), Buffer.from(keys.publicJwk.x, 'base64url'), Buffer.from(keys.publicJwk.y, 'base64url')]).toString('base64url')
export function vapidAuth(endpoint, keys, subject, nowSec) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const input = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject })}`
  const key = createPrivateKey({ key: keys.privateJwk, format: 'jwk' })
  const sig = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${input}.${sig.toString('base64url')}, k=${publicRaw(keys)}`
}

// ---- aes128gcm (RFC 8291 over RFC 8188). `asPrivate` and `salt` are for the RFC's test vector only.
export function encrypt(json, p256dh, auth, { salt = randomBytes(16), asPrivate } = {}) {
  const as = createECDH('prime256v1')
  if (asPrivate) as.setPrivateKey(Buffer.from(asPrivate, 'base64url')); else as.generateKeys()
  const ua = Buffer.from(p256dh, 'base64url'), asPub = as.getPublicKey()
  const ecdh = as.computeSecret(ua)
  const ikm = Buffer.from(hkdfSync('sha256', ecdh, Buffer.from(auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const c = createCipheriv('aes-128-gcm', cek, nonce)
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(json), Buffer.from([2])])), c.final(), c.getAuthTag()])
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096)
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct])
}

// one POST to the subscriber's push service; resolves the HTTP status (0 when the request itself fails)
export function sendPush(sub, payload, keys, { subject, now = Date.now(), urgency = 'normal', topic } = {}) {
  const url = new URL(sub.endpoint)
  const body = encrypt(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth)
  const headers = { TTL: '86400', Urgency: urgency, 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', 'content-length': body.length, authorization: vapidAuth(sub.endpoint, keys, subject, Math.floor(now / 1000)) }
  if (topic) headers.Topic = topic
  return new Promise(resolve => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: 'POST', headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) })
    req.setTimeout(10e3, () => req.destroy(new Error('timeout')))
    req.on('error', () => resolve(0))
    req.end(body)
  })
}

// ---- the schedule: From and To in the Mac's local time; a window across midnight is allowed
const minutes = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }
export const inHours = (now, hours) => {
  if (!hours) return true
  const d = new Date(now), m = d.getHours() * 60 + d.getMinutes(), f = minutes(hours.from), t = minutes(hours.to)
  return f <= t ? m >= f && m < t : m >= f || m < t
}

// ---- the push text: the Push screen of the phone mockups. app is the OS-less header; the title is the need; the body is what Victor must do.
const task = n => (n.lot === undefined ? '' : ` task ${n.lot}`)
const TITLE = {
  blocked: n => `Task ${n.lot} is blocked`,
  waits: n => `${n.label ?? 'A session'} asks about${task(n)}`,
  stuck: n => `${n.label ?? 'A session'} is stuck`,
  gate: n => `Approve the workflow of${task(n)}`,
  review: n => `Review${task(n)}`,
  departs: n => `Task ${n.lot} departs from the plan`,
  judge: n => `Judge task ${n.lot}`,
  incomplete: n => `Complete task ${n.lot}`,
  reinstall: n => `Reinstall for task ${n.lot}`,
  plan: () => 'Approve the new tasks',
  budget: () => 'The budget needs you',
  error: () => 'The overseer has an error',
}
export function pushText(n, project, hours, now) {
  // ponytail: a fixed cap, not a split: one aes128gcm record (4 KB) holds the whole payload, and a push service refuses more with 413
  const clip = (t, max) => (t.length > max ? `${t.slice(0, max - 1)}…` : t)
  const title = clip((TITLE[n.kind] ?? (() => 'Overseer needs you'))(n).replace(/\s+/g, ' ').trim(), 200)
  const text = String(n.text ?? '')
  let body = clip(n.kind === 'gate' ? `${text.replace(/\.?$/, '.')} Tap to approve, change or reject.` : text, 900)
  if (hours) body += `\nQuiet hours ${inHours(now, hours) ? `from ${hours.to}` : `until ${hours.from}`}: only blocks and approvals push`
  return { app: `OVERSEER · ${project}`, title, body }
}

// ---- push.json: the one state. Written 0600 to a temp file, then renamed.
const EMPTY = () => ({ subs: [], hours: null, sent: {}, snoozed: {} })
export function loadState(file) {
  if (!file) return EMPTY()
  try { return { ...EMPTY(), ...JSON.parse(readFileSync(file, 'utf8')) } } catch { return EMPTY() }
}
function saveState(file, state) {
  if (!file) return
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}
// push-keys.json: the VAPID pair as JWKs, 0600. Made on first use; in memory when there is no file (a test without one).
function loadKeys(file) {
  if (file) try { return JSON.parse(readFileSync(file, 'utf8')) } catch {}
  const keys = vapidKeys()
  if (file) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(keys), { mode: 0o600 }); chmodSync(file, 0o600) }
  return keys
}

// The inputs the POSTs take, checked here (the server checks the Origin, the type and the body size).
export { pushNeeds }
export const validHm = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
// The push services a subscription may name (Victor, 2026-10-23; checked in their docs that day: Apple web.push.apple.com,
// Google fcm.googleapis.com, Mozilla updates.push.services.mozilla.com). A host matches whole; an entry with a leading dot
// matches the subdomains of that domain. Any other host is refused, so the server never POSTs where a cookie holder points it.
export const PUSH_HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', '.push.services.mozilla.com']
const pushHost = host => PUSH_HOSTS.some(h => (h.startsWith('.') ? host.endsWith(h) && host.length > h.length : host === h))
export function validSubscription(s, insecure = false) {
  try {
    const u = new URL(s.endpoint)
    const endpointOk = (u.protocol === 'https:' && !u.port && !u.username && !u.password && pushHost(u.hostname)) || (insecure && u.protocol === 'http:' && u.hostname === '127.0.0.1')
    const p = Buffer.from(s.keys.p256dh, 'base64url'), a = Buffer.from(s.keys.auth, 'base64url')
    return endpointOk && p.length === 65 && p[0] === 4 && a.length === 16
  } catch { return false }
}

// The pusher: one per server. check(slug, board) is called on every tick; a need pushes once, unless it closes and opens again.
export function pusher({ file = null, keysFile = null, clock = () => Date.now(), insecure = false, retryMs = 30e3, subject = () => 'https://localhost', log = () => {} } = {}) {
  const state = loadState(file)
  state.subs = state.subs.filter(s => validSubscription(s, insecure)) // a subscription stored before the allowlist is dropped: never pushed to
  let keys
  const inflight = new Set(), delivered = new Map(), backoff = new Map()
  const save = () => saveState(file, state)
  return {
    state,
    publicKey() { keys ??= loadKeys(keysFile); return publicRaw(keys) },
    subscribe(s) {
      state.subs = [...state.subs.filter(x => x.endpoint !== s.endpoint), { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, at: clock() }]
      save()
    },
    schedule(hours) { state.hours = hours; save() },
    // a snooze: the need is not sent before `until`; after it, it pushes once more if it is still open (so a snooze also re-arms a sent need)
    snooze(slug, need, until) {
      (state.snoozed[slug] ??= {})[need] = until
      if (state.sent[slug]) delete state.sent[slug][need]
      save()
    },
    check(slug, board) {
      const now = clock(), list = pushNeeds(board), open = new Set(list.map(n => n.key))
      const sent = (state.sent[slug] ??= {}), snz = (state.snoozed[slug] ??= {})
      let dirty = false
      for (const k of Object.keys(sent)) if (!open.has(k)) { delete sent[k]; dirty = true } // a need that closes is forgotten
      for (const [k, until] of Object.entries(snz)) if (until <= now) { delete snz[k]; dirty = true }
      const project = basename(board.repo ?? '') || slug
      for (const n of list) {
        const id = `${slug}|${n.key}`
        if (sent[n.key] !== undefined || inflight.has(id) || snz[n.key] !== undefined || backoff.get(id) > Date.now()) continue // a retry waits in real time
        if (!inHours(now, state.hours) && !n.urgent) { sent[n.key] = now; dirty = true; continue } // outside the hours: silent, it waits in Needs
        if (!state.subs.length) { sent[n.key] = now; dirty = true; continue } // nobody to tell: seen
        inflight.add(id)
        const done = delivered.get(id) ?? new Set()
        delivered.set(id, done)
        const payload = { ...pushText(n, project, state.hours, now), tag: n.key, url: `/#need=${encodeURIComponent(n.key)}&slug=${encodeURIComponent(slug)}`, slug, need: n.key }
        const topic = createHash('sha256').update(n.key).digest('base64url').slice(0, 32)
        const urgency = n.urgent ? 'high' : 'normal'
        Promise.all(state.subs.filter(s => !done.has(s.endpoint)).map(async s => {
          const code = await sendPush(s, payload, (keys ??= loadKeys(keysFile)), { subject: subject(), now, urgency, topic })
          if (code >= 200 && code < 300) done.add(s.endpoint)
          else if (code === 404 || code === 410) { state.subs = state.subs.filter(x => x.endpoint !== s.endpoint); done.add(s.endpoint); dirty = true }
          else return false
          return true
        })).then(results => {
          inflight.delete(id)
          if (results.includes(false)) { backoff.set(id, Date.now() + retryMs); log(`push of ${n.key} failed: retry later`); return }
          if (state.subs.every(s => done.has(s.endpoint))) { delivered.delete(id); backoff.delete(id); (state.sent[slug] ??= {})[n.key] = clock(); save() }
        })
      }
      if (dirty) save()
    },
  }
}
