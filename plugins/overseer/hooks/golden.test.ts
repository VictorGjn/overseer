import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Board } from './board.ts'
import pane64 from './golden/pane-64.ts'
import pane120 from './golden/pane-120.ts'
import band80 from './golden/band-80.ts'
import band140 from './golden/band-140.ts'
import paneMore64 from './golden/pane-more-64.ts'
import paneMore120 from './golden/pane-more-120.ts'
import paneCalm64 from './golden/pane-calm-64.ts'
import paneCalm120 from './golden/pane-calm-120.ts'
import paneFull120 from './golden/pane-full-120.ts'
import bandCalm80 from './golden/band-calm-80.ts'
import bandCalm140 from './golden/band-calm-140.ts'

// Two states (UX.md rule 2): "needs you" (a session waits, a lot is blocked) and "calm" (nothing needs the person).
const WANT: Record<string, string[]> = { 'pane-64': pane64, 'pane-120': pane120, 'pane-more-64': paneMore64, 'pane-more-120': paneMore120, 'band-80': band80, 'band-140': band140, 'pane-calm-64': paneCalm64, 'pane-calm-120': paneCalm120, 'pane-full-120': paneFull120, 'band-calm-80': bandCalm80, 'band-calm-140': bandCalm140 }

// Reference screens. A demo board (made-up sessions and lots) is drawn by the Board pane and the band, the element
// tree is flattened to text at two widths, and the text is compared with the copy in golden/ (a .ts module of lines: a hooks module imports code files only). The tests run with no
// fs, so check.sh does the writing: on a mismatch the failure carries the new text between GOLDEN markers, and
// `UPDATE_GOLDEN=1 ./check.sh` copies it into golden/. `claude-code/testing` cannot paint a pane (it "exercises the
// tree the hooks return, never a surface's paint"), so the closest thing is used: the tree of components as text.

const NOW = Date.parse('2026-10-09T10:05:00Z')

const DEMO: Board = {
  at: NOW, overseer: 'me', repo: '/r', goal: 'Ship the demo', nextPassAt: NOW + 120e3,
  lots: [
    { n: 1, title: 'First task', status: 'done', depends: [], doneWhen: 'it ships', verdict: { verdict: 'done', note: 'shipped, tests pass' }, verdictAt: NOW - 3 * 60e3 },
    { n: 2, title: 'Second task', status: 'running', depends: [1], doneWhen: 'tests pass on second.spec', check: 'npm test' },
    { n: 3, title: 'Third task', status: 'blocked', depends: [2] },
    { n: 4, title: 'Fourth task', status: 'todo', depends: [3] },
  ],
  sessions: [
    { sessionId: 'w1', label: 'alpha', stage: 'work', lot: 2, since: NOW - 4 * 60e3, lastText: 'Writing the tests', tries: 1 },
    { sessionId: 'w2', label: 'beta', stage: 'waits', lot: 3, since: NOW - 90e3, lastText: 'Which colour?', question: 'Which colour?', recommend: { option: 'blue', why: 'it matches the logo' }, tries: 0 },
    { sessionId: 'w3', label: 'gamma', stage: 'free', since: NOW - 10 * 60e3, lastText: '', tries: 0 },
    { sessionId: 'w5', label: 'epsilon', stage: 'blocked', lot: 3, since: NOW - 6 * 60e3, lastText: '[lot 3 blocked: needs the DB key]', tries: 0, note: 'needs the DB key' }, // lot 59: blocked on its task, not free
  ],
  feed: [],
  atRisk: [{ where: './.wt/alpha', branch: 'lot/2-second', files: ['src/a.ts', 'src/b.ts', 'README.md'], workflows: [{ name: 'build', agents: ['think', 'build'] }], silent: [{ label: 'alpha', lot: 2, since: NOW - 4 * 60e3 }] }],
}

// Calm: the same plan with nothing blocked and no session waiting.
const CALM: Board = {
  ...DEMO,
  atRisk: undefined, // calm: nothing needs the person and nothing is at risk
  lots: DEMO.lots.map(l => (l.n === 3 ? { ...l, status: 'todo' } : l)),
  sessions: [DEMO.sessions[0]!, { ...DEMO.sessions[1]!, stage: 'work', question: undefined, lastText: 'Picking a colour' }, DEMO.sessions[2]!],
}

// Full: every optional line of the default view: the pace (ETA), the wins (DONE), a stuck session, branches that merge, a worktree at risk.
const FULL: Board = {
  ...DEMO,
  pace: 20 * 60e3, wins: [{ n: 1, title: 'First task', at: NOW - 3 * 60e3 }],
  sessions: [...DEMO.sessions, { sessionId: 'w4', label: 'delta', stage: 'stuck', lot: 2, since: NOW - 11 * 60e3, lastText: '', tries: 0, note: 'tool call 11m' }],
  base: 'main',
  worktrees: [{ path: '/r', branch: 'main', dirty: 0, isMain: true }, { path: '/r/.wt/alpha', branch: 'lot/2-second', owner: 'w1', dirty: 3, files: ['src/a.ts', 'src/b.ts', 'README.md'], isMain: false }],
  branches: [{ name: 'lot/2-second', owner: 'w1', ahead: 3, behind: 0, files: 3, overlaps: [], merge: { order: 1, conflicts: [] } }],
  top: '/r',
}

type Node = string | { type: string; props?: Record<string, unknown>; children?: Node[] }

// One node as lines: a Text is its characters, a column Box stacks its children, a row Box lays them side by side,
// a bordered Box is drawn with a frame, a Button is [label], anything else (Raster, Svg) is named.
function lines(n: Node): string[] {
  if (typeof n === 'string') return n.split('\n')
  const kids = n.children ?? []
  if (n.type === 'Text') return kids.flatMap(lines).join('').split('\n')
  if (n.type === 'Button') return [`[${n.props?.label ?? ''}]`]
  if (n.type !== 'Box') return [`<${n.type}>`]
  const parts = kids.map(lines).filter(l => l.length)
  let out: string[]
  if (n.props?.flexDirection === 'column') out = parts.flat()
  else {
    const h = Math.max(0, ...parts.map(p => p.length))
    out = Array.from({ length: h }, (_, i) => parts.map(p => (p.length === 1 ? (i === 0 ? p[0]! : '') : p[i] ?? '')).join(''))
  }
  if (!n.props?.borderStyle) return out
  const w = Math.max(0, ...out.map(l => l.length))
  return [`╭${'─'.repeat(w + 2)}╮`, ...out.map(l => `│ ${l.padEnd(w)} │`), `╰${'─'.repeat(w + 2)}╯`]
}

const render = (root: Node, width: number) => lines(root).map(l => (l.length > width ? `${l.slice(0, width - 1)}…` : l).trimEnd()).join('\n') + '\n'

// What changed, as the new golden/*.ts files; every screen of a test is drawn before the first mismatch is reported.
function golden(shots: [name: string, got: string][]) {
  const changed = shots.flatMap(([name, got]) => {
    const rows = got.replace(/\n$/, '').split('\n')
    if (JSON.stringify(WANT[name]) === JSON.stringify(rows)) return []
    return [`GOLDEN-BEGIN ${name}\nexport default [\n${rows.map(r => `  ${JSON.stringify(r)},`).join('\n')}\n] as string[]\nGOLDEN-END ${name}`]
  })
  if (changed.length) throw new Error(`reference screens changed (${changed.length}): if on purpose, run UPDATE_GOLDEN=1 ./check.sh\n${changed.join('\n')}`)
}

// The overseer is switched on the way a person does it (watch, run), then the board it wrote is replaced by the demo's:
// the screens must not depend on what a pass would make of the plan.
async function setup($: Engine, on: On, board: Board) {
  const files: Record<string, string> = { '/r/PLAN.md': '# Plan — Ship the demo\n\n## [ ] 1. First task\ndone when: it ships\n', '/h/.claude/sessions/4242.json': JSON.stringify({ pid: 4242, sessionId: 'w1', name: 'alpha' }) }
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: NOW })
  const store: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.set', (_$, e) => { store[(e as { key: string }).key] = (e as { value: unknown }).value; return { value: undefined } as never })
  on('store.delete', (_$, e) => { delete store[(e as { key: string }).key]; return { value: undefined } as never })
  on('store.keys', () => ({ value: Object.keys(store) }) as never)
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
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse') && c.includes('HEAD')) return out('base123')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.send', () => ({ isDelivered: true }) as never)
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  store['board:/r'] = board
}

const PANE = (width: number) => ({ plugin: 'overseer', surface: 'terminal', component: 'Pane', requestId: 'overseer', props: { title: 'Overseer', isFocused: true, bodyColumns: width, placement: 'dock' } as never, viewport: { columns: width + 4, rows: 60 } as never }) as never

test('the Board pane at 64 and 120 columns, needs you: the needs are the focus block, the rest is folded behind More (shown at both widths)', async ($, on) => {
  await setup($, on, DEMO)
  const shots: [string, string][] = []
  for (const width of [64, 120]) {
    const pane = await $.ui.mount(PANE(width))
    const root = await pane.find({ type: 'Box' })
    expect(root).toBeDefined()
    shots.push([`pane-${width}`, render(root as Node, width)])
    await pane.press({ plugin: 'overseer', key: 'ovp-btn-more' } as never) // the narrow layout (width < 110) lives only behind More
    shots.push([`pane-more-${width}`, render((await pane.find({ type: 'Box' })) as Node, width)])
    await pane.press({ plugin: 'overseer', key: 'ovp-btn-more' } as never) // More is kept in the store: fold it back for the next width
    await pane.unmount()
  }
  golden(shots)
})

test('a waiting AskUserQuestion: its decision card carries the answer buttons (task 19 inside task 22), no link beside them', async ($, on) => {
  const ask = { ...DEMO, sessions: DEMO.sessions.map(x => x.sessionId === 'w2' ? { ...x, ask: { id: 'tu1', question: 'Which colour?', options: ['blue', 'red'] } } : x) }
  await setup($, on, ask)
  const pane = await $.ui.mount(PANE(120))
  const text = render((await pane.find({ type: 'Box' })) as Node, 120)
  const lines = text.split('\n')
  const at = (needle: string) => lines.findIndex(l => l.includes(needle))
  expect(at('recommends: blue')).toBeGreaterThan(at('NEXT')) // the card is under NEXT ...
  expect(at('blue') >= 0 && lines.slice(at('NEXT'), at('NOW')).join('\n')).toContain('red') // ... and both buttons sit between NEXT and NOW, inside the focus block
  expect(lines.slice(at('NEXT'), at('NOW')).join('\n')).not.toContain('répondre') // buttons, no link beside them
  await pane.unmount()
})

test('a waiting plan or permission: its decision card carries the "répondre" link', async ($, on) => {
  const plan = { ...DEMO, sessions: DEMO.sessions.map(x => x.sessionId === 'w2' ? { ...x, link: 'https://claude.ai/code/br1' } : x) }
  await setup($, on, plan)
  const p2 = await $.ui.mount(PANE(120))
  const t2 = render((await p2.find({ type: 'Box' })) as Node, 120).split('\n')
  expect(t2.slice(t2.findIndex(l => l.includes('NEXT')), t2.findIndex(l => l.includes('NOW'))).join('\n')).toContain('répondre https://claude.ai/code/br1')
  await p2.unmount()
})

test('the Board pane at 64 and 120 columns, calm: the focus block alone', async ($, on) => {
  await setup($, on, CALM)
  const shots: [string, string][] = []
  for (const width of [64, 120]) {
    const pane = await $.ui.mount(PANE(width))
    shots.push([`pane-calm-${width}`, render((await pane.find({ type: 'Box' })) as Node, width)])
    await pane.unmount()
  }
  golden(shots)
})

test('the Board pane at 120 columns, every line: ETA, DONE, a stuck session, the branches line', async ($, on) => {
  await setup($, on, FULL)
  const pane = await $.ui.mount(PANE(120))
  golden([['pane-full-120', render((await pane.find({ type: 'Box' })) as Node, 120)]])
  await pane.unmount()
})

// The band, shut then open, in a state.
async function bands($: Engine, on: On, board: Board, name: string) {
  await setup($, on, board)
  const shots: [string, string][] = []
  for (const width of [80, 140]) {
    const band = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: width } as never, viewport: { columns: width, rows: 40 } as never })
    const shut = render((await band.find({ type: 'Box' })) as Node, width)
    await band.press({ plugin: 'overseer', key: 'ov-toggle' } as never)
    const open = render((await band.find({ type: 'Box' })) as Node, width)
    shots.push([`${name}-${width}`, `${shut}\n${open}`.replace(/next pass \d\d:\d\d/g, 'next pass hh:mm')]) // local time: the clock of the machine that runs the test
    await band.unmount()
  }
  golden(shots)
}

test('the band, shut then open, at 80 and 140 columns, needs you: the next action alone', async ($, on) => bands($, on, DEMO, 'band'))
test('the band, shut then open, at 80 and 140 columns, calm: one muted line', async ($, on) => bands($, on, CALM, 'band-calm'))
