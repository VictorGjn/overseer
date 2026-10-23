import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { browserTest, launch } from './test/cdp.mjs'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { serve } from './server.mjs'
import { stub } from './test/stub.mjs'
import { boards } from './fixtures/make.mjs'

// The v3 page in a real Chrome (test/cdp.mjs) on the stub server: the frame, one test for each key of the CONTRACT.md KEYS table, one for each
// button with the exact POST body, the write states, the failure states, the boards, what an incoming board keeps, and the layout.
// The look against the mockup's references is in page.look.test.mjs. Fails where Chrome is missing, unless OVERSEER_NO_BROWSER=1.
const { skip } = browserTest()
const WEB = new URL('.', import.meta.url).pathname

let page
before(async () => { if (!skip) page = await launch() })
after(async () => { await page?.close() })

const fresh = (name, patch = {}) => ({ ...boards[name], at: Date.now(), nextPassAt: Date.now() + 150e3, ...patch })
const lotWith = (name, n, patch) => ({ lots: boards[name].lots.map(l => (l.n === n ? { ...l, ...patch } : l)) })
const FILES = [{ path: 'overseer/hooks/pane.tsx', add: 40, del: 9 }, { path: 'overseer/hooks/band.tsx', add: 5, del: 1 }]
// a page on its own stub: its own origin, so its own localStorage; setup runs before the page loads
async function open(name, { patch = {}, size = { width: 1280, height: 900 }, dark = false, hash = '', extra = {}, board } = {}) {
  const b = board ?? fresh(name, patch)
  const server = await stub({ root: WEB, boards: { 'repo-x': b, ...(extra.boards ?? {}) }, files: extra.files })
  await page.view({ ...size, dark })
  await page.goto('about:blank')
  await page.goto(`${server.url}/${hash ? `#${hash}` : ''}`)
  await page.waitFor(`document.querySelector('#ck-main .ck-mh, #ck-main .ck-empty') && ${board || name ? 'true' : 'true'}`)
  const done = () => server.close()
  return { server, close: done }
}
const key = async (k, mods) => { await page.press(k, mods); await page.wait(60) }
const state = () => page.evaluate(`(() => { const q = s => document.querySelector(s); const rev = !q('#view-review').hidden; return {
  view: rev ? 'review' : 'overview', lot: q('.ck-row[aria-current="true"]')?.dataset.n, tab: q('#ck-main [data-tab][aria-pressed="true"]')?.dataset.tab,
  listOff: q('#view-cockpit').classList.contains('list-off'), listBtn: q('#ck-lt').textContent, tree: q('#view-cockpit').classList.contains('gt-open') && !q('#ck-gtree').hidden,
  menu: !q('#pj-menu').hidden, menuFocus: !!document.activeElement?.closest('#pj-menu'), draft: document.activeElement?.id === 'cr-text',
  card: q('#z-cards .zcard')?.className.replace('zcard ', ''), pos: q('#z-pos').textContent, end: !q('#z-end').hidden, reply: !!q('#z-cards .zreply:not([hidden])'), file: q('#z-file')?.textContent,
  count: q('#ck-count').textContent } })()`)
const posts = s => s.posts.map(p => ({ path: p.path, body: { ...p.body, id: /^[A-Za-z0-9-]{1,64}$/.test(p.body.id ?? '') ? '·' : p.body.id } }))
const goReview = async hash => { await key('z'); await key('m') }

describe('the frame', { skip }, () => {
  test('doctype, charset and viewport come first; the sprite is the mockup\'s; board.css is linked; lean only', async () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8'), mock = readFileSync(new URL('./mockups/board-v3.html', import.meta.url), 'utf8')
    assert.match(html, /^<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">/)
    const symbols = t => Object.fromEntries([...t.matchAll(/<symbol id="(i-[a-z-]+)"[^]*?<\/symbol>/g)].map(m => [m[1], m[0]]))
    assert.deepEqual(symbols(html), symbols(mock))
    assert.ok(Object.keys(symbols(html)).length >= 17)
    assert.match(html, /<link rel="stylesheet" href="\/board\.css">/)
    const s = await open('live')
    try {
      assert.equal(await page.evaluate(`document.querySelectorAll('[id^="i-"]').length`), Object.keys(symbols(mock)).length)
      assert.equal(await page.evaluate(`document.getElementById('view-cockpit').classList.contains('lean')`), true)
      assert.equal(await page.evaluate(`!!document.querySelector('#view-board,#st-calm,#st-needs,#z-again,[data-dens],.proposal')`), false) // the Board view, Full density and the test controls are gone
      assert.deepEqual(page.errors, [])
      assert.deepEqual([...new Set(s.server.gets)].sort(), ['/board/repo-x', '/events/repo-x']) // the page reads the board and its stream
    } finally { s.close() }
  })
  test('the server and the overseer on different versions: a line says to restart it', async () => {
    const s = await open('live', { patch: { mod: { version: '0.2.6' } } }); try {
      await page.waitFor(`document.querySelector('#ck-main .ck-banner')`)
      assert.match(await page.evaluate(`document.querySelector('#ck-main .ck-banner').textContent`), /server 0\.2\.7, overseer 0\.2\.6: restart it/)
    } finally { s.close() }
  })
  test('a field the board does not carry says "Not exported yet"; no sample data of the mockup is on the page', async () => {
    const s = await open('old')
    try {
      const text = await page.evaluate(`document.body.innerText`)
      assert.match(text, /Not exported yet/)
      for (const sample of ['25 of 44 lots', '~40 min left', 'worker-bf', 'The band follows the mockup', 'game-3d', 'reliable signals and a low-cost run']) assert.ok(!text.includes(sample), sample)
    } finally { s.close() }
  })
})

const reviewTo = async re => { await key('z'); await key('m'); for (let i = 0; i < 8 && !re.test(await page.evaluate(`document.querySelector('#z-cards .zq')?.textContent ?? ''`)); i++) await key('ArrowRight') }
const FP = '5d7de04708ea8ed1' // the fingerprint the board shows with the plan: POST /gate carries it, never the name (lot 48)
const gateBoard = () => { const b = fresh('gate'); return { ...b, sessions: b.sessions.map(s => ({ ...s, stage: 'gate', question: undefined, ask: undefined, gate: { name: 'band-follows-mockup', fp: FP, agents: [{ label: 'think', model: 'opus' }, { label: 'build', model: 'sonnet' }, { label: 'test', model: 'haiku' }] } })) } }
const S27 = '00000000-0000-4000-8000-000000000027', S28 = '00000000-0000-4000-8000-000000000028'

describe('Overview keys', { skip }, () => {
  test('j and ↓ select the next lot', async () => {
    const s = await open('needs-you'); try {
      assert.equal((await state()).lot, '26')
      await key('j'); assert.equal((await state()).lot, '27')
      await key('ArrowDown'); assert.equal((await state()).lot, '28')
    } finally { s.close() }
  })
  test('k and ↑ select the previous lot, and wrap', async () => {
    const s = await open('needs-you'); try {
      await key('k'); assert.equal((await state()).lot, '28') // from the first, to the last
      await key('ArrowUp'); assert.equal((await state()).lot, '27')
    } finally { s.close() }
  })
  test('w, c and t open the Workflow, Changes and Tests stage', async () => {
    const s = await open('live'); try {
      await key('c'); assert.equal((await state()).tab, 'ch')
      await key('t'); assert.equal((await state()).tab, 'te')
      await key('w'); assert.equal((await state()).tab, 'wf')
    } finally { s.close() }
  })
  test('Enter opens the need of the lot in Review; a lot with no need does nothing', async () => {
    const s = await open('needs-you'); try {
      await key('Enter'); const r = await state(); assert.equal(r.view, 'review'); assert.match(r.card, /k-info/) // lot 26 is blocked
      await key('Escape'); await key('j'); await key('j') // lot 28: stuck, no card of its own on the lot line
      await key('Enter'); assert.equal((await state()).view, 'overview')
    } finally { s.close() }
  })
  test('[ folds the list and shows it again; the choice is kept', async () => {
    const s = await open('live'); try {
      await key('['); assert.deepEqual([(await state()).listOff, (await state()).listBtn], [true, 'Show the list'])
      await page.goto(`${s.server.url}/`); await page.waitFor(`document.querySelector('#ck-main .ck-mh')`) // reloaded: still folded
      assert.equal((await state()).listOff, true)
      await key('['); assert.deepEqual([(await state()).listOff, (await state()).listBtn], [false, 'Hide the list'])
    } finally { s.close() }
  })
  test('g opens the git tree, and closes it', async () => {
    const s = await open('live'); try {
      await key('g'); assert.equal((await state()).tree, true)
      await page.waitFor(`document.querySelectorAll('#ck-gtree circle.c').length === 20`) // gittree.js draws the rows of Board.graph (lot 43)
      await key('g'); assert.equal((await state()).tree, false)
    } finally { s.close() }
  })
  test('p opens the projects menu with the focus in it; Esc closes it', async () => {
    const s = await open('live', { extra: { boards: { other: fresh('calm') } } }); try {
      await key('p'); assert.deepEqual([(await state()).menu, (await state()).menuFocus], [true, true])
      assert.equal(await page.evaluate(`document.querySelectorAll('#pj-menu [data-pj]').length`), 2) // from GET /boards
      await key('Escape'); assert.equal((await state()).menu, false)
      assert.equal(await page.evaluate(`document.activeElement.id`), 'pj-btn')
    } finally { s.close() }
  })
  test('r opens the change request with the focus in its text box; Esc closes it', async () => {
    const s = await open('live'); try {
      await key('r'); const r = await state(); assert.deepEqual([r.tab, r.draft], ['ch', true])
      await key('Escape'); assert.equal((await state()).draft, false)
    } finally { s.close() }
  })
  test('z then m opens Review; m alone does nothing', async () => {
    const s = await open('needs-you'); try {
      await key('m'); assert.equal((await state()).view, 'overview')
      await key('z'); await key('m'); assert.equal((await state()).view, 'review')
    } finally { s.close() }
  })
  test('a key typed in a text box is not a shortcut', async () => {
    const s = await open('live'); try {
      await key('r'); await page.type('jk'); await key('j')
      assert.equal(await page.evaluate(`document.getElementById('cr-text').value`), 'jkj') // typed, not taken as a shortcut
      assert.equal((await state()).lot, '27')
    } finally { s.close() }
  })
  test('Enter and Space on a focused button, link or menu item act on it and nothing else', async () => {
    const s = await open('needs-you'); try {
      await page.evaluate(`document.getElementById('ck-lt').focus()`)
      await key('Enter'); assert.deepEqual([(await state()).listOff, (await state()).view], [true, 'overview'])
      await page.evaluate(`document.getElementById('ck-lt').focus()`)
      await key(' '); assert.equal((await state()).listOff, false)
      await page.evaluate(`document.querySelector('.ck-row[data-n="27"]').focus()`)
      await key('Enter'); assert.deepEqual([(await state()).lot, (await state()).view], ['27', 'overview']) // the row selects; Enter does not also open Review
    } finally { s.close() }
  })
})

describe('Review keys', { skip }, () => {
  test('Esc goes back to the view you came from', async () => {
    const s = await open('needs-you'); try {
      await goReview(); assert.equal((await state()).view, 'review')
      await key('Escape'); assert.equal((await state()).view, 'overview')
    } finally { s.close() }
  })
  test('j and → go to the next card, k and ← to the previous, as in the Overview', async () => {
    const s = await open('needs-you'); try {
      await goReview(); assert.match((await state()).card, /k-decision/)
      await key('j'); assert.match((await state()).card, /k-info/); assert.equal((await state()).pos, '2 of 4')
      await key('ArrowRight'); assert.equal((await state()).pos, '3 of 4')
      await key('k'); assert.equal((await state()).pos, '2 of 4')
      await key('ArrowLeft'); assert.equal((await state()).pos, '1 of 4')
    } finally { s.close() }
  })
  test(', and . change the file', async () => {
    const s = await open('needs-you', { patch: lotWith('needs-you', 27, { dirty: FILES }) }); try {
      await goReview(); assert.equal((await state()).file, '1')
      await key('.'); assert.equal((await state()).file, '2')
      await page.waitFor(`document.querySelector('#z-cards [data-file]:not([hidden]) .mono').textContent === 'overseer/hooks/band.tsx'`)
      await key(','); assert.equal((await state()).file, '1')
    } finally { s.close() }
  })
  test('Enter opens the reply box, and Enter with a text sends POST /answer', async () => {
    const s = await open('needs-you'); try {
      await goReview(); await key('Enter'); assert.equal((await state()).reply, true)
      await page.type('Keep it a view.'); await key('Enter')
      await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/answer', body: { slug: 'repo-x', id: '·', sessionId: S27, askId: 'ask-27', label: 'Keep it a view.' } }])
    } finally { s.close() }
  })
  test('⌘Enter sends the recommended answer', async () => {
    const s = await open('needs-you'); try {
      await goReview(); await key('Enter', ['meta'])
      await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/answer', body: { slug: 'repo-x', id: '·', sessionId: S27, askId: 'ask-27', label: 'view' } }])
    } finally { s.close() }
  })
  for (const [k, label] of [['1', 'view'], ['2', 'drawer']]) test(`${k} chooses option ${k}: POST /answer with its label`, async () => {
    const s = await open('needs-you'); try {
      await goReview(); await key(k)
      await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/answer', body: { slug: 'repo-x', id: '·', sessionId: S27, askId: 'ask-27', label } }])
    } finally { s.close() }
  })
  test('a approves a workflow: POST /gate approve', async () => {
    const s = await open('gate', { board: gateBoard() }); try {
      await goReview(); assert.match((await state()).card, /k-approval/); await key('a')
      await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/gate', body: { slug: 'repo-x', id: '·', session: S28, plan: FP, action: 'approve' } }])
    } finally { s.close() }
  })
  test('r rejects a workflow: POST /gate reject', async () => {
    const s = await open('gate', { board: gateBoard() }); try {
      await goReview(); await key('r')
      await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server).map(p => p.body.action), ['reject'])
    } finally { s.close() }
  })
  test('c asks for a change: the reply box opens, and its text goes to POST /gate change', async () => {
    const s = await open('gate', { board: gateBoard() }); try {
      await goReview(); await key('c'); assert.equal((await state()).reply, true)
      await page.type('Fewer steps.'); await key('Enter')
      await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/gate', body: { slug: 'repo-x', id: '·', session: S28, plan: FP, action: 'change', text: 'Fewer steps.' } }])
    } finally { s.close() }
  })
  test('a approves the proposed plan: POST /plan approve; c sends POST /plan change', async () => {
    const s = await open('planned'); try {
      await goReview(); await key('a'); await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/plan', body: { slug: 'repo-x', id: '·', approve: Array.from({ length: 15 }, (_, i) => 30 + i) } }])
      s.server.posts.length = 0
      await key('c'); await page.type('Split lot 40.'); await key('Enter'); await page.waitFor(`document.querySelectorAll('.w-state').length`)
      assert.deepEqual(posts(s.server), [{ path: '/plan', body: { slug: 'repo-x', id: '·', change: { lot: 30, text: 'Split lot 40.' } } }])
    } finally { s.close() }
  })
  test('e marks a blocked lot done: POST /lot', async () => {
    const s = await open('needs-you'); try {
      await reviewTo(/Unblock task 26/); await key('e')
      await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/lot', body: { slug: 'repo-x', id: '·', lot: 26, action: 'done' } }])
    } finally { s.close() }
  })
  test('y copies the command of the card', async () => {
    const s = await open('needs-you'); try {
      await goReview()
      await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve() } }, configurable: true })`)
      for (let i = 0; i < 6 && !(await page.evaluate(`!!document.querySelector('#z-cards [data-act="copy"]')`)); i++) await key('ArrowRight')
      await key('y'); await page.waitFor(`window.__copied === '/oversee run <points>'`)
      assert.match(await page.evaluate(`document.querySelector('#z-cards [data-act="copy"]').textContent`), /Copied/)
    } finally { s.close() }
  })
  test('a key with a modifier is not a shortcut', async () => {
    const s = await open('needs-you'); try {
      await goReview(); await key('1', ['ctrl']); await key('a', ['alt'])
      assert.deepEqual(posts(s.server), [])
    } finally { s.close() }
  })
})

const reqId = s => s.posts.at(-1).body.id
const sent = () => page.waitFor(`document.querySelector('.w-state')`)

describe('buttons: the exact POST body of each control', { skip }, () => {
  test('the live pill sends POST /run with the opposite of paused; the pass ring sends POST /pass', async () => {
    const s = await open('live'); try {
      await page.click('#ck-live'); await sent()
      assert.deepEqual(posts(s.server), [{ path: '/run', body: { slug: 'repo-x', id: '·', paused: true } }])
      s.server.posts.length = 0
      await page.click('#ck-pass'); await page.waitFor(`document.querySelector('#ck-pass .w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/pass', body: { slug: 'repo-x', id: '·' } }])
    } finally { s.close() }
    const p = await open('paused'); try {
      await page.click('#ck-live'); await sent()
      assert.deepEqual(posts(p.server).map(x => x.body.paused), [false])
    } finally { p.close() }
  })
  test('a decision option, "Write an answer" and its text: POST /answer with the label', async () => {
    const s = await open('needs-you'); try {
      await page.click('#ck-review'); await page.click('#z-cards [data-key="2"]'); await sent()
      assert.deepEqual(posts(s.server), [{ path: '/answer', body: { slug: 'repo-x', id: '·', sessionId: S27, askId: 'ask-27', label: 'drawer' } }])
    } finally { s.close() }
    const t = await open('needs-you'); try {
      await page.click('#ck-review'); await page.click('#z-cards [data-act="reply"]')
      await page.type('Neither.'); await key('Enter'); await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(t.server).map(p => p.body.label), ['Neither.'])
    } finally { t.close() }
  })
  test('the workflow approval: Approve, Change and Reject post to /gate', async () => {
    for (const [btn, action] of [['a', 'approve'], ['r', 'reject']]) {
      const s = await open('gate', { board: gateBoard() }); try {
        await page.click('#ck-review'); await page.click(`#z-cards [data-key="${btn}"]`); await sent()
        assert.deepEqual(posts(s.server), [{ path: '/gate', body: { slug: 'repo-x', id: '·', session: S28, plan: FP, action } }])
      } finally { s.close() }
    }
    const s = await open('gate', { board: gateBoard() }); try {
      await page.click('#ck-review'); await page.click('#z-cards [data-key="c"]'); await page.type('Smaller.'); await key('Enter'); await sent()
      assert.deepEqual(posts(s.server).map(p => [p.path, p.body.action, p.body.text]), [['/gate', 'change', 'Smaller.']])
    } finally { s.close() }
  })
  test('the plan card posts to /plan, a need card of a blocked lot to /lot', async () => {
    const s = await open('planned'); try {
      await page.click('#ck-review'); await page.click('#z-cards [data-key="a"]'); await sent()
      assert.deepEqual(posts(s.server).map(p => [p.path, Object.keys(p.body).sort().join()]), [['/plan', 'approve,id,slug']])
    } finally { s.close() }
    const t = await open('needs-you'); try {
      await reviewTo(/Unblock task 26/); await page.click('#z-cards [data-key="e"]'); await sent()
      assert.deepEqual(posts(t.server), [{ path: '/lot', body: { slug: 'repo-x', id: '·', lot: 26, action: 'done' } }])
    } finally { t.close() }
  })
  test('a change request: POST /change with the lot and the text, and the file when a changed file started it', async () => {
    const s = await open('live', { size: { width: 1600, height: 900 } }); try {
      await page.click('#cr-new, .hud-cr'); await page.type('Rename it.'); await page.click('#cr-form [type="submit"]'); await page.waitFor(`document.querySelector('#cr-form .w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/change', body: { slug: 'repo-x', id: '·', lot: 27, text: 'Rename it.' } }])
    } finally { s.close() }
    const t = await open('live', { size: { width: 1600, height: 900 } }); try {
      await page.click('.hud-files [data-cr]'); await page.type('Too long.'); await key('Enter', ['meta']); await page.waitFor(`document.querySelector('#cr-form .w-state')`)
      assert.deepEqual(posts(t.server), [{ path: '/change', body: { slug: 'repo-x', id: '·', lot: 27, text: 'Too long.', file: 'overseer/hooks/pane.tsx' } }])
    } finally { t.close() }
  })
})

describe('a write control says sent, then done or refused: <reason>; a card goes only on done', { skip }, () => {
  test('sent, then done from Board.requests: the card leaves', async () => {
    const s = await open('needs-you'); try {
      await page.click('#ck-review'); const before = (await state()).pos
      await page.click('#z-cards [data-key="1"]'); await sent()
      assert.equal(await page.evaluate(`document.querySelector('.w-state').textContent`), 'sent')
      assert.equal((await state()).pos, before); assert.match((await state()).card, /k-decision/) // not gone yet
      s.server.setBoard('repo-x', { ...fresh('needs-you'), requests: [{ id: reqId(s.server), kind: 'answer', state: 'done', at: Date.now() }] })
      await page.waitFor(`!document.querySelector('#z-cards .k-decision')`)
      assert.equal((await state()).pos, '1 of 3')
    } finally { s.close() }
  })
  test('refused: the overseer says why, and the card stays', async () => {
    const s = await open('needs-you'); try {
      await page.click('#ck-review'); await page.click('#z-cards [data-key="1"]'); await sent()
      s.server.setBoard('repo-x', { ...fresh('needs-you'), requests: [{ id: reqId(s.server), kind: 'answer', state: 'dropped', why: 'the question changed or was answered', at: Date.now() }] })
      await page.waitFor(`document.querySelector('.w-state.refused')`)
      assert.equal(await page.evaluate(`document.querySelector('.w-state.refused').firstChild.textContent`), 'refused: the question changed or was answered')
      assert.match((await state()).card, /k-decision/)
    } finally { s.close() }
  })
  test('task 76: a refused state has a × that clears it without sending again, and clears by itself when the same control sends again', async () => {
    const s = await open('needs-you'); try {
      await page.click('#ck-review'); await page.click('#z-cards [data-key="1"]'); await sent()
      const refuse = why => { s.server.setBoard('repo-x', { ...fresh('needs-you'), requests: [{ id: reqId(s.server), kind: 'answer', state: 'dropped', why, at: Date.now() }] }); return page.waitFor(`document.querySelector('.w-state.refused')`) }
      await refuse('no task 75 in the plan')
      const posts = s.server.posts.length
      await page.click('.w-state.refused .w-x')
      await page.waitFor(`!document.querySelector('[data-w] .w-state')`)
      assert.equal(s.server.posts.length, posts, 'the × clears the message and the control does not send')
      await page.click('#z-cards [data-key="1"]'); await page.waitFor(`document.querySelector('[data-w] .w-state')`); await refuse('the question changed')
      await page.click('#z-cards [data-key="1"]') // the same control sends again: the refusal goes at once
      await page.waitFor(`document.querySelector('[data-w] .w-state') && !document.querySelector('.w-state.refused')`)
      assert.equal(await page.evaluate(`document.querySelector('[data-w] .w-state').textContent`), 'sent')
    } finally { s.close() }
  })
  test('refused by the server: a 409 says its session is not watched; another code says the code', async () => {
    const board = fresh('live')
    const s = await stub({ root: WEB, boards: { 'repo-x': board }, statuses: { '/change': 409, '/pass': 403 } })
    await page.view({ width: 1280, height: 900 }); await page.goto('about:blank'); await page.goto(`${s.url}/`); await page.waitFor(`document.querySelector('#ck-main .ck-mh')`)
    try {
      await key('r'); await page.type('x'); await page.click('#cr-form [type="submit"]'); await page.waitFor(`document.querySelector('#cr-form .w-state.refused')`)
      assert.equal(await page.evaluate(`document.querySelector('#cr-form .w-state').firstChild.textContent`), 'refused: its session is not watched')
      await page.click('#ck-pass'); await page.waitFor(`document.querySelector('#ck-pass .w-state.refused')`)
      assert.equal(await page.evaluate(`document.querySelector('#ck-pass .w-state').firstChild.textContent`), 'refused: server answered 403')
    } finally { s.close() }
  })
  test('a change request sent and done: the form closes and the request shows in the list', async () => {
    const s = await open('live'); try {
      await key('r'); await page.type('Rename it.'); await page.click('#cr-form [type="submit"]'); await page.waitFor(`document.querySelector('#cr-form .w-state')`)
      const l = fresh('live'); l.lots = l.lots.map(x => (x.n === 27 ? { ...x, changes: [{ id: 'c1', text: 'Rename it.', at: Date.now(), state: 'sent' }] } : x))
      s.server.setBoard('repo-x', { ...l, requests: [{ id: reqId(s.server), kind: 'change', state: 'done', at: Date.now() }] })
      await page.waitFor(`!document.querySelector('#cr-form')`)
      assert.match(await page.evaluate(`document.querySelector('.cr-item').textContent`), /Rename it\./)
    } finally { s.close() }
  })
})

describe('the live pill and the failure states', { skip }, () => {
  test('live, paused, silent Xm, error, disconnected; each in the pill', async () => {
    const s = await open('live'); try {
      const pill = () => page.evaluate(`[document.getElementById('ck-livel').textContent, document.getElementById('ck-live').classList.contains('off')]`)
      assert.deepEqual(await pill(), ['live', false])
      s.server.setBoard('repo-x', fresh('live', { paused: true })); await page.waitFor(`document.getElementById('ck-livel').textContent === 'paused'`)
      s.server.setBoard('repo-x', fresh('live', { at: Date.now() - 12 * 60e3 })); await page.waitFor(`/^silent 12m/.test(document.getElementById('ck-livel').textContent)`)
      assert.deepEqual(await pill(), ['silent 12m', true])
      s.server.setBoard('repo-x', fresh('live', { error: { text: 'no PLAN.md at /r', at: Date.now(), source: 'plan' } })); await page.waitFor(`document.getElementById('ck-livel').textContent === 'error'`)
      assert.match(await page.evaluate(`document.querySelector('#ck-main .ck-banner').textContent`), /no PLAN\.md at \/r/)
      s.close(); await page.waitFor(`document.getElementById('ck-livel').textContent === 'disconnected'`, 8000)
      assert.equal(await page.evaluate(`document.getElementById('ck-live').disabled`), true) // no connection: no write
    } finally { s.close() }
  })
  test('a silent overseer is a need of its own, with the recovery', async () => {
    const s = await open('calm', { patch: { at: Date.now() - 12 * 60e3 } }); try {
      await key('z'); await key('m')
      assert.match(await page.evaluate(`document.querySelector('#z-cards .zq').textContent`), /The overseer is silent/)
    } finally { s.close() }
  })
  test('the ring follows nextPassAt: 2:30 of 3:00, passing says it is reading', async () => {
    const s = await open('live', { patch: { passing: false, passEvery: 180e3 } }); try {
      assert.match(await page.evaluate(`document.getElementById('ck-left').textContent`), /^2:(2[5-9]|30)$/)
      assert.equal(await page.evaluate(`document.getElementById('ck-arc').getAttribute('stroke-dasharray')`).then(x => Math.round(Number(x.split(' ')[0]) / 10)), 8) // about 83 of 100
      s.server.setBoard('repo-x', fresh('live', { passing: true })); await page.waitFor(`document.getElementById('ck-passl').textContent === 'reading the sessions…'`)
    } finally { s.close() }
  })
})

describe('boards: /boards, switching, a saved slug that is gone, a board with no v3 field', { skip }, () => {
  const other = () => fresh('calm', { repo: '/home/user/Repos/game-3d', goal: 'Ship the ships', at: Date.now() - 3 * 60e3 })
  const silent = () => fresh('planned', { repo: '/home/user/Repos/old-project', goal: 'Old', at: Date.now() - 20 * 60e3 })
  test('the menu lists each board with its needs, done of total lots; a silent board is grey', async () => {
    const s = await open('needs-you', { extra: { boards: { other: other(), silent: silent() } } }); try {
      await key('p')
      const rows = await page.evaluate(`[...document.querySelectorAll('#pj-menu [data-pj]')].map(b => [b.dataset.pj, b.getAttribute('aria-checked'), b.querySelector('.pj-n').textContent, b.querySelector('small').textContent, b.classList.contains('stale')])`)
      assert.deepEqual(rows, [['repo-x', 'true', '4', 'Ship the overseer 0.2.7 and the v3 board · 0 of 3 tasks', false], ['other', 'false', '0', 'Ship the ships · 3 of 5 tasks', false], ['silent', 'false', '0', 'Old · 0 of 15 tasks · silent', true]])
      const grey = await page.evaluate(`(() => { const probe = document.createElement('i'); probe.style.color = 'var(--ink-3)'; document.body.append(probe); const g = getComputedStyle(probe).color; probe.remove(); return [getComputedStyle(document.querySelector('#pj-menu .stale')).color === g, getComputedStyle(document.querySelector('#pj-menu [data-pj="other"]')).color === g] })()`)
      assert.deepEqual(grey, [true, false])
    } finally { s.close() }
  })
  test('switching closes the stream of the board and opens the next; every POST carries the slug shown', async () => {
    const s = await open('needs-you', { extra: { boards: { other: other() } } }); try {
      assert.deepEqual([s.server.streams('repo-x'), s.server.streams('other')], [1, 0])
      await key('p'); await page.click('#pj-menu [data-pj="other"]')
      await page.waitFor(`document.getElementById('pj-name').textContent === 'game-3d'`)
      assert.deepEqual([s.server.streams('repo-x'), s.server.streams('other')], [0, 1])
      await page.click('#ck-pass'); await page.waitFor(`document.querySelector('#ck-pass .w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/pass', body: { slug: 'other', id: '·' } }])
      await page.goto(`${s.server.url}/`); await page.waitFor(`document.getElementById('pj-name').textContent === 'game-3d'`) // the choice is kept
    } finally { s.close() }
  })
  test('a saved slug that is gone: the newest board opens', async () => {
    const s = await stub({ root: WEB, boards: { 'repo-x': fresh('needs-you'), other: other() } })
    await page.view({ width: 1280, height: 900 }); await page.goto('about:blank'); await page.goto(`${s.url}/`)
    try {
      await page.waitFor(`document.getElementById('pj-name').textContent === 'claude-mods'`)
      await page.evaluate(`localStorage.setItem('overseer.board', 'gone')`)
      await page.goto(`${s.url}/`); await page.waitFor(`document.querySelector('#ck-main .ck-mh')`)
      assert.equal(await page.evaluate(`document.getElementById('pj-name').textContent`), 'claude-mods') // repo-x is the newest
      assert.equal(await page.evaluate(`localStorage.getItem('overseer.board')`), 'repo-x')
    } finally { s.close() }
  })
  test('a board with no v3 field says "Not exported yet" and its write controls are off', async () => {
    const s = await open('old'); try {
      assert.equal(await page.evaluate(`document.getElementById('ck-live').disabled && document.getElementById('ck-pass').disabled`), true)
      assert.equal(await page.evaluate(`[...document.querySelectorAll('[data-w],#cr-new,.hud-cr')].every(b => b.disabled)`), true)
      assert.match(await page.evaluate(`document.querySelector('#ck-main .ck-body').textContent + document.querySelector('.lb').textContent`), /Not exported yet/)
      await page.click('#ck-pass'); assert.deepEqual(posts(s.server), [])
    } finally { s.close() }
  })
})

describe('what an incoming board keeps', { skip }, () => {
  test('the text and the caret of a change request, the open workflow steps and the scroll', async () => {
    const files = { '/stages/workflow.js': `export function render() { return '<details class="wstep" data-id="s1"><summary>One</summary>a</details><details class="wstep" data-id="s2"><summary>Two</summary>b</details>' }` }
    const s = await open('planned', { extra: { files } }); try {
      await key('w'); await page.waitFor(`document.querySelector('#ck-stage details')`)
      await page.click('#ck-stage details[data-id="s1"] summary'); await page.wait(60)
      await page.evaluate(`document.getElementById('ck-list').scrollTop = 100`)
      await key('r'); await page.type('Rename the file and keep the caret here.')
      await page.evaluate(`(() => { const t = document.getElementById('cr-text'); t.setSelectionRange(7, 14) })()`)
      await page.evaluate(`document.getElementById('ck-list').scrollTop = 100`)
      s.server.setBoard('repo-x', fresh('planned', { at: Date.now() + 1000, goal: 'A new goal' })) // the next board
      await page.waitFor(`document.getElementById('pj-goal').textContent === 'A new goal'`)
      assert.deepEqual(await page.evaluate(`(() => { const t = document.getElementById('cr-text'); return [t.value, t.selectionStart, t.selectionEnd, document.activeElement === t] })()`), ['Rename the file and keep the caret here.', 7, 14, true])
      assert.equal(await page.evaluate(`document.getElementById('ck-list').scrollTop`), 100)
      await page.evaluate(`document.getElementById('cr-text').blur()`)
      await key('w'); await page.waitFor(`document.querySelector('#ck-stage details')`)
      assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#ck-stage details')].map(d => d.open)`), [true, false])
    } finally { s.close() }
  })
})

describe('layout: folds, the HUD, captions, a need once, both themes, no side scroll at 390', { skip }, () => {
  const wide = (name = 'needs-you', o = {}) => open(name, { size: { width: 1600, height: 900 }, ...o })
  test('the list folds away by its button; the lot pane takes the width; the HUD stays', async () => {
    const s = await wide(); try {
      const w = () => page.evaluate(`[document.getElementById('ck-main').getBoundingClientRect().width, !!document.getElementById('ck-hud').offsetParent]`)
      const before = await w()
      await page.click('#ck-lt')
      const after = await w()
      assert.ok(after[0] > before[0] + 250, `${before[0]} -> ${after[0]}`)
      assert.deepEqual([before[1], after[1]], [true, true])
      assert.equal(await page.evaluate(`document.getElementById('ck-list').offsetParent`), null)
    } finally { s.close() }
  })
  test('Done is one folded line "Done · N tasks ▸"; opening it is kept', async () => {
    const s = await wide('calm'); try {
      const fold = () => page.evaluate(`[document.getElementById('ck-more').textContent, document.querySelectorAll('#ck-list .ck-row.small').length]`)
      assert.deepEqual(await fold(), ['Done3 tasks ▸', 0])
      await page.click('#ck-more'); assert.deepEqual(await fold(), ['Done3 tasks ▾', 3])
      await page.goto(`${s.server.url}/`); await page.waitFor(`document.getElementById('ck-more')`)
      assert.deepEqual(await fold(), ['Done3 tasks ▾', 3])
    } finally { s.close() }
  })
  test('the HUD shows above 1280px and the funnel captions only below; the HUD row of the open stage is there', async () => {
    const s = await open('live', { size: { width: 1280, height: 900 } }); try {
      const at = () => page.evaluate(`[!!document.getElementById('ck-hud').offsetParent, getComputedStyle(document.querySelector('.fun small')).display]`)
      assert.deepEqual(await at(), [false, 'block'])
      await page.view({ width: 1281, height: 900 }); await page.wait(100)
      assert.deepEqual(await at(), [true, 'none'])
      assert.ok(await page.evaluate(`!!document.querySelector('#ck-hud .hud-row[data-tab="wf"]')`))
    } finally { s.close() }
  })
  test('v1 features keep their place: what closing now would lose and the last decision, in the rail notes', async () => {
    const s = await open('needs-you'); try {
      const notes = await page.evaluate(`[document.getElementById('ck-notes').offsetParent !== null, document.getElementById('ck-notes').textContent]`)
      assert.equal(notes[0], true)
      assert.match(notes[1], /closing now loses 1 uncommitted file/); assert.match(notes[1], /decision: yes/)
    } finally { s.close() }
  })
  test('a need shows once in the lot pane, as one quiet line with "Review it ↵"', async () => {
    const s = await open('needs-you'); try {
      await key('j'); // lot 27 waits for an answer
      assert.equal(await page.evaluate(`document.querySelectorAll('#ck-main .ck-ask').length`), 1)
      assert.equal(await page.evaluate(`document.querySelectorAll('#ck-main .ck-banner').length`), 0)
      assert.match(await page.evaluate(`document.querySelector('#ck-main .ck-ask').textContent`), /This task asks you a question\.Review it/)
    } finally { s.close() }
  })
  test('both themes: the ground, the ink and the page both render; 390px has no side scroll in either view', async () => {
    const colors = []
    for (const dark of [false, true]) {
      const s = await open('needs-you', { dark, size: { width: 390, height: 800 } }); try {
        colors.push(await page.evaluate(`[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]`))
        assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`), true, `overview, dark ${dark}`)
        await key('z'); await key('m')
        assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `review, dark ${dark}`)
      } finally { s.close() }
    }
    assert.notDeepEqual(colors[0], colors[1])
    assert.deepEqual(page.errors, [])
  })
})

describe('on the real server.mjs', { skip }, () => {
  async function real(board) {
    const dir = mkdtempSync(`${tmpdir()}/pg-b-`), requests = mkdtempSync(`${tmpdir()}/pg-r-`)
    writeFileSync(`${dir}/repo-x.json`, JSON.stringify(board))
    const token = 'ef'.repeat(32) // every route asks for the board cookie (lot 68): the page logs in as /oversee show does
    const server = await serve({ dir, requests, token, port: 0, every: 30 })
    const url = `http://127.0.0.1:${server.address().port}`
    await page.view({ width: 1280, height: 900 }); await page.goto('about:blank'); await page.goto(`${url}/?t=${token}`)
    await page.waitFor(`document.querySelector('#ck-main .ck-mh')`)
    return { url, requests, close: () => { server.closeAllConnections(); server.close() } }
  }
  test('a control writes its request file: POST /pass makes requests/<slug>/<id>.json, and the page shows it sent', async () => {
    const s = await real(fresh('live')); try {
      await page.click('#ck-pass'); await page.waitFor(`document.querySelector('#ck-pass .w-state')`)
      const names = readdirSync(`${s.requests}/repo-x`)
      assert.equal(names.length, 1)
      assert.deepEqual(JSON.parse(readFileSync(`${s.requests}/repo-x/${names[0]}`, 'utf8')).kind, 'pass')
      assert.equal(await page.evaluate(`document.querySelector('#ck-pass .w-state').textContent`), 'sent')
    } finally { s.close() }
  })
})
