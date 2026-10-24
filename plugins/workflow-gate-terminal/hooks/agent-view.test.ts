import { test, expect, mock } from 'claude-code/testing'
import { describeCall, lastSentence, prettyResult } from './register.tsx'

const SRC = `export const meta = { name: 'view-demo', description: 'x', phases: [] }
await agent('You are the SPECIFIER. Write the specification for every stream of the round.', { label: 'specifier', model: 'opus' })`
const PANE = { plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 150 }, viewport: { columns: 160, rows: 80 } } as never

test('Live lists each agent in one line; Open shows its story: thoughts, tools, in order', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.call', (_$, e) => ((e as { tool: string }).tool === 'Grep' ? { deny: 'no' } : { result: { text: 'ok' } }) as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5', agentId: 'ag1' }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('turn.step', async function* () {
    yield { kind: 'thinking', index: 0, text: 'The streams are listed in the brief. I will check the config first.' } as never
    return { turnId: 't', index: 0, answer: '', toolUses: [] } as never
  })

  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await $.tool.call({ tool: 'Workflow', script: SRC } as never) // held: selects the specifier card
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_v1' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream of the round.', workflow: { runId: 'wf_v1', agentIndex: 1 } } as never)
  const it = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5', messageCount: 1, agentId: 'ag1' } as never)[Symbol.asyncIterator]()
  for (;;) if ((await it.next()).done) break
  await $.tool.call({ tool: 'Read', file_path: '/repo/config.ts', agentId: 'ag1' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'streams', agentId: 'ag1' } as never)

  const pane = await $.ui.mount(PANE)
  await pane.press({ plugin: 'workflow-gate-terminal', key: 't-live' } as never)
  expect(await pane.find({ text: /specifier · 💭 I will check the config first\./ })).toBeDefined() // one line in Live
  expect(await pane.find({ text: /done: ✓ Read/ })).toBeUndefined() // no task dump in Live any more
  await pane.press({ plugin: 'workflow-gate-terminal', key: 'open-ag1' } as never)
  expect(await pane.find({ key: 't-agent' })).toBeDefined()
  expect(await pane.find({ text: /💭 The streams are listed in the brief\. I will check the config first\./ })).toBeDefined()
  expect(await pane.find({ text: /✓ Read: \/repo\/config\.ts/ })).toBeDefined()
  expect(await pane.find({ text: /✗ Grep: streams/ })).toBeDefined()
})

test('a tool call reads as one line; a stream reads as its latest sentence; a result reads as lines', async () => {
  expect(describeCall('Bash', { command: 'cd /home/user/Repos/x && python3 tools/gen.py' })).toBe('Bash: python3 tools/gen.py')
  expect(describeCall('Read', { file_path: '/home/user/Repos/x/a.ts' })).toBe('Read: ~/Repos/x/a.ts')
  expect(prettyResult('{"branch":"mp0-C","commits":["8e8 refactor","45c feat"],"done":true}')).toEqual(['branch: mp0-C', 'commits:', '  • 8e8 refactor', '  • 45c feat', 'done: true'])
  expect(describeCall('Bash', { command: 'npm test', description: 'Run the tests' })).toBe('Bash: Run the tests')
  expect(describeCall('Read', { file_path: '/a/b.ts' })).toBe('Read: /a/b.ts')
  expect(describeCall('TaskStop', {})).toBe('TaskStop')
  expect(lastSentence('First I read it. Then I patch   the gate')).toBe('Then I patch the gate')
})

test('the canvas is drawn at full height, so the pane itself scrolls (wheel, arrows, page keys)', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"verdict":"ok","items":[]}', usage: {} } }) as never)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  const long = `export const meta = { name: 'tall', description: 'x', phases: [] }\n` +
    Array.from({ length: 6 }, (_, i) => `await agent('You are step ${i}. Do part ${i} of the work and report it.', { label: 'step${i}', model: 'sonnet' })`).join('\n')
  await $.tool.call({ tool: 'Workflow', script: long } as never)
  const pane = await $.ui.mount({ ...(PANE as object), props: { title: 'Workflow gate', isFocused: true, bodyColumns: 150, scroll: { offset: 0, bodyRows: 12 } } } as never)
  const canvas = await pane.find({ key: 'canvas-plan' })
  expect(canvas?.type).toBe('Client') // the Plan tab: the interactive canvas
  expect(Number(canvas?.props.height)).toBeGreaterThan(40) // six cards, never clipped to the 12-row body
})
