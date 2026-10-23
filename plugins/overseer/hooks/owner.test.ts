import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { quietClock } from './clock.testkit.ts'

// Who has which lot: PLAN.md is the truth, run.assigned its cache. Replays the lot 9 case of the 2026-10-21 night.
const T0 = Date.parse('2026-10-21T21:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const say = (id: string, min: number, text: string) => JSON.stringify({ type: 'assistant', sessionId: id, cwd: `/wt/${id}`, timestamp: iso(min), message: { content: [{ type: 'text', text }] } })

const PLAN = `# Plan — Night

## [ ] 9. Stuck thresholds
done when: stuck needs 5 min

## [ ] 12. Golden screens
done when: the screens are compared
`

function setup(on: On, o: { plan?: string; tails: Record<string, string[]>; owners?: Record<string, string>; dead?: number[]; registry?: boolean; quiet?: boolean }) {
  const files: Record<string, string> = { '/r/PLAN.md': o.plan ?? PLAN }
  // the sessions registry: ~/.claude/sessions/<pid>.json, one per session (pid 1, 2 in the order of the tails)
  if (o.registry) Object.keys(o.tails).forEach((id, i) => { files[`/h/.claude/sessions/${i + 1}.json`] = JSON.stringify({ pid: i + 1, sessionId: id, name: id }) })
  const sent: { to: string; text: string }[] = []
  const store: Record<string, unknown> = {}
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(o.quiet ? quietClock(on) : on, { now: T0 + 5 * 60e3 })
  on('store.get', (_$, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.set', (_$, e) => { store[(e as { key: string }).key] = (e as { value: unknown }).value; return { value: undefined } as never })
  on('store.delete', (_$, e) => { delete store[(e as { key: string }).key]; return { value: undefined } as never })
  on('store.keys', () => ({ value: Object.keys(store) }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'find' && String(c[1]).endsWith('/sessions')) return out(Object.keys(files).filter(f => f.startsWith('/h/.claude/sessions/')).join('\n'))
    if (c[0] === 'find') return out(Object.keys(o.tails).map(id => `/h/.claude/projects/x/${id}.jsonl`).join('\n'))
    if (c[0] === 'tail') { const id = String(c[c.length - 1]).match(/x\/(\w+)\.jsonl/)?.[1] ?? ''; return out((o.tails[id] ?? []).join('\n')) }
    if (c[0] === 'kill') return out('', o.dead?.includes(Number(c[2])) ? 1 : 0)
    if (c.includes('--show-toplevel')) { const cwd = c[c.indexOf('-C') + 1]!; return cwd === '/r' ? out('/r') : out(cwd, 0) } // one working tree per session
    if (c.includes('rev-parse')) return out('base123')
    if (c.includes('worktree') && c.includes('list')) return out(Object.entries(o.owners ?? {}).map(([branch, id]) => `worktree /wt/${id}\nHEAD abc\nbranch refs/heads/${branch}\n`).join('\n'))
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"verdict":"done","note":"ok","instructions":""}', usage: {} } }) as never)
  on('session.send', (_$, e) => { sent.push({ to: (e as unknown as { to: string }).to, text: (e as { text: string }).text }); return { isDelivered: true } as never })
  return { files, sent, store, clock }
}

const run = async ($: Engine, ids: string) => {
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: `watch ${ids}` } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
}

const tailsOf = (...ids: string[]) => Object.fromEntries(ids.map(id => [id, [say(id, 0, 'Ready.')]])) as Record<string, string[]>
const lotOf = (md: string, n: number) => md.split('\n').find(l => l.startsWith(`## [`) && l.includes(` ${n}. `))
const lots = (s: { sent: { to: string; text: string }[] }, to: string) => s.sent.filter(x => x.to === to && /Your task: \d+/.test(x.text)).map(x => x.text.match(/Your task: (\d+)/)![1])

test('the task 9 case: two sessions were given task 9, the one PLAN.md does not name reports it blocked: task 9 keeps its owner', async ($, on) => {
  const tails = tailsOf('wA', 'wB')
  const s = setup(on, { tails, quiet: true })
  await run($, 'wA')
  expect(lots(s, 'wA')).toEqual(['9'])
  // a stale write puts lot 9 back to [ ]; the next pass gives it to wB too: two assignments, PLAN.md names wB
  s.files['/r/PLAN.md'] = s.files['/r/PLAN.md']!.replace(/## \[~\] 9\.[^\n]*\n(?:base: \w+\n)?session: \w+\n/, '## [ ] 9. Stuck thresholds\n')
  await $.command.run({ command: 'oversee', args: 'watch wB' } as never)
  expect(lots(s, 'wB')).toEqual(['9'])
  expect(s.files['/r/PLAN.md']).toMatch(/## \[~\] 9\. Stuck thresholds\n(?:base: \w+\n)?session: wB/)
  // wA, whose assignment is the stale one, reports lot 9 blocked
  tails.wA!.push(say('wA', 6, '[lot 9 blocked: needs a decision]'))
  await s.clock.advance(4 * 60e3)
  expect(lotOf(s.files['/r/PLAN.md']!, 9)).toContain('[~]')
  expect(s.files['/r/PLAN.md']).toMatch(/## \[~\] 9\. Stuck thresholds\n(?:base: \w+\n)?session: wB/)
  expect(s.files['/r/PLAN.md']).not.toContain('needs a decision')
})

test('a task another session holds is never given: `session:` in PLAN.md, even on a [ ] task', async ($, on) => {
  const plan = PLAN.replace('## [ ] 9. Stuck thresholds', '## [ ] 9. Stuck thresholds\nsession: wA')
  const s = setup(on, { plan, tails: tailsOf('wB') })
  await run($, 'wB')
  expect(lots(s, 'wB')).toEqual(['12'])
})

test('a task whose branch has a worktree with another session in it is never given', async ($, on) => {
  const plan = PLAN.replace('## [ ] 9. Stuck thresholds', '## [ ] 9. Stuck thresholds\nbranch: lot/9-stuck')
  const s = setup(on, { plan, tails: tailsOf('wB', 'wC'), owners: { 'lot/9-stuck': 'wC' } }) // wC works in the worktree of lot 9's branch
  await run($, 'wB wC')
  expect(lots(s, 'wB')).toEqual(['12']) // first in line, it still does not take lot 9
  expect(lots(s, 'wC')).toEqual(['9']) // the session in that worktree does
})

test('a session that reports another task lets go of its own: the assignment ends and it is free for the next task', async ($, on) => {
  const plan = PLAN + '\n## [ ] 14. Later\ndone when: later\n'
  const tails = tailsOf('wA')
  const s = setup(on, { plan, tails })
  await run($, 'wA')
  expect(lots(s, 'wA')).toEqual(['9'])
  tails.wA!.push(say('wA', 6, 'Gave lot 9 away, did lot 12 instead.\n[lot 12 done on feat/golden]'))
  await s.clock.advance(4 * 60e3)
  await s.clock.advance(4 * 60e3)
  expect(JSON.stringify(await $.command.run({ command: 'oversee', args: 'log' } as never))).toContain('release')
  expect(lots(s, 'wA').length).toBeGreaterThan(1) // it was offered another lot
})

test('/oversee drop ends the assignment at once: re-watched, the session is free', async ($, on) => {
  const s = setup(on, { tails: tailsOf('wA') })
  await run($, 'wA')
  expect(lots(s, 'wA')).toEqual(['9'])
  await $.command.run({ command: 'oversee', args: 'drop wA' } as never)
  await $.command.run({ command: 'oversee', args: 'watch wA' } as never)
  await s.clock.advance(4 * 60e3)
  expect(lots(s, 'wA')).toEqual(['9', '12'])
})

const ONE_LOT = '# Plan — Night\n\n## [ ] 9. Stuck thresholds\ndone when: stuck needs 5 min\n'

test('a session that ends frees its task: its sessions/<pid>.json is gone, the next pass ends the assignment and another free session takes the task', async ($, on) => {
  const s = setup(on, { plan: ONE_LOT, tails: tailsOf('wA', 'wB'), registry: true })
  await run($, 'wA wB')
  expect(lots(s, 'wA')).toEqual(['9'])
  expect(lots(s, 'wB')).toEqual([])
  delete s.files['/h/.claude/sessions/1.json'] // wA ends
  await s.clock.advance(4 * 60e3)
  expect(lots(s, 'wB')).toEqual(['9'])
  expect(s.files['/r/PLAN.md']).toContain('session: wB')
  expect(s.files['/r/PLAN.md']).not.toContain('session: wA')
  expect(JSON.stringify(await $.command.run({ command: 'oversee', args: 'log' } as never))).toContain('ended: task 9 is free again')
})

test('a session whose process is dead frees its task too, even when its file is still there', async ($, on) => {
  const dead: number[] = []
  const s = setup(on, { plan: ONE_LOT, tails: tailsOf('wA', 'wB'), registry: true, dead })
  await run($, 'wA wB')
  expect(lots(s, 'wA')).toEqual(['9'])
  dead.push(1) // wA's process dies
  await s.clock.advance(4 * 60e3)
  expect(lots(s, 'wB')).toEqual(['9'])
})

test('an unreadable registry is no evidence: nothing is ended on it', async ($, on) => {
  const s = setup(on, { plan: ONE_LOT, tails: tailsOf('wA', 'wB') }) // no sessions/*.json at all
  await run($, 'wA wB')
  await s.clock.advance(4 * 60e3)
  expect(lots(s, 'wA')).toEqual(['9'])
  expect(lots(s, 'wB')).toEqual([])
})
