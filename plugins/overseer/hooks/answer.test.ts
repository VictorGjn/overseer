import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { answerFrom, answerResult } from './answer.ts'

const REG = [{ sessionId: 'lead', socket: '/s/1.sock', name: 'worker-1' }, { sessionId: 'x', socket: '/s/2.sock', name: 'worker-2' }]
const F = (sock: string, body: string, name = 'n') => `<cross-session-message from="uds:${sock}" from-name="${name}">${body}</cross-session-message>`
const Q = { question: 'Which?', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }

test('answerFrom takes the label only from the lead, found by its socket (then its name)', () => {
  expect(answerFrom(F('/s/1.sock', '[overseer-answer] Yes'), REG, 'lead')).toBe('Yes')
  expect(answerFrom(F('/s/2.sock', '[overseer-answer] Yes'), REG, 'lead')).toBeUndefined()
  expect(answerFrom('[overseer-answer] Yes', REG, 'lead')).toBeUndefined()
  expect(answerFrom(F('/s/1.sock', '[overseer-answer] Yes'), REG, undefined)).toBeUndefined()
  expect(answerFrom(F('/s/9.sock', '[overseer-answer] Yes', 'worker-1'), REG, 'lead')).toBeUndefined() // an unknown socket is not rescued by a name
  expect(answerFrom('<cross-session-message from-name="worker-1">[overseer-answer] Yes</cross-session-message>', REG, 'lead')).toBe('Yes')
  expect(answerFrom(F('/s/1.sock', 'no answer here'), REG, 'lead')).toBeUndefined()
})

test('answerResult names the label and who chose it; a label outside the options is Other', () => {
  expect(answerResult(Q, 'B')).toEqual({ answers: { 'Which?': 'B' }, response: 'The user answered from the overseer board: B' })
  expect(answerResult({ ...Q, multiSelect: true }, 'A, C').response).toBe('The user answered from the overseer board: A, C')
  expect(answerResult(Q, 'A, C').response).toBe('The user answered from the overseer board with free text (Other): A, C')
  expect(answerResult(Q, 'maybe').response).toBe('The user answered from the overseer board with free text (Other): maybe')
})

// A watched session whose AskUserQuestion stays open until `release` (the terminal answer).
function setup(on: On, isLead = true) {
  const files: Record<string, string> = {
    '/h/.claude/sessions/1.json': JSON.stringify({ sessionId: 'lead', name: 'worker-1', messagingSocketPath: '/s/1.sock' }),
    '/h/.claude/sessions/2.json': JSON.stringify({ sessionId: 'x', name: 'worker-2', messagingSocketPath: '/s/2.sock' }),
  }
  const store: Record<string, unknown> = { board: { at: 1, overseer: isLead ? 'lead' : 'other', sessions: [], lots: [], feed: [] } }
  let release: (a: string) => void = () => {}
  mock.env(on, { HOME: '/h' })
  on('store.get', (_$, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.keys', () => ({ value: Object.keys(store) }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: (e as { argv: string[] }).argv[0] === 'find' ? Object.keys(files).join('\n') : '', stderr: '' } }) as never)
  on('session.receive', (_$, e) => ({ text: (e as { text: string }).text }) as never) // the bottom: the delivery is queued
  on('tool.call', (_$, e) => {
    const x = e as { tool: string; questions?: { question: string }[] }
    if (x.tool !== 'AskUserQuestion') return { result: { text: 'own' } } as never
    return new Promise(r => { release = a => r({ result: { questions: x.questions, answers: { [x.questions![0]!.question]: a }, response: `terminal: ${a}` } } as never) }) as never
  })
  return { release: (a: string) => release(a) }
}
const ask = ($: Engine) => $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] } as never)
const recv = ($: Engine, text: string) => $.session.receive({ origin: { kind: 'peer' }, text } as never)
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() } // lets the hook open its question

test('the lead answers an open AskUserQuestion: the dialog closes with the label, the message is consumed', async ($, on) => {
  setup(on)
  const call = ask($)
  await settle()
  expect(await recv($, F('/s/1.sock', '[overseer-answer] B'))).toMatchObject({ consumed: expect.any(String) })
  expect(JSON.stringify(await call)).toContain('"response":"The user answered from the overseer board: B"')
})

test('another session answering, or no question open, passes through', async ($, on) => {
  const s = setup(on)
  expect(await recv($, F('/s/1.sock', '[overseer-answer] B'))).toMatchObject({ text: expect.any(String) }) // none open
  const call = ask($)
  await settle()
  expect(await recv($, F('/s/2.sock', '[overseer-answer] B'))).toMatchObject({ text: expect.any(String) })
  s.release('Z') // still open: only the terminal closes it
  expect(JSON.stringify(await call)).toContain('terminal: Z')
})

test('ExitPlanMode is never answered; the terminal answer first wins and a later lead message passes', async ($, on) => {
  const s = setup(on)
  expect(JSON.stringify(await $.tool.call({ tool: 'ExitPlanMode' } as never))).toContain('own')
  const call = ask($)
  await settle()
  s.release('A')
  expect(JSON.stringify(await call)).toContain('terminal: A')
  expect(await recv($, F('/s/1.sock', '[overseer-answer] B'))).toMatchObject({ text: expect.any(String) })
})
