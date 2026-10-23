// lot 68: the phone link. Every route asks for the board cookie but /?t= and /version; the one *.ts.net name of web.json
// is the only other Host and Origin taken; a new token stops the old cookie.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

import { serve } from './server.mjs'

const PHONE = 'my-mac.tail1234.ts.net'
const call = (port, path, { method = 'GET', host = '127.0.0.1', origin, cookie, body } = {}) => new Promise(resolve => {
  const q = request({ host: '127.0.0.1', port, path, method, headers: { host, ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) } }, r => { r.resume(); resolve({ status: r.statusCode, cookie: r.headers['set-cookie']?.[0] }); r.destroy() })
  q.on('error', () => resolve({ status: 0 }))
  q.end(body ? JSON.stringify(body) : undefined)
})
async function start(token, host) {
  const dir = mkdtempSync(`${tmpdir()}/ovp-`), requests = mkdtempSync(`${tmpdir()}/ovp-r-`), tokenFile = `${mkdtempSync(`${tmpdir()}/ovp-t-`)}/web.json`
  writeFileSync(`${dir}/r.json`, JSON.stringify({ at: 1, repo: '/r', goal: 'g', lots: [{ n: 1, title: 't', status: 'done', base: 'aaaaaaa', tip: 'bbbbbbb', files: [[1, 0, 'a.ts']] }], sessions: [], feed: [] }))
  if (host) writeFileSync(tokenFile, JSON.stringify({ host }))
  const server = await serve({ dir, requests, tokenFile, token, port: 0, every: 50 })
  return { server, port: server.address().port, tokenFile, dir, requests }
}
const T1 = 'ab'.repeat(32), T2 = 'cd'.repeat(32)

test('without the ovt cookie every GET and every POST is a 401, but /?t=<token> and /version', async () => {
  const s = await start(T1)
  try {
    const gets = ['/', '/boards', '/board/r', '/events/r', '/board', '/board.css', '/gittree.js', '/stages/changes.js', '/diff/r?lot=1&file=a.ts', '/file/r?lot=1&path=golden/x.ts', '/nope']
    for (const path of gets) assert.equal((await call(s.port, path)).status, 401, path)
    for (const kind of ['answer', 'run', 'pass', 'lot', 'change', 'gate', 'plan']) assert.equal((await call(s.port, `/${kind}`, { method: 'POST', origin: `http://127.0.0.1:${s.port}`, body: { slug: 'r', id: 'x1' } })).status, 401, kind)
    assert.equal((await call(s.port, '/version')).status, 200)
    assert.equal((await call(s.port, `/?t=${T1}`)).status, 303)
    assert.equal((await call(s.port, '/', { cookie: `ovt=${T1}` })).status, 200)
    assert.equal((await call(s.port, '/boards', { cookie: `ovt=${T1}` })).status, 200)
  } finally { s.server.closeAllConnections(); s.server.close() }
})

test('Host and Origin: 127.0.0.1, localhost and the one name of web.json; any other name is refused (DNS rebinding)', async () => {
  const s = await start(T1, PHONE)
  const c = `ovt=${T1}`
  try {
    assert.equal((await call(s.port, '/boards', { host: PHONE, cookie: c })).status, 200)
    assert.equal((await call(s.port, '/boards', { host: 'localhost', cookie: c })).status, 200)
    for (const host of ['evil.example', 'other-mac.tail1234.ts.net', `${PHONE}.evil.example`, 'attacker.ts.net']) assert.equal((await call(s.port, '/boards', { host, cookie: c })).status, 403, host)
    assert.equal((await call(s.port, '/pass', { method: 'POST', host: PHONE, origin: `https://${PHONE}`, cookie: c, body: { slug: 'r', id: 'p1' } })).status, 202)
    assert.equal((await call(s.port, '/pass', { method: 'POST', host: PHONE, origin: 'https://attacker.ts.net', cookie: c, body: { slug: 'r', id: 'p2' } })).status, 403)
    assert.equal((await call(s.port, '/pass', { method: 'POST', host: PHONE, origin: `http://${PHONE}`, cookie: c, body: { slug: 'r', id: 'p3' } })).status, 403) // https only
    // the phone's QR code: the cookie is Secure there (tailscale serve is https); a local login is not
    assert.match((await call(s.port, `/?t=${T1}`, { host: PHONE })).cookie, /^ovt=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Secure$/)
    assert.match((await call(s.port, `/?t=${T1}`)).cookie, /^ovt=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/$/)
    writeFileSync(s.tokenFile, JSON.stringify({ ...JSON.parse(readFileSync(s.tokenFile, 'utf8')), host: undefined })) // /oversee phone off
    assert.equal((await call(s.port, '/boards', { host: PHONE, cookie: c })).status, 403) // no restart needed
  } finally { s.server.closeAllConnections(); s.server.close() }
  const t = await start(T1)
  try { assert.equal((await call(t.port, '/boards', { host: PHONE, cookie: c })).status, 403) } finally { t.server.closeAllConnections(); t.server.close() } // no name stored: none taken
})

test('a new token stops the old cookie; a restart keeps the phone name', async () => {
  const s = await start(T1, PHONE)
  assert.equal((await call(s.port, '/boards', { cookie: `ovt=${T1}` })).status, 200)
  s.server.closeAllConnections(); s.server.close()
  const again = await serve({ dir: s.dir, requests: s.requests, tokenFile: s.tokenFile, token: T2, port: 0, every: 50 })
  const port = again.address().port
  try {
    assert.equal((await call(port, '/boards', { cookie: `ovt=${T1}` })).status, 401)
    assert.equal((await call(port, '/boards', { cookie: `ovt=${T2}` })).status, 200)
    assert.deepEqual(JSON.parse(readFileSync(s.tokenFile, 'utf8')), { port, token: T2, pid: process.pid, host: PHONE })
  } finally { again.closeAllConnections(); again.close() }
})

test('the README says the Mac must stay awake for the phone, and how', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.match(readme, /\/oversee phone/)
  assert.match(readme, /The Mac must stay awake/)
  assert.match(readme, /caffeinate -s/)
  assert.match(readme, /Energy/)
  assert.match(readme, /never a public tunnel/)
})
