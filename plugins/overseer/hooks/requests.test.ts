import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { quietClock } from './clock.testkit.ts'
import { forgetModuleMemory } from './register.tsx'
import { parsePlan } from './plan.ts'

// Lot 36: the board's write queue (~/.claude/overseer/requests/<slug>/<id>.json), read by the lead on its 2 s clock.
const T0 = Date.parse('2026-10-12T21:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const say = (id: string, min: number, text: string) => JSON.stringify({ type: 'assistant', sessionId: id, cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'text', text }] } })
const PLAN = `# Plan — T

## [ ] 1. First
done when: it works
check: ./check.sh

## [ ] 2. Second
done when: it works
`
const DIR = '/h/.claude/overseer/requests/r'
const BOARD = '/h/.claude/overseer/boards/r.json'

// a pass with a plan running reads the weekly limit once: that call counts the passes
function setup(on: On, o: { tails: Record<string, string[]>; plan?: string; me?: { id: string }; hold?: { gate?: Promise<void> }; noTick?: boolean }) {
  const files: Record<string, string> = { '/r/PLAN.md': o.plan ?? PLAN }
  const sent: string[] = []
  let reads = 0
  const me = o.me ?? { id: 'lead' }
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(o.noTick ? quietClock(on, 1000) : on, { now: T0 + 5 * 60e3 }) // noTick: no pane here, so the 1 s tick goes; the 2 s request poll stays
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: me.id }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => (reads++, { value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'rm') { delete files[c[2]!]; return out('') }
    if (c[0] === 'ls') return out(Object.keys(files).filter(k => k.startsWith(`${c[1]}/`)).map(k => k.slice(c[1]!.length + 1)).join('\n'))
    if (c[0] === 'find') return out(Object.keys(o.tails).map(id => `/h/.claude/projects/x/${id}.jsonl`).join('\n'))
    if (c[0] === 'tail') return out((o.tails[String(c[c.length - 1]).match(/x\/(\w+)\.jsonl/)?.[1] ?? ''] ?? []).join('\n'))
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse')) return out('base123')
    if (c.includes('log')) return out('a1b2 feat: first')
    return out('')
  })
  on('model.complete', async () => { await o.hold?.gate; return { value: { isAnswered: true, text: '{"verdict":"done","note":"ok","instructions":""}', usage: {} } } as never })
  on('session.send', (_$, e) => { sent.push((e as { text: string }).text); return { isDelivered: true } as never })
  const board = () => JSON.parse(files[BOARD]!)
  const ask = (id: string, req: object) => { files[`${DIR}/${id}.json`] = JSON.stringify({ id, at: 1, ...req }) }
  return { files, sent, clock, board, ask, passes: () => reads }
}
const go = async ($: any, watch = 'w1') => {
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: `watch ${watch}` } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
}

test('not the lead: the request file stays and nothing is sent', async ($, on) => {
  const me = { id: 'lead' }
  const s = setup(on, { tails: { w1: [say('w1', 0, 'Ready.')] }, me })
  await go($)
  await s.clock.advance(2000) // the first pass writes the board as lead
  me.id = 'other' // the board says lead; this session is not
  s.sent.length = 0
  s.ask('a1', { kind: 'lot', lot: 1, action: 'done' })
  await s.clock.advance(4000)
  expect(`${DIR}/a1.json` in s.files).toBe(true)
  expect(s.sent).toEqual([])
  expect(s.files['/r/PLAN.md']).not.toContain('[x]')
})

test('kinds: a lot done marks [x]; an unknown lot, a retry with no session, gate for a session not watched, plan for a lot that is not proposed and junk are dropped with a reason', async ($, on) => {
  const s = setup(on, { tails: { w1: [say('w1', 0, 'Ready.')] } })
  await go($)
  s.ask('d1', { kind: 'lot', lot: 1, action: 'done' })
  s.ask('d2', { kind: 'lot', lot: 9, action: 'done' })
  s.ask('d3', { kind: 'lot', lot: 2, action: 'retry' })
  s.ask('d4', { kind: 'change', lot: 2, text: 'x' })
  s.ask('d5', { kind: 'gate', session: 'x', plan: 'p', action: 'approve' })
  s.ask('d6', { kind: 'plan', approve: [3] })
  s.files[`${DIR}/d7.json`] = '{nope'
  s.ask('d8', { kind: 'burn' })
  await s.clock.advance(2000)
  expect(s.files['/r/PLAN.md']).toContain('## [x] 1.')
  expect(Object.keys(s.files).filter(k => k.startsWith(DIR))).toEqual([])
  const why = Object.fromEntries(s.board().requests.map((r: { id: string; state: string; why?: string }) => [r.id, r.state === 'done' ? 'done' : r.why]))
  expect(why).toMatchObject({ d1: 'done', d2: 'no task 9 in the plan', d3: 'task 2 has no session', d7: 'bad request', d8: 'bad request' }) // lot 54: retry is built, and needs a session
  expect(why.d4).toBe('done') // lot 37: a change on a todo lot is kept for its next message
  expect(why.d5).toBe('the session is not watched') // lot 48: the gate handler refuses a session the board does not watch
  expect(why.d6).toBe('no task 3 in the plan') // lot 53: plan approve names lots that are not [?]
})

test('paused: a free session gets no lot while a running lot is still judged; resume hands it out; paused survives a reload; /oversee off clears it, run starts live', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, noTick: true })
  await go($)
  expect(s.sent.join('\n')).toContain('Your task: 1. First')
  s.ask('p1', { kind: 'run', paused: true })
  await s.clock.advance(2000)
  expect(s.board().paused).toBe(true)
  forgetModuleMemory()
  tails.w1.push(say('w1', 6, 'Done.\n[lot 1 done on feat/a]'))
  s.sent.length = 0
  await s.clock.advance(10 * 60e3)
  expect(s.files['/r/PLAN.md']).toContain('## [x] 1.') // judged: the judge goes on
  expect(s.sent.join('\n')).not.toContain('Your task: 2')
  expect(s.board().paused).toBe(true)
  s.ask('p2', { kind: 'run', paused: false })
  await s.clock.advance(5 * 60e3)
  expect(s.board().paused).toBe(false)
  expect(s.sent.join('\n')).toContain('Your task: 2. Second')
  s.ask('p3', { kind: 'run', paused: true })
  await s.clock.advance(2000)
  expect(s.board().paused).toBe(true)
  await $.command.run({ command: 'oversee', args: 'off' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  expect(s.board().paused).toBe(false) // off cleared it
  s.sent.length = 0
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  expect(s.board().paused).toBe(false) // run starts live
})

test('run with no plan running is dropped', async ($, on) => {
  const s = setup(on, { tails: { w1: [say('w1', 0, 'Ready.')] } })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  s.ask('n1', { kind: 'run', paused: true })
  await s.clock.advance(2000)
  expect(s.board().requests).toMatchObject([{ id: 'n1', state: 'dropped', why: 'no plan running' }])
})

test('/pass: the pass starts within 5 s, the clock starts over from it, no extra pass inside everyMs', async ($, on) => {
  const s = setup(on, { tails: { w1: [say('w1', 0, 'Ready.')] } })
  await go($)
  await s.clock.advance(60e3)
  const n = s.passes()
  s.ask('q1', { kind: 'pass' })
  await s.clock.advance(2000)
  expect(s.passes()).toBe(n + 1)
  const next = s.board().nextPassAt
  expect(next - s.board().at).toBeGreaterThan(170e3) // a fresh 3 min from this pass, not what is left of the old timer
  await s.clock.advance(179999) // the old timer was due at t0+180000
  expect(s.passes()).toBe(n + 1)
  await s.clock.advance(1)
  expect(s.passes()).toBe(n + 2)
})

test('/pass during a pass runs exactly one more pass after it', async ($, on) => {
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const hold: { gate?: Promise<void> } = {}
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, hold })
  await go($)
  tails.w1.push(say('w1', 6, 'Done.\n[lot 1 done on feat/a]'))
  hold.gate = gate // the next judge call hangs
  await s.clock.advance(3 * 60e3)
  expect(s.board().passing).toBe(true)
  const n = s.passes()
  s.ask('q1', { kind: 'pass' })
  await s.clock.advance(2000)
  expect(s.passes()).toBe(n) // queued, not started
  release()
  await s.clock.advance(0)
  await s.clock.advance(1000)
  expect(s.passes()).toBe(n + 1)
  expect(s.board().passing).toBe(false)
  await s.clock.advance(60e3)
  expect(s.passes()).toBe(n + 1)
})

test('board fields: paused, passEvery, passing, and the error with its time and source', async ($, on) => {
  const s = setup(on, { tails: { w1: [say('w1', 0, 'Ready.')] } })
  await go($)
  expect(s.board()).toMatchObject({ paused: false, passEvery: 180000, passing: false })
  expect(s.board().error).toBeUndefined()
  delete s.files['/r/PLAN.md']
  await s.clock.advance(3 * 60e3)
  expect(s.board().error).toEqual({ text: 'no PLAN.md at /r', at: expect.any(Number), source: 'plan' })
})

const PROPOSED = `# Plan — T

## [x] 1. First
done when: it works

## [?] 3. Third
done when: it works
depends: 1
`

test('lot 53: a POST /plan approve turns [?] into [ ] on the next 2 s tick; a lot that is not proposed is dropped with its reason', async ($, on) => {
  const s = setup(on, { tails: { w1: [say('w1', 0, 'Ready.')] }, plan: PROPOSED })
  await go($)
  expect(s.files['/r/PLAN.md']).toContain('## [?] 3.') // proposed lots are never handed out
  expect(s.sent.join('\n')).not.toContain('Your task: 3')
  expect(s.board().proposed).toEqual([3])
  expect(s.board().needs.filter((n: { id: string }) => n.id === 'plan')).toMatchObject([{ id: 'plan', text: 'Approve 1 new task of PLAN.md?' }])
  s.ask('p1', { kind: 'plan', approve: [3] })
  s.ask('p2', { kind: 'plan', approve: [1] })
  await s.clock.advance(2000)
  expect(s.files['/r/PLAN.md']).toContain('## [ ] 3.')
  const r = Object.fromEntries(s.board().requests.map((x: { id: string }) => [x.id, x]))
  expect(r.p1).toMatchObject({ state: 'done' })
  expect(r.p2).toMatchObject({ state: 'dropped', why: 'task 1 is not proposed' })
  expect(s.board().proposed).toEqual([])
  expect(s.board().needs.some((n: { id: string }) => n.id === 'plan')).toBe(false)
})

test('lot 53: a POST /plan change appends one "sent" entry to the lot\'s changes (the JSON list of lot 37) and keeps [?]', async ($, on) => {
  const s = setup(on, { tails: { w1: [say('w1', 0, 'Ready.')] }, plan: PROPOSED })
  await go($)
  s.ask('c1', { kind: 'plan', change: { lot: 3, text: 'split it' } })
  await s.clock.advance(2000)
  const lot3 = () => parsePlan(s.files['/r/PLAN.md']!).lots.find(l => l.n === 3)!
  expect(lot3().status).toBe('proposed')
  expect(lot3().changes).toEqual([{ id: 'c1', text: 'split it', at: expect.any(Number), state: 'sent' }])
  s.ask('c2', { kind: 'plan', change: { lot: 3, text: 'split it in two' } })
  s.ask('c3', { kind: 'plan', change: { lot: 1, text: 'x' } })
  await s.clock.advance(2000)
  expect(lot3().changes!.map(c => [c.id, c.text, c.state])).toEqual([['c1', 'split it', 'sent'], ['c2', 'split it in two', 'sent']])
  expect(s.files['/r/PLAN.md']!.match(/^change:/gm)).toEqual(['change:'])
  expect(s.files['/r/PLAN.md']).toContain('## [?] 3.')
  expect(s.board().requests.find((x: { id: string }) => x.id === 'c3')).toMatchObject({ state: 'dropped', why: 'task 1 is not proposed' })
})

test('task 76: a POST /plan decline ("Not now") takes the [?] task out of the plan and files it under « En attente »; a task that is not proposed is dropped with its reason', async ($, on) => {
  const s = setup(on, { tails: { w1: [say('w1', 0, 'Ready.')] }, plan: `${PROPOSED}\n## En attente\n\nKept for later.\n\n- **Old idea.** Not now (from x, 2026-10-01)\n` })
  await go($)
  s.ask('n1', { kind: 'plan', decline: [3] })
  s.ask('n2', { kind: 'plan', decline: [1] })
  await s.clock.advance(2000)
  const md = s.files['/r/PLAN.md']!
  expect(parsePlan(md).lots.map(l => l.n)).toEqual([1]) // task 3 left the plan
  expect(md).toMatch(/## En attente[\s\S]*- \*\*Old idea\.\*\* Not now[\s\S]*- \*\*Third\.\*\*/) // after the entry that was there
  const r = Object.fromEntries(s.board().requests.map((x: { id: string }) => [x.id, x]))
  expect(r.n1).toMatchObject({ state: 'done' })
  expect(r.n2).toMatchObject({ state: 'dropped', why: 'task 1 is not proposed' })
  expect(s.board().proposed).toEqual([])
})
