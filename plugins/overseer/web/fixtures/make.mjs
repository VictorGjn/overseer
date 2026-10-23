// Named boards for the v3 page, made from the sample constants of the mockup (node make.mjs [outDir]).
// A .ts per board, `satisfies Board`: tsc (check.sh) fails when a fixture stops fitting the type. JSON would widen `status` to string.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const mock = readFileSync(new URL('../mockups/board-v3.html', import.meta.url), 'utf8')
const [DELIV, GTREE, BRIEF] = ['DELIV', 'GTREE', 'BRIEF'].map(k => JSON.parse(mock.match(new RegExp(`^const ${k} = (.*)$`, 'm'))[1]))

// Hand-copied subsets of the JS literals (S, WF, LIVE, ACTIVE, RELS): the lots in flight and what the page says of them.
const ACTIVE = { 27: ['The terminal pane follows the mockup', 'worker-dd'], 28: ['The band follows the mockup', 'worker-bf'], 26: ['The web board follows the v1 mockups', 'worker-ca'], 29: ['Integration 4 → 0.2.7', ''] }
const RELS = [{ v: '0.2.6', node: '25', lots: ['15', '16', '18', '19', '20', '21', '22', '23', '24'] }]
const GAPS = { 27: ['The More button does not open the view.', 'The agent did not check the pane-64 reference screen again.'] }
const WF = { runId: 'wf-27', name: 'pane-follows-mockup', session: 'worker-dd', started: 4, done: 3, running: ['verify'], phase: 'verify (turn 2/3)', isActive: true }

const T = 1792000000000 // the fixtures' "now": no clock, so a rerun gives the same bytes
const MIN = 60e3
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const title = n => ACTIVE[n]?.[0] ?? BRIEF[n]?.t ?? DELIV[n]?.t ?? `Lot ${n}`
const deps = n => (BRIEF[n]?.depends ?? '').split(/,\s*/).filter(Boolean).map(Number)
const lot = (n, status, o = {}) => ({ n, title: title(n), status, depends: deps(n), model: BRIEF[n]?.model ?? 'sonnet', doneWhen: (BRIEF[n]?.crit ?? []).join('; '), check: './check.sh', ...o })
const brief = n => ({ ...(['bug', 'feature', 'probe', 'decision', 'integration'].includes(BRIEF[n]?.type) && { type: BRIEF[n].type }), problem: BRIEF[n]?.why?.replace(/^"|"$/g, ''), keep: BRIEF[n]?.keep ?? [], criteria: BRIEF[n]?.crit ?? [] })
const session = (n, stage, o = {}) => ({ sessionId: id(n), label: ACTIVE[n][1], stage, lot: n, lotStartedAt: T - 73 * MIN, since: T - 5 * MIN, lastText: 'Working on it.', tries: 0, model: 'sonnet', ...o })
const done = n => lot(n, 'done', { verdict: { verdict: 'done', note: 'check.sh green' }, verdictAt: T - 60 * MIN, tokens: 1e6 })
// the newest 20 commits of the mockup's tree, newest first, as hooks/tree.ts writes them (parents, lane, place, lot, release)
const graph = GTREE.slice(-20).reverse().map(c => { const [d, t] = c.d.split(' '), [dd, mm] = d.split('/'), [h, m] = t.split(':'); return { graph: '*', hash: c.h, parents: c.p, refs: c.r, subject: c.s, at: Date.UTC(2026, mm - 1, dd, h, m), lane: c.l, x: c.x, ...(c.n ? { lot: Number(c.n) } : {}), ...(c.v ? { version: c.v } : {}) } })

const base = (o = {}) => ({ at: T, overseer: id(0), repo: '/home/user/Repos/claude-mods', goal: 'Ship the overseer 0.2.7 and the v3 board', nextPassAt: T + 3 * MIN, paused: false, passEvery: 3 * MIN, passing: false, lots: [], sessions: [], feed: [], ...o })
const v1 = ({ paused, passEvery, passing, ...b }) => b // a board with none of the fields lot 36 adds
const doneLots = RELS[0].lots.slice(-3).map(n => done(Number(n)))
const feed = [{ at: T - 2 * MIN, action: 'assign', label: 'worker-dd', text: 'lot 27' }]
const evidence = { base: 'f473ce0', tip: 'a293aeb', dirty: [{ path: 'overseer/hooks/pane.tsx', add: 40, del: 9 }], check: { ok: true, at: T - 3 * MIN, tests: { pass: 146, fail: 0 }, tail: 'check.sh green' } }

export const boards = {
  calm: base({ lots: [...doneLots, lot(27, 'running', { session: id(27), ...evidence, brief: brief(27), marks: [{ i: 0, mark: 'met' }, { i: 1, mark: 'todo' }, { i: 2, mark: 'todo' }, { i: 3, mark: 'todo' }] }), lot(28, 'todo')], sessions: [session(27, 'work')], budget: { spent: 2.9, budget: 15, level: 'normal' }, pace: 70 * MIN, feed, graph }),
  'needs-you': base({
    lots: [lot(27, 'running', { session: id(27) }), lot(28, 'running', { session: id(28) }), lot(26, 'blocked', { note: 'needs the Host decision' })],
    sessions: [session(27, 'waits', { question: 'Open the More button as a view or a drawer?', recommend: { option: 'view', why: 'the mockup shows a view' }, ask: { id: 'ask-27', question: 'Open the More button as a view or a drawer?', options: ['view', 'drawer'] }, link: 'https://claude.ai/code/session_27' }), session(28, 'stuck', { tries: 2, note: 'same error twice' })],
    budget: { spent: 9, budget: 15, level: 'reduce' }, atRisk: [{ where: '/home/user/Repos/claude-mods.wt/lot-27', branch: 'lot/27-pane', files: ['overseer/hooks/pane.tsx'], workflows: [], silent: [] }],
    decisions: [{ at: '2026-10-21', lot: '26', question: 'Serve the page on 4318?', answer: 'yes' }], feed,
  }),
  paused: base({ paused: true, passEvery: 10 * MIN, lots: [done(26), lot(27, 'todo'), lot(28, 'todo')], sessions: [{ sessionId: id(1), label: 'worker-dd', stage: 'free', since: T - 30 * MIN, lastText: '', tries: 0 }], feed }),
  live: base({
    passing: true, requests: [{ id: 'req-1', kind: 'pass', state: 'done', at: T - MIN }],
    lots: [lot(27, 'running', { session: id(27), ...evidence, brief: brief(27), marks: [{ i: 0, mark: 'met' }, { i: 1, mark: 'gap', ev: 'verify, turn 2: the More button does not open the view' }, { i: 2, mark: 'gap' }, { i: 3, mark: 'met' }], gaps: GAPS[27], changes: [{ id: 'ch-1', file: 'overseer/hooks/pane.tsx', line: 12, text: 'Keep the title on one line.', at: T - 4 * MIN, state: 'sent' }] }), lot(28, 'todo')],
    sessions: [session(27, 'work')], workflows: [{ ...WF, started: 4, startedAt: T - 20 * MIN }], budget: { spent: 2.9, budget: 15, level: 'normal' }, pace: 70 * MIN, feed, graph,
  }),
  'done-gaps': base({
    lots: [lot(27, 'done', { ...evidence, brief: brief(27), verdict: { verdict: 'done', note: '2 gaps left for the owner' }, verdictAt: T - 10 * MIN, marks: [{ i: 0, mark: 'met' }, { i: 1, mark: 'gap', ev: 'verify: the More button does not open the view' }, { i: 2, mark: 'gap' }, { i: 3, mark: 'met' }], gaps: GAPS[27], check: { ok: false, at: T - 12 * MIN, tests: { pass: 144, fail: 2 }, tail: '2 failed' } })],
    sessions: [session(27, 'free')], feed,
  }),
  reopened: base({
    lots: [lot(27, 'running', { session: id(27), ...evidence, retry: { verdict: 'retry', note: 'Open the More button as a view.' }, verdict: { verdict: 'done', note: 'first pass' }, verdictAt: T - 90 * MIN, changes: [{ id: 'ch-2', text: 'Open the More button as a view.', at: T - 8 * MIN, state: 'sent' }, { id: 'ch-3', text: 'Rename the tab.', at: T - 80 * MIN, state: 'done' }] })],
    sessions: [session(27, 'assigned', { tries: 1 })], feed,
  }),
  planned: base({ lots: Array.from({ length: 15 }, (_, i) => lot(30 + i, 'todo', { brief: brief(30 + i) })), proposed: Array.from({ length: 15 }, (_, i) => 30 + i), feed }),
  gate: base({
    lots: [lot(28, 'running', { session: id(28), brief: brief(28) })],
    sessions: [session(28, 'waits', { question: 'Approve the 6-step workflow?', ask: { id: 'gate-28', question: 'Approve the 6-step workflow?', options: ['approve', 'change', 'reject'] } })],
    workflows: [{ ...WF, runId: 'wf-28', name: 'band-follows-mockup', session: 'worker-bf', started: 0, startedAt: T - 5 * MIN, done: 0, running: [], phase: 'gate', isActive: true }], feed,
  }),
  empty: base({ goal: '' }),
  old: v1(base({ // a board written before v3: only the v1 fields
    lots: [{ n: 1, title: 'Data model', status: 'done', depends: [], doneWhen: 'migrations run', check: './check.sh', verdict: { verdict: 'done', note: 'ok' }, verdictAt: T - 60 * MIN }, { n: 2, title: 'API endpoint', status: 'running', depends: [1], session: id(2) }],
    sessions: [{ sessionId: id(2), label: 'worker-dd', stage: 'work', lot: 2, since: T - MIN, lastText: 'Adding the route.', tries: 0 }], budget: { spent: 1, budget: 15, level: 'normal' }, feed,
  })),
}

export function write(dir) {
  mkdirSync(dir, { recursive: true })
  for (const [name, b] of Object.entries(boards)) writeFileSync(`${dir}/${name}.ts`, `import type { Board } from '../../hooks/board.ts'\nexport default ${JSON.stringify(b, null, 2)} satisfies Board\n`)
}

if (import.meta.main) write(process.argv[2] ?? new URL('.', import.meta.url).pathname)
