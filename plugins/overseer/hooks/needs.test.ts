import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { answerFrom, answerResult } from './answer.ts'
import { actionOf, actionsOf, cmdOf, needsYou, type Board, type BoardSession, type Need } from './board.ts'
import { reviewOf } from './plan.ts'
import { installedVersion } from './register.tsx'

// Lot 54: a card and an action for each need. Each need kind's action changes PLAN.md, the log or the session input.
const T0 = Date.parse('2026-10-22T10:00:00Z')
const REINSTALL = 'reinstall: claude plugin update overseer@claude-mods, then restart the overseer session' // lots 29 and 44, as written
const LOOK = '- The live page `index.html` did not change. Nobody opened the two new mockup designs (empty project and "not exported yet") in a browser, so Victor must look at them.' // lot 30's report
const s = (id: string, stage: BoardSession['stage'], o: Partial<BoardSession> = {}): BoardSession => ({ sessionId: id, label: id, stage, since: T0 - 60e3, lastText: '', tries: 0, ...o })
const lot = (n: number, status: 'todo' | 'running' | 'done' | 'blocked', o: object = {}) => ({ n, title: `t${n}`, status, depends: [] as number[], ...o })
const EVERY: Board = {
  at: T0 - 20 * 60e3, overseer: 'lead-id', repo: '/r', goal: 'g', nextPassAt: T0, feed: [],
  budget: { spent: 9, budget: 15, level: 'reduce' },
  sessions: [s('w-ask', 'waits', { lot: 1, question: 'Which?' }), s('w-dep', 'waits', { lot: 2, departs: 'it changes the API' }), s('w-gate', 'gate', { lot: 3, gate: { name: 'build', fp: 'abcd1234' } as never }), s('w-stuck', 'stuck', { lot: 4 })],
  lots: [lot(1, 'running'), lot(2, 'running'), lot(3, 'running'), lot(4, 'running'), lot(5, 'blocked', { note: 'needs the DB key: export DB_KEY=…, then rerun' }), lot(6, 'blocked', { note: REINSTALL }),
    lot(7, 'running', { noVerdict: true }), lot(8, 'done', { review: LOOK.slice(2) }), lot(9, 'todo', { brief: { type: 'feature', criteria: ['x'] } })],
}

test('every need kind has its action, and action i is need i\'s (the web export pairs them)', () => {
  const needs = needsYou(EVERY, T0)
  expect(needs.map(n => n.kind)).toEqual(['waits', 'departs', 'gate', 'stuck', 'blocked', 'reinstall', 'judge', 'review', 'incomplete', 'budget', 'stale'])
  const acts = actionsOf(EVERY, T0)
  needs.forEach((n, i) => expect(acts[i]).toEqual(actionOf(n, EVERY, T0)))
  const by = Object.fromEntries(needs.map((n, i) => [n.kind, acts[i]!]))
  expect(by.waits!.act).toEqual({ kind: 'answer', sessionId: 'w-ask' })
  expect(by.departs!.act).toEqual({ kind: 'lot', lot: 2, action: 'accept-departure' })
  expect(by.gate!.act).toEqual({ kind: 'gate', session: 'w-gate', plan: 'abcd1234', action: 'approve' }) // /gate wants the fingerprint the board showed
  expect(by.stuck!.act).toEqual({ kind: 'lot', lot: 4, action: 'retry' })
  expect(by.blocked).toMatchObject({ act: { kind: 'lot', lot: 5, action: 'done' }, cmd: 'export DB_KEY=…' })
  expect(by.reinstall).toMatchObject({ act: { kind: 'lot', lot: 6, action: 'done' }, cmd: 'claude plugin update overseer@claude-mods' })
  expect(by.judge!.act).toEqual({ kind: 'lot', lot: 7, action: 'done' })
  expect(by.review).toMatchObject({ text: `Look at it: ${LOOK.slice(2)}`, act: { kind: 'lot', lot: 8, action: 'reviewed' } })
  expect(by.incomplete!.act).toBeUndefined() // no endpoint edits a brief yet (lots 37, 53): the person completes PLAN.md
  expect(by.budget!.act).toEqual({ kind: 'run', paused: true })
  expect(by.stale).toMatchObject({ cmd: 'claude --resume lead-id' }) // the silent overseer reads no request: a command to copy
  expect(by.stale!.act).toBeUndefined()
  const plan: Need = { kind: 'plan', id: 'plan', red: true }
  expect(actionOf(plan, { ...EVERY, proposed: [4, 5] }, T0).act).toEqual({ kind: 'plan', approve: [4, 5] }) // /plan approves the lots the board showed
})

test('the command of a blocked note is the text the session wrote, never a constant; the review item is the report\'s own line', () => {
  expect(cmdOf(REINSTALL)).toBe('claude plugin update overseer@claude-mods')
  expect(cmdOf('reinstall: claude plugin update overseer@claude-mods, then restart')).toBe('claude plugin update overseer@claude-mods') // lot 14's
  expect(cmdOf('needs a decision')).toBeUndefined()
  expect(reviewOf(`Done.\n\n**What is left**\n\n${LOOK}\n- other\n\n[lot 30 done on lot/30-v3-contract]`)).toBe(LOOK.slice(2))
  expect(reviewOf('Victor must test the band at 80 columns.')).toBe('Victor must test the band at 80 columns.')
  expect(reviewOf('- the golden screens are left for Victor to review')).toBe('the golden screens are left for Victor to review')
  expect(reviewOf('All done, nothing left.')).toBeUndefined()
})

test('the installed version: the entry of this plugin root, else the newest overseer@* entry', () => {
  const installed = JSON.stringify({ plugins: { 'overseer@overseer': [{ installPath: '/c/s/0.2.2', version: '0.2.2' }], 'overseer@claude-mods': [{ installPath: '/c/m/0.2.7', version: '0.2.7' }], 'other@x': [{ version: '9.9.9' }] } })
  expect(installedVersion(installed, '/c/s/0.2.2')).toBe('0.2.2')
  expect(installedVersion(installed, '/repo/overseer')).toBe('0.2.7') // loaded from a folder: the newest
  expect(installedVersion('{', '/x')).toBeUndefined()
})

test('a free text keeps its lines: the lead reads to the end of the message, the dialog reads it as Other', () => {
  const reg = [{ sessionId: 'lead', socket: '/tmp/l.sock' }]
  const msg = '<cross-session-message from="uds:/tmp/l.sock" from-name="worker-d4">[overseer-answer] Keep it, but:\n- behind a flag\n- for one week</cross-session-message>'
  const text = answerFrom(msg, reg, 'lead')
  expect(text).toBe('Keep it, but:\n- behind a flag\n- for one week')
  expect(answerResult({ question: 'Keep the route?', options: [{ label: 'Keep' }, { label: 'Drop' }] }, text!).response).toBe('The user answered from the overseer board with free text (Other): Keep it, but:\n- behind a flag\n- for one week')
})

// ---- through the lead: the request queue, then PLAN.md, the log, DECISIONS.md or the session input
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const say = (id: string, min: number, text: string, extra: object[] = []) => JSON.stringify({ type: 'assistant', sessionId: id, cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'text', text }, ...extra] } })
const PLAN = (o: { two?: string } = {}) => `# Plan — T

## [~] 1. First
session: 0123abcd-0000-0000-0000-000000000001
done when: it works

## ${o.two ?? '[ ] 2. Second'}
done when: it works
`
const W1 = '0123abcd-0000-0000-0000-000000000001'
const DIR = '/h/.claude/overseer/requests/r'
function setup(on: On, o: { tail: string[]; plan?: string; judge?: string; repoVersion?: string; installed?: string }) {
  const files: Record<string, string> = { '/r/PLAN.md': o.plan ?? PLAN(), '/r/overseer/.claude-plugin/plugin.json': JSON.stringify({ version: o.repoVersion ?? '0.2.8' }), '/h/.claude/plugins/installed_plugins.json': o.installed ?? JSON.stringify({ plugins: { 'overseer@claude-mods': [{ installPath: '/c/m/0.2.7', version: '0.2.7' }] } }) }
  const sent: string[] = []
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
    if (c[0] === 'ls') return out(Object.keys(files).filter(k => k.startsWith(`${c[1]}/`)).map(k => k.slice(c[1]!.length + 1)).join('\n'))
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '' : `/h/.claude/projects/x/${W1}.jsonl`)
    if (c[0] === 'tail') return out(o.tail.join('\n'))
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse')) return out('base123')
    if (c.includes('log')) return out('a1b2 feat: first')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: o.judge ?? '[]', usage: {} } }) as never)
  on('session.send', (_$, e) => { sent.push((e as { text: string }).text); return { isDelivered: true } as never })
  const board = () => JSON.parse(files['/h/.claude/overseer/boards/r.json']!)
  const ask = async (id: string, req: object) => { files[`${DIR}/${id}.json`] = JSON.stringify({ id, at: 1, ...req }); await clock.advance(2000); return board().requests.find((r: { id: string }) => r.id === id) }
  return { files, sent, clock, board, ask }
}
const go = async ($: any) => {
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: `watch ${W1}` } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
}
const log = async ($: any) => ((await $.command.run({ command: 'oversee', args: 'log' } as never)) as { text: string }).text

test('waits: an option, a free text for the open question, a free text for a plain-text question: the session input', async ($, on) => {
  const askUse = { type: 'tool_use', id: 'tu1', name: 'AskUserQuestion', input: { questions: [{ question: 'Keep?', options: [{ label: 'Keep' }, { label: 'Drop' }], multiSelect: false }] } }
  const s = setup(on, { tail: [say(W1, 0, 'A question.', [askUse])] })
  await go($)
  expect(await s.ask('a1', { kind: 'answer', sessionId: W1, askId: 'tu1', text: 'Keep it\nbehind a flag' })).toMatchObject({ state: 'done' })
  expect(s.sent).toContain('[overseer-answer] Keep it\nbehind a flag')
})

test('waits, in plain text: the free text goes to the session as an [overseer] message', async ($, on) => {
  const s = setup(on, { tail: [say(W1, 0, 'Shall I start the UI task?')] })
  await go($)
  expect(await s.ask('a2', { kind: 'answer', sessionId: W1, text: 'Yes, start it.' })).toMatchObject({ state: 'done' })
  expect(s.sent).toContain('[overseer] Yes, start it.')
  expect(await s.ask('a3', { kind: 'answer', sessionId: W1, askId: 'tu9', text: 'x' })).toMatchObject({ state: 'dropped' }) // no such dialog
})

test('stuck: retry sends the task back to its session (session input); drop frees it (PLAN.md); both leave a decision line', async ($, on) => {
  const s = setup(on, { tail: [say(W1, 0, 'Working.', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])] })
  await go($)
  expect(await s.ask('r1', { kind: 'lot', lot: 1, action: 'retry' })).toMatchObject({ state: 'done' })
  expect(s.sent.at(-1)).toContain('Task 1 comes back to you from the board')
  expect(s.files['/r/PLAN.md']).toContain('## [~] 1. First')
  expect(s.files['/r/DECISIONS.md']).toMatch(/· task 1 · What becomes of task 1 \(First\)\? · sent back to its session from the board/)
  expect(await s.ask('r2', { kind: 'lot', lot: 1, action: 'drop' })).toMatchObject({ state: 'done' })
  expect(s.files['/r/PLAN.md']).toMatch(/## \[ \] 1\. First\nnote: dropped from its session from the board\ndone when/) // no session: line any more
  expect(await log($)).toContain('dropped from its session from the board')
})

test('blocked and judge: e marks the task done in PLAN.md with a decision line', async ($, on) => {
  const s = setup(on, { tail: [say(W1, 0, 'Ready.')], plan: PLAN({ two: '[!] 2. Second\nnote: needs the DB key: export DB_KEY=x, then rerun' }) })
  await go($)
  expect(s.board().needs.find((n: { id: string }) => n.id === '2')).toMatchObject({ kind: 'blocked', cmd: 'export DB_KEY=x', act: { kind: 'lot', lot: 2, action: 'done' } })
  expect(await s.ask('b1', { kind: 'lot', lot: 2, action: 'done' })).toMatchObject({ state: 'done' })
  expect(s.files['/r/PLAN.md']).toContain('## [x] 2. Second')
  expect(s.files['/r/DECISIONS.md']).toContain('What becomes of task 2 (Second)? · marked done from the board')
})

test('reinstall: e is dropped while the installed version differs, and marks it done once it equals the repository\'s', async ($, on) => {
  const installed = { plugins: { 'overseer@claude-mods': [{ installPath: '/c/m/0.2.7', version: '0.2.7' }] } }
  const s = setup(on, { tail: [say(W1, 0, 'Ready.')], plan: PLAN({ two: `[!] 2. Second\nnote: ${REINSTALL}` }), installed: JSON.stringify(installed) })
  await go($)
  expect(s.board().needs.find((n: { kind: string }) => n.kind === 'reinstall')).toMatchObject({ cmd: 'claude plugin update overseer@claude-mods' })
  expect(await s.ask('i1', { kind: 'lot', lot: 2, action: 'done' })).toMatchObject({ state: 'dropped', why: 'not reinstalled yet: installed 0.2.7, the repository has 0.2.8' })
  expect(s.files['/r/PLAN.md']).toContain('## [!] 2. Second')
  installed.plugins['overseer@claude-mods'][0]!.version = '0.2.8'
  s.files['/h/.claude/plugins/installed_plugins.json'] = JSON.stringify(installed)
  expect(await s.ask('i2', { kind: 'lot', lot: 2, action: 'done' })).toMatchObject({ state: 'done' })
  expect(s.files['/r/PLAN.md']).toContain('## [x] 2. Second')
})

test('budget: pause the run (the log); departs: accept the departure (the session input)', async ($, on) => {
  const s = setup(on, { tail: [say(W1, 0, 'Ready.')] })
  await go($)
  expect(await s.ask('u1', { kind: 'run', paused: true })).toMatchObject({ state: 'done' })
  expect(await log($)).toContain('paused from the board')
  expect(await s.ask('u2', { kind: 'lot', lot: 1, action: 'accept-departure' })).toMatchObject({ state: 'done' })
  expect(s.sent.at(-1)).toContain('Task 1: your departure from the plan is accepted')
})

test('review: a done report that leaves a look for Victor stays done, gives a "Look at it" card, and "reviewed" closes it', async ($, on) => {
  const tail = [say(W1, 0, 'Working.')]
  const s = setup(on, { tail, plan: PLAN().replace('## [~] 1. First\nsession: 0123abcd-0000-0000-0000-000000000001', '## [ ] 1. First'), judge: '{"verdict":"done","note":"contract and fixtures in place","instructions":""}' }) // task 1 goes to the free session
  await go($)
  tail.push(say(W1, 6, `Done.\n\n**What is left**\n\n${LOOK}\n\n[lot 1 done on lot/1-first]`))
  await s.clock.advance(3 * 60e3 + 10)
  expect(s.files['/r/PLAN.md']).toContain('## [x] 1. First') // the verdict stays done
  expect(s.files['/r/PLAN.md']).toContain(`review: ${LOOK.slice(2)}`)
  expect(s.board().needs.find((n: { kind: string }) => n.kind === 'review')).toMatchObject({ text: `Look at it: ${LOOK.slice(2)}`, act: { kind: 'lot', lot: 1, action: 'reviewed' } })
  expect(await s.ask('v1', { kind: 'lot', lot: 1, action: 'reviewed' })).toMatchObject({ state: 'done' })
  expect(s.files['/r/PLAN.md']).not.toContain('review:')
  expect(s.files['/r/DECISIONS.md']).toContain('looked at from the board: The live page')
  expect(s.board().needs.some((n: { kind: string }) => n.kind === 'review')).toBe(false)
})

test('plan: the need\'s action, sent through the queue, turns [?] into [ ] in PLAN.md', async ($, on) => {
  const s = setup(on, { tail: [say(W1, 0, 'Ready.')], plan: PLAN({ two: '[?] 2. Second' }) })
  await go($)
  const need = s.board().needs.find((n: { kind: string }) => n.kind === 'plan')
  expect(need.act).toEqual({ kind: 'plan', approve: [2] })
  expect(await s.ask('p2', need.act)).toMatchObject({ state: 'done' })
  expect(s.files['/r/PLAN.md']).toContain('## [ ] 2. Second')
  expect(await log($)).toContain('approved from the board')
})

test('gate and plan: their requests go to the handlers of lots 48 and 53; stale and incomplete have no request', async ($, on) => {
  const s = setup(on, { tail: [say(W1, 0, 'Ready.')] })
  await go($)
  expect((await s.ask('g1', { kind: 'gate', session: W1, plan: 'p', action: 'approve' })).why).toBe('no workflow plan is pending in that session') // lot 48
  expect((await s.ask('p1', { kind: 'plan', approve: [2] })).why).toBe('task 2 is not proposed') // lot 53
})
