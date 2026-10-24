import { test, expect, mock } from 'claude-code/testing'
import { rasterText } from './raster-text.ts'
import { applyEdits, extract, withModel } from './flow.ts'
import { layout } from './layout.ts'
import { orchestratorLines, placeSide } from './side.ts'
import { agentProgress, expectedSteps } from './register.tsx'
import { bar, paint, sideBox, viewLeft, viewTop } from './canvas.tsx'
import { parseFlags, planFlags } from './fallacy.ts'

const SRC = `export const meta = { name: 'branchy', description: 'x', phases: [{ title: 'Spec' }, { title: 'Build' }] }
const spec = await agent('You are the SPECIFIER. Write the specification for every stream.', { label: 'specifier', phase: 'Spec', model: 'opus' })
const built = await parallel(spec.streams.map(s => () => agent(\`You are the BUILDER of stream \${s.k}. Build it.\`, { label: 'build', phase: 'Build', model: 'sonnet' })))
const check = await agent('You are the VERIFIER of every built stream. Say pass or fail.', { label: 'verify', model: 'sonnet' })
if (check.pass) {
  await agent('You are the INTEGRATOR. Merge every stream into one.', { label: 'integrate', model: 'sonnet' })
} else {
  await agent('You are the FIXER. Repair what the verifier flagged.', { label: 'fix' })
}`

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('the ported parser draws the branch as a decision with yes/no edges', async () => {
  const g = extract(SRC)
  expect(g.nodes.map((n: { label: string }) => n.label)).toEqual(['specifier', 'build', 'verify', 'integrate', 'fix'])
  const d = g.flow.nodes.find((n: { kind: string }) => n.kind === 'decision')
  expect(d.label).toBe('check.pass')
  const labels = g.flow.edges.filter((e: { source: string }) => e.source === d.id).map((e: { label: string }) => e.label).sort()
  expect(labels).toEqual(['no', 'yes'])
})

test('layout: no two cards overlap, every flow edge is routed, branches are labelled', async () => {
  for (const cols of [70, 100, 160]) {
    const geo = layout(extract(SRC), cols)
    for (const a of geo.cards) for (const b of geo.cards) if (a !== b) expect(overlaps(a, b)).toBe(false)
    expect(geo.edges.length).toBe(extract(SRC).flow.edges.length)
    expect(geo.edges.filter(e => e.label === 'yes' || e.label === 'no').length).toBe(2)
    expect(geo.edges.every(e => e.pts.length >= 2)).toBe(true)
  }
})

test('the painter puts every card label and a junction-aware edge on the grid', async () => {
  const geo = layout(extract(SRC), 100)
  const text = paint({ geo, selected: "a2" }).map(r => r.map(s => s.t).join('')).join('\n')
  for (const l of ['specifier', 'build', 'verify', 'integrate', 'fix', '◆ check.pass', '×N over spec.streams']) expect(text).toContain(l)
  expect(text).toContain('╔') // the selected card
  expect(text).toMatch(/▼ (yes|no)/)
})

test('edits splice bytes: a no-op is identical, a tier edit changes only that literal', async () => {
  const g = extract(SRC)
  expect(applyEdits(SRC, g.nodes, {})).toBe(SRC)
  const r = withModel(SRC, g.nodes, {}, 'a0', 'sonnet')
  expect(applyEdits(SRC, g.nodes, r.edits)).toBe(SRC.replace("model: 'opus'", "model: 'sonnet'"))
  const ins = withModel(SRC, g.nodes, {}, 'a4', 'haiku') // inherited model: a key is inserted
  expect(extract(applyEdits(SRC, g.nodes, ins.edits)).nodes[4].model).toBe('haiku')
})

test('a held plan draws the pane: tabs, canvas, detail and approval buttons', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  await $.tool.call({ tool: 'Workflow', script: SRC })
  const pane = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 110, placement: 'dock' } as never, viewport: { columns: 120, rows: 50 } as never })
  for (const key of ['t-plan', 't-live', 't-history', 'canvas-plan', 'approve', 'browser', 'cancel']) expect(await pane.find({ key })).toBeDefined()
  expect((await pane.find({ key: 'model-a0' }))?.props.value).toBe('opus')
  // The review card is framed with whole lines, and the open card's goal / task / deliverable sit in their own frame.
  // The Plan canvas is the interactive one, the review card drawn beside the graph inside it.
  const canvas = await pane.find({ key: 'canvas-plan' })
  expect(canvas?.type).toBe('Client')
  expect((canvas?.props.props as { side?: { title: string } }).side?.title).toBe('🧭 Review · plan')
})

test('progress bars: done is full, running creeps toward the typical step count and says it is an estimate', async () => {
  expect(bar(0.5, 14)).toBe('█████░░░░░ 50%')
  expect(bar(1, 14)).toBe('█████████ 100%')
  expect(bar(0.4, 15, true)).toBe('████░░░░░░ ~40%')
})

test('an agent bar uses the median steps of past agents with the same label', async () => {
  const g = extract(SRC)
  const past = [{ agents: [{ label: 'build:a', turns: 4 }, { label: 'build:b', turns: 10 }, { label: 'build:c', turns: 6 }, { label: 'verify', turns: 3 }] }]
  const exp = expectedSteps(g, past)
  expect(exp.a1).toBe(6)
  expect(exp.a2).toBe(3)
  expect(agentProgress({ key: 'k', label: 'build:a', status: 'running', steps: 3, startedAt: 0 }, exp.a1)).toEqual({ progress: 0.5, isEstimate: true })
  expect(agentProgress({ key: 'k', label: 'build:a', status: 'running', steps: 30, startedAt: 0 }, exp.a1).progress).toBe(0.95)
  expect(agentProgress({ key: 'k', label: 'x', status: 'done', startedAt: 0 }, undefined)).toEqual({ progress: 1, isEstimate: false })
})

test('plan fallacy check: self-review on the same tier, and a branch on schema-less free text', async () => {
  const flags = planFlags(extract(SRC), SRC)
  const kinds = flags.map(f => `${f.cardId}:${f.kind}`)
  expect(kinds).toContain('a2:self-review') // verify (sonnet) checks build (sonnet)
  expect(kinds.some(k => k.endsWith(':unverified premise'))).toBe(true) // if (check.pass) on free text
  expect(kinds.some(k => k.includes('unreconciled'))).toBe(false) // builders act; nobody needs to read them
})

test('plan fallacy check: parallel reviewers whose findings nobody reads are flagged', async () => {
  const src = `const DIMS = ['bugs', 'perf']
const found = await parallel(DIMS.map(d => () => agent(\`Review the diff for \${d}. List findings.\`, { label: 'review', model: 'sonnet' })))
await agent('Write the release note.', { label: 'notes', model: 'haiku' })`
  expect(planFlags(extract(src), src).map(f => f.kind)).toContain('unreconciled fan-out')
})

test('live fallacy replies are read defensively', async () => {
  expect(parseFlags('[]')).toEqual([])
  expect(parseFlags('Sure! [{"kind":"unverified assumption","quote":"the API returns JSON","why":"never checked the docs"}] hope it helps')).toEqual([{ kind: 'unverified assumption', quote: 'the API returns JSON', why: 'never checked the docs', severity: 'high' }])
  expect(parseFlags('no json here')).toEqual([])
  expect(parseFlags('[{"kind": 3}]')).toEqual([])
})

test('the orchestrator card beside the graph scrolls on its own: a window of its lines, with ▲/▼ counts', async () => {
  const geo = layout(extract(SRC), 70)
  const lines = Array.from({ length: 30 }, (_, i) => ({ t: `line ${i}` }))
  const side = { x: geo.width + 1, y: 0, w: 40, title: 'Orchestrator', lines }
  const text = (top: number, sideTop: number) => paint({ geo, side }, { top, rows: 12, sideTop }).map(r => r.map(s => s.t).join('')).join('\n')
  expect(sideBox(side, { top: 0, rows: 12, sideTop: 0 })).toEqual({ y: 0, h: 12, first: 0, inner: 10, isPinned: true })
  expect(text(0, 0)).toContain('▼ 21 more') // 10 rows shown, the last one is the ▼ marker
  expect(text(0, 0)).not.toContain('▲')
  expect(text(0, 25)).toContain('▲ 21 more') // clamped: the window ends on the last line
  expect(text(0, 25)).toContain('line 29')
  expect(text(15, 0)).toMatch(/line 1\b/) // pinned: the graph scrolled 15 rows, the card's window did not move
})

test('the canvas follows the running card unless the person scrolled in the last 15 s', async () => {
  const geo = layout(extract(SRC), 100)
  const last = [...geo.cards].sort((a, b) => b.y - a.y).find(c => c.kind === 'agent')!
  const p = { geo, follow: last.id }
  const top = viewTop(p, { top: 0 }, 12, 1_000_000)
  expect(last.y >= top && last.y + last.h <= top + 12).toBe(true) // moved to show it
  expect(viewTop(p, { top: 0, manualAt: 995_000 }, 12, 1_000_000)).toBe(0) // scrolled 5 s ago: left alone
  expect(viewTop(p, { top: 0, manualAt: 980_000 }, 12, 1_000_000)).toBe(top) // 20 s ago: follows again
  expect(viewTop({ geo }, { top: 3 }, 12, 1_000_000)).toBe(3) // nothing to follow: the person's scroll
})

test('an open card grows by its description, wider, and still overlaps nothing', async () => {
  const g = extract(SRC)
  const closed = layout(g, 120)
  const body = [{ t: '🎯 Specify every stream so builders can work in parallel' }, { t: '⚙ Reads the brief, splits it into streams' }, { t: '📦 One spec per stream' }]
  const open = layout(g, 120, { id: 'a0', w: 60, body })
  const before = closed.cards.find(c => c.id === 'a0')!, after = open.cards.find(c => c.id === 'a0')!
  expect(after.h).toBe(before.h + 3)
  expect(after.w).toBe(60)
  for (const a of open.cards) for (const b of open.cards) if (a !== b) expect(overlaps(a, b)).toBe(false)
  const text = paint({ geo: open }).map(r => r.map(s => s.t).join('')).join('\n')
  expect(text).toContain('🎯 Specify every stream so builders can work in')
  expect(text).toContain('📦 One spec per stream')
})

test('the orchestrator card says who decided: Opus, or the old request-count watchdog', async () => {
  const flags = [
    { cardId: 'a1', agentId: 'ag1', agent: 'build', kind: 'runaway', why: '60 requests', decision: { action: 'ask_human' as const, message: 'Let it continue?' } },
    { cardId: 'a1', agentId: 'ag1', agent: 'build', kind: 'unverified assumption', why: 'never checked', decision: { action: 'steer' as const, message: 'Check the docs.' } },
  ]
  const text = orchestratorLines(flags, [], { opusCalls: 1, checks: 1 }, 60).map(l => l.t).join('\n')
  expect(text).toContain('→ ⏱ Watchdog asks you: Let it continue?')
  expect(text).toContain('→ 🧭 Opus steer: Check the docs.')
})

test('paint keeps rows small: spaces join the segment before them, trailing spaces are dropped', async () => {
  const geo = layout(extract(SRC), 120)
  const rows = paint({ geo })
  for (const r of rows) expect(r.at(-1)?.t.endsWith(' ') ?? false).toBe(false)
  for (const r of rows) for (let i = 1; i < r.length; i++) expect(r[i]!.t.trim() === '' && !r[i]!.bg).toBe(false) // no space-only segment after the first
  const lines = Array.from({ length: 300 }, (_, i) => ({ t: `line ${i} of a very long orchestrator card`, c: '#abb2bf' }))
  const tall = paint({ geo, side: { x: geo.width + 1, y: 0, w: 50, title: 'Orchestrator', lines } }, { top: 0, rows: 310, sideTop: 0 })
  const json = JSON.stringify(tall).length
  expect(json).toBeLessThan(120000) // the draw-time budget then keeps the tree itself under 100 000
})

test('a graph wider than the pane: the side card goes under it, and the window pans to the card to follow', async () => {
  expect(placeSide(140, { width: 70, height: 30 })).toMatchObject({ y: 0 }) // fits beside
  expect(placeSide(140, { width: 120, height: 30 })).toMatchObject({ x: 1, y: 31 }) // too wide: under it
  const geo = { width: 300, height: 10, cards: [{ id: 'far', kind: 'agent', x: 240, y: 2, w: 30, h: 5, label: 'far' }], edges: [] }
  const left = viewLeft({ geo, follow: 'far' } as never, { left: 0 }, 100, 1_000_000)
  expect(240 >= left && 270 <= left + 100).toBe(true) // panned to show it
  expect(viewLeft({ geo, follow: 'far' } as never, { left: 0, manualAt: 995_000 }, 100, 1_000_000)).toBe(0) // panned by hand 5 s ago
})

test('a very big workflow: the Plan canvas takes the whole graph (no 256-row cap) and draws only the rows in view', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  const steps = Array.from({ length: 80 }, (_, i) =>
    `const r${i} = await parallel(['a', 'b', 'c', 'd'].map(x => () => agent(\`You handle part \${x} of step ${i}: read the files, change them, and report every change you made with its reason.\`, { label: 'step${i}', model: '${['haiku', 'sonnet', 'opus'][i % 3]}' })))`)
  const big = `export const meta = { name: 'huge', description: 'x', phases: [{ title: 'All' }] }\n${steps.join('\n')}`
  await $.tool.call({ tool: 'Workflow', script: big })
  const pane = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 200, placement: 'dock', scroll: { offset: 0, bodyRows: 50 } } as never, viewport: { columns: 210, rows: 60 } as never })
  const top = await pane.find({ key: 'canvas-plan' })
  expect(top?.type).toBe('Client')
  expect(Number(top?.props.height)).toBeGreaterThan(256) // the pane scrolls the whole graph
  expect((top?.props.props as { win?: { rows: number } }).win?.rows).toBe(50) // the canvas draws the rows in view
})

test("a short pane: the Plan canvas keeps the graph's height and the pane scrolls it", async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  const steps = Array.from({ length: 12 }, (_, i) =>
    `const r${i} = await agent('You handle step ${i}: read the files, change them, and report every change with its reason.', { label: 'step${i}', model: 'haiku' })`)
  await $.tool.call({ tool: 'Workflow', script: `export const meta = { name: 'tall', description: 'x', phases: [] }\n${steps.join('\n')}` })
  const pane = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 30, bodyRows: 12 } } as never, viewport: { columns: 110, rows: 14 } as never })
  const r = await pane.find({ key: 'canvas-plan' })
  expect(Number(r?.props.height)).toBeGreaterThan(12) // not cut to the body: the pane scrolls it
  expect(await pane.find({ text: /Too short for the diagram/ })).toBeUndefined()
})

const SMALL = `export const meta = { name: 'probe', description: 'x', phases: [] }
const s = await agent('You are the SPECIFIER. Write the spec.', { label: 'specifier', model: 'opus' })
const b = await agent('Build it from the spec.', { label: 'build', model: 'sonnet' })
await agent('You are the VERIFIER. Check the build.', { label: 'verify', model: 'sonnet' })`
const paneOf = (bodyRows: number) => ({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 82, placement: 'dock', scroll: { offset: 0, bodyRows } } as never, viewport: { columns: 84, rows: bodyRows + 2 } as never }) as never

test('a pane whose body is a row or two says so and lists the steps; given room, it draws the graph', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  await $.tool.call({ tool: 'Workflow', script: SMALL })
  const squeezed = await $.ui.mount(paneOf(2))
  expect(await squeezed.find({ in: 'canvas-plan', text: /Too short for the diagram/ })).toBeDefined() // drawn by the Plan canvas itself
  expect(await squeezed.find({ in: 'canvas-plan', text: /specifier \(opus\) → build \(sonnet\) → verify \(sonnet\)/ })).toBeDefined()
  await squeezed.unmount()
  const roomy = await $.ui.mount(paneOf(30))
  expect(await roomy.find({ key: 'canvas-plan' })).toMatchObject({ type: 'Client' })
  expect(await roomy.find({ text: /Too short/ })).toBeUndefined()
})

test('a held plan whose pane cannot seat (a narrow desktop window) toasts and tells Claude to point at /gate', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'unasked panes seat from 144 columns; 100 now' } }) as never)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(String((e as { text?: string }).text ?? e)); return { value: undefined } as never })
  const res = await $.tool.call({ tool: 'Workflow', script: SRC }).catch((x: unknown) => x) as { deny?: string }
  expect(JSON.stringify(res)).toContain('tell the human to type /gate')
  expect(toasts.join('\n')).toContain('type /gate to see the plan')
})

test("the terminal Plan canvas is interactive: its 'm' key cycles a card's model, a click opens the card", async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on)
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  await $.tool.call({ tool: 'Workflow', script: SRC })
  const pane = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 110, placement: 'dock' } as never, viewport: { columns: 120, rows: 50 } as never })
  expect((await pane.find({ key: 'model-a0' }))?.props.value).toBe('opus')
  await pane.post({ cycleModel: 'a0' }, { in: 'canvas-plan' }) // what the canvas posts on 'm'
  expect((await pane.find({ key: 'model-a0' }))?.props.value).toBe('fable') // haiku → sonnet → opus → fable
  await pane.post({ select: 'a2' }, { in: 'canvas-plan' }) // what it posts on a click
  expect(((await pane.find({ key: 'canvas-plan' }))?.props.props as { selected?: string }).selected).toBe('a2')
})
