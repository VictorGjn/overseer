import { test, expect, mock } from 'claude-code/testing'
import type { Board } from './board.ts'
import { approvedMessage, fingerprintOf } from './gate.ts'
import SAMPLE_PLAN from './fixtures/sample-repo.ts'

// The first run of the README on the sample repository (examples/sample-repo, its PLAN.md in fixtures/sample-repo.ts):
// /oversee watch, /oversee plan, /oversee run, /oversee show, then the approval of a workflow from the board.
const T0 = Date.parse('2026-10-22T10:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const SCRIPT = "export const meta = { name: 'finish-the-cli', description: 'x' }\nawait agent('a', { model: 'sonnet' })"
const held = [
  JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: iso(0), message: { content: [{ type: 'tool_use', id: 'wf1', name: 'Workflow', input: { script: SCRIPT } }] } }),
  JSON.stringify({ type: 'user', sessionId: 'w1', cwd: '/r', timestamp: iso(0), message: { content: [{ type: 'tool_result', tool_use_id: 'wf1', is_error: true, content: '<tool_use_error>⛔ workflow-gate (terminal): the plan "finish-the-cli" (≥1 agents) is shown to the human in the terminal.</tool_use_error>' }] } }),
]
const DIR = '/h/.claude/overseer/requests/r'

test('first run on the sample repo: watch, plan, run, show, and a workflow approved from the board', async ($, on) => {
  const files: Record<string, string> = {
    '/r/PLAN.md': SAMPLE_PLAN,
    '/h/.claude/sessions/4242.json': JSON.stringify({ pid: 4242, sessionId: 'w1', name: 'alpha' }),
    '/h/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'workflow-gate@overseer': [{ installPath: '/c/wg/1.9.0' }] } }),
    '/h/.claude/overseer/web.json': JSON.stringify({ port: 4318, token: 'ab'.repeat(32), pid: 1 }),
  }
  const sent: { to: string; text: string }[] = []
  const runs: string[][] = []
  const submitted: string[] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 + 5 * 60e3 })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => $$.ui.resolve(e).Box({}))
  on('prompt.submit', (_$, e) => { submitted.push((e as { text: string }).text); return { drop: 'captured by the test' } as never })
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    runs.push(c)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '/h/.claude/sessions/4242.json' : '/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(held.join('\n'))
    if (c[0] === 'ls' && c.at(-1) === DIR) return out(Object.keys(files).filter(f => f.startsWith(`${DIR}/`)).map(f => f.slice(DIR.length + 1)).join('\n'))
    if (c[0] === 'rm') { delete files[c[2]!]; return out('') }
    if (c[0] === 'node' && c[2] === 'approve-path') return out('✅ recorded')
    if (c.includes('--show-toplevel')) return out('/r')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('session.send', (_$, e) => { const x = e as { to: { sessionId?: string }; text: string }; sent.push({ to: x.to.sessionId ?? String(x.to), text: x.text }); return { isDelivered: true } as never })
  const board = () => JSON.parse(files['/h/.claude/overseer/boards/r.json']!) as Board & { requests?: { id: string; state: string }[] }

  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  // watch: the listing names the session, then the session is driven
  expect(JSON.stringify(await $.command.run({ command: 'oversee', args: '' } as never))).toContain('alpha')
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  // plan: asks Claude to write PLAN.md for a goal (the file of the sample repo stays as it is until Claude writes it)
  expect(JSON.stringify(await $.command.run({ command: 'oversee', args: 'plan finish the greeting CLI' } as never))).toContain('Asked Claude to write PLAN.md')
  await clock.advance(10)
  expect(submitted.join('')).toContain('for this goal: finish the greeting CLI')
  expect(files['/r/PLAN.md']).toBe(SAMPLE_PLAN)
  // run: the first task of the sample plan goes to the watched session, with the rules
  expect(JSON.stringify(await $.command.run({ command: 'oversee', args: 'run 10' } as never))).toContain('1 task(s) given')
  expect(sent.map(x => x.text).join('\n')).toContain('Your task: 1. Add the hello command')
  expect(files['/r/PLAN.md']).toContain('## [~] 1. Add the hello command')
  // show: the board is written for the page, with the three tasks of the sample plan and the workflow held at the gate
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  expect(board().lots.map(l => l.n)).toEqual([1, 2, 3])
  const fp = await fingerprintOf(SCRIPT)
  expect(board().sessions[0]!.gate).toEqual({ name: 'finish-the-cli', fp, state: 'pending' })
  // approval from the board: the gate records it and the session is told to run the plan it approved
  files[`${DIR}/req-1.json`] = JSON.stringify({ kind: 'gate', id: 'req-1', session: 'w1', action: 'approve', plan: fp, at: 1 })
  await clock.advance(2000)
  for (let i = 0; i < 400 && !board().requests?.some(r => r.id === 'req-1'); i++) await clock.advance(1)
  expect(board().requests?.find(r => r.id === 'req-1')?.state).toBe('done')
  expect(runs.some(c => c[0] === 'node' && c[2] === 'approve-path')).toBe(true)
  expect(sent.some(x => x.text === approvedMessage('finish-the-cli', `/h/.claude/overseer/gate/gate-${fp}.mjs`))).toBe(true)
})
