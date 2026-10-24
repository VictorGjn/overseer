import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { mergeRecords, parseRetro, parseReview, readJournal } from './review.ts'

const SRC = `export const meta = { name: 'review-demo', description: 'x', phases: [] }
const spec = await agent('You are the SPECIFIER. Write the specification for every stream of the round.', { label: 'specifier', model: 'opus' })
await agent(\`You are the VERIFIER of the specification. Check it: \${JSON.stringify(spec)}\`, { label: 'verify', model: 'opus' })`

const REVIEW = JSON.stringify({ verdict: 'concerns', items: [{ card: 'verify', issue: 'verify checks the spec on the same tier, with no criteria', fix: 'give it explicit acceptance criteria' }] })
const RETRO = JSON.stringify({ cards: [{ card: 'specifier', delivered: 'yes', why: 'three streams specified' }], flags: [], summary: 'add acceptance criteria to verify' })
const JOURNAL = [
  { type: 'started', agentId: 'ag1', label: 'specifier' },
  { type: 'result', agentId: 'ag1', result: 'Spec: three streams, auth / billing / export.' },
].map(x => JSON.stringify(x)).join('\n')

const PANE = { plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 150 }, viewport: { columns: 160, rows: 70 } } as never

function world(on: On, calls: { tools: string[]; pushes: string[]; systems: string[] }) {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('fs.read', (_$, e) => (String((e as { path: string }).path).endsWith('journal.jsonl') ? { value: JOURNAL } : { deny: 'no such file' }) as never)
  on('tool.call', (_$, e) => {
    const x = e as { tool: string; message?: string }
    calls.tools.push(x.tool)
    if (x.tool === 'PushNotification') calls.pushes.push(x.message ?? '')
    return { result: { text: x.tool === 'Workflow' ? 'Workflow launched in background. Task ID: wt1\nTranscript dir: /tmp/wf_r1\nRun ID: wf_r1' : 'ok' } } as never
  })
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'ag1' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('model.complete', (_$, e) => {
    const sys = String((e as { system?: unknown }).system ?? '')
    calls.systems.push(sys.slice(0, 30))
    const text = sys.startsWith('You review a multi-agent') ? REVIEW : sys.startsWith('A multi-agent workflow run just finished') ? RETRO : '[]'
    return { value: { isAnswered: true, text, usage: {} } } as never
  })
  return clock
}

test('a held plan: Opus reviews it on the Plan card, and an away person gets a phone notification', async ($, on) => {
  const calls = { tools: [] as string[], pushes: [] as string[], systems: [] as string[] }
  const clock = world(on, calls)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC } as never)
  expect(calls.pushes[0]).toContain('review-demo')
  await clock.advance(4100)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ in: 'canvas-plan', text: /OPUS REVIEW · 1 concerns/ })).toBeDefined()
  expect(await pane.find({ in: 'canvas-plan', text: /fix: give it explicit acceptance criteria/ })).toBeDefined()
})

test("a finished card shows what it returned; once the run ends Opus writes the retro and the label's record", async ($, on) => {
  const calls = { tools: [] as string[], pushes: [] as string[], systems: [] as string[] }
  const clock = world(on, calls)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC } as never) // held: selects the first card
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_r1' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream of the round.', workflow: { runId: 'wf_r1', agentIndex: 1 } } as never)
  await $.turn.complete({ turnId: 'ag1', agentId: 'ag1', answer: 'ok', durationMs: 10, isAborted: false, reason: 'end_turn' } as never)

  const pane = await $.ui.mount(PANE)
  await pane.press({ plugin: 'workflow-gate-terminal', key: 't-live' } as never)
  await pane.press({ plugin: 'workflow-gate-terminal', key: 'open-ag1' } as never) // its story ends on what it returned
  expect(await pane.find({ text: /Spec: three streams, auth \/ billing \/ export\./ })).toBeDefined()
  await pane.press({ plugin: 'workflow-gate-terminal', key: 'back-live' } as never)

  await clock.advance(125000) // the run ends: 2 min with no agent
  expect(calls.systems.some(s => s.startsWith('A multi-agent workflow run'))).toBe(true)
  const live = pane // the mounted pane redraws as the run's state changes
  expect(await live.find({ text: /RETRO/ })).toBeDefined()
  expect(await live.find({ text: /✓ specifier — three streams specified/ })).toBeDefined()
  expect(calls.pushes.some(m => m.includes('1/1 delivered'))).toBe(true)

  // History lists the run from its retro, and opens it on the per-card verdicts.
  await live.press({ plugin: 'workflow-gate-terminal', key: 't-history' } as never)
  expect(await live.find({ text: /1\/1 delivered/ })).toBeDefined()
  await live.press({ plugin: 'workflow-gate-terminal', key: 'h-wf_r1' } as never)
  expect(await live.find({ text: /✓ specifier — three streams specified/ })).toBeDefined()
  expect(await live.find({ text: /→ next time: add acceptance criteria to verify/ })).toBeDefined()
  expect(await live.find({ text: /specifier: delivered 1\/1/ })).toBeDefined() // the track record
})

test('parsers and the label record are strict about what they keep', async () => {
  expect(parseReview('{"verdict":"maybe"}')).toBeUndefined()
  expect(parseReview('{"verdict":"ok","items":[]}')).toEqual({ verdict: 'ok', items: [] })
  const r = parseRetro('{"cards":[{"card":"a","delivered":"no","why":"x"}],"flags":[{"n":1,"founded":true},{"n":9,"founded":false}],"summary":"s"}', 1)!
  expect(r.flags.map(f => f.n)).toEqual([1]) // flag 9 does not exist in a 1-flag run
  const rec = mergeRecords({}, r, [{ cardId: 'a0', kind: 'k', why: 'w', agent: 'a' }], 5)
  expect(rec.a).toEqual({ runs: 1, yes: 0, partial: 0, no: 1, founded: 1, unfounded: 0, lastAt: 5 })
  expect(readJournal('{"type":"result","agentId":"x","result":{"ok":true}}\nnot json').get('x')?.result).toContain('"ok": true')
})

test('the selected card opens with a plain-language description written by haiku', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('model.complete', (_$, e) => {
    const sys = String((e as { system?: unknown }).system ?? '')
    const text = sys.startsWith('You explain the agents') ? JSON.stringify({ cards: [
      { id: 'a0', goal: 'A spec precise enough that each stream can be built alone', does: 'Reads the brief and splits the work into independent streams', delivers: 'One written spec per stream' },
      { id: 'a1', goal: 'Catch gaps in the spec before anything is built', does: 'Checks the spec against the brief', delivers: 'A pass or a list of fixes' },
    ] }) : '{"verdict":"ok","items":[]}'
    return { value: { isAnswered: true, text, usage: {} } } as never
  })
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC } as never) // held: the first card is selected, so open
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ in: 'canvas-plan', text: /describing this step/ })).toBeDefined()
  await clock.advance(4100)
  expect(await pane.find({ in: 'canvas-plan', text: /🎯 A spec precise enough/ })).toBeDefined()
  expect(await pane.find({ in: 'canvas-plan', text: /📦 One written spec per stream/ })).toBeDefined()
  expect(await pane.find({ in: 'canvas-plan', text: /Catch gaps in the spec/ })).toBeUndefined() // only the open card shows it
})
