import { test, expect } from 'claude-code/testing'
import { peerOf, stuckWhy } from './peers.ts'
import { stageOf } from './board.ts'
import { NOW, SAMPLES } from './stuck.samples.ts'

const a = { lot: 1, assignedAt: NOW - 3600e3 }
const check = (name: string) => {
  const s = SAMPLES.find(x => x.name.startsWith(name))!
  const p = peerOf(s.rows)!
  return { why: stuckWhy(p, NOW), stage: stageOf({ ...p, lastRole: 'assistant' }, a, false, NOW), want: s }
}

test('a slow call is stuck: 14 min against a 60-100 s habit', () => {
  const r = check('a slow call')
  expect(r.why).toBe(r.want.why)
  expect(r.stage).toBe('stuck')
})

test('a long but usual call is not stuck: 12 min against a 9-11 min habit', () => {
  const r = check('a long but usual')
  expect(r.why).toBeUndefined()
  expect(r.stage).toBe('work')
})

test('a short history, a call under 5 min, and a call that waits on purpose are not stuck', () => {
  for (const n of ['a short history', 'under 5 min', 'a call that waits']) expect(check(n).why).toBeUndefined()
})

test('a loop is stuck: the same call 4 times in a row; 3 and another is not', () => {
  const r = check('a loop')
  expect(r.why).toBe('same call 4 times in a row')
  expect(r.stage).toBe('stuck')
  expect(check('not a loop').why).toBeUndefined()
})

test('repeated failures are stuck: 3 Edits in a row, all errors', () => {
  const r = check('repeated failures')
  expect(r.why).toBe('Edit failed 3 times in a row')
  expect(r.stage).toBe('stuck')
})

test('a pending call with no history for 14 min is work, not stuck', () => {
  const p = peerOf(SAMPLES[0]!.rows.slice(-1))!
  expect(p.busySince).toBeDefined()
  expect(stuckWhy(p, NOW)).toBeUndefined()
})

test('shell calls are keyed by their program; assignments are skipped; background shells never wait', () => {
  const row = (type: string, content: object[]) => JSON.stringify({ type, sessionId: 's', timestamp: '2026-10-09T10:00:00Z', message: { content } })
  const bash = (command: string, extra: object = {}) => peerOf([row('assistant', [{ type: 'tool_use', id: 't', name: 'Bash', input: { command, ...extra } }])])!.waiting?.key
  expect(bash('cd a && npm test')).toBe('Bash:npm')
  expect(bash('cd a; rtk git status')).toBe('Bash:git')
  expect(bash('CI=1 FOO=2 npm test')).toBe('Bash:npm')
  expect(bash('npm run dev', { run_in_background: true })).toBeUndefined()
})
