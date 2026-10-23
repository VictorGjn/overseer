import { expect, mock, test } from 'claude-code/testing'
import type { Board } from './board.ts'
import { needsYou } from './board.ts'
import rec from './fixtures/workflow-recorded.ts'

// The Workflow stage on a real pass: runs read back to the lot's assignment (windowMins), the steps of a running run with their
// model and effort, a plan waiting on the gate, and the light export that moves them every 15 s. The disk is a map of paths.
const T0 = Date.parse('2026-10-22T08:00:00Z')
const PLAN = '# Plan — Ship /r\n\n## [ ] 1. First\ndone when: it ships\n'
const say = (min: number, text: string) => JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: new Date(T0 + min * 60e3).toISOString(), message: { content: [{ type: 'text', text }] } })
const P = '/h/.claude/projects/x/w1'
const later = (text: string) => text.replaceAll('2026-10-21T19:2', '2026-10-22T08:1') // the recorded agent, moved to 10 min after the assignment

test('workflow runs of a lot: a done run, a running run with its steps, a plan at the gate, and a light export every 15 s', async ($, on) => {
  const done = rec.loop + '\n{"type":"result","agentId":"t2","result":{}}'
  const files: Record<string, string> = {
    '/r/PLAN.md': PLAN,
    '/h/.claude/sessions/4242.json': JSON.stringify({ pid: 4242, sessionId: 'w1', name: 'worker-8f' }),
    [`${P}/subagents/workflows/wf_old/journal.jsonl`]: done,
    [`${P}/subagents/workflows/wf_run/journal.jsonl`]: rec.journal,
    [`${P}/workflows/wf_old.json`]: JSON.stringify({ ...rec.doneRun, runId: 'wf_old', startTime: T0 + 5 * 60e3, durationMs: 15 * 60e3 }),
    [`${P}/workflows/wf_before.json`]: JSON.stringify({ ...rec.doneRun, runId: 'wf_before', startTime: T0 - 3600e3 }), // another lot's
  }
  for (const id of ['aaabca984dabd50a4', 'a26854fefbe48cbb2', 'ad89904863f28e902']) files[`${P}/subagents/workflows/wf_run/agent-${id}.meta.json`] = '{"model":"sonnet"}'
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 })
  const store: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.set', (_$, e) => { store[(e as { key: string }).key] = (e as { value: unknown }).value; return { value: undefined } as never })
  on('store.delete', (_$, e) => { delete store[(e as { key: string }).key]; return { value: undefined } as never })
  on('store.keys', () => ({ value: Object.keys(store) }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  const runs: string[][] = []
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    runs.push(c)
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    const has = (s: string) => c.some(x => x.includes(s))
    if (c[0] === 'find' && c[1]!.endsWith('/sessions')) return out('/h/.claude/sessions/4242.json')
    if (c[0] === 'find' && has('/w1/subagents/workflows/wf_*')) return out([`${P}/subagents/workflows/wf_old`, `${P}/subagents/workflows/wf_run`].join('\n'))
    if (c[0] === 'find' && has('/w1/workflows/wf_*.json')) return out([`${P}/workflows/wf_old.json`, `${P}/workflows/wf_before.json`].join('\n'))
    if (c[0] === 'find' && has('/subagents/workflows/wf_*')) return out('') // the lead session has no run
    if (c[0] === 'find' && has('/workflows/wf_*.json')) return out('')
    if (c[0] === 'find' && has('journal.jsonl')) return out(c[1]!.includes('wf_run') ? c[1]! : '') // wf_run moved in the last 2 min
    if (c[0] === 'find' && c.some(x => x.endsWith('.js'))) return out('')
    if (c[0] === 'find') return out('/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'head' && has('/agent-')) return out(later(rec.agentHead))
    if (c[0] === 'tail' && has('/agent-')) return out(later(rec.agentTail))
    if (c[0] === 'tail') return out(say(0, 'Ready.'))
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse') && c.includes('HEAD')) return out('base123')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('session.send', () => ({ isDelivered: true }) as never)
  const board = () => store['board:/r'] as Board

  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  await clock.advance(40 * 60e3) // 40 min after the assignment
  await $.command.run({ command: 'oversee', args: 'focus' } as never) // writes the board
  const wfs = board().workflows!
  const old = wfs.find(w => w.runId === 'wf_old')!
  expect(old).toMatchObject({ isActive: false, state: 'completed', startedAt: T0 + 5 * 60e3, durationMs: 15 * 60e3, endedAt: T0 + 20 * 60e3, model: 'claude-opus-5-5', session: 'w1' })
  expect(old.preview!.length).toBeLessThanOrEqual(200)
  expect(old.steps!.map(s => [s.kind, s.turn, s.group])).toEqual([['build', 1, 'loop'], ['test', 1, 'loop'], ['fix', 1, 'loop'], ['test', 2, 'loop']])
  expect(wfs.some(w => w.runId === 'wf_before')).toBe(false) // started before the assignment
  const back = runs.filter(c => c[0] === 'find' && c.includes('*/w1/workflows/wf_*.json')).map(c => -Number(c[c.indexOf('-mmin') + 1]))
  expect(back.length).toBeGreaterThan(0)
  expect(back.at(-1)).toBeGreaterThan(30) // back to the assignment 40 min ago, not 3 h (steps.test.ts: past 3 h)
  expect(back.at(-1)).toBeLessThan(60)

  const run = wfs.find(w => w.runId === 'wf_run')!
  expect(run).toMatchObject({ isActive: true, state: 'running', started: 3, done: 1 })
  expect(run.steps!.map(s => [s.label, s.state, s.group, s.model, s.effort])).toEqual([
    ['grill:enablers', 'done', 'parallel', 'claude-sonnet-5-5', 'high'], ['grill:controls', 'running', 'parallel', 'claude-sonnet-5-5', 'high'], ['grill:daily', 'running', 'parallel', 'claude-sonnet-5-5', 'high'],
  ])
  expect(run.steps![1]).toMatchObject({ goal: 'find the controls with no endpoint', how: 'read board-v3.html and CONTRACT.md', out: 'a list of findings, one line each' })
  expect(board().sessions[0]!.stage).not.toBe('gate')

  // a plan waits on the gate: the next pass says stage gate, the plan and its agents, and a need of kind gate
  files['/h/.claude/workflow-gate/active/w1.json'] = JSON.stringify(rec.gate)
  await $.command.run({ command: 'oversee', args: 'focus' } as never)
  const s = board().sessions[0]!
  expect(s).toMatchObject({ stage: 'gate', gate: { name: 'grill-board-v3-plan', agents: [{ label: 'think', model: 'opus' }, { label: 'build', model: 'sonnet' }, { label: 'test', model: 'haiku' }] } })
  expect(needsYou(board(), board().at).map(n => n.kind)).toContain('gate')

  // the light export: 15 s later the run's agents are back and the gate is approved, with no token or collision scan
  files[`${P}/subagents/workflows/wf_run/journal.jsonl`] = rec.journal + '\n{"type":"result","agentId":"a26854fefbe48cbb2"}\n{"type":"result","agentId":"ad89904863f28e902"}'
  files['/h/.claude/workflow-gate/active/w1.json'] = JSON.stringify({ ...rec.gate, status: 'approved' })
  const at = board().at
  runs.length = 0
  await clock.advance(15e3)
  expect(board().at).toBeGreaterThan(at)
  expect(board().workflows!.find(w => w.runId === 'wf_run')!.steps!.map(x => x.state)).toEqual(['done', 'done', 'done'])
  expect(board().sessions[0]!.stage).not.toBe('gate')
  expect(board().sessions[0]!.gate).toBeUndefined()
  expect(runs.some(c => c[0] === 'wc')).toBe(false)
})
