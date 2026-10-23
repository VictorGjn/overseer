import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { after, before, describe, test } from 'node:test'
import { boards } from './fixtures/make.mjs'
import { serve } from './server.mjs'
import { browserTest, launch } from './test/cdp.mjs'

// Task 66: each open EventSource holds one of Chrome's 6 HTTP/1.1 connections per host:port. The page keeps no stream it does not show.
const { skip } = browserTest()

let page
before(async () => { if (!skip) page = await launch() })
after(async () => { await page?.close() })

// The real server on a temp dir, with a count of the /events streams still open and of the /board/repo-x reads.
async function real() {
  const d = mkdtempSync(`${tmpdir()}/ov66-`), dir = `${d}/boards`
  mkdirSync(dir)
  writeFileSync(`${dir}/repo-x.json`, JSON.stringify({ ...boards.live, at: Date.now() + 3600e3 }))
  const token = 'ab'.repeat(32) // lot 68: every route but /?t=<token> asks for the board cookie, which the first visit to `auth` sets
  const server = await serve({ dir, requests: `${d}/req`, tokenFile: `${d}/token.json`, token, port: 0, every: 50 })
  const st = { events: 0, board: 0 }
  server.on('request', req => {
    if (req.url.startsWith('/events')) { st.events++; req.on('close', () => st.events--) }
    if (req.url.startsWith('/board/repo-x')) st.board++
  })
  const url = `http://127.0.0.1:${server.address().port}/`
  return { url, auth: `${url}?t=${token}`, st, close: () => { server.closeAllConnections(); server.close() } }
}

describe('the event stream', { skip }, () => {
  test('one tab navigated 8 times holds at most 1 stream, and each navigation answers within 5 s', async () => {
    const s = await real()
    try {
      await page.goto(s.auth)
      for (let i = 1; i <= 8; i++) {
        const t = Date.now()
        await page.goto(s.url)
        assert.ok(Date.now() - t < 5000, `navigation ${i} took ${Date.now() - t} ms`)
        await page.waitFor(`document.querySelector('#ck-main .ck-mh')`)
        assert.ok(s.st.events <= 1, `navigation ${i}: ${s.st.events} streams open`)
      }
    } finally { await page.goto('about:blank'); s.close() }
  })

  test('7 tabs on one server all load their board', async () => {
    const s = await real()
    const ids = []
    try {
      await page.goto(s.auth)
      for (let i = 1; i < 7; i++) ids.push((await page.send('Target.createTarget', { url: s.url })).targetId)
      const end = Date.now() + 10000
      while (Date.now() < end && s.st.board < 7) await page.wait(50)
      assert.equal(s.st.board, 7, `${s.st.board} of 7 tabs fetched their board, ${s.st.events} streams open`)
    } finally {
      for (const targetId of ids) await page.send('Target.closeTarget', { targetId }).catch(() => {})
      await page.goto('about:blank'); s.close()
    }
  })
})
