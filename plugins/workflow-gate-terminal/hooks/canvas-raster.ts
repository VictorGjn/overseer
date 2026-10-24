// The terminal's flowchart as a Raster: canvas.tsx's paint() (the same cards, edges, junctions, model
// pills and progress bars the Client drew) turned into cells, windowed on the card to follow, and in Live
// animated by $.ui.blit: particles along the edges into a running card, a glint round the running card's
// border, a pip per fan-out worker, the critical path in amber. Under 60 columns, one row per card.
// Pure: no $, no clock. register.tsx keeps the scene and the blit loop (kit/cells' loop).
import { paint, viewLeft, viewTop } from './canvas.tsx'
import type { Live } from './canvas.tsx'
import type { Worker } from './canvas-svg.ts'
import type { Edge, Geometry } from './layout.ts'
import { DEFAULT, grid, mix, pack, perimeter, put, rgb, tint } from './kit/cells.ts'
import type { Grid } from './kit/cells.ts'

export type Pan = { left: number; top: number; manualAt?: number } // the person's pan; following resumes 15 s after
type Pip = { x: number; y: number; w: Worker }
export type Scene = { base: Grid; left: number; top: number; particles: [number, number][][]; glints: [number, number][][]; pips: Pip[]; isMoving: boolean }

const WHITE = 0xffffff, SLATE = 0x5c6370
const C = { warn: rgb('#e5c07b'), ok: rgb('#98c379'), fail: rgb('#e06c75'), flow: rgb('#56b6c2') }
export const MAX = { columns: 512, rows: 256 } // a Raster's own limits

// Every cell an edge passes through, in order, as paint() walks it.
export function edgeCells(e: Pick<Edge, 'pts'>): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < e.pts.length - 1; i++) {
    let [x, y] = e.pts[i]!
    const [tx, ty] = e.pts[i + 1]!
    if (i === 0) out.push([x, y])
    while (x !== tx || y !== ty) { x += Math.sign(tx - x); y += Math.sign(ty - y); out.push([x, y]) }
  }
  return out
}

// The longest chain of cards not yet done, from the running ones (else from start) to end: what decides
// when the run ends. Weighted by each card's typical requests from past runs where known, else one each.
export function criticalPath(geo: Geometry, live: Record<string, Live>, weight: (id: string) => number = () => 1): Set<string> {
  const out = new Map<string, Edge[]>()
  for (const e of geo.edges) if (e.arrow === 'down') out.set(e.from, [...(out.get(e.from) ?? []), e])
  const open = (id: string) => live[id]?.state !== 'done'
  const memo = new Map<string, { d: number; via?: Edge }>()
  const visiting = new Set<string>()
  const dist = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!.d
    if (visiting.has(id)) return 0
    visiting.add(id)
    let best: { d: number; via?: Edge } = { d: 0 }
    for (const e of out.get(id) ?? []) if (open(e.to)) { const d = dist(e.to); if (d > best.d || !best.via) best = { d, via: e } }
    visiting.delete(id)
    const me = { d: best.d + (geo.cards.some(c => c.id === id && (c.kind === 'agent' || c.kind === 'workflow')) ? weight(id) : 0), via: best.via }
    memo.set(id, me)
    return me.d
  }
  const running = geo.cards.filter(c => live[c.id]?.state === 'running').map(c => c.id)
  const from = (running.length ? running : ['start']).map(id => ({ id, d: dist(id) })).sort((a, b) => b.d - a.d)[0]?.id
  const path = new Set<string>()
  for (let id = from, guard = 0; id && guard < geo.cards.length + 2; guard++) {
    const via = memo.get(id)?.via
    if (!via) break
    path.add(via.id)
    id = via.to
  }
  return path
}

// One render's scene: the window's cells and what moves on them.
export function scene(o: {
  geo: Geometry; live?: Record<string, Live>; selected?: string; warn?: Record<string, { n: number; text: string }>; follow?: string
  workers?: Record<string, Worker[]>; critical?: Set<string>; columns: number; rows: number; pan?: Pan | null; now: number
}): Scene {
  const live = o.live ?? {}
  const props = { geo: o.geo, live, selected: o.selected, warn: o.warn, follow: o.follow }
  const w = Math.max(1, Math.min(MAX.columns, o.columns, o.geo.width + 1))
  const h = Math.max(1, Math.min(MAX.rows, o.rows, o.geo.height))
  const pan = o.pan ?? { left: 0, top: 0 }
  const top = viewTop(props, pan, h, o.now), left = viewLeft(props, pan, w, o.now)
  const base = grid(w, h)
  const at = (x: number, y: number): [number, number] | undefined => (x >= left && x < left + w && y >= top && y < top + h ? [x - left, y - top] : undefined)
  paint(props).slice(top, top + h).forEach((segs, row) => {
    let x = 0
    for (const s of segs) {
      let fg = s.c ? rgb(s.c) : DEFAULT
      if (s.b && fg !== DEFAULT) fg = mix(fg, WHITE, 0.25) // a Raster has no bold: brighter
      if (s.d && fg !== DEFAULT) fg = mix(fg, SLATE, 0.5) // nor dim: toward slate
      const bg = s.bg ? rgb(s.bg) : undefined
      // One cell per UTF-16 unit, as paint() lays them: an emoji's two halves become two '·', aligned.
      for (let i = 0; i < s.t.length; i++) if (x + i >= left && x + i < left + w) put(base, x + i - left, row, s.t[i]!, fg, bg)
      x += s.t.length
    }
  })
  for (const e of o.geo.edges) if (o.critical?.has(e.id)) for (const [x, y] of edgeCells(e)) { const p = at(x, y); if (p) tint(base, p[0], p[1], C.warn) }
  const isActive = (e: Edge) => live[e.to]?.state === 'running' && (live[e.from]?.state === 'done' || live[e.from]?.state === 'running' || e.from === 'start')
  const particles = o.geo.edges.filter(isActive).map(e => edgeCells(e).map(([x, y]) => at(x, y)).filter((p): p is [number, number] => !!p)).filter(p => p.length > 1)
  const glints: [number, number][][] = []
  const pips: Pip[] = []
  for (const c of o.geo.cards) {
    const cw = c.fan ? c.w - 1 : c.w, ch = c.fan ? c.h - 1 : c.h
    if (live[c.id]?.state === 'running' && c.kind !== 'start' && c.kind !== 'end') glints.push(perimeter(c.x, c.y, cw, ch).map(([x, y]) => at(x, y)).filter((p): p is [number, number] => !!p))
    ;(o.workers?.[c.id] ?? []).slice(0, Math.max(0, cw - 4)).forEach((wk, i) => { const p = at(c.x + 2 + i, c.y + ch - 1); if (p) pips.push({ x: p[0], y: p[1], w: wk }) })
  }
  return { base, left, top, particles, glints, pips, isMoving: particles.length > 0 || glints.some(g => g.length > 0) || pips.some(p => p.w === 'run') }
}

// Frame `n` of a scene: the base with the moving parts at their place for that frame.
export function frame(s: Scene, n: number): string {
  const g: Grid = { columns: s.base.columns, rows: s.base.rows, data: s.base.data.slice() }
  for (const path of s.particles) {
    const len = path.length + 4 // a short pause at the end of the edge before the next one
    ;[[0, 0.9], [1, 0.55], [2, 0.25]].forEach(([d, k]) => { const p = path[(n - d! + len * 4) % len]; if (p) tint(g, p[0], p[1], mix(C.flow, WHITE, k!)) })
  }
  for (const per of s.glints) {
    if (!per.length) continue
    ;[[0, 0.8], [1, 0.5], [2, 0.25]].forEach(([d, k]) => { const p = per[(n - d! + per.length * 4) % per.length]!; tint(g, p[0], p[1], mix(C.warn, WHITE, k!)) })
  }
  for (const p of s.pips) put(g, p.x, p.y, '■', p.w === 'ok' ? C.ok : p.w === 'fail' ? C.fail : p.w === 'run' ? (n % 4 < 2 ? C.warn : mix(C.warn, WHITE, 0.5)) : SLATE)
  return pack(g)
}

// Under 60 columns: one row per card in the order the run takes them, its state, label, model and workers.
export function compact(geo: Geometry, live: Record<string, Live> | undefined, workers: Record<string, Worker[]> | undefined, columns: number, models: Record<string, string>): { columns: number; rows: number; cells: string } {
  const cards = geo.cards.filter(c => c.kind !== 'start' && c.kind !== 'end').sort((a, b) => a.y - b.y || a.x - b.x)
  const g = grid(Math.max(10, Math.min(MAX.columns, columns)), Math.max(1, Math.min(MAX.rows, cards.length)))
  const STATE: Record<string, [string, number]> = { running: ['●', C.warn], done: ['✓', C.ok], failed: ['✗', C.fail], pending: ['○', SLATE] }
  cards.slice(0, MAX.rows).forEach((c, y) => {
    const [glyph, col] = c.kind === 'decision' || c.kind === 'loop' ? ['◆', C.warn] : STATE[live?.[c.id]?.state ?? ''] ?? ['▸', rgb(models[c.model ?? 'inherited'] ?? '#7f848e')]
    const model = c.kind === 'agent' || c.kind === 'workflow' ? (c.model ?? 'inherited') : ''
    const pips = (workers?.[c.id] ?? []).slice(0, 8)
    const room = g.columns - 3 - model.length - (pips.length ? pips.length + 1 : 0) - 1
    put(g, 0, y, glyph, col)
    put(g, 2, y, c.label.length > room ? `${c.label.slice(0, Math.max(1, room - 1))}…` : c.label, 0xe6e6e6)
    pips.forEach((w, i) => put(g, g.columns - model.length - 1 - pips.length + i, y, '■', w === 'ok' ? C.ok : w === 'fail' ? C.fail : w === 'run' ? C.warn : SLATE))
    if (model) put(g, g.columns - model.length, y, model, rgb(models[model] ?? '#7f848e'))
  })
  return { columns: g.columns, rows: g.rows, cells: pack(g) }
}
