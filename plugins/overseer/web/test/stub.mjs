// A stub board server for the browser tests: it serves one page (and the files next to it), answers the fixture's board at
// `/boards` and `/board/<slug>`, and records the body of each POST for the test to read. Stdlib only, 127.0.0.1.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }

// root: the folder the page and its files are in. boards: { slug: board } served as GET /boards (the list), /board/<slug> and /events/<slug>
// (a stream: the board as one event, then open). files: { '/path': text } answers instead of the folder. setBoard(slug, board) sends the next board to the pages that stream it.
export async function stub({ root, boards = {}, board, files = {}, statuses = {}, version = '0.2.7' } = {}) {
  if (board) boards = { 'repo-x': board, ...boards }
  const streams = new Set()
  const send = (res, b) => res.write(`data: ${JSON.stringify(b)}\n\n`)
  const rows = () => Object.entries(boards).map(([slug, b]) => ({ slug, repo: b.repo, goal: b.goal, at: b.at, needs: (b.needs ?? []).length, done: (b.lots ?? []).filter(l => l.status === 'done').length, total: (b.lots ?? []).length, stale: Date.now() - b.at > 10 * 60e3 })).sort((a, c) => c.at - a.at)
  const posts = [], gets = [], seen = [] // gets: the /board and /events paths asked for; seen: every GET, with its query
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (req.method === 'POST') {
      let body = ''
      req.on('data', d => { body += d })
      req.on('end', () => {
        let json; try { json = JSON.parse(body) } catch { json = body }
        posts.push({ path: url.pathname, body: json, host: req.headers.host, origin: req.headers.origin })
        res.writeHead(statuses[url.pathname] ?? 202).end() // statuses: { '/change': 409 } answers a path with another code
      })
      return
    }
    seen.push(url.pathname + url.search)
    if (url.pathname === '/version') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version, dir: root, pid: process.pid }))
    // lot 69: the page asks for its manifest (the install link) and its push key and hours on load: answered as the server does, with no push service
    if (url.pathname === '/manifest.webmanifest') return void res.writeHead(200, { 'content-type': 'application/manifest+json' }).end(JSON.stringify({ name: 'Overseer board', short_name: 'OVERSEER', start_url: '/', scope: '/', display: 'standalone', icons: [] }))
    if (url.pathname === '/push/key') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ key: '', hours: null }))
    if (url.pathname === '/boards') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rows()))
    const m = url.pathname.match(/^\/(board|events)\/([a-z0-9-]+)$/)
    if (m) {
      const b = boards[m[2]]
      gets.push(url.pathname)
      if (!b) return void res.writeHead(404).end()
      if (m[1] === 'board') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(b)) // the board once; /events is the stream
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      send(res, b); res.slug = m[2]; streams.add(res); res.on('close', () => streams.delete(res))
      return
    }
    if (url.pathname in files) return void res.writeHead(200, { 'content-type': TYPES[extname(url.pathname)] ?? 'text/plain' }).end(files[url.pathname]) // a test's own copy of a file
    try {
      const file = join(root, normalize(url.pathname === '/' ? '/index.html' : url.pathname))
      if (!file.startsWith(root)) throw new Error('outside')
      const data = readFileSync(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(data)
    } catch { res.writeHead(404).end('not found') }
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const { port } = server.address()
  return { url: `http://127.0.0.1:${port}`, posts, gets, seen, close: () => { server.closeAllConnections?.(); server.close() }, streams: slug => [...streams].filter(r => r.slug === slug).length, setBoard(slug, b) { boards[slug] = b; for (const r of streams) if (r.slug === slug) send(r, b) } }
}
