import { test, expect, mock } from 'claude-code/testing'
import { layout } from './layout.ts'
import { extract } from './flow.ts'
import { flowSvg, remember, snapshot, SOURCE_MAX } from './canvas-svg.ts'
import { MODEL_COLOR } from './canvas.tsx'

const SRC = `export const meta = { name: 'branchy', description: 'x', phases: [{ title: 'Spec' }, { title: 'Build' }] }
const spec = await agent('You are the SPECIFIER. Write the specification for every stream.', { label: 'specifier', phase: 'Spec', model: 'opus' })
const built = await parallel(spec.streams.map(s => () => agent(\`You are the BUILDER of stream \${s.k}. Build it.\`, { label: 'build', phase: 'Build', model: 'sonnet' })))
const check = await agent('You are the VERIFIER of every built stream. Say pass or fail.', { label: 'verify', model: 'sonnet' })
if (check.pass) {
  await agent('You are the INTEGRATOR. Merge every stream into one.', { label: 'integrate', model: 'sonnet' })
} else {
  await agent('You are the FIXER. Repair what the verifier flagged.', { label: 'fix' })
}`
const PANE = (surface: 'desktop' | 'mobile' | 'terminal') => ({ plugin: 'workflow-gate-terminal', surface, component: 'Pane', requestId: 'workflow-gate', props: { title: 'Workflow gate', isFocused: true, bodyColumns: 110, placement: 'dock' }, viewport: { columns: 120, rows: 50 } }) as never
// The pane holds one Svg (Plan's or Live's): its source.
const source = async (pane: { find: (q: object) => Promise<{ props: Record<string, unknown> } | undefined> }, _tab: string) => String((await pane.find({ type: 'Svg' }))?.props.source)

test('svg: cards in their model colour, edges with arrows, a loop up the margin, every text escaped', async () => {
  const geo = layout({
    nodes: [{ id: 'a0', kind: 'agent', label: 'review:<dim>', model: 'opus' }, { id: 'a1', kind: 'agent', label: 'verify & fix', model: 'haiku' }],
    flow: { nodes: [], edges: [{ source: 'start', target: 'a0' }, { source: 'a0', target: 'a1' }, { source: 'a1', target: 'end' }, { source: 'a1', target: 'a0', kind: 'back', label: 'low confidence' }] },
  }, 80)
  const svg = flowSvg({ geo }, {}, 0)
  expect(svg).toContain(MODEL_COLOR.opus!)
  expect(svg).toContain(MODEL_COLOR.haiku!)
  expect(svg).toContain('review:&#60;dim&#62;')
  expect(svg).toContain('verify &#38; fix')
  expect(svg).toContain('↺ low confidence')
  expect(svg.match(/marker-end/g)?.length).toBe(geo.edges.length)
  expect(svg).not.toContain('<animate') // a plan seen once moves nothing
})

test('svg: a card that ends draws its check and a ripple, its next edge draws, then all is still', async () => {
  const geo = layout({
    nodes: [{ id: 'a0', kind: 'agent', label: 'plan', model: 'opus' }, { id: 'a1', kind: 'agent', label: 'review', model: 'sonnet', fanOut: { n: 3, over: 'dims' } }],
    flow: { nodes: [], edges: [{ source: 'start', target: 'a0' }, { source: 'a0', target: 'a1' }, { source: 'a1', target: 'end' }] },
  }, 80)
  const at = (s0: 'running' | 'done', s1: 'pending' | 'running', ws: ('wait' | 'run')[]) => ({ geo, live: { a0: { state: s0, progress: 0.5 }, a1: { state: s1, progress: 0 } }, workers: { a1: ws } })
  let m = remember(undefined, snapshot(at('running', 'pending', ['wait', 'wait', 'wait'])), 1000)
  expect(flowSvg(at('running', 'pending', ['wait', 'wait', 'wait']), m, 1000)).toContain('class="i-ring"') // the running ring loops
  const next = at('done', 'running', ['run', 'wait', 'wait'])
  m = remember(m, snapshot(next), 5000)
  const moving = flowSvg(next, m, 5100)
  expect(moving).toMatch(/class="halo ok"/) // the ripple
  expect(moving).toMatch(/class="chk"[^>]*stroke-dashoffset="1"><animate attributeName="stroke-dashoffset"/) // the check draws itself
  expect(moving).toMatch(/class="draw live"/) // the edge into the started card draws
  expect(moving).toContain('<animateMotion') // tokens on the live edge
  expect(moving).toMatch(/<rect x="\d+" y="\d+" width="\d+" height="\d+" rx="10" fill="var\(--sf\)" stroke="#61afef" stroke-opacity="0.35"><animate attributeName="x"/) // the fan-out spreads
  expect(moving).toMatch(/begin="-0\.100s"/) // a redraw 100 ms in resumes where the motion was
  const still = flowSvg(next, m, 7000)
  expect(still).not.toMatch(/halo ok|class="draw|attributeName="x"/)
  expect(still).toContain('<animateMotion') // the loops keep running
})

test('svg: out of a decision, only the branch the run took is drawn as taken', async () => {
  const geo = layout(extract(SRC), 100)
  const live = { a0: { state: 'done' as const }, a1: { state: 'done' as const }, a2: { state: 'done' as const }, a3: { state: 'running' as const }, a4: { state: 'pending' as const } }
  const snap = snapshot({ geo, live })
  const into = (id: string) => snap[`e:${geo.edges.find(e => e.to === id && e.arrow === 'down')!.id}`]
  expect(into('a3')).toBe('live') // yes: integrate runs
  expect(into('a4')).toBe('future') // no: fix never ran
})

test('desktop Plan: the flowchart is an Svg (no Client), the inspector keeps its model Select, a card picker moves the camera once', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  await $.tool.call({ tool: 'Workflow', script: SRC })
  const pane = await $.ui.mount(PANE('desktop'))
  expect(await pane.find({ type: 'Client' })).toBeUndefined()
  const svg = await source(pane as never, 'canvas-plan')
  for (const l of ['specifier', 'build', 'verify', 'integrate', 'fix', 'check.pass', MODEL_COLOR.opus!]) expect(svg).toContain(l)
  expect((await pane.find({ type: 'Svg' }))?.props).toMatchObject({ isInteractive: true, alt: expect.stringContaining('branchy') })
  expect((await pane.find({ key: 'model-a0' }))?.props.value).toBe('opus') // the model Select in the inspector
  // The review card is a framed box with whole lines, and the open card says what it is for, under the flowchart.
  expect((await pane.find({ key: 'canvas-plan-side' }))?.props).toMatchObject({ borderStyle: 'round' })
  expect(await pane.find({ text: /🧭 Review · plan/ })).toBeDefined()
  expect(await pane.find({ key: 'canvas-plan-body' })).toBeDefined()
  await (pane as unknown as { select: (t: { key: string; value: string }) => Promise<unknown> }).select({ key: 'canvas-plan-pick', value: 'a4' }) // a desktop mount has select
  expect(await pane.find({ text: /▸ fix/ })).toBeDefined() // the inspector follows the pick
  expect(await source(pane as never, 'canvas-plan')).toContain('attributeName="viewBox"') // the camera moves to it
  await clock.advance(1000)
  await pane.redraw()
  expect(await source(pane as never, 'canvas-plan')).not.toContain('attributeName="viewBox"') // and stays there
})

test('desktop Live: a card that starts and ends replays the lab choreography in the pane', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('tool.call', () => ({ result: { text: 'Workflow launched in background. Task ID: wsvg' } }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++n}` }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await $.tool.call({ tool: 'Workflow', script: SRC, resumeFromRunId: 'wf_svg-1' } as never)
  await $.agent.spawn({ prompt: 'You are the SPECIFIER. Write the specification for every stream.', description: 'specifier', workflow: { runId: 'wf_svg-1', agentIndex: 1 } } as never)
  const pane = await $.ui.mount(PANE('desktop'))
  await pane.press({ key: 't-live' })
  expect(await source(pane as never, 'canvas-live')).toContain('class="i-ring"')
  await clock.advance(500)
  await $.turn.complete({ turnId: 'ag1', agentId: 'ag1', answer: 'ok', durationMs: 10, isAborted: false, reason: 'end_turn' } as never).catch(() => undefined)
  await $.agent.spawn({ prompt: 'You are the BUILDER of stream a. Build it.', description: 'build', workflow: { runId: 'wf_svg-1', agentIndex: 2 } } as never)
  const svg = await source(pane as never, 'canvas-live')
  expect(svg).toMatch(/class="chk"[^>]*><animate attributeName="stroke-dashoffset"/) // the check draws itself
  expect(svg).toContain('attributeName="viewBox"') // the camera moves to the card that started
  expect(svg).toMatch(/class="halo ok"/)
  expect(svg).toMatch(/class="draw live"/)
  expect(svg).toContain('<animateMotion')
  expect(await pane.find({ type: 'Client' })).toBeUndefined()
  await clock.advance(2000)
  await pane.redraw()
  expect(await source(pane as never, 'canvas-live')).not.toMatch(/halo ok|class="draw|attributeName="viewBox"/)
})

test('mobile: Plan and Live draw the Svg, and cards are picked with Buttons (no Select, no Client)', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  await $.tool.call({ tool: 'Workflow', script: SRC })
  const pane = await $.ui.mount(PANE('mobile'))
  expect(await pane.find({ type: 'Svg' })).toBeDefined()
  expect(await pane.find({ type: 'Select' })).toBeUndefined()
  expect(await pane.find({ type: 'Client' })).toBeUndefined()
  await pane.press({ key: 'canvas-plan-pick-a2' })
  expect(await pane.find({ text: /▸ verify/ })).toBeDefined()
  expect(await pane.find({ text: /model sonnet \(decided at runtime\)/ })).toBeDefined() // the inspector says the model it cannot edit here
  await pane.press({ key: 't-live' })
  expect(await pane.find({ text: /No run yet/ })).toBeDefined()
})

test('desktop: a very big workflow still fits the Svg source cap', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  const steps = Array.from({ length: 80 }, (_, i) =>
    `const r${i} = await parallel(['a', 'b', 'c', 'd'].map(x => () => agent(\`You handle part \${x} of step ${i}: read the files, change them, and report every change you made with its reason.\`, { label: 'step${i}', model: '${['haiku', 'sonnet', 'opus'][i % 3]}' })))`)
  await $.tool.call({ tool: 'Workflow', script: `export const meta = { name: 'huge', description: 'x', phases: [{ title: 'All' }] }\n${steps.join('\n')}` })
  const pane = await $.ui.mount(PANE('desktop'))
  const svg = await source(pane as never, 'canvas-plan')
  expect(svg.length).toBeLessThanOrEqual(SOURCE_MAX)
  expect(svg).toContain('step79')
})

test('terminal Plan: the flowchart is the interactive Client canvas, no Svg', async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on, { now: 1_000_000 })
  on('session.usage', () => ({ startedAt: 0, context: {}, rateLimits: [] }) as never)
  await $.tool.call({ tool: 'Workflow', script: SRC })
  const pane = await $.ui.mount(PANE('terminal'))
  expect(await pane.find({ key: 'canvas-plan' })).toMatchObject({ type: 'Client' })
  expect(await pane.find({ type: 'Svg' })).toBeUndefined()
})
