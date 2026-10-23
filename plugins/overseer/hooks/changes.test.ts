import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { changeMessage, lotMessage, openChanges, parsePlan } from './plan.ts'
import { peerOf } from './peers.ts'

// Lot 37: change requests on a lot, from the board's queue (requests/<slug>/<id>.json) to the session that holds the lot.
const T0 = Date.parse('2026-10-12T21:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const say = (id: string, min: number, text: string, extra: object[] = []) => JSON.stringify({ type: 'assistant', sessionId: id, cwd: `/r/${id}`, timestamp: iso(min), message: { content: [{ type: 'text', text }, ...extra] } })
const result = (id: string, min: number, toolId: string, content: string) => JSON.stringify({ type: 'user', sessionId: id, cwd: `/r/${id}`, timestamp: iso(min), message: { content: [{ type: 'tool_result', tool_use_id: toolId, content }] } })
const ONE = '# Plan — T\n\n## [ ] 1. First\ndone when: it works\n'
const TWO = `${ONE}\n## [ ] 2. Second\ndone when: it works\n`
const DIR = '/h/.claude/overseer/requests/r'
const BOARD = '/h/.claude/overseer/boards/r.json'

function setup(on: On, o: { tails: Record<string, string[]>; plan?: string; merged?: { v: boolean } }) {
  const files: Record<string, string> = { '/r/PLAN.md': o.plan ?? ONE }
  const sent: { to: string; text: string }[] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 + 5 * 60e3 })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
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
    if (c[0] === 'tail') return out((o.tails[String(c[c.length - 1]).match(/x\/([\w-]+)\.jsonl/)?.[1] ?? ''] ?? []).join('\n'))
    if (c.includes('--show-toplevel')) return out(c[c.indexOf('-C') + 1] === '/r' ? '/r' : c[c.indexOf('-C') + 1]!) // each session has its own working tree
    if (c.includes('merge-base')) return out('', o.merged?.v ? 0 : 1)
    if (c.includes('rev-parse')) return out('base123')
    if (c.includes('log')) return out('a1b2 feat: first')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"verdict":"done","note":"ok","instructions":""}', usage: {} } }) as never)
  on('session.send', (_$, e) => { sent.push({ to: String((e as unknown as { to: string | { sessionId: string } }).to && ((e as unknown as { to: { sessionId?: string } }).to.sessionId ?? (e as unknown as { to: string }).to)), text: (e as { text: string }).text }); return { isDelivered: true } as never })
  const board = () => JSON.parse(files[BOARD]!)
  const ask = (id: string, req: object) => { files[`${DIR}/${id}.json`] = JSON.stringify({ id, at: 1, ...req }) }
  const lot = (n: number) => parsePlan(files['/r/PLAN.md']!).lots.find(l => l.n === n)!
  const texts = (to?: string) => sent.filter(x => !to || x.to === to).map(x => x.text).join('\n---\n')
  return { files, sent, clock, board, ask, lot, texts }
}
const go = async ($: any, watch = 'w1') => {
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: `watch ${watch}` } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
}

test('the message a session reads, and the peer line that closes a request', () => {
  expect(changeMessage(4, { file: 'src/a.ts', line: 12, text: 'rename it' })).toBe('[overseer-change] task 4 · src/a.ts:12 · rename it')
  expect(changeMessage(4, { file: 'src/a.ts', text: 'rename it' })).toBe('[overseer-change] task 4 · src/a.ts · rename it')
  expect(changeMessage(4, { text: 'rename it' })).toBe('[overseer-change] task 4 · rename it')
  const p = peerOf([say('w1', 0, 'Made them.\n[change 4 done]')])!
  expect(p.changeDone).toEqual({ lot: 4, at: T0 })
  expect(peerOf([say('w1', 0, 'Not yet.')])!.changeDone).toBeUndefined()
})

test('a running lot: the change goes to its session as [overseer-change], is kept as sent, and [change N done] closes it', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails })
  await go($)
  expect(s.texts('w1')).toContain('Your task: 1. First')
  expect(s.texts('w1')).toContain('[change N done]') // SESSION_RULES, with the first lot
  s.sent.length = 0
  s.ask('c1', { kind: 'change', lot: 1, file: 'src/a.ts', line: 12, text: 'rename it' })
  await s.clock.advance(2000)
  expect(s.sent).toEqual([{ to: 'w1', text: '[overseer-change] task 1 · src/a.ts:12 · rename it' }]) // no "[overseer] " prefix
  expect(s.board().requests[0]).toMatchObject({ id: 'c1', kind: 'change', state: 'done' })
  expect(s.board().lots[0].changes).toEqual([{ id: 'c1', file: 'src/a.ts', line: 12, text: 'rename it', at: expect.any(Number), state: 'sent' }])
  expect(s.lot(1).status).toBe('running')
  tails.w1.push(say('w1', 6, 'Renamed.\n[change 1 done]'))
  await s.clock.advance(3 * 60e3)
  expect(s.board().lots[0].changes[0].state).toBe('done')
  expect(s.lot(1).status).toBe('running') // the lot goes on until its own marker
})

test('a running lot whose session is busy in a workflow: the change says it is queued until the workflow ends', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails })
  await go($)
  tails.w1.push(say('w1', 6, 'Launching.', [{ type: 'tool_use', id: 't1', name: 'Workflow', input: {} }]), result('w1', 6, 't1', 'Workflow launched in background. Task ID: wq1'), say('w1', 7, 'The lot runs in wq1.'))
  await s.clock.advance(3 * 60e3)
  s.ask('c1', { kind: 'change', lot: 1, text: 'use a smaller button' })
  await s.clock.advance(2000)
  expect(s.board().lots[0].changes[0]).toMatchObject({ state: 'sent', queued: 'queued until the workflow ends' })
  expect(s.texts('w1')).toContain('[overseer-change] task 1 · use a smaller button') // sent at once: the session reads it when its turn allows
})

test('a todo lot keeps the change, and the next lot message carries it', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, plan: TWO })
  await go($)
  s.sent.length = 0
  s.ask('c1', { kind: 'change', lot: 2, file: 'src/b.ts', line: 3, text: 'one more case' })
  await s.clock.advance(2000)
  expect(s.sent).toEqual([]) // nobody holds lot 2: nothing is sent
  expect(s.lot(2).status).toBe('todo')
  expect(s.board().lots[1].changes[0]).toMatchObject({ state: 'sent', file: 'src/b.ts', line: 3 })
  tails.w1.push(say('w1', 6, 'Done.\n[lot 1 done on feat/a]'))
  await s.clock.advance(5 * 60e3)
  const msg = s.texts('w1')
  expect(msg).toContain('Your task: 2. Second')
  expect(msg).toContain('Changes requested (write [change 2 done] when they are made):\n- src/b.ts:3 · one more case')
})

test('a blocked lot keeps the change; set back to [ ], its next message carries it and the branch it left', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails })
  await go($)
  tails.w1.push(say('w1', 6, 'Stuck.\n[lot 1 blocked: needs the API key]'))
  await s.clock.advance(5 * 60e3)
  expect(s.lot(1).status).toBe('blocked')
  s.ask('c1', { kind: 'change', lot: 1, text: 'mock the API instead' })
  await s.clock.advance(2000)
  expect(s.lot(1).status).toBe('blocked')
  expect(openChanges(s.lot(1))).toHaveLength(1)
  s.files['/r/PLAN.md'] = s.files['/r/PLAN.md']!.replace('## [!] 1.', '## [ ] 1.') // the person sets it back
  s.sent.length = 0
  tails.w1.push(say('w1', 12, 'Ready.'))
  await s.clock.advance(5 * 60e3)
  expect(s.texts('w1')).toContain('- mock the API instead')
})

test('a done lot is reopened: [ ], no session or verdict, its branch kept, "continue on <branch>", its last session the owner; twice', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails })
  await go($)
  tails.w1.push(say('w1', 6, 'Done.\n[lot 1 done on feat/a]'))
  await s.clock.advance(5 * 60e3)
  expect(s.lot(1)).toMatchObject({ status: 'done', session: 'w1', branch: 'feat/a', verdict: { verdict: 'done' } })
  s.sent.length = 0
  s.ask('c1', { kind: 'change', lot: 1, file: 'a.ts', text: 'first request' })
  await s.clock.advance(2000)
  const md = s.files['/r/PLAN.md']!
  expect(md).toContain('## [ ] 1.')
  expect(md).not.toMatch(/^session:/m)
  expect(md).not.toMatch(/^verdict(At)?:/m)
  expect(s.lot(1)).toMatchObject({ status: 'todo', branch: 'feat/a', owner: 'w1' })
  expect(s.sent).toEqual([]) // reopened, not sent: it goes out with the lot
  tails.w1.push(say('w1', 12, 'Ready.'))
  await s.clock.advance(4 * 60e3)
  expect(s.texts('w1')).toContain('continue on feat/a')
  expect(s.texts('w1')).toContain('- a.ts · first request')
  // second round: done again, the verdict closes the first request, a second one reopens it again
  tails.w1.push(say('w1', 20, 'Made it.\n[lot 1 done on feat/a]'))
  await s.clock.advance(5 * 60e3)
  expect(s.lot(1).status).toBe('done')
  expect(s.board().lots[0].changes.map((c: { state: string }) => c.state)).toEqual(['done'])
  s.ask('c2', { kind: 'change', lot: 1, text: 'second request' })
  await s.clock.advance(2000)
  expect(s.lot(1)).toMatchObject({ status: 'todo', owner: 'w1', branch: 'feat/a' })
  expect(s.board().lots[0].changes.map((c: { id: string; state: string }) => [c.id, c.state])).toEqual([['c1', 'done'], ['c2', 'sent']])
  tails.w1.push(say('w1', 21, 'Ready.'))
  s.sent.length = 0
  await s.clock.advance(4 * 60e3)
  expect(s.texts('w1')).toContain('continue on feat/a')
  expect(s.texts('w1')).toContain('- second request')
  expect(s.texts('w1')).not.toContain('first request') // closed: not carried again
})

test('a merged branch is not continued on', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, merged: { v: true } })
  await go($)
  tails.w1.push(say('w1', 6, 'Done.\n[lot 1 done on feat/a]'))
  await s.clock.advance(5 * 60e3)
  s.ask('c1', { kind: 'change', lot: 1, text: 'tweak' })
  await s.clock.advance(2000)
  tails.w1.push(say('w1', 12, 'Ready.'))
  s.sent.length = 0
  await s.clock.advance(4 * 60e3)
  expect(s.texts('w1')).toContain('Your task: 1. First')
  expect(s.texts('w1')).not.toContain('continue on')
})

test('a reopened lot belongs to its last session while that one is watched; when it is not, another free session takes it', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')], w2: [say('w2', 0, 'Ready.')] }
  const s = setup(on, { tails })
  await go($, 'w1')
  tails.w1.push(say('w1', 6, 'Done.\n[lot 1 done on feat/a]'))
  await s.clock.advance(5 * 60e3)
  await $.command.run({ command: 'oversee', args: 'watch w2' } as never)
  s.ask('c1', { kind: 'change', lot: 1, text: 'tweak' })
  await s.clock.advance(2000)
  expect(s.lot(1).owner).toBe('w1')
  s.sent.length = 0
  tails.w1.push(say('w1', 9, 'Ready.'))
  await s.clock.advance(5 * 60e3)
  expect(s.texts('w2')).not.toContain('Your task') // w2 is free, the lot is w1's
  expect(s.texts('w1')).toContain('Your task: 1. First') // and w1, free again, takes it
})

test('a reopened lot whose last session is no longer watched goes to another free session, on the same branch', async ($, on) => {
  const A = '11111111-aaaa-bbbb-cccc-000000000001', B = '22222222-aaaa-bbbb-cccc-000000000002' // session ids are uuids
  const tails = { [A]: [say(A, 0, 'Ready.')], [B]: [say(B, 0, 'Ready.')] }
  const s = setup(on, { tails })
  await go($, A)
  tails[A].push(say(A, 6, 'Done.\n[lot 1 done on feat/a]'))
  await s.clock.advance(5 * 60e3)
  s.ask('c1', { kind: 'change', lot: 1, text: 'tweak' })
  await s.clock.advance(2000)
  expect(s.lot(1).owner).toBe(A)
  s.sent.length = 0
  await $.command.run({ command: 'oversee', args: `drop ${A}` } as never)
  await $.command.run({ command: 'oversee', args: `watch ${B}` } as never) // a pass runs at once: B takes the lot there
  await s.clock.advance(5 * 60e3)
  expect(s.texts(B)).toContain('Your task: 1. First')
  expect(s.texts(B)).toContain('continue on feat/a')
  expect(s.lot(1)).toMatchObject({ status: 'running', session: B })
  expect(s.texts(A)).toBe('')
})

test('a change on an unknown lot is dropped with a reason', async ($, on) => {
  const s = setup(on, { tails: { w1: [say('w1', 0, 'Ready.')] } })
  await go($)
  s.ask('c1', { kind: 'change', lot: 9, text: 'x' })
  await s.clock.advance(2000)
  expect(s.board().requests[0]).toMatchObject({ id: 'c1', state: 'dropped', why: 'no task 9 in the plan' })
})

test('lotMessage carries only the open changes, and the branch to continue on', () => {
  const lot = { n: 3, title: 'T', status: 'todo' as const, doneWhen: 'x', depends: [], body: '', changes: [{ id: 'a', text: 'old', at: 1, state: 'done' as const }, { id: 'b', file: 'f.ts', line: 2, text: 'new', at: 2, state: 'sent' as const }] }
  const m = lotMessage('G', lot, false, 'feat/x')
  expect(m).toContain('- f.ts:2 · new')
  expect(m).not.toContain('old')
  expect(m).toContain('continue on feat/x')
  expect(lotMessage('G', { ...lot, changes: undefined }, false)).not.toContain('Changes requested')
})
