import { test, expect } from 'claude-code/testing'
import { peerOf, waitsOn } from './peers.ts'
import { stageOf } from './board.ts'

const row = (o: object) => JSON.stringify({ sessionId: 's-w1', cwd: '/r/app', timestamp: '2026-10-09T10:00:00Z', ...o })
const ask = (name: string, input: object, id = 't1') => row({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } })
const answer = (id: string) => row({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })
const say = (text: string) => row({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const prompt = row({ type: 'user', message: { role: 'user', content: 'refactor the parser' } })
const waits = (lines: string[], reg?: { status?: string; waitingFor?: string }) => {
  const p = waitsOn(peerOf(lines)!, reg)
  return { p, stage: stageOf(p, undefined, false, 0) }
}

test('an open AskUserQuestion: the session waits, until its answer comes back', async () => {
  const open = [prompt, ask('AskUserQuestion', { questions: [{ question: 'Keep the old API?' }] })]
  expect(waits(open).p.question).toBe('Keep the old API?')
  expect(waits(open).stage).toBe('waits')
  expect(waits([...open, answer('t1')]).stage).not.toBe('waits')
})

test('an open ExitPlanMode: the session waits to approve its plan, with the plan\'s first line, verbatim', async () => {
  const open = [prompt, ask('ExitPlanMode', { plan: '# Split the parser\n\n1. lexer\n2. tests' })]
  expect(waits(open).p.question).toBe('approve the plan: # Split the parser')
  expect(waits(open).stage).toBe('waits')
  expect(waits([...open, answer('t1')]).stage).not.toBe('waits')
})

test('the registry says waiting with no open tool: the session waits, on what the registry says', async () => {
  const lines = [prompt, say('Running the build now.')]
  expect(waits(lines).stage).not.toBe('waits') // the transcript alone shows work
  const w = waits(lines, { status: 'waiting', waitingFor: 'dialog open' })
  expect(w.p.question).toBe('waiting: dialog open')
  expect(w.stage).toBe('waits')
  expect(waits(lines, { status: 'waiting' }).p.question).toBe('waiting: input needed')
  // A question the transcript names is kept as it is.
  expect(waits([prompt, say('Keep the old API?')], { status: 'waiting', waitingFor: 'input needed' }).p.question).toBe('Keep the old API?')
})

test('the registry says busy: not waiting, even with a question-shaped last line and a tool still running', async () => {
  const lines = [prompt, say('Want me to also run the linter?'), ask('Bash', { command: 'npm test' })]
  expect(waits(lines).stage).toBe('waits') // the transcript alone reads as a question
  const w = waits(lines, { status: 'busy' })
  expect(w.p.question).toBeUndefined()
  expect(w.stage).not.toBe('waits')
  expect(w.p.busySince).toBeDefined()
})

test('an open tool prompt waits whatever the registry reads: busy (lagging) still waits', async () => {
  const ask1 = [prompt, ask('AskUserQuestion', { questions: [{ question: 'Keep the old API?' }] })]
  const plan = [prompt, ask('ExitPlanMode', { plan: 'Split it' })]
  for (const l of [ask1, plan]) expect(waits(l, { status: 'busy' }).stage).toBe('waits')
  expect(waits(plan, { status: 'busy' }).p.question).toBe('approve the plan: Split it')
})

test('every waitingFor from the registry shows; idle and shell are not waits', async () => {
  const lines = [prompt, say('Running the build now.')]
  for (const f of ['permission prompt', 'sandbox request', 'worker request', 'input needed', 'dialog open']) {
    const w = waits(lines, { status: 'waiting', waitingFor: f })
    expect(w.p.question).toBe(`waiting: ${f}`)
    expect(w.stage).toBe('waits')
  }
  for (const status of ['idle', 'shell']) expect(waits(lines, { status }).stage).not.toBe('waits')
})

test('[ask: question | recommend: option — why]: the question and the recommendation, until the person answers', async () => {
  const lines = [prompt, say('Ok.\n[ask: Keep the legacy route? | recommend: keep it — the app calls it]')]
  const p = peerOf(lines)!
  expect(p.rec).toEqual({ question: 'Keep the legacy route?', option: 'keep it', why: 'the app calls it' })
  expect(p.question).toBe('Keep the legacy route?')
  const typed = peerOf([...lines, row({ type: 'user', message: { role: 'user', content: 'keep it' } })])!
  expect(typed.rec).toBeUndefined()
  expect(typed.question).toBeUndefined()
})

test('a newer question without an [ask: …] line replaces the older card: no stale recommendation', async () => {
  const p = peerOf([say('Which route?\n[ask: Which route? | recommend: north — shorter]'), answer('t9'), say('Keep the cache?')])!
  expect(p.question).toBe('Keep the cache?')
  expect(p.rec).toBeUndefined()
})
