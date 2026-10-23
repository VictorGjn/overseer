import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { browserTest, launch } from './test/cdp.mjs'
import { stub } from './test/stub.mjs'
import { boards } from './fixtures/make.mjs'

// Lot 67: the board at phone size (mockups/phone: Main = Needs, NeedCard, GateCard, Tasks, TaskDetail, Activity), on the
// harness of lot 50, at 393 × 659 and 734 × 343 (a phone held sideways), light and dark. Fails where Chrome is missing,
// unless OVERSEER_NO_BROWSER=1.
const { skip } = browserTest()
const WEB = new URL('.', import.meta.url).pathname
const SIZES = [[393, 659, false], [393, 659, true], [734, 343, false], [734, 343, true]]
let page
before(async () => { if (!skip) page = await launch() })
after(async () => { await page?.close() })

const fresh = (name, patch = {}) => ({ ...boards[name], at: Date.now(), nextPassAt: Date.now() + 150e3, ...patch })
async function open(board, [width, height, dark], { files, setup, ready } = {}) {
  const server = await stub({ root: WEB, boards: { 'repo-x': board }, files })
  await page.view({ width, height, dark })
  await page.goto('about:blank')
  await page.goto(`${server.url}/`)
  if (setup) { await page.evaluate(setup); await page.goto(`${server.url}/`) }
  await page.waitFor(ready ?? `document.querySelector('#phone .pp-top') && document.querySelector('#phone main')?.textContent.length > 0 && !document.querySelector('#phone .pp-empty')?.textContent.includes('Waiting')`)
  await page.wait(150)
  return { server, close: () => server.close() }
}
const q = (sel, expr) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (${expr}) : null })()`)
const rect = sel => q(sel, '(r => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }))(e.getBoundingClientRect())')
// the words on screen, one space between text nodes (spans sit side by side with a gap, not a space)
const words = 'e => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), out = []; while (w.nextNode()) { const t = w.currentNode.data.replace(/\\s+/g, " ").trim(); if (t) out.push(t) } return out.join(" ") }'
const text = sel => q(sel, `(${words})(e)`)
const tap = async sel => { await page.click(sel); await page.wait(120) }
async function drag(sel, dx) { // a mouse drag: the page sees pointer events, as from a finger
  const { x, y } = await page.center(sel)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 6; i++) await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * i / 6, y, button: 'left', buttons: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y, button: 'left', clickCount: 1 })
  await page.wait(150)
}
// a finger: touch events through the browser's own input, so touch-action and pans apply (a mouse drag ignores them)
async function swipe(sel, dx) {
  const { x, y } = await page.center(sel)
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  try {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 8; i++) { await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y }] }); await page.wait(16) }
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.wait(150)
  } finally { await page.send('Emulation.setTouchEmulationEnabled', { enabled: false }) }
}
// every control of the phone layer that is on screen, with its size
const controls = () => page.evaluate(`[...document.querySelectorAll('#phone button, #phone a, #phone summary, #phone input, #phone textarea')].filter(e => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden').map(e => { const r = e.getBoundingClientRect(); return { what: (e.className || e.tagName) + ' ' + e.textContent.trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) } })`)
const small = cs => cs.filter(c => c.w < 44 || c.h < 44)
const noSideScroll = async () => assert.ok(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no side scroll of the page')
const GATE = { name: 'band-follows-mockup', fp: '5d7de04708ea8ed1', agents: [{ label: 'think', model: 'opus' }, { label: 'build', model: 'sonnet' }, { label: 'test', model: 'haiku' }] }
const withGate = () => { const b = fresh('needs-you'); return { ...b, sessions: [...b.sessions, { sessionId: '00000000-0000-4000-8000-000000000099', label: 'worker-gg', stage: 'gate', lot: 26, since: Date.now() - 60e3, lastText: '', tries: 0, gate: GATE }] } }

for (const size of SIZES) {
  const tag = `${size[0]}×${size[1]} ${size[2] ? 'dark' : 'light'}`
  describe(`the phone, ${tag}`, { skip }, () => {
    test('one scroll area: the document scrolls, no inner area does; the last task comes into view', async () => {
      const s = await open(fresh('planned', { proposed: [] }), size); try {
        await tap('#phone [data-pp-tab="tasks"]')
        await tap('#phone [data-pp-fold="next"] > summary')
        await page.evaluate('scrollTo(0, document.documentElement.scrollHeight)'); await page.wait(100)
        const last = await rect('#phone [data-pp-fold="next"] .pp-mini:last-of-type')
        const tabs = await rect('#phone .pp-tabs')
        assert.ok(last.top >= 56 && last.bottom <= tabs.top + 1, `the last task is in view: ${JSON.stringify(last)}`)
        assert.ok(await page.evaluate('scrollY > 0'), 'the document scrolled')
        assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#phone *')].filter(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1).map(e => e.className)`), [])
        await noSideScroll()
        assert.deepEqual(page.errors, [])
      } finally { s.close() }
    })

    test('a sticky one-row bar of 56 px at most: the project opens the menu; a tap on the bar opens sessions and budget', async () => {
      const s = await open(fresh('live'), size); try {
        const bar = await rect('#phone .pp-top')
        assert.ok(bar.height <= 56 && bar.top === 0, JSON.stringify(bar))
        assert.equal(await q('#phone .pp-top', 'getComputedStyle(e).position'), 'sticky')
        assert.match(await text('#phone .pp-pj'), /^claude-mods/)
        assert.match(await text('#phone .pp-live'), /live/)
        assert.ok(await q('#phone .pp-live .arc', 'e.getAttribute("stroke-dasharray")'), 'the pass ring')
        await tap('#phone [data-pp="menu"]')
        assert.ok(await q('#phone .pp-sheet[role="menu"]', 'true'), 'the project menu')
        await tap('#phone .pp-live')
        assert.match(await text('#phone .pp-sheet'), /Sessions · 1 of 1 busy.*Budget.*2\.9 of 15/)
        await page.evaluate('scrollTo(0, 400)')
        assert.equal((await rect('#phone .pp-top')).top, 0) // it stays
      } finally { s.close() }
    })

    test('a bottom tab bar: Needs (with its count), Tasks, Activity, each 44 px or more, over the home indicator; it opens on Needs, or on Tasks when nothing needs you', async () => {
      const s = await open(fresh('needs-you'), size); try {
        assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#phone .pp-tab')].map(${words})`), ['4 Needs', 'Tasks', 'Activity'])
        assert.equal(await q('#phone .pp-tab[aria-current="page"]', 'e.dataset.ppTab'), 'needs')
        for (const h of await page.evaluate(`[...document.querySelectorAll('#phone .pp-tab')].map(t => t.getBoundingClientRect().height)`)) assert.ok(h >= 44, `tab height ${h}`)
        assert.equal(Math.round((await rect('#phone .pp-tabs')).bottom), size[1]) // at the bottom of the screen
        assert.ok(await page.evaluate(`[...document.styleSheets].flatMap(x => { try { return [...x.cssRules] } catch { return [] } }).some(r => r.selectorText === '.pp-tabs' && r.cssText.includes('env(safe-area-inset-bottom)'))`), 'above the home indicator')
        await tap('#phone [data-pp-tab="activity"]')
        const feed = boards['needs-you'].feed ?? []
        if (feed.length) assert.ok((await text('#phone main')).includes(feed[0].label))
        assert.match(await text('#phone main'), /Activity.*All.*Done and verdicts.*Your actions/)
      } finally { s.close() }
      const t = await open(fresh('calm'), size); try {
        assert.equal(await q('#phone .pp-tab[aria-current="page"]', 'e.dataset.ppTab'), 'tasks')
      } finally { t.close() }
    })

    test('a swipe to the left snoozes a need until 1 h, this evening or tomorrow morning; it leaves the list and the count, Undo brings it back; when its time comes it shows "snoozed"', async () => {
      const s = await open(fresh('needs-you'), size); try {
        const first = await q('#phone .pp-sw', 'e.dataset.need')
        await drag(`#phone .pp-sw[data-need="${first}"] .pp-row`, -180)
        assert.ok(await q(`#phone .pp-sw[data-need="${first}"]`, 'e.classList.contains("open")'), 'the snooze times show')
        assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#phone .pp-sw.open .pp-snz button')].map(${words})`).then(x => x.map(t => t.replace(/^\d\d:\d\d evening$/, 'HH:MM evening'))), ['1 h snooze', 'HH:MM evening', '9:00 tomorrow'])
        await tap(`#phone .pp-sw[data-need="${first}"] .pp-snz button:first-child`)
        assert.equal(await q(`#phone .pp-sw[data-need="${first}"]`, 'true'), null)
        assert.equal(await text('#phone .pp-badge'), '3')
        assert.match(await text('#phone .pp-toast'), /^Snoozed until \d\d:\d\d Undo$/)
        assert.match(await text('#phone .pp-later'), /Snoozed · 1 · back at \d\d:\d\d/)
        assert.ok(await page.evaluate(`JSON.parse(localStorage.getItem('overseer.snooze'))[${JSON.stringify(first)}] > Date.now()`))
        await tap('#phone [data-pp="undo"]')
        assert.ok(await q(`#phone .pp-sw[data-need="${first}"]`, 'true'))
        assert.equal(await text('#phone .pp-badge'), '4')
        await tap(`#phone .pp-sw[data-need="${first}"] .pp-row`) // a tap opens the card
        assert.ok(await q('#phone [data-pp-card]', 'true'))
      } finally { s.close() }
      const t = await open(fresh('needs-you'), size, { setup: `localStorage.setItem('overseer.snooze', JSON.stringify({ [${JSON.stringify(boards['needs-you'].sessions.find(x => x.stage === 'waits')?.sessionId ?? 'x')}]: Date.now() - 1000 }))` }); try {
        assert.match(await text('#phone .pp-list'), /snoozed/) // its time came: back, tagged
      } finally { t.close() }
    })

    test('Tasks: Now (title, session, stage, elapsed against pace, "N of M met"), then Next folded with its count, then Done folded', async () => {
      const s = await open(fresh('live'), size); try {
        await tap('#phone [data-pp-tab="tasks"]')
        const order = await page.evaluate(`[...document.querySelectorAll('#phone main .pp-sec, #phone main .pp-fold > summary')].map(${words})`)
        assert.deepEqual(order, ['Now 1', 'Next 1', 'Done 0'])
        const card = await text('#phone .pp-card')
        assert.match(card, /27 The terminal pane follows the mockup/)
        assert.match(card, /worker-dd work \S+ of 1h10 2 of 4 met/)
        assert.ok(await q('#phone .pp-card .pp-bar b', 'true'), 'the median mark')
        assert.equal(await q('#phone [data-pp-fold="next"]', 'e.open'), false)
        assert.equal(await q('#phone [data-pp-fold="done"]', 'e.open'), false)
      } finally { s.close() }
    })

    test('a tap on a task opens it full screen: brief, criteria, Workflow / Changes / Tests; Back and the back gesture close it; no HUD column', async () => {
      const s = await open(fresh('live'), size); try {
        await tap('#phone [data-pp-tab="tasks"]')
        await tap('#phone [data-pp-task="27"]')
        assert.match(await text('#phone .pp-t'), /The terminal pane follows the mockup/)
        assert.equal(await page.evaluate(`document.querySelectorAll('#phone .pp-k').length`), 4) // the HUD's useful rows, in the header
        assert.ok(await q('#phone .pp-crit li', 'true'), 'the criteria')
        assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#phone .pp-tx')].map(b => b.textContent)`), ['Workflow', 'Changes', 'Tests'])
        await tap('#phone [data-pp-stage="te"]')
        assert.equal(await q('#phone [data-pp-stage="te"]', 'e.getAttribute("aria-pressed")'), 'true')
        assert.equal(await q('#ck-hud', 'e.offsetParent'), null)
        await page.evaluate('history.back()'); await page.wait(200) // the back gesture
        assert.equal(await q('#phone .pp-t', 'true'), null)
        await tap('#phone [data-pp-task="27"]')
        await tap('#phone [data-pp="back"]')
        assert.equal(await q('#phone .pp-t', 'true'), null)
      } finally { s.close() }
    })

    test('hidden on the phone: the git tree, the rail, the notes (one line "2 notes" opens them), every key chip', async () => {
      const b = { ...fresh('live'), branches: [{ name: 'lot/27-pane', ahead: 2, behind: 0, files: 4, overlaps: [], merge: { order: 1, conflicts: [] } }], decisions: [{ at: '2026-10-23 08:00', lot: 'task 27', question: 'q?', answer: 'Keep it' }] }
      const s = await open(b, size); try {
        for (const sel of ['#ck-gtree', '#ck-rail', '#ck-notes', '.ck-rail']) assert.equal(await q(sel, 'e.offsetParent'), null, sel)
        assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('kbd')].filter(k => k.offsetParent !== null).length`), 0)
        await tap('#phone [data-pp-tab="tasks"]')
        assert.equal(await text('#phone [data-pp="notes"]'), '2 notes')
        await tap('#phone [data-pp="notes"]')
        assert.match(await text('#phone .pp-sheet'), /no conflict.*decision: Keep it/)
      } finally { s.close() }
    })

    test('the card view: one card a screen, a swipe moves between needs, the options and the reply stay at the bottom; sent, then done, then the next card', async () => {
      const b = fresh('needs-you'), s = await open(b, size); try {
        await tap('#phone .pp-sw .pp-row')
        const first = await q('#phone [data-pp-card]', 'e.dataset.z')
        assert.equal(await page.evaluate(`document.querySelectorAll('#phone [data-pp-card]').length`), 1)
        const dock = await rect('#phone .pp-dock'), tabs = await rect('#phone .pp-tabs')
        assert.ok(Math.abs(dock.bottom - tabs.top) <= 1, `the dock sits on the tab bar: ${dock.bottom} / ${tabs.top}`)
        assert.ok(await q('#phone .pp-dock .pp-reply input', 'true'), 'the reply box')
        await drag('#phone [data-pp-card] .pp-q', -160)
        const second = await q('#phone [data-pp-card]', 'e.dataset.z')
        assert.notEqual(second, first)
        await drag('#phone [data-pp-card] .pp-q', 160)
        assert.equal(await q('#phone [data-pp-card]', 'e.dataset.z'), first)
        await tap('#phone .pp-opt.rec')
        assert.match(await text('#phone .pp-dock'), /^Sent to worker-dd$/)
        const post = s.server.posts.at(-1)
        assert.deepEqual({ path: post.path, label: post.body.label }, { path: '/answer', label: 'view' })
        s.server.setBoard('repo-x', { ...b, at: Date.now(), requests: [{ id: post.body.id, kind: 'answer', state: 'done', at: Date.now() }] })
        await page.waitFor(`document.querySelector('#phone .pp-dock')?.textContent.includes('done')`)
        assert.match(await text('#phone .pp-dock'), /Sent to worker-dd · done Next need/)
        await page.waitFor(`document.querySelector('#phone [data-pp-card]')?.dataset.z !== ${JSON.stringify(first)}`, 3000) // then the next card comes
      } finally { s.close() }
    })

    test('a refused action says "refused: <reason>"; the approval card has its steps with a model each, Approve, Change (a text box), Reject', async () => {
      const s = await open(withGate(), size); try {
        await tap('#phone .pp-sw[data-need="00000000-0000-4000-8000-000000000099"] .pp-row')
        assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#phone .pp-s')].map(${words})`), ['1 think opus', '2 build sonnet', '3 test haiku'])
        assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#phone .pp-dock .pp-row3 button')].map(x => x.textContent.trim())`), ['Approve', 'Change', 'Reject'])
        assert.match(await q('#phone [data-label="approve"]', 'getComputedStyle(e).backgroundColor'), /^(oklch|rgb|color)/)
        await tap('#phone [data-pp="change"]')
        assert.ok(await q('#phone .pp-dock textarea', 'true'), 'Change opens a text box')
        await tap('#phone [data-label="approve"]')
        const post = s.server.posts.at(-1)
        assert.deepEqual({ path: post.path, action: post.body.action, plan: post.body.plan }, { path: '/gate', action: 'approve', plan: GATE.fp })
        s.server.setBoard('repo-x', { ...withGate(), requests: [{ id: post.body.id, kind: 'gate', state: 'dropped', why: 'the plan changed', at: Date.now() }] })
        await page.waitFor(`document.querySelector('#phone .pp-dock')?.textContent.includes('refused')`)
        assert.match(await text('#phone .pp-dock'), /refused: the plan changed/)
        assert.ok(await q('#phone .pp-dock [data-label="approve"]', 'true'), 'after a refusal the options stay: Victor can act again')
      } finally { s.close() }
    })

    // task 76: the plan card on the phone. Task 30 to 32 are proposed; the board holds them as lots.
    const proposedBoard = (patch = {}) => { const b = fresh('planned'); return { ...b, lots: b.lots.slice(0, 3), proposed: [30, 31, 32], ...patch } }
    const openPlan = () => tap('#phone .pp-sw[data-need="plan"] .pp-row')

    test('the plan card has Approve and "Not now" for each proposed task; "Not now" sends decline for that task only', async () => {
      const s = await open(proposedBoard(), size); try {
        await openPlan()
        assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#phone .pp-prow')].map(r => [r.dataset.task, ...[...r.querySelectorAll('button')].map(b => b.textContent.trim())].join(' '))`), ['30 Approve Not now', '31 Approve Not now', '32 Approve Not now'])
        assert.deepEqual(small(await controls()), [])
        await tap('#phone .pp-prow[data-task="31"] [data-label="decline:31"]')
        const post = s.server.posts.at(-1)
        assert.deepEqual({ path: post.path, decline: post.body.decline, approve: post.body.approve }, { path: '/plan', decline: [31], approve: undefined })
        assert.deepEqual(page.errors, [])
      } finally { s.close() }
    })

    test('a refused state has a × that clears it, and clears by itself when the same control sends again', async () => {
      const s = await open(proposedBoard(), size); try {
        await openPlan()
        const refuse = async why => {
          const post = s.server.posts.at(-1)
          s.server.setBoard('repo-x', proposedBoard({ requests: [{ id: post.body.id, kind: 'plan', state: 'dropped', why, at: Date.now() }] }))
          await page.waitFor(`document.querySelector('#phone .pp-st.refused')`)
        }
        await tap('#phone [data-label="approve:30"]')
        await refuse('no task 75 in the plan')
        assert.match(await text('#phone .pp-st'), /refused: no task 75 in the plan/)
        await tap('#phone .pp-st .pp-x')
        assert.equal(await q('#phone .pp-st', 'true'), null, 'the × clears the refused state')
        await tap('#phone [data-label="approve:30"]')
        await refuse('the plan changed')
        await tap('#phone [data-label="approve:30"]') // the same control sends again
        assert.doesNotMatch(await text('#phone .pp-st'), /refused/)
        assert.match(await text('#phone .pp-st'), /Sent/)
      } finally { s.close() }
    })

    test('the task 75 race: a proposal that PLAN.md does not hold yet shows "not in the plan yet" and no Approve; only the tasks both hold are approved', async () => {
      const racing = proposedBoard({ proposed: [30, 31, 75] }) // 75 is in `proposed`, not in `lots`
      const s = await open(racing, size); try {
        await openPlan()
        assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#phone .pp-prow')].map(r => [r.dataset.task, (${words})(r)].join(': '))`), ['30: 30 The data contract of the v3 board Approve Not now', '31: 31 The task format in the plan Approve Not now', '75: 75 not in the plan yet'])
        assert.equal(await q('#phone .pp-prow[data-task="75"] button', 'true'), null, 'no control on a task that is not in the plan')
        await tap('#phone .pp-dock [data-label="approve"]') // Approve all
        assert.deepEqual(s.server.posts.at(-1).body.approve, [30, 31])
      } finally { s.close() }
      const only = await open(proposedBoard({ proposed: [75] }), size); try {
        await openPlan()
        assert.equal(await q('#phone [data-w="plan"]', 'true'), null, 'nothing to approve: no Approve, no Not now')
        assert.match(await text('#phone .pp-body'), /75 not in the plan yet/)
        assert.equal(only.server.posts.length, 0)
      } finally { only.close() }
    })

    test('with a finger: a swipe opens the snooze times of a need, and moves from card to card', async () => {
      const s = await open(fresh('needs-you'), size); try {
        const first = await q('#phone .pp-sw', 'e.dataset.need')
        await swipe(`#phone .pp-sw[data-need="${first}"] .pp-row`, -180)
        assert.ok(await q(`#phone .pp-sw[data-need="${first}"]`, 'e.classList.contains("open")'), 'the snooze times show')
        await tap('#phone [data-pp-tab="needs"]')
        await tap('#phone .pp-sw .pp-row')
        const card = await q('#phone [data-pp-card]', 'e.dataset.z')
        await swipe('#phone [data-pp-card] .pp-q', -160)
        assert.notEqual(await q('#phone [data-pp-card]', 'e.dataset.z'), card)
      } finally { s.close() }
    })

    test('a snoozed need comes back when its time comes, with no new board', async () => {
      const s = await open(fresh('needs-you'), size); try {
        const first = await q('#phone .pp-sw', 'e.dataset.need')
        await drag(`#phone .pp-sw[data-need="${first}"] .pp-row`, -180)
        await tap(`#phone .pp-sw[data-need="${first}"] .pp-snz button:first-child`)
        assert.equal(await q(`#phone .pp-sw[data-need="${first}"]`, 'true'), null)
        await page.evaluate(`localStorage.setItem('overseer.snooze', JSON.stringify({ ${JSON.stringify(first)}: Date.now() + 1200 }))`)
        await page.waitFor(`document.querySelector('#phone .pp-sw[data-need=${JSON.stringify(first)}]')`, 4000)
        assert.match(await text(`#phone .pp-sw[data-need="${first}"]`), /snoozed/)
      } finally { s.close() }
    })

    test('a diff scrolls to the side inside its own box only', async () => {
      const long = 'x'.repeat(400)
      const s = await open({ ...fresh('live') }, size, { files: { '/diff/repo-x': JSON.stringify({ rows: [['@', 1, '@@ -1 +1 @@'], ['+', 1, `const a = '${long}'`]], cut: 0 }) } }); try {
        await tap('#phone [data-pp-tab="tasks"]')
        await tap('#phone [data-pp-task="27"]')
        await tap('#phone [data-pp-stage="ch"]')
        await page.waitFor(`document.querySelector('#pp-stage .dv-f')`)
        await tap('#pp-stage .dv-f')
        await page.waitFor(`document.querySelector('#pp-stage .dl.add')`)
        const box = await q('#pp-stage .diff', '({ sw: e.scrollWidth, cw: e.clientWidth, ox: getComputedStyle(e).overflowX })')
        assert.ok(box.sw > box.cw && box.ox === 'auto', JSON.stringify(box))
        await noSideScroll()
      } finally { s.close() }
    })

    test('every control is 44 × 44 px or more, on each screen', async () => {
      const s = await open(withGate(), size); try {
        const seen = []
        seen.push(...await controls())
        await drag('#phone .pp-sw .pp-row', -180); seen.push(...await controls())
        await tap('#phone [data-pp-tab="needs"]')
        await tap('#phone .pp-sw[data-need="00000000-0000-4000-8000-000000000099"] .pp-row'); await tap('#phone [data-pp="change"]'); seen.push(...await controls())
        await tap('#phone [data-pp="back"]'); await tap('#phone .pp-sw .pp-row'); seen.push(...await controls())
        await tap('#phone [data-pp-tab="tasks"]'); await page.evaluate(`document.querySelectorAll('#phone details').forEach(d => d.open = true)`); await page.wait(50); seen.push(...await controls())
        await tap('#phone [data-pp-tab="activity"]'); seen.push(...await controls())
        await tap('#phone .pp-live'); seen.push(...await controls())
        assert.ok(seen.length > 20, `${seen.length} controls seen`)
        assert.deepEqual(small(seen), [])
      } finally { s.close() }
      const t = await open(fresh('live'), size); try {
        await tap('#phone [data-pp-tab="tasks"]'); await tap('#phone [data-pp-task="27"]')
        for (const k of ['wf', 'ch', 'te']) {
          await tap(`#phone [data-pp-stage="${k}"]`); await page.wait(150)
          assert.deepEqual(small(await controls()), [], k)
          assert.equal(await page.evaluate(`[...document.querySelectorAll('kbd')].filter(k => k.offsetParent !== null).length`), 0, `no key chip in ${k}`)
        }
      } finally { t.close() }
    })
  })
}

describe('the phone, regression', { skip }, () => {
  test('at 393 px the first task is in view without a scroll', async () => {
    const s = await open(fresh('live'), [393, 659, false]); try {
      await tap('#phone [data-pp-tab="tasks"]')
      await page.evaluate('scrollTo(0, 0)')
      const card = await rect('#phone .pp-card'), tabs = await rect('#phone .pp-tabs')
      assert.ok(card.top >= 56 && card.bottom <= tabs.top, JSON.stringify({ card, tabs }))
    } finally { s.close() }
  })
  test('at 1280 px the desktop board is as before: no phone layer', async () => {
    const s = await open(fresh('live'), [1280, 900, false], { ready: `document.querySelector('.page > .views')?.offsetParent` }); try {
      assert.equal(await q('#phone', 'getComputedStyle(e).display'), 'none')
      assert.equal(await page.evaluate(`document.documentElement.classList.contains('phone')`), false)
    } finally { s.close() }
  })
})
