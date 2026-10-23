import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import type { Board } from './board.ts'
import { decisionLine } from './board.ts'
import { approvedMessage, changeMessage, fingerprintOf, gateCard, rejectMessage, SUMMARY } from './gate.ts'

// Approving a watched session's workflow from the web board (lot 48), end to end through the lead.
const T0 = Date.parse('2026-10-22T10:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const SCRIPT = "export const meta = { name: 'build-the-api', description: 'x' }\nawait agent('a', { model: 'sonnet' })"
const held = (script = SCRIPT) => [
  JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: iso(0), message: { content: [{ type: 'tool_use', id: 'wf1', name: 'Workflow', input: { script } }] } }),
  JSON.stringify({ type: 'user', sessionId: 'w1', cwd: '/r', timestamp: iso(0), message: { content: [{ type: 'tool_result', tool_use_id: 'wf1', is_error: true, content: '<tool_use_error>⛔ workflow-gate (terminal): the plan "build-the-api" (≥1 agents) is shown to the human in the terminal.</tool_use_error>' }] } }),
]
const TOKEN = 'ab'.repeat(32)
const CLI = '/c/wg/1.9.0/hooks/workflow-plan-gate.mjs'
const DIR = '/h/.claude/overseer/requests/r'

function setup(on: On) {
  const files: Record<string, string> = {
    '/r/PLAN.md': '# Plan — Ship it\n\n## [ ] 1. First\ndone when: it ships\n',
    '/h/.claude/sessions/4242.json': JSON.stringify({ pid: 4242, sessionId: 'w1', name: 'alpha' }),
    '/h/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'workflow-gate@overseer': [{ installPath: '/c/wg/1.9.0' }] } }),
    '/h/.claude/overseer/web.json': JSON.stringify({ port: 4318, token: TOKEN, pid: 1 }),
  }
  const tail = { rows: held() }
  const sent: { to: string; text: string }[] = []
  const runs: string[][] = []
  const toasts: string[] = []
  const approve = { exitCode: 0 }
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 + 5 * 60e3 })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.toast', (_$, e) => { toasts.push(String((e as { text?: string }).text ?? JSON.stringify(e))); return { value: undefined } as never })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    runs.push(c)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: exitCode ? 'state file locked' : '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '/h/.claude/sessions/4242.json' : '/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(tail.rows.join('\n'))
    if (c[0] === 'ls' && c.at(-1) === DIR) return out(Object.keys(files).filter(f => f.startsWith(`${DIR}/`)).map(f => f.slice(DIR.length + 1)).join('\n'))
    if (c[0] === 'rm') { delete files[c[2]!]; return out('') }
    if (c[0] === 'node' && c[2] === 'approve-path') return out('✅ recorded', approve.exitCode)
    if (c.includes('--show-toplevel')) return out('/r')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('session.send', (_$, e) => { const x = e as { to: { sessionId?: string }; text: string }; sent.push({ to: x.to.sessionId ?? String(x.to), text: x.text }); return { isDelivered: true } as never })
  const board = () => JSON.parse(files['/h/.claude/overseer/boards/r.json']!) as Board & { requests?: { id: string; state: string; why?: string }[] }
  const request = (id: string, o: object) => { files[`${DIR}/${id}.json`] = JSON.stringify({ kind: 'gate', id, session: 'w1', action: 'approve', at: 1, ...o }) }
  const gateSent = () => sent.filter(x => x.text.startsWith('[workflow-gate]'))
  // The lead acts on its 2 s clock, then rewrites the board: wait until the board says what became of the request.
  const acted = async (id: string) => {
    await clock.advance(2000)
    for (let i = 0; i < 400 && !board().requests?.some(r => r.id === id); i++) await clock.advance(1)
    return board().requests?.find(r => r.id === id)
  }
  return { files, tail, sent, runs, toasts, approve, clock, board, request, gateSent, acted }
}
async function start($: Engine) {
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  return (await $.command.run({ command: 'oversee', args: 'show' } as never)) as unknown as { text: string }
}

test('approve from the board: approve-path on the plan the board showed, the session told to run it, then the log, DECISIONS.md and the card', async ($, on) => {
  const s = setup(on)
  // The gate copy that runs the target session's hooks wins: its active file, not the lead's, not installed_plugins.json.
  s.files['/h/.claude/workflow-gate/active/w1.json'] = JSON.stringify({ hook: '/remote/hooks/workflow-plan-gate.mjs', version: '2.0.0' })
  s.files['/h/.claude/workflow-gate/active/lead.json'] = JSON.stringify({ hook: '/lead/hooks/workflow-plan-gate.mjs', version: '1.0.0' })
  await start($)
  const fp = await fingerprintOf(SCRIPT)
  expect(s.board().sessions[0]!.gate).toEqual({ name: 'build-the-api', fp, state: 'pending' })
  s.request('req-1', { plan: fp })
  await s.acted('req-1')
  const path = `/h/.claude/overseer/gate/gate-${fp}.mjs`
  expect(s.files[path]).toBe(SCRIPT)
  expect(s.runs.find(c => c[2] === 'approve-path')).toEqual(['node', '/remote/hooks/workflow-plan-gate.mjs', 'approve-path', '--path', path, '--summary', SUMMARY])
  expect(s.gateSent()).toEqual([{ to: 'w1', text: approvedMessage('build-the-api', path) }])
  expect(s.gateSent()[0]!.text).toMatch(/^\[workflow-gate\] Plan "build-the-api" approved from the board\. Run Workflow now with \{ scriptPath: /)
  expect(`${DIR}/req-1.json` in s.files).toBe(false)
  const b = s.board()
  expect(b.requests?.at(0)).toMatchObject({ id: 'req-1', kind: 'gate', state: 'done' })
  expect(b.feed.some(f => f.action === 'approved' && f.text.includes(SUMMARY))).toBe(true)
  const at = b.sessions[0]!.gate!.at!
  expect(b.sessions[0]!.gate).toMatchObject({ state: 'approved', fp })
  expect(gateCard(b.sessions[0]!.gate!)[1]).toBe(`approved from the board, ${new Date(at).toTimeString().slice(0, 5)}`)
  expect(s.files['/r/DECISIONS.md']).toContain(decisionLine(at, 1, 'Run the workflow "build-the-api"?', SUMMARY))

  s.request('req-2', { plan: fp }) // a second click
  await s.acted('req-2')
  expect(s.gateSent().length).toBe(1)
  expect(s.board().requests?.at(0)).toMatchObject({ id: 'req-2', state: 'dropped', why: 'this plan is already approved' })
})

test('the gate need names its action: sent through the queue as it stands, it approves the plan (the session input)', async ($, on) => {
  const s = setup(on)
  s.files['/h/.claude/workflow-gate/active/w1.json'] = JSON.stringify({ status: 'pending', name: 'build-the-api', hook: '/remote/hooks/workflow-plan-gate.mjs' }) // the stage 'gate' comes from the gate's own file
  await start($)
  const fp = await fingerprintOf(SCRIPT)
  const need = (s.board() as unknown as { needs: { kind: string; act: object }[] }).needs.find(n => n.kind === 'gate')!
  expect(need.act).toEqual({ kind: 'gate', session: 'w1', plan: fp, action: 'approve' })
  s.request('req-n', need.act)
  expect(await s.acted('req-n')).toMatchObject({ state: 'done' })
  expect(s.gateSent().map(x => x.text)).toEqual([approvedMessage('build-the-api', `/h/.claude/overseer/gate/gate-${fp}.mjs`)])
})

test('refused: a fingerprint the board did not show, a plan not pending, a session not watched, a gate that did not record it', async ($, on) => {
  const s = setup(on)
  await start($)
  const fp = await fingerprintOf(SCRIPT)
  const drop = async (id: string, o: object) => { s.request(id, o); return s.acted(id) }
  expect(await drop('r-a', { plan: 'f'.repeat(16) })).toMatchObject({ state: 'dropped', why: 'the board did not show this plan' })
  expect(await drop('r-b', { plan: fp, session: 'other' })).toMatchObject({ state: 'dropped', why: 'the session is not watched' })
  s.approve.exitCode = 1
  expect(await drop('r-c', { plan: fp })).toMatchObject({ state: 'dropped', why: 'the gate did not record the approval: state file locked' })
  s.approve.exitCode = 0
  expect(s.runs.find(c => c[2] === 'approve-path')?.[1]).toBe(CLI) // no active file: installed_plugins.json
  // The agent changes its plan: the board has not shown the new one, so the old fingerprint and a guessed new one both fail.
  s.tail.rows = held(SCRIPT + '\nawait agent("b")')
  expect(await drop('r-d', { plan: fp })).toMatchObject({ state: 'dropped', why: 'the plan changed since the board showed it' })
  expect(await drop('r-d2', { plan: await fingerprintOf(SCRIPT + '\nawait agent("b")') })).toMatchObject({ state: 'dropped', why: 'the board did not show this plan' }) // the agent's own new plan
  s.tail.rows = []
  expect(await drop('r-e', { plan: fp })).toMatchObject({ state: 'dropped', why: 'no workflow plan is pending in that session' })
  expect(s.gateSent()).toEqual([])
  expect(Object.keys(s.files).filter(f => f.startsWith(DIR))).toEqual([])
  expect(s.board().feed.filter(f => f.action === 'gate-dropped').length).toBeGreaterThan(0)
})

test('change sends the text as a plan change, reject a refusal; both leave a decision line', async ($, on) => {
  const s = setup(on)
  await start($)
  const fp = await fingerprintOf(SCRIPT)
  s.request('c-1', { plan: fp, action: 'change', text: 'one agent less' })
  await s.acted('c-1')
  expect(s.gateSent()).toEqual([{ to: 'w1', text: changeMessage('build-the-api', 'one agent less') }])
  expect(s.files['/r/DECISIONS.md']).toContain('Run the workflow "build-the-api"? · change from the board: one agent less')
  expect(s.runs.some(c => c[2] === 'approve-path')).toBe(false)
  s.request('c-2', { plan: fp, action: 'reject' })
  await s.acted('c-2')
  expect(s.gateSent()[1]).toEqual({ to: 'w1', text: rejectMessage('build-the-api') })
  expect(s.files['/r/DECISIONS.md']).toContain('Run the workflow "build-the-api"? · rejected from the board')
  expect(s.board().sessions[0]!.gate?.state).toBe('rejected')
})

test('/oversee show opens the web board with its token in the browser only: never in its text, the log, a toast or the board', async ($, on) => {
  const s = setup(on)
  const shown = await start($)
  expect(s.runs.filter(c => c[0] === 'open')).toEqual([['open', `http://127.0.0.1:4318/?t=${TOKEN}`]])
  expect(shown.text).toContain('web board opened in your browser')
  expect(shown.text).not.toContain(TOKEN)
  await $.command.run({ command: 'oversee', args: 'show' } as never) // once per server start
  expect(s.runs.filter(c => c[0] === 'open').length).toBe(1)
  const log = (await $.command.run({ command: 'oversee', args: 'log' } as never)) as unknown as { text: string }
  for (const t of [log.text, s.toasts.join('\n'), s.files['/h/.claude/overseer/boards/r.json']!, s.sent.map(x => x.text).join('\n')]) expect(t).not.toContain(TOKEN)
})
