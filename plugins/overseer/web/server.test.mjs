import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { get, request } from 'node:http'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

import { createServer } from 'node:http'
import { main, probe, serve } from './server.mjs'

// Every route asks for the board token's cookie (lot 68): these tests send it, as the page does once /?t= gave it.
const TOKEN = 'ab'.repeat(32)
const fetch = (url, o = {}) => globalThis.fetch(url, { ...o, headers: { cookie: `ovt=${TOKEN}`, ...o.headers } })

const wait = ms => new Promise(r => setTimeout(r, ms))

test('lists the boards, streams one per slug, keeps the last good board, 404s bad slugs, refuses another Host', async () => {
  const dir = mkdtempSync(`${tmpdir()}/ovw-`)
  const put = (slug, goal, at) => writeFileSync(`${dir}/${slug}.json`, JSON.stringify({ repo: `/${slug}`, goal, at }, null, 2))
  put('a', 'one', 1)
  put('b', 'bee', 2)
  const server = await serve({ dir, port: 0, every: 50, token: TOKEN })
  const base = `http://127.0.0.1:${server.address().port}`
  const json = async path => (await fetch(`${base}${path}`)).json()
  try {
    assert.deepEqual((await json('/boards')).map(b => b.slug), ['b', 'a'])
    assert.deepEqual((await json('/boards'))[1], { slug: 'a', repo: '/a', goal: 'one', at: 1, needs: 0, done: 0, total: 0, stale: true }) // lot 40: needs, done, total and stale per board
    assert.equal((await json('/board/a')).goal, 'one')
    assert.equal((await json('/board')).goal, 'bee') // no slug: the newest

    const res = await fetch(`${base}/events/a`)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    const event = async () => { let s = ''; while (!s.includes('\n\n')) s += (await reader.read()).value; return JSON.parse(s.replace(/^data: /, '')) }
    assert.equal((await event()).goal, 'one')
    writeFileSync(`${dir}/a.json`, '{"goal": "tw') // half written: ignored
    await wait(200)
    put('b', 'bee two', 3) // another board: /events/a stays deaf
    await wait(200)
    put('a', 'two', 4)
    assert.equal((await event()).goal, 'two')
    reader.cancel()

    put('c', 'later', 5) // written after start
    await wait(200)
    assert.deepEqual((await json('/boards')).map(b => b.slug), ['c', 'a', 'b'])
    assert.equal((await json('/board/c')).goal, 'later')
    const c = await fetch(`${base}/events/c`)
    const cr = c.body.pipeThrough(new TextDecoderStream()).getReader()
    assert.match((await cr.read()).value, /later/)
    cr.cancel()

    for (const path of ['/board/..%2Fx', '/board/A', '/events/Nope', '/board/zzz', '/events/zzz']) assert.equal((await fetch(`${base}${path}`)).status, 404, path)

    const status = await new Promise(r => get(`${base}/boards`, { headers: { host: 'evil.example' } }, x => r(x.statusCode)))
    assert.equal(status, 403)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('POST /answer (the queue) takes a same-origin JSON request, refuses another or no Origin, other content types, big or bad bodies', async () => {
  const dir = mkdtempSync(`${tmpdir()}/ovw-`), requests = mkdtempSync(`${tmpdir()}/ova-`)
  const server = await serve({ dir, requests, port: 0, every: 50, token: TOKEN })
  const port = server.address().port, base = `http://127.0.0.1:${port}`
  const ids = { slug: 'repo-x', id: 'sess-tu1', sessionId: '0123abcd-0123-0123-0123-0123456789ab' }
  const post = (body, headers = {}) => fetch(`${base}/answer`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const good = { ...ids, askId: 'tu1', label: 'A' }
  try {
    // fetch forbids setting Origin from a page, but Node's does not: that is what a hostile local client could send
    assert.equal((await post(good, { origin: 'http://evil.example' })).status, 403)
    assert.equal((await post(good, { origin: `http://127.0.0.1:${port + 1}` })).status, 403)
    assert.equal((await post(good, { origin: 'null' })).status, 403)
    const bare = await new Promise(r => { const q = request(`${base}/answer`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `ovt=${TOKEN}` } }, x => r(x.statusCode)); q.end(JSON.stringify(good)) })
    assert.equal(bare, 403) // no Origin
    assert.equal(existsSync(`${requests}/repo-x`), false)
    assert.equal((await post(good, { 'content-type': 'text/plain' })).status, 415)
    assert.equal((await post({ ...good, label: 'x'.repeat(5000) })).status, 413)
    assert.equal((await post('{nope')).status, 400)
    assert.equal((await post({ ...good, slug: '../x' })).status, 400)
    assert.equal((await post({ ...good, sessionId: 'nope' })).status, 400)
    assert.equal((await post({ ...good, label: '' })).status, 400)
    assert.equal((await post({ ...good, askId: 7 })).status, 400)
    assert.equal((await post(good)).status, 202)
    assert.equal((await post(good, { origin: `http://localhost:${port}` })).status, 202)
    const saved = JSON.parse(readFileSync(`${requests}/repo-x/${ids.id}.json`, 'utf8'))
    assert.deepEqual({ kind: saved.kind, id: saved.id, askId: saved.askId, label: saved.label }, { kind: 'answer', id: 'sess-tu1', askId: 'tu1', label: 'A' })
    assert.equal((await post({ ...good, label: 'B' })).status, 202) // a newer request replaces the older
    assert.equal(JSON.parse(readFileSync(`${requests}/repo-x/${ids.id}.json`, 'utf8')).label, 'B')
    // lot 54: a free text, with its lines, for the open question or for a session that asked in plain text
    assert.equal((await post({ ...ids, askId: 'tu1', text: 'Keep it\nbehind a flag' })).status, 202)
    assert.equal(JSON.parse(readFileSync(`${requests}/repo-x/${ids.id}.json`, 'utf8')).text, 'Keep it\nbehind a flag')
    assert.equal((await post({ ...ids, text: 'Yes, start it.' })).status, 202)
    assert.equal((await post({ ...ids, text: '' })).status, 400)
    assert.equal((await post({ ...ids })).status, 400) // neither a label nor a text
    const lot = action => fetch(`${base}/lot`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ slug: 'repo-x', id: `l-${action}`, lot: 2, action }) })
    for (const a of ['done', 'retry', 'drop', 'accept-departure', 'reviewed']) assert.equal((await lot(a)).status, 202, a)
    assert.equal((await lot('delete')).status, 400)
    const host = await new Promise(r => { const q = request(`${base}/answer`, { method: 'POST', headers: { host: 'evil.example', origin: base, 'content-type': 'application/json' } }, x => r(x.statusCode)); q.end(JSON.stringify(good)) })
    assert.equal(host, 403)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('GET /version: the mod version and the server\'s folder; index.html is read on each request', async () => {
  const dir = mkdtempSync(`${tmpdir()}/ovw-`)
  const server = await serve({ dir, port: 0, every: 50, token: TOKEN })
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const v = await (await fetch(`${base}/version`)).json()
    assert.equal(v.version, JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version)
    assert.equal(v.dir, new URL('.', import.meta.url).pathname.replace(/\/$/, ''))
    assert.equal(v.pid, process.pid)
    assert.deepEqual(await probe(server.address().port), v)
    assert.equal(await probe(1), undefined) // nothing there
    assert.match(await (await fetch(`${base}/`)).text(), /<html|<!doctype/i)
  } finally { server.closeAllConnections(); server.close() }
})

test('on EADDRINUSE: a second server probes /version, says who holds the port and exits 0; another program on it exits 1', async () => {
  const dir = mkdtempSync(`${tmpdir()}/ovw-`)
  const first = await serve({ dir, port: 0, every: 50, token: TOKEN })
  const port = first.address().port
  const said = []
  const code = process.exitCode
  try {
    assert.equal(await main(port, m => said.push(m), `${mkdtempSync(`${tmpdir()}/ovt-`)}/web.json`), undefined)
    assert.equal(process.exitCode, 0)
    assert.match(said[0], new RegExp(`already runs on http://127.0.0.1:${port} \\(\\d+\\.\\d+\\.\\d+, .*/overseer/web\\): nothing to do`))
  } finally { first.closeAllConnections(); first.close() }
  const other = createServer((_q, r) => r.end('not a board'))
  await new Promise(r => other.listen(0, '127.0.0.1', r))
  try {
    await main(other.address().port, m => said.push(m), `${mkdtempSync(`${tmpdir()}/ovt-`)}/web.json`)
    assert.equal(process.exitCode, 1)
    assert.match(said.at(-1), /is taken by another program/)
  } finally { other.close(); process.exitCode = code }
})

test('every write route takes a good request as a file, refuses another origin, a big body, and each bad field', async () => {
  const dir = mkdtempSync(`${tmpdir()}/ovw-`), requests = mkdtempSync(`${tmpdir()}/ovr-`)
  const token = 'ab'.repeat(32) // POST /gate also needs the board token (lot 48)
  const server = await serve({ dir, requests, token, port: 0, every: 50 })
  const base = `http://127.0.0.1:${server.address().port}`
  const u = '0123abcd-0123-0123-0123-0123456789ab'
  // kind -> [a good body, bad variants]
  const cases = {
    answer: [{ sessionId: u, askId: 'tu1', label: 'A' }, [{ sessionId: 'x' }, { label: '' }]],
    run: [{ paused: true }, [{ paused: 'yes' }, { paused: undefined }]],
    pass: [{}, []],
    lot: [{ lot: 3, action: 'done' }, [{ lot: 0 }, { action: 'burn' }, { lot: 1.5 }]],
    change: [{ lot: 3, text: 'rename it', file: 'a.ts', line: 4 }, [{ text: '' }, { text: 'x'.repeat(2001) }, { line: 'a' }, { lot: 'a' }]],
    gate: [{ session: u, plan: 'wf1', action: 'change', text: 'less' }, [{ session: 'x' }, { action: 'maybe' }, { text: undefined }, { plan: 7 }]],
    plan: [{ approve: [1, 2] }, [{ approve: [] }, { decline: [] }, { decline: ['a'] }, { decline: [1], approve: [2] }, { decline: [1], change: { lot: 1, text: 'x' } }, { approve: ['a'] }, { approve: [1], change: { lot: 1, text: 'x' } }, { approve: undefined, change: { lot: 1 } }, { approve: undefined }]],
  }
  const post = (kind, body, headers = {}) => fetch(`${base}/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie: `ovt=${token}`, ...headers }, body: JSON.stringify(body) })
  try {
    for (const [kind, [good, bads]] of Object.entries(cases)) {
      const body = { slug: 'repo-x', id: `id-${kind}`, ...good }
      assert.equal((await post(kind, body, { origin: 'http://evil.example' })).status, 403, kind)
      assert.equal(existsSync(`${requests}/repo-x/id-${kind}.json`), false, kind)
      assert.equal((await post(kind, { ...body, pad: 'x'.repeat(5000) })).status, 413, kind)
      assert.equal((await post(kind, { ...body, id: undefined })).status, 400, `${kind} no id`)
      assert.equal((await post(kind, { ...body, id: '../x' })).status, 400, `${kind} bad id`)
      assert.equal((await post(kind, { ...body, slug: undefined })).status, 400, `${kind} no slug`)
      for (const bad of bads) assert.equal((await post(kind, { ...body, ...bad })).status, 400, `${kind} ${JSON.stringify(bad)}`)
      assert.equal((await post(kind, body)).status, 202, kind)
      const saved = JSON.parse(readFileSync(`${requests}/repo-x/id-${kind}.json`, 'utf8'))
      assert.deepEqual({ ...saved, at: 0 }, { kind, id: `id-${kind}`, at: 0, ...good }, kind) // no slug in the file; only the kind's fields
    }
    // task 76: "Not now" is a request of its own: decline alone is good, empty or mixed is not
    assert.equal((await post('plan', { slug: 'repo-x', id: 'id-decline', decline: [3] })).status, 202)
    assert.deepEqual(JSON.parse(readFileSync(`${requests}/repo-x/id-decline.json`, 'utf8')).decline, [3])
    assert.equal((await post('plan', { slug: 'repo-x', id: 'id-decline-2', decline: [] })).status, 400)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('POST /gate needs the board token as a cookie: Host and Origin right but no cookie is a 401; /?t= sets it HttpOnly, SameSite=Strict', async () => {
  const dir = mkdtempSync(`${tmpdir()}/ovw-`), requests = mkdtempSync(`${tmpdir()}/ovr-`), tokenFile = `${mkdtempSync(`${tmpdir()}/ovt-`)}/web.json`
  const token = 'ab'.repeat(32)
  const server = await serve({ dir, requests, tokenFile, token, port: 0, every: 50 })
  const port = server.address().port, base = `http://127.0.0.1:${port}`
  const good = { slug: 'repo-x', id: 'req-0001', session: '0123abcd-0123-0123-0123-0123456789ab', plan: '0123456789abcdef', action: 'approve' }
  const post = (body, headers = {}) => fetch(`${base}/gate`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const cookie = { cookie: `ovt=${token}` }
  try {
    assert.equal((await post(good, { cookie: '' })).status, 401) // Host and Origin right, no cookie (lot 68: every route asks for it)
    assert.equal((await post(good, { cookie: `ovt=${'cd'.repeat(32)}` })).status, 401) // a wrong token
    assert.equal((await post(good, { cookie: 'ovt=ab' })).status, 401) // a short one
    assert.equal((await post(good, { ...cookie, origin: 'http://evil.example' })).status, 403) // the cookie, another origin
    assert.equal(existsSync(`${requests}/repo-x`), false)

    const saved = JSON.parse(readFileSync(tokenFile, 'utf8'))
    assert.deepEqual([saved.port, saved.token], [port, token])
    assert.equal(statSync(tokenFile).mode & 0o777, 0o600)

    const r = await fetch(`${base}/?t=${token}`, { redirect: 'manual' })
    assert.equal(r.status, 303)
    assert.equal(r.headers.get('location'), '/') // the token leaves the address bar
    assert.match(r.headers.get('set-cookie'), new RegExp(`^ovt=${token}; HttpOnly; SameSite=Strict; Path=/$`))
    assert.equal((await fetch(`${base}/?t=${'cd'.repeat(32)}`, { redirect: 'manual' })).status, 403)
    assert.equal((await fetch(`${base}/`)).headers.get('set-cookie'), null) // the page itself never hands it out

    assert.equal((await post(good, { ...cookie, 'content-type': 'text/plain' })).status, 415)
    assert.equal((await post({ ...good, action: 'change', text: 'x'.repeat(5000) }, cookie)).status, 413)
    for (const bad of [{ ...good, plan: '' }, { ...good, plan: 'x'.repeat(501) }, { ...good, action: 'merge' }, { ...good, action: 'change' }, { ...good, action: 'change', text: '  ' }, { ...good, id: '../../x' }, { ...good, slug: '../x' }, { ...good, session: 'x' }])
      assert.equal((await post(bad, cookie)).status, 400, JSON.stringify(bad))
    assert.equal((await post(good, cookie)).status, 202)
    assert.equal((await post({ ...good, id: 'req-0002', action: 'change', text: 'one agent less' }, cookie)).status, 202)
    const q1 = JSON.parse(readFileSync(`${requests}/repo-x/req-0001.json`, 'utf8'))
    assert.deepEqual({ ...q1, at: 0 }, { kind: 'gate', id: 'req-0001', session: good.session, plan: good.plan, action: 'approve', at: 0 })
    assert.equal(JSON.parse(readFileSync(`${requests}/repo-x/req-0002.json`, 'utf8')).text, 'one agent less')
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('POST /change: a running lot whose session the board does not watch gets a 409 and no file; a todo lot or a watched session is taken', async () => {
  const dir = mkdtempSync(`${tmpdir()}/ovw-`), requests = mkdtempSync(`${tmpdir()}/ovc-`)
  const board = { at: Date.now(), repo: '/r', goal: 'g', lots: [{ n: 1, status: 'running', session: 'S-ghost' }, { n: 2, status: 'todo' }, { n: 3, status: 'running', session: 'S-here' }], sessions: [{ sessionId: 'S-here' }], feed: [] }
  writeFileSync(`${dir}/repo-x.json`, JSON.stringify(board))
  const server = await serve({ dir, requests, port: 0, every: 20, token: TOKEN })
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (id, lot) => fetch(`${base}/change`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ slug: 'repo-x', id, lot, text: 'rename it' }) })
  try {
    await wait(120) // the board is read
    assert.equal((await post('c1', 1)).status, 409)
    assert.equal(existsSync(`${requests}/repo-x/c1.json`), false)
    assert.equal((await post('c2', 2)).status, 202)
    assert.equal((await post('c3', 3)).status, 202)
    assert.equal((await post('c4', 9)).status, 202) // an unknown lot is the overseer's to drop, with a reason
    assert.deepEqual(['c2', 'c3', 'c4'].map(id => existsSync(`${requests}/repo-x/${id}.json`)), [true, true, true])
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('/boards says per board how many needs, done lots and lots it has, and whether it is silent', async () => {
  const dir = mkdtempSync(`${tmpdir()}/ovw-`), now = Date.now()
  writeFileSync(`${dir}/fresh.json`, JSON.stringify({ repo: '/fresh', goal: 'g', at: now, needs: [{ id: 'a' }, { id: 'b' }], lots: [{ n: 1, status: 'done' }, { n: 2, status: 'running' }, { n: 3, status: 'done' }] }))
  writeFileSync(`${dir}/old.json`, JSON.stringify({ repo: '/old', goal: 'h', at: now - 11 * 60e3, lots: [] }))
  const server = await serve({ dir, port: 0, every: 50, token: TOKEN })
  try {
    const rows = await (await fetch(`http://127.0.0.1:${server.address().port}/boards`)).json()
    assert.deepEqual(rows.map(r => [r.slug, r.needs, r.done, r.total, r.stale]), [['fresh', 2, 2, 3, false], ['old', 0, 0, 0, true]])
  } finally { server.closeAllConnections(); server.close() }
})

test('the page and its own files are read on each request; every other path is a 404', async () => {
  const server = await serve({ dir: mkdtempSync(`${tmpdir()}/ovw-`), port: 0, every: 50, token: TOKEN })
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    for (const [path, type] of [['/', /text\/html/], ['/board.css', /text\/css/], ['/stages/workflow.js', /javascript/], ['/stages/changes.js', /javascript/], ['/stages/tests.js', /javascript/], ['/gittree.js', /javascript/]]) {
      const r = await fetch(base + path)
      assert.equal(r.status, 200, path); assert.match(r.headers.get('content-type'), type, path)
      assert.equal(r.headers.get('cache-control'), 'no-store', path)
    }
    assert.match(await (await fetch(`${base}/board.css`)).text(), /--ground:/)
    for (const path of ['/stages/x.js', '/stages/../server.mjs', '/server.mjs', '/CONTRACT.md', '/index.html', '/fixtures/live.ts', '/board.css.sha256', '/stages/']) assert.equal((await fetch(base + path)).status, 404, path)
    assert.match(await (await fetch(base)).text(), /^<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport"/)
  } finally { server.closeAllConnections(); server.close() }
})
