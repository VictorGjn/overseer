import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { checklist, needsYou, type Board } from './board.ts'
import { quietClock } from './clock.testkit.ts'
import { checkRun, judgeContext, judgeTokens, parsePlan, parseVerdict } from './plan.ts'

// lot 34: the judge marks each criterion in its one call, and sees the rules of the section that holds the lot.
const filler = (n: number) => `## [x] ${n}. Old lot ${n}\ndone when: ${'it was done long ago, with a long explanation of what was done. '.repeat(6)}\n`
const RULE = 'The page says "task" where the mockup says "lot" (Victor, 2026-10-21).'
const PLAN = `# Plan — overseer
## Garde-fous (valent pour chaque lot)
- never push

${Array.from({ length: 29 }, (_, i) => filler(i + 1)).join('\n')}
## UI v3 : le board de l'artefact devient le vrai board

Rules for these lots:
- Two views only: Overview and Review.
- ${RULE}

${Array.from({ length: 10 }, (_, i) => filler(i + 30)).join('\n')}
## [x] 40. La page v3 : le cadre
type: feature
problem: the frame
done when:
- the frame draws

## [ ] 41. Les étapes Workflow et Tests
type: feature
problem: the stages
depends: 40
done when:
- the Workflow stage shows each step
- the Tests stage shows the check
- the verdict line shows
`

test('the judge sees the section that holds the lot and its depends lots, not the first 12000 characters', () => {
  expect(PLAN.indexOf(RULE)).toBeGreaterThan(12000) // what plan.slice(0, 12000) cut
  const ctx = judgeContext(PLAN, 41)
  expect(ctx).toContain(RULE)
  expect(ctx).toContain('# Plan — overseer')
  expect(ctx).toContain('## [x] 40. La page v3 : le cadre') // its depends lot, whole
  expect(ctx).not.toContain('never push') // another section's rules
  expect(ctx).not.toContain('Old lot 12')
  expect(judgeContext(PLAN, 3)).toContain('## Garde-fous') // a lot of the first section
})

const C12 = Array.from({ length: 12 }, (_, i) => `criterion ${i + 1}`)
const answer = (marks: object[], o: object = {}) => JSON.stringify({ verdict: 'done', note: 'ok', instructions: '', marks, gaps: ['the diff view is missing'], ...o })
const all = (n: number) => Array.from({ length: n }, (_, i) => ({ i: i + 1, mark: i === 3 ? 'gap' : 'met', ev: `evidence ${i + 1}` }))

test('12 criteria: one mark per criterion, 0-based, and the gaps; a length mismatch falls back to the single verdict', () => {
  const v = parseVerdict(answer(all(12)), 12)!
  expect(v.marks!.length).toBe(12)
  expect(v.marks![0]).toEqual({ i: 0, mark: 'met', ev: 'evidence 1' })
  expect(v.marks![3]!.mark).toBe('gap')
  expect(v.gaps).toEqual(['the diff view is missing'])
  expect(parseVerdict(answer(all(11)), 12)).toEqual({ verdict: 'done', note: 'ok', instructions: '' }) // 11 for 12
  expect(parseVerdict(answer(all(13)), 12)!.marks).toBeUndefined()
  expect(parseVerdict(answer([...all(12)].reverse()), 12)!.marks).toBeUndefined() // out of order
  expect(parseVerdict(answer(all(12).map((m, i) => (i === 5 ? { ...m, mark: 'maybe' } : m))), 12)!.marks).toBeUndefined()
  expect(parseVerdict(answer(all(12)))!.marks).toBeUndefined() // an untyped lot: no criteria asked for
  expect(judgeTokens(12)).toBe(1600)
  expect(judgeTokens(0)).toBe(800)
})

test('a check run: ok, time, the counts of a bun, node or check.sh summary, the last 20 lines', () => {
  const bun = ['hooks/a.test.ts:', '(pass) one', ' 148 pass', ' 2 fail', 'Ran 150 tests across 24 files. [4.9s]'].join('\n')
  expect(checkRun(false, 5, bun)).toEqual({ ok: false, at: 5, tests: { pass: 148, fail: 2 }, tail: bun })
  expect(checkRun(true, 5, 'ℹ tests 4\nℹ pass 4\nℹ fail 0').tests).toEqual({ pass: 4, fail: 0 })
  expect(checkRun(true, 5, 'overseer                 validate ✔  151 pass\nsession-ttl              validate ✔  12 pass ✘ 1 fail\ntsc 0 errors').tests).toEqual({ pass: 163, fail: 1 })
  expect(checkRun(true, 5, 'built').tests).toBeUndefined()
  expect(checkRun(true, 5, Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')).tail.split('\n')).toEqual(Array.from({ length: 20 }, (_, i) => `line ${i + 10}`))
})

test('a done lot with no marks shows its criteria as "not judged"; an open one as todo; a marked one as marked', () => {
  const brief = { type: 'feature' as const, criteria: ['a', 'b'] }
  expect(checklist({ status: 'done', brief })).toEqual([{ text: 'a', mark: 'not judged' }, { text: 'b', mark: 'not judged' }])
  expect(checklist({ status: 'running', brief })).toEqual([{ text: 'a', mark: 'todo' }, { text: 'b', mark: 'todo' }])
  expect(checklist({ status: 'done', brief, marks: [{ i: 0, mark: 'met', ev: 'tested' }, { i: 1, mark: 'gap' }] })).toEqual([{ text: 'a', mark: 'met', ev: 'tested' }, { text: 'b', mark: 'gap' }])
})

// ---- in a run: one model call per judgement, the marks in PLAN.md and on the board, the judge need after 2 misses
const T0 = Date.parse('2026-10-22T10:00:00Z')
const say = (text: string, min = 0) => JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: new Date(T0 + min * 60e3).toISOString(), message: { content: [{ type: 'text', text }] } })
// A short plan for the runs (a pass parses it many times): the UI v3 section, lot 40 done, lot 41 the one left for w1.
const RUNPLAN = `# Plan — overseer\n\n${PLAN.slice(PLAN.indexOf('## UI v3'), PLAN.indexOf('## [x] 30.'))}${PLAN.slice(PLAN.indexOf('## [x] 40.'))}`.replace('depends: 40\n', 'depends: 40\ncheck: ./check.sh\n')

function setup(on: On, judge: () => string, quiet = false) {
  const files: Record<string, string> = { '/r/PLAN.md': RUNPLAN }
  const tail = { rows: [say('Working on it.')] }
  const prompts: { prompt: string; maxTokens?: number }[] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(quiet ? quietClock(on) : on, { now: T0 + 5 * 60e3 })
  mock.store(on)
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
  on('http.fetch', () => ({ deny: 'none' }) as never)
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '' : '/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(tail.rows.join('\n'))
    if (c[0] === 'sh') return out('(pass) a\n 3 pass\n 0 fail')
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('log')) return out('abc123 feat: stages')
    if (c.includes('rev-parse')) return out('base1')
    return out('')
  })
  on('model.complete', (_$, e) => { const x = e as { prompt: string; maxTokens?: number }; prompts.push({ prompt: x.prompt, maxTokens: x.maxTokens }); return { value: { isAnswered: true, text: judge(), usage: {} } } as never })
  on('session.send', () => ({ isDelivered: true }) as never)
  const board = () => JSON.parse(files['/h/.claude/overseer/boards/r.json']!) as Omit<Board, 'lots'> & { lots: (Board['lots'][number] & { checklist?: unknown[] })[] }
  return { files, tail, prompts, clock, board }
}
const start = async ($: Engine) => {
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
}
const judgeCalls = (s: { prompts: { prompt: string }[] }) => s.prompts.filter(p => p.prompt.includes('FINAL REPORT OF THE SESSION'))

test('in a run: one model call judges the lot, its prompt holds the section rules, the marks and gaps reach PLAN.md and the board', async ($, on) => {
  const s = setup(on, () => answer([{ i: 1, mark: 'met', ev: 'steps drawn' }, { i: 2, mark: 'gap', ev: 'no tail' }, { i: 3, mark: 'todo' }]))
  await start($)
  s.tail.rows.push(say('Done.\n[lot 41 done on lot/41-stages]', 6))
  await s.clock.advance(3 * 60e3 + 10)
  const calls = judgeCalls(s)
  expect(calls.length).toBe(1) // still one
  expect(calls[0]!.prompt).toContain(RULE)
  expect(calls[0]!.prompt).toContain('1. the Workflow stage shows each step')
  expect(s.prompts.find(p => p.prompt === calls[0]!.prompt)!.maxTokens).toBe(judgeTokens(3))
  const md = s.files['/r/PLAN.md']!
  expect(md).toContain('marks: [{"i":0,"mark":"met","ev":"steps drawn"},{"i":1,"mark":"gap","ev":"no tail"},{"i":2,"mark":"todo"}]')
  expect(md).toContain('gap: ["the diff view is missing"]')
  expect(md).toMatch(/check result: \{"ok":true,"at":\d+,"tests":\{"pass":3,"fail":0\},"tail":"\(pass\) a\\n 3 pass\\n 0 fail"\}/)
  const lot = parsePlan(md).lots.find(l => l.n === 41)!
  expect(lot.marks!.map(m => m.mark)).toEqual(['met', 'gap', 'todo'])
  const b = s.board().lots.find(l => l.n === 41)!
  expect(b.marks!.length).toBe(3)
  expect(b.gaps).toEqual(['the diff view is missing'])
  expect(b.check).toMatchObject({ ok: true, tests: { pass: 3, fail: 0 } })
  expect(b.checklist).toEqual([{ text: 'the Workflow stage shows each step', mark: 'met', ev: 'steps drawn' }, { text: 'the Tests stage shows the check', mark: 'gap', ev: 'no tail' }, { text: 'the verdict line shows', mark: 'todo' }])
  expect(s.board().lots.find(l => l.n === 40)!.checklist).toEqual([{ text: 'the frame draws', mark: 'not judged' }])
})

test('a lot sent back keeps the verdict as retry:', async ($, on) => {
  const s = setup(on, () => JSON.stringify({ verdict: 'retry', note: 'the tail is missing', instructions: 'add it' }))
  await start($)
  s.tail.rows.push(say('[lot 41 done on lot/41-stages]', 6))
  await s.clock.advance(3 * 60e3 + 10)
  expect(s.files['/r/PLAN.md']).toContain('retry: {"verdict":"retry","note":"the tail is missing"}')
  expect(s.board().lots.find(l => l.n === 41)!.retry).toEqual({ verdict: 'retry', note: 'the tail is missing' })
})

test('two unparsed verdicts on one report: the need "judge gave no verdict", and no judgement at each pass after', async ($, on) => {
  const s = setup(on, () => 'I think it is fine.', true)
  await start($)
  s.tail.rows.push(say('[lot 41 done on lot/41-stages]', 6))
  await s.clock.advance(3 * 60e3 + 10)
  await s.clock.advance(3 * 60e3 + 10)
  expect(judgeCalls(s).length).toBe(2)
  const b = s.board()
  expect(b.lots.find(l => l.n === 41)!.noVerdict).toBe(true)
  expect(needsYou(b, b.at).find(n => n.kind === 'judge')).toMatchObject({ id: 'judge:41', text: 'task 41: the judge gave no verdict' })
  await s.clock.advance(3 * 60e3 + 10)
  await s.clock.advance(3 * 60e3 + 10)
  expect(judgeCalls(s).length).toBe(2) // not judged again
  s.tail.rows.push(say('Fixed.\n[lot 41 done on lot/41-stages]', 20)) // a new report is judged again
  await s.clock.advance(3 * 60e3 + 10)
  expect(judgeCalls(s).length).toBe(3)
})
