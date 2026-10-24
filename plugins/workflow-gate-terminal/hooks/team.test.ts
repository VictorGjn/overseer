import { test, expect, mock } from 'claude-code/testing'
import { isShareable, parsePatterns, teamPatterns, teamPath, teamUser } from './team.ts'

test('only lessons about designing workflows are shared: paths, code, URLs, addresses and project words stay home', async () => {
  const ok = { topic: 'verification' as const, lesson: 'A verifier on the same tier as the builder passes what it should catch; put it one tier up.', when: 'a build step is checked by a verify step' }
  expect(isShareable(ok, ['orbit-sim-phase0', 'battery'])).toBe(true)
  expect(isShareable({ ...ok, lesson: 'Run tools/battery.py on a quiet machine' }, [])).toBe(false) // a file
  expect(isShareable({ ...ok, lesson: 'See /home/user/Repos/x/ for the setup' }, [])).toBe(false) // a path
  expect(isShareable({ ...ok, lesson: 'Ask jane.doe@example.com first' }, [])).toBe(false) // an address
  expect(isShareable({ ...ok, lesson: 'The battery regressions were dismissed as noise' }, ['battery'])).toBe(false) // the project
  expect(parsePatterns([ok, { topic: 'gossip', lesson: 'x' }, { topic: 'cost', lesson: '' }], [])).toEqual([ok])
})

test('team lessons: newest first, the same lesson from two people kept once with its count', async () => {
  const p = { topic: 'models' as const, lesson: 'Mechanical steps belong on haiku.', when: '' }
  const runs = [
    { v: 2 as const, id: 'a', user: 'ana', at: 1, agents: 3, patterns: [p] },
    { v: 2 as const, id: 'b', user: 'jane', at: 2, agents: 5, patterns: [{ ...p, lesson: 'Mechanical steps belong on Haiku!' }, { topic: 'cost' as const, lesson: 'Pass summaries, not raw results, between steps.', when: '' }] },
  ]
  const out = teamPatterns(runs)
  expect(out.length).toBe(2)
  expect(out[0]).toMatchObject({ user: 'jane', times: 2 })
  expect(teamUser('Jane.Doe@example.com', 'x')).toBe('jane.doe')
  expect(teamPath({ user: 'jane.doe', at: Date.UTC(2026, 9, 7), id: 'abc123' })).toBe('jane.doe/2026-10-07-abc123.json')
})

const SRC = `export const meta = { name: 'secret-project-run', description: 'x', phases: [] }
await agent('You are the SPECIFIER. Write the specification for every stream of the round.', { label: 'specifier', model: 'opus' })`

test('sharing: after a retro, only its general lessons are committed and pushed — not the project, its steps or its lesson', { options: { teamHistory: 'share', teamHistoryRemote: 'https://example.com/team-history.git' } }, async ($, on) => {
  mock.env(on, { HOME: '/home/user', USER: 'user' })
  const clock = mock.clock(on)
  mock.store(on)
  const written: Record<string, string> = {}
  const gitCalls: string[][] = []
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/tmp' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.list', () => ({ value: [] }) as never)
  on('fs.read', () => ({ deny: 'none' }) as never)
  on('fs.write', (_$, e) => { const x = e as { path: string; text: string }; written[x.path] = x.text; return { value: undefined } as never })
  on('process.run', (_$, e) => { const argv = (e as { argv: string[] }).argv; gitCalls.push(argv); return { value: { exitCode: 0, stdout: argv.includes('user.email') ? 'Ana.Martin@example.com\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never })
  on('tool.call', () => ({ result: { text: 'Workflow launched in background. Task ID: wt1\nRun ID: wf_t1' } }) as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5', agentId: 'ag1' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('model.complete', (_$, e) => {
    const sys = String((e as { system?: unknown }).system ?? '')
    const text = sys.startsWith('A multi-agent workflow run just finished') ? JSON.stringify({
      cards: [{ card: 'specifier', delivered: 'partial', why: 'missed the export stream of secret-project' }], flags: [],
      summary: 'secret-project: ask the specifier to list the export stream',
      patterns: [
        { topic: 'missions', lesson: 'A specifier should enumerate every stream before detailing any, so none is silently dropped.', when: 'a spec step fans out into builders' },
        { topic: 'structure', lesson: 'The secret-project run needs a second spec pass', when: '' },
      ],
    }) : '[]'
    return { value: { isAnswered: true, text, usage: {} } } as never
  })
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await clock.advance(10) // the background sync: clone checked, user read from git
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_t1' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream of the round.', workflow: { runId: 'wf_t1', agentIndex: 1 } } as never)
  await $.turn.complete({ turnId: 'ag1', agentId: 'ag1', answer: 'ok', durationMs: 10, isAborted: false, reason: 'end_turn' } as never)
  await clock.advance(125000) // the run ends: 2 min with no agent

  const [path, text] = Object.entries(written).find(([p]) => p.includes('workflow-gate-team-history/ana.martin/'))!
  expect(path).toMatch(/\/home\/user\/\.claude\/workflow-gate-team-history\/ana\.martin\/\d{4}-\d\d-\d\d-\w+\.json$/)
  const shared = JSON.parse(text)
  expect(shared.patterns).toEqual([{ topic: 'missions', lesson: 'A specifier should enumerate every stream before detailing any, so none is silently dropped.', when: 'a spec step fans out into builders' }])
  expect(text).not.toContain('secret-project') // neither the project's lesson nor its name
  expect(text).not.toContain('specifier"') // nor its steps' verdicts
  expect(gitCalls.some(a => a.includes('push'))).toBe(true)
  expect(gitCalls.find(a => a.includes('commit'))?.join(' ')).not.toContain('secret-project')
})

for (const mode of ['read', 'share']) {
  test(`team history ${mode} with no remote does nothing: no git call, no message`, { options: { teamHistory: mode, teamHistoryRemote: '' } }, async ($, on) => {
    mock.env(on, { HOME: '/home/user', USER: 'user' })
    const clock = mock.clock(on)
    mock.store(on)
    const gitCalls: string[][] = []
    const toasts: string[] = []
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
    on('ui.toast', (_$, e) => { toasts.push(JSON.stringify(e)); return { value: undefined } as never })
    on('command.register', () => ({ value: undefined }) as never)
    on('session.start', () => ({ cwd: '/tmp' }) as never)
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
    on('fs.exists', () => ({ value: false }) as never)
    on('fs.list', () => ({ value: [] }) as never)
    on('fs.read', () => ({ deny: 'none' }) as never)
    on('fs.write', () => ({ value: undefined }) as never)
    on('process.run', (_$, e) => { gitCalls.push((e as { argv: string[] }).argv); return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never })
    await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
    await clock.advance(10)
    expect(gitCalls.filter(a => a[0] === 'git')).toEqual([])
    expect(toasts).toEqual([])
  })
}
