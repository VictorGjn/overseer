import { test, expect, mock } from 'claude-code/testing'
import plan1719 from './fixtures/plan-17-19.ts'
import golden17 from './fixtures/lead-17.golden.ts'
import { isIdle, leadPrompt, levelOf, lotMessage, missing, parsePlan, readyLots, setLot, tierFor, WORKFLOW_LINE } from './plan.ts'
import { boardLot, loopLine, needsYou, stageOf, type Board } from './board.ts'
import { peerOf } from './peers.ts'
import { openMore } from './pane.testkit.ts'
import { quietClock } from './clock.testkit.ts'

const PLAN = `# Plan — Ship the nav report v2

- **Sessions dédiées** : API \`worker-8f\` (w1) ; front \`worker-a1\`.

## [x] 1. Data model
done when: migrations run

## [ ] 2. API endpoint
done when: GET /reports/nav returns the fixture
model: sonnet
depends: 1
Add the endpoint in api/reports.ts.

## [ ] 3. Front page
done when: the page renders the fixture
depends: 2

## Notes
free text the overseer keeps`

test('PLAN.md: tasks, readiness by dependency, status and lines rewritten in place', async () => {
  const { goal, lots } = parsePlan(PLAN)
  expect(goal).toBe('Ship the nav report v2')
  expect(lots.map(l => [l.n, l.status])).toEqual([[1, 'done'], [2, 'todo'], [3, 'todo']])
  expect(lots[1]).toMatchObject({ model: 'sonnet', depends: [1], doneWhen: 'GET /reports/nav returns the fixture', body: 'Add the endpoint in api/reports.ts.' })
  expect(readyLots(lots).map(l => l.n)).toEqual([2])
  const md = setLot(setLot(PLAN, 2, { status: 'running', session: 'abc' }), 2, { status: 'done', note: 'fixture matches', branch: 'feat/nav' })
  expect(md).toContain('## [x] 2. API endpoint')
  expect(md).toContain('session: abc')
  expect(md).toContain('note: fixture matches')
  expect(md).toContain('free text the overseer keeps')
  expect(readyLots(parsePlan(md).lots).map(l => l.n)).toEqual([3])
})

test('budget levels and tiers; a session is free once it spoke last, asks nothing, and has been quiet', async () => {
  expect([levelOf(3, 15), levelOf(8, 15), levelOf(15, 15)]).toEqual(['normal', 'reduce', 'stop'])
  expect(tierFor('opus', 'reduce')).toBe('sonnet')
  expect(tierFor(undefined, 'normal')).toBe('sonnet')
  expect(isIdle({ lastRole: 'assistant', lastAt: 0 }, 3 * 60e3)).toBe(true)
  expect(isIdle({ lastRole: 'assistant', lastAt: 0, question: 'ok?' }, 3 * 60e3)).toBe(false)
  expect(isIdle({ lastRole: 'user', lastAt: 0 }, 3 * 60e3)).toBe(false)
})

test('every task message asks for a workflow with a model per phase, on a line of its own', () => {
  const { goal, lots } = parsePlan(PLAN)
  for (const lot of lots) for (const first of [true, false]) expect(lotMessage(goal, lot, first).split('\n')).toContain(WORKFLOW_LINE)
})

test('the workflow line asks for labels <kind> or <kind>-<turn> and for the prompt lines Goal:, How:, Out:', () => {
  for (const k of ['think', 'build', 'test', 'verify', 'fix', 'commit']) expect(WORKFLOW_LINE).toContain(k)
  expect(WORKFLOW_LINE).toContain('<kind>-<turn>')
  for (const l of ['Goal:', 'How:', 'Out:']) expect(WORKFLOW_LINE).toContain(l)
  expect(WORKFLOW_LINE.includes('\n')).toBe(false)
})

test('task 76: the line lets a very small task run as one subagent with the fitting model, never in the session\'s own loop; every task message carries it', () => {
  expect(WORKFLOW_LINE).toContain('explicit model on every agent')
  expect(WORKFLOW_LINE).toContain('A very small task (one file, one test) may run without a workflow, but then as one subagent (Agent tool) with the model that fits it')
  expect(WORKFLOW_LINE).toContain('never in the session\'s own loop')
  const { goal, lots } = parsePlan(PLAN)
  for (const lot of lots) for (const first of [true, false]) expect(lotMessage(goal, lot, first)).toContain('never in the session\'s own loop')
})

test('/oversee run gives a free watched session the next task, then the lead marks it done in PLAN.md', { timeoutMs: 15000 }, async ($, on) => { // Victor, 2026-10-22: 15 s for the 20 min advance under load
  const files: Record<string, string> = { '/r/PLAN.md': PLAN, '/h/.claude/sessions/4242.json': JSON.stringify({ pid: 4242, sessionId: 'w1', name: 'worker-8f' }) }
  let tail = [JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: '2026-10-09T10:00:00Z', message: { content: [{ type: 'text', text: 'Ready.' }] } })]
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(quietClock(on), { now: Date.parse('2026-10-09T10:05:00Z') }) // the session has been quiet 5 min
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '/h/.claude/sessions/4242.json' : '/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(tail.join('\n'))
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse') && c.includes('HEAD')) return out(c.includes('--abbrev-ref') ? 'feat/api' : 'base123')
    if (c.includes('log')) return out('a1b2 feat(api): nav report endpoint')
    return out('')
  })
  on('model.complete', (_$, e) => {
    const sys = String((e as { system?: unknown }).system ?? '')
    const text = sys.startsWith('You are the lead') ? '{"verdict":"done","note":"endpoint returns the fixture, test added","instructions":""}' : '[]'
    return { value: { isAnswered: true, text, usage: {} } } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  const sent: string[] = []
  on('session.send', (_$, e) => { sent.push((e as { text: string }).text); return { isDelivered: true } as never })

  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  const res = JSON.stringify(await $.command.run({ command: 'oversee', args: 'run 10' } as never))
  expect(res).toContain('1 task(s) given')
  expect(sent.join('\n')).toContain('Your task: 2. API endpoint')
  expect(sent.join('\n')).toContain('Never push') // the rules, with the first lot
  expect(files['/r/PLAN.md']).toContain('## [~] 2. API endpoint')
  const listing = JSON.stringify(await $.command.run({ command: 'oversee', args: '' } as never))
  expect(listing).toContain('worker-8f · API (w1)')
  // The board: any session opens it with /oversee show; the lot is sent, the session has not spoken since.
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  const pane = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'Pane', requestId: 'overseer', props: { title: '👁 Overseer', isFocused: true, bodyColumns: 120, placement: 'dock' } as never, viewport: { columns: 130, rows: 50 } as never })
  await openMore(pane)
  expect(await pane.find({ text: /PLAN · 1\/3/ })).toBeDefined()
  expect(await pane.find({ text: /API endpoint/ })).toBeDefined()
  expect(await pane.find({ text: /task 2/ })).toBeDefined()
  expect(await pane.find({ text: /assign/ })).toBeDefined()
  expect(await pane.find({ text: /OVERSEER/ })).toBeDefined()
  expect(await pane.find({ text: /PROGRESS/ })).toBeDefined()
  expect(await pane.find({ text: /Nothing needs you/ })).toBeDefined() // calm: the focus block says so
  expect(await pane.find({ text: /SESSIONS · 1/ })).toBeDefined()
  expect(await pane.find({ key: 'ovp-btn-pass' })).toBeDefined() // this session leads
  expect(await pane.find({ text: /BUDGET .* 0\.0\/10 pts/ })).toBeDefined()

  // The session works on it, then stops with its report.
  tail = [...tail, JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: '2026-10-09T10:20:00Z', message: { content: [{ type: 'text', text: 'Lot 2 done: GET /reports/nav returns the fixture, test added.\n[lot 2 done on feat/api]' }] } })]
  await pane.unmount() // the board is checked: unmounted, the 1 s spinner tick (1200 in 20 min) no longer redraws it, which was ~70% of this test's run time
  await clock.advance(20 * 60e3)
  expect(files['/r/PLAN.md']).toContain('## [x] 2. API endpoint')
  expect(files['/r/PLAN.md']).toContain('branch: feat/api')
  expect(sent.join('\n')).toContain('Your task: 3. Front page') // the next lot follows
})

test('/oversee plan asks Claude to write PLAN.md and answers at once', async ($, on) => {
  mock.env(on, { HOME: '/h' })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: ((e as { argv?: string[] }).argv ?? []).includes('--show-toplevel') ? '/r' : '', stderr: '' } }) as never)
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => { submitted.push((e as { text: string }).text); return { drop: 'captured by the test' } as never })
  const clock = mock.clock(on)
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  const res = JSON.stringify(await $.command.run({ command: 'oversee', args: 'plan ship nav v2' } as never))
  expect(res).toContain('Asked Claude to write PLAN.md')
  await clock.advance(10)
  expect(submitted.join('')).toContain('for this goal: ship nav v2')
})

test("a session's place in the loop: sent, working, reporting, judged; a question comes first", async () => {
  const a = { lot: 2, assignedAt: 1000 }
  const p = (o: object) => ({ sessionId: 's', cwd: '/r', lastAt: 2000, lastText: '', tools: [], background: [], lastRole: 'assistant' as const, ...o })
  expect(stageOf(undefined, undefined, false, 5000)).toBe('free')
  expect(stageOf(p({ lastAt: 900 }), a, false, 5000)).toBe('assigned')
  expect(stageOf(p({ lastRole: 'user' }), a, false, 5000)).toBe('work')
  expect(stageOf(p({}), a, false, 2000 + 30 * 60e3)).toBe('work') // silence is work
  expect(stageOf(p({ marker: { lot: 2, status: 'done', at: 1500 } }), a, false, 5000)).toBe('report')
  expect(stageOf(p({ busySince: 1500 }), a, false, 1500 + 11 * 60e3)).toBe('work') // a long wait alone is not stuck: see stuck.test.ts
  expect(stageOf(p({}), a, true, 5000)).toBe('judge')
  expect(stageOf(p({ question: 'ok?' }), a, false, 5000)).toBe('waits')
  expect(loopLine('work', 0).filter(g => g.on).map(g => g.t.trim())).toEqual(['◐ work'])
})

const BOARD = (s: (id: string, label: string, stage: string, o?: object) => object) => ({
    at: 990_000, overseer: 'lead1234', goal: 'Ship it', nextPassAt: 1_100_000, budget: { spent: 16, budget: 20, level: 'reduce' },
    lots: [{ n: 1, title: 'Spec', status: 'done', depends: [] }, { n: 3, title: 'Export', status: 'running', depends: [], session: 'a' }, { n: 7, title: 'Migrate', status: 'blocked', depends: [3], note: 'waiting' }],
    sessions: [s('b', 'ui · front', 'stuck', { tries: 3, note: 'same test fails' }), s('a', 'api · backend', 'waits', { question: 'Keep v1?' }), s('c', 'qa · tests', 'work')],
    feed: [{ at: 990_000, action: 'done', label: 'qa', text: 'task 1 accepted' }],
  })

test('the pane puts what needs the person first, and a stale board stops spinning', async ($, on) => {
  const s = (sessionId: string, label: string, stage: string, o: object = {}) => ({ sessionId, label, stage, lot: 3, since: 900_000, lastText: '', tries: 0, model: 'sonnet', ...o })
  mock.store(on, { board: BOARD(s) })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.id', () => ({ value: 'other' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  const mount = () => $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'Pane', requestId: 'overseer', props: { title: 'x', isFocused: true, bodyColumns: 130, placement: 'dock' } as never, viewport: { columns: 140, rows: 60 } as never })
  const pane = await mount()
  expect(await pane.find({ text: /NEEDS YOU/ })).toBeUndefined() // no block of its own: the needs are the focus block
  expect(await pane.find({ text: /▶ NEXT\s+Answer api · backend \(task 3\): “Keep v1\?”/ })).toBeDefined()
  expect(await pane.find({ text: /THEN\s+1\. Look at ui · front: stuck/ })).toBeDefined()
  expect(await pane.find({ text: /2\. Unblock task 7 \(Migrate\)/ })).toBeDefined()
  expect(await pane.find({ text: /3\. Budget low/ })).toBeDefined()
  expect(await pane.find({ text: /SESSIONS · 3/ })).toBeUndefined() // folded
  await openMore(pane)
  expect(await pane.find({ text: /SESSIONS · 3/ })).toBeDefined()
  expect(await pane.find({ text: /❓\s*api · backend\s+T3\s+waits .*→ NEXT/ })).toBeDefined() // the session points at the focus block, the question is not repeated
  expect(await pane.find({ text: /“Keep v1\?”/ })).toBeDefined()
  expect(await pane.find({ text: /✓\s+1 Spec/ })).toBeDefined()
  expect(await pane.find({ key: 'ovp-btn-pass' })).toBeUndefined() // another session leads: no Pass now
  expect(await pane.find({ key: 'ovp-btn-more' })).toBeDefined()
  expect(await pane.find({ text: /◐\s+3 Export/ })).toBeDefined() // a running lot spins (its frame depends on the tick)
  await pane.unmount()
  await clock.advance(11 * 60e3)
  const stale = await mount() // the board is now 11 min old: silent overseer, lots frozen on ◐
  expect(await stale.find({ text: /stale: is the overseer still on/ })).toBeDefined()
  expect(await stale.find({ text: /◔?\s*◐\s+3 Export/ })).toBeDefined()
})

test('setLot: null deletes a key\'s line, undefined skips it, base is written, a non-string value is JSON', () => {
  const md = setLot(setLot(PLAN, 2, { note: 'first', base: 'abc' }), 2, { gaps: ['one'], checkResult: { ok: true, at: 1, tail: 'x' } })
  expect(md).toContain('base: abc')
  expect(md).toContain('gap: ["one"]')
  expect(md).toContain('check result: {"ok":true,"at":1,"tail":"x"}')
  const out = setLot(md, 2, { note: null, base: undefined })
  expect(out).not.toContain('note:')
  expect(out).toContain('base: abc')
  expect(setLot(PLAN, 2, { note: null })).toBe(PLAN)
})

test('parsePlan reads back the v3 lines setLot writes, and keeps them out of the body sent to the session', () => {
  const v3 = { base: 'abc', checkResult: { ok: true, at: 1, tail: 'x' }, retry: { verdict: 'retry' as const, note: 'again' }, marks: [], gaps: ['one'], changes: [] }
  const lot = parsePlan(setLot(PLAN, 2, v3)).lots.find(l => l.n === 2)!
  expect(lot).toMatchObject(v3)
  expect(lot.body).not.toMatch(/base:|check result:|retry:|marks:|gap:|change:/)
})

// Lot 31: the task format.
const TYPED = `# Plan — g

## [ ] 1. Typed
type: bug
problem: Cause: the key is read twice.
direction: fix it in parsePlan
question: which way?
options: A | B
- C
not in: the skill
keep: rule one
- rule two
keep: rule three
risk: slow → cache it
- big -> split it
linear: SYR-1
lots: 2, 3
version: 0.3.0
done when: each item has a test:
- a regression test
- second
base: abc
check result: {"ok":true,"at":1,"tail":"t"}
retry: {"verdict":"retry","note":"n"}
marks: [{"i":0,"mark":"met"}]
gap: ["g"]
change: [{"id":"c1","text":"t","at":1,"state":"sent"}]
free text
`

test('parsePlan reads every key of the task format; the list keys take one item per line and "- " lines', () => {
  const l = parsePlan(TYPED).lots[0]!
  expect(l.brief).toEqual({
    type: 'bug', problem: 'Cause: the key is read twice.', direction: 'fix it in parsePlan', question: 'which way?',
    options: ['A', 'B', 'C'], notIn: ['the skill'], keep: ['rule one', 'rule two', 'rule three'],
    risk: [{ event: 'slow', mitigation: 'cache it' }, { event: 'big', mitigation: 'split it' }],
    linear: 'SYR-1', lots: [2, 3], version: '0.3.0', criteria: ['each item has a test', 'a regression test', 'second'],
  })
  expect(l).toMatchObject({ base: 'abc', checkResult: { ok: true }, retry: { verdict: 'retry' }, marks: [{ i: 0, mark: 'met' }], gaps: ['g'], changes: [{ id: 'c1' }], body: '- a regression test\n- second\nfree text' })
})

test('boardLot exports the brief', () => {
  const l = parsePlan(TYPED).lots[0]!
  expect(boardLot(l).brief).toEqual(l.brief)
})

const board = (lots: Board['lots']): Board => ({ at: 1, overseer: 'me', repo: '/r', goal: 'g', nextPassAt: 2, lots, sessions: [], feed: [] })
const incomplete = (md: string) => {
  const { lots } = parsePlan(md)
  const ready = readyLots(lots).map(l => l.n)
  const need = needsYou(board(lots.map(boardLot)), 1).filter(n => n.kind === 'incomplete')
  return { ready, text: need.map(n => (n as { text: string }).text).join('|'), kinds: need.map(n => n.id) }
}

test('a typed lot missing a required field is never assigned and shows as plan incomplete', () => {
  const t = (body: string) => incomplete(`## [ ] 1. T\n${body}\n`)
  const cases: [string, string, string][] = [
    ['type: bug\nproblem: no cause\ndone when: a regression test', 'problem with Cause:', 'plan incomplete: task 1 needs problem with Cause:'],
    ['type: bug\nproblem: Cause: x\ndone when: it works', 'a regression test', 'a regression test'],
    ['type: feature\ndone when: x', 'problem', 'task 1 needs problem'],
    ['type: feature\nproblem: p', 'done when', 'task 1 needs done when'],
    ['type: probe\ndone when: x', 'question', 'task 1 needs question'],
    ['type: probe\nquestion: q', 'done when', 'task 1 needs done when'],
    ['type: decision\nquestion: q', 'options', 'task 1 needs options'],
    ['type: decision\nquestion: q\noptions: a | b | c | d', 'options', 'task 1 needs options'],
    ['type: integration\ndone when: x', 'lots', 'task 1 needs lots'],
  ]
  for (const [body, field, text] of cases) { const r = t(body); expect([body, r.ready]).toEqual([body, []]); expect(r.text).toContain(text); expect(r.text).toContain(field); expect(r.kinds).toEqual(['incomplete:1']) }
  for (const ok of ['type: bug\nproblem: Cause: x\ndone when: a regression test', 'type: feature\nproblem: p\ndone when: d', 'type: probe\nquestion: q\ndone when: d', 'type: decision\nquestion: q\noptions: a | b', 'type: integration\nlots: 2', 'done when: untyped, no rules']) expect(t(ok)).toEqual({ ready: [1], text: '', kinds: [] })
  expect(missing({ criteria: [] })).toEqual([])
})

test('an untyped lot keeps its rules and exports a derived brief: lot 17 has 8 criteria, lot 19 has 6', () => {
  const lots = parsePlan(plan1719).lots
  const [a, b] = [lots.find(l => l.n === 17)!, lots.find(l => l.n === 19)!]
  expect(a.brief!.criteria.length).toBe(8)
  expect(a.brief!.criteria[0]).toBe("two overseers on two repositories each keep their own board, and neither overwrites the other's; `./check.sh` exits 0")
  expect(b.brief!.criteria.length).toBe(6)
  expect(b.brief).toEqual({ criteria: b.brief!.criteria })
  expect(a.doneWhen).toContain('In detail:')
  expect(a.body).toContain('- the store key is `board:<repo>`')
  expect(a.body).toContain('Things to keep:')
  expect(readyLots(lots.map(l => ({ ...l, status: 'todo' as const, depends: [] }))).length).toBe(2)
})

test('the lot 17 judge prompt is the one the unchanged code built; a typed lot prints numbered criteria, KEEP and NOT IN in the prompt and the message', () => {
  const lots = parsePlan(plan1719).lots
  expect(leadPrompt('CTX', lots.find(l => l.n === 17)!, 'R', 'C')).toBe(golden17)
  const l = parsePlan(TYPED).lots[0]!
  const p = leadPrompt('CTX', l, 'R', 'C')
  expect(p).toContain('DONE WHEN:\n1. each item has a test\n2. a regression test\n3. second\nKEEP: rule one; rule two; rule three\nNOT IN: the skill\n')
  const m = lotMessage('g', l, false)
  expect(m).toContain('Done when:\n1. each item has a test\n2. a regression test\n3. second\nKeep: rule one; rule two; rule three\nNot in: the skill\n')
  expect(lotMessage('g', parsePlan(plan1719).lots[0]!, false)).not.toContain('Keep:')
})

test('lotMessage sends the direction and asks the think step for "follows" or "departs, because …"; [lot N departs: why] waits for Victor', () => {
  const l = parsePlan(TYPED).lots[0]!
  const m = lotMessage('g', l, false).split('\n')
  expect(m).toContain('Direction: fix it in parsePlan')
  expect(m.find(x => x.startsWith('In the think step'))).toContain('"departs, because …"')
  expect(m.find(x => x.startsWith('In the think step'))).toContain('[task 1 departs: <why>]')
  expect(lotMessage('g', { ...l, brief: { ...l.brief!, direction: undefined } }, false)).not.toContain('Direction:')
  const p = peerOf([JSON.stringify({ type: 'assistant', sessionId: 's1', cwd: '/r', timestamp: '2026-10-22T10:00:00Z', message: { content: [{ type: 'text', text: 'Plan.\n[lot 5 departs: the API has no such field]' }] } })])!
  expect(p.marker).toMatchObject({ lot: 5, status: 'departs', why: 'the API has no such field' })
  const at = Date.parse('2026-10-22T10:00:00Z')
  expect(stageOf(p, { lot: 5, assignedAt: at - 1000 }, false, at + 1000)).toBe('waits')
  const b = board([])
  b.sessions = [{ sessionId: 's1', label: 's1', stage: 'waits', lot: 5, since: 0, lastText: '', tries: 0, departs: 'the API has no such field' }]
  expect(needsYou(b, 1)).toMatchObject([{ kind: 'departs', id: 'departs:s1', red: true, text: 'task 5 departs: the API has no such field' }])
})

test('lot 53: [?] is proposed, round-trips to [ ] on approval, and is never ready even when its depends are done', () => {
  const md = '# Plan — T\n\n## [x] 1. A\ndone when: a\n\n## [?] 2. B\ndone when: b\ndepends: 1\n'
  const { lots } = parsePlan(md)
  expect(lots.map(l => [l.n, l.status])).toEqual([[1, 'done'], [2, 'proposed']])
  expect(readyLots(lots)).toEqual([])
  const ok = setLot(md, 2, { status: 'todo' })
  expect(ok).toContain('## [ ] 2. B')
  expect(readyLots(parsePlan(ok).lots).map(l => l.n)).toEqual([2])
  expect(setLot(ok, 2, { status: 'proposed' })).toContain('## [?] 2. B')
})

test('lot 53: proposed lots are listed in the board and give one plan need while any is proposed', () => {
  const b = board([{ n: 3, title: 'C', status: 'proposed', depends: [] }, { n: 4, title: 'D', status: 'proposed', depends: [] }])
  b.proposed = [3, 4]
  expect(needsYou(b, 1)).toMatchObject([{ kind: 'plan', id: 'plan', red: true, text: 'Approve 2 new tasks of PLAN.md?' }])
  expect(needsYou({ ...b, proposed: [3] }, 1)).toMatchObject([{ text: 'Approve 1 new task of PLAN.md?' }])
  expect(needsYou({ ...b, proposed: [] }, 1)).toEqual([])
})
