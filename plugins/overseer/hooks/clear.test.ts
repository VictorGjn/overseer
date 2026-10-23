import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { newIdOf, renameOversight, renamePlan } from './follow.ts'

// Lot 56: an empty context for each task. A worker that runs /clear goes on under a new id; the lead follows it there.
const OLD = '0123abcd-0000-4000-8000-000000000001', NEW = '9876fedc-0000-4000-8000-000000000002'
const W = { sessionId: OLD, label: 'alpha', file: `/h/.claude/projects/x/${OLD}.jsonl`, pid: 4242, procStart: 'Thu Oct 22 06:18:28 2026' }

test('where a cleared session went: its own note first, else the same pid AND the same process start, never the cwd', () => {
  const reg = (o: Record<string, { pid?: number; procStart?: string }>) => new Map(Object.entries(o))
  expect(newIdOf(W, { old: OLD, new: NEW, at: 1 }, reg({ [OLD]: { pid: 4242, procStart: W.procStart } }))).toBe(NEW) // the note, even while the old id is still registered
  expect(newIdOf(W, undefined, reg({ [NEW]: { pid: 4242, procStart: W.procStart } }))).toBe(NEW) // the registry: same process
  expect(newIdOf(W, undefined, reg({ [OLD]: { pid: 4242, procStart: W.procStart }, [NEW]: { pid: 4242, procStart: W.procStart } }))).toBeUndefined() // the old id still there: not moved yet
  expect(newIdOf(W, undefined, reg({ [NEW]: { pid: 5151, procStart: W.procStart } }))).toBeUndefined() // same cwd and start, another pid
  expect(newIdOf(W, undefined, reg({ [NEW]: { pid: 4242, procStart: 'Fri Oct 23 09:00:00 2026' } }))).toBeUndefined() // a reused pid
  expect(newIdOf({ ...W, pid: undefined }, undefined, reg({ [NEW]: { pid: 4242, procStart: W.procStart } }))).toBeUndefined() // never seen its process
  expect(newIdOf(W, { old: 'someone-else', new: NEW, at: 1 }, reg({}))).toBeUndefined()
})

test('the rename: PLAN.md session and owner lines only; the watch list keeps the label; the records follow', () => {
  const md = `## [~] 1. A\nsession: ${OLD}\nowner: ${OLD}\nnote: talked to ${OLD}\n\n## [ ] 2. B\nsession: other\n`
  expect(renamePlan(md, OLD, NEW)).toBe(`## [~] 1. A\nsession: ${NEW}\nowner: ${NEW}\nnote: talked to ${OLD}\n\n## [ ] 2. B\nsession: other\n`)
  const o = renameOversight({ isOn: true, passes: 1, log: [], watched: [W, { sessionId: 'b', label: 'beta', file: '/x/b.jsonl' }], sent: { [OLD]: 5 }, budgetTold: { [OLD]: { level: 'normal', at: 1 } }, tokens: { 1: { session: OLD, from: 0, files: {}, wf: {} } }, run: { top: '/r', planPath: '/r/PLAN.md', budget: 15, weeklyAt: 0, weeklyNow: 0, level: 'normal', assigned: [{ lot: 1, sessionId: OLD, cwd: '/r', base: 'b', assignedAt: 1, tries: 0 }] } }, OLD, NEW)
  expect(o.watched[0]).toEqual({ ...W, sessionId: NEW, file: `/h/.claude/projects/x/${NEW}.jsonl` })
  expect(o.watched[1]!.sessionId).toBe('b')
  expect(o.run!.assigned[0]!.sessionId).toBe(NEW)
  expect(o.sent).toEqual({ [NEW]: 5 })
  expect(Object.keys(o.budgetTold!)).toEqual([NEW])
  expect(o.tokens![1]!.session).toBe(NEW)
})

// ---- the lead, on a short plan
const T0 = Date.parse('2026-10-22T10:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const say = (id: string, min: number, text: string) => JSON.stringify({ type: 'assistant', sessionId: id, cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'text', text }] } })
const REG = (id: string) => JSON.stringify({ pid: 4242, sessionId: id, cwd: '/r', procStart: W.procStart, name: 'alpha', status: 'idle', messagingSocketPath: '/s/4242.sock' })
const PLAN = (one = '[ ] 1. First', two = '') => `# Plan — T\n\n## ${one}\ndone when: it works\n${two ? `\n## ${two}\ndone when: it works\n` : ''}`
function setup(on: On, o: { plan: string; worker?: boolean }) {
  const files: Record<string, string> = { '/r/PLAN.md': o.plan, '/h/.claude/sessions/4242.json': REG(OLD), [`/h/.claude/projects/x/${OLD}.jsonl`]: say(OLD, 0, 'Ready.'), '/h/.claude/sessions/1.json': JSON.stringify({ pid: 1, sessionId: 'lead', name: 'lead', messagingSocketPath: '/s/1.sock' }) }
  if (o.worker) files[`/h/.claude/overseer/workers/${OLD}.json`] = '{"clear":true}'
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
  on('http.fetch', () => ({ deny: 'none' }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'rm') { delete files[c[2]!]; return out('') }
    if (c[0] === 'find') return out(Object.keys(files).filter(f => (c[1]!.endsWith('/sessions') ? f.startsWith('/h/.claude/sessions/') : f.endsWith('.jsonl'))).join('\n'))
    if (c[0] === 'tail') return out(files[c[c.length - 1]!] ?? '', files[c[c.length - 1]!] === undefined ? 1 : 0)
    if (c[0] === 'kill') return out('')
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse')) return out('base1')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"verdict":"done","note":"ok","instructions":""}', usage: {} } }) as never)
  on('session.send', (_$, e) => { const x = e as unknown as { to: string | { sessionId: string }; text: string }; sent.push({ to: typeof x.to === 'string' ? x.to : x.to.sessionId, text: x.text }); return { isDelivered: true } as never })
  // the worker runs /clear: the registry entry of its process now holds the new id; its new transcript does not exist yet
  const clear = (note = false) => { files['/h/.claude/sessions/4242.json'] = REG(NEW); if (note) files[`/h/.claude/overseer/cleared/${OLD}.json`] = JSON.stringify({ old: OLD, new: NEW, at: T0 }) }
  const board = () => JSON.parse(files['/h/.claude/overseer/boards/r.json']!)
  const pass = () => clock.advance(3 * 60e3 + 10)
  return { files, sent, clock, clear, board, pass }
}
const go = async ($: Engine, ids = OLD) => {
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: `watch ${ids}` } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
}
const log = async ($: Engine) => ((await $.command.run({ command: 'oversee', args: 'log' } as never)) as unknown as { text: string }).text

test('replay: a task is assigned, the worker clears, and the board and PLAN.md name the new id; the task is sent again with the rules', async ($, on) => {
  const s = setup(on, { plan: PLAN() })
  await go($)
  expect(s.sent.filter(x => x.to === OLD && x.text.includes('Your task: 1. First')).length).toBe(1)
  expect(s.files['/r/PLAN.md']).toContain(`session: ${OLD}`)
  s.clear() // by hand, no note: the registry match on pid and process start
  await s.pass()
  expect(s.files['/r/PLAN.md']).toContain(`session: ${NEW}`)
  expect(s.files['/r/PLAN.md']).toContain('## [~] 1. First') // still its task, not freed
  const b = s.board()
  expect(b.sessions.map((x: { sessionId: string; label: string }) => [x.sessionId, x.label])).toEqual([[NEW, 'alpha']])
  const again = s.sent.filter(x => x.to === NEW && x.text.includes('Your task: 1. First'))
  expect(again.length).toBe(1)
  expect(again[0]!.text).toContain('You are one of several Claude Code sessions') // the rules: its context is empty
  const l = await log($)
  expect(l).toContain(`alpha cleared its context: ${OLD.slice(0, 8)} → ${NEW.slice(0, 8)}, task 1 stays with it`)
  expect(l).not.toMatch(/ended: task 1 is free again/)
  await s.pass()
  expect(s.sent.filter(x => x.to === NEW && x.text.includes('Your task: 1.')).length).toBe(1) // once
})

test('an idle worker with no task: /clear frees nothing and drops no watch; its next task goes to the new id', async ($, on) => {
  const s = setup(on, { plan: PLAN('[x] 1. First') })
  await go($)
  s.clear(true) // its mod's note
  await s.pass()
  expect(s.board().sessions.map((x: { sessionId: string }) => x.sessionId)).toEqual([NEW])
  expect(s.files['/r/PLAN.md']).toBe(PLAN('[x] 1. First'))
  expect(`/h/.claude/overseer/cleared/${OLD}.json` in s.files).toBe(false) // read, then removed
  s.files['/r/PLAN.md'] = PLAN('[x] 1. First', '[ ] 2. Second')
  await s.pass()
  expect(s.sent.filter(x => x.to === NEW && x.text.includes('Your task: 2. Second')).length).toBe(1) // fresh: free without a transcript
})

test('between two tasks the worker is asked to clear itself; its next task goes to the new id, with the rules', async ($, on) => {
  const s = setup(on, { plan: PLAN('[ ] 1. First'), worker: true })
  await go($)
  expect(s.sent.filter(x => x.to === OLD && x.text.includes('Your task: 1.')).length).toBe(1) // its first task: nothing to clear
  s.files[`/h/.claude/projects/x/${OLD}.jsonl`] += `\n${say(OLD, 6, 'Done.\n[lot 1 done on lot/1-first]')}`
  s.files['/r/PLAN.md'] = s.files['/r/PLAN.md']! + '\n## [ ] 2. Second\ndone when: it works\n'
  await s.clock.advance(2010) // the start's second pass: task 1 judged done; task 2 ready: the worker is asked to clear first
  expect(s.files['/r/PLAN.md']).toContain('## [x] 1. First')
  expect(s.sent.filter(x => x.to === OLD).map(x => x.text).at(-1)).toMatch(/^\[overseer-clear\]/)
  expect(s.sent.some(x => x.text.includes('Your task: 2.'))).toBe(false)
  s.clear(true)
  await s.pass()
  const two = s.sent.filter(x => x.to === NEW && x.text.includes('Your task: 2. Second'))
  expect(two.length).toBe(1)
  expect(two[0]!.text).toContain('You are one of several Claude Code sessions')
})

test('a worker that does not clear (an older mod, a refused command): after one pass its next task goes anyway, with a log line', async ($, on) => {
  const s = setup(on, { plan: PLAN('[ ] 1. First'), worker: true })
  await go($)
  s.files[`/h/.claude/projects/x/${OLD}.jsonl`] += `\n${say(OLD, 6, 'Done.\n[lot 1 done on lot/1-first]')}`
  s.files['/r/PLAN.md'] = s.files['/r/PLAN.md']! + '\n## [ ] 2. Second\ndone when: it works\n'
  await s.clock.advance(2010)
  expect(s.sent.at(-1)!.text).toMatch(/^\[overseer-clear\]/)
  await s.pass()
  expect(s.sent.filter(x => x.to === OLD && x.text.includes('Your task: 2. Second')).length).toBe(1)
  expect(await log($)).toContain('did not clear its context: its next task goes anyway')
})

test('CAUTION: the overseer never clears itself: watched as self, it gets its next task with no clear request', async ($, on) => {
  const s = setup(on, { plan: PLAN('[ ] 1. First') })
  s.files['/h/.claude/projects/x/lead.jsonl'] = say('lead', 0, 'Ready.')
  s.files['/h/.claude/overseer/workers/lead.json'] = '{"clear":true}'
  await go($, 'self')
  s.files['/h/.claude/projects/x/lead.jsonl'] += `\n${say('lead', 6, 'Done.\n[lot 1 done on lot/1-first]')}`
  s.files['/r/PLAN.md'] = s.files['/r/PLAN.md']! + '\n## [ ] 2. Second\ndone when: it works\n'
  await s.pass()
  expect(s.sent.some(x => x.text.includes('[overseer-clear]'))).toBe(false)
})

// ---- the worker's side: [overseer-clear] only from its lead, never in the lead's own session
const F = (sock: string, body: string) => `<cross-session-message from="uds:${sock}" from-name="n">${body}</cross-session-message>`
function worker(on: On, self: string) {
  const files: Record<string, string> = { '/h/.claude/sessions/1.json': JSON.stringify({ sessionId: 'lead', name: 'lead', messagingSocketPath: '/s/1.sock' }), '/h/.claude/sessions/2.json': JSON.stringify({ sessionId: 'x', name: 'x', messagingSocketPath: '/s/2.sock' }) }
  const store: Record<string, unknown> = { board: { at: 1, overseer: 'lead', sessions: [], lots: [], feed: [] } }
  const cleared: string[] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 })
  on('store.get', (_$, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.keys', () => ({ value: Object.keys(store) }) as never)
  on('session.id', () => ({ value: self }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: (e as { argv: string[] }).argv[0] === 'find' ? Object.keys(files).join('\n') : '', stderr: '' } }) as never)
  on('session.receive', (_$, e) => ({ text: (e as { text: string }).text }) as never)
  on('command.run', (_$, e) => { cleared.push((e as { command: string }).command); return { value: { text: '' } } as never })
  return { cleared, clock }
}
const recv = ($: Engine, text: string) => $.session.receive({ origin: { kind: 'peer' }, text } as never)

test('the worker clears itself on its lead\'s [overseer-clear], and the message is consumed', async ($, on) => {
  const w = worker(on, 'me')
  expect(await recv($, F('/s/1.sock', '[overseer-clear] Your next task comes in a fresh context: clear this one.'))).toMatchObject({ consumed: expect.any(String) })
  await w.clock.advance(1)
  expect(w.cleared).toEqual(['clear'])
})

test('another session\'s [overseer-clear] passes through; the lead\'s own session never clears', async ($, on) => {
  const w = worker(on, 'me')
  expect(await recv($, F('/s/2.sock', '[overseer-clear] clear this one.'))).toMatchObject({ text: expect.any(String) }) // not the lead
  await w.clock.advance(1)
  expect(w.cleared).toEqual([])
})

test('CAUTION: in the overseer\'s own session, [overseer-clear] is refused even from itself', async ($, on) => {
  const w = worker(on, 'lead')
  expect(await recv($, F('/s/1.sock', '[overseer-clear] clear this one.'))).toMatchObject({ text: expect.any(String) })
  await w.clock.advance(1)
  expect(w.cleared).toEqual([])
})
