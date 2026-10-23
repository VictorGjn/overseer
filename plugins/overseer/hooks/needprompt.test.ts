import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { needPrompts, newNeeds } from './needprompt.ts'
import { actionOf, needsYou } from './board.ts'
import { pushNeeds } from '../web/pushneeds.mjs' // lot 69: the phone's rule (no node: import, so a hooks test can read it)
import type { Board } from './board.ts'

// Lot 57: a need for Victor is one prompt to the overseer session.
const NOW = 1e12
const board = (o: Partial<Board> = {}): Board => ({ at: NOW, overseer: 'lead', repo: '/r', goal: 'g', nextPassAt: NOW + 1, lots: [], sessions: [], feed: [], ...o })
const lot = (n: number, status: 'todo' | 'running' | 'done' | 'blocked', extra: object = {}) => ({ n, title: `Lot ${n}`, status, depends: [], ...extra })

// every kind of need on one board
function mixed(): Board {
  return board({
    lots: [lot(49, 'blocked', { note: 'review 7 CONTRACT.md rows' }), lot(30, 'blocked', { note: 'reinstall: claude plugin update overseer@claude-mods, then restart the overseer session' })],
    sessions: [{ sessionId: 's1', label: 'w1', stage: 'waits', lot: 27, since: NOW, lastText: '', tries: 0, ask: { id: 'a', question: 'Keep it?', options: ['yes', 'no'] } }, { sessionId: 's2', label: 'w2', stage: 'gate', lot: 28, since: NOW, lastText: '', tries: 0, gate: { name: 'band', agents: [] } }],
    budget: { spent: 14, budget: 15, level: 'reduce' }, error: { text: 'no PLAN.md at /r', at: NOW, source: 'plan' },
  })
}

test('each need kind says what Victor must do, in one marked line, and asks the session to tell him and push', () => {
  const b = mixed()
  const t = Object.fromEntries(needPrompts(b, NOW).map(n => [n.key.split(':')[0], n.text]))
  expect(t.waits).toContain('[overseer-need] decision · lot 27 · answer "Keep it?"')
  expect(t.gate).toContain('[overseer-need] review · lot 28 · approve the workflow band')
  expect(t.blocked).toContain('[overseer-need] blocked · lot 49 · unblock: review 7 CONTRACT.md rows')
  expect(t.reinstall).toContain('[overseer-need] reinstall · lot 30 · run claude plugin update overseer@claude-mods, then restart the overseer session')
  expect(t.budget).toContain('[overseer-need] budget · raise the budget')
  expect(t.error).toContain('[overseer-need] error · no PLAN.md at /r')
  for (const x of Object.values(t)) { expect(x).toContain('Tell Victor in your answer what he must do.'); expect(x).not.toContain('PushNotification') } // the board's push tells the phone (task 69): one push per need, not two
  expect(needPrompts(board({ at: NOW - 11 * 60e3 }), NOW)).toEqual([]) // a silent overseer prompts nobody
})

test('a need is told once while it is open; a need that closes and opens again is told again', () => {
  const found = needPrompts(board({ lots: [lot(49, 'blocked', { note: 'x' })] }), NOW)
  const first = newNeeds(found, [])
  expect(first.fresh.map(n => n.key)).toEqual(['blocked:49'])
  const again = newNeeds(found, ['blocked:49'])
  expect(again.fresh).toEqual([]); expect(again.kept).toEqual(['blocked:49'])
  const closed = newNeeds(needPrompts(board(), NOW), ['blocked:49'])
  expect(closed.kept).toEqual([]) // forgotten: opening again is fresh
  expect(newNeeds(found, closed.kept).fresh.map(n => n.key)).toEqual(['blocked:49'])
})

// the replay: a worker writes [lot 49 blocked: …] and the lead prompts its own session, once
const T0 = Date.parse('2026-10-22T08:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const say = (id: string, min: number, text: string) => JSON.stringify({ type: 'assistant', sessionId: id, cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'text', text }] } })
const PLAN = '# Plan — T\n\n## [ ] 49. Integration\ndone when: it merges\n'
function setup(on: On, tails: Record<string, string[]>, busy: { v: boolean }) {
  const files: Record<string, string> = { '/r/PLAN.md': PLAN }
  const sent: { to: string; text: string }[] = [], prompts: string[] = []
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
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'ls') return out('')
    if (c[0] === 'find') return out(Object.keys(tails).map(id => `/h/.claude/projects/x/${id}.jsonl`).join('\n'))
    if (c[0] === 'tail') return out((tails[String(c[c.length - 1]).match(/x\/([\w-]+)\.jsonl/)?.[1] ?? ''] ?? []).join('\n'))
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse')) return out('base123')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"verdict":"done","note":"ok","instructions":""}', usage: {} } }) as never)
  on('session.send', (_$, e) => { sent.push({ to: String((e as { to: string }).to), text: (e as { text: string }).text }); return { isDelivered: true } as never })
  on('prompt.submit', (_$, e) => { if (busy.v) throw new Error('a turn is running'); prompts.push((e as { text: string }).text); return { drop: 'captured' } as never })
  return { files, sent, prompts, clock }
}
const go = async ($: any) => {
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
}

test('replay: [lot 49 blocked: …] gives exactly one prompt to the overseer session and none to the workers, however many passes follow', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, tails, { v: false })
  await go($)
  expect(s.prompts).toEqual([])
  tails.w1.push(say('w1', 6, 'Waiting for review.\n[lot 49 blocked: review 7 CONTRACT.md rows]'))
  await s.clock.advance(7 * 60e3) // two passes after the report
  expect(s.prompts).toHaveLength(1)
  expect(s.prompts[0]).toContain('[overseer-need] blocked · lot 49 · unblock: review 7 CONTRACT.md rows')
  expect(s.prompts[0]).toContain('Tell Victor in your answer what he must do.')
  expect(s.prompts[0]).not.toContain('PushNotification')
  expect(s.sent.filter(x => x.text.includes('[overseer-need]'))).toEqual([]) // none to the workers
  expect(s.files['/r/PLAN.md']).toContain('## [!] 49.')
})

test('replay: a need that closes and opens again prompts again', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, tails, { v: false })
  await go($)
  tails.w1.push(say('w1', 6, '[lot 49 blocked: review 7 CONTRACT.md rows]'))
  await s.clock.advance(4 * 60e3)
  expect(s.prompts).toHaveLength(1)
  // the person unblocks it, the lot goes out again and blocks again: a new opening prompts again
  s.files['/r/PLAN.md'] = s.files['/r/PLAN.md']!.replace('## [!] 49.', '## [ ] 49.')
  await s.clock.advance(3 * 60e3) // the pass gives it to w1 again
  tails.w1.push(say('w1', 13, 'Blocked again.\n[lot 49 blocked: review the new rows]'))
  await s.clock.advance(3 * 60e3)
  expect(s.prompts).toHaveLength(2)
  expect(s.prompts[1]).toContain('unblock: review the new rows')
})

test('a prompt refused while a turn runs is not lost and is not repeated: it goes at the next pass that the session takes it', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const busy = { v: true }
  const s = setup(on, tails, busy)
  await go($)
  tails.w1.push(say('w1', 6, '[lot 49 blocked: review the rows]'))
  await s.clock.advance(7 * 60e3)
  expect(s.prompts).toEqual([]) // refused: nothing told, nothing marked
  busy.v = false
  await s.clock.advance(4 * 60e3)
  expect(s.prompts).toHaveLength(1)
  await s.clock.advance(7 * 60e3)
  expect(s.prompts).toHaveLength(1)
})

// lot 69 parity: the phone's push rule (push.mjs) picks the same needs, with the same keys, as the prompt rule above
test('the push rule and the prompt rule agree: same needs, same keys, on every kind of need', () => {
  const b = mixed()
  const exported = { ...b, needs: needsYou(b, NOW).map(n => ({ ...actionOf(n, b, NOW), red: n.red, id: n.id, kind: n.kind, lot: 'lot' in n && n.lot ? n.lot.n : 'session' in n ? n.session?.lot : undefined })) }
  const phone = pushNeeds(exported).map((n: { key: string }) => n.key).sort()
  expect(phone).toEqual(needPrompts(b, NOW).map(n => n.key).sort())
  expect(phone.length).toBeGreaterThanOrEqual(6)
})
