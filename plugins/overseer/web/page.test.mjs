import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { boards } from './fixtures/make.mjs'

// The page's pure view (between the "---- view" markers of index.html) runs here with no DOM: a Board in, HTML and plain objects out.
// Lot 26's cases (calm, needs you, a retry verdict, escaping, the pill) are here for the v3 page; the browser tests are page.browser.test.mjs.
const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
const src = page.slice(page.indexOf('// ---- view'), page.indexOf('// ---- end view'))
const ctx = vm.createContext({})
vm.runInContext(`${src}\nthis.api = { h, rich, ago, isV3, isStale, needsOf, groupLots, listOrder, listHTML, rowHTML, railHTML, railNotes, leftOf, stagesOf, defaultStage, briefHTML, crHTML, hudHTML, paneHTML, cardHTML, needBoxHTML, pillOf, passOf, rateOf, versionNote, marksOf, wtOf, repoName, sico, NX }`, ctx)
const A = ctx.api
const T = boards.calm.at, NOW = T + 30e3
const needsOf = b => A.needsOf(b, NOW)
const plain = x => JSON.parse(JSON.stringify(x)) // an object made in the vm has another Array: compare by value

test('calm: no need, done lots fold into one line, the open one is a row', () => {
  const b = boards.calm, needs = needsOf(b)
  assert.deepEqual(plain(needs), [])
  const folded = A.listHTML(b, 27, needs, NOW, false), open = A.listHTML(b, 27, needs, NOW, true)
  assert.match(folded, /class="ck-sec ck-fold" id="ck-more" aria-expanded="false">Done<span>3 tasks ▸<\/span>/) // "Done · N tasks ▸"
  assert.ok(!/data-n="(24|23|22)"/.test(folded))
  assert.match(open, /aria-expanded="true">Done<span>3 tasks ▾<\/span>/)
  assert.ok(/data-n="24"/.test(open))
  assert.match(folded, /data-n="27"[^]*?27 · The terminal pane follows the mockup/)
  assert.match(A.listHTML(b, 27, needs, NOW, false), /<div class="ck-sec">Now<span>1 running<\/span>/)
})

test('needs you: a waiting session, a blocked lot and the budget become needs, in the order the lead ranks them', () => {
  const needs = needsOf(boards['needs-you'])
  assert.deepEqual(plain(needs.map(n => [n.kind, n.why])), [['decision', 'waits'], ['info', 'stuck'], ['info', 'blocked'], ['info', 'budget']])
  assert.equal(needs[0].title, 'Open the More button as a view or a drawer?')
  assert.equal(needs[0].lot, 27)
  assert.deepEqual(plain(needsOf({ ...boards.calm, at: T - 11 * 60e3 }).map(n => n.why)), ['stale']) // a silent overseer is a need of its own
  const gate = needsOf(boards.gate), planned = needsOf(boards.planned)
  assert.deepEqual(plain(gate.map(n => [n.kind, n.why])), [['decision', 'waits']]) // the gate fixture waits on a question; a stage gate comes with lot 35's export
  assert.deepEqual(plain(planned.map(n => [n.kind, n.why])), [['approval', 'plan']])
})

test('a session at the workflow gate is an approval with its steps', () => {
  const b = { ...boards.gate, sessions: [{ ...boards.gate.sessions[0], stage: 'gate', question: undefined, ask: undefined, gate: { name: 'band-follows-mockup', agents: [{ label: 'think', model: 'opus' }, { label: 'build', model: 'sonnet' }] } }] }
  const [n] = needsOf(b)
  assert.deepEqual([n.kind, n.why], ['approval', 'gate'])
  const card = A.cardHTML(b, n, NOW, true)
  assert.match(card, /k-approval/); assert.match(card, /2 steps/); assert.match(card, /think · opus/)
  for (const k of ['a', 'c', 'r']) assert.match(card, new RegExp(`data-key="${k}"`))
  assert.match(card, /data-w="gate" data-label="approve"/)
})

test('a decision card: numbered options, the recommended one is the red button, session text is escaped, the link only when it is claude.ai/code and there are no buttons', () => {
  const s = boards['needs-you'].sessions[0]
  const mk = extra => ({ ...boards['needs-you'], sessions: [{ ...s, ...extra }, ...boards['needs-you'].sessions.slice(1)] })
  const card = (b) => A.cardHTML(b, needsOf(b)[0], NOW, true)
  const c = card(mk({}))
  assert.match(c, /class="rec" data-key="1" data-w="answer" data-label="view"/)
  assert.match(c, /data-key="2" data-w="answer" data-label="drawer"/)
  assert.match(c, /Recommends: view — the mockup shows a view/)
  const evil = card(mk({ ask: undefined, question: '<img src=x onerror=1>', link: 'https://claude.ai/code/abc_1' }))
  assert.ok(!evil.includes('<img') && evil.includes('&lt;img'))
  assert.match(evil, /href="https:\/\/claude\.ai\/code\/abc_1"/) // no buttons: the link
  assert.ok(!card(mk({ link: 'https://claude.ai/code/abc_1' })).includes('claude.ai/code')) // buttons: no link
  assert.ok(!card(mk({ ask: undefined, link: 'https://evil.example/x' })).includes('evil.example'))
  assert.match(A.cardHTML(mk({}), needsOf(mk({}))[0], NOW, false), /data-w="answer"[^>]* disabled/) // a board with no v3 field: the write controls are off
})

test('a lot with marks shows "N of M met" and each mark; with none exported the page says so', () => {
  const l = boards.live.lots[0]
  const h = A.briefHTML(boards.live, l, false)
  assert.match(h, /2 of 4 met/)
  assert.match(h, /class="gap"[^>]*>[^]*verify, turn 2: the More button does not open the view/)
  const none = A.briefHTML(boards.old, boards.old.lots[0], false)
  assert.match(none, /marks <span class="nx">Not exported yet<\/span>/)
  assert.match(none, /Context<\/dt><dd><span class="nx">Not exported yet<\/span>/)
  assert.deepEqual(JSON.parse(JSON.stringify(A.marksOf(boards.old.lots[0]))), null)
})

test('the live pill: disconnected, error, silent Xm, paused, live (CONTRACT.md failure states)', () => {
  const b = boards.calm
  assert.deepEqual({ ...A.pillOf(b, NOW, false) }, { state: 'disconnected', text: 'disconnected', off: true })
  assert.equal(A.pillOf({ ...b, error: { text: 'no PLAN.md', at: T, source: 'plan' } }, NOW, true).state, 'error')
  assert.deepEqual({ ...A.pillOf(b, T + 12 * 60e3, true) }, { state: 'silent', text: 'silent 12m', off: true })
  assert.equal(A.pillOf({ ...b, paused: true }, NOW, true).text, 'paused')
  assert.deepEqual({ ...A.pillOf(b, NOW, true) }, { state: 'live', text: 'live', off: false })
  assert.equal(A.pillOf({ ...b, error: { text: 'x', at: T, source: 'plan' } }, T + 12 * 60e3, false).state, 'disconnected') // the connection comes first
})

test('the ring follows nextPassAt over passEvery; passing says so', () => {
  const b = { ...boards.calm, nextPassAt: NOW + 90e3, passEvery: 180e3 }
  assert.deepEqual({ ...A.passOf(b, NOW) }, { text: '1:30', label: 'next pass', arc: 50 })
  assert.equal(A.passOf({ ...b, passing: true }, NOW).label, 'reading the sessions…')
  assert.equal(A.passOf({ ...b, nextPassAt: NOW - 5e3 }, NOW).text, '0:00')
})

test('a board written before v3 has no v3 field: the page says so and turns its write controls off', () => {
  assert.equal(A.isV3(boards.old), false)
  for (const n of ['calm', 'needs-you', 'paused', 'live', 'planned', 'gate', 'empty']) assert.equal(A.isV3(boards[n]), true, n)
  const l = boards.old.lots[1], hud = A.hudHTML(boards.old, l, NOW, false)
  assert.match(hud, /class="ck-go hud-cr"[^>]* disabled/)
  assert.match(A.crHTML(boards.old, l, null, false), /id="cr-new" disabled/)
  assert.match(A.stagesOf(boards.old, boards.old.lots[0], NOW).te[1], /not run yet: \.\/check\.sh/) // the command, until a run is exported
  assert.match(A.stagesOf(boards.old, { n: 9, title: 'x', status: 'todo', depends: [] }, NOW).te[1], /not exported yet/)
})

test('lots by status: needs you, now, next, planned; a proposed lot is planned; lot 41 waits for its dependencies', () => {
  const b = boards.planned, g = A.groupLots(b, needsOf(b))
  assert.equal(g.planned.length, 15); assert.equal(g.now.length + g.next.length + g.needs.length, 0)
  const own = { ...boards.calm, lots: [{ n: 1, title: 'A', status: 'done', depends: [] }, { n: 2, title: 'B', status: 'todo', depends: [1] }, { n: 3, title: 'C', status: 'todo', depends: [2] }, { n: 4, title: 'D', status: 'blocked', depends: [] }] }
  const o = A.groupLots(own, needsOf(own))
  assert.deepEqual(plain([o.needs, o.next, o.planned, o.done].map(x => x.map(l => l.n))), [[4], [2], [3], [1]])
})

test('a title with markup is text, never markup, in a row, the pane and a card', () => {
  const b = { ...boards.calm, lots: [{ n: 1, title: '<script>x</script> `code`', status: 'running', depends: [], session: 's' }], sessions: [] }
  const row = A.rowHTML(b, b.lots[0], 1, [], NOW, false), pane = A.paneHTML(b, b.lots[0], { tab: 'te', full: false, needs: [], now: NOW, draft: null, enabled: true })
  for (const h of [row, pane]) { assert.ok(!h.includes('<script>')); assert.match(h, /&lt;script&gt;x&lt;\/script&gt; <span class="mono">code<\/span>/) }
})

test('the rail: open lots wide with branch and files from the board, done lots one segment, a proposed plan dashed', () => {
  const b = { ...boards.live, branches: [{ name: 'lot/27-pane', ahead: 2, behind: 0, files: 3, overlaps: [], merge: { order: 1, conflicts: [] } }] }
  const rail = A.railHTML(b, 27, needsOf(b))
  assert.match(rail, /class="rl open run" data-n="27"[^>]*><i><\/i><small><b>27<\/b> lot\/27-pane<\/small><small>3 files<\/small>/)
  assert.deepEqual({ ...A.wtOf(b, b.lots[0]) }, { branch: 'lot/27-pane', files: 3, ahead: 2, conflicts: [], dirty: 0 })
  assert.match(A.railHTML(boards.planned, 30, []), /class="rl relseg plan"[^>]*>[^]*15 tasks · proposed/)
  assert.match(A.railNotes(b), /test merge of the open tasks: no conflict/)
  assert.match(A.leftOf({ ...b, paused: true }, NOW), /paused: running tasks finish/)
})

test('the repository name is its last folder; a lot-less board still has a name', () => {
  assert.equal(A.repoName('/home/user/Repos/claude-mods/'), 'claude-mods')
  assert.equal(A.repoName(''), 'Overseer')
})

test('the budget rate is the points spent in the last hour; none with fewer than 2 points', () => {
  const series = [{ at: NOW - 2 * 3600e3, spent: 1 }, { at: NOW - 3000e3, spent: 5.8 }, { at: NOW, spent: 7.2 }]
  assert.ok(Math.abs(A.rateOf({ budget: { spent: 7.2, budget: 15, level: 'normal', series } }, NOW) - 1.68) < 0.01) // 1.4 points in 50 min
  assert.equal(A.rateOf({ budget: { spent: 1, budget: 15, level: 'normal', series: [series[2]] } }, NOW), undefined)
  assert.equal(A.rateOf({ budget: { spent: 1, budget: 15, level: 'normal' } }, NOW), undefined)
})

test('the decisions already taken on the lot of a card are in its context (v1: Decisions)', () => {
  const b = { ...boards['needs-you'], decisions: [{ at: '2026-10-20', lot: '27', question: 'Which mockups first?', answer: 'the v1 mockups' }, { at: '2026-10-19', lot: '26', question: 'Port 4318?', answer: 'yes' }] }
  const card = A.cardHTML(b, needsOf(b)[0], NOW, true)
  assert.match(card, /Decided 2026-10-20: Which mockups first\?<\/span><b>the v1 mockups<\/b>/)
  assert.ok(!card.includes('Port 4318'))
})

test('a server and an overseer on different versions: the page says to restart (lot 51)', () => {
  assert.match(A.versionNote('0.2.7', '0.2.6'), /server 0\.2\.7, overseer 0\.2\.6: restart it/)
  assert.equal(A.versionNote('0.2.7', '0.2.7'), ''); assert.equal(A.versionNote(undefined, '0.2.7'), ''); assert.equal(A.versionNote('0.2.7', undefined), '')
  const b = { ...boards.calm, mod: { version: '0.2.6' } }
  assert.match(A.paneHTML(b, b.lots[3], { tab: 'te', full: false, needs: [], now: NOW, draft: null, enabled: true, server: '0.2.7' }), /restart it/)
})

test('lot 53: a proposed lot is listed in the plan group with its approval need, and does not break the page', () => {
  const calm = boards.calm
  const b = { ...calm, proposed: [5], lots: [...calm.lots, { ...calm.lots[0], n: 5, title: 'Retry budget', status: 'proposed' }] }
  const needs = needsOf(b)
  assert.deepEqual(plain(needs.filter(n => n.why === 'plan')).map(n => [n.id, n.title]), [['plan', 'Approve the 1 new tasks of PLAN.md?']])
  const h = A.listHTML(b, 27, needs, NOW, false) + A.cardHTML(b, needs.find(n => n.why === 'plan'), NOW, true)
  for (const x of ['5 · Retry budget', 'data-w="plan"']) assert.ok(h.includes(x), x)
})
