import { test, expect } from 'claude-code/testing'
import { approvedMessage, decisionOf, fingerprintOf, gateCard, gateCliOf, gateRefusal, nameOf, parseGateRequest, SUMMARY } from './gate.ts'
import { peerOf } from './peers.ts'

const T0 = Date.parse('2026-10-22T10:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const use = (min: number, input: object, id = 'wf1') => JSON.stringify({ type: 'assistant', sessionId: 's1', cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'tool_use', id, name: 'Workflow', input }] } })
const result = (min: number, content: string, isError: boolean, id = 'wf1') => JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } })
const SCRIPT = "export const meta = { name: 'build-the-api', description: 'x' }\nawait agent('a', { model: 'sonnet' })"
const TERMINAL = '<tool_use_error>⛔ workflow-gate (terminal): the plan "build-the-api" (≥1 agents) is shown to the human in the terminal. Do NOT retry.</tool_use_error>'
const BROWSER = 'PreToolUse:Workflow hook error: ⛔ Workflow plan-gate — no recorded human approval for this exact script.'

test('peerOf: a Workflow call the gate holds is pending until a later Workflow call runs; any other error is not a hold', () => {
  expect(peerOf([use(0, { script: SCRIPT }), result(0, TERMINAL, true)])!.gate).toEqual({ id: 'wf1', name: 'build-the-api', script: SCRIPT, scriptPath: undefined, at: T0 })
  expect(peerOf([use(0, { scriptPath: '/r/.claude/workflow-gate/plan-9.mjs' }), result(1, BROWSER, true)])!.gate).toMatchObject({ name: 'plan-9', scriptPath: '/r/.claude/workflow-gate/plan-9.mjs' })
  expect(peerOf([use(0, { script: SCRIPT }), result(0, TERMINAL, true), use(5, { scriptPath: '/p.mjs' }, 'wf2'), result(5, 'Workflow launched in background. Task ID: w1', false, 'wf2')])!.gate).toBeUndefined()
  expect(peerOf([use(0, { script: SCRIPT }), result(0, 'SyntaxError: unexpected token', true)])!.gate).toBeUndefined()
  expect(peerOf([use(0, { script: SCRIPT })])!.gate).toBeUndefined() // no result yet: not held, running
  expect(peerOf([use(0, { name: 'saved' }), result(0, TERMINAL, true)])!.gate).toBeUndefined() // a saved workflow by name: nothing to approve by file
})

test('the request: only a well-formed gate request; a change needs its text', () => {
  const q = { kind: 'gate', id: 'r1', session: 's1', plan: 'abcd', action: 'approve', at: 1 }
  expect(parseGateRequest(JSON.stringify(q))).toEqual({ id: 'r1', session: 's1', plan: 'abcd', action: 'approve' })
  expect(parseGateRequest(JSON.stringify({ ...q, action: 'change', text: 'one agent less' }))?.text).toBe('one agent less')
  for (const bad of ['{', JSON.stringify({ ...q, kind: 'answer' }), JSON.stringify({ ...q, action: 'merge' }), JSON.stringify({ ...q, action: 'change' }), JSON.stringify({ ...q, plan: 7 })]) expect(parseGateRequest(bad)).toBeUndefined()
})

test('refused when the session is not watched, the plan is not pending, the board did not show it, or it changed', async () => {
  const fp = await fingerprintOf(SCRIPT)
  expect(fp).toMatch(/^[0-9a-f]{16}$/)
  expect(await fingerprintOf(SCRIPT + ' ')).not.toBe(fp)
  const req = { id: 'r1', session: 's1', plan: fp, action: 'approve' as const }
  expect(gateRefusal(req, { isWatched: true, shown: fp, now: fp })).toBeUndefined()
  expect(gateRefusal(req, { isWatched: false, shown: fp, now: fp })).toBe('the session is not watched')
  expect(gateRefusal(req, { isWatched: true, shown: fp, now: undefined })).toBe('no workflow plan is pending in that session')
  expect(gateRefusal(req, { isWatched: true, shown: undefined, now: fp })).toBe('the board did not show this plan')
  expect(gateRefusal({ ...req, plan: 'f'.repeat(16) }, { isWatched: true, shown: 'f'.repeat(16), now: fp })).toBe('the plan changed since the board showed it')
  expect(gateRefusal(req, { isWatched: true, shown: fp, now: fp, done: { fp, name: 'x', state: 'approved', at: 1 } })).toBe('this plan is already approved')
})

test('the gate CLI: the session\'s active file first, then installed_plugins.json, else none', () => {
  const installed = JSON.stringify({ plugins: { 'other@x': [{ installPath: '/o' }], 'workflow-gate@overseer': [{ installPath: '/c/wg/1.9.0' }] } })
  expect(gateCliOf(JSON.stringify({ hook: '/remote/wg/hooks/workflow-plan-gate.mjs', version: '2.0.0' }), installed)).toBe('/remote/wg/hooks/workflow-plan-gate.mjs')
  expect(gateCliOf(undefined, installed)).toBe('/c/wg/1.9.0/hooks/workflow-plan-gate.mjs')
  expect(gateCliOf('{', '{')).toBeUndefined()
  expect(gateCliOf(undefined, JSON.stringify({ plugins: {} }))).toBeUndefined()
})

test('the message, the decision line and the card', () => {
  expect(approvedMessage('build-the-api', '/h/g.mjs')).toBe('[workflow-gate] Plan "build-the-api" approved from the board. Run Workflow now with { scriptPath: "/h/g.mjs" } — not inline, and do not change the file.')
  expect(decisionOf('x', { action: 'approve' })).toEqual({ question: 'Run the workflow "x"?', answer: SUMMARY })
  expect(decisionOf('x', { action: 'change', text: 'less' }).answer).toBe('change from the board: less')
  expect(nameOf('no meta', 'fallback')).toBe('fallback')
  expect(gateCard({ name: 'x', fp: 'abcd', state: 'pending' })).toEqual(['Approve the workflow "x"?', 'plan abcd'])
  const at = T0 + 7 * 60e3
  expect(gateCard({ name: 'x', fp: 'abcd', state: 'approved', at })[1]).toBe(`approved from the board, ${new Date(at).toTimeString().slice(0, 5)}`)
  expect(gateCard({ name: 'x', fp: 'abcd', state: 'approved', at })[1]).toMatch(/^approved from the board, \d\d:\d\d$/)
})
