import { expect, test } from 'claude-code/testing'
import rec from './fixtures/workflow-recorded.ts'
import { doneRun, gatePlan, ownsRun, parseLabel, readAgent, stepsOf, windowMins } from './steps.ts'

test('a label is a kind, or a kind and a turn; any other label has none', () => {
  expect(parseLabel('think')).toEqual({ kind: 'think' })
  expect(parseLabel('test-2')).toEqual({ kind: 'test', turn: 2 })
  for (const k of ['think', 'build', 'test', 'verify', 'fix', 'commit']) expect(parseLabel(k).kind).toBe(k)
  expect(parseLabel('grill:enablers')).toEqual({})
  expect(parseLabel('test-x')).toEqual({})
  expect(parseLabel('retest-1')).toEqual({})
})

test('an agent: its real model and effort from the first records (also when agent() set no model), its times, Goal/How/Out', () => {
  expect(readAgent(rec.agentHead, rec.agentTail)).toEqual({
    model: 'claude-sonnet-5-5', effort: 'high',
    startedAt: Date.parse('2026-10-21T19:24:03.573Z'), endedAt: Date.parse('2026-10-21T19:29:13.871Z'),
    goal: 'find the controls with no endpoint', how: 'read board-v3.html and CONTRACT.md', out: 'a list of findings, one line each',
  })
  // a running agent: no tail yet, the last record read is the end so far
  expect(readAgent(rec.agentHead).endedAt).toBe(Date.parse('2026-10-21T19:24:03.633Z'))
  // the effort falls back to the first blob that carries it when the request does not
  const noParams = rec.agentHead.replace(',"output_config":{"effort":"high"}}}', '}}').split('\n').slice(1).join('\n')
  expect(readAgent(noParams).effort).toBe('high')
  expect(readAgent('not json\n{"type":"user"}')).toEqual({})
})

test('a parallel phase: the agents running together share a group; a lone agent has none', () => {
  const steps = stepsOf(rec.journal)
  expect(steps.map(s => [s.label, s.state, s.group])).toEqual([['grill:enablers', 'done', 'parallel'], ['grill:controls', 'running', 'parallel'], ['grill:daily', 'running', 'parallel']])
  expect(steps.every(s => s.phase === 'Grill')).toBe(true)
  const alone = stepsOf('{"type":"started","agentId":"a","label":"think","phase":"P"}\n{"type":"result","agentId":"a"}\n{"type":"started","agentId":"b","label":"build","phase":"P"}')
  expect(alone.map(s => [s.kind, s.group])).toEqual([['think', undefined], ['build', undefined]])
})

test('a loop with 2 turns: each step has its kind and turn, group loop, and the running one is the last turn', () => {
  const steps = stepsOf(rec.loop)
  expect(steps.map(s => [s.kind, s.turn, s.group, s.state])).toEqual([
    ['build', 1, 'loop', 'done'], ['test', 1, 'loop', 'done'], ['fix', 1, 'loop', 'done'], ['test', 2, 'loop', 'running'],
  ])
})

test('the model, effort and times of each agent are put on its step', () => {
  const info = readAgent(rec.agentHead, rec.agentTail)
  const [step] = stepsOf(rec.journal, { aaabca984dabd50a4: info })
  expect(step).toMatchObject({ label: 'grill:enablers', model: 'claude-sonnet-5-5', effort: 'high', goal: 'find the controls with no endpoint', endedAt: info.endedAt })
})

test('a done run older than 3 h: start, length, model and state from wf_*.json, a 200 character preview; a lot owns it after its assignment', () => {
  const run = doneRun(JSON.stringify(rec.doneRun))!
  expect(run).toMatchObject({ startedAt: 1792610641635, durationMs: 1183312, model: 'claude-opus-5-5', state: 'completed' })
  expect(run.preview!.length).toBeLessThanOrEqual(200)
  expect(run.preview).toBe(rec.doneRun.result.slice(0, 200))
  expect(doneRun(JSON.stringify({ ...rec.doneRun, result: 'x'.repeat(500) }))!.preview).toHaveLength(200)
  const now = run.startedAt! + 10 * 3600e3
  expect(now - run.startedAt!).toBeGreaterThan(3 * 3600e3)
  expect(ownsRun(run.startedAt! - 3600e3, run)).toBe(true)
  expect(windowMins(run.startedAt! - 3600e3, now)).toBeGreaterThan(11 * 60) // the lot's window reaches back past 3 h
  expect(windowMins(undefined, now)).toBe(181) // a session with no lot: 3 h
  expect(ownsRun(run.startedAt! + 1, run)).toBe(false) // started before the assignment: another lot's
  expect(doneRun('nope')).toBeUndefined()
})

test('a plan that waits on the gate: its name, agents and models; any other status is no gate', () => {
  expect(gatePlan(JSON.stringify(rec.gate))).toEqual({ name: 'grill-board-v3-plan', agents: [{ label: 'think', model: 'opus' }, { label: 'build', model: 'sonnet' }, { label: 'test', model: 'haiku' }] })
  expect(gatePlan(JSON.stringify({ ...rec.gate, status: 'approved' }))).toBeUndefined()
  expect(gatePlan(JSON.stringify({ hook: '/p/h.mjs', version: '2.0.0' }))).toBeUndefined() // the active file as the gate writes it at session start
  expect(gatePlan(undefined)).toBeUndefined()
  expect(gatePlan('{')).toBeUndefined()
})
