import { PALETTE } from './band.tsx'
import { test, expect } from 'claude-code/testing'
import type { Board, BoardSession } from './board.ts'
import { actionsOf, atRisk, boardLot, atRiskLine, blocksOf, boardFor, boardGitSvg, gaugeSegs, isStale, lotLines, needsYou, pad, planOrder, slugOf, sortSessions, toneOf } from './board.ts'

const s = (sessionId: string, stage: BoardSession['stage'], since = 0): BoardSession => ({ sessionId, label: sessionId, stage, since, lastText: '', tries: 0 })
const lot = (n: number, status: 'todo' | 'running' | 'done' | 'blocked') => ({ n, title: `t${n}`, status, depends: [] as number[] })
const board = (o: Partial<Board>): Board => ({ at: 1000, overseer: 'me', repo: '/r', goal: 'g', nextPassAt: 2000, lots: [], sessions: [], feed: [], ...o })

test('needs you: waits, then stuck, then blocked tasks, then the budget, then a silent overseer', () => {
  const b = board({ sessions: [s('a', 'work'), s('b', 'stuck'), s('c', 'waits', 5), s('d', 'waits', 1)], lots: [lot(7, 'blocked'), lot(2, 'running')], budget: { spent: 9, budget: 15, level: 'reduce' } })
  expect(needsYou(b, 1000).map(n => `${n.kind}:${n.id}`)).toEqual(['waits:d', 'waits:c', 'stuck:b', 'blocked:7', 'budget:budget'])
  expect(needsYou(b, 1000 + 11 * 60e3).at(-1)?.kind).toBe('stale')
  expect(needsYou(board({}), 1000)).toEqual([])
  expect(toneOf(needsYou(b, 1000))).toBe(PALETTE.alert)
  expect(toneOf(needsYou(board({ budget: { spent: 9, budget: 15, level: 'reduce' } }), 1000))).toBe(PALETTE.warn)
  expect(toneOf(needsYou(board({}), 1000))).toBe(PALETTE.accent)
})

test('one action per need, in the same order, so the band can name the first and count the rest', () => {
  const b = board({ sessions: [s('c', 'waits', 5), s('b', 'stuck')], lots: [lot(7, 'blocked')], budget: { spent: 9, budget: 15, level: 'reduce' } })
  const a = actionsOf(b, 1000)
  expect(a.length).toBe(needsYou(b, 1000).length)
  expect(a.map(x => x.text.split(' ')[0])).toEqual(['Answer', 'Look', 'Unblock', 'Budget'])
  expect(actionsOf(board({}), 1000)).toEqual([])
})

test('the segmented gauge always sums to its width; sessions and tasks keep their order', () => {
  for (const w of [16, 24]) for (const n of [1, 3, 9, 10]) for (let d = 0; d <= n; d++) for (let r = 0; r <= n - d; r++) expect(gaugeSegs(d, r, n, w).reduce((x, y) => x + y, 0)).toBe(w)
  expect(gaugeSegs(4, 2, 9, 24)).toEqual([11, 5, 8])
  expect(gaugeSegs(0, 0, 0, 16)).toEqual([0, 0, 16])
  expect(sortSessions([s('f', 'free'), s('w', 'work'), s('x', 'waits'), s('j', 'judge')]).map(x => x.stage)).toEqual(['waits', 'judge', 'work', 'free'])
  const p = planOrder([lot(5, 'todo'), lot(1, 'done'), lot(7, 'blocked'), lot(4, 'running'), lot(3, 'running')])
  expect(p.open.map(l => l.n)).toEqual([3, 4, 7, 5])
  expect(p.done.map(l => l.n)).toEqual([1])
  expect(pad('abcdef', 4)).toBe('abc…')
  expect(pad('ab', 4)).toBe('ab  ')
})

test('a board older than 10 minutes is stale (its spinners stop)', () => {
  expect(isStale({ at: 0 }, 10 * 60e3)).toBe(false)
  expect(isStale({ at: 0 }, 10 * 60e3 + 1)).toBe(true)
})

import { readJournal, worktreeTree } from './board.ts'

test('worktrees as a tree: the main checkout, then worktrees in merge order, then branches with no worktree, then detached ones', async () => {
  const rows = worktreeTree({
    top: '/r', base: 'main',
    worktrees: [
      { path: '/r', branch: 'main', owner: 'lead', dirty: 2, isMain: true },
      { path: '/r/.claude/worktrees/lot-5', branch: 'feat/escort', owner: 'a1', dirty: 0, isMain: false },
      { path: '/h/tmp/x/0123abcd-1111-2222-3333-444455556666/scratchpad/wt-rail', branch: 'feat/rail', dirty: 1, isMain: false },
      { path: '/h/tmp/detached-try', dirty: 0, isMain: false },
    ],
    branches: [
      { name: 'feat/rail', owner: '8f', ahead: 6, behind: 0, files: 14, overlaps: [], merge: { order: 1, conflicts: [] } },
      { name: 'feat/escort', ahead: 3, behind: 1, files: 4, overlaps: ['feat/rail'], merge: { order: 2, conflicts: ['a.ts'] } },
      { name: 'feat/old', ahead: 2, behind: 140, files: 1, overlaps: [] },
    ],
  }, '/h')
  expect(rows.map(r => [r.kind, r.where, r.branch ?? ''])).toEqual([
    ['main', './', 'main'],
    ['worktree', '…/scratchpad/wt-rail', 'feat/rail'],
    ['worktree', './.claude/worktrees/lot-5', 'feat/escort'],
    ['branch', '(no worktree)', 'feat/old'],
    ['detached', '~/tmp/detached-try', ''],
  ])
  expect(rows[1]).toMatchObject({ owner: '8f', dirty: 1, merge: { order: 1, conflicts: [] } }) // the branch's owner when the worktree names none
  expect(rows[2]!.merge!.conflicts).toEqual(['a.ts'])
  expect(rows[3]!.stale).toBe(true)
})

test('a workflow journal: agents started and returned, the ones still running, the current phase', async () => {
  const j = readJournal([
    '{"type":"launched"}',
    '{"type":"started","agentId":"a1","label":"design:progress","phase":"Design"}',
    '{"type":"started","agentId":"a2","label":"design:flow","phase":"Design"}',
    '{"type":"result","agentId":"a1","result":{}}',
    '{"type":"started","agentId":"a3","label":"judge","phase":"Design"}',
    'not json',
  ].join('\n'))
  expect(j).toEqual({ started: 3, done: 1, running: ['design:flow', 'judge'], phase: 'Design' })
})

import { graphCells, parseGraph } from './board.ts'

test('the commit graph: rows with their lanes, commits with their refs, connectors between them', async () => {
  const out = [
    '* \x1fa1b2c3\x1fd4e5f6\x1fHEAD -> feat/rail\x1fadd rail scenario\x1f1791900000',
    '| * \x1fd4e5f6\x1f789abc\x1ffeat/escort, origin/feat/escort, tag: v1\x1fescort fix\x1f1791800000',
    '|/  ',
    '*   \x1f789abc\x1f111aaa 222bbb\x1fmain\x1fMerge branch x\x1f1791700000',
    '|\\  ',
  ].join('\n')
  const rows = parseGraph(out)
  expect(rows[0]).toEqual({ graph: '*', hash: 'a1b2c3', parents: ['d4e5f6'], refs: ['feat/rail'], subject: 'add rail scenario', at: 1791900000000 })
  expect(rows[3]!.parents).toEqual(['111aaa', '222bbb'])
  expect(rows[1]!.refs).toEqual(['feat/escort', 'origin/feat/escort'])
  expect(rows[2]).toEqual({ graph: '|/' })
  expect(graphCells('| *').map(c => c.ch).join('')).toBe('│ ●')
  expect(graphCells('|\\').map(c => c.ch)).toEqual(['│', '╲'])
  expect(graphCells('| * |').map(c => c.lane)).toEqual([0, 0, 1, 1, 2])
})

import { focusOf, paceOf } from './board.ts'

test('focus: one next action, ranked: a waiting question beats a stuck session beats a blocked task', async () => {
  const now = 10_000_000
  const sess = (o: object) => ({ sessionId: 'abcd1234-x', label: 'worker-8f · API', stage: 'work', since: now - 60e3, lastText: '', tries: 0, ...o })
  const base = { at: now, overseer: 'me', goal: 'g', nextPassAt: now + 120e3, feed: [], branches: [],
    lots: [{ n: 1, title: 'A', status: 'done', depends: [] }, { n: 2, title: 'B', status: 'running', depends: [1] }, { n: 3, title: 'C', status: 'blocked', depends: [], note: 'needs DB creds' }, { n: 4, title: 'D', status: 'todo', depends: [] }] } as never as Board
  const f = focusOf({ ...base, sessions: [sess({ stage: 'waits', lot: 2, question: 'Keep the legacy route?', since: now - 6 * 60e3 }), sess({ sessionId: 'b', label: 'worker-a1', stage: 'stuck', since: now - 14 * 60e3 })] } as Board, now)
  expect(f.next).toBe('Answer worker-8f · API (task 2): “Keep the legacy route?”')
  expect(f.why).toBeUndefined() // the card's last line carries the wait
  expect(f.card?.at(-1)).toBe('waited 6m00')
  expect(f.then[0]).toContain('Look at worker-a1')
  expect(f.then[1]).toBe('Unblock task 3 (C): needs DB creds')
  expect(f.state).toBe('1/4 tasks done · 0 working · 0 free')
  const calm = focusOf({ ...base, lots: base.lots.filter(l => l.status !== 'blocked'), sessions: [sess({ stage: 'work', lot: 2 })], pace: 40 * 60e3, wins: [{ n: 1, title: 'A', at: now - 30 * 60e3 }] } as Board, now)
  expect(calm.next).toBe('Nothing needs you. 1 session at work; look again at the next pass (2m00)')
  expect(calm.eta).toBe('about 1h20 left at this pace (2 tasks, 40m00 each, 1 at a time)')
  expect(calm.wins).toEqual(['task 1 A (30m00 ago)'])
})

test('pace and wins come from the log: assign "task N. title" then done "task N"', async () => {
  const now = 100 * 3600e3
  const log = [
    { at: now - 5 * 3600e3, action: 'assign', label: 'worker-8f', text: 'task 1. A' },
    { at: now - 4 * 3600e3, action: 'done', label: 'task 1', text: 'ok' },
    { at: now - 3 * 3600e3, action: 'assign', label: 'worker-8f', text: 'task 2. B' },
    { at: now - 1 * 3600e3, action: 'done', label: 'task 2', text: 'ok' },
    { at: now - 1 * 3600e3, action: 'assign', label: 'worker-a1', text: 'task 3. C' },
  ]
  const p = paceOf(log, [{ n: 1, title: 'A' }, { n: 2, title: 'B' }], now)
  expect(p.pace).toBe(2 * 3600e3) // median of 1 h and 2 h: the upper middle
  expect(p.wins.map(w => w.n)).toEqual([2, 1])
})

test('wins keep the title of their own assignment; a completion logged twice counts once', async () => {
  const now = 100 * 3600e3
  const log = [
    { at: now - 5 * 3600e3, action: 'assign', label: 's', text: 'task 1. Old plan task' },
    { at: now - 4 * 3600e3, action: 'done', label: 'task 1', text: 'ok' },
    { at: now - 4 * 3600e3 + 1000, action: 'done', label: 'task 1', text: 'ok again' },
  ]
  const p = paceOf(log, [{ n: 1, title: 'New plan task' }], now)
  expect(p.wins).toEqual([{ n: 1, title: 'Old plan task', at: now - 4 * 3600e3 + 1000 }])
  expect(p.pace).toBe(3600e3) // one duration, not two
})

test('the commit graph svg the pane and the web board share: chips, owners, conflicts, escaped subjects', () => {
  const b = board({
    base: 'main', top: '/r',
    worktrees: [{ path: '/r', branch: 'main', dirty: 0, isMain: true }, { path: '/r/.wt/x', branch: 'lot/x', owner: 'sx', dirty: 2, isMain: false }],
    branches: [{ name: 'lot/x', owner: 'sx', ahead: 1, behind: 0, files: 1, overlaps: [], merge: { order: 1, conflicts: ['a.ts'] } }],
    sessions: [s('sx', 'work')],
  })
  const rows = [{ graph: '*', hash: 'abc1234', refs: ['lot/x'], subject: 'fix <b> & co', at: 0 }]
  const { svg, height } = boardGitSvg(b, rows, 3600e3, '', id => (id === 'sx' ? 'worker-x' : ''), 900)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.includes('lot/x')).toBe(true)
  expect(svg.includes('worker-x')).toBe(true)
  expect(svg.includes('a.ts')).toBe(true)
  expect(svg.includes('<b>')).toBe(false)
  expect(height > 0).toBe(true)
})

test('slugOf: lowercase, runs outside a-z0-9 become one dash, trimmed', () => {
  expect(slugOf('/home/Alice/Repos/demo')).toBe('home-alice-repos-demo')
  expect(slugOf('/a/My Repo.v2/')).toBe('a-my-repo-v2')
  expect(slugOf('/tmp/café')).toBe('tmp-caf')
  expect(slugOf('session-8f3a')).toBe('session-8f3a')
})

test('boardFor: leads, then watched, then folder (top or worktree), then newest; newest wins inside a step', () => {
  const b = (repo: string, at: number, o: Partial<Board> = {}) => board({ repo, at, overseer: `o-${repo}`, ...o })
  const lead = b('/lead', 1), watch = b('/watch', 2, { sessions: [s('me', 'work')] }), home = b('/home', 3, { top: '/home' }), wt = b('/wt', 4, { top: '/main', worktrees: [{ path: '/wts/lot-1', dirty: 0, isMain: false }] }), newer = b('/newer', 9)
  const opts = { self: 'me', cwd: '/home/u' }
  expect(boardFor([], opts)).toBeUndefined()
  expect(boardFor([newer, home, watch, { ...lead, overseer: 'me' }], opts)?.repo).toBe('/lead')
  expect(boardFor([newer, home, watch], opts)?.repo).toBe('/watch')
  expect(boardFor([newer, home], opts)?.repo).toBe('/home')
  expect(boardFor([newer, wt], { self: 'me', cwd: '/wts/lot-1/src' })?.repo).toBe('/wt')
  expect(boardFor([newer, home], { self: 'me', cwd: '/homer' })?.repo).toBe('/newer') // /homer is not inside /home
  expect(boardFor([lead, newer], { self: 'me', cwd: '/home/user' })?.repo).toBe('/newer')
  // watched from /home/user (no repo): its overseer's board wins although another is newer
  expect(boardFor([newer, watch], { self: 'me', cwd: '/home/user' })?.repo).toBe('/watch')
})

test('a done task shows its verdict and age, a running task what it is done when', () => {
  expect(lotLines({ ...lot(1, 'done'), doneWhen: 'it ships', check: 'npm test', verdict: { verdict: 'done', note: 'shipped' }, verdictAt: 1000 }, 1000 + 180e3)).toEqual(['done: shipped · 3m00 ago', 'done when: it ships · check: npm test'])
  expect(lotLines({ ...lot(2, 'running'), doneWhen: 'tests pass', check: 'npm test' }, 0)).toEqual(['done when: tests pass · check: npm test'])
})

test('decision card: the question, the session\'s recommendation, the tasks it blocks and the wait', () => {
  const lots = [lot(2, 'running'), { ...lot(3, 'todo'), depends: [2] }, { ...lot(4, 'todo'), depends: [3] }, lot(5, 'todo')]
  const w: BoardSession = { ...s('worker-8f', 'waits', 1000 - 6 * 60e3), lot: 2, question: 'Keep the legacy route?', recommend: { option: 'keep it, behind a flag', why: 'the mobile app still calls it' } }
  const card = (ss: BoardSession) => actionsOf(board({ sessions: [ss], lots }), 1000)[0]!
  expect(card(w).card).toEqual(['Answer worker-8f (task 2): “Keep the legacy route?”', 'recommends: keep it, behind a flag — the mobile app still calls it', 'blocks: tasks 3, 4 · waited 6m00'])
  expect(card(w).text).toBe(card(w).card![0])
  const bare = card({ ...w, recommend: undefined }).card!
  expect(bare.length).toBe(2)
  expect(bare.some(l => l.startsWith('recommends:'))).toBe(false)
  expect(blocksOf(lots, 2)).toEqual([3, 4])
  expect(blocksOf(lots, 4)).toEqual([])
  expect(card({ ...w, lot: undefined }).card!.at(-1)).toBe('waited 6m00')
})

test('at risk: uncommitted files, running workflows and silent sessions per worktree; commits and clean worktrees are not listed', () => {
  const T = 1_000_000
  const wf = (runId: string, session: string, running: string[], isActive = true) => ({ runId, name: `wf-${runId}`, session, started: 3, done: 1, running, isActive })
  const working = (id: string, lot: number) => ({ ...s(id, 'work', T), lot, lotStartedAt: T - 5 * 60e3 })
  const b = {
    top: '/r',
    worktrees: [
      { path: '/r', branch: 'main', owner: 'lead', dirty: 0, isMain: true, lastCommitAt: T },
      { path: '/r/.wt/a', branch: 'lot/a', owner: 'sa', dirty: 3, files: ['x.ts', 'y.ts', 'z.ts'], lastCommitAt: T - 6 * 60e3, isMain: false }, // last commit before its lot started
      { path: '/r/.wt/b', branch: 'lot/b', owner: 'sb', dirty: 0, files: [], lastCommitAt: T - 60e3, isMain: false }, // committed since: nothing to lose
      { path: '/r/.wt/c', branch: 'lot/c', owner: 'sc', dirty: 1, files: ['gone'], isMain: false, isPrunable: true },
    ],
    sessions: [working('sa', 2), working('sb', 3), s('lead', 'free')],
    workflows: [wf('1', 'sa', ['build', 'test']), wf('2', 'sb', [], false), wf('3', 'ghost', ['x'])],
  }
  const rows = atRisk(b)
  expect(rows.map(r => r.where)).toEqual(['./.wt/a', '(no worktree)'])
  expect(rows[0]).toMatchObject({ files: ['x.ts', 'y.ts', 'z.ts'], workflows: [{ name: 'wf-1', agents: ['build', 'test'] }], silent: [{ label: 'sa', lot: 2, since: T - 5 * 60e3 }] })
  expect(rows[1]).toMatchObject({ files: [], workflows: [{ name: 'wf-3', agents: ['x'] }], silent: [] })
  expect(atRiskLine(rows[0]!, T)).toBe('./.wt/a lot/a · 3 uncommitted (x.ts, y.ts +1) · workflow wf-1: 2 agents running · sa: no commit since task 2 started (5m00)')
  expect(atRisk({ ...b, worktrees: [], workflows: [] })).toEqual([])
})

test('boardLot copies each v3 field, and the check result takes the name check', () => {
  const v3 = { brief: { criteria: ['c'] }, base: 'b1', tip: 't1', dirty: [{ path: 'a.ts', add: 1, del: 0 }], retry: { verdict: 'retry' as const, note: 'n' }, marks: [{ i: 0, mark: 'met' as const }], gaps: ['g'], changes: [{ id: 'c1', text: 't', at: 1, state: 'sent' as const }] }
  const l = { n: 1, title: 't', status: 'running' as const, depends: [], body: '', doneWhen: 'x', check: 'make test', ...v3 }
  expect(boardLot(l)).toMatchObject({ ...v3, check: 'make test' })
  const run = { ok: false, at: 5, tail: 'boom' }
  expect(boardLot({ ...l, checkResult: run }).check).toEqual(run)
})
