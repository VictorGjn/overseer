// The flowchart canvas: a Client surface module, run on the drawing thread with its own pointer
// and keys. Paints the geometry layout.ts computed: model-coloured cards, orthogonal edges with
// real junctions, and in Live a progress bar on each card. Static: no frame clock.
// No imports: everything a surface module needs is here or in its props.
import type { ClientModule } from 'claude-code'

type Tone = 'flow' | 'yes' | 'no' | 'err' | 'back' | 'unknown'
type Card = { id: string; kind: string; x: number; y: number; w: number; h: number; label: string; model?: string; phase?: string; purpose?: string; fan?: string; guard?: string; effort?: string; isolation?: string; body?: { t: string; c?: string; b?: boolean }[] }
type Edge = { id: string; from: string; to: string; pts: [number, number][]; tone: Tone; label?: string; arrow: 'down' | 'left' }
export type Live = { state: 'pending' | 'running' | 'done' | 'failed'; note?: string; progress?: number; isEstimate?: boolean }
// A side card: the orchestrator beside (or under) the graph, its lines already wrapped to `w - 4`.
export type Side = { x: number; y: number; w: number; title: string; badge?: string; lines: ({ t: string } & Style)[] }
export type CanvasProps = { geo: { width: number; height: number; cards: Card[]; edges: Edge[] }; selected?: string; live?: Record<string, Live>; warn?: Record<string, { n: number; text: string }>; side?: Side; rows?: number; cols?: number; follow?: string; win?: { from: number; rows: number } }
type Style = { c?: string; bg?: string; b?: boolean; d?: boolean }
export type Seg = { t: string } & Style

export const MODEL_COLOR: Record<string, string> = { opus: '#c678dd', fable: '#e5c07b', sonnet: '#61afef', haiku: '#98c379', inherited: '#7f848e' }
const TONE_COLOR: Record<Tone, string> = { flow: '#7f848e', yes: '#98c379', no: '#e06c75', err: '#e06c75', back: '#d19a66', unknown: '#5c6370' }
const STATE_COLOR = { pending: '#5c6370', running: '#e5c07b', done: '#98c379', failed: '#e06c75' }
const N = 1, E = 2, S = 4, W = 8
const LIGHT: Record<number, string> = { [N | S]: '│', [E | W]: '─', [S | E]: '┌', [S | W]: '┐', [N | E]: '└', [N | W]: '┘', [N | S | E]: '├', [N | S | W]: '┤', [E | W | S]: '┬', [E | W | N]: '┴', 15: '┼', [N]: '│', [S]: '│', [E]: '─', [W]: '─' }

// ████████░░░░ 62%  — `~` when the fill is an estimate from past runs, not a fact.
export function bar(progress: number, width: number, isEstimate = false): string {
  const p = Math.max(0, Math.min(1, progress))
  const tail = ` ${isEstimate ? '~' : ''}${Math.round(p * 100)}%`
  const n = Math.max(1, width - tail.length)
  const full = Math.round(p * n)
  return '█'.repeat(full) + '░'.repeat(n - full) + tail
}

const fit = (s: string, n: number) => (n <= 0 ? '' : s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s.padEnd(n))

// Paints the whole drawing for one frame: rows of styled segments.
// The viewport, when the canvas knows it: a side card beside the graph (y 0) is pinned to it and
// shows `sideTop`..: its own scroll, independent of the graph's.
export type View = { top: number; rows: number; sideTop: number }

// Where the side card is drawn for this view, and which of its lines show.
export function sideBox(side: Side, view?: View): { y: number; h: number; first: number; inner: number; isPinned: boolean } {
  const isPinned = !!view && side.y === 0
  const full = side.lines.length + 2
  if (!isPinned) return { y: side.y, h: full, first: 0, inner: side.lines.length, isPinned }
  const h = Math.max(3, Math.min(full, view!.rows))
  const inner = h - 2
  const first = Math.max(0, Math.min(view!.sideTop, side.lines.length - inner))
  return { y: view!.top, h, first, inner, isPinned }
}

export function paint(p: CanvasProps, view?: View): Seg[][] {
  const { cards, edges } = p.geo
  const box = p.side ? sideBox(p.side, view) : null
  const width = Math.max(p.geo.width, p.side ? p.side.x + p.side.w + 1 : 0)
  const height = Math.max(p.geo.height, box ? box.y + box.h : 0)
  const ch: string[][] = Array.from({ length: height }, () => Array(width).fill(' '))
  const st: (Style | null)[][] = Array.from({ length: height }, () => Array(width).fill(null))
  const bits: number[][] = Array.from({ length: height }, () => Array(width).fill(0))
  const put = (x: number, y: number, t: string, s: Style | null) => {
    if (y < 0 || y >= height) return
    for (let i = 0; i < t.length; i++) if (x + i >= 0 && x + i < width) { ch[y]![x + i] = t[i]!; st[y]![x + i] = s }
  }
  const live = p.live ?? {}
  const isLive = Object.keys(live).length > 0
  const hot = (e: Edge) => !isLive || live[e.from]?.state === 'done' || live[e.from]?.state === 'running'
  const touches = (e: Edge) => e.from === p.selected || e.to === p.selected

  // Edges: direction bits per cell, so crossings and merges get real junction glyphs.
  const paths = edges.map(e => {
    const cells: [number, number][] = []
    for (let i = 0; i < e.pts.length - 1; i++) {
      let [x, y] = e.pts[i]!
      const [tx, ty] = e.pts[i + 1]!
      const dx = Math.sign(tx - x), dy = Math.sign(ty - y)
      if (i === 0 && y >= 0 && y < height) cells.push([x, y])
      while (x !== tx || y !== ty) {
        const a = dy > 0 ? S : dy < 0 ? N : dx > 0 ? E : W
        const b = dy > 0 ? N : dy < 0 ? S : dx > 0 ? W : E
        if (bits[y]?.[x] !== undefined) bits[y]![x]! |= a
        x += dx; y += dy
        if (bits[y]?.[x] !== undefined) bits[y]![x]! |= b
        cells.push([x, y])
      }
    }
    if (e.arrow === 'down' && cells.length && bits[cells[0]![1]]?.[cells[0]![0]] !== undefined) bits[cells[0]![1]]![cells[0]![0]]! |= N
    return { e, cells }
  })
  for (const { e, cells } of paths) {
    const color = isLive && !hot(e) ? '#3e4451' : TONE_COLOR[e.tone]
    for (const [x, y] of cells) put(x, y, LIGHT[bits[y]?.[x] ?? 0] ?? '·', { c: color, b: touches(e), d: !touches(e) && !!p.selected })
    const end = cells.at(-1)
    if (end) put(end[0], end[1], e.arrow === 'down' ? '▼' : '◀', { c: TONE_COLOR[e.tone], b: true })
    if (e.label && end && e.arrow === 'down') put(end[0] + 2, end[1], e.label, { c: TONE_COLOR[e.tone], b: true })
    if (e.arrow === 'left' && cells.length > 2) {
      const mid = cells[Math.floor(cells.length / 2)]!
      put(mid[0], mid[1], '↺', { c: TONE_COLOR.back, b: true })
    }
  }

  // Cards on top of the edges.
  for (const c of cards) {
    const sel = c.id === p.selected
    const lv = live[c.id]
    const tone = lv ? STATE_COLOR[lv.state] : c.kind === 'decision' || c.kind === 'loop' ? '#e5c07b' : MODEL_COLOR[c.model ?? 'inherited'] ?? '#7f848e'
    const border: Style = { c: sel ? '#ffffff' : tone, b: sel || lv?.state === 'running' }
    const [tl, tr, bl, br, hz, vt] = sel ? ['╔', '╗', '╚', '╝', '═', '║'] : c.kind === 'decision' || c.kind === 'loop' ? ['◇', '◇', '◇', '◇', '─', '│'] : ['╭', '╮', '╰', '╯', '─', '│']
    if (c.kind === 'start' || c.kind === 'end') {
      put(c.x, c.y, fit(` ${c.kind === 'start' ? '●' : '◉'} ${c.label}`, c.w), { c: '#abb2bf', b: true })
      continue
    }
    const w = c.fan ? c.w - 1 : c.w, h = c.fan ? c.h - 1 : c.h
    if (c.fan) { // a fan-out is a stack of cards
      put(c.x + 1, c.y + 1, ' '.repeat(w - 1) + '┐', { c: tone, d: true })
      for (let r = 2; r < h; r++) put(c.x + w, c.y + r, '│', { c: tone, d: true })
      put(c.x + 1, c.y + h, '└' + '─'.repeat(w - 2) + '┘', { c: tone, d: true })
    }
    const inner = w - 4
    const title = (c.kind === 'agent' || c.kind === 'workflow') && c.phase ? `${hz} ${c.phase.slice(0, w - 6)} ` : ''
    put(c.x, c.y, tl + title + hz.repeat(Math.max(0, w - 2 - title.length)) + tr, border)
    for (let r = 1; r < h - 1; r++) { put(c.x, c.y + r, vt + ' '.repeat(w - 2) + vt, border) }
    put(c.x, c.y + h - 1, bl + hz.repeat(w - 2) + br, border)
    const out = edges.some(e => e.from === c.id && e.arrow === 'down')
    if (out && !sel) put(c.x + Math.floor(w / 2), c.y + h - 1, '┬', border)
    const warn = p.warn?.[c.id]
    if (warn) put(c.x + w - 7, c.y, ` ⚠ ${Math.min(warn.n, 99)} `, { c: '#1e2127', bg: '#e5c07b', b: true })

    if (c.kind === 'decision' || c.kind === 'loop') {
      put(c.x + 2, c.y + 1, fit(`${c.kind === 'loop' ? '↻' : '◆'} ${c.label}`, inner), { c: "#e5c07b", b: true })
      continue
    }
    const icon = lv ? (lv.state === 'running' ? '●' : lv.state === 'done' ? '✓' : lv.state === 'failed' ? '✗' : '○') : '▸'
    const model = ` ${c.model ?? 'inherited'} `
    put(c.x + 2, c.y + 1, icon + ' ', { c: lv ? STATE_COLOR[lv.state] : tone, b: true })
    put(c.x + 4, c.y + 1, fit(c.label, inner - 2 - model.length - 1), { c: '#e6e6e6', b: true })
    put(c.x + w - 2 - model.length, c.y + 1, model, { c: '#1e2127', bg: MODEL_COLOR[c.model ?? 'inherited'] ?? '#7f848e', b: true })
    // An expanded card: its readable description, then the same two footer rows as a closed one.
    const body = c.body ?? []
    body.forEach((l, i) => put(c.x + 2, c.y + 2 + i, fit(l.t, inner), { c: l.c ?? '#e6e6e6', b: l.b }))
    const foot = c.y + 2 + Math.max(0, body.length - 1) + (body.length ? 1 : 0)
    if (lv) {
      put(c.x + 2, foot, fit(lv.note ?? '', inner), { c: '#9da5b4' })
      put(c.x + 2, foot + 1, bar(lv.progress ?? 0, inner, lv.isEstimate), { c: STATE_COLOR[lv.state], b: lv.state === 'running' })
      continue
    }
    if (!body.length) put(c.x + 2, foot, fit(c.purpose || '—', inner), { c: '#9da5b4', d: true })
    const meta = warn ? `⚠ ${warn.text}` : [c.fan, c.guard, c.effort && `effort ${c.effort}`, c.isolation].filter(Boolean).join(' · ')
    put(c.x + 2, foot + (body.length ? 0 : 1), fit(meta, inner), { c: warn || c.guard ? '#e5c07b' : '#7f848e' })
  }

  // The orchestrator card.
  if (p.side && box) {
    const { x, w, title, badge, lines } = p.side
    const { y, h, first, inner } = box
    const b: Style = { c: '#56b6c2', b: true }
    const head = `─ ${title} `
    put(x, y, '╭' + head + '─'.repeat(Math.max(0, w - 2 - head.length)) + '╮', b)
    if (badge) put(x + w - 2 - badge.length - 1, y, ` ${badge}`, { c: '#1e2127', bg: '#56b6c2', b: true })
    for (let i = 0; i < inner; i++) {
      put(x, y + 1 + i, '│' + ' '.repeat(w - 2) + '│', b)
      const l = lines[first + i]
      if (l) put(x + 2, y + 1 + i, fit(l.t, w - 4), { c: l.c, b: l.b, d: l.d, bg: l.bg })
    }
    put(x, y + h - 1, '╰' + '─'.repeat(w - 2) + '╯', b)
    // Click targets for the card's own scroll: what is above and below the window.
    // Each marker covers one line of the window, so it counts that line too.
    const above = first, below = lines.length - first - inner
    if (above > 0) put(x + 2, y + 1, fit(`▲ ${above + 1} more · click or ↑`, w - 4), { c: '#1e2127', bg: '#56b6c2', b: true })
    if (below > 0) put(x + 2, y + h - 2, fit(`▼ ${below + 1} more · click or ↓`, w - 4), { c: '#1e2127', bg: '#56b6c2', b: true })
  }

  // Few segments per row: a Client's tree is capped (100 000 characters serialized). A space with
  // no background looks the same in any colour, so it joins the segment before it; trailing
  // spaces are dropped.
  return ch.map((row, y) => {
    const segs: Seg[] = []
    const end = row.length - [...row].reverse().findIndex((t, i) => t !== ' ' || st[y]![row.length - 1 - i]?.bg)
    row.slice(0, end > row.length ? 0 : end).forEach((t, x) => {
      const s = st[y]![x] ?? {}
      const last = segs.at(-1)
      if (last && ((t === ' ' && !s.bg && !last.bg) || (last.c === s.c && last.bg === s.bg && !!last.b === !!s.b && !!last.d === !!s.d))) last.t += t
      else segs.push({ t, ...(s.c && { c: s.c }), ...(s.bg && { bg: s.bg }), ...(s.b && { b: true }), ...(s.d && { d: true }) })
    })
    return segs
  })
}

const BUDGET = 90000 // under the Client's 100 000-character tree cap, with room for the frame

// The canvas is as tall as the graph and the pane scrolls it; a big graph drawn whole passes the
// tree cap. So only the rows the pane shows (its offset, as the hooks last read it), with a margin
// for the engine's own moves that do not re-ask, are drawn; the rest is blank height.
export const WIN_MARGIN = 30
export function drawnRows(total: number, win: CanvasProps['win']): [number, number] {
  if (!win) return [0, total]
  const a = Math.max(0, Math.min(total, win.from - WIN_MARGIN))
  return [a, Math.max(a, Math.min(total, win.from + win.rows + WIN_MARGIN))]
}

type State = { top: number; left: number; selected?: string; sideTop: number; focus: 'graph' | 'side'; manualAt?: number }
const INIT: State = { top: 0, left: 0, sideTop: 0, focus: 'graph' }
export const SQUEEZED = 6 // rows under which the grid is unreadable
const MANUAL_MS = 15000 // after the person scrolls, the canvas stops following for this long

// Where the window starts: the person's scroll, unless a card to follow (the one running, or the
// one selected) is out of view and they have not scrolled lately — then the window moves to it.
// Derived at draw time, never written back: a setState from the draw itself would loop.
export function viewTop(p: CanvasProps, s: Pick<State, 'top' | 'manualAt'>, view: number, now: number): number {
  const total = Math.max(p.geo.height, p.side && p.side.y > 0 ? p.side.y + p.side.lines.length + 2 : 0)
  const max = Math.max(0, total - view)
  const card = p.follow ? p.geo.cards.find(c => c.id === p.follow) : undefined
  const isManual = s.manualAt !== undefined && now - s.manualAt < MANUAL_MS
  if (!card || isManual) return Math.min(s.top, max)
  if (card.y >= s.top && card.y + card.h <= s.top + view) return Math.min(s.top, max)
  return Math.max(0, Math.min(max, card.y - Math.max(1, Math.floor((view - card.h) / 3))))
}
let shownTop = 0 // the top last drawn: what a click or a key is relative to

// The same for columns: the pane scrolls only vertically, so a graph wider than it pans here
// (drag, Shift+←/→, h/l, </>), following the card to follow when the person has not panned lately.
export function viewLeft(p: CanvasProps, s: Pick<State, 'left' | 'manualAt'>, view: number, now: number): number {
  const total = Math.max(p.geo.width, p.side ? p.side.x + p.side.w + 1 : 0)
  const max = Math.max(0, total - view)
  const card = p.follow ? p.geo.cards.find(c => c.id === p.follow) : undefined
  const isManual = s.manualAt !== undefined && now - s.manualAt < MANUAL_MS
  if (!card || isManual) return Math.max(0, Math.min(s.left, max))
  if (card.x >= s.left && card.x + card.w <= s.left + view) return Math.max(0, Math.min(s.left, max))
  return Math.max(0, Math.min(max, card.x - Math.max(2, Math.floor((view - card.w) / 2))))
}
let shownLeft = 0
let drag: { x: number; left: number; moved: boolean } | undefined

// One row cut to the columns in view, segments kept whole where they fit.
export function sliceRow(segs: Seg[], left: number, width: number): Seg[] {
  const out: Seg[] = []
  let x = 0
  for (const g of segs) {
    const from = Math.max(left, x), to = Math.min(left + width, x + g.t.length)
    if (to > from) out.push({ ...g, t: g.t.slice(from - x, to - x) })
    x += g.t.length
    if (x >= left + width) break
  }
  return out
}

// Handlers are set once; they read the props of the latest call, not the first.
// ponytail: one canvas instance at a time (one pane); key it by instance if two ever mount.
let latest: CanvasProps = { geo: { width: 0, height: 0, cards: [], edges: [] } }

const Canvas: ClientModule<CanvasProps, State> = (props, surface) => {
  latest = props
  const { Box, Text } = surface.elements
  const s = surface.state
  if (s === undefined) {
    surface.onPointer(ev => {
      // A press then a move pans sideways; a press and release without moving is a click.
      if (ev.type === 'down') { drag = { x: ev.x, left: shownLeft, moved: false }; return }
      if (ev.type === 'move' && drag && ev.button) {
        const dx = ev.x - drag.x
        if (Math.abs(dx) >= 1) drag.moved = true
        if (drag.moved) surface.setState({ ...(surface.state ?? INIT), top: shownTop, left: Math.max(0, drag.left - dx), manualAt: Date.now() })
        return
      }
      if (ev.type !== 'up' || !drag) return
      const wasDrag = drag.moved
      drag = undefined
      if (wasDrag) return
      const cur = { ...(surface.state ?? INIT), top: shownTop, left: shownLeft }
      const x = ev.x + cur.left, y = ev.y + cur.top
      const side = latest.side
      if (side && x >= side.x && x < side.x + side.w) {
        // The side card: focus it for ↑/↓, and its ▲/▼ rows page through it.
        const box = sideBox(side, { top: cur.top, rows: surface.rows || 40, sideTop: cur.sideTop })
        if (y >= box.y && y < box.y + box.h) {
          const page = Math.max(1, box.inner - 2)
          const sideTop = y <= box.y + 1 ? Math.max(0, box.first - page) : y >= box.y + box.h - 2 ? Math.min(Math.max(0, side.lines.length - box.inner), box.first + page) : box.first
          surface.setState({ ...cur, focus: 'side', sideTop })
          return
        }
      }
      const hit = latest.geo.cards.find(c => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h && c.kind !== 'start' && c.kind !== 'end')
      if (hit) { surface.setState({ ...cur, focus: 'graph', selected: hit.id }); surface.post({ select: hit.id }) }
      else surface.setState({ ...cur, focus: 'graph' })
    })
    surface.onKey(ev => {
      const cur = { ...(surface.state ?? INIT), top: shownTop, left: shownLeft, manualAt: Date.now() }
      const pan = (ev.shift && ev.key === 'left') || ev.key === 'h' || ev.key === '<' ? -10 : (ev.shift && ev.key === 'right') || ev.key === 'l' || ev.key === '>' ? 10 : 0
      if (pan) return surface.setState({ ...cur, left: Math.max(0, cur.left + pan) })
      const side = latest.side
      if (cur.focus === 'side' && side) {
        const box = sideBox(side, { top: cur.top, rows: surface.rows || 40, sideTop: cur.sideTop })
        const step = ev.key === 'pageup' ? -box.inner : ev.key === 'pagedown' ? box.inner : ev.key === 'up' || ev.key === 'k' ? -2 : ev.key === 'down' || ev.key === 'j' ? 2 : 0
        if (step) return surface.setState({ ...cur, sideTop: Math.max(0, Math.min(side.lines.length - box.inner, box.first + step)) })
      }
      const pickable = latest.geo.cards.filter(c => c.kind === 'agent' || c.kind === 'workflow').sort((a, b) => a.y - b.y || a.x - b.x)
      const i = pickable.findIndex(c => c.id === (cur.selected ?? latest.selected))
      const total = Math.max(latest.geo.height, latest.side && latest.side.y > 0 ? latest.side.y + latest.side.lines.length + 2 : 0)
      const max = Math.max(0, total - (surface.rows || total))
      if (ev.key === 'up' || ev.key === 'k') surface.setState({ ...cur, top: Math.max(0, cur.top - 3) })
      else if (ev.key === 'down' || ev.key === 'j') surface.setState({ ...cur, top: Math.min(max, cur.top + 3) })
      else if (ev.key === 'right' || ev.key === 'tab' || ev.key === 'left') {
        const next = pickable[(i + (ev.key === 'left' ? pickable.length - 1 : 1)) % pickable.length]
        if (!next) return
        const view = surface.rows || latest.geo.height
        const top = next.y < cur.top ? Math.max(0, next.y - 1) : next.y + next.h > cur.top + view ? Math.min(max, next.y + next.h - view + 1) : cur.top
        surface.setState({ ...cur, manualAt: (surface.state ?? INIT).manualAt, selected: next.id, top }) // a pick follows its card
        surface.post({ select: next.id })
      } else if (ev.key === 'm' && (cur.selected ?? latest.selected)) surface.post({ cycleModel: cur.selected ?? latest.selected! })
    })
  }
  const state = s ?? INIT
  // How tall the drawing is, side card included: what the hooks mounted this region at.
  const total = Math.max(props.geo.height, props.side ? props.side.y + props.side.lines.length + 2 : 0)
  // A space squeezed below what the graph needs shows one row of grid, which reads as nothing: say
  // so, and list the steps as text in the rows there are. In a scrolling pane the space to judge is
  // the pane's BODY, not the laid-out region: the region is short there by design, a window on a
  // tall drawing, and only a body too short to show the grid at all is a squeeze.
  const need = Math.min(SQUEEZED, props.geo.height)
  if (props.win ? props.win.rows < need : surface.rows > 0 && surface.rows < need) {
    const steps = [...props.geo.cards].filter(c => c.kind !== 'start' && c.kind !== 'end' && c.kind !== 'dummy').sort((p, q) => p.y - q.y || p.x - q.x)
    return (
      <Box flexDirection="column">
        <Text key="sq" wrap="truncate-end" color="#e5c07b">{`↕ Too short for the diagram (${surface.rows} row${surface.rows > 1 ? 's' : ''}): enlarge the pane.`}</Text>
        <Text key="sq-steps" wrap="wrap">{steps.map(c => `${c.label}${c.model ? ` (${c.model})` : ''}`).join(' → ')}</Text>
      </Box>
    )
  }
  // In a pane (props.win) the region is mounted at the drawing's full height and the PANE scrolls it,
  // but the surface lays the region out at the band it can show — seven rows of a seventy-row box.
  // Windowing on that here cut a slice out of the top of the graph, and nothing at all once the pane
  // was scrolled past it. So trust the pane: draw in absolute rows and let drawnRows alone window,
  // on what the pane says is in view.
  const view = props.win ? total : surface.rows || props.rows || 40
  const top = props.win ? 0 : viewTop(props, state, view, Date.now())
  shownTop = top
  const cols = surface.columns || props.cols || 120
  const left = viewLeft(props, state, cols, Date.now())
  shownLeft = left
  const width = Math.max(props.geo.width, props.side ? props.side.x + props.side.w + 1 : 0)
  const painted = paint(props, { top, rows: view, sideTop: state.sideTop }) // the hooks own which card is open
  // Cut to the columns in view; ◀ / ▶ on the first row when more lies to that side.
  const rows = left === 0 && width <= cols ? painted : painted.map((r, y) => {
    const segs = sliceRow(r, left, cols)
    if (y !== top) return segs
    const marks: Seg[] = []
    if (left > 0) marks.push({ t: '◀ ', c: '#1e2127', bg: '#56b6c2', b: true })
    const rest = segs
    if (left + cols < width) return [...marks, ...sliceRow(rest, marks.length ? 2 : 0, cols - (marks.length ? 2 : 0) - 2), { t: ' ▶', c: '#1e2127', bg: '#56b6c2', b: true }]
    return [...marks, ...sliceRow(rest, marks.length ? 2 : 0, cols)]
  })
  return (
    <Box flexDirection="column">
      {(() => {
        // Coloured segments while the tree stays under the cap; past it, rows go plain (all their
        // text, no colour), then blank, rather than the whole canvas failing to draw.
        const shown = rows.slice(top, top + view)
        const [a, b] = drawnRows(shown.length, props.win)
        let size = 0
        return [
          ...(a ? [<Box key="above" height={a} />] : []),
          ...shown.slice(a, b).map((segs, i) => {
          const y = a + i
          const plain = segs.map(g => g.t).join('')
          size += segs.reduce((t, g) => t + g.t.length + 60, 40)
          if (size > BUDGET) {
            size += plain.length + 60 - segs.reduce((t, g) => t + g.t.length + 60, 40)
            return size > BUDGET * 1.05 ? <Text key={`r${y}`}> </Text> : <Text key={`r${y}`} wrap="truncate-end" dimColor>{plain}</Text>
          }
          return (
            <Text key={`r${y}`} wrap="truncate-end">
              {segs.map((g, i) => <Text key={`${i}`} {...(g.c ? { color: g.c } : {})} {...(g.bg ? { backgroundColor: g.bg } : {})} {...(g.b ? { bold: true } : {})} {...(g.d ? { dimColor: true } : {})}>{g.t}</Text>)}
            </Text>
          )
        }),
          ...(b < shown.length ? [<Box key="below" height={shown.length - b} />] : []),
        ]
      })()}
    </Box>
  )
}

export default Canvas
