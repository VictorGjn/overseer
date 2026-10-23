import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { peerOf } from './peers.ts'
import { openMore } from './pane.testkit.ts'
import { quietClock } from './clock.testkit.ts'

// The cases seen on the real game-3d night: a lot judged while it ran in a background
// workflow, commits looked for in the wrong folder, lots taken by the wrong session.
const T0 = Date.parse('2026-10-12T21:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const say = (id: string, min: number, text: string, extra: object[] = []) => JSON.stringify({ type: 'assistant', sessionId: id, cwd: '/home/user', timestamp: iso(min), message: { content: [{ type: 'text', text }, ...extra] } })
const result = (id: string, min: number, toolId: string, content: string) => JSON.stringify({ type: 'user', sessionId: id, cwd: '/home/user', timestamp: iso(min), message: { content: [{ type: 'tool_result', tool_use_id: toolId, content }] } })

const PLAN = `# Plan — Night campaign

## [ ] 1. Rail gun easier to use
done when: check_weapons has a rail scenario and passes
check: ./check_weapons.sh rail

## [ ] 2. Asset loop
done when: the loop runs
owner: assets
`

function setup(on: On, o: { quiet?: boolean; tails: Record<string, string[]>; lead?: string; check?: { code: number; out: string }; tops?: Record<string, string>; now: number; plan?: string; weekly?: { at: number }; noWorktree?: boolean; answer?: string; hold?: Promise<void>; reg?: Record<string, object> }) {
  const files: Record<string, string> = { '/r/PLAN.md': o.plan ?? PLAN }
  for (const [id, r] of Object.entries(o.reg ?? {})) files[`/h/.claude/sessions/${id}.json`] = JSON.stringify({ sessionId: id, ...r })
  const sent: { to: string; text: string }[] = []
  const runs: string[][] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(o.quiet ? quietClock(on) : on, { now: o.now })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: o.weekly?.at ?? 40 }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  const dialogs: string[] = []
  let judged = 0
  on('tool.call', async (_$, e) => {
    const x = e as { tool: string; questions?: { question: string }[] }
    if (x.tool !== 'AskUserQuestion') return { result: { text: '' } } as never
    dialogs.push(x.questions![0]!.question)
    await o.hold
    return { result: { questions: x.questions, answers: { [x.questions![0]!.question]: o.answer ?? 'Not now' } } } as never
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    runs.push(c)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'find' && c.some(x => x.includes('/.claude/sessions'))) return out(Object.keys(o.reg ?? {}).map(id => `/h/.claude/sessions/${id}.json`).join('\n'))
    if (c[0] === 'find') return out(Object.keys(o.tails).map(id => `/h/.claude/projects/x/${id}.jsonl`).join('\n'))
    if (c[0] === 'tail') { const id = String(c[c.length - 1]).match(/x\/(\w+)\.jsonl/)?.[1] ?? ''; return out((o.tails[id] ?? []).join('\n')) }
    if (c.includes('--show-toplevel')) { const cwd = c[c.indexOf('-C') + 1]!; return cwd === '/r' ? out('/r') : out(o.tops?.[cwd] ?? '', o.tops?.[cwd] ? 0 : 128) }
    if (o.noWorktree && c.includes('worktree') && c.includes('add')) return { value: { exitCode: 128, stdout: '', stderr: "fatal: invalid reference: feat/gone" } } as never
    if (c[0] === 'sh' && c[1] === '-c' && c[2]!.startsWith('./check')) return out(o.check?.out ?? '', o.check?.code ?? 0)
    if (c.includes('rev-parse')) return out('base123')
    if (c.includes('log')) return out('a1b2 feat(rail): rail scenario')
    return out('')
  })
  on('model.complete', () => (judged++, { value: { isAnswered: true, text: o.lead ?? '{"verdict":"done","note":"rail scenario passes","instructions":""}', usage: {} } }) as never)
  on('session.send', (_$, e) => { sent.push({ to: (e as unknown as { to: { sessionId: string } }).to.sessionId, text: (e as { text: string }).text }); return { isDelivered: true } as never })
  return { files, sent, runs, clock, dialogs, judged: () => judged }
}

test('a transcript says when a session is still busy: a tool without its result, a background task', async () => {
  const busy = peerOf([say('s1', 0, 'Running the battery.', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])])!
  expect(busy.busySince).toBe(T0)
  const bg = peerOf([say('s1', 0, 'Launching the workflow.', [{ type: 'tool_use', id: 't1', name: 'Workflow', input: {} }]), result('s1', 1, 't1', 'Workflow launched in background. Task ID: w5qcuxk3i'), say('s1', 2, 'The task runs in the background.')])!
  expect(bg.busySince).toBeUndefined()
  expect(bg.background).toEqual(['w5qcuxk3i'])
  const done = peerOf([say('s1', 0, 'Report.\n[lot 4 done on campagne/nuit]')])!
  expect(done.marker).toMatchObject({ lot: 4, status: 'done', branch: 'campagne/nuit' })
  expect(peerOf([say('s1', 0, '[lot 4 blocked: needs the Marble API key]')])!.marker).toMatchObject({ status: 'blocked', why: 'needs the Marble API key' })
  const compacted = peerOf([say('s1', 0, 'Report sent.'), JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/home/user', timestamp: iso(1), isCompactSummary: true, message: { content: 'This session is being continued from a previous conversation...' } })])!
  expect(compacted.lastRole).toBe('assistant') // after a compaction the session waits for a prompt: still free for a lot
})

test('the lot-4 case: a session quiet for 20 min on its background workflow is not judged, not told "not done yet"', { timeoutMs: 15000 }, async ($, on) => { // Victor, 2026-10-22: 15 s for the 20 min advance under load
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { quiet: true, tails, now: T0 + 5 * 60e3 })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  expect(s.sent.map(x => x.text).join('\n')).toContain('Your task: 1. Rail gun easier to use')
  tails.w1.push(say('w1', 6, 'Launching the workflow.', [{ type: 'tool_use', id: 't1', name: 'Workflow', input: {} }]), result('w1', 6, 't1', 'Workflow launched in background. Task ID: w5qcuxk3i'), say('w1', 7, 'Task 1 runs in the background task w5qcuxk3i.'))
  s.sent.length = 0
  await s.clock.advance(25 * 60e3)
  expect(s.sent.filter(x => /not done yet/.test(x.text))).toEqual([])
  expect(s.files['/r/PLAN.md']).toContain('## [~] 1.')
})

test('a done task is judged on its branch in the project repo, its check run first; a failing check sends it back', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { quiet: true, tails, now: T0 + 5 * 60e3, check: { code: 1, out: 'rail: 2/3 shots missed the target' } })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  tails.w1.push(say('w1', 30, 'Rail scenario added, passes.\n[lot 1 done on feat/rail]'))
  s.sent.length = 0
  await s.clock.advance(30 * 60e3)
  expect(s.runs.some(c => c.join(' ') === 'git -C /r log --oneline base123..feat/rail')).toBe(true) // the project repo, not /home/user
  expect(s.runs.some(c => c.join(' ').includes('worktree add --detach') && c.includes('feat/rail'))).toBe(true)
  expect(s.sent.map(x => x.text).join('\n')).toContain('check `./check_weapons.sh rail` fails') // the lead said done; the check overrules it
  expect(s.sent.map(x => x.text).join('\n')).toContain('2/3 shots missed')
  expect(s.files['/r/PLAN.md']).toContain('## [~] 1.')
})

test('a task with an owner goes to that session only; two sessions in one working tree never both get a task', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')], w2: [say('w2', 0, 'Ready.')], w3: [say('w3', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3, tops: {} })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1 w2' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  const lot2 = s.sent.filter(x => /Your task: 2\./.test(x.text))
  expect(lot2).toEqual([]) // owner "assets": neither w1 nor w2
  expect(s.sent.filter(x => /Your task: 1\./.test(x.text)).length).toBe(1)
})

test('two watched sessions in one working tree: the second gets no task, and the board says why', async ($, on) => {
  const plan = PLAN.replace('owner: assets\n', '') // two lots anyone may take
  const tails = { w1: [say('w1', 0, 'Ready.')], w2: [say('w2', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3, plan, tops: { '/home/user': '/r' } })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1 w2' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  expect(s.sent.filter(x => /Your task:/.test(x.text)).length).toBe(1)
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  const pane = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'Pane', requestId: 'overseer', props: { title: 'Overseer', isFocused: true, bodyColumns: 160, placement: 'dock' } as never, viewport: { columns: 170, rows: 50 } as never })
  await openMore(pane)
  expect(await pane.find({ text: /open it in its own worktree \(claude -w\)/ })).toBeDefined()
})

test('a named branch that cannot be checked out fails the check: the main checkout is never tested in its place', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3, noWorktree: true })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  tails.w1.push(say('w1', 6, 'Done.\n[lot 1 done on feat/gone]'))
  s.sent.length = 0
  await s.clock.advance(4 * 60e3)
  expect(s.runs.some(c => c[0] === 'sh' && c[2]!.startsWith('./check'))).toBe(false)
  expect(s.sent.map(x => x.text).join('\n')).toContain('could not check out branch feat/gone')
})

test('a task left running by a dropped session is not handed to another one: it is marked blocked, for the person to check', async ($, on) => {
  const plan = PLAN.replace('## [ ] 1. Rail gun easier to use', '## [~] 1. Rail gun easier to use\nsession: gone-session')
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3, plan })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  expect(s.sent.map(x => x.text).join('\n')).not.toContain('Your task: 1.')
  expect(s.files['/r/PLAN.md']).toContain('## [!] 1. Rail gun easier to use')
  expect(s.files['/r/PLAN.md']).toContain('is no longer watched: check it stopped')
})

test('the budget: at half a new task asks for a cheaper model; a weekly reset back to normal tells nobody to stop', async ($, on) => {
  const plan = PLAN.replace('check: ./check_weapons.sh rail\n', 'check: ./check_weapons.sh rail\nmodel: opus\n')
  const weekly = { at: 40 }
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3, plan, weekly })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  weekly.at = 40
  await $.command.run({ command: 'oversee', args: 'run 10' } as never) // budget 10 points from 40 %
  expect(s.sent.map(x => x.text).join('\n')).toContain('Model: opus is enough for it.')
})

test('a task given at the reduce level carries the cheaper tier', async ($, on) => {
  const plan = PLAN.replace('check: ./check_weapons.sh rail\n', 'check: ./check_weapons.sh rail\nmodel: opus\n')
  const weekly = { at: 40 }
  const tails = { w1: [say('w1', 0, 'Working.', [{ type: 'tool_use', id: 't9', name: 'Bash', input: {} }])] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3, plan, weekly })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never) // w1 is busy: nothing given yet
  weekly.at = 46 // 6 of 10 points: reduce
  tails.w1.push(result('w1', 6, 't9', 'ok'), say('w1', 6, 'Ready again.'))
  await s.clock.advance(6 * 60e3)
  const texts = s.sent.map(x => x.text).join('\n')
  expect(texts).toContain('Budget at half')
  expect(texts).toContain('Model: sonnet is enough for it.')
  weekly.at = 39 // the weekly limit reset
  s.sent.length = 0
  await s.clock.advance(3 * 60e3)
  expect(s.sent.filter(x => /Budget spent|stop/.test(x.text))).toEqual([])
})

test('the budget is told at most once an hour, only to a warm cache, and just before that cache expires', async ($, on) => {
  const weekly = { at: 40 }
  const tails = { w1: [say('w1', 0, 'Working.', [{ type: 'tool_use', id: 't9', name: 'Bash', input: {} }])] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3, weekly })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  weekly.at = 46 // reduce
  tails.w1.push(say('w1', 6, 'Still working.', [{ type: 'tool_use', id: 't10', name: 'Bash', input: {} }]))
  for (let i = 0; i < 6; i++) await s.clock.advance(3 * 60e3) // six passes at the same level
  expect(s.sent.filter(x => x.text.includes('Budget at half')).length).toBe(1)
  s.sent.length = 0
  await s.clock.advance(33 * 60e3) // w1 quiet 56 min since its last row: its cache is about to expire
  expect(s.sent.filter(x => x.text.includes('keeps your cache warm')).length).toBe(1)
  s.sent.length = 0
  await s.clock.advance(30 * 60e3) // quiet past the TTL, its cache is cold: nobody wakes it, even for a stop
  weekly.at = 52
  await s.clock.advance(6 * 60e3)
  expect(s.sent.filter(x => x.text.includes('Budget'))).toEqual([])
})

test('a session with no lot that has finished its turn hears no budget: not the warm-cache one, not a change of level', async ($, on) => {
  const weekly = { at: 40 }
  const tails = { w1: [say('w1', 0, 'Lot 1 is done.\n[lot 1 done on lot/1-rail]')] }
  const plan = PLAN.replace('## [ ] 1. Rail gun easier to use', '## [x] 1. Rail gun easier to use') // nothing left to give
  const s = setup(on, { tails, now: T0 + 5 * 60e3, weekly, plan })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  await s.clock.advance(51 * 60e3) // w1 quiet 56 min: a working session would hear the warm-cache message here
  weekly.at = 46 // reduce: a working session would hear the new level
  await s.clock.advance(3 * 60e3)
  expect(s.sent.filter(x => x.text.includes('Budget'))).toEqual([])
})

test('the plan evolves: a session proposes a new task, the owner is asked with focus arguments, a yes adds it to PLAN.md', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3, answer: 'Open the task' })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run' } as never)
  const first = s.sent.map(x => x.text).join('\n')
  expect(first).toContain('an explicit `model`') // agents sized to the task, with the first lot
  expect(first).toContain('[new task:')
  tails.w1.push(say('w1', 6, 'While on the rail I saw the radar is broken.\n[new task: Fix the radar range — enemies vanish at 2 km]'))
  await s.clock.advance(3 * 60e3)
  expect(s.dialogs[0]).toContain('proposes a new task: “Fix the radar range — enemies vanish at 2 km”')
  expect(s.dialogs[0]).toContain('it delays task 1 (Rail gun easier to use)')
  await s.clock.advance(10)
  expect(s.files['/r/PLAN.md']).toContain('## [ ] 3. Fix the radar range')
  expect(s.sent.map(x => x.text).join('\n')).toContain('Task 3 opened in PLAN.md')
  await s.clock.advance(3 * 60e3)
  expect(s.dialogs.length).toBe(1) // asked once per proposal
})

test('a declined proposal keeps the session on its task; /oversee run reads as a night budget', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3 })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  expect(JSON.stringify(await $.command.run({ command: 'oversee', args: '' } as never))).toContain('a night budget: 15–20 weekly-limit points')
  await $.command.run({ command: 'oversee', args: 'run' } as never)
  tails.w1.push(say('w1', 6, '[new lot: Rewrite the HUD — it looks old]'))
  await s.clock.advance(3 * 60e3 + 10)
  expect(s.sent.map(x => x.text).join('\n')).toContain('Not now: stay on your task.')
  expect(s.files['/r/PLAN.md']).not.toContain('[?]') // lot 53: the [?] draft is removed, the proposal is kept in « En attente »
  expect(s.files['/r/PLAN.md']).toMatch(/\n## En attente\n\n- \*\*Rewrite the HUD\.\*\* it looks old \(from user \(w1\), 2026-10-12\)\n$/)
})

test('lot 53: the proposal is written as [?] at once, "Open the task" approves it, "Not now" files it under an existing « En attente »', async ($, on) => {
  let release!: () => void
  const hold = new Promise<void>(r => { release = r })
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3, answer: 'Open the task', hold })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run' } as never)
  tails.w1.push(say('w1', 6, '[new lot: Fix the radar range — enemies vanish at 2 km]'))
  await s.clock.advance(3 * 60e3 + 10)
  expect(s.dialogs.length).toBe(1)
  expect(s.files['/r/PLAN.md']).toContain('## [?] 3. Fix the radar range') // the dialog is still open
  release()
  await s.clock.advance(10)
  expect(s.files['/r/PLAN.md']).toContain('## [ ] 3. Fix the radar range')
  expect(s.files['/r/PLAN.md']).not.toContain('[?]')
})

test('lot 53: "Not now" removes the [?] lot and appends under the existing « En attente », before the next section', async ($, on) => {
  const plan = `${PLAN}\n## En attente\n\nKept for later.\n\n- **Old idea.** Not now (from x, 2026-10-01)\n\n## [x] 9. Done\ndone when: yes\n`
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3, plan })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run' } as never)
  tails.w1.push(say('w1', 6, '[new lot: Rewrite the HUD — it looks old]'))
  await s.clock.advance(3 * 60e3 + 10)
  const md = s.files['/r/PLAN.md']!
  expect(md).not.toContain('[?]')
  expect(md).toContain('- **Old idea.** Not now (from x, 2026-10-01)\n- **Rewrite the HUD.** it looks old (from user (w1), 2026-10-12)\n\n## [x] 9. Done')
  expect(md.match(/^## En attente/gm)!.length).toBe(1)
})

test('the overseer band: calm is one muted line; open, the progress and who works; Board opens the pane', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  setup(on, { tails, now: T0 + 5 * 60e3 })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  const b = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 140 } as never, viewport: { columns: 140, rows: 40 } as never })
  expect(await b.find({ text: /👁 OVERSEER/ })).toBeDefined()
  expect(await b.find({ text: /✓ 0\/2 tasks · 1 working · next pass \d\d:\d\d/ })).toBeDefined() // calm: one muted line
  await b.press({ plugin: 'overseer', key: 'ov-toggle' } as never)
  expect(await b.find({ text: /0\/2/ })).toBeDefined()
  expect(await b.find({ text: /◑ .* task 1/ })).toBeDefined()
  expect(await b.find({ key: 'ov-board' })).toBeDefined()
})

test('/oversee status: a table of the tasks with their session and note, then the budget line', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  setup(on, { tails, now: T0 + 5 * 60e3, weekly: { at: 40 } })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  const before = await $.command.run({ command: 'oversee', args: 'status' } as never) as { text: string }
  expect(before.text).toContain('| 1 | Rail gun easier to use | todo | — |  |')
  expect(before.text).toContain('Budget: no run yet')
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  const during = await $.command.run({ command: 'oversee', args: 'status' } as never) as { text: string }
  expect(during.text).toMatch(/\| 1 \| Rail gun easier to use \| running \| \S+/)
  expect(during.text).toContain('| 2 | Asset loop | todo | — |')
  expect(during.text).toContain('Budget: 0.0 of 15 weekly-limit points spent · normal')
})

test("task 5: a task ends on the session's own word, judged at the next pass; a mid-lot pause is never judged", async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3 })
  const judged = () => s.runs.filter(c => c[0] === 'sh' && String(c[2]).startsWith('./check')).length // a judgement runs the lot's check first
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  tails.w1.push(say('w1', 6, 'Halfway: the rail scenario compiles, now tuning the target.'))
  await s.clock.advance(3 * 60e3 + 10) // one pass, the session quiet
  expect(s.files['/r/PLAN.md']).toContain('## [~] 1.')
  expect(judged()).toBe(0)
  tails.w1.push(say('w1', 9, 'Rail scenario passes.\n[lot 1 done on feat/rail]'))
  await s.clock.advance(3 * 60e3 + 10) // the next pass
  expect(judged()).toBe(1)
  expect(s.files['/r/PLAN.md']).toContain('## [x] 1.')
})

// Lot 46: session state from the registry and the mode, not from guesses.
const launch = (id: string) => [say(id, 0, 'Launching.', [{ type: 'tool_use', id: 't1', name: 'Workflow', input: {} }]), result(id, 0, 't1', 'Workflow launched in background. Task ID: wmwyly2nt')]
const planRow = (id: string, min: number) => JSON.stringify({ type: 'user', sessionId: id, cwd: '/home/user', timestamp: iso(min), permissionMode: 'plan', message: { content: 'plan it' } })
const modeRow = (id: string, mode: string) => JSON.stringify({ type: 'permission-mode', permissionMode: mode, sessionId: id })

test('regression: a workflow stopped from /workflows (no notification) does not keep the session busy', async ($, on) => {
  const tails = { w1: [...launch('w1'), say('w1', 1, 'Stopped.')] }
  const s = setup(on, { tails, now: T0 + 10 * 60e3 })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  expect(s.sent.map(x => x.text).join('\n')).toContain('Your task: 1.')
})

test('regression: a session in plan mode is sent no task, the board says so; back in auto it gets one', async ($, on) => {
  const tails = { w1: [planRow('w1', 0), say('w1', 1, 'Here is a plan.')] }
  const s = setup(on, { tails, now: T0 + 10 * 60e3, reg: { w1: { status: 'idle' } } })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  expect(s.sent.map(x => x.text).join('\n')).not.toContain('Your task')
  const pane = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'Pane', requestId: 'overseer', props: { title: 'Overseer', isFocused: true, bodyColumns: 160, placement: 'dock' } as never, viewport: { columns: 170, rows: 50 } as never })
  await openMore(pane)
  expect(await pane.find({ text: /in plan mode/ })).toBeDefined()
  tails.w1.push(modeRow('w1', 'auto'), say('w1', 12, 'ok'))
  await s.clock.advance(5 * 60e3)
  expect(s.sent.map(x => x.text).join('\n')).toContain('Your task: 1.')
})

const quiet = async ($: never, on: On, reg?: Record<string, object>) => {
  const s = setup(on, { tails: { w1: [say('w1', 0, 'Done with the last one.')] }, now: T0 + 30e3, reg })
  await ($ as any).session.start({ source: 'startup', cwd: '/r' })
  await ($ as any).command.run({ command: 'oversee', args: 'watch w1' })
  await ($ as any).command.run({ command: 'oversee', args: 'run 15' })
  return s.sent.map(x => x.text).join('\n')
}
test('task 46: a session the registry calls idle gets its task though it spoke 30 s ago', async ($, on) => {
  expect(await quiet($ as never, on, { w1: { status: 'idle' } })).toContain('Your task: 1.')
})
test('task 46: with no registry entry, a session that spoke 30 s ago waits the 2 min', async ($, on) => {
  expect(await quiet($ as never, on)).not.toContain('Your task')
})

test('a [lot N departs] report is not judged: no model call, the session keeps its lot, the board says it departs', async ($, on) => {
  const tails = { w1: [say('w1', 0, 'Ready.')] }
  const s = setup(on, { tails, now: T0 + 5 * 60e3 })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
  tails.w1.push(say('w1', 30, 'Think step done.\n[lot 1 departs: the rail needs a new scenario file]'))
  const before = s.judged()
  await s.clock.advance(30 * 60e3)
  expect(s.judged()).toBe(before)
  expect(s.files['/r/PLAN.md']).toContain('## [~] 1.')
})
