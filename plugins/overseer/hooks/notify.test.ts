import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { quietClock } from './clock.testkit.ts'

// Only what needs the person toasts; everything else goes to the log. A repeat shows with a count.
const PLAN = `# Plan — Ship it

## [ ] 1. API endpoint
done when: GET /reports/nav returns the fixture
`

async function startRun($: Engine, on: On, o: { deliver?: () => object; tail?: string | (() => string); weekly?: () => number; judge?: () => string; quiet?: boolean } = {}) {
  const files: Record<string, string> = { '/r/PLAN.md': PLAN }
  const toasts: string[] = []
  const tail = () => JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: '2026-10-09T10:00:00Z', message: { content: [{ type: 'text', text: (typeof o.tail === 'function' ? o.tail() : o.tail) ?? 'Ready.' }] } }).replace('10:00:00Z', ((typeof o.tail === 'function' ? o.tail() : o.tail) ?? '').includes('[lot') ? '10:20:00Z' : '10:00:00Z')
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(o.quiet ? quietClock(on) : on, { now: Date.parse('2026-10-09T10:05:00Z') })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: o.weekly?.() ?? 40 }] } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '' : '/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(tail())
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse')) return out('base123')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: o.judge?.() ?? '[]', usage: {} } }) as never)
  on('ui.toast', (_$, e) => { toasts.push((e as { text?: string; message?: string }).text ?? (e as { message?: string }).message ?? JSON.stringify(e)); return { value: undefined } as never })
  on('session.send', () => (o.deliver?.() ?? { isDelivered: true }) as never)
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  return { files, clock, toasts }
}
const log = async ($: Engine) => JSON.stringify(await $.command.run({ command: 'oversee', args: 'log' } as never))
const count = (toasts: string[], re: RegExp) => toasts.filter(t => re.test(t)).length

test('a refused message toasts', async ($, on) => {
  const { toasts } = await startRun($, on, { deliver: () => ({ isDelivered: false, reason: 'nope' }) })
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  expect(count(toasts, /send-refused/)).toBe(1)
})

test('a session entering waits toasts once, not on every pass', async ($, on) => {
  const { toasts, clock } = await startRun($, on, { tail: 'Which branch should I use?', quiet: true })
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  await clock.advance(7 * 60e3)
  expect(count(toasts, /waits/)).toBe(1)
})

test('a running task no session holds is marked blocked and toasts', async ($, on) => {
  const { toasts, files } = await startRun($, on)
  files['/r/PLAN.md'] = PLAN.replace('[ ]', '[~]')
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  expect(count(toasts, /blocked/)).toBe(1)
})

test('assigning a task only logs', async ($, on) => {
  const { toasts } = await startRun($, on)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  expect(await log($)).toContain('assign')
  expect(toasts).toEqual([])
})

test('the budget toasts only at stop', async ($, on) => {
  let w = 40
  const { toasts, clock } = await startRun($, on, { weekly: () => w })
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  w = 46 // past half of 10 points: reduce
  await clock.advance(3 * 60e3)
  expect(await log($)).toContain('budget')
  expect(count(toasts, /budget/)).toBe(0)
  w = 51 // spent
  await clock.advance(3 * 60e3)
  expect(count(toasts, /budget/)).toBe(1)
})

test('an overseer error toasts; the same one again shows a count, and plain after 10 min', async ($, on) => {
  const { toasts, files, clock } = await startRun($, on)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  const plan = files['/r/PLAN.md']!
  delete files['/r/PLAN.md']
  await clock.advance(7 * 60e3) // passes at +3 and +6
  const errs = toasts.filter(t => /error/.test(t))
  expect(errs.length).toBeGreaterThanOrEqual(3)
  expect(errs[0]).not.toMatch(/×/)
  expect(errs[1]).toMatch(/×2$/)
  expect(errs[2]).toMatch(/×3$/)
  files['/r/PLAN.md'] = plan
  await clock.advance(11 * 60e3) // quiet for over 10 min
  delete files['/r/PLAN.md']
  const before = toasts.length
  await clock.advance(3 * 60e3)
  expect(toasts[before]).toMatch(/error/)
  expect(toasts[before]).not.toMatch(/×/)
})

const wait = (c: { advance: (ms: number) => Promise<unknown> }) => c.advance(3 * 60e3)

test('leaving waits and entering it again toasts again, with a count', async ($, on) => {
  let q = true
  const { toasts, clock } = await startRun($, on, { tail: () => (q ? 'Which branch?' : 'Ok.') })
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  q = false
  await wait(clock)
  q = true
  await wait(clock)
  expect(count(toasts, /waits/)).toBe(2)
  expect(toasts.filter(t => /waits/.test(t))[1]).toMatch(/×2$/)
})

test('a repeated blocked toast collapses to a count', async ($, on) => {
  const { toasts, files, clock } = await startRun($, on)
  files['/r/PLAN.md'] = PLAN.replace('[ ]', '[~]')
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  files['/r/PLAN.md'] = PLAN.replace('[ ]', '[~]')
  await wait(clock)
  const b = toasts.filter(t => /blocked/.test(t))
  expect(b[0]).not.toMatch(/×/)
  expect(b[1]).toMatch(/×2$/)
})

test('a repeated refused message collapses to a count after the reason changes back', async ($, on) => {
  let r = 'a'
  const { toasts, clock } = await startRun($, on, { deliver: () => ({ isDelivered: false, reason: r }) })
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  r = 'b'
  await wait(clock)
  r = 'a'
  await wait(clock)
  const t = toasts.filter(x => /send-refused/.test(x))
  expect(t.length).toBe(3)
  expect(t[2]).toMatch(/×3$/)
})

test('a judge that gives no verdict is an error toast', async ($, on) => {
  const { toasts, clock } = await startRun($, on, { tail: () => (done ? '[lot 1 done on b]' : 'Ready.') })
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  done = true
  await wait(clock)
  expect(count(toasts, /error → task 1/)).toBeGreaterThanOrEqual(1)
})
let done = false

test('retry and judge done only log', async ($, on) => {
  let verdict = '{"verdict":"retry","note":"nope","instructions":"fix"}'
  const { toasts, clock } = await startRun($, on, { tail: () => (done2 ? '[lot 1 done on b]' : 'Ready.'), judge: () => verdict })
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  done2 = true
  await wait(clock)
  expect(await log($)).toContain('retry')
  verdict = '{"verdict":"done","note":"fine"}'
  await wait(clock)
  expect(toasts).toEqual([])
})
let done2 = false

for (const action of ['answer', 'nudge']) {
  test(`a lead ${action} only logs`, async ($, on) => {
    const { toasts, clock } = await startRun($, on, { tail: 'Which branch?', judge: () => `[{"sessionId":"w1","action":"${action}","message":"Use main."}]` })
    await $.command.run({ command: 'oversee', args: 'run 10' } as never)
    await wait(clock)
    expect(await log($)).toContain(`${action} →`)
    expect(count(toasts, new RegExp(action))).toBe(0)
  })
}

test('different error texts under one label share one counter', async ($, on) => {
  const { toasts, files, clock } = await startRun($, on, { judge: () => '' })
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  delete files['/r/PLAN.md']
  await clock.advance(7 * 60e3)
  const errs = toasts.filter(t => /error → overseer/.test(t))
  expect(errs.length).toBeGreaterThanOrEqual(2)
  expect(errs[1]).toMatch(/×2$/)
})
