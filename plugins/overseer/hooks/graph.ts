// The board's plan as a dependency graph, the lab's engine: lots in columns by dependency depth, one lane
// per session, edges taken / live / future, a check drawn and a ripple when a lot changes, the edges out of a
// lot drawn when it finishes, and a camera on the running lots. Svg on the desktop, mobile and vscode
// (SMIL does the motion), a Raster on the terminal (painted from the state and the tick).
// Pure: no $, no clock; the pane hands in `now`, the tick and what moved (kept in an atom by register.tsx).
import { LANES, PALETTE } from './band.tsx'
import { ageOf as ageIn, beginAt, comet, drawOn, EASE, halo, isMoving, move, MS, spline } from './kit/motion.ts'
import { grid, mix, pack, perimeter, put, rgb, tint } from './kit/cells.ts'
import type { Grid } from './kit/cells.ts'
import type { Board } from './board.ts'
import type { Motion, Moved } from '../types'

type GLot = Board['lots'][number]
export type Node = { n: number; title: string; status: string; session?: string; model?: string; note?: string; col: number; lane: number; row: number }
export type Edge = { from: number; to: number; kind: 'future' | 'taken' | 'live' }
export type Layout = { nodes: Node[]; edges: Edge[]; lanes: { session?: string; rows: number }[]; cols: number }

// Columns by the longest chain of dependencies; a dependency on an unknown lot is ignored and a cycle
// (a hand-edited plan) is cut where it closes. Lanes: one per session holding lots, ordered by their
// smallest lot so they never reshuffle between redraws, then the lots nobody holds yet.
export function layout(lots: GLot[]): Layout {
  const by = new Map(lots.map(l => [l.n, l]))
  const depth = new Map<number, number>()
  const visiting = new Set<number>()
  const depthOf = (n: number): number => {
    if (depth.has(n)) return depth.get(n)!
    if (visiting.has(n)) return 0
    visiting.add(n)
    const d = Math.max(-1, ...(by.get(n)?.depends ?? []).filter(x => by.has(x) && x !== n).map(depthOf)) + 1
    visiting.delete(n)
    depth.set(n, d)
    return d
  }
  const sessions = [...new Set([...lots].sort((a, b) => a.n - b.n).map(l => l.session).filter((s): s is string => !!s))]
  const laneOf = (l: GLot) => (l.session ? sessions.indexOf(l.session) : sessions.length)
  const stacks = new Map<string, number>()
  const nodes: Node[] = [...lots].sort((a, b) => depthOf(a.n) - depthOf(b.n) || a.n - b.n).map(l => {
    const col = depthOf(l.n), lane = laneOf(l), k = `${lane}:${col}`
    const row = stacks.get(k) ?? 0
    stacks.set(k, row + 1)
    return { n: l.n, title: l.title, status: l.status, session: l.session, model: l.model, note: l.note, col, lane, row }
  })
  const hasFree = lots.some(l => !l.session)
  const lanes = [...sessions.map(s => ({ session: s as string | undefined, rows: 1 })), ...(hasFree ? [{ session: undefined, rows: 1 }] : [])]
  for (const [k, n] of stacks) { const lane = Number(k.split(':')[0]); lanes[lane]!.rows = Math.max(lanes[lane]!.rows, n) }
  const status = (n: number) => by.get(n)?.status
  const edges: Edge[] = lots.flatMap(l => l.depends.filter(d => by.has(d) && depthOf(d) < depthOf(l.n)).map(d => ({
    from: d, to: l.n, kind: status(d) === 'done' ? (l.status === 'running' ? 'live' as const : 'taken' as const) : 'future' as const,
  })))
  return { nodes, edges, lanes, cols: Math.max(0, ...nodes.map(x => x.col)) + 1 }
}

// The lots the camera frames: the running ones, else the ready ones, else all of them.
export function focusLots(L: Layout): Node[] {
  const running = L.nodes.filter(x => x.status === 'running')
  if (running.length) return running
  const done = new Set(L.nodes.filter(x => x.status === 'done').map(x => x.n))
  const ready = L.nodes.filter(x => x.status === 'todo' && L.edges.filter(e => e.to === x.n).every(e => done.has(e.from)))
  return ready.length ? ready : L.nodes
}

// What moved since the last look: each lot's status, and the camera. Unchanged values keep their instant.
export function step(m: Motion | null, L: Layout, now: number): Motion {
  const lots: Record<string, Moved<string>> = {}
  for (const x of L.nodes) lots[x.n] = move(m?.lots[x.n], x.status, now)
  return { lots, camera: move(m?.camera, camera(L), now) }
}

// ---------------------------------------------------------------- desktop: Svg

const G = { label: 104, w: 172, h: 54, gap: 56, rowH: 72, pad: 10, camCols: 3 }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const STATUS_COLOR: Record<string, string> = { todo: PALETTE.muted, running: PALETTE.warn, done: PALETTE.ok, blocked: PALETTE.alert }

function geometry(L: Layout) {
  const laneTop: number[] = []
  let y = 8
  for (const lane of L.lanes) { laneTop.push(y); y += lane.rows * G.rowH - (G.rowH - G.h) + 2 * G.pad }
  const W = G.label + L.cols * (G.w + G.gap) - G.gap + 16
  const at = (x: Node) => ({ x: G.label + x.col * (G.w + G.gap), y: laneTop[x.lane]! + G.pad + x.row * G.rowH })
  return { laneTop, W, H: y + 8, at }
}

// The camera: a window `cols` columns wide (the whole graph when it is narrower), panned onto the focus lots.
// The pane's room picks `cols` (camColsFor), so a phone shows one column at full size, not three at half.
// No cap at 3: the Svg draws at its markup's own width (the `width` prop sizes the frame, not the drawing), so the
// camera is as wide as the pane's room and the cards keep their size.
export const camColsFor = (bodyColumns: number) => Math.max(1, Math.floor((bodyColumns * 8 - G.label) / (G.w + G.gap)))
export function camera(L: Layout, cols: number = G.camCols): string {
  const g = geometry(L)
  const camW = Math.min(g.W, G.label + cols * (G.w + G.gap))
  const xs = focusLots(L).map(x => g.at(x).x)
  const mid = xs.length ? (Math.min(...xs) + Math.max(...xs) + G.w) / 2 : g.W / 2
  const colW = G.w + G.gap // on whole columns, so no card sits half under the lane names
  const x0 = Math.max(0, Math.min(g.W - camW, Math.round((mid - camW / 2) / colW) * colW))
  return `${x0} 0 ${camW} ${g.H}`
}

// Orthogonal edges: along, then down or up in the gap before the target. One that skips a column would
// run under the cards between, so it drops to the gutter under its source's row and runs there.
const edgePath = (a: { x: number; y: number }, b: { x: number; y: number }, skips: boolean) => {
  const [x1, y1, x2, y2] = [a.x + G.w, a.y + G.h / 2, b.x, b.y + G.h / 2]
  if (skips) return `M${x1} ${y1}H${x1 + G.gap / 2}V${a.y + G.h + (G.rowH - G.h) / 2}H${x2 - G.gap / 2}V${y2}H${x2 - 4}`
  return y1 === y2 ? `M${x1} ${y1}H${x2 - 4}` : `M${x1} ${y1}H${x2 - G.gap / 2}V${y2}H${x2 - 4}`
}

// `focus`: the lot the next action is about (focusOf), ringed by a slow pulse until it is dealt with.
export function graphSvg(L: Layout, m: Motion | null, now: number, label: (session?: string) => string, focus?: number, cols: number = G.camCols): string {
  const g = geometry(L)
  const by = new Map(L.nodes.map(x => [x.n, x]))
  const age = (n: number) => ageIn(m?.lots[n], now)
  const style = `<style>text{font:11px ui-sans-serif,system-ui,sans-serif;fill:#d6dae0}.ph{font:600 9.5px ui-monospace,monospace;fill:${PALETTE.muted};letter-spacing:.06em}.lb{font-size:12.5px;font-weight:600}.ms{fill:${PALETTE.muted}}`
    + `.card{fill:#161920;stroke-width:1.5}.e{fill:none;stroke-width:1.6}.e.future{stroke:#3e4451;stroke-dasharray:3 4}.e.taken{stroke:${PALETTE.muted}}.e.live{stroke:${PALETTE.accent};stroke-dasharray:5 4}`
    + `.draw{fill:none;stroke-width:2.2;stroke-linecap:round;stroke:${PALETTE.accent}}.tok{fill:${PALETTE.accent}}.halo{fill:none;stroke-width:2}`
    + Object.entries(STATUS_COLOR).map(([s, c]) => `.st-${s} .card{stroke:${c}}.halo.st-${s}{stroke:${c}}.ic-${s}{fill:${c}}`).join('')
    + `.chk{fill:none;stroke:#161920;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.ring{fill:none;stroke:${PALETTE.warn};stroke-width:1.5}.wait{fill:none;stroke:${PALETTE.muted};stroke-width:1.4}`
    + `.n{cursor:default}.e,.n,.tokg{transition:opacity ${MS.fast}ms}`
    + L.nodes.map(x => `svg:has(.n-${x.n}:hover) .e:not(.f-${x.n}):not(.t-${x.n}),svg:has(.n-${x.n}:hover) .tokg:not(.f-${x.n}):not(.t-${x.n}){opacity:.12}svg:has(.n-${x.n}:hover) .n:not(.n-${x.n}):not(.adj-${x.n}){opacity:.35}`).join('')
    + `@media (prefers-reduced-motion:reduce){animate,animateMotion{display:none}}</style>`
  const target = camera(L, cols), [camX, , camW, camH] = target.split(' ').map(Number) as [number, number, number, number]
  const laneRect = (i: number) => ({ y: g.laneTop[i]!, h: (g.laneTop[i + 1] ?? g.H - 8) - g.laneTop[i]! - 2 })
  const lanes = L.lanes.map((_, i) => `<rect x="0" y="${laneRect(i).y}" width="${g.W}" height="${laneRect(i).h}" rx="8" fill="${i % 2 ? '#12151a' : '#14171c'}"/>`).join('')
  // The lane names ride the camera's left edge, over what it pans past (a sticky column).
  const names = L.lanes.map((lane, i) => {
    const { y, h } = laneRect(i), c = lane.session ? LANES[i % LANES.length]! : PALETTE.muted
    return `<rect x="${camX}" y="${y}" width="${G.label - 8}" height="${h}" rx="8" fill="${i % 2 ? '#12151a' : '#14171c'}" opacity="${camX ? 0.94 : 1}"/><rect x="${camX}" y="${y}" width="3" height="${h}" rx="1.5" fill="${c}"/>`
      + `<text x="${camX + 12}" y="${y + 20}" class="lb" style="fill:${c}">${esc(cut(lane.session ? label(lane.session) : 'no session', 12))}</text>`
  }).join('')
  // Loops start at 0 in every frame: a begin taken from `now` made each redraw a new source, and a new source
  // recreates the frame (the desktop flickered at every redraw). Only a change in motion may change the source.
  const phase = 0
  const edges = L.edges.map(e => {
    const a = by.get(e.from)!, b = by.get(e.to)!, d = edgePath(g.at(a), g.at(b), b.col - a.col > 1), cls = `f-${e.from} t-${e.to}`
    const justDone = m?.lots[e.from]?.to === 'done' && isMoving(age(e.from), MS.slow, MS.fast)
    const draw = justDone && e.kind !== 'future' ? drawOn(d, age(e.from), { cls: `draw ${cls}`, delay: MS.fast }) : ''
    const flow = e.kind === 'live' ? `<animate attributeName="stroke-dashoffset" from="18" to="0" dur="700ms" begin="0s" repeatCount="indefinite"/>` : ''
    const toks = e.kind === 'live' ? `<g class="tokg ${cls}">${comet(d, { phase })}${comet(d, { phase: phase - 550 })}</g>` : ''
    return `<path class="e ${e.kind} ${cls}" d="${d}">${flow}</path>${draw}${toks}`
  }).join('')
  const cards = L.nodes.map(x => {
    const { x: cx, y: cy } = g.at(x), a = age(x.n), moved = m?.lots[x.n]
    const adj = L.edges.filter(e => e.from === x.n || e.to === x.n).map(e => `adj-${e.from === x.n ? e.to : e.from}`).join(' ')
    const ix = cx + 16, iy = cy + 31
    const icon = x.status === 'done'
      ? `<circle class="ic-done" cx="${ix}" cy="${iy}" r="6"/>${drawOn(`M${ix - 3} ${iy}l2.2 2.3l4-4.6`, moved?.to === 'done' ? a : Infinity, { cls: 'chk', dur: MS.base, delay: 80 })}`
      : x.status === 'running'
      ? `<circle class="ic-running" cx="${ix}" cy="${iy}" r="4"/><circle class="ring" cx="${ix}" cy="${iy}" r="4"><animate attributeName="r" values="4;9" dur="1200ms" begin="0s" repeatCount="indefinite"/><animate attributeName="opacity" values=".7;0" dur="1200ms" begin="0s" repeatCount="indefinite"/></circle>`
      : x.status === 'blocked'
      ? `<circle class="ic-blocked" cx="${ix}" cy="${iy}" r="6"/><text x="${ix}" y="${iy + 4}" text-anchor="middle" style="fill:#161920;font-weight:700">!</text>`
      : `<circle class="wait" cx="${ix}" cy="${iy}" r="5"/>`
    const ripple = moved && moved.from !== moved.to ? halo({ x: cx, y: cy, w: G.w, h: G.h }, a, { cls: `halo st-${x.status}` }) : ''
    const lift = moved && moved.from !== moved.to && isMoving(a, MS.slow) ? `<animateTransform attributeName="transform" type="translate" from="0 6" to="0 0" begin="${beginAt(a)}" dur="${MS.slow}ms" ${spline(EASE.emph)} fill="freeze"/>` : ''
    const sub = [x.model, x.note].filter(Boolean).join(' · ')
    const ring = x.n === focus
      ? `<rect class="focus" x="${cx - 3}" y="${cy - 3}" width="${G.w + 6}" height="${G.h + 6}" rx="12" fill="none" stroke="${PALETTE.alert}" stroke-width="2"><animate attributeName="opacity" values=".9;.25;.9" dur="1600ms" begin="0s" repeatCount="indefinite"/></rect>` : ''
    return `<g class="n n-${x.n} st-${x.status} ${adj}"><title>${esc(`${x.n}. ${x.title}${x.session ? ` · ${label(x.session)}` : ''}${x.note ? `\n${x.note}` : ''}`)}</title>${ring}${ripple}<g>${lift}`
      + `<rect class="card" x="${cx}" y="${cy}" width="${G.w}" height="${G.h}" rx="10"/>`
      + `<text class="ph" x="${cx + 10}" y="${cy + 15}">TASK ${x.n} · ${x.status.toUpperCase()}</text>${icon}`
      + `<text class="lb" x="${cx + 28}" y="${cy + 35}">${esc(cut(x.title, 18))}</text>`
      + (sub ? `<text class="ms" x="${cx + 10}" y="${cy + 49}">${esc(cut(sub, 28))}</text>` : '') + '</g></g>'
  }).join('')
  const cam = m?.camera
  const pan = cam && cam.from !== cam.to && cam.to === target && isMoving(ageIn(cam, now), MS.camera) // what moved is the 3-column camera
    ? `<animate attributeName="viewBox" from="${cam.from}" to="${cam.to}" begin="${beginAt(ageIn(cam, now))}" dur="${MS.camera}ms" ${spline(EASE.camera)} fill="freeze"/>` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${target}" width="${camW}" height="${camH}" role="img">${pan}${style}${lanes}${edges}${cards}${names}</svg>`
  // ponytail: a plan big enough to pass the Svg cap (131072 chars) loses its motion first, then its hover rules.
  return svg.length <= 131072 ? svg : svg.replace(/<animate[^>]*\/>|<animateMotion[^>]*\/>/g, '').replace(/svg:has\([^}]*\}/g, '')
}

// The budget spent over the run, against half (models step down) and the whole (no new lot).
export function budgetSvg(b: NonNullable<Board['budget']>, now: number): string {
  const W = 360, H = 64, pad = 6
  const pts = [...(b.series ?? [])]
  if (!pts.length || pts.at(-1)!.at < now) pts.push({ at: now, spent: b.spent })
  const t0 = pts[0]!.at, t1 = Math.max(now, t0 + 1)
  const top = Math.max(b.budget, ...pts.map(p => p.spent)) * 1.35 || 1 // room above the budget line for its label
  const x = (t: number) => (pad + ((t - t0) / (t1 - t0)) * (W - 2 * pad)).toFixed(1)
  const y = (v: number) => (H - pad - (Math.max(0, v) / top) * (H - 2 * pad)).toFixed(1)
  const line = pts.map(p => `${x(p.at)},${y(p.spent)}`).join(' ')
  const c = b.level === 'stop' ? PALETTE.alert : b.level === 'reduce' ? PALETTE.warn : PALETTE.ok
  const last = pts.at(-1)!
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"><style>text{font:10px ui-monospace,monospace;fill:${PALETTE.muted}}</style>`
    + `<line x1="${pad}" x2="${W - pad}" y1="${y(b.budget)}" y2="${y(b.budget)}" stroke="${PALETTE.alert}" stroke-width="1"/><text x="${W - pad}" y="${Number(y(b.budget)) - 3}" text-anchor="end">budget ${b.budget}</text>`
    + `<line x1="${pad}" x2="${W - pad}" y1="${y(b.budget / 2)}" y2="${y(b.budget / 2)}" stroke="${PALETTE.warn}" stroke-dasharray="3 3" stroke-width="1"/><text x="${W - pad}" y="${Number(y(b.budget / 2)) - 3}" text-anchor="end">half</text>`
    + `<polygon points="${x(t0)},${y(0)} ${line} ${x(last.at)},${y(0)}" fill="${c}" opacity=".14"/><polyline points="${line}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`
    + `<circle cx="${x(last.at)}" cy="${y(last.spent)}" r="3" fill="${c}"/><text x="${pad}" y="12">${b.spent.toFixed(1)} pts spent</text></svg>`
}

// ---------------------------------------------------------------- terminal: Raster

const T = { label: 11, w: 20, h: 3, gap: 4, rowH: 4 }
const C = { muted: rgb(PALETTE.muted), dim: rgb('#3e4451'), accent: rgb(PALETTE.accent), white: 0xffffff, fg: rgb('#d6dae0') }
const GLYPH: Record<string, string> = { todo: '○', done: '✓', blocked: '!' }
const SPIN = ['◐', '◓', '◑', '◒']

// The graph in cells, `columns` wide: cards in lanes, box-drawing edges, the running cards' borders run by a
// glint, a finished lot's card flashing and its edges drawn a few cells per second. Wider than the room, the
// window pans onto the focus lots (the terminal's camera).
export function graphRaster(L: Layout, m: Motion | null, now: number, tick: number, columns: number, label: (session?: string) => string, focus?: number): { columns: number; rows: number; cells: string } {
  const laneTop: number[] = []
  let y = 0
  for (const lane of L.lanes) { laneTop.push(y); y += lane.rows * T.rowH }
  const fullW = T.label + L.cols * (T.w + T.gap) - T.gap
  const rows = Math.max(1, Math.min(256, y - 1))
  const g = grid(Math.min(512, fullW), rows)
  const at = (x: Node) => ({ x: T.label + x.col * (T.w + T.gap), y: laneTop[x.lane]! + x.row * T.rowH })
  const by = new Map(L.nodes.map(x => [x.n, x]))
  const age = (n: number) => ageIn(m?.lots[n], now)
  for (let i = 1; i < L.lanes.length; i++) for (let x = 0; x < g.columns; x++) put(g, x, laneTop[i]! - 1, '┄', C.dim)
  // Edges as connection bits (N 1, E 2, S 4, W 8) merged per cell, so edges sharing a channel join (├ ┬ ┼);
  // a cell takes the strongest kind through it. A finished lot's edges are drawn two cells a second.
  const bits = new Map<number, { b: number; rank: number; color: number }>()
  const RANK = { future: 0, taken: 1, live: 2 }
  const arrows: [number, number, number][] = []
  for (const e of L.edges) {
    const na = by.get(e.from)!, nb = by.get(e.to)!, a = at(na), b = at(nb)
    const path = edgeBits(a.x + T.w, a.y + 1, b.x - 1, b.y + 1, nb.col - na.col > 1 ? a.y + T.h : undefined)
    const color = e.kind === 'live' ? C.accent : e.kind === 'taken' ? C.muted : C.dim
    const justDone = m?.lots[e.from]?.to === 'done' ? age(e.from) : Infinity
    const shown = justDone < Infinity ? Math.floor(justDone / 500) * 2 + 2 : path.length
    path.forEach(([x, y, d], i) => {
      const k = y * g.columns + x, cur = bits.get(k), drawn = i < shown, rank = drawn ? RANK[e.kind] : -1
      bits.set(k, { b: (cur?.b ?? 0) | d, rank: Math.max(cur?.rank ?? -1, rank), color: !cur || rank > cur.rank ? (drawn ? color : C.dim) : cur.color })
    })
    arrows.push([b.x - 1, b.y + 1, shown >= path.length ? color : C.dim])
  }
  for (const [k, v] of bits) put(g, k % g.columns, Math.floor(k / g.columns), LINE[v.b] ?? '┼', v.color)
  for (const [x, y, c] of arrows) put(g, x, y, '▶', c)
  for (const x of L.nodes) {
    const p = at(x), c = rgb(STATUS_COLOR[x.status] ?? PALETTE.muted), a = age(x.n)
    const flash = m?.lots[x.n] && m.lots[x.n]!.from !== x.status && a < 3000 // three frames at the 1 s tick
    const ring = x.n === focus ? (tick % 2 ? rgb(PALETTE.alert) : mix(rgb(PALETTE.alert), C.white, 0.4)) : undefined // the next action's lot blinks
    box(g, p.x, p.y, T.w, T.h, ring ?? (flash ? mix(c, C.white, 0.5) : c))
    put(g, p.x + 1, p.y + 1, ' '.repeat(T.w - 2))
    const glyph = x.status === 'running' ? SPIN[tick % SPIN.length]! : GLYPH[x.status] ?? '·'
    put(g, p.x + 1, p.y + 1, glyph, c)
    put(g, p.x + 3, p.y + 1, cut(`${x.n} ${x.title}`, T.w - 4), x.status === 'done' ? C.muted : C.fg)
    if (x.status === 'running') {
      const per = perimeter(p.x, p.y, T.w, T.h), h = tick % per.length
      ;[[0, 1], [1, 0.6], [2, 0.3]].forEach(([d, k]) => { const q = per[(h - d! + per.length) % per.length]!; tint(g, q[0], q[1], mix(c, C.white, k!)) })
    }
  }
  L.lanes.forEach((lane, i) => put(g, 0, laneTop[i]! + 1, cut(lane.session ? label(lane.session) : 'no session', T.label - 2), lane.session ? rgb(LANES[i % LANES.length]!) : C.muted))
  if (g.columns <= columns) return { columns: g.columns, rows: g.rows, cells: pack(g) }
  // Wider than the room: the lane names stay, and the cards' part pans onto the focus lots, on whole columns.
  const room = columns - T.label, colW = T.w + T.gap
  const xs = focusLots(L).map(x => at(x).x - T.label)
  const mid = xs.length ? (Math.min(...xs) + Math.max(...xs) + T.w) / 2 : (g.columns - T.label) / 2
  const x0 = Math.max(0, Math.min(g.columns - T.label - room, Math.round((mid - room / 2) / colW) * colW))
  const out = grid(columns, g.rows)
  copy(g, 0, T.label, out, 0)
  copy(g, T.label + x0, room, out, T.label)
  return { columns, rows: out.rows, cells: pack(out) }
}

export const LINE: Record<number, string> = { 5: '│', 10: '─', 6: '╭', 12: '╮', 3: '╰', 9: '╯', 7: '├', 13: '┤', 14: '┬', 11: '┴', 15: '┼', 1: '│', 4: '│', 2: '─', 8: '─' }

// Under 60 columns: one row per lot in dependency order, indented by depth, its session at the right.
export function compactRaster(L: Layout, tick: number, columns: number, label: (session?: string) => string): { columns: number; rows: number; cells: string } {
  const g = grid(columns, Math.max(1, L.nodes.length))
  const nodes = [...L.nodes].sort((a, b) => a.col - b.col || a.n - b.n)
  nodes.forEach((x, i) => {
    const c = rgb(STATUS_COLOR[x.status] ?? PALETTE.muted)
    const ind = Math.min(x.col, 4) * 2
    const who = x.session ? cut(label(x.session), 12) : ''
    put(g, ind, i, x.status === 'running' ? SPIN[tick % SPIN.length]! : GLYPH[x.status] ?? '·', c)
    put(g, ind + 2, i, cut(`${x.n} ${x.title}`, Math.max(4, columns - ind - 3 - (who ? who.length + 1 : 0))), x.status === 'done' ? C.muted : C.fg)
    if (who) put(g, columns - who.length, i, who, rgb(LANES[x.lane % LANES.length]!))
  })
  return { columns: g.columns, rows: g.rows, cells: pack(g) }
}

function box(g: Grid, x: number, y: number, w: number, h: number, c: number) {
  put(g, x, y, `╭${'─'.repeat(w - 2)}╮`, c)
  for (let j = 1; j < h - 1; j++) { put(g, x, y + j, '│', c); put(g, x + w - 1, y + j, '│', c) }
  put(g, x, y + h - 1, `╰${'─'.repeat(w - 2)}╯`, c)
}

// An orthogonal edge from (x1, y1) to just before (x2, y2), cell by cell with the directions each cell joins
// (N 1, E 2, S 4, W 8): along, down or up two cells before the target, along. With `gutter`, the row under
// its source's cards, it first steps into that row (an edge that skips a column must not cross the cards between).
export function edgeBits(x1: number, y1: number, x2: number, y2: number, gutter?: number): [number, number, number][] {
  const xm = Math.max(x1, x2 - 2)
  const pts: [number, number][] = gutter !== undefined ? [[x1, y1], [x1 + 1, y1], [x1 + 1, gutter], [xm, gutter], [xm, y2], [x2 - 1, y2]]
    : y1 === y2 ? [[x1, y1], [x2 - 1, y1]] : [[x1, y1], [xm, y1], [xm, y2], [x2 - 1, y2]]
  const cells = new Map<string, [number, number, number]>() // in path order, which the draw-on follows
  const add = (x: number, y: number, d: number) => { const c = cells.get(`${x},${y}`); if (c) c[2] |= d; else cells.set(`${x},${y}`, [x, y, d]) }
  add(x1, y1, 8) // out of the card
  for (let i = 0; i < pts.length - 1; i++) {
    let [x, y] = pts[i]!
    const [tx, ty] = pts[i + 1]!
    while (x !== tx || y !== ty) {
      const dx = Math.sign(tx - x), dy = Math.sign(ty - y)
      add(x, y, dx > 0 ? 2 : dx < 0 ? 8 : dy > 0 ? 4 : 1)
      x += dx; y += dy
      add(x, y, dx > 0 ? 8 : dx < 0 ? 2 : dy > 0 ? 1 : 4)
    }
  }
  add(x2 - 1, y2, 2) // into the arrow
  return [...cells.values()]
}

function copy(src: Grid, sx: number, w: number, dst: Grid, dx: number) {
  for (let y = 0; y < src.rows; y++) dst.data.set(src.data.subarray((y * src.columns + sx) * 3, (y * src.columns + sx + w) * 3), (y * dst.columns + dx) * 3)
}

// The budget's curve in a line of text for the terminal: one block per point, the last `width` points.
export function sparkline(series: { spent: number }[], budget: number, width = 24): string {
  const pts = series.slice(-width)
  const top = Math.max(budget, ...pts.map(p => p.spent)) || 1
  return pts.map(p => '▁▂▃▄▅▆▇█'[Math.max(0, Math.min(7, Math.round((p.spent / top) * 7)))]).join('')
}
