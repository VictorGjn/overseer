// Lays the workflow flowchart out on a character grid: ranks top-down, cards centred per rank,
// orthogonal edges through the channel rows between ranks, back edges up the right margin.
// Pure: what the canvas paints and what the tests check. Mission text never enters it (the
// Client's props are capped at 100k chars), only what a card face shows.

export type CardKind = 'agent' | 'workflow' | 'decision' | 'loop' | 'start' | 'end' | 'dummy'
export type Tone = 'flow' | 'yes' | 'no' | 'err' | 'back' | 'unknown'

export type Card = {
  id: string
  kind: CardKind
  x: number
  y: number
  w: number
  h: number
  label: string
  model?: string
  phase?: string
  purpose?: string
  fan?: string
  guard?: string
  effort?: string
  isolation?: string
  body?: { t: string; c?: string; b?: boolean }[] // an expanded card's readable description, pre-wrapped
}

// One card drawn open: wider, its description inside. Lines are wrapped to `w - 4` by the caller.
export type Expand = { id: string; w: number; body: { t: string; c?: string; b?: boolean }[] }

export type Edge = { id: string; from: string; to: string; pts: [number, number][]; tone: Tone; label?: string; arrow: 'down' | 'left' }

export type Geometry = { width: number; height: number; cards: Card[]; edges: Edge[] }

type FlowNode = { id: string; kind: string; label: string }
type FlowEdge = { source: string; target: string; label?: string; kind?: string }
export type SiteNode = {
  id: string; kind: string; label: string; labelDynamic?: boolean; model?: string; phase?: string; mission?: string; assembled?: string
  fanOut?: { n: number | null; over?: string } | null; guard?: { kind: string; text: string; else?: boolean } | null
  effort?: string | null; isolation?: string | null
}
export type Graph = { nodes: SiteNode[]; flow: { nodes: FlowNode[]; edges: FlowEdge[] } }

const GAP_X = 3
const GAP_Y = 3 // channel rows between ranks: label/drop, horizontal run, arrow
const short = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s)
// 'build:' + s.k  →  build:⟨s.k⟩
export const tidyLabel = (s: string) => s.split(/\s*\+\s*/).map(p => (/^(['"`]).*\1$/.test(p) ? p.slice(1, -1) : `⟨${p}⟩`)).join('')
const odd = (n: number) => (n % 2 ? n : n - 1) // odd widths keep every centre on one column
const firstSentence = (s = '') => s.replace(/\$\{[^}]*\}/g, '…').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? ''

function toneOf(e: FlowEdge): Tone {
  const l = (e.label ?? '').toLowerCase()
  if (e.kind === 'back') return 'back'
  if (l.includes('error')) return 'err'
  if (l === '?') return 'unknown'
  if (l.startsWith('no')) return 'no'
  if (l === 'yes' || l === 'next' || l.startsWith('case')) return 'yes'
  return 'flow'
}

export function layout(g: Graph, columns: number, expand?: Expand): Geometry {
  const sites = new Map(g.nodes.map(n => [n.id, n]))
  const ids = [...new Set(['start', ...g.flow.edges.flatMap(e => [e.source, e.target]), ...g.flow.nodes.map(n => n.id), 'end'])]
  const flowNode = new Map(g.flow.nodes.map(n => [n.id, n]))
  const fwd = g.flow.edges.filter(e => e.kind !== 'back' && e.source !== e.target)

  // Rank: longest path from start over forward edges (cycles cut by an iteration cap).
  const rank = new Map<string, number>(ids.map(id => [id, 0]))
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false
    for (const e of fwd) {
      const r = (rank.get(e.source) ?? 0) + 1
      if (r > (rank.get(e.target) ?? 0)) { rank.set(e.target, r); moved = true }
    }
    if (!moved) break
  }
  rank.set('end', Math.max(...rank.values(), 1))

  // Long edges get one dummy per skipped rank, so they never cut through a card.
  type Hop = { edge: FlowEdge; chain: string[] }
  const hops: Hop[] = []
  const dummies: { id: string; rank: number }[] = []
  for (const e of fwd) {
    const a = rank.get(e.source)!, b = rank.get(e.target)!
    const chain = [e.source]
    for (let r = a + 1; r < b; r++) { const id = `~${e.source}>${e.target}@${r}`; dummies.push({ id, rank: r }); chain.push(id) }
    chain.push(e.target)
    hops.push({ edge: e, chain })
  }

  // Order within each rank: discovery order from start, then one barycentre pass.
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id); order.push(id)
    for (const h of hops) if (h.chain[0] === id) h.chain.slice(1).forEach(visit)
  }
  visit('start'); ids.forEach(visit); dummies.forEach(d => visit(d.id))
  const rankOf = (id: string) => rank.get(id) ?? dummies.find(d => d.id === id)!.rank
  const maxRank = Math.max(...order.map(rankOf))
  const rows: string[][] = Array.from({ length: maxRank + 1 }, () => [])
  for (const id of order) rows[rankOf(id)]!.push(id)
  const preds = new Map<string, string[]>()
  for (const h of hops) for (let i = 1; i < h.chain.length; i++) preds.set(h.chain[i]!, [...(preds.get(h.chain[i]!) ?? []), h.chain[i - 1]!])
  for (let r = 1; r < rows.length; r++) {
    const pos = new Map(rows[r - 1]!.map((id, i) => [id, i]))
    const bary = (id: string) => { const p = (preds.get(id) ?? []).map(x => pos.get(x) ?? 0); return p.length ? p.reduce((s, x) => s + x, 0) / p.length : 0 }
    rows[r]!.sort((a, b) => bary(a) - bary(b))
  }

  // Sizes: card width from the widest rank, between 22 and 38 columns.
  const backs = g.flow.edges.filter(e => e.kind === 'back')
  const lane = backs.length ? 3 + 2 * backs.length : 0
  const widest = Math.max(...rows.map(r => r.filter(id => !id.startsWith('~')).length), 1)
  const cardW = odd(Math.max(23, Math.min(39, Math.floor((columns - lane - 2 - GAP_X * (widest - 1)) / widest))))

  const cards = new Map<string, Card>()
  for (const id of order) {
    if (id.startsWith('~')) { cards.set(id, { id, kind: 'dummy', x: 0, y: 0, w: 1, h: 0, label: '' }); continue }
    const s = sites.get(id), f = flowNode.get(id)
    if (s) {
      const fan = s.fanOut ? `×${s.fanOut.n ?? 'N'}${s.fanOut.over ? ' over ' + s.fanOut.over : ''}` : undefined
      // An expanded card: its body replaces the purpose row, so it grows by body − 1 rows.
      const open = expand?.id === id ? expand : undefined
      cards.set(id, {
        id, kind: s.kind === 'workflow' ? 'workflow' : 'agent', x: 0, y: 0,
        w: (open ? Math.max(cardW, open.w) : cardW) + (fan ? 1 : 0), h: (fan ? 6 : 5) + (open ? open.body.length : 0), body: open?.body,
        label: s.labelDynamic ? tidyLabel(s.label) : s.label, model: s.model, phase: s.phase ?? undefined, purpose: firstSentence(s.assembled || s.mission || ''), fan,
        guard: s.guard ? `${s.guard.else ? 'else of' : 'if'} ${s.guard.text}` : undefined,
        effort: s.effort ?? undefined, isolation: s.isolation ?? undefined,
      })
    } else if (id === 'start' || id === 'end') {
      cards.set(id, { id, kind: id, x: 0, y: 0, w: 9, h: 1, label: id })
    } else {
      const kind = f?.kind === 'loop' ? 'loop' : 'decision'
      const label = short(f?.label ?? id, cardW - 6)
      cards.set(id, { id, kind, x: 0, y: 0, w: odd(Math.min(cardW, label.length + 7)), h: 3, label })
    }
  }

  // Place: ranks top-down, each rank centred in the drawing width.
  const width = Math.max(columns - lane, ...rows.map(r => r.reduce((s, id) => s + cards.get(id)!.w, 0) + GAP_X * (r.length - 1) + 2))
  const rankTop: number[] = []
  const rankH: number[] = []
  let y = 0
  rows.forEach((r, i) => {
    const h = Math.max(1, ...r.map(id => cards.get(id)!.h))
    rankTop[i] = y; rankH[i] = h
    const drawn = (c: Card) => c.w - (c.fan ? 1 : 0)
    const total = r.reduce((s, id) => s + drawn(cards.get(id)!), 0) + GAP_X * (r.length - 1)
    let x = Math.max(1, Math.floor(odd(width) / 2) - Math.floor(total / 2))
    for (const id of r) { const c = cards.get(id)!; c.x = x; c.y = y; if (c.kind === 'dummy') c.h = h; x += c.w + GAP_X }
    y += h + GAP_Y
  })
  const height = y - GAP_Y
  const cx = (c: Card) => c.x + Math.floor((c.w - (c.fan ? 1 : 0)) / 2)

  // Forward edges: down out of the source, across the channel, down into the target.
  const edges: Edge[] = hops.map((h, i) => {
    const pts: [number, number][] = []
    for (let k = 0; k < h.chain.length - 1; k++) {
      const a = cards.get(h.chain[k]!)!, b = cards.get(h.chain[k + 1]!)!
      const bottom = rankTop[rankOf(a.id)]! + rankH[rankOf(a.id)]!
      const ax = cx(a), bx = cx(b)
      pts.push([ax, a.y + a.h], [ax, bottom + 1], [bx, bottom + 1], [bx, b.y - 1])
      if (b.kind === 'dummy') pts.push([bx, b.y + b.h])
    }
    return { id: `e${i}`, from: h.edge.source, to: h.edge.target, pts, tone: toneOf(h.edge), label: h.edge.label || undefined, arrow: 'down' as const }
  })

  // Back edges: out of the source's right side, up the margin lane, into the target's right side.
  backs.forEach((e, k) => {
    const a = cards.get(e.source), b = cards.get(e.target)
    if (!a || !b) return
    const laneX = width + 1 + 2 * k
    const ay = a.y + Math.min(2, a.h - 1), by = b.y + Math.min(1, b.h - 1)
    edges.push({ id: `b${k}`, from: e.source, to: e.target, pts: [[a.x + a.w, ay], [laneX, ay], [laneX, by], [b.x + b.w, by]], tone: 'back', label: e.label || 'again', arrow: 'left' })
  })

  return { width: width + lane, height, cards: [...cards.values()].filter(c => c.kind !== 'dummy'), edges }
}
