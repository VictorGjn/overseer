import { test, expect, mock } from 'claude-code/testing'
import { extract, splice } from './plan.ts'

const SRC = `export const meta = { name: 'review-changes', description: 'x', phases: [{ title: 'Review' }] }
const DIMS = ['bugs', 'perf']
const reviews = await parallel(DIMS.map(d => () => agent(\`Review the diff for \${d}. Report findings.\`, { label: 'review', phase: 'Review', model: 'opus' })))
const verdict = await agent('Synthesize the findings. Rank by severity.', { label: "synth", model: "sonnet" })
await agent(buildPrompt(verdict), { label: 'ship' })`

test('extract finds every agent() site with its label, model and purpose', async () => {
  const { name, sites } = extract(SRC)
  expect(name).toBe('review-changes')
  expect(sites.map(s => s.label)).toEqual(['review', 'synth', 'ship'])
  expect(sites.map(s => s.model)).toEqual(['opus', 'sonnet', undefined])
  expect(sites[0]!.isFanOut).toBe(true)
  expect(sites[1]!.isFanOut).toBe(false)
  expect(sites[0]!.purpose).toBe('Review the diff for ….')
  expect(sites[2]!.purpose).toBe('(prompt built at runtime)')
})

test('splice changes only the model literals asked, byte-identical otherwise', async () => {
  const { sites } = extract(SRC)
  expect(splice(SRC, sites, {})).toBe(SRC)
  const out = splice(SRC, sites, { 0: 'sonnet', 1: 'haiku', 2: 'opus' })
  expect(out).toBe(SRC.replace("model: 'opus'", "model: 'sonnet'").replace('model: "sonnet"', 'model: "haiku"'))
})

test('an unapproved inline Workflow is held in the terminal, not run', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  const res = await $.tool.call({ tool: 'Workflow', script: SRC })
  expect(JSON.stringify(res)).toContain('workflow-gate (terminal)')
})

test('Approve & run records against the copy of the gate that enforces, not the first install listed', async ($, on) => {
  mock.env(on, { HOME: '/home' })
  mock.clock(on)
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  on('session.id', () => ({ value: 's1' }) as never)
  // Two installs at two versions, as Claude Code keeps them: the marketplace cache is what
  // installed_plugins.json lists first, the remote copy is what actually runs the hooks. The
  // fingerprint carries the version, so recording against the cache files the approval under a key
  // the running gate never reads — the human approves and the gate still refuses.
  const files: Record<string, string> = {
    '/home/.claude/workflow-gate/active/s1.json': JSON.stringify({ hook: '/remote/1.9.0/hooks/workflow-plan-gate.mjs', root: '/remote/1.9.0', version: '1.9.0' }),
    '/home/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'workflow-gate@overseer': [{ installPath: '/cache/1.8.0' }] } }),
  }
  on('fs.read', (_$, e) => { const f = files[(e as { path: string }).path]; return (f ? { value: f } : { deny: 'no such file' }) as never })
  on('fs.write', () => ({ value: undefined }) as never)
  let argv: string[] = []
  on('process.run', (_$, e) => { argv = (e as { argv: string[] }).argv; return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never })
  on('prompt.submit', () => ({ drop: 'held by the test' }) as never)
  await $.tool.call({ tool: 'Workflow', script: SRC })
  const pane = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 110, placement: 'dock' } as never, viewport: { columns: 120, rows: 50 } as never })
  await pane.press({ plugin: 'workflow-gate-terminal', key: 'approve' } as never)
  expect(argv.slice(0, 3)).toEqual(['node', '/remote/1.9.0/hooks/workflow-plan-gate.mjs', 'approve-path'])
})

test('with no active copy, the gate is found under any marketplace name, the enabled one first', async ($, on) => {
  mock.env(on, { HOME: '/home' })
  mock.clock(on)
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  on('session.id', () => ({ value: 's2' }) as never)
  const files: Record<string, string> = {
    '/home/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'workflow-gate@old-market': [{ installPath: '/cache/old' }], 'workflow-gate@my-market': [{ installPath: '/cache/mine' }] } }),
    '/home/.claude/settings.json': JSON.stringify({ enabledPlugins: { 'workflow-gate@old-market': false, 'workflow-gate@my-market': true } }),
  }
  on('fs.read', (_$, e) => { const f = files[(e as { path: string }).path]; return (f ? { value: f } : { deny: 'no such file' }) as never })
  on('fs.write', () => ({ value: undefined }) as never)
  let argv: string[] = []
  on('process.run', (_$, e) => { argv = (e as { argv: string[] }).argv; return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never })
  on('prompt.submit', () => ({ drop: 'held by the test' }) as never)
  await $.tool.call({ tool: 'Workflow', script: SRC })
  const pane = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 110, placement: 'dock' } as never, viewport: { columns: 120, rows: 50 } as never })
  await pane.press({ plugin: 'workflow-gate-terminal', key: 'approve' } as never)
  expect(argv.slice(0, 3)).toEqual(['node', '/cache/mine/hooks/workflow-plan-gate.mjs', 'approve-path'])
})

test('a plugin reload with a plan still pending seats the pane again, so its buttons are this module\'s', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  const opened: string[] = []
  on('ui.open', (_$, e) => { opened.push(String((e as { id: string }).id)); return { value: { isPlaced: true } } as never })
  await $.tool.call({ tool: 'Workflow', script: SRC })
  opened.length = 0
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never) // what a /reload-plugins runs again
  expect(opened).toContain('workflow-gate')
})
