// The shared kit, run in every mod that carries a copy (check.sh keeps the copies identical).
import { test, expect } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { beginAt, comet, drawOn, halo, isMoving, move, ageOf, MS } from './motion.ts'
import { base64, grid, heat, HEAT, loop, mix, pack, perimeter, put, DEFAULT } from './cells.ts'
import { isSidePane, table, zoomOf } from './surface.ts'

test('cells pack as the Raster wants them: u32 little-endian triplets in padded base64', async () => {
  const g = grid(1, 1)
  put(g, 0, 0, '█', 0xff8800)
  expect(pack(g)).toBe('iCUAAACI/wAAAAAB') // the types' own example: one orange block on the default background
  expect(base64(new Uint8Array([1]))).toBe('AQ==')
  expect(base64(new Uint8Array([1, 2]))).toBe('AQI=')
  for (const wide of ['🌙', '⚡', '⛔', '漢', '\u0007']) { // wide emoji (BMP too), CJK, a control: not a cell
    put(g, 0, 0, wide)
    expect(g.data[0]).toBe(0xb7)
  }
  for (const ok of '▰▱█─╭⠋✓✗●◐▸↳·…') { put(g, 0, 0, ok); expect(g.data[0]).toBe(ok.codePointAt(0)) }
  expect(grid(9999, 9999).columns).toBe(512)
})

test('mix, heat and the border a glint runs along', async () => {
  expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080)
  expect(mix(0x102030, 0x102030, 0.3)).toBe(0x102030)
  expect(mix(DEFAULT, 0xffffff, 0.2)).toBe(DEFAULT)
  expect(heat(0)).toBe(HEAT[0])
  expect(heat(1)).toBe(HEAT[7])
  const p = perimeter(2, 3, 4, 3)
  expect(p.length).toBe(10) // 2·4 + 2·(3 − 2)
  expect(p[0]).toEqual([2, 3])
  expect(p[4]).toEqual([5, 4])
  expect(new Set(p.map(c => c.join(','))).size).toBe(p.length)
})

test('a blit loop runs while something moves and stops at rest, or when its Raster is gone', async () => {
  let fn: (() => void) | null = null
  let cancelled = 0
  const every = (_ms: number, f: () => void) => ((fn = f), { cancel: () => void cancelled++ })
  const blits: string[] = []
  let deny = false
  const l = loop({ every, requestId: 'p', key: 'r', blit: async a => (blits.push(a.cells), deny ? { deny: 'not mounted' } : {}), frame: n => (n < 3 ? `f${n}` : null) })
  l.wake()
  l.wake() // a second wake while running starts nothing
  expect(l.isRunning).toBe(true)
  for (let i = 0; i < 4; i++) { fn!(); await Promise.resolve(); await Promise.resolve() }
  expect(blits).toEqual(['f0', 'f1', 'f2'])
  expect(l.isRunning).toBe(false)
  expect(cancelled).toBe(1)
  deny = true
  l.wake()
  fn!(); await Promise.resolve(); await Promise.resolve()
  expect(l.isRunning).toBe(false)
})

test('motion: what moved keeps the instant it changed; begin is delay − age; a settled change writes no animation', async () => {
  let m = move(undefined, 'pending', 1000)
  expect(ageOf(m, 5000)).toBe(Infinity) // the first value is not a change
  m = move(m, 'running', 2000)
  expect(m).toEqual({ from: 'pending', to: 'running', at: 2000 })
  expect(move(m, 'running', 2100)).toBe(m)
  expect(ageOf(m, 2100)).toBe(100)
  expect(beginAt(100)).toBe('-0.100s')
  expect(beginAt(100, 120)).toBe('0.020s')
  expect(isMoving(100, MS.slow)).toBe(true)
  expect(isMoving(500, MS.slow)).toBe(false)
  const b = { x: 10, y: 10, w: 100, h: 40 }
  expect(halo(b, 100, { cls: 'halo ok' })).toMatch(/class="halo ok".*attributeName="width" from="100" to="118" begin="-0.100s" dur="420ms"/)
  expect(halo(b, 900)).toBe('')
  expect(drawOn('M0 0H10', 0)).toMatch(/pathLength="1".*stroke-dashoffset" from="1" to="0" begin="0.000s"/)
  expect(drawOn('M0 0H10', 900)).toBe('<path class="draw" d="M0 0H10" fill="none"/>')
  expect(comet('M0 0H10').match(/<animateMotion/g)?.length).toBe(3)
})

test('surface: one table per surface, narrowed; zoom by body width; a docked pane is a sidebar, an unknown layout is unknown', async ($, on) => {
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const t = table(e, $.ui.resolve(e))
    if (t.surface === 'terminal') {
      const g = grid(4, 1)
      put(g, 0, 0, '▰▰▱▱', 0x7aa2f7)
      return t.el.Raster({ key: 'kit-r', columns: 4, rows: 1, cells: pack(g) })
    }
    if (t.surface === 'vscode') return t.el.Text({ children: 'vscode' })
    return t.el.Svg({ alt: 'kit', isInteractive: true, source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 60">${halo({ x: 10, y: 10, w: 100, h: 40 }, 0)}${drawOn('M0 0H10', 0)}</svg>` })
  })
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'kit', requestId: 'kit-test', surface, component: 'Pane', props: { title: 'kit', isFocused: false, bodyColumns: 80, placement: 'inline' } as never, viewport: { columns: 80, rows: 24 } as never })
    expect(await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).toBeDefined()
  }
  expect([zoomOf(40), zoomOf(60), zoomOf(109), zoomOf(110)]).toEqual(['compact', 'cards', 'cards', 'wide'])
  expect(isSidePane({ component: 'Pane', props: { placement: 'dock' } })).toBe(true)
  expect(isSidePane({ component: 'Pane', props: { placement: 'inline' }, viewport: { isFullscreen: true } })).toBe(false)
  expect(isSidePane({ component: 'AbovePrompt', viewport: { isFullscreen: true } })).toBe(true)
  expect(isSidePane({ component: 'AbovePrompt', viewport: { columns: 80 } as never })).toBeUndefined()
  expect(isSidePane({ component: 'AbovePrompt' })).toBeUndefined()
})

// Types only, never run: a mod's own wiring of the loop. The host scans each hooks module for the $ calls it
// spells and refuses one it does not list, so the mod writes them as arrows in its register.tsx.
export const wire = ($: EngineInterface, requestId: string, key: string, frame: (n: number) => string | null) =>
  loop({ every: (ms, f) => $.clock.every(ms, f), blit: a => $.ui.blit(a), requestId, key, frame })
