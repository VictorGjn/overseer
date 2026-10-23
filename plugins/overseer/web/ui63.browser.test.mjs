import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { after, before, describe, test } from 'node:test'
import { boards } from './fixtures/make.mjs'
import { serve } from './server.mjs'
import { browserTest, launch } from './test/cdp.mjs'
import { THEMES, WIDTHS } from './test/ref.mjs'
import { stub } from './test/stub.mjs'

// Task 63: the feed, the requests of the page, the stale board of the project menu, and a write control against the real server.
const { skip } = browserTest()
const WEB = new URL('.', import.meta.url).pathname
const fresh = (b = boards.live, o = {}) => ({ ...b, at: Date.now(), nextPassAt: Date.now() + 150e3, ...o })

let page
before(async () => { if (!skip) page = await launch() })
after(async () => { await page?.close() })
async function open(server, path = '/', width = 1600, dark = false) {
  await page.view({ width, height: 900, dark }); await page.goto('about:blank'); await page.goto(`${server.url}${path}`)
  await page.waitFor(`document.querySelector('#ck-main .ck-mh, #ck-main .ck-empty')`)
}

describe('the feed', { skip }, () => {
  test('10 lines at distinct times: the log is visible and its first line is the newest', async () => {
    const T = Date.now(), at = i => T - (i + 1) * 7 * 60e3
    const feed = [3, 9, 0, 5, 1, 7, 2, 8, 4, 6].map(i => ({ at: at(i), action: 'assign', label: `worker-${i}`, text: `task ${i}` })) // not in order
    const s = await stub({ root: WEB, boards: { 'repo-x': fresh(boards.live, { feed }) } })
    try {
      for (const width of [1280, 1600]) {
        await open(s, '/', width)
        const r = await page.evaluate(`(() => { const b = document.getElementById('ck-log').getBoundingClientRect(); const mono = [...document.querySelectorAll('.ck-log .mono')].map(e => e.textContent); return { w: b.width, h: b.height, mono } })()`)
        assert.ok(r.w > 0 && r.h > 0, `the log has a box at ${width}px`)
        const clock = await page.evaluate(`(() => { const d = new Date(${at(0)}); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') })()`)
        assert.equal(r.mono[0], clock) // the newest first
        assert.equal(r.mono.length, 6)
        assert.match(await page.evaluate(`document.querySelector('.ck-log span:nth-child(2)').textContent`), /worker-0/)
      }
    } finally { s.close() }
  })
})

describe('no request answers 404', { skip }, () => {
  test(`at ${WIDTHS.join(', ')} px in ${THEMES.join(' and ')}, with the project menu and the tree open`, async () => {
    const s = await stub({ root: WEB, boards: { 'repo-x': fresh(), 'repo-y': fresh(boards.calm, { repo: '/r/other' }) } })
    await page.goto('about:blank')
    await page.send('Network.enable')
    try {
      for (const theme of THEMES) for (const width of WIDTHS) {
        page.events.length = 0
        await open(s, '/', width, theme === 'dark')
        await page.press('g'); await page.wait(200); await page.press('g')
        await page.wait(250)
        const got = page.events.filter(e => e.method === 'Network.responseReceived').map(e => [e.params.response.status, e.params.response.url])
        assert.ok(got.length >= 5, `requests were seen at ${width} ${theme}`)
        assert.deepEqual(got.filter(([st]) => st === 404), [], `${width} ${theme}`)
      }
      assert.ok(s.seen.every(p => !p.startsWith('/favicon')), 'the page declares its icon: the browser does not ask for /favicon.ico')
    } finally { s.close() }
  })
})

describe('the project menu', { skip }, () => {
  test('a stale board is grey, a live one is not', async () => {
    const s = await stub({ root: WEB, boards: { 'repo-x': fresh(), 'repo-y': { ...boards.calm, repo: '/r/silent', at: Date.now() - 30 * 60e3 } } })
    try {
      await open(s)
      await page.click('#pj-btn'); await page.waitFor(`!document.getElementById('pj-menu').hidden`)
      const c = await page.evaluate(`(() => { const p = document.createElement('i'); p.style.color = 'var(--ink-3)'; document.body.append(p); const grey = getComputedStyle(p).color; p.remove(); const col = s => getComputedStyle(document.querySelector('#pj-menu button' + s)).color; return { grey, stale: col('.stale'), live: col(':not(.stale)') } })()`)
      assert.equal(c.stale, c.grey)
      assert.notEqual(c.live, c.grey)
    } finally { s.close() }
  })
})

describe('a write control against the real server.mjs', { skip }, () => {
  test('next pass: sent, then refused: <why>, then done', async () => {
    const dir = mkdtempSync(`${tmpdir()}/ov63-b-`), requests = mkdtempSync(`${tmpdir()}/ov63-r-`), tokenFile = `${mkdtempSync(`${tmpdir()}/ov63-t-`)}/web.json`, token = 'cd'.repeat(32)
    const put = o => writeFileSync(`${dir}/repo-x.json`, JSON.stringify(fresh(boards.live, o)))
    put({})
    const server = await serve({ dir, requests, tokenFile, token, port: 0, every: 50 })
    const url = `http://127.0.0.1:${server.address().port}`
    try {
      await open({ url }, `/?t=${token}`)
      const idOf = () => JSON.parse(readFileSync(`${requests}/repo-x/${readdirSync(`${requests}/repo-x`)[0]}`, 'utf8'))
      const state = () => page.evaluate(`document.querySelector('#ck-pass .w-state')?.textContent ?? ''`)
      await page.click('#ck-pass'); await page.waitFor(`document.querySelector('#ck-pass .w-state')`)
      const req = idOf()
      assert.equal(req.kind, 'pass'); assert.ok(req.id)
      assert.equal(await state(), 'sent')
      put({ requests: [{ id: req.id, kind: 'pass', state: 'dropped', why: 'x', at: Date.now() }] })
      await page.waitFor(`document.querySelector('#ck-pass .w-state')?.firstChild?.textContent === 'refused: x'`, 5000)
      // the same again, answered done: the state goes away
      await page.click('#ck-pass'); await page.waitFor(`document.querySelector('#ck-pass .w-state')?.textContent === 'sent'`)
      const second = readdirSync(`${requests}/repo-x`).map(f => JSON.parse(readFileSync(`${requests}/repo-x/${f}`, 'utf8'))).find(r => r.id !== req.id)
      put({ requests: [{ id: second.id, kind: 'pass', state: 'done', at: Date.now() }] })
      await page.waitFor(`!document.querySelector('#ck-pass .w-state')`, 5000)
      assert.deepEqual(page.errors, [])
    } finally { server.closeAllConnections(); server.close() }
  })
})
