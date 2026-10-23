import { test, expect } from 'claude-code/testing'
import { peerOf } from './peers.ts'
import { changeMessage, lotMessage, PLAN_FORMAT, SESSION_RULES, WORKFLOW_LINE } from './plan.ts'
import { paceOf } from './board.ts'

// "task", not "lot": every text a person reads says task; the code names, the PLAN.md format and the old report form stay.
const say = (text: string) => JSON.stringify({ type: 'assistant', sessionId: 's1', cwd: '/r', timestamp: '2026-10-22T10:00:00Z', message: { content: [{ type: 'text', text }] } })

test('a report [task N …] counts like [lot N …], and so does a proposal: both forms keep working', () => {
  for (const [a, b] of [['[task 4 done on feat/x]', '[lot 4 done on feat/x]'], ['[task 4 blocked: needs the key]', '[lot 4 blocked: needs the key]'], ['[task 4 departs: new file]', '[lot 4 departs: new file]']]) {
    const t = peerOf([say(a!)])!.marker, l = peerOf([say(b!)])!.marker
    expect(t).toBeDefined()
    expect(t).toEqual(l)
  }
  expect(peerOf([say('[task 4 done on feat/x]')])!.marker).toMatchObject({ lot: 4, status: 'done', branch: 'feat/x' })
  expect(peerOf([say('[new task: Fix the radar — it is broken]')])!.proposal?.text).toBe(peerOf([say('[new lot: Fix the radar — it is broken]')])!.proposal?.text)
})

test('what a session is told says task; the PLAN.md format keeps its headings', () => {
  const m = lotMessage('Ship', { n: 9, title: 'Stuck', status: 'todo', doneWhen: 'it ships', depends: [], body: '' }, true)
  expect(m).toContain('Your task: 9. Stuck')
  expect(m).toContain('[task N done on <your branch>]')
  expect(m).toContain('[new task: <title> — <why>]')
  expect(m).not.toMatch(/\blots?\b/i.exec(m.replace(/\bPLAN\.md\b/g, ''))?.[0] ?? '\u0000')
  expect(SESSION_RULES('Ship')).not.toMatch(/\blots?\b/i)
  expect(PLAN_FORMAT).toContain('## [ ] 1. <task title>') // the heading marker is still `## [s] N.`
})

test('the pace is read from the log in both words: older "lot N" entries and new "task N" ones', () => {
  const log = (n: number, word: string, at: number) => [{ at, sessionId: 's', label: `${word} ${n}`, action: 'assign' as const, text: `${word} ${n}. T${n}` }, { at: at + 60e3, sessionId: 's', label: `${word} ${n}`, action: 'done' as const, text: 'ok' }]
  const p = paceOf([...log(1, 'lot', 0), ...log(2, 'task', 100e3)], [], 200e3)
  expect(p.pace).toBe(60e3)
  expect(p.wins?.map(w => w.n).sort()).toEqual([1, 2])
})

test('the longest message a session gets (direction, earlier branch, changes) and the change request say task, never lot', () => {
  const lot = { n: 9, title: 'Stuck', status: 'todo' as const, doneWhen: 'it ships', depends: [], body: '', brief: { type: 'feature' as const, direction: 'Keep it small', criteria: ['it ships'] }, changes: [{ id: 'c1', text: 'rename it', state: 'sent' as const, at: 0 }] }
  for (const text of [lotMessage('Ship', lot, true, 'feat/a'), changeMessage(9, { file: 'a.ts', line: 3, text: 'rename it' }), WORKFLOW_LINE]) expect(text).not.toMatch(/\blots?\b/i)
  expect(lotMessage('Ship', lot, false)).toContain('[task 9 departs: <why>]')
})
