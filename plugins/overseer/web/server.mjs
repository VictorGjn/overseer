#!/usr/bin/env node
// The overseers' boards in a browser tab: serves index.html and streams each board of ~/.claude/overseer/boards/
// (one <slug>.json per repository, written by the overseer sessions after each pass) over Server-Sent Events. Node stdlib only.
// Read-only but for the POSTs of CONTRACT.md (/answer /run /pass /lot /change /gate /plan), which only write a request file
// (~/.claude/overseer/requests/<slug>/<id>.json): the overseer's lead session pulls it, checks it and acts; the mod never listens.
// POST /gate (approve, change or reject a session's workflow, lot 48) also needs the board token: made here at start,
// written 0600 to ~/.claude/overseer/web.json for /oversee show, which opens the browser on /?t=<token>; that page
// trades it for an HttpOnly, SameSite=Strict cookie and drops it from the address bar. The token is never printed.
// Every route but /?t=<token> and /version asks for that cookie (lot 68): the board can be reached from the phone through
// `tailscale serve` (tailnet only, never a public tunnel, never 0.0.0.0), and it can approve workflows. The Host and Origin
// checks accept 127.0.0.1, localhost and the one name /oversee phone stored in web.json (`host`, a *.ts.net name).
// The phone's notifications (lot 69): push.mjs holds the push, server.mjs the routes and the pusher's tick (every board, every scan).
// ponytail: any process of this user can read web.json, the same reach it has over the gate's own CLI: the lead's
// fingerprint check is the second lock.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { createServer, get } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { colours, icon, manifest, pusher, validHm, validSubscription } from './push.mjs'

// The push files (lot 69) sit next to the token file: push.json and push-keys.json. Without a token file (a test), nothing is written.
export function serve({ dir = `${homedir()}/.claude/overseer/boards`, requests = `${homedir()}/.claude/overseer/requests`, tokenFile = null, token = randomBytes(32).toString('hex'), port = 4318, host = '127.0.0.1', every = 1000, pushFile = tokenFile && join(dirname(tokenFile), 'push.json'), keysFile = tokenFile && join(dirname(tokenFile), 'push-keys.json'), now = () => Date.now(), pushInsecure = false, pushRetryMs } = {}) {
  // index.html is read on each request: a page edited in place is served at once (the server's own code needs a restart).
  const page = () => readFileSync(new URL('./index.html', import.meta.url))
  // What /version answers: the mod's version from its plugin.json, read once (the code this process runs), and where it runs.
  const me = { version: JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version, dir: new URL('.', import.meta.url).pathname.replace(/\/$/, ''), pid: process.pid }
  const boards = new Map() // slug -> { json, mtime, board }: the last good board; a half-written file keeps the previous one
  const clients = new Map() // response -> the slug it is pinned to
  // The phone's name (/oversee phone writes it into web.json): read on each request, so a phone on or off needs no restart.
  const phoneHost = () => { try { const h = JSON.parse(readFileSync(tokenFile, 'utf8')).host; return typeof h === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(h) ? h : undefined } catch { return undefined } }
  const push = pusher({ file: pushFile, keysFile, clock: now, insecure: pushInsecure, retryMs: pushRetryMs, subject: () => `https://${phoneHost() ?? 'localhost'}`, log: m => console.error(`overseer board: ${m}`) }) // lot 69: the phone's pushes
  const scan = () => {
    let names = []
    try { names = readdirSync(dir) } catch {}
    for (const name of names) {
      const slug = name.match(/^([a-z0-9-]+)\.json$/)?.[1]
      if (!slug) continue
      try {
        const mtime = statSync(`${dir}/${name}`).mtimeMs
        if (boards.get(slug)?.mtime === mtime) continue
        const board = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'))
        const json = JSON.stringify(board) // one line, as an SSE data field needs
        const changed = boards.get(slug)?.json !== json
        boards.set(slug, { json, mtime, board })
        if (changed) for (const [c, s] of clients) if (s === slug) c.write(`data: ${json}\n\n`)
      } catch {}
    }
    for (const [slug, e] of boards) { try { push.check(slug, e.board) } catch {} } // lot 69: a need that is new pushes once, on every tick (a snooze or a failed send is retried too)
  }
  scan()
  const timer = setInterval(scan, every)
  const beat = setInterval(() => { for (const c of clients.keys()) c.write(': beat\n\n') }, 15e3)
  const newest = () => [...boards].sort((a, b) => (b[1].board.at ?? 0) - (a[1].board.at ?? 0))

  // One handler per route, (req, res, match); the lots that add endpoints add a row.
  // Every write is a request file (~/.claude/overseer/requests/<slug>/<id>.json) that the overseer's lead session pulls: the server never acts.
  const str = (v, max = 2000) => typeof v === 'string' && v.length > 0 && v.length <= max
  const int = v => Number.isInteger(v) && v >= 1
  const uuid = v => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)
  const pick = (q, ...keys) => Object.fromEntries(keys.filter(k => q[k] !== undefined).map(k => [k, q[k]]))
  // kind -> the fields to keep, or undefined when the body is bad
  const KINDS = {
    // an option label for an open question, or a free text (lot 54): for the open question (askId), or for a session that asked in plain text
    answer: q => uuid(q.sessionId) && (str(q.askId) && str(q.label) || str(q.text) && (q.askId === undefined || str(q.askId))) ? pick(q, 'sessionId', 'askId', 'label', 'text') : undefined,
    run: q => typeof q.paused === 'boolean' ? pick(q, 'paused') : undefined,
    pass: () => ({}),
    lot: q => int(q.lot) && ['done', 'retry', 'drop', 'accept-departure', 'reviewed'].includes(q.action) ? pick(q, 'lot', 'action') : undefined,
    change: q => int(q.lot) && str(q.text) && (q.file === undefined || str(q.file, 500)) && (q.line === undefined || int(q.line)) ? pick(q, 'lot', 'text', 'file', 'line') : undefined,
    gate: q => uuid(q.session) && str(q.plan, 500) && ['approve', 'change', 'reject'].includes(q.action) && (q.action !== 'change' || (str(q.text) && q.text.trim())) ? pick(q, 'session', 'plan', 'action', 'text') : undefined,
    plan: q => { // exactly one of: approve (lot numbers), decline (lot numbers: "Not now", the task goes under « En attente »), change ({ lot, text })
      const list = k => Array.isArray(q[k]) && q[k].length > 0 && q[k].every(int)
      const given = ['approve', 'decline', 'change'].filter(k => q[k] !== undefined)
      if (given.length !== 1) return undefined
      if (given[0] === 'change') return q.change && int(q.change.lot) && str(q.change.text) ? { change: { lot: q.change.lot, text: q.change.text } } : undefined
      return list(given[0]) ? pick(q, given[0]) : undefined
    },
  }
  const hasToken = req => {
    const got = Buffer.from((req.headers.cookie ?? '').match(/(?:^|;\s*)ovt=([0-9a-f]+)/)?.[1] ?? '')
    return got.length === token.length && timingSafeEqual(got, Buffer.from(token))
  }
  // Every POST: from our own page's origin only, a JSON body, at most 4 KB. fields(q) says whether the body is valid (and what it keeps); act(q, fields) does it.
  function post(req, res, fields, act) {
    // A page on another origin can POST to localhost without reading the reply: only our own page's origin may.
    const port = server.address().port, phone = phoneHost()
    if (![`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(phone ? [`https://${phone}`] : [])].includes(req.headers.origin ?? '')) return void res.writeHead(403).end()
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return void res.writeHead(415).end()
    const chunks = []
    let size = 0
    req.on('data', c => {
      if ((size += c.length) > 4096) { if (!res.headersSent) res.writeHead(413, { connection: 'close' }).end(); return } // the rest is read and dropped
      chunks.push(c)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      let q
      try { q = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {}
      const ok = q && typeof q === 'object' && typeof q.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(q.id) ? fields(q) : undefined
      if (!ok) return void res.writeHead(400).end()
      act(q, ok)
    })
  }
  function request(kind, req, res) {
    post(req, res, q => (typeof q.slug === 'string' && /^[a-z0-9-]+$/.test(q.slug) ? KINDS[kind](q) : undefined), (q, fields) => {
      // A change to a running lot goes to its session: when the board does not watch that session, nothing can carry it (409).
      if (kind === 'change') {
        const b = boards.get(q.slug)?.board, l = b?.lots?.find(x => x.n === q.lot)
        if (l?.status === 'running' && !(b.sessions ?? []).some(s => s.sessionId === l.session)) return void res.writeHead(409).end()
      }
      mkdirSync(`${requests}/${q.slug}`, { recursive: true })
      writeFileSync(`${requests}/${q.slug}/${q.id}.json`, JSON.stringify({ kind, id: q.id, at: Date.now(), ...fields })) // one file per id: a newer request with the same id replaces the older
      res.writeHead(202).end()
    })
  }
  // lot 69: the phone's push routes. Each POST keeps what its check passes, and writes push.json through the pusher.
  const pushPost = (fields, act) => (req, res) => post(req, res, fields, (q, f) => { act(f); res.writeHead(202).end() })
  const SLUG = /^[a-z0-9-]+$/
  const SUB = pushPost(q => (validSubscription(q.subscription ?? {}, pushInsecure) ? { subscription: q.subscription } : undefined), f => push.subscribe(f.subscription))
  const HOURS = pushPost(q => (q.hours === null ? { hours: null } : validHm(q.hours?.from) && validHm(q.hours?.to) ? { hours: { from: q.hours.from, to: q.hours.to } } : undefined), f => push.schedule(f.hours))
  const SNOOZE = pushPost(q => (typeof q.slug === 'string' && SLUG.test(q.slug) && typeof q.need === 'string' && q.need.length > 0 && q.need.length <= 200 && Number.isInteger(q.until) ? { slug: q.slug, need: q.need, until: q.until } : undefined), f => push.snooze(f.slug, f.need, f.until))
  const ICON_SIZES = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 }
  const icons = new Map()
  const iconPng = (_req, res, m) => { const size = ICON_SIZES[m[1]]; if (!icons.has(size)) icons.set(size, icon(size)); res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }).end(icons.get(size)) }

  // The page's own files and nothing else: each is read on each request, so an edit is served at once. Anything else is a 404.
  const FILES = { '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'], '/board.css': ['board.css', 'text/css; charset=utf-8'], '/stages/workflow.js': ['stages/workflow.js', 'text/javascript; charset=utf-8'], '/stages/changes.js': ['stages/changes.js', 'text/javascript; charset=utf-8'], '/stages/tests.js': ['stages/tests.js', 'text/javascript; charset=utf-8'], '/gittree.js': ['gittree.js', 'text/javascript; charset=utf-8'] }
  function asset(req, res) {
    const [name, type] = FILES[req.url.split('?')[0]]
    try { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(readFileSync(new URL(`./${name}`, import.meta.url))) } catch { res.writeHead(404).end() }
  }
  // The page's two theme colours come from board.css, so the metas match the page's ground in each theme.
  function index(_req, res) { const c = colours(); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page().toString('utf8').replaceAll('__THEME_LIGHT__', c.ground.light).replaceAll('__THEME_DARK__', c.ground.dark)) }
  const webManifest = (_req, res) => res.writeHead(200, { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' }).end(JSON.stringify(manifest(token)))
  function version(_req, res) { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(me)) }
  const STALE_MS = 10 * 60e3 // hooks/board.ts: a board older than this is silent
  function list(_req, res) {
    // needs: what the board exported (the lead's needsYou, written with the board); done and total: the lots; stale: the board is silent
    const rows = newest().map(([slug, { board }]) => ({ slug, repo: board.repo, goal: board.goal, at: board.at, needs: Array.isArray(board.needs) ? board.needs.length : 0, done: (board.lots ?? []).filter(l => l.status === 'done').length, total: (board.lots ?? []).length, stale: Date.now() - board.at > STALE_MS }))
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(rows))
  }
  function stream(req, res, m) {
    const slug = m[2] ?? newest()[0]?.[0] // without a slug: the newest, once; an SSE stream stays pinned to it
    const entry = slug && boards.get(slug)
    if (!entry) return void res.writeHead(404).end()
    if (m[1] === 'board') return void res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(entry.json)
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(`data: ${entry.json}\n\n`)
    clients.set(res, slug)
    req.on('close', () => clients.delete(res))
  }
  // A file's diff, or a golden screen, on demand (lot 39): the board file stays small. Only what the board lists is read:
  // its lot, that lot's base and tip shas, a path in its files (or its dirty list), a worktree the board names. git runs
  // through execFile, no shell; its output is capped.
  const json = (res, code, body) => res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
  const SHA = /^[0-9a-f]{7,40}$/
  const git = (cwd, args) => new Promise(resolve => execFile('git', ['-C', cwd, ...args], { maxBuffer: 4 << 20, timeout: 10000 }, (err, out) => resolve(err ? undefined : out)))
  const lotOf = (m, url) => {
    const board = boards.get(m[1])?.board, q = new URL(url, 'http://x').searchParams
    const lot = board?.lots?.find(l => String(l.n) === q.get('lot'))
    return { board, lot, q }
  }
  async function diff(req, res, m) {
    const { board, lot, q } = lotOf(m, req.url)
    const path = q.get('file') ?? '', view = q.get('view') ?? 'branch'
    if (!board || !lot || !path || path.includes('..')) return void res.writeHead(404).end()
    let out
    if (view === 'branch') {
      if (!board.top || !SHA.test(lot.base ?? '') || !SHA.test(lot.tip ?? '') || !(lot.files ?? []).some(f => f[2] === path)) return void res.writeHead(404).end()
      out = await git(board.top, ['diff', `${lot.base}..${lot.tip}`, '--', path])
    } else if (view === 'worktree') {
      const wt = (board.worktrees ?? []).find(w => !w.isMain && w.branch && w.branch === lot.branch)
      if (!wt || !(lot.dirty ?? []).some(d => d.path === path)) return void res.writeHead(404).end()
      out = await git(wt.path, ['diff', 'HEAD', '--', path])
    } else return void res.writeHead(404).end()
    if (out === undefined) return void res.writeHead(404).end()
    json(res, 200, diffRows(out))
  }
  async function file(req, res, m) {
    const { board, lot, q } = lotOf(m, req.url)
    const path = q.get('path') ?? ''
    if (!board?.top || !lot || !/(^|\/)golden\/[^/]+$/.test(path) || path.includes('..') || !SHA.test(lot.tip ?? '') || !(lot.files ?? []).some(f => f[2] === path)) return void res.writeHead(404).end()
    const out = await git(board.top, ['show', `${lot.tip}:${path}`])
    if (out === undefined) return void res.writeHead(404).end()
    const lines = out.split('\n')
    json(res, 200, { text: lines.slice(0, CAP).join('\n'), cut: Math.max(0, lines.length - CAP) })
  }
  const ROUTES = [['GET', /^\/diff\/([a-z0-9-]+)\?[^#]*$/, diff], ['GET', /^\/file\/([a-z0-9-]+)\?[^#]*$/, file], ...Object.keys(KINDS).map(k => ['POST', new RegExp(`^/${k}$`), (req, res) => request(k, req, res)]), ['GET', /^\/$/, index], ...Object.keys(FILES).map(p => ['GET', new RegExp(`^${p.replace(/[./]/g, '\\$&')}(?:\\?.*)?$`), asset]), ['GET', /^\/boards$/, list], ['GET', /^\/version$/, version], ['GET', /^\/manifest\.webmanifest$/, webManifest], ['GET', /^\/(icon-192\.png|icon-512\.png|apple-touch-icon\.png)$/, iconPng], ['GET', /^\/push\/key$/, (_req, res) => json(res, 200, { key: push.publicKey(), hours: push.state.hours })], ['POST', /^\/push\/subscribe$/, SUB], ['POST', /^\/push\/schedule$/, HOURS], ['POST', /^\/push\/snooze$/, SNOOZE], ['GET', /^\/(board|events)(?:\/([a-z0-9-]+))?$/, stream]]

  const server = createServer((req, res) => {
    // DNS rebinding: a page on another name that resolves to 127.0.0.1 must not read the board.
    const name = (req.headers.host ?? '').replace(/:\d+$/, ''), phone = phoneHost()
    if (name !== 'localhost' && name !== '127.0.0.1' && name !== phone) return void res.writeHead(403).end()
    const t = req.method === 'GET' ? req.url.match(/^\/\?t=([0-9a-f]+)$/)?.[1] : undefined
    if (t !== undefined) {
      // The URL /oversee show opens (or the phone's QR code): the token becomes the cookie, and the address bar forgets it.
      if (t.length !== token.length || !timingSafeEqual(Buffer.from(t), Buffer.from(token))) return void res.writeHead(403).end()
      return void res.writeHead(303, { location: '/', 'set-cookie': `ovt=${token}; HttpOnly; SameSite=Strict; Path=/${name === phone ? '; Secure' : ''}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end()
    }
    if (!(req.method === 'GET' && /^\/version$/.test(req.url)) && !hasToken(req)) return void res.writeHead(401).end() // every route asks for the board token
    for (const [method, re, run] of ROUTES) {
      const m = req.method === method && req.url.match(re)
      if (m) return void run(req, res, m)
    }
    res.writeHead(404).end()
  })
  server.on('close', () => { clearInterval(timer); clearInterval(beat) })
  return new Promise((resolve, reject) => {
    server.once('error', err => { clearInterval(timer); clearInterval(beat); reject(err) })
    server.listen(port, host, () => {
      if (tokenFile) { // for /oversee show only: 0600, never on stdout
        mkdirSync(dirname(tokenFile), { recursive: true })
        let host
        try { host = JSON.parse(readFileSync(tokenFile, 'utf8')).host } catch {}
        writeFileSync(tokenFile, JSON.stringify({ port: server.address().port, token, pid: process.pid, ...(host ? { host } : {}) }), { mode: 0o600 }) // a restart keeps the phone's name
        chmodSync(tokenFile, 0o600)
      }
      resolve(server)
    })
  })
}

// A unified diff as rows [kind, line, text]: kind '@' a hunk head (line: where it starts in the new file), '+' added and
// ' ' kept (line: in the new file), '-' removed (line: in the old file). The file headers are dropped. At most CAP rows;
// cut: how many were dropped.
const CAP = 400
export function diffRows(out) {
  const rows = []
  let a = 0, b = 0, n = 0
  for (const t of out.split('\n')) {
    const h = t.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (h) { a = Number(h[1]); b = Number(h[2]); n++; if (rows.length < CAP) rows.push(['@', b, t]); continue }
    if (!a && !b) continue // before the first hunk: diff --git, index, ---, +++
    const k = t[0]
    if (k !== '+' && k !== '-' && k !== ' ') continue // "\ No newline at end of file", the last empty line
    n++
    if (rows.length < CAP) rows.push([k, k === '-' ? a : b, t.slice(1)])
    if (k !== '+') a++
    if (k !== '-') b++
  }
  return { rows, cut: n - rows.length }
}

// What answers /version on a port: { version, dir, pid } of an overseer board, else undefined.
export function probe(port, host = '127.0.0.1', timeoutMs = 2000) {
  return new Promise(resolve => {
    const q = get({ host, port, path: '/version', timeout: timeoutMs }, r => {
      let s = ''
      r.on('data', d => { s += d })
      r.on('end', () => { try { const v = JSON.parse(s); resolve(typeof v.version === 'string' ? v : undefined) } catch { resolve(undefined) } })
    })
    q.on('timeout', () => q.destroy())
    q.on('error', () => resolve(undefined))
  })
}

// Started twice (by hand, or by an overseer session after each pass): the port is taken, so this one says by whom and
// exits 0. Any other error exits 1.
// tokenFile: where the board token goes; OVERSEER_WEB_TOKEN_FILE sets it for a detached start (the tests', so none writes the real one).
export async function main(port = Number(process.env.PORT) || 4318, log = console.log, tokenFile = process.env.OVERSEER_WEB_TOKEN_FILE || `${homedir()}/.claude/overseer/web.json`) {
  try {
    const s = await serve({ port, tokenFile })
    log(`overseer board on http://127.0.0.1:${s.address().port}`)
    return s
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') { log(`overseer board: ${err?.message ?? err}`); process.exitCode = 1; return undefined }
    const v = await probe(port)
    log(v ? `overseer board already runs on http://127.0.0.1:${port} (${v.version}, ${v.dir}): nothing to do` : `overseer board: port ${port} is taken by another program`)
    process.exitCode = v ? 0 : 1
    return undefined
  }
}

if (import.meta.main) await main()
