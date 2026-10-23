import { test, expect } from 'claude-code/testing'
import { liveBackground, peerOf } from './peers.ts'
import { isIdle } from './plan.ts'

const T0 = Date.parse('2026-10-12T21:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const say = (min: number, text: string, extra: object[] = []) => JSON.stringify({ type: 'assistant', sessionId: 's1', cwd: '/x', timestamp: iso(min), message: { content: [{ type: 'text', text }, ...extra] } })
const user = (min: number, content: unknown, extra: object = {}) => JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/x', timestamp: iso(min), ...extra, message: { content } })
const launch = [say(0, 'Launching', [{ type: 'tool_use', id: 't1', name: 'Workflow', input: {} }]), user(0, [{ type: 'tool_result', tool_use_id: 't1', content: 'Workflow launched in background. Task ID: wmwyly2nt' }])]
const note = (status: string) => user(1, `<task-notification>\n<task-id>wmwyly2nt</task-id>\n<status>${status}</status>\n</task-notification>`)
const min = (n: number) => T0 + n * 60e3

test('a background task nobody mentions for 5 min is dropped; a recent mention keeps it', () => {
  const p = peerOf([...launch, say(1, 'Stopped.')])!
  expect(p.background).toEqual(['wmwyly2nt'])
  expect(liveBackground(p, min(7))).toEqual([])
  expect(isIdle(p, min(7))).toBe(true)
  const q = peerOf([...launch, say(1, 'Stopped.'), say(4, 'waiting on wmwyly2nt')])!
  expect(liveBackground(q, min(7))).toEqual(['wmwyly2nt'])
  expect(isIdle(q, min(7))).toBe(false)
})

test('a task-notification that is not running drops the task at once', () => {
  for (const st of ['killed', 'failed', 'stopped', 'completed']) expect(peerOf([...launch, note(st)])!.background).toEqual([])
  expect(peerOf([...launch, note('running')])!.background).toEqual(['wmwyly2nt'])
})

test('the registry decides: idle is free at once, busy is not, no entry keeps the 2 min rule', () => {
  const p = peerOf([say(0, 'Done.')])!
  const now = min(0) + 10e3
  expect(isIdle(p, now, { status: 'idle' })).toBe(true)
  expect(isIdle(p, now)).toBe(false)
  expect(isIdle(p, min(3))).toBe(true)
  expect(isIdle(peerOf([say(0, 'Run', [{ type: 'tool_use', id: 't9', name: 'Bash', input: {} }])])!, now, { status: 'idle' })).toBe(false) // a tool still runs
  expect(isIdle(p, min(3), { status: 'busy' })).toBe(false)
  expect(isIdle(p, min(3), { status: 'waiting' })).toBe(false)
  expect(isIdle(p, min(3), { status: 'shell' })).toBe(false)
})

test('plan mode (a user row field or a permission-mode row) is never free; back to auto it is', () => {
  const plan = { type: 'permission-mode', permissionMode: 'plan', sessionId: 's1' }
  const auto = { ...plan, permissionMode: 'auto' }
  const a = peerOf([user(0, 'plan it', { permissionMode: 'plan' }), say(1, 'Here is a plan.')])!
  expect(a.mode).toBe('plan')
  expect(isIdle(a, min(10), { status: 'idle' })).toBe(false)
  const b = peerOf([say(0, 'Hi.'), JSON.stringify(plan), say(1, 'Here is a plan.')])!
  expect(b.mode).toBe('plan')
  expect(isIdle(b, min(10), { status: 'idle' })).toBe(false)
  const c = peerOf([say(0, 'Hi.'), JSON.stringify(plan), say(1, 'Plan.'), JSON.stringify(auto)])!
  expect(c.mode).toBe('auto')
  expect(isIdle(c, min(10), { status: 'idle' })).toBe(true)
})
