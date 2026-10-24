import { test, expect } from 'claude-code/testing'
import { innermostCall } from './register.tsx'
import { banditUpdate, callSpans, cascade, costOf, replayPrompt, rng, suggestTier, parseEvolution, parseJudge } from './learn.ts'
import { applyEdits, extract } from './flow.ts'
import { wrap } from './side.ts'
import { readTeamRun, teamPatterns } from './team.ts'

test('cost of one model request: input, cache write ×1.25, cache read ×0.1, output', async () => {
  const c = costOf({ model: 'claude-opus-5', input_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000, output_tokens: 100_000 })
  expect(Math.abs(c - (5 + 0.5 + 2.5))).toBeLessThan(1e-9)
  expect(Math.abs(costOf({ model: 'claude-haiku-4-5-20251001', input_tokens: 1_000_000 }) - 1)).toBeLessThan(1e-9)
  expect(costOf({ model: 'unknown-model', input_tokens: 1_000_000 })).toBe(0)
})

test('bandit: no suggestion without data; cheap tier wins when it delivers as well; a costly tier must earn it', async () => {
  const r = rng(42)
  expect(suggestTier({}, 'scan', 'opus', r)).toBeUndefined()
  let s = {}
  for (let i = 0; i < 6; i++) s = banditUpdate(s, 'scan', 'haiku', 1, 0.3)
  for (let i = 0; i < 6; i++) s = banditUpdate(s, 'scan', 'opus', 1, 10)
  const picks = Array.from({ length: 50 }, (_, i) => suggestTier(s, 'scan', 'opus', rng(i))?.tier)
  // Same quality, 30× cheaper: it moves off opus nearly always — mostly to haiku, sometimes to the
  // untried sonnet (Thompson keeps exploring an arm it knows nothing about).
  expect(picks.filter(t => t !== undefined).length).toBeGreaterThan(45)
  expect(picks.filter(t => t === 'haiku').length).toBeGreaterThan(25)

  let hard = {}
  for (let i = 0; i < 6; i++) hard = banditUpdate(hard, 'design', 'haiku', 0, 0.3)
  for (let i = 0; i < 6; i++) hard = banditUpdate(hard, 'design', 'opus', 1, 10)
  const stay = Array.from({ length: 50 }, (_, i) => suggestTier(hard, 'design', 'opus', rng(i))?.tier ?? 'opus')
  // haiku failed every time: never suggested again. Opus mostly stays; the untried sonnet is
  // sometimes proposed — that is the exploration that finds a cheaper tier that still delivers.
  expect(stay.filter(t => t === 'haiku').length).toBe(0)
  expect(stay.filter(t => t === 'opus').length).toBeGreaterThan(25)
})

test('cascade: one call site becomes try → judge → escalate, the script still parses and keeps its meta first', async () => {
  const src = `export const meta = { name: 'c', description: 'x', phases: [] }
const a = await agent('Extract the dates from the file.', { label: 'extract', model: 'opus' })
await agent('Summarize.', { label: 'sum' })`
  const out = cascade(src, 0)
  expect(out.startsWith('export const meta')).toBe(true)
  expect(out).toContain(`__gateCascade('Extract the dates from the file.', { label: 'extract', model: 'opus' }, "haiku")`)
  expect(out).toContain("await agent('Summarize.', { label: 'sum' })")
  const g = extract(out)
  expect(g.nodes.map((n: { label: string }) => n.label)).toContain("label + '·judge'")
  const one = cascade(`export const meta = { name: 'c', description: 'x', phases: [] }\nawait agent('Only a prompt.')`, 0)
  expect(one).toContain(`__gateCascade('Only a prompt.', {}, "haiku")`)
})

test('evolution and replay inputs are read defensively', async () => {
  expect(parseEvolution('{"mission":"short"}')).toBeUndefined()
  expect(parseEvolution('{"mission":"Count files recursively, every depth, and report zero only if find returns nothing.","why":"depth"}')?.why).toBe('depth')
  expect(parseJudge('{"better":true,"why":"counts recursively"}')).toEqual({ better: true, why: 'counts recursively' })
  expect(replayPrompt('MISSION: count at depth 2. Dir: x', 'count at depth 2', 'count recursively')).toContain('MISSION: count recursively. Dir: x')
  expect(replayPrompt('other text', 'absent', 'NEW')).toContain('NEW\n\n(Context from the original run follows.)')
  expect(replayPrompt('x', 'x', 'y').startsWith('REPLAY FOR EVALUATION')).toBe(true)
})

test('CodeRabbit fixes: decoded missions round-trip, wrap survives a zero width, team files are checked', async () => {
  const src = "await agent('Line one\\nIt\\'s two', { label: 'a' })"
  const g = extract(src)
  expect(g.nodes[0].mission).toBe("Line one\nIt's two") // the text the agent gets, not its escapes
  const out = applyEdits(src, g.nodes, { [g.nodes[0].id]: { mission: g.nodes[0].mission + ' More.' } })
  expect(extract(out).nodes[0].mission).toBe("Line one\nIt's two More.") // no doubled backslashes
  expect(wrap('some words here', 0).length).toBeGreaterThan(0)
  expect(wrap('some words here', -3).length).toBeGreaterThan(0)
  const run = readTeamRun(JSON.stringify({ v: 2, id: 'x', user: 'ana', at: 1, agents: 2, patterns: [null, { topic: 'models', lesson: 7 }, { topic: 'cost', lesson: 'Pass summaries between steps', when: '' }] }))
  expect(run?.patterns.map(p => p.lesson)).toEqual(['Pass summaries between steps'])
  expect(teamPatterns([run!]).length).toBe(1)
})

test('a cascade on a nested agent() rewrites the inner call, not the one holding it', async () => {
  const src = "await agent(`Summarize: ${await agent('INNER mission', { label: 'inner' })}`, { label: 'outer' })"
  const inner = extract(src).nodes.find((n: { label: string }) => n.label === 'inner')!
  const i = innermostCall(callSpans(src), inner.missionSpan as [number, number])
  expect(cascade(src, i)).toContain("__gateCascade('INNER mission'")
  expect(cascade(src, i)).toContain('await agent(`Summarize:')
})
