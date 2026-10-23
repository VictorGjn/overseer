import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { boards } from './fixtures/make.mjs'
import { browserTest, launch } from './test/cdp.mjs'
import { stub } from './test/stub.mjs'

// Task 63: the HUD of the selected task shows what the board exports and what helps decide, in a fixed order, and no model or ETA.
const { skip } = browserTest()
const WEB = new URL('.', import.meta.url).pathname
const MIN = 60e3
const PACE = 20 * MIN

// The live fixture with a clock that matches the page's: the task started `elapsed` ago, and the run's median is PACE.
function board(elapsed, o = {}) {
  const now = Date.now(), live = boards.live, [lot] = live.lots.filter(l => l.n === 27)
  return {
    ...live, at: now, nextPassAt: now + 150e3, pace: PACE, ...o,
    lots: live.lots.map(l => (l.n === 27 ? { ...lot, check: { ok: true, at: now - 3 * MIN, tests: { pass: 146, fail: 0 }, tail: '' }, tokens: 1e6, files: [[12, 3, 'overseer/web/index.html'], [30, 6, 'overseer/web/test/stub.mjs']], stat: { files: 2, add: 42, del: 9 }, ...(o.lot ?? {}) } : l)),
    sessions: live.sessions.map(s => ({ ...s, lotStartedAt: now - elapsed, model: 'claude-opus-5-5', tries: 1 })),
    workflows: live.workflows.map(w => ({ ...w, steps: [{ state: 'done' }, { state: 'done' }, { state: 'run' }, { state: 'todo' }].map((x, i) => ({ id: `s${i}`, label: `s${i}`, ...x })) })),
    budget: { spent: 2.9, budget: 15, level: 'normal' },
  }
}

let page
before(async () => { if (!skip) page = await launch() })
after(async () => { await page?.close() })
async function open(b, width = 1600) {
  const server = await stub({ root: WEB, boards: { 'repo-x': b } })
  await page.view({ width, height: 900 }); await page.goto('about:blank'); await page.goto(`${server.url}/`)
  await page.waitFor(`document.querySelector('#ck-main .ck-mh, #ck-main .ck-empty')`)
  await page.click('.ck-row[data-n="27"]') // click the task
  await page.waitFor(`document.querySelector('#ck-hud .hud-sec')`)
  return server
}
const hud = () => page.evaluate(`document.getElementById('ck-hud').innerText`)
// the colour --act resolves to, read from a probe the same way the bar's is
const colors = () => page.evaluate(`(() => { const p = document.createElement('i'); p.style.background = 'var(--act)'; document.body.append(p); const act = getComputedStyle(p).backgroundColor; p.remove(); const i = document.querySelector('#ck-hud .hud-bar.pace i'); return { act, bar: i && getComputedStyle(i).backgroundColor } })()`)

describe('the HUD', { skip }, () => {
  test('3 x pace: the items come in order, the bar is --act and says "longer than usual"', async () => {
    const s = await open(board(3 * PACE)); try {
      const t = await hud()
      const at = ['Elapsed', '1h00', 'longer than usual', 'Stage', 'work', 'try 2', 'worker-dd', '2 of 4 met', 'step 3 of 4', 'Last test run', 'pass · 3m', 'Changes', '2 files, +42 −9', 'not committed', 'Last commit', 'a293aeb', 'Points', 'points'].map(k => [k, t.indexOf(k)])
      assert.match(t, /pass · 3m\d* ago/)
      for (const [k, i] of at) assert.ok(i >= 0, `${k} is in the HUD: ${t}`)
      assert.deepEqual(at.map(a => a[1]), [...at.map(a => a[1])].sort((x, y) => x - y), `in this order: ${at.map(a => a[0]).join(', ')}`)
      const c = await colors()
      assert.equal(c.bar, c.act)
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
  test('0.5 x pace: the bar is not --act and the HUD does not say "longer than usual"', async () => {
    const s = await open(board(PACE / 2)); try {
      assert.ok(!/longer than usual/.test(await hud()))
      const c = await colors()
      assert.notEqual(c.bar, c.act)
      assert.match(await hud(), /10m\d*\s+of 20m usual/)
    } finally { s.close() }
  })
  test('no model name, no clock-time ETA', async () => {
    for (const e of [3 * PACE, PACE / 2]) {
      const s = await open(board(e)); try { assert.ok(!/claude-|opus|sonnet|ETA|\d{1,2}:\d{2}/.test(await hud()), await hud()) } finally { s.close() }
    }
  })
  test('what the board does not export says so: no pace, no start, no marks, no check, no files, no workflow', async () => {
    const b = board(PACE), live = b.lots.find(l => l.n === 27)
    const bare = { ...b, pace: undefined, workflows: [], lots: b.lots.map(l => (l.n === 27 ? { ...live, marks: undefined, check: undefined, files: undefined, stat: undefined, dirty: undefined, tokens: undefined } : l)) }
    const s = await open(bare); try {
      const t = await hud()
      assert.match(t, /Not exported yet/i)
      assert.ok(/no workflow/.test(t))
      assert.ok(!t.includes('longer than usual'))
    } finally { s.close() }
    const s2 = await open({ ...b, sessions: b.sessions.map(({ lotStartedAt, ...x }) => x) }); try { assert.match(await hud(), /not started/) } finally { s2.close() }
  })
  for (const width of [1600, 1440]) test(`at ${width}px each label fits on one line`, async () => {
    const s = await open(board(3 * PACE), width); try {
      const bad = await page.evaluate(`(() => {
        const out = []
        for (const e of document.querySelectorAll('#ck-hud .hud-h, #ck-hud .hud-h .mono, #ck-hud .hud-kv b, #ck-hud .hud-kv small, #ck-hud .hud-row b, #ck-hud .hud-row small, #ck-hud .hud-commit .mono, #ck-hud .hud-files button span, #ck-hud .hud-files em')) {
          const r = document.createRange(); r.selectNodeContents(e)
          if (r.getClientRects().length > 1 && ![...r.getClientRects()].every((x, i, a) => Math.abs(x.top - a[0].top) < 3)) out.push(e.textContent + ' wraps')
          if (e.scrollWidth > e.clientWidth + 1) out.push(e.textContent + ' is cut')
        }
        return out
      })()`)
      assert.deepEqual(bad, [])
      assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true)
    } finally { s.close() }
  })
})
