import { test, expect, mock } from 'claude-code/testing'
import { budgetSvg, camColsFor, camera, edgeBits, graphRaster, graphSvg, layout, LINE, sparkline, step } from './graph.ts'
import { openMore } from './pane.testkit.ts'

type L = { n: number; title: string; status: 'todo' | 'running' | 'done' | 'blocked'; depends: number[]; session?: string; note?: string; model?: string }
const lot = (n: number, status: L['status'], depends: number[] = [], o: Partial<L> = {}): L => ({ n, title: `Task ${n}`, status, depends, ...o })
// The rework's own shape: a probe, a foundation, five lots on it, one more after the sixth, the integration last.
const REWORK = (s: Record<number, L['status']> = {}) => [
  lot(0, s[0] ?? 'done'), lot(1, s[1] ?? 'done', [0], { session: 'aaa' }),
  ...[2, 3, 4, 5, 6].map(n => lot(n, s[n] ?? 'todo', [1], n === 5 ? { session: 'bbb' } : {})),
  lot(7, s[7] ?? 'todo', [6]), lot(8, s[8] ?? 'todo', [2, 3, 4, 5, 7]),
]

test('layout: columns by the longest dependency chain, one lane per session in a stable order, then the tasks not taken', async () => {
  const L = layout(REWORK())
  const col = (n: number) => L.nodes.find(x => x.n === n)!.col
  expect([0, 1, 2, 6, 7, 8].map(col)).toEqual([0, 1, 2, 2, 3, 4])
  expect(L.cols).toBe(5)
  expect(L.lanes.map(l => l.session)).toEqual(['aaa', 'bbb', undefined])
  expect(L.lanes[2]!.rows).toBe(4) // lots 2, 3, 4 and 6 stack in column 2
  expect(L.edges.find(e => e.from === 1 && e.to === 2)?.kind).toBe('taken')
  expect(L.edges.find(e => e.from === 6 && e.to === 7)?.kind).toBe('future')
  expect(layout(REWORK({ 2: 'running' })).edges.find(e => e.from === 1 && e.to === 2)?.kind).toBe('live')
  // A hand-edited plan: a cycle and a dependency on a lot that does not exist.
  const odd = layout([lot(1, 'todo', [2]), lot(2, 'todo', [1]), lot(3, 'todo', [9])])
  expect(odd.nodes.length).toBe(3)
  expect(odd.edges.length).toBe(1)
})

test('desktop: a task that finishes ripples, draws its check and the edges out of it, then settles; titles are escaped', async () => {
  const before = layout(REWORK({ 1: 'running' }))
  let m = step(null, before, 1000) // the first look: no motion
  expect(graphSvg(before, m, 1000, () => 'x')).not.toMatch(/stroke-dashoffset" from="1"/)
  const after = layout(REWORK())
  m = step(m, after, 5000)
  expect(m.lots[1]).toEqual({ from: 'running', to: 'done', at: 5000 })
  const svg = graphSvg(after, m, 5100, s => (s === 'aaa' ? 'R&D <a>' : 'b'))
  expect(svg).toMatch(/<path class="draw f-1 t-2"[^>]*pathLength="1"[^>]*><animate attributeName="stroke-dashoffset" from="1" to="0" begin="0.020s"/)
  expect(svg).toMatch(/class="halo st-done"/)
  expect(svg).toContain('R&amp;D &lt;a&gt;')
  expect(svg).not.toContain('R&D')
  const settled = graphSvg(after, m, 5000 + 900, () => 'x')
  expect(settled).not.toMatch(/stroke-dashoffset" from="1"/)
  expect(settled).not.toMatch(/class="halo/)
})

test('desktop: the camera pans onto the running tasks, animated from where it was; loops begin at 0s so the same plan gives the same source', async () => {
  const a = layout(REWORK({ 1: 'running' }))
  const b = layout(REWORK({ 7: 'running', 6: 'done' }))
  const x0 = (L: ReturnType<typeof layout>) => Number(camera(L).split(' ')[0])
  expect(x0(b)).toBeGreaterThan(x0(a))
  expect(x0(layout(REWORK()).nodes.length ? layout([lot(1, 'running')]) : a)).toBe(0) // a graph narrower than the window: no pan
  let m = step(null, a, 1000)
  m = step(m, b, 2000)
  const svg = graphSvg(b, m, 2100, () => 'x')
  expect(svg).toContain(`<animate attributeName="viewBox" from="${camera(a)}" to="${camera(b)}" begin="-0.100s" dur="650ms"`)
  expect(svg).toContain(`viewBox="${camera(b)}"`)
  const live = graphSvg(layout(REWORK({ 2: 'running' })), null, 10_350, () => 'x')
  expect(live).toMatch(/<animateMotion [^>]*begin="0.000s"/) // no clock in a loop: a redraw must not change the source
  expect(live).not.toMatch(/begin="-0.450s"/)
})

test('terminal: the graph in cells, a glint on the running card, edges drawn a few cells a second; wider than the room, the window pans', async () => {
  const L = layout(REWORK({ 7: 'running', 6: 'done' }))
  const wide = graphRaster(L, null, 0, 0, 200, () => 'x')
  expect(wide.columns).toBe(11 + 5 * 24 - 4)
  const narrow = graphRaster(L, null, 0, 0, 80, () => 'x')
  expect(narrow.columns).toBe(80)
  expect(narrow.cells).not.toBe(graphRaster(layout(REWORK({ 1: 'running' })), null, 0, 0, 80, () => 'x').cells) // another window
  expect(graphRaster(L, null, 0, 1, 200, () => 'x').cells).not.toBe(wide.cells) // the glint moved with the tick
  const chars = (cells: [number, number, number][]) => cells.map(c => LINE[c[2]]).join('')
  expect(chars(edgeBits(0, 1, 7, 5))).toBe('─────╮│││╰─') // along, down in the gap before the target, along
  expect(chars(edgeBits(0, 1, 7, 1))).toBe('───────')
  expect(chars(edgeBits(0, 1, 31, 1, 3))).toMatch(/^─╮│╰─+╯│╭─$/) // a skipped column: down to the gutter row under the cards, along, back up
  expect(sparkline([{ spent: 0 }, { spent: 5 }, { spent: 10 }], 10)).toBe('▁▅█')
  expect(budgetSvg({ spent: 6, budget: 10, level: 'reduce', series: [{ at: 0, spent: 0 }, { at: 1000, spent: 6 }] }, 1000)).toMatch(/<polyline points="6.0,58.0 /)
})

const BOARD = {
  at: 990_000, overseer: 'me', goal: 'Rework', nextPassAt: 1_100_000, budget: { spent: 4, budget: 20, level: 'normal', series: [{ at: 900_000, spent: 1 }, { at: 990_000, spent: 4 }] },
  lots: [{ n: 1, title: 'Fondation & kit', status: 'done', depends: [], session: 'aaa' }, { n: 2, title: 'activity-band', status: 'running', depends: [1], session: 'aaa' }, { n: 3, title: 'session-ttl', status: 'todo', depends: [1] }],
  sessions: [{ sessionId: 'aaa', label: 'rework-a', stage: 'work', lot: 2, since: 900_000, lastText: '', tries: 0 }],
  feed: [],
}

test('/oversee show: the graph on every surface: a Raster on the terminal (a list under 60 columns), an interactive Svg at the pane width on desktop and mobile, with no second budget (the PROGRESS · BUDGET line has it)', async ($, on) => {
  mock.store(on, { board: BOARD })
  mock.clock(on, { now: 1_000_000 })
  on('session.id', () => ({ value: 'me' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  const pane = async (surface: 'terminal' | 'desktop' | 'mobile', bodyColumns: number) => { const m = await $.ui.mount({ plugin: 'overseer', surface, component: 'Pane', requestId: 'overseer', props: { title: 'x', isFocused: true, bodyColumns, placement: surface === 'terminal' ? 'dock' : 'inline' } as never, viewport: { columns: bodyColumns + 4, rows: 60 } as never }); await openMore(m); return m }
  const t = await pane('terminal', 120)
  const r = await t.find({ type: 'Raster' })
  expect(r?.props).toMatchObject({ key: 'ovp-graph-r', columns: 11 + 2 * 24 - 4 })
  expect(await t.find({ text: /TASKS · 1\/3 · one lane per session/ })).toBeDefined()
  expect(await t.find({ text: /PLAN · 1\/3/ })).toBeDefined() // the text list stays: what a reader (and a test) can search
  expect(await t.find({ text: /BUDGET .* ▁▂/ })).toBeDefined() // 1 then 4 of 20 points
  await t.unmount()
  const c = await pane('terminal', 50)
  expect((await c.find({ type: 'Raster' }))?.props).toMatchObject({ columns: 46, rows: 3 }) // compact: one row per lot
  for (const surface of ['desktop', 'mobile'] as const) {
    const d = await pane(surface, 100)
    expect(await d.find({ type: 'Raster' })).toBeUndefined()
    const graph = await d.find({ type: 'Svg' })
    expect(graph?.props.isInteractive).toBe(true)
    expect(String(graph?.props.source)).toContain('Fondation &amp; kit')
    expect(String(graph?.props.alt)).toContain('2 activity-band running')
    expect(String((await d.find({ type: 'Svg', text: undefined, key: undefined }))?.props.source)).toContain('<svg')
    expect(JSON.stringify(await d.find({ key: 'ovp-graph' }))).not.toContain('<polyline') // no budget curve: it doubled the budget line
    expect(await d.find({ text: /PLAN · 1\/3/ })).toBeDefined()
  }
})

test('the pane sees a task finish on its next tick: the Svg draws the edges out of it, then settles', async ($, on) => {
  const running = { ...BOARD, lots: BOARD.lots.map(l => (l.n === 1 ? { ...l, status: 'running' } : l.n === 2 ? { ...l, status: 'todo' } : l)) }
  const store: Record<string, unknown> = { board: running } // the board another session's overseer writes
  on('store.get', (_$, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.set', (_$, e) => { store[(e as { key: string }).key] = (e as { value: unknown }).value; return { value: undefined } as never })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.id', () => ({ value: 'me' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  const svg = async () => {
    const d = await $.ui.mount({ plugin: 'overseer', surface: 'desktop', component: 'Pane', requestId: 'overseer', props: { title: 'x', isFocused: true, bodyColumns: 100, placement: 'inline' } as never, viewport: { columns: 104, rows: 60 } as never })
    await openMore(d)
    const s = String((await d.find({ type: 'Svg' }))?.props.source)
    await d.unmount()
    return s
  }
  expect(await svg()).not.toContain('class="draw')
  store.board = { ...BOARD, at: 1_000_500 }
  await clock.advance(1000) // the tick reads the board: lot 1 went from running to done
  expect(await svg()).toMatch(/class="draw f-1 t-2"/)
  await clock.advance(2000)
  expect(await svg()).not.toContain('class="draw')
})

test('focus: the task the next action is about is ringed in the graph, on both surfaces', async () => {
  const L = layout(REWORK({ 6: 'blocked' }))
  expect(graphSvg(L, null, 0, () => 'x', 6)).toMatch(/<g class="n n-6 [^"]*"><title>[^<]*<\/title><rect class="focus"/)
  expect(graphSvg(L, null, 0, () => 'x')).not.toContain('class="focus"')
  expect(graphRaster(L, null, 0, 0, 200, () => 'x', 6).cells).not.toBe(graphRaster(L, null, 0, 0, 200, () => 'x').cells)
})

test("terminal: a finished task's edges are drawn over a few seconds; a phone's camera shows one column at full size", async () => {
  const L = layout(REWORK())
  const m = step(step(null, layout(REWORK({ 1: 'running' })), 1000), L, 5000)
  expect(graphRaster(L, m, 5100, 0, 200, () => 'x').cells).not.toBe(graphRaster(L, m, 15_000, 0, 200, () => 'x').cells)
  expect([camColsFor(45), camColsFor(80), camColsFor(100)]).toEqual([1, 2, 3])
  expect(graphSvg(L, null, 0, () => 'x', undefined, 1)).toMatch(/width="332"/) // the lane names and one column
})

test('desktop: the commit graph and the worktrees are one Svg at the pane width (no text cells to break the lanes), the terminal keeps its text graph', async ($, on) => {
  const board = {
    ...BOARD, base: 'main', top: '/r',
    graph: [
      { graph: '*', hash: 'c9800e1', refs: ['main'], subject: 'fix(claude-mods): address CodeRabbit review on #206, a subject long enough to have wrapped before', at: 900_000 },
      { graph: '|\\' },
      { graph: '| *', hash: '7427f3d', refs: ['claude/rework-a'], subject: 'one line above the prompt', at: 900_000 },
      { graph: '|/' },
      { graph: '*', hash: '44fa43a', subject: 'docs', at: 900_000 },
    ],
    worktrees: [{ path: '/r', branch: 'main', isMain: true, dirty: 2 }, { path: '/r/.claude/worktrees/rework-a', branch: 'claude/rework-a', owner: 'aaa' }],
    branches: [{ name: 'claude/rework-a', path: '/r/.claude/worktrees/rework-a', owner: 'aaa', ahead: 1, behind: 0, files: 1, overlaps: [], merge: { order: 1, conflicts: ['activity-band/hooks/register.tsx'] } }],
  }
  mock.store(on, { board })
  mock.clock(on, { now: 1_000_000 })
  on('session.id', () => ({ value: 'me' }) as never)
  on('env.get', () => ({ value: '/home' }) as never)
  const pane = async (surface: 'terminal' | 'desktop', bodyColumns: number) => { const m = await $.ui.mount({ plugin: 'overseer', surface, component: 'Pane', requestId: 'overseer', props: { title: 'x', isFocused: true, bodyColumns, placement: 'inline' } as never, viewport: { columns: bodyColumns + 4, rows: 60 } as never }); await openMore(m); return m }
  const d = await pane('desktop', 140)
  const box = await d.find({ key: 'ovp-br-svg' })
  const svg = (box?.children ?? []).find(c => (c as { type?: string }).type === 'Svg') as { props?: { source?: string; width?: number } } | undefined
  const src = String(svg?.props?.source ?? '')
  expect(svg?.props?.width).toBe(136 * 8)
  expect((src.match(/<circle/g) ?? []).length).toBe(3)
  expect(src).toContain('✗ conflict · 1 file')
  expect(src).toContain('WORKTREES · 2')
  expect(await d.find({ type: 'Text', text: /7427f3d/ })).toBeUndefined() // no text-cell rows on the desktop: the commit is in the Svg
  await d.unmount()
  const t = await pane('terminal', 140)
  expect(await t.find({ type: 'Text', text: /7427f3d/ })).toBeDefined() // the terminal keeps its text graph
  await t.unmount()
})
