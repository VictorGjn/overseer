import { test, expect } from 'claude-code/testing'
import { collisionsOf, edits, prune } from './collisions.ts'

const T = (m: number) => new Date(Date.UTC(2026, 9, 20, 10, m, 0)).toISOString()
const call = (id: string, m: number, file: string, name = 'Edit') => JSON.stringify({ type: 'assistant', timestamp: T(m), message: { content: [{ type: 'tool_use', id, name, input: { file_path: file, new_string: 'x' } }] } })
const res = (id: string, m: number, is_error = false) => JSON.stringify({ type: 'user', timestamp: T(m), message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content: 'ok' }] } })
const read = (raw: string) => edits(undefined, raw, 0)
const NOW = Date.parse(T(22))

test('a file changed by two sessions within 15 min is one collision, at the latest edit', () => {
  const a = read([call('a1', 1, '/r/x.ts'), res('a1', 1)].join('\n') + '\n')
  const b = read([call('b1', 9, '/r/x.ts', 'MultiEdit'), res('b1', 9), call('b2', 9, '/r/y.ts', 'Write'), res('b2', 9)].join('\n') + '\n')
  expect(collisionsOf({ A: a.at, B: b.at }, Date.parse(T(10)))).toEqual([{ file: '/r/x.ts', sessions: ['A', 'B'], at: Date.parse(T(9)) }])
})

test('20 min apart, or one session twice, is no collision', () => {
  const a = read([call('a1', 1, '/r/x.ts'), res('a1', 1), call('a2', 5, '/r/x.ts'), res('a2', 5)].join('\n') + '\n')
  const b = read([call('b1', 21, '/r/x.ts'), res('b1', 21)].join('\n') + '\n')
  expect(collisionsOf({ A: a.at }, NOW)).toEqual([])
  expect(collisionsOf({ A: a.at, B: b.at }, NOW)).toEqual([])
})

test('a collision stays until the later edit ages out, even once the older edit is over 15 min old', () => {
  const a = read([call('a1', 0, '/r/x.ts'), res('a1', 0)].join('\n') + '\n')
  const b = read([call('b1', 14, '/r/x.ts'), res('b1', 14)].join('\n') + '\n')
  const now = Date.parse(T(20))
  const by = { A: prune(a, now).at, B: prune(b, now).at }
  expect(collisionsOf(by, now)).toEqual([{ file: '/r/x.ts', sessions: ['A', 'B'], at: Date.parse(T(14)) }])
  expect(collisionsOf(by, Date.parse(T(30)))).toEqual([])
})

test('a failed Edit, a read tool and an Edit with no result are ignored', () => {
  const s = read([call('e1', 1, '/r/x.ts'), res('e1', 1, true), call('e2', 2, '/r/y.ts', 'Read'), res('e2', 2), call('e3', 3, '/r/z.ts')].join('\n') + '\n')
  expect(s.at).toEqual({})
  expect(Object.keys(s.open)).toEqual(['e3'])
})

test('a split read keeps the partial line, and a call waits for its result in a later read', () => {
  const first = `${call('a1', 1, '/r/x.ts')}\n${res('a1', 1).slice(0, 25)}`
  const a = edits(undefined, first, 0)
  expect(a.off).toBe(call('a1', 1, '/r/x.ts').length + 1)
  expect(a.at).toEqual({})
  const b = edits(a, `${res('a1', 1)}\n`, a.off)
  expect(b.at).toEqual({ '/r/x.ts': Date.parse(T(1)) })
  expect(b.open).toEqual({})
})

test('prune forgets what is out of two windows; only a path and times are stored', () => {
  const s = read([call('a1', -10, '/r/x.ts'), res('a1', -10), call('a2', 25, '/r/y.ts'), res('a2', 25)].join('\n') + '\n')
  expect(prune(s, NOW).at).toEqual({ '/r/y.ts': Date.parse(T(25)) })
  expect(JSON.stringify(s)).not.toContain('new_string')
})
