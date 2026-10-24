import { test, expect, mock } from 'claude-code/testing'
import { parseDecisions } from './orchestrator.ts'
import { checkRows } from './fallacy.ts'

const SRC = `export const meta = { name: 'live-demo', description: 'x', phases: [] }
await agent('You are the SPECIFIER. Write the specification for every stream of the round.', { label: 'specifier', model: 'opus' })`

const REPLY = '[{"kind":"unverified assumption","quote":"the API surely returns JSON","why":"never checked against the docs"}]'
const LOW_REPLY = '[{"kind":"vague step","why":"skip reading the docs is not explained","severity":"low"}]'

test('a run agent streams text; the live check flags it on its card; chunks and result pass through', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.call', () => ({ result: { text: 'launched' } }) as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag1' }) as never)
  let asked = ''
  on('model.complete', (_$, e) => { asked = String((e as { prompt: unknown }).prompt); return { value: { isAnswered: true, text: REPLY, usage: {} } } as never })
  const TEXT = 'Reading the spec now. I will assume the API surely returns JSON, so no need to check. '
  on('turn.step', async function* () {
    for (let i = 0; i < 8; i++) yield { kind: 'text', index: 0, text: TEXT } as never
    return { turnId: 't1', index: 0, answer: 'done', toolUses: [] } as never
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({})) // the engine's own band, empty
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_test-123' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream of the round. Streams: a, b.', description: 'specifier', workflow: { runId: 'wf_test-123', agentIndex: 1 } } as never)

  const seen: string[] = []
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'ag1' } as never)
  const it = stream[Symbol.asyncIterator]()
  let result: unknown
  for (;;) { const s = await it.next(); if (s.done) { result = s.value; break } seen.push((s.value as { text: string }).text) }
  expect(seen.length).toBe(8)
  expect(seen[0]).toBe(TEXT)
  expect(result).toMatchObject({ turnId: 't1', index: 0 })

  await clock.advance(4100)
  expect(asked).toContain('You are the SPECIFIER') // the checker was given the agent's mission

  // The band counts the flag; the Live tab names it on the specifier's card.
  const band = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 120 } as never })
  expect(await band.find({ text: /▶ WORKFLOW/ })).toBeDefined()
  expect(await band.find({ text: /⚠ 1/ })).toBeDefined()
  await band.press({ plugin: 'workflow-gate-terminal', key: 'wg-toggle' } as never) // the accordion opens on the agents
  expect(await band.find({ text: /agents done/ })).toBeDefined()
  const pane = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 110, placement: 'dock' } as never, viewport: { columns: 120, rows: 50 } as never })
  await pane.press({ plugin: 'workflow-gate-terminal', key: 't-live' } as never)
  // The orchestrator card, drawn in the canvas beside the graph: the check, and Opus's decision on it
  // (this Opus mock answers no decision: an omitted case is recorded as ignore, never left waiting).
  expect(await pane.find({ text: /Orchestrator · Opus/ })).toBeDefined()
  expect(await pane.find({ text: /⚠ specifier · unverified assumption/ })).toBeDefined()
  expect(await pane.find({ text: /→ 🧭 Opus ignore — Opus saw no need to act/ })).toBeDefined()
})

test("the main session's own reasoning is checked too, against what the person asked, and shown above the prompt", async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('prompt.submit', () => ({ text: 'ok' }) as never)
  let asked = ''
  on('model.complete', (_$, e) => { asked = String((e as { prompt: unknown }).prompt); return { value: { isAnswered: true, text: REPLY, usage: {} } } as never })
  on('turn.step', async function* () {
    for (let i = 0; i < 40; i++) yield { kind: 'thinking', index: 0, text: 'The API surely returns JSON so I will skip reading the docs. ' } as never
    return { turnId: 't1', index: 0, answer: 'done', toolUses: [] } as never
  })

  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.prompt.submit({ text: 'Add a JSON parser for the fleet API response' } as never).catch(() => undefined)
  const it = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)[Symbol.asyncIterator]()
  for (;;) if ((await it.next()).done) break
  await clock.advance(4100)

  expect(asked).toContain('Add a JSON parser for the fleet API response')
  const band = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 120 } as never })
  expect(await band.find({ text: /unverified assumption · 1 to read \(1 high\)/ })).toBeDefined()
  expect(await band.find({ text: /never checked against the docs/ })).toBeUndefined() // closed: one short line
  await band.press({ plugin: 'workflow-gate-terminal', key: 'wg-check-toggle' } as never)
  expect(await band.find({ text: /unverified assumption — never checked against the docs/ })).toBeDefined()
  expect(await band.find({ text: /“the API surely returns JSON”/ })).toBeDefined()
  await band.press({ plugin: 'workflow-gate-terminal', key: 'wg-check-ok' } as never)
  expect(await band.find({ key: 'wg-check-band' })).toBeUndefined()
})

test('Opus reads the flags and steers the agent: the note rides on its next tool result; a question reaches the band', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.call', (_$, e) => ({ result: { text: (e as { tool: string }).tool === 'Workflow' ? 'Workflow launched in background. Task ID: wtask1' : 'file contents' } }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag1' }) as never)
  const OPUS = JSON.stringify({ decisions: [
    { agent: 'ag1', action: 'steer', message: 'Open the API docs and confirm the response format before parsing.', why: 'unverified premise drives the parser' },
  ] })
  const models: string[] = []
  let opusPromptText = ''
  on('model.complete', (_$, e) => {
    const m = (e as { model: string }).model
    models.push(m)
    if (m === 'opus') opusPromptText = String((e as { prompt: unknown }).prompt)
    return { value: { isAnswered: true, text: m === 'opus' ? OPUS : REPLY, usage: {} } } as never
  })
  on('turn.step', async function* () {
    for (let i = 0; i < 8; i++) yield { kind: 'text', index: 0, text: 'I will assume the API surely returns JSON, so no need to check. ' } as never
    return { turnId: 't1', index: 0, answer: 'done', toolUses: [] } as never
  })

  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_test-123' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream of the round.', description: 'specifier', workflow: { runId: 'wf_test-123', agentIndex: 1 } } as never)
  const it = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'ag1' } as never)[Symbol.asyncIterator]()
  for (;;) if ((await it.next()).done) break

  await clock.advance(4100) // haiku flags it, and the same tick hands the flag to Opus
  expect(models.slice(0, 2)).toEqual(['haiku', 'opus']) // then haiku again: the cards' readable descriptions
  expect(opusPromptText).toContain('the API surely returns JSON')
  expect(opusPromptText).toContain('AGENT ag1 (specifier)')

  const res = await $.tool.call({ tool: 'Read', file_path: '/tmp/x', agentId: 'ag1' } as never) as { context?: string[] }
  expect(res.context?.join('\n')).toContain('Open the API docs and confirm the response format')
  const again = await $.tool.call({ tool: 'Read', file_path: '/tmp/y', agentId: 'ag1' } as never) as { context?: string[] }
  expect(again.context ?? []).toEqual([]) // delivered once

  // The orchestrator card shows the check with Opus's decision under it, delivered.
  const pane = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 140 } as never, viewport: { columns: 150, rows: 60 } as never })
  await pane.press({ plugin: 'workflow-gate-terminal', key: 't-live' } as never)
  expect(await pane.find({ text: /⚠ specifier · unverified assumption/ })).toBeDefined()
  expect(await pane.find({ text: /→ 🧭 Opus steer: Open the/ })).toBeDefined()
  expect(await pane.find({ text: /\bdelivered\b/ })).toBeDefined() // "✓ delivered" may wrap onto two rows
})

test('a question from Opus opens the AskUserQuestion dialog; the answer goes to the running agent', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  let dialog: { question?: string; options?: string[] } = {}
  on('tool.call', (_$, e) => {
    const x = e as { tool: string; questions?: { question: string; options: { label: string }[] }[] }
    if (x.tool === 'AskUserQuestion') {
      const q = x.questions![0]!
      dialog = { question: q.question, options: q.options.map(o => o.label) }
      return { result: { questions: x.questions, answers: { [q.question]: 'Cover v1 too' } } } as never
    }
    return { result: { text: x.tool === 'Workflow' ? 'Workflow launched in background. Task ID: wtask1' : 'file contents' } } as never
  })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag1' }) as never)
  const OPUS = JSON.stringify({ decisions: [
    { about: 'ag1', agent: 'ag1', action: 'ask_human', message: 'Should the spec cover the legacy v1 API too?', options: ['Cover v1 too', 'Skip v1'], why: 'scope is ambiguous' },
  ] })
  const models: string[] = []
  let opusPromptText = ''
  on('model.complete', (_$, e) => {
    const m = (e as { model: string }).model
    models.push(m)
    if (m === 'opus') opusPromptText = String((e as { prompt: unknown }).prompt)
    return { value: { isAnswered: true, text: m === 'opus' ? OPUS : REPLY, usage: {} } } as never
  })
  on('turn.step', async function* () {
    for (let i = 0; i < 8; i++) yield { kind: 'text', index: 0, text: 'I will assume the API surely returns JSON, so no need to check. ' } as never
    return { turnId: 't1', index: 0, answer: 'done', toolUses: [] } as never
  })

  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_test-123' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream of the round.', description: 'specifier', workflow: { runId: 'wf_test-123', agentIndex: 1 } } as never)
  const it = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'ag1' } as never)[Symbol.asyncIterator]()
  for (;;) if ((await it.next()).done) break

  await clock.advance(4100) // haiku flags it, and the same tick hands the flag to Opus
  expect(models.slice(0, 2)).toEqual(['haiku', 'opus']) // then haiku again: the cards' readable descriptions
  expect(opusPromptText).toContain('the API surely returns JSON')
  expect(opusPromptText).toContain('AGENT ag1 (specifier)')

  expect(dialog.question).toContain('legacy v1 API')
  expect(dialog.options).toEqual(['Cover v1 too', 'Skip v1', 'Let it run', 'Stop run'])
  const res = await $.tool.call({ tool: 'Read', file_path: '/tmp/x', agentId: 'ag1' } as never) as { context?: string[] }
  expect(res.context?.join('\n')).toContain('The human answered')
  expect(res.context?.join('\n')).toContain('Cover v1 too')
})

test('Opus replies are read defensively: only known actions, only agents it was shown', async () => {
  expect(parseDecisions('{"decisions":[{"agent":"ag1","action":"steer","message":"check X","why":"y"}]}', ['ag1'])).toEqual([{ about: 'ag1', agentId: 'ag1', action: 'steer', message: 'check X', why: 'y' }])
  expect(parseDecisions('{"decisions":[{"agent":"ag9","action":"steer","why":"y"}]}', ['ag1'])).toEqual([])
  expect(parseDecisions('{"decisions":[{"agent":"ag1","action":"delete_repo","why":"y"}]}', ['ag1'])).toEqual([])
  expect(parseDecisions('nope', ['ag1'])).toEqual([])
})

test('agents spawned in parallel each get their own id, so every one can finish', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.call', () => ({ result: { text: 'Workflow launched in background. Task ID: wtask2' } }) as never)
  let n = 0
  on('agent.spawn', async () => { const id = `ag${++n}`; await Promise.resolve(); return { model: 'claude-haiku-4-5', agentId: id } as never })
  on('turn.complete', () => ({ text: '' }) as never)

  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_par-1' } as never)
  await Promise.all([1, 2, 3].map(i => $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream of the round.', workflow: { runId: 'wf_par-1', agentIndex: i } } as never)))
  for (const id of ['ag1', 'ag2', 'ag3']) await $.turn.complete({ turnId: id, agentId: id, answer: 'ok', durationMs: 10, isAborted: false, reason: 'end_turn' } as never).catch(() => undefined)

  const band = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 120 } as never })
  expect(await band.find({ key: 'running' })).toBeUndefined() // all three done: no run row left
})

test('when Opus does not answer, the card says why and the flag waits for the next pass', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.call', () => ({ result: { text: 'Workflow launched in background. Task ID: wtask3' } }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag1' }) as never)
  on('model.complete', (_$, e) => ((e as { model: string }).model === 'opus'
    ? { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded_error', usage: {} } }
    : { value: { isAnswered: true, text: REPLY, usage: {} } }) as never)
  on('turn.step', async function* () {
    for (let i = 0; i < 8; i++) yield { kind: 'text', index: 0, text: 'I will assume the API surely returns JSON, so no need to check. ' } as never
    return { turnId: 't1', index: 0, answer: 'done', toolUses: [] } as never
  })
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_test-9' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream of the round.', workflow: { runId: 'wf_test-9', agentIndex: 1 } } as never)
  const it = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'ag1' } as never)[Symbol.asyncIterator]()
  for (;;) if ((await it.next()).done) break
  await clock.advance(4100)

  const pane = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 140 } as never, viewport: { columns: 150, rows: 60 } as never })
  await pane.press({ plugin: 'workflow-gate-terminal', key: 't-live' } as never)
  expect(await pane.find({ text: /Opus did not answer \(api-error 529/ })).toBeDefined()
  expect(await pane.find({ text: /waiting for Opus/ })).toBeDefined()
})


test('a low-stakes flag is shown but never costs an Opus read', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.call', (_$, e) => ({ result: { text: (e as { tool: string }).tool === 'Workflow' ? 'Workflow launched in background. Task ID: wtask1' : 'ok' } }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag1' }) as never)
  const models: string[] = []
  on('model.complete', (_$, e) => {
    models.push((e as { model: string }).model)
    return { value: { isAnswered: true, text: '[{"kind":"hasty generalization","quote":"all three tests look fine","why":"loose wording","severity":"low"}]', usage: {} } } as never
  })
  on('turn.step', async function* () {
    for (let i = 0; i < 8; i++) yield { kind: 'text', index: 0, text: 'All three tests look fine, moving on to the docs. ' } as never
    return { turnId: 't1', index: 0, answer: 'done', toolUses: [] } as never
  })
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_low-1' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification.', description: 'specifier', workflow: { runId: 'wf_low-1', agentIndex: 1 } } as never)
  const it = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'ag1' } as never)[Symbol.asyncIterator]()
  for (;;) if ((await it.next()).done) break
  await clock.advance(4100)
  await clock.advance(30000)
  expect(models[0]).toBe('haiku')
  expect(models).not.toContain('opus')
})

test("a correction that misses its agent is handed to the main session once the run is over", async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.call', (_$, e) => ({ result: { text: (e as { tool: string }).tool === 'Workflow' ? 'Workflow launched in background. Task ID: wtask1' : 'ok' } }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag1' }) as never)
  on('model.complete', (_$, e) => {
    const m = (e as { model: string }).model
    const text = m === 'opus' ? JSON.stringify({ decisions: [{ agent: 'ag1', action: 'steer', message: 'Re-run the failing check on the base commit before calling it noise.', why: 'dismissed a failure' }] }) : REPLY
    return { value: { isAnswered: true, text, usage: {} } } as never
  })
  on('turn.complete', () => ({ text: '' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => { submitted.push((e as { text: string }).text); return { drop: 'captured' } as never })
  on('turn.step', async function* () {
    for (let i = 0; i < 8; i++) yield { kind: 'text', index: 0, text: 'I will assume the API surely returns JSON, so no need to check. ' } as never
    return { turnId: 't1', index: 0, answer: 'done', toolUses: [] } as never
  })
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_late-1' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification.', description: 'specifier', workflow: { runId: 'wf_late-1', agentIndex: 1 } } as never)
  const it = $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'ag1' } as never)[Symbol.asyncIterator]()
  for (;;) if ((await it.next()).done) break
  await clock.advance(4100) // flagged and steered; the agent makes no further tool call…
  expect(submitted).toEqual([])
  await $.turn.complete({ turnId: 't1', agentId: 'ag1', answer: 'Spec written.' } as never) // …and finishes
  await clock.advance(30000)
  expect(submitted).toEqual([]) // a gap between agents is not the run's end
  await $.prompt.submit({ text: '<task-notification><task-id>wtask1</task-id><status>completed</status></task-notification>' } as never) // the run's task reports back
  await clock.advance(4100)
  expect(submitted.join('')).toContain('Re-run the failing check on the base commit')
  expect(submitted.join('')).toContain('fix or redo it')
  await clock.advance(4100)
  expect(submitted.filter(t => t.includes('Re-run the failing check')).length).toBe(1) // once
})

test('the check band reads a remark once, high severity first, newest first, five at most', async () => {
  const f = (why: string, severity: 'high' | 'low' = 'high') => ({ cardId: 'main', kind: 'k', why, severity })
  const { rows, more } = checkRows([f('a'), f('low one', 'low'), f('b'), f('a'), f('c'), f('d'), f('e'), f('f')])
  expect(rows.map(r => r.why)).toEqual(['f', 'e', 'd', 'c', 'a'])
  expect(more).toBe(2) // b, and the low one last
})

test('a low-weight remark on the main session alone does not raise the check band', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('prompt.submit', () => ({ text: 'ok' }) as never)
  let checks = 0
  on('model.complete', () => { checks++; return { value: { isAnswered: true, text: LOW_REPLY, usage: {} } } as never })
  on('turn.step', async function* () {
    for (let i = 0; i < 40; i++) yield { kind: 'thinking', index: 0, text: 'The API surely returns JSON so I will skip reading the docs. ' } as never
    return { turnId: 't1', index: 0, answer: 'done', toolUses: [] } as never
  })
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.prompt.submit({ text: 'Add a JSON parser for the fleet API response' } as never).catch(() => undefined)
  const it = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)[Symbol.asyncIterator]()
  for (;;) if ((await it.next()).done) break
  await clock.advance(4100)
  expect(checks).toBeGreaterThan(0) // the check ran and flagged, at low weight
  const band = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 120 } as never })
  expect(await band.find({ key: 'wg-check-band' })).toBeUndefined()
})
