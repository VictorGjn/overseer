// lot 69, the stdlib half: the aes128gcm and VAPID crypto (RFC 8291 Appendix A, RFC 8292), the icon, the push text of the Push
// mockup, the quiet hours. The server half (the fake push endpoint, the once-per-need rule, snooze) is in push.server.test.mjs.
import assert from 'node:assert/strict'
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto'
import { createServer, request } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { inflateSync } from 'node:zlib'
import { test } from 'node:test'
import { colours, encrypt, icon, inHours, pushText, validSubscription, vapidAuth, vapidKeys } from './push.mjs'
import { serve } from './server.mjs'

const b64 = s => Buffer.from(s, 'base64url')

// RFC 8291 Appendix A, with the line breaks of the RFC removed.
const A = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
  ecdhSecret: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
}

test('RFC 8291 Appendix A: the application server key pair and the whole encrypted body match the RFC', () => {
  const as = createECDH('prime256v1')
  as.setPrivateKey(b64(A.asPrivate))
  assert.equal(as.getPublicKey().toString('base64url'), A.asPublic)
  assert.equal(b64(A.plaintext).toString('utf8'), 'When I grow up, I want to be a watermelon')
  const body = encrypt('When I grow up, I want to be a watermelon', A.uaPublic, A.auth, { salt: b64(A.salt), asPrivate: A.asPrivate })
  assert.deepEqual(body, Buffer.concat([b64(A.header), b64(A.ciphertext)]))
})

test('RFC 8291 Appendix A: the intermediate values are the RFC\'s (ECDH, IKM, CEK, nonce)', () => {
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(b64(A.asPrivate))
  const secret = ecdh.computeSecret(b64(A.uaPublic))
  assert.equal(secret.toString('base64url'), A.ecdhSecret)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), b64(A.uaPublic), b64(A.asPublic)])
  const ikm = Buffer.from(hkdfSync('sha256', secret, b64(A.auth), info, 32))
  assert.equal(ikm.toString('base64url'), A.ikm)
  assert.equal(Buffer.from(hkdfSync('sha256', ikm, b64(A.salt), Buffer.from('Content-Encoding: aes128gcm\0'), 16)).toString('base64url'), A.cek)
  assert.equal(Buffer.from(hkdfSync('sha256', ikm, b64(A.salt), Buffer.from('Content-Encoding: nonce\0'), 12)).toString('base64url'), A.nonce)
})

test('the ES256 VAPID token verifies with the public key (ieee-p1363), has aud = the endpoint origin and exp = now + 12 h', () => {
  const keys = vapidKeys(), now = 1_800_000_000
  const auth = vapidAuth('https://web.push.apple.com/QWERTY123', keys, 'https://my-mac.tail1234.ts.net', now)
  const m = auth.match(/^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/)
  assert.ok(m, auth)
  const [h, p, s] = m[1].split('.')
  const pub = b64(m[2])
  assert.equal(pub.length, 65)
  assert.equal(pub[0], 4)
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' })
  assert.equal(b64(s).length, 64)
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, b64(s)), 'signature')
  const claims = JSON.parse(b64(p).toString())
  assert.equal(claims.aud, 'https://web.push.apple.com')
  assert.equal(claims.exp, now + 12 * 3600)
  assert.equal(claims.sub, 'https://my-mac.tail1234.ts.net')
  assert.equal(JSON.parse(b64(h).toString()).alg, 'ES256')
})

test('the icon is a PNG of the size asked: a dot in --act at the centre, the ground in the corner', () => {
  for (const size of [180, 192, 512]) {
    const png = icon(size)
    assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    assert.equal(png.readUInt32BE(16), size)
    assert.equal(png.readUInt32BE(20), size)
    const raw = inflateSync(idat(png))
    const at = (x, y) => [...raw.subarray(y * (size * 4 + 1) + 1 + x * 4, y * (size * 4 + 1) + 1 + x * 4 + 3)]
    const hex = colours().act, rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    assert.deepEqual(at(size / 2, size / 2).slice(0, 3), rgb, 'the dot is --act') // the centre
    assert.deepEqual(at(2, 2).slice(0, 3), [1, 3, 5].map(i => parseInt(colours().ground.light.slice(i, i + 2), 16)), 'the corner is the ground')
  }
})

// the IDAT chunks of a PNG, concatenated
function idat(png) {
  const parts = []
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i), type = png.subarray(i + 4, i + 8).toString('latin1')
    if (type === 'IDAT') parts.push(png.subarray(i + 8, i + 8 + len))
    i += 12 + len
  }
  return Buffer.concat(parts)
}

const at = (h, m = 0) => new Date(2026, 9, 23, h, m).getTime()
const MOCK = { from: '08:00', to: '20:00' }

test('the push text is the Push mockup: "OVERSEER · <project>", the need as title, what Victor must do, the quiet line', () => {
  const gate = pushText({ kind: 'gate', lot: 63, text: '6 agents: opus thinks, sonnet builds, haiku tests.' }, 'claude-mods', MOCK, at(10, 41))
  assert.deepEqual(gate, {
    app: 'OVERSEER · claude-mods',
    title: 'Approve the workflow of task 63',
    body: '6 agents: opus thinks, sonnet builds, haiku tests. Tap to approve, change or reject.\nQuiet hours from 20:00: only blocks and approvals push',
  })
  const ask = pushText({ kind: 'waits', lot: 60, label: 'watch1', text: 'Give the two tests a 15 s timeout, or close the task?' }, 'claude-mods', MOCK, at(10, 41))
  assert.equal(ask.title, 'watch1 asks about task 60')
  assert.equal(ask.body, 'Give the two tests a 15 s timeout, or close the task?\nQuiet hours from 20:00: only blocks and approvals push')
})

test('the push text: a blocked task, and the quiet line outside the hours and with no hours', () => {
  assert.equal(pushText({ kind: 'blocked', lot: 3, text: 'Unblock task 3' }, 'p', MOCK, at(9)).title, 'Task 3 is blocked')
  assert.equal(pushText({ kind: 'review', lot: 5, text: 'Look at it' }, 'p', MOCK, at(21)).body, 'Look at it\nQuiet hours until 08:00: only blocks and approvals push')
  assert.equal(pushText({ kind: 'review', lot: 5, text: 'Look at it' }, 'p', null, at(21)).body, 'Look at it')
})

test('a long text is clipped: the push fits one 4 KB record, and the quiet line stays on the last line', () => {
  const p = pushText({ kind: 'waits', lot: 1, label: 'w', text: 'x'.repeat(5000) }, 'p', MOCK, at(10))
  assert.ok(p.body.length <= 1000, `body ${p.body.length}`)
  assert.ok(p.body.endsWith('Quiet hours from 20:00: only blocks and approvals push'))
  assert.ok(JSON.stringify(p).length < 2000)
  assert.equal(pushText({ kind: 'budget' }, 'p', null, at(10)).body, '', 'a need with no text')
})

test('the hours: From and To in local time; a window across midnight', () => {
  assert.equal(inHours(at(8), MOCK), true)
  assert.equal(inHours(at(7, 59), MOCK), false)
  assert.equal(inHours(at(19, 59), MOCK), true)
  assert.equal(inHours(at(20), MOCK), false)
  const night = { from: '22:00', to: '07:00' }
  assert.equal(inHours(at(23), night), true)
  assert.equal(inHours(at(6, 59), night), true)
  assert.equal(inHours(at(12), night), false)
  assert.equal(inHours(at(3), null), true, 'no hours: always')
})

// ---- the server half: a fake push endpoint on 127.0.0.1 that checks every request (the VAPID token against the public key, aud, the
// body with the subscriber's private key through its own HKDF calls, not push.mjs's), a board folder on disk, and a fake clock.
const sub = createECDH('prime256v1'); sub.generateKeys()
const P256DH = sub.getPublicKey().toString('base64url'), AUTH = randomBytes(16).toString('base64url')
function decryptBody(body) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen)
  const ikm = Buffer.from(hkdfSync('sha256', sub.computeSecret(asPub), Buffer.from(AUTH, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), sub.getPublicKey(), asPub]), 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const d = createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(ct.subarray(ct.length - 16))
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
  if (pt[pt.length - 1] !== 2) throw new Error('no last-record delimiter')
  return JSON.parse(pt.subarray(0, -1).toString('utf8'))
}
function verifyVapid(auth, origin, nowSec) {
  const m = auth?.match(/^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/)
  if (!m) return 'no vapid header'
  const [h, p, sig] = m[1].split('.')
  const pub = Buffer.from(m[2], 'base64url')
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' })
  if (!verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))) return 'bad signature'
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
  if (claims.aud !== origin) return `aud ${claims.aud}`
  if (!(claims.exp > nowSec && claims.exp <= nowSec + 12 * 3600)) return 'exp'
  if (!/^(https:\/\/|mailto:)\S+$/.test(claims.sub ?? '')) return `sub ${claims.sub}`
  return 'ok'
}
// `answer(n)` gives the status of the n-th request (1-based); `delay` holds each answer
async function fakeEndpoint({ answer = () => 201, delay = 0, clock = () => at(10, 0) } = {}) {
  const got = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      got.push({ headers: req.headers, verified: verifyVapid(req.headers.authorization, `http://127.0.0.1:${server.address().port}`, Math.floor(clock() / 1000)), payload: decryptBody(body) })
      setTimeout(() => res.writeHead(...[answer(got.length)].flat()).end(), delay) // answer: a status, or [status, headers]
    })
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  return { url: `http://127.0.0.1:${server.address().port}/send/${randomBytes(4).toString('hex')}`, got, close: () => { server.closeAllConnections(); server.close() } }
}
const call = (port, path, { method = 'GET', origin, cookie, body } = {}) => new Promise(resolve => {
  const q = request({ host: '127.0.0.1', port, path, method, headers: { host: '127.0.0.1', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) } }, r => { r.resume(); resolve({ status: r.statusCode }) })
  q.on('error', () => resolve({ status: 0 }))
  q.end(body ? JSON.stringify(body) : undefined)
})
const wait = ms => new Promise(ok => setTimeout(ok, ms))
async function until(fn, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(20) } return false }
const TOKEN = 'ab'.repeat(32)
// base/boards is the board folder; base/web.json the token file, and base/push.json the push state, as in ~/.claude/overseer
function start({ base = mkdtempSync(`${tmpdir()}/ovpush-`), insecure = true, retryMs = 50, t = { now: at(10, 0) } } = {}) {
  return serve({ dir: `${base}/boards`, requests: mkdtempSync(`${tmpdir()}/ovpush-r-`), tokenFile: `${base}/web.json`, token: TOKEN, port: 0, every: 50, pushInsecure: insecure, pushRetryMs: retryMs, now: () => t.now })
    .then(server => { mkdirSync(`${base}/boards`, { recursive: true }); return { server, base, t, port: server.address().port, origin: `http://127.0.0.1:${server.address().port}`, cookie: `ovt=${TOKEN}`, stop: () => { server.closeAllConnections(); server.close() } } })
}
const board = (needs, extra = {}) => ({ at: Date.now(), overseer: 'lead', repo: '/home/user/Repos/claude-mods', goal: 'g', nextPassAt: Date.now() + 1, lots: [{ n: 63, title: 'Workflow', status: 'running', depends: [] }], sessions: [{ sessionId: 's1', label: 'watch1', stage: 'gate', lot: 63, since: 1, lastText: '' }], feed: [], needs, ...extra })
const GATE = { kind: 'gate', id: 's1', red: true, lot: 63, text: '6 agents: opus thinks, sonnet builds, haiku tests' }
const REVIEW = { kind: 'review', id: 'review:5', red: false, lot: 5, text: 'the diff' }
const BLOCKED = { kind: 'blocked', id: '7', red: true, lot: 7, text: 'Unblock task 7' }
const setBoard = (s, b) => { writeFileSync(`${s.base}/boards/r.json`, JSON.stringify(b)); return wait(120) } // mtime moves, the next tick reads it
async function subscribe(s, endpoint) {
  const r = await call(s.port, '/push/subscribe', { method: 'POST', origin: s.origin, cookie: s.cookie, body: { id: 'sub1', subscription: { endpoint, keys: { p256dh: P256DH, auth: AUTH } } } })
  assert.equal(r.status, 202)
}
const schedule = (s, hours) => call(s.port, '/push/schedule', { method: 'POST', origin: s.origin, cookie: s.cookie, body: { id: 'h1', hours } })
const snooze = (s, need, until) => call(s.port, '/push/snooze', { method: 'POST', origin: s.origin, cookie: s.cookie, body: { id: 'z1', slug: 'r', need, until } })
const pushJson = s => JSON.parse(readFileSync(`${s.base}/push.json`, 'utf8'))

test('a new need pushes once: VAPID verified, aud = the endpoint, the payload of the Push screen, the topic, the urgency', async () => {
  const ep = await fakeEndpoint()
  const s = await start()
  try {
    await subscribe(s, ep.url)
    await setBoard(s, board([GATE]))
    assert.ok(await until(() => ep.got.length === 1), 'one push')
    const [first] = ep.got
    assert.equal(first.verified, 'ok')
    assert.equal(first.headers.urgency, 'high')
    assert.equal(first.headers.topic.length <= 32, true)
    assert.deepEqual(first.payload, {
      app: 'OVERSEER · claude-mods', title: 'Approve the workflow of task 63',
      body: '6 agents: opus thinks, sonnet builds, haiku tests. Tap to approve, change or reject.',
      tag: 'gate:s1', url: '/#need=gate%3As1&slug=r', slug: 'r', need: 'gate:s1',
    })
  } finally { s.stop(); ep.close() }
})

test('a rewritten board, a restart on the same push.json, and a need still open send nothing more', async () => {
  const ep = await fakeEndpoint()
  const s = await start()
  try {
    await subscribe(s, ep.url)
    await setBoard(s, board([GATE]))
    assert.ok(await until(() => ep.got.length === 1))
    await setBoard(s, board([GATE], { at: Date.now() + 5 }))
    await wait(150)
    assert.equal(ep.got.length, 1, 'rewritten: none')
    s.stop()
    const again = await start({ base: s.base })
    try { await wait(250); assert.equal(ep.got.length, 1, 'restart: none') } finally { again.stop() }
  } finally { s.stop(); ep.close() }
})

test('a need that closes and opens again pushes once more', async () => {
  const ep = await fakeEndpoint()
  const s = await start()
  try {
    await subscribe(s, ep.url)
    await setBoard(s, board([GATE]))
    assert.ok(await until(() => ep.got.length === 1))
    await setBoard(s, board([]))
    await setBoard(s, board([GATE], { at: Date.now() + 9 }))
    assert.ok(await until(() => ep.got.length === 2), 'the reopened need pushes')
  } finally { s.stop(); ep.close() }
})

test('a slow endpoint gets one request for a need: the in-flight send is not repeated on the next tick', async () => {
  const ep = await fakeEndpoint({ delay: 600 })
  const s = await start()
  try {
    await subscribe(s, ep.url)
    await setBoard(s, board([GATE]))
    await wait(1500)
    assert.equal(ep.got.length, 1)
  } finally { s.stop(); ep.close() }
})

test('a failed send (500) is not marked and is sent again; a gone subscription (410) is dropped', async () => {
  const ep = await fakeEndpoint({ answer: n => (n === 1 ? 500 : 201) })
  const s = await start({ retryMs: 50 })
  try {
    await subscribe(s, ep.url)
    await setBoard(s, board([GATE]))
    assert.ok(await until(() => ep.got.length === 2), 'retried on a later tick')
    assert.equal(pushJson(s).sent.r['gate:s1'] > 0, true, 'marked after the success')
  } finally { s.stop(); ep.close() }
  const gone = await fakeEndpoint({ answer: () => 410 })
  const g = await start()
  try {
    await subscribe(g, gone.url)
    await setBoard(g, board([GATE]))
    assert.ok(await until(() => gone.got.length === 1))
    assert.ok(await until(() => pushJson(g).subs.length === 0), 'the subscription is dropped')
  } finally { g.stop(); gone.close() }
})

test('outside the hours only blocked and gate push: the others are marked and wait in Needs', async () => {
  const ep = await fakeEndpoint()
  const s = await start({ t: { now: at(22, 0) } })
  try {
    await subscribe(s, ep.url)
    assert.equal((await schedule(s, { from: '08:00', to: '20:00' })).status, 202)
    await setBoard(s, board([REVIEW]))
    await wait(200)
    assert.equal(ep.got.length, 0, 'a review outside the hours: nothing')
    assert.ok(pushJson(s).sent.r['review:review:5'] > 0, 'marked silent')
    await setBoard(s, board([GATE, REVIEW], { at: Date.now() + 2 }))
    assert.ok(await until(() => ep.got.length === 1), 'a gate pushes outside the hours')
    assert.equal(ep.got[0].headers.urgency, 'high')
    s.t.now = at(9, 0) // the window opens: the review does not come back, it was seen
    await wait(200)
    assert.equal(ep.got.length, 1, 'the review never pushes later')
  } finally { s.stop(); ep.close() }
})

test('a snoozed need sends nothing before its time and once after it', async () => {
  const ep = await fakeEndpoint()
  const s = await start({ t: { now: at(10, 0) } })
  const T = at(10, 30)
  try {
    await subscribe(s, ep.url)
    assert.equal((await snooze(s, 'review:review:5', T)).status, 202)
    await setBoard(s, board([REVIEW]))
    await wait(200)
    assert.equal(ep.got.length, 0, 'before the time: nothing')
    s.t.now = T - 60e3
    await wait(200)
    assert.equal(ep.got.length, 0, 'a minute before: nothing')
    s.t.now = T + 1
    assert.ok(await until(() => ep.got.length === 1), 'after the time: one push')
    await wait(200)
    assert.equal(ep.got.length, 1, 'and no second one')
  } finally { s.stop(); ep.close() }
})

test('a snooze re-arms a need that was already pushed: it pushes again when the snooze ends', async () => {
  const ep = await fakeEndpoint()
  const s = await start({ t: { now: at(10, 0) } })
  try {
    await subscribe(s, ep.url)
    await setBoard(s, board([GATE]))
    assert.ok(await until(() => ep.got.length === 1))
    assert.equal((await snooze(s, 'gate:s1', at(10, 45))).status, 202)
    s.t.now = at(10, 46)
    assert.ok(await until(() => ep.got.length === 2), 'pushed again after the snooze')
  } finally { s.stop(); ep.close() }
})

test('the hours and the snooze check their input: a bad time, a bad need or a bad until is 400', async () => {
  const s = await start()
  try {
    assert.equal((await schedule(s, { from: '8:00', to: '20:00' })).status, 400)
    assert.equal((await call(s.port, '/push/snooze', { method: 'POST', origin: s.origin, cookie: s.cookie, body: { id: 'z2', slug: 'r', need: '', until: 1 } })).status, 400)
    assert.equal((await call(s.port, '/push/snooze', { method: 'POST', origin: s.origin, cookie: s.cookie, body: { id: 'z3', slug: 'r', need: 'x', until: 1.5 } })).status, 400)
    assert.equal((await schedule(s, null)).status, 202, 'null clears the hours')
  } finally { s.stop() }
})

test('a subscription needs an https endpoint (http is for 127.0.0.1 in tests only); push.json and push-keys.json are 0600', async () => {
  // no board is written here: the https endpoints below are never pushed to (no real push service is ever called by a test)
  const ep = await fakeEndpoint()
  const s = await start({ insecure: false })
  try {
    const body = e => ({ method: 'POST', origin: s.origin, cookie: s.cookie, body: { id: 'sub9', subscription: { endpoint: e, keys: { p256dh: P256DH, auth: AUTH } } } })
    assert.equal((await call(s.port, '/push/subscribe', body(ep.url))).status, 400, 'http refused without pushInsecure')
    assert.equal((await call(s.port, '/push/subscribe', body('https://fcm.googleapis.com/fcm/send/x'))).status, 202)
    assert.equal((await call(s.port, '/push/key', { cookie: s.cookie })).status, 200)
    assert.equal(statSync(`${s.base}/push.json`).mode & 0o777, 0o600)
    assert.equal(statSync(`${s.base}/push-keys.json`).mode & 0o777, 0o600)
    assert.equal(readdirSync(s.base).some(f => f.endsWith('.tmp')), false)
  } finally { s.stop(); ep.close() }
})

test('only the push services of the allowlist take a subscription: exact hosts or a dot-suffix, never a substring', async () => {
  for (const e of ['https://web.push.apple.com/QKC1x', 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x'])
    assert.equal(validSubscription({ endpoint: e, keys: { p256dh: P256DH, auth: AUTH } }), true, e)
  for (const e of ['https://evil.com/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.com/x', 'https://evilfcm.googleapis.com/x', 'https://push.services.mozilla.com.evil.com/x',
    'https://evilpush.services.mozilla.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'https://push.example.invalid/x'])
    assert.equal(validSubscription({ endpoint: e, keys: { p256dh: P256DH, auth: AUTH } }), false, e)
  const ep = await fakeEndpoint()
  const s = await start({ insecure: false })
  try {
    const body = e => ({ method: 'POST', origin: s.origin, cookie: s.cookie, body: { id: 'sub8', subscription: { endpoint: e, keys: { p256dh: P256DH, auth: AUTH } } } })
    for (const e of ['https://evil.com/fcm.googleapis.com', 'https://127.0.0.1/x', ep.url]) assert.equal((await call(s.port, '/push/subscribe', body(e))).status, 400, e)
    assert.equal(existsSync(`${s.base}/push.json`) && JSON.parse(readFileSync(`${s.base}/push.json`, 'utf8')).subs?.length > 0, false, 'nothing stored')
    await setBoard(s, board([GATE]))
    await new Promise(ok => setTimeout(ok, 300))
    assert.equal(ep.got.length, 0, 'a refused endpoint gets no request')
  } finally { s.stop(); ep.close() }
})

test('a push follows no redirect, and a subscription outside the allowlist left in push.json gets no request', async () => {
  const target = await fakeEndpoint()
  const ep = await fakeEndpoint({ answer: () => [301, { location: target.url }] })
  const s = await start()
  try {
    await subscribe(s, ep.url)
    await setBoard(s, board([GATE]))
    assert.ok(await until(() => ep.got.length >= 1), 'the endpoint got the push')
    await new Promise(ok => setTimeout(ok, 300))
    assert.equal(target.got.length, 0, 'the redirect is not followed')
  } finally { s.stop(); ep.close(); target.close() }
  const old = await fakeEndpoint()
  const base = mkdtempSync(`${tmpdir()}/ovpush-`)
  writeFileSync(`${base}/push.json`, JSON.stringify({ subs: [{ endpoint: old.url, keys: { p256dh: P256DH, auth: AUTH }, at: 0 }], hours: null, sent: {}, snoozed: {} }), { mode: 0o600 })
  const s2 = await start({ base, insecure: false })
  try {
    await setBoard(s2, board([GATE]))
    await new Promise(ok => setTimeout(ok, 300))
    assert.equal(old.got.length, 0, 'an old subscription on a host outside the allowlist is never pushed to')
  } finally { s2.stop(); old.close() }
})

test('every new route asks for the cookie (lot 68 sweep)', async () => {
  const s = await start()
  try {
    for (const path of ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/sw.js', '/push/key']) assert.equal((await call(s.port, path)).status, 401, path)
    for (const path of ['/push/subscribe', '/push/schedule', '/push/snooze']) assert.equal((await call(s.port, path, { method: 'POST', origin: s.origin, body: { id: 'x' } })).status, 401, path)
    assert.equal((await call(s.port, '/manifest.webmanifest', { cookie: s.cookie })).status, 200)
  } finally { s.stop() }
})

test('server.mjs and push.mjs import only node: builtins and each other (stdlib only)', () => {
  for (const f of ['server.mjs', 'push.mjs', 'pushneeds.mjs']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    const specs = [...src.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'|^import\s+'([^']+)'/gm)].map(m => m[1] ?? m[2] ?? m[3])
    for (const spec of specs) assert.ok(spec.startsWith('node:') || spec.startsWith('./'), `${f} imports ${spec}`)
  }
})
