import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { rebase, spentOf, type RunBudget } from './budget.ts'

// Task 71: a reset of the weekly limit must not make the spent negative, nor lose what the run spent before it.
test('spent is what the run spent: never negative, and kept across a reset of the limit', () => {
  expect(spentOf({ weeklyAt: 40, weeklyNow: 52 })).toBe(12)
  expect(spentOf({ weeklyAt: 110, weeklyNow: 24 })).toBe(0) // -86 before the fix
  let r: RunBudget = { weeklyAt: 40, weeklyNow: 52 }
  r = rebase(r, 3) // the weekly limit reset
  expect(r).toEqual({ weeklyAt: 3, weeklyNow: 3, carried: 12 })
  expect(spentOf(r)).toBe(12)
  r = rebase(r, 5)
  expect(spentOf(r)).toBe(14)
  r = rebase(r, 2) // and a second reset
  expect(spentOf(r)).toBe(14); expect(r.carried).toBe(14)
  expect(rebase({ weeklyAt: 40, weeklyNow: 52 }, 52)).toEqual({ weeklyAt: 40, weeklyNow: 52 }) // no change
})

const T0 = Date.parse('2026-10-22T08:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const say = (id: string, min: number, text: string) => JSON.stringify({ type: 'assistant', sessionId: id, cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'text', text }] } })
function setup(on: On, usage: { v: number }) {
  const files: Record<string, string> = { '/r/PLAN.md': '# Plan — T\n\n## [ ] 1. First\ndone when: it works\n' }
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 + 5 * 60e3 })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: usage.v }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'ls') return out('')
    if (c[0] === 'find') return out('/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(say('w1', 0, 'Ready.'))
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse')) return out('base123')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('session.send', () => ({ isDelivered: true }) as never)
  on('prompt.submit', () => ({ drop: 'captured' }) as never)
  return { clock, board: () => JSON.parse(files['/h/.claude/overseer/boards/r.json']!) }
}

test('replay: the weekly limit resets in the middle of a run: the board never shows a negative spent, and the step-down stays', async ($, on) => {
  const usage = { v: 40 }
  const s = setup(on, usage)
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never) // budget 15 points from 40%
  usage.v = 52 // 12 points spent: over half
  await s.clock.advance(4 * 60e3)
  expect(s.board().budget).toMatchObject({ spent: 12, level: 'reduce' })
  usage.v = 3 // the limit reset
  await s.clock.advance(3 * 60e3)
  expect(s.board().budget.spent).toBe(12) // -49 before the fix
  expect(s.board().budget.level).toBe('reduce') // the step-down is not hidden
  usage.v = 5
  await s.clock.advance(3 * 60e3)
  expect(s.board().budget.spent).toBe(14)
  for (const p of s.board().budget.series) expect(p.spent).toBeGreaterThanOrEqual(0)
})
