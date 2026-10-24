import { test, expect, mock } from 'claude-code/testing'
import { rasterText } from './raster-text.ts'
import { extract } from './flow.ts'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

const SRC = `export const meta = { name: 'learn-demo', description: 'x', phases: [] }
await agent('You are the SPECIFIER. Count the files in every directory listed and report the totals.', { label: 'specifier', model: 'opus' })`

const NEW_MISSION = 'You are the SPECIFIER. Count the files recursively at every depth in every directory listed, and report zero only when find returns nothing.'
const PANE = { plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 150 }, viewport: { columns: 160, rows: 80 } } as never

type Calls = { systems: string[]; spawned: string[]; contexts: string[]; lastDescription?: string }
function world(on: On, calls: Calls, journal: string) {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('fs.read', (_$, e) => (String((e as { path: string }).path).endsWith('journal.jsonl') ? { value: journal } : { deny: 'no such file' }) as never)
  on('tool.call', (_$, e) => {
    const x = e as { tool: string }
    return { result: { text: x.tool === 'Workflow' ? 'Workflow launched in background. Task ID: wt1\nTranscript dir: /tmp/wf_l1\nRun ID: wf_l1' : 'ok' } } as never
  })
  on('agent.spawn', (_$, e) => {
    const p = String((e as { prompt: string }).prompt)
    calls.spawned.push(p)
    calls.lastDescription = (e as { description?: string }).description
    return { model: 'claude-opus-5', agentId: p.startsWith('REPLAY') ? 'rp1' : 'ag1' } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('agent.list', () => ({ value: calls.spawned.filter(p => p.startsWith('REPLAY')).map(() => ({ id: 'rp1', description: calls.lastDescription, type: 'general-purpose', status: 'running' })) }) as never)
  on('model.complete', (_$, e) => {
    const sys = String((e as { system?: unknown }).system ?? '')
    calls.systems.push(sys.slice(0, 60))
    const text = sys.startsWith('A multi-agent workflow run just finished')
      ? JSON.stringify({ cards: [{ card: 'specifier', delivered: 'partial', why: 'counted only depth 2: dev-mods reported empty' }], flags: [], summary: 'count recursively' })
      : sys.startsWith('An agent in a multi-agent workflow under-delivered') ? JSON.stringify({ mission: NEW_MISSION, why: 'count at every depth' })
      : sys.startsWith('Compare two answers') ? JSON.stringify({ better: true, why: 'finds the files at depth 3' })
      : sys.startsWith('You review a multi-agent') ? JSON.stringify({ verdict: 'ok', items: [] })
      : '[]'
    return { value: { isAnswered: true, text, usage: {} } } as never
  })
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'working. ' } as never
    return { turnId: 't', index: 0, answer: '', toolUses: [], usage: { model: 'claude-opus-5', input_tokens: 10000, output_tokens: 1000, cache_read_input_tokens: 100000, cache_creation_input_tokens: 0 } } as never
  })
  return clock
}

async function step($: Parameters<TestBody>[0], agentId: string) {
  const it = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5', messageCount: 1, agentId } as never)[Symbol.asyncIterator]()
  for (;;) if ((await it.next()).done) break
}

test('an agent\'s cost adds up from each model request, shown per run', async ($, on) => {
  const calls: Calls = { systems: [], spawned: [], contexts: [] }
  world(on, calls, '')
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_l1' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Count the files in every directory listed and report the totals.', workflow: { runId: 'wf_l1', agentIndex: 1 } } as never)
  for (let i = 0; i < 40; i++) await step($, 'ag1')
  const after = await $.tool.call({ tool: 'Read', file_path: '/x', agentId: 'ag1' } as never) as { context?: string[] }
  expect((after.context ?? []).join('')).not.toContain('Wrap up') // no request-count watchdog: long runs are not interrupted
  const pane = await $.ui.mount(PANE)
  await pane.press({ plugin: 'workflow-gate-terminal', key: 't-live' } as never)
  // 40 requests × (10k in × $5 + 1k out × $25 + 100k cache read × $0.5) / 1M = 40 × $0.125 = $5.00
  expect(await pane.find({ text: /learn-demo · \$5\.00 this run/ })).toBeDefined()
})

test('the loop: a partial retro → Opus rewrites the mission → next plan shows it → replay → judged better → adopted', async ($, on) => {
  const calls: Calls = { systems: [], spawned: [], contexts: [] }
  const journal = [{ type: 'started', agentId: 'ag1', label: 'specifier' }, { type: 'result', agentId: 'ag1', result: 'dev-mods: 0 files (depth 2)' }].map(x => JSON.stringify(x)).join('\n')
  const clock = world(on, calls, journal)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_l1' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Count the files in every directory listed and report the totals. Dirs: ~/.claude/dev-mods', workflow: { runId: 'wf_l1', agentIndex: 1 } } as never)
  await step($, 'ag1')
  await $.turn.complete({ turnId: 'ag1', agentId: 'ag1', answer: 'ok', durationMs: 10, isAborted: false, reason: 'end_turn' } as never)
  await clock.advance(125000) // the run ends (2 min with no agent), retro, then the rewrite
  expect(calls.systems.some(s => s.startsWith('An agent in a multi-agent'))).toBe(true)

  // The same workflow, held again: the proposal is on the Plan card, with Replay / Use / Drop.
  await $.tool.call({ tool: 'Workflow', script: SRC } as never)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ in: 'canvas-plan', text: /NEW MISSION · specifier/ })).toBeDefined()
  // The retro also wrote the label's track record (the bandit's own stats are unit-tested).
  expect(await pane.find({ in: 'canvas-plan', text: /specifier: delivered 0\/1 \(\+1 partial\)/ })).toBeDefined()
  await pane.press({ plugin: 'workflow-gate-terminal', key: 'replay-specifier' } as never)
  const replay = calls.spawned.find(p => p.startsWith('REPLAY'))!
  expect(replay).toContain('Count the files recursively at every depth') // the new mission in the old prompt
  expect(replay).toContain('Dirs: ~/.claude/dev-mods') // with the old run's real input
  const denied = await $.tool.call({ tool: 'Write', file_path: '/x', content: 'y', agentId: 'rp1' } as never) as { isError?: boolean; deny?: string; text?: string }
  expect(JSON.stringify(denied)).toContain('read-only')
  await $.turn.complete({ turnId: 'rp1', agentId: 'rp1', answer: 'dev-mods: 14 files (depth 3)', durationMs: 10, isAborted: false, reason: 'end_turn' } as never)
  await clock.advance(10)
  expect(await pane.find({ in: 'canvas-plan', text: /replay did better/ })).toBeDefined()
  await pane.press({ plugin: 'workflow-gate-terminal', key: 'adopt-specifier' } as never)
  expect(await pane.find({ in: 'canvas-plan', text: /NEW MISSION/ })).toBeUndefined()
  expect(await pane.find({ text: /Count the files recursively at every depth/ })).toBeDefined() // the card now carries it
})

test("Opus's review fixes apply themselves: a tier, then a cascade that rewrites the call site", async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('model.complete', (_$, e) => {
    const sys = String((e as { system?: unknown }).system ?? '')
    const text = sys.startsWith('You review a multi-agent') ? JSON.stringify({ verdict: 'concerns', items: [
      { card: 'specifier', issue: 'counting files is mechanical work on opus', fix: 'run it on haiku', patch: { model: 'haiku' } },
      { card: 'specifier', issue: 'still mechanical: try cheap first', fix: 'cascade it', patch: { cascade: true } },
    ] }) : '[]'
    return { value: { isAnswered: true, text, usage: {} } } as never
  })
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC } as never)
  await clock.advance(4100)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ in: 'canvas-plan', text: /·judge/ })).toBeDefined() // the cascade's judge is now a card
  expect(await pane.find({ key: 'fix-0' })).toBeUndefined() // nothing left to click
  expect(await pane.find({ in: 'canvas-plan', text: /✓ applied · run it on haiku/ })).toBeDefined()
})

test('at night a workflow goes through the gate process unattended: Opus picks, every agent gets a model, the run is tracked', async ($, on) => {
  const writes: Record<string, string> = {}
  mock.env(on, { HOME: '/h' })
  mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('fs.write', (_$, e) => { writes[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('fs.read', (_$, e) => {
    const path = (e as { path: string }).path
    if (path in writes) return { value: writes[path] } as never
    if (path.endsWith('workflow-gate-cost-cache.json')) return { deny: 'none' } as never
    if (path.endsWith('workflow-gate-override.json')) return { value: JSON.stringify({ sessions: { s1: { until: 9e15 } } }) } as never
    return { deny: 'no such file' } as never
  })
  on('session.id', () => ({ value: 's1' }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('state.get', (_$, e, next) => ((e as { plugin?: string }).plugin === 'night-mode' ? { value: { value: { isOn: true, level: 'normal' } } } : next(e)) as never)
  let reviewed = ''
  on('model.complete', (_$, e) => {
    const sys = String((e as { system?: unknown }).system ?? '')
    if (sys.startsWith('You review a multi-agent')) reviewed = String((e as { prompt?: unknown }).prompt)
    const text = sys.startsWith('You review a multi-agent') ? JSON.stringify({ verdict: 'concerns', items: [{ card: 'specifier', issue: 'mechanical', fix: 'haiku', patch: { model: 'haiku' } }] }) : '[]'
    return { value: { isAnswered: true, text, usage: {} } } as never
  })
  let ran: { scriptPath?: string; script?: string } | undefined
  on('tool.call', { tool: 'Workflow' }, (_$, e) => { ran = e as never; return { result: { text: 'Workflow launched in background. Task ID: t1' } } as never })
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  const held = JSON.stringify(await $.tool.call({ tool: 'Workflow', script: SRC } as never))
  expect(reviewed).toContain('NIGHT RUN')
  const path = held.match(/scriptPath: \\"([^\\"]+)\\"/)?.[1] ?? ''
  expect(held).toContain('approved')
  const file = writes[path] ?? ''
  expect(file).toContain("model: 'haiku'") // Opus's fix
  await $.tool.call({ tool: 'Workflow', scriptPath: path } as never) // Claude runs the prepared file: no second review
  expect(ran?.scriptPath).toBe(path)
  expect(extract(file).nodes.filter((n: { model?: string; modelSpan?: unknown; modelInsert?: unknown }) => (n.modelSpan || n.modelInsert) && !n.model)).toEqual([]) // none inherited
  expect(await $.ui.mount(PANE).then(p => p.find({ key: 't-live' }))).toBeDefined()
})
