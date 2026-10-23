import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { browserTest, launch } from './test/cdp.mjs'
import { readFileSync } from 'node:fs'
import { stub } from './test/stub.mjs'
import { boards } from './fixtures/make.mjs'

// The Workflow and Tests stages (lot 41) in a real Chrome on the stub server (lot 50's harness): the step shapes, the approval card, the tests tiers.
// Each test ends with no page error. Fails where Chrome is missing, unless OVERSEER_NO_BROWSER=1.
const { skip } = browserTest()
const WEB = new URL('.', import.meta.url).pathname

let page
before(async () => { if (!skip) page = await launch() })
after(async () => { await page?.close() })

const fresh = (name, patch = {}) => ({ ...boards[name], at: Date.now(), nextPassAt: Date.now() + 150e3, ...patch })
const lotWith = (name, n, patch) => ({ lots: boards[name].lots.map(l => (l.n === n ? { ...l, ...patch } : l)) })
async function open(name, { patch = {}, size = { width: 1280, height: 900 }, dark = false, files, board } = {}) {
  const server = await stub({ root: WEB, boards: { 'repo-x': board ?? fresh(name, patch) }, files })
  await page.view({ ...size, dark })
  await page.goto('about:blank')
  await page.goto(`${server.url}/`)
  await page.waitFor(`document.querySelector('#ck-main .ck-mh, #ck-main .ck-empty')`)
  return { server, close: () => server.close() }
}
const key = async (k, mods) => { await page.press(k, mods); await page.wait(60) }
const posts = s => s.posts.map(p => ({ path: p.path, body: { ...p.body, id: /^[A-Za-z0-9-]{1,64}$/.test(p.body.id ?? '') ? '·' : p.body.id } }))
const q = (sel, fn = 'textContent') => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.${fn})`)
const stage = async k => { await key(k); await page.waitFor(`document.querySelector('#ck-stage > *')`) }

const FP = '5d7de04708ea8ed1'
const S28 = '00000000-0000-4000-8000-000000000028'
const AG = [{ label: 'think', model: 'opus' }, { label: 'build', model: 'sonnet' }, { label: 'test', model: 'haiku' }]
const gateBoard = (gate = {}, stage = 'gate') => { const b = fresh('gate'); return { ...b, sessions: b.sessions.map(s => ({ ...s, stage, question: undefined, ask: undefined, gate: { name: 'band-follows-mockup', fp: FP, agents: AG, ...gate } })) } }
// lot 27's run with the steps given
const T0 = Date.parse('2026-10-22T10:00:00Z')
const st = (label, o = {}) => ({ id: label, label, state: 'done', model: 'claude-sonnet-5', effort: 'medium', startedAt: T0, endedAt: T0 + 130e3, ...o })
const turn = (t, o = {}) => ['test', 'verify', 'fix'].map(k => st(`${k}-${t}`, { kind: k, turn: t, group: 'loop', effort: 'high', model: 'claude-opus-5-5', ...o }))
const STEPS = [st('think', { kind: 'think', model: 'claude-opus-5-5', effort: 'high' }), st('build', { id: 'b1', kind: 'build', group: 'parallel' }), st('build', { id: 'b2', kind: 'build', group: 'parallel' }), ...turn(1), ...turn(2, { state: 'running' })]
const TESTS = { unit: ['overseer/hooks/a.test.ts'], functional: ['overseer/web/b.test.mjs'], screens: ['overseer/golden/x.txt'] }
const run = (board, steps, o = {}) => ({ workflows: [{ ...board.workflows[0], steps, ...o }] })

describe('workflow stage', { skip }, () => {
  test('shapes: done, parallel and loop turns; the model and the effort of each step; a turn tab shows its turn', async () => {
    const s = await open('live', { patch: run(boards.live, STEPS) }); try {
      await stage('w')
      assert.equal((await q('.grp')).length, 2)
      const t = await page.evaluate(`document.getElementById('ck-stage').innerText`)
      assert.match(t, /in parallel/); assert.match(t, /2 agents/); assert.match(t, /verification loop/)
      assert.deepEqual(await q('[data-turn]', 'dataset.turn'), ['0', '1'])
      assert.equal((await q('.model', 'textContent'))[0].trim(), 'opus')
      assert.equal(await page.evaluate(`document.querySelector('.model').title`), 'claude-opus-5-5')
      assert.ok((await q('.effort', 'dataset.e')).includes('3') && (await q('.effort', 'dataset.e')).includes('2'))
      assert.deepEqual(await q('[data-turn]', 'ariaPressed'), ['false', 'true']) // the last turn first
      assert.deepEqual(await q('[data-turn-box]', 'hidden'), [true, false])
      assert.equal((await q('.wstep.run .state'))[0], 'in progress'); assert.equal((await q('.wstep.done .state'))[0], '2m10')
      await page.click('[data-turn="0"]')
      assert.deepEqual(await q('[data-turn-box]', 'hidden'), [false, true]); assert.deepEqual(await q('[data-turn]', 'ariaPressed'), ['true', 'false'])
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
  test('turn 3: three tabs, the last pressed', async () => {
    const s = await open('live', { patch: run(boards.live, [...STEPS, ...turn(3, { state: 'running' })]) }); try {
      await stage('w')
      assert.deepEqual(await q('[data-turn]', 'ariaPressed'), ['false', 'false', 'true'])
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
  test('a done run: every step is done, with its duration', async () => {
    const steps = [st('think', { kind: 'think' }), ...turn(1)]
    const s = await open('done-gaps', { patch: run({ workflows: [{ runId: 'wf-27', name: 'pane', session: 'worker-dd', started: 4, done: 4, running: [], isActive: false }] }, steps) }); try {
      await stage('w')
      assert.equal((await q('.wstep')).length, 4); assert.equal((await q('.wstep.done')).length, 4)
      assert.deepEqual([...new Set(await q('.wstep .state'))], ['2m10'])
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
  test('Goal, How and Deliverable: "Not exported yet" when missing, the text when set', async () => {
    const s = await open('live', { patch: run(boards.live, [st('think', { kind: 'think' }), st('build', { kind: 'build', goal: 'Write it.', how: 'Small.', out: 'A diff.' })]) }); try {
      await stage('w')
      assert.deepEqual(await q('.wstep:nth-child(1) .why .nx'), ['Not exported yet', 'Not exported yet', 'Not exported yet'])
      assert.deepEqual(await q('.wstep:nth-child(2) .why dd'), ['Write it.', 'Small.', 'A diff.'])
      assert.equal((await q('.wstep:nth-child(2) .why .nx')).length, 0)
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
  test('proposed: the steps of the gate with the model only; a planned task says "Proposed in PLAN.md", with "task"', async () => {
    let s = await open('gate', { board: gateBoard() }); try {
      await stage('w')
      assert.deepEqual((await q('.wstep .nm b')), ['Think', 'Build', 'Test'])
      assert.deepEqual((await q('.wstep .model')).map(x => x.trim()), ['opus', 'sonnet', 'haiku'])
      assert.equal((await q('.wstep .effort')).length, 0); assert.equal((await q('.wstep.done, .wstep.run')).length, 0)
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
    s = await open('planned'); try {
      await stage('w')
      const t = await page.evaluate(`document.getElementById('ck-stage').innerText`)
      assert.match(t, /Proposed in PLAN\.md/); assert.doesNotMatch(t, /\blot\b/i)
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
})

describe('the approval', { skip }, () => {
  const review = async () => { await key('z'); await key('m') }
  test('the card of a plan on the gate lists its agents and models; A approves, R rejects, C asks a change: POST /gate', async () => {
    let s = await open('gate', { board: gateBoard() }); try {
      await review()
      assert.deepEqual(await q('.k-approval .wf-sum span', 'textContent'), ['3 steps', 'think · opus', 'build · sonnet', 'test · haiku'])
      await key('a'); await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/gate', body: { slug: 'repo-x', id: '·', session: S28, plan: FP, action: 'approve' } }])
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
    s = await open('gate', { board: gateBoard() }); try {
      await review(); await key('r'); await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server).map(p => p.body.action), ['reject'])
    } finally { s.close() }
    s = await open('gate', { board: gateBoard() }); try {
      await review(); await key('c'); await page.type('Fewer steps.'); await key('Enter'); await page.waitFor(`document.querySelector('.w-state')`)
      assert.deepEqual(posts(s.server), [{ path: '/gate', body: { slug: 'repo-x', id: '·', session: S28, plan: FP, action: 'change', text: 'Fewer steps.' } }])
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
  test('after the approval the card leaves Review and the Workflow stage says "approved from the board"', async () => {
    const s = await open('gate', { board: gateBoard() }); try {
      await stage('w'); assert.match(await page.evaluate(`document.querySelector('#ck-stage .wf-sum').textContent`), /waits for your approval/)
      await review(); await key('a'); await page.waitFor(`document.querySelector('.w-state')`)
      const at = Date.now(), hhmm = new Date(at).toTimeString().slice(0, 5)
      s.server.setBoard('repo-x', gateBoard({ state: 'approved', at }, 'work'))
      const b = gateBoard({ state: 'approved', at }, 'work'); s.server.setBoard('repo-x', { ...b, requests: [{ id: s.server.posts[0].body.id, kind: 'gate', state: 'done', at }] })
      await page.waitFor(`document.querySelectorAll('#z-cards .k-approval').length === 0`)
      await key('Escape'); await stage('w')
      await page.waitFor(`document.querySelector('#ck-stage .wf-sum')?.textContent.includes('approved from the board')`)
      assert.equal(await page.evaluate(`document.querySelector('#ck-stage .wf-sum').textContent`), `Workflow "band-follows-mockup" · approved from the board, ${hhmm}`)
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
})

describe('tests stage', { skip }, () => {
  test('the judge note first, then Unit, Functional and Screenshots; the screen comes from GET /file', async () => {
    const s = await open('done-gaps', { patch: lotWith('done-gaps', 27, { tests: TESTS }), files: { '/file/repo-x': '{"text":"SCREEN","cut":3}' } }); try {
      await stage('c'); await page.evaluate(`window.__f = []; const f = fetch; window.fetch = (u, ...a) => (__f.push(String(u)), f(u, ...a))`)
      await stage('t')
      await page.waitFor(`document.querySelector('.tabs + .term')?.textContent.includes('SCREEN')`)
      assert.equal(await page.evaluate(`document.querySelector('.dv').firstElementChild.className`), 'dv-verdict')
      assert.match(await page.evaluate(`document.querySelector('.dv-verdict').textContent`), /2 gaps left for the owner/)
      assert.deepEqual(await q('.tr b'), ['Unit tests', 'Functional tests', 'Screenshots'])
      assert.match((await q('.tr'))[0], /144 tests pass, 2 fail/); assert.match((await q('.tr .term'))[0], /2 failed/) // the failed check's tail
      assert.deepEqual(await q('.tst .refs .chip'), ['a.test.ts', 'b.test.mjs'])
      assert.equal(await page.evaluate(`document.querySelector('.tabs + .term').textContent`), 'SCREEN\n3 more lines')
      assert.deepEqual(await page.evaluate(`__f.filter(u => u.startsWith('/file'))`), ['/file/repo-x?lot=27&path=overseer%2Fgolden%2Fx.txt'])
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
  test('a running lot with no check result: "not run yet" rows and no judge note', async () => {
    const s = await open('live', { patch: lotWith('live', 27, { check: './check.sh' }) }); try {
      await stage('t')
      assert.deepEqual(await q('.tr span'), ['They run after the workflow builds the change.', 'Not run yet.', 'Not taken yet.'])
      assert.equal((await q('.dv-verdict')).length, 0)
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
  test('a gap shows once', async () => {
    const gap = 'The More button does not open the view.'
    const s = await open('done-gaps', { patch: lotWith('done-gaps', 27, { gaps: [gap], marks: [{ i: 0, mark: 'gap', ev: gap.slice(0, -1) }, { i: 1, mark: 'gap', ev: 'Other.' }] }) }); try {
      await stage('t')
      assert.deepEqual(await q('.gaps li'), [gap, 'Other.'])
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
})

describe('the look', { skip }, () => {
  const mock = readFileSync(new URL('./mockups/board-v3.html', import.meta.url), 'utf8')
  const known = new Set([...mock.matchAll(/class="([^"$]*)/g)].flatMap(m => m[1].split(/\s+/)).concat(['done', 'run', 'gap', 'none', 'fail', 'gate', 'todo']))
  test('the classes of both stages are the mockup\'s; 390px has no side scroll, light and dark', async () => {
    for (const dark of [false, true]) {
      const steps = [...STEPS, ...turn(3)]
      const s = await open('done-gaps', { dark, size: { width: 390, height: 800 }, patch: { ...lotWith('done-gaps', 27, { tests: TESTS }), ...run({ workflows: [{ runId: 'w', name: 'n', session: 'worker-dd', started: 1, done: 1, running: [], isActive: false }] }, steps) }, files: { '/file/repo-x': '{"text":"S","cut":0}' } }); try {
        for (const k of ['w', 't']) {
          await stage(k); await page.wait(100)
          const classes = await page.evaluate(`[...new Set([...document.querySelectorAll('#ck-stage, #ck-stage *')].flatMap(e => [...e.classList]))]`)
          assert.deepEqual(classes.filter(c => !known.has(c)), [], `${k}, dark ${dark}`)
          assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`), true, `${k}, dark ${dark}`)
        }
        assert.deepEqual(page.errors, [])
      } finally { s.close() }
    }
  })
})
