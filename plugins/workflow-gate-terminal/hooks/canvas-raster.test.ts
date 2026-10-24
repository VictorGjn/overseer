import { test, expect, mock } from 'claude-code/testing'
import { layout } from './layout.ts'
import { extract } from './flow.ts'
import { compact, criticalPath, edgeCells, frame, scene } from './canvas-raster.ts'
import { MODEL_COLOR } from './canvas.tsx'
import { rasterText } from './raster-text.ts'

const SRC = `export const meta = { name: 'branchy', description: 'x', phases: [{ title: 'Spec' }, { title: 'Build' }] }
const spec = await agent('You are the SPECIFIER. Write the specification for every stream.', { label: 'specifier', phase: 'Spec', model: 'opus' })
const built = await parallel(spec.streams.map(s => () => agent(\`You are the BUILDER of stream \${s.k}. Build it.\`, { label: 'build', phase: 'Build', model: 'sonnet' })))
const check = await agent('You are the VERIFIER of every built stream. Say pass or fail.', { label: 'verify', model: 'sonnet' })
if (check.pass) {
  await agent('You are the INTEGRATOR. Merge every stream into one.', { label: 'integrate', model: 'sonnet' })
} else {
  await agent('You are the FIXER. Repair what the verifier flagged.', { label: 'fix' })
}`
const geo = () => layout(extract(SRC) as never, 100)
const id = (label: string) => geo().cards.find(c => c.label === label)!.id
const text = (s: { columns: number; rows: number; cells: string }) => rasterText({ props: s })

test('the Raster paints what the Client painted: cards, model pills, junctions; one cell per UTF-16 unit', async () => {
  const g = geo()
  const s = scene({ geo: g, columns: 100, rows: 256, now: 0 })
  const t = text({ columns: s.base.columns, rows: s.base.rows, cells: frame(s, 0) })
  expect(t).toContain('● start')
  expect(t).toMatch(/╭.*Spec/) // the phase on the card's top border
  expect(t).toContain(' opus ')
  expect(t).toContain('◆') // the decision
  expect(t).toMatch(/[┬┴├┤┼]/) // edges merge with real junctions
  expect(s.isMoving).toBe(false) // Plan: nothing running, nothing to blit
})

test('Live: particles run along the edges into the running card, a glint round its border, a pip per worker; each frame moves them', async () => {
  const g = geo()
  const live = { [id('specifier')]: { state: 'done' as const }, [id('build')]: { state: 'running' as const } }
  const s = scene({ geo: g, live, workers: { [id('build')]: ['ok', 'run', 'wait'] }, columns: 100, rows: 256, now: 0 })
  expect(s.isMoving).toBe(true)
  expect(s.particles.length).toBe(1) // specifier → build
  expect(s.glints.length).toBe(1)
  expect(s.pips.map(p => p.w)).toEqual(['ok', 'run', 'wait'])
  const [f0, f1] = [frame(s, 0), frame(s, 1)]
  expect(f0).not.toBe(f1)
  expect(text({ columns: s.base.columns, rows: s.base.rows, cells: f0 })).toContain('■■■')
  expect(frame(s, 7)).toBe(frame(s, 7)) // a frame is a function of its number: a redraw and a blit agree
})

test('the critical path: the longest chain of cards not done, from the running card to the end, weighted by past runs', async () => {
  const g = geo()
  const live = { [id('specifier')]: { state: 'done' as const }, [id('build')]: { state: 'running' as const } }
  const edgeTo = (label: string) => g.edges.find(e => e.to === id(label) && e.arrow === 'down')!.id
  const light = criticalPath(g, live, x => (x === id('fix') ? 5 : 1)) // the fixer usually takes five times longer
  expect(light.has(edgeTo('verify'))).toBe(true)
  expect(light.has(edgeTo('fix'))).toBe(true)
  expect(light.has(edgeTo('integrate'))).toBe(false)
  expect(criticalPath(g, live, x => (x === id('integrate') ? 5 : 1)).has(edgeTo('integrate'))).toBe(true)
  const s = scene({ geo: g, live, critical: light, columns: 100, rows: 256, now: 0 })
  const amber = 0xe5c07b, cells = new DataView(Uint8Array.from(atob(frame(s, 0)), c => c.charCodeAt(0)).buffer)
  const [x, y] = edgeCells(g.edges.find(e => e.id === edgeTo('fix'))!).at(-2)!
  expect(cells.getUint32(((y - s.top) * s.base.columns + (x - s.left)) * 12 + 4, true)).toBe(amber)
})

test('a graph bigger than its window: the window follows the card to follow, and a pan by the person holds 15 s', async () => {
  const g = geo()
  const far = g.cards.reduce((a, c) => (c.y > a.y ? c : a))
  const s = scene({ geo: g, follow: far.id, columns: 100, rows: 8, now: 1_000_000 })
  expect(s.top).toBeGreaterThan(0)
  expect(s.base.rows).toBe(8)
  expect(scene({ geo: g, follow: far.id, columns: 100, rows: 8, pan: { left: 0, top: 0, manualAt: 995_000 }, now: 1_000_000 }).top).toBe(0)
  expect(scene({ geo: g, follow: far.id, columns: 100, rows: 8, pan: { left: 0, top: 0, manualAt: 980_000 }, now: 1_000_000 }).top).toBe(s.top)
})

test('under 60 columns: one row per card in run order, state, label, workers and model', async () => {
  const g = geo()
  const c = compact(g, { [id('build')]: { state: 'running' } }, { [id('build')]: ['ok', 'run'] }, 40, MODEL_COLOR)
  const t = text(c).split('\n')
  expect(c.columns).toBe(40)
  expect(t[0]).toMatch(/^▸ specifier\s+opus$/)
  expect(t[1]).toMatch(/^● build\s+■■ sonnet$/)
  expect(t.some(l => l.startsWith('◆'))).toBe(true)
})

const PANE = (bodyColumns = 110) => ({ plugin: 'workflow-gate-terminal', surface: 'terminal', component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } }, viewport: { columns: bodyColumns + 4, rows: 50 } }) as never

test('terminal Live: the Raster is blitted at 15 fps while a card runs, and the loop stops once nothing moves', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.call', () => ({ result: { text: 'Workflow launched in background. Task ID: wr' } }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++n}` }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  // The test harness has no core ui.blit ("no implementation for ui.blit"), so this hook plays the engine's
  // rule: taken while the Live tab's Raster is mounted, refused once it is gone.
  const blits: string[] = []
  const answers: { deny?: string }[] = []
  let isLiveShown = true
  on('ui.blit', (_$, e) => { blits.push((e as { key: string }).key); const r = isLiveShown ? {} : { deny: 'nothing of this plugin is mounted there' }; answers.push(r); return { value: r } as never })
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_r-1' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream.', description: 'specifier', workflow: { runId: 'wf_r-1', agentIndex: 1 } } as never)
  const pane = await $.ui.mount(PANE())
  await pane.press({ key: 't-live' })
  const live = await pane.find({ key: 'canvas-live' })
  expect(live?.type).toBe('Raster')
  expect(await pane.find({ type: 'Client' })).toBeUndefined()
  expect(rasterText(live)).toContain('specifier')
  await clock.advance(1000)
  expect(blits.length).toBeGreaterThanOrEqual(13) // ~15 a second
  expect(blits.length).toBeLessThanOrEqual(16)
  expect(new Set(blits)).toEqual(new Set(['canvas-live']))
  expect(answers.filter(a => a.deny)).toEqual([])
  // Another tab: the Raster is gone, the next blit is refused and the loop stops.
  await pane.press({ key: 't-plan' })
  isLiveShown = false
  const before = blits.length
  await clock.advance(1000)
  expect(answers.at(-1)?.deny).toBeDefined()
  expect(blits.length - before).toBe(1)
  isLiveShown = true
  await pane.press({ key: 't-live' }) // back: the loop starts again
  await clock.advance(500)
  expect(blits.length - before).toBeGreaterThan(3)
  await $.turn.complete({ turnId: 'ag1', agentId: 'ag1', answer: 'ok', durationMs: 10, isAborted: false, reason: 'end_turn' } as never).catch(() => undefined)
  await pane.redraw()
  const settled = blits.length
  await clock.advance(1000)
  expect(blits.length - settled).toBeLessThanOrEqual(1) // at rest: the loop stopped
})

test('terminal Live under 60 columns: the compact Raster, no blit', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.call', () => ({ result: { text: 'Workflow launched in background. Task ID: wc' } }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'ag1' }) as never)
  const blits: string[] = []
  on('ui.blit', (_$, e) => { blits.push((e as { key: string }).key); return { value: {} } as never })
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_c-1' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream.', description: 'specifier', workflow: { runId: 'wf_c-1', agentIndex: 1 } } as never)
  const pane = await $.ui.mount(PANE(50))
  await pane.press({ key: 't-live' })
  const r = await pane.find({ key: 'canvas-live' })
  expect(r?.props.columns).toBe(49)
  expect(rasterText(r).split('\n')[0]).toMatch(/^● specifier/)
  await clock.advance(1000)
  expect(blits.length).toBe(0)
})
