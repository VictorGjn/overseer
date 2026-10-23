import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { checkRequest } from './answer.ts'
import { answerView } from './board.ts'
import type { Board, BoardSession } from './board.ts'
import { peerOf } from './peers.ts'

const T0 = Date.parse('2026-10-12T21:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const use = (id: string, min: number, name: string, input: object, toolId = 'tu1') => JSON.stringify({ type: 'assistant', sessionId: id, cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'tool_use', id: toolId, name, input }] } })
const done = (id: string, min: number, toolId = 'tu1') => JSON.stringify({ type: 'user', sessionId: id, cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok' }] } })
const Q = (o: object = {}) => ({ questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false, ...o }] })

test('peerOf keeps the options of an open one-question ask; its result clears them; ExitPlanMode has none', () => {
  expect(peerOf([use('s1', 0, 'AskUserQuestion', Q())])!.ask).toEqual({ id: 'tu1', question: 'Which?', options: ['A', 'B'], multiSelect: false, n: 1 })
  expect(peerOf([use('s1', 0, 'AskUserQuestion', Q()), done('s1', 1)])!.ask).toBeUndefined()
  expect(peerOf([use('s1', 0, 'AskUserQuestion', { questions: [...Q().questions, ...Q().questions] })])!.ask).toMatchObject({ n: 2 })
  const plan = peerOf([use('s1', 0, 'ExitPlanMode', { plan: 'Do it' })])!
  expect(plan.open).toBe(true)
  expect(plan.ask).toBeUndefined()
})

test('a board row: buttons for a one-question ask, a link for a plan, a permission or a multiSelect, none without a bridge', () => {
  const ask = peerOf([use('s1', 0, 'AskUserQuestion', Q())])!
  expect(answerView(ask, 'waits', { bridge: 'br1' })).toEqual({ ask: { id: 'tu1', question: 'Which?', options: ['A', 'B'] } }) // no link beside buttons
  const plan = peerOf([use('s1', 0, 'ExitPlanMode', { plan: 'Do it' })])!
  expect(answerView(plan, 'waits', { bridge: 'br1' })).toEqual({ link: 'https://claude.ai/code/br1' })
  expect(answerView(peerOf([use('s1', 0, 'Bash', {})]), 'work', { status: 'waiting', waitingFor: 'permission', bridge: 'br1' })).toEqual({ link: 'https://claude.ai/code/br1' })
  expect(answerView(plan, 'waits', {})).toEqual({})
  for (const bad of ['x/../../evil?q', 'a b', 'a#b', 'a?b', '', 'x'.repeat(81)]) expect(answerView(plan, 'waits', { bridge: bad })).toEqual({}) // hostile bridge id: no link
  expect(answerView(plan, 'waits', { bridge: 'session_01AbC-x' })).toEqual({ link: 'https://claude.ai/code/session_01AbC-x' })
  expect(answerView(plan, 'waits', undefined)).toEqual({})
  expect(answerView(peerOf([use('s1', 0, 'AskUserQuestion', Q({ multiSelect: true }))]), 'waits', { bridge: 'br1' })).toEqual({ link: 'https://claude.ai/code/br1', caption: 'answer in the session' }) // lot 54
  expect(answerView(peerOf([use('s1', 0, 'Bash', {})]), 'work', { status: 'busy', bridge: 'br1' })).toEqual({})
})

test('checkRequest passes only a request that still matches the open question', () => {
  const board = { sessions: [{ sessionId: 's1' } as BoardSession] } as Board
  const peer = peerOf([use('s1', 0, 'AskUserQuestion', Q())])!
  expect(checkRequest({ sessionId: 's1', askId: 'tu1', label: 'A' }, board, peer)).toBe('A')
  expect(checkRequest({ sessionId: 's1', askId: 'old', label: 'A' }, board, peer)).toBeUndefined()
  expect(checkRequest({ sessionId: 's1', askId: 'tu1', label: 'Z' }, board, peer)).toBeUndefined()
  expect(checkRequest({ sessionId: 's2', askId: 'tu1', label: 'A' }, board, peer)).toBeUndefined()
  expect(checkRequest({ sessionId: 's1', askId: 'tu1', label: 'A' }, board, peerOf([use('s1', 0, 'AskUserQuestion', Q()), done('s1', 1)]))).toBeUndefined()
  expect(checkRequest({ sessionId: 's1', askId: 'tu1', label: 'A' }, board, peerOf([use('s1', 0, 'AskUserQuestion', Q({ multiSelect: true }))]))).toBeUndefined()
})

function setup(on: On, tail: string[]) {
  const files: Record<string, string> = { '/r/PLAN.md': '# Plan — T\n' }
  const sent: { to: string; text: string }[] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 + 5 * 60e3 })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = (e as unknown as { argv: string[] }).argv
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'rm') { delete files[c[2]!]; return out('') }
    if (c[0] === 'ls') return out(Object.keys(files).filter(k => k.startsWith(`${c[1]}/`)).map(k => k.slice(c[1]!.length + 1)).join('\n'))
    if (c[0] === 'find') return out('/h/.claude/projects/x/s1.jsonl')
    if (c[0] === 'tail') return out(tail.join('\n'))
    if (c.includes('--show-toplevel')) return out('/r')
    return out('', 1)
  })
  on('session.send', (_$, e) => { sent.push({ to: String((e as { to: unknown }).to), text: (e as { text: string }).text }); return { isDelivered: true } as never })
  return { files, sent, clock }
}
const REQ = '/h/.claude/overseer/requests/r/s1-tu1.json'
const OLD = '/h/.claude/overseer/requests/r/s1-old.json'

test('the lead pulls a board request: a valid one is sent as the plain answer, a stale one is dropped, the file goes either way', async ($, on) => {
  const s = setup(on, [use('s1', 0, 'AskUserQuestion', Q())])
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch s1' } as never)
  await $.command.run({ command: 'oversee', args: 'show' } as never) // writes the board
  s.files[REQ] = JSON.stringify({ kind: 'answer', id: 's1-tu1', sessionId: 's1', askId: 'tu1', label: 'A', at: 1 })
  await s.clock.advance(2000)
  expect(s.sent.filter(x => x.text.startsWith('[overseer-answer]'))).toEqual([{ to: 's1', text: '[overseer-answer] A' }])
  expect(REQ in s.files).toBe(false)
  s.sent.length = 0
  s.files[OLD] = JSON.stringify({ kind: 'answer', id: 's1-old', sessionId: 's1', askId: 'old', label: 'A', at: 2 })
  await s.clock.advance(2000)
  expect(s.sent.filter(x => x.text.includes('overseer-answer'))).toEqual([])
  expect(OLD in s.files).toBe(false)
  // the board it writes at once says what became of each
  const reqs = JSON.parse(s.files['/h/.claude/overseer/boards/r.json']!).requests
  expect(reqs).toEqual([
    { id: 's1-old', kind: 'answer', state: 'dropped', why: 'the question changed or was answered', at: T0 + 5 * 60e3 + 4000 },
    { id: 's1-tu1', kind: 'answer', state: 'done', at: T0 + 5 * 60e3 + 2000 },
  ])
})
