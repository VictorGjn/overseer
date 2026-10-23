import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { blockedOn, needsYou, stageOf, type Board } from './board.ts'
import { peerOf } from './peers.ts'
import { quietClock } from './clock.testkit.ts'

// Lot 59: a session blocked on a task is not free. Its last report is `[lot N blocked: …]`, the task is still [!] in PLAN.md.
const say = (id: string, at: string, text: string) => JSON.stringify({ type: 'assistant', sessionId: id, cwd: '/r', timestamp: at, message: { content: [{ type: 'text', text }] } })
// watch1's two reports on lot 49, 2026-10-22 (09:02 and 09:32, Paris), as written in its transcript
const R1 = { at: '2026-10-22T07:02:47.003Z', why: 'review the dropped rows of overseer/web/CONTRACT.md and the mockup edits' }
const R2 = { at: '2026-10-22T07:32:36.394Z', why: 'Victor runs `git -C ~/Repos/claude-mods merge --ff-only pre/int-4a`; then I check `feat/overseer-board`' }
const report = (id: string, r: { at: string; why: string }) => say(id, r.at, `Step 1 is done.\n\n[lot 49 blocked: ${r.why}]`)

test('the stage: blocked while its task is [!]; free once the task is [x] or [ ]; an assigned session keeps its loop stage', () => {
  const p = peerOf([report('w1', R1)])!
  const now = Date.parse(R1.at) + 60e3
  expect(blockedOn(p, [{ n: 49, status: 'blocked' }])).toMatchObject({ lot: 49, why: R1.why })
  expect(stageOf(p, undefined, false, now, [{ n: 49, status: 'blocked' }])).toBe('blocked')
  expect(stageOf(p, undefined, false, now, [{ n: 49, status: 'done' }])).toBe('free')
  expect(stageOf(p, undefined, false, now, [{ n: 49, status: 'todo' }])).toBe('free')
  expect(stageOf(p, undefined, false, now)).toBe('free') // no plan read: as before
  expect(stageOf(p, { lot: 50, assignedAt: now - 1 }, false, now + 60e3, [{ n: 49, status: 'blocked' }])).not.toBe('blocked')
})

// ---- the replay
const W1 = '00000000-0000-4000-8000-0000000000a2'
const PLAN = `# Plan — T

## [ ] 49. Intégration 4a : fusionner le contrat (lot 30)
done when: lot/30-* is merged

## [ ] 50. La suite
done when: it works
depends: 49
`
function setup(on: On, tail: string[]) {
  const files: Record<string, string> = { '/r/PLAN.md': PLAN, '/h/.claude/sessions/9.json': JSON.stringify({ pid: 9, sessionId: W1, name: 'watch1', status: 'idle' }) }
  const sent: { to: string; text: string }[] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(quietClock(on, 15000), { now: Date.parse('2026-10-22T07:00:00Z') }) // 41 min, no pane, no request, no workflow: the 1 s tick, the 2 s poll and the 15 s export stop at once
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('http.fetch', () => ({ deny: 'none' }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '/h/.claude/sessions/9.json' : `/h/.claude/projects/x/${W1}.jsonl`)
    if (c[0] === 'tail') return out(tail.join('\n'))
    if (c[0] === 'kill') return out('')
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse')) return out('base1')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('session.send', (_$, e) => { const x = e as unknown as { to: string | { sessionId: string }; text: string }; sent.push({ to: typeof x.to === 'string' ? x.to : x.to.sessionId, text: x.text }); return { isDelivered: true } as never })
  const board = () => JSON.parse(files['/h/.claude/overseer/boards/r.json']!) as Board
  return { files, sent, clock, board }
}

test('the lot 49 replay: two blocked reports give one need with the latest text, watch1 blocked, and no new task until the block closes', async ($: Engine, on) => {
  const tail = [say(W1, '2026-10-22T06:50:00Z', 'Ready.')]
  const s = setup(on, tail)
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: `watch ${W1}` } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  expect(s.sent.some(x => x.to === W1 && x.text.includes('Your task: 49.'))).toBe(true)
  tail.push(report(W1, R1))
  await s.clock.advance(3 * 60e3 + 10)
  expect(s.files['/r/PLAN.md']).toContain(`## [!] 49.`)
  tail.push(report(W1, R2))
  await s.clock.advance(3 * 60e3 + 10) // the next pass reads the second report (09:32: later than the assignment)
  const md = s.files['/r/PLAN.md']!
  expect(md).toContain(`note: ${R2.why}`)
  expect(md).not.toContain(R1.why)
  const b = s.board()
  const needs = needsYou(b, b.at).filter(n => n.kind === 'blocked')
  expect(needs.length).toBe(1)
  expect((needs[0] as { lot: { note?: string } }).lot.note).toBe(R2.why)
  const w = b.sessions.find(x => x.sessionId === W1)!
  expect(w).toMatchObject({ stage: 'blocked', lot: 49, note: R2.why })
  expect(s.sent.some(x => x.text.includes('Your task: 50'))).toBe(false) // 50 is not ready, and watch1 is not free anyway
  // the block closes: lot 49 [x] → watch1 is free again and takes 50
  s.files['/r/PLAN.md'] = s.files['/r/PLAN.md']!.replace('## [!] 49.', '## [x] 49.')
  await s.clock.advance(3 * 60e3 + 10)
  expect(s.board().sessions.find(x => x.sessionId === W1)!.stage).not.toBe('blocked')
  expect(s.sent.some(x => x.to === W1 && x.text.includes('Your task: 50. La suite'))).toBe(true)
})

test('a blocked session gets no new task while its task is [!], even when another task is ready', async ($: Engine, on) => {
  const tail = [say(W1, '2026-10-22T06:50:00Z', 'Working on lot 49.')]
  const s = setup(on, tail)
  s.files['/r/PLAN.md'] = PLAN.replace('depends: 49\n', '').replace('## [ ] 49.', `## [~] 49.\nsession: ${W1}`) // 50 is ready at once
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: `watch ${W1}` } as never)
  tail.push(report(W1, R1))
  s.files['/r/PLAN.md'] = s.files['/r/PLAN.md']!.replace('## [~] 49.', `## [!] 49.\nnote: ${R1.why}`)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  await s.clock.advance(3 * 60e3 + 10)
  expect(s.sent.some(x => x.text.includes('Your task: 50'))).toBe(false)
  s.files['/r/PLAN.md'] = s.files['/r/PLAN.md']!.replace('## [!] 49.', '## [ ] 49.') // set back to [ ]: the block is closed
  await s.clock.advance(3 * 60e3 + 10)
  expect(s.sent.some(x => x.to === W1 && /Your task: (49|50)\./.test(x.text))).toBe(true)
})
