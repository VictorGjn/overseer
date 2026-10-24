// The flowchart off the terminal (desktop, vscode, mobile): an Svg source of the geometry layout.ts
// computed, cells scaled to pixels, with the lab's choreography written as SMIL from → to: the check
// draws itself, a ripple leaves the card, the next edge draws, a fan-out's cards spread, tokens run on
// live edges, and the camera (the viewBox) moves to the card to follow. canvas.tsx stays the terminal's.
// Pure: no $, no atom, no clock; the hooks pass `now` and the motion memory (kit/motion's rules).
import { MODEL_COLOR } from './canvas.tsx'
import type { Live } from './canvas.tsx'
import type { Card, Edge, Geometry } from './layout.ts'
import { ageOf, beginAt, comet, drawOn, EASE, halo, isMoving, move, MS, spline } from './kit/motion.ts'
import type { Moved } from './kit/motion.ts'

export const CX = 8 // px per layout column
export const CY = 18 // px per layout row
export const FRAME = 460 // the camera's frame, px: a taller graph is followed through it
export const SOURCE_MAX = 131072 // an Svg source's cap

export type Worker = 'wait' | 'run' | 'ok' | 'fail'
export type FlowSvg = {
  geo: Geometry
  live?: Record<string, Live> // Live tab: each card's state; absent on Plan
  workers?: Record<string, Worker[]> // a fan-out's agents, one square each
  selected?: string
  warn?: Record<string, { n: number; text: string }>
  follow?: string // the card the camera keeps in frame
}
// What changed and when, by key: `n:<card>` state, `e:<edge>` kind, `w:<card>:<i>` worker, `sel`, `cam`.
export type Motion = Record<string, Moved<string>>

const TONE: Record<Edge['tone'], string> = { flow: '#7f848e', yes: '#98c379', no: '#e06c75', err: '#e06c75', back: '#d19a66', unknown: '#5c6370' }
const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
const cut = (s: string, n: number) => (n <= 1 ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s)
const f1 = (n: number) => +n.toFixed(1)

// A card's state: a site from the run; start is done once a run exists; a decision or loop takes the
// most advanced state of what leads into it (done once one of its sources is done).
function states(p: FlowSvg): Record<string, string> {
  const out: Record<string, string> = {}
  if (!p.live) return out
  const into = (id: string) => p.geo.edges.filter(e => e.to === id && e.arrow === 'down').map(e => e.from)
  const of = (id: string, seen: Set<string>): string => {
    if (out[id]) return out[id]!
    if (id === 'start') return 'done'
    const lv = p.live![id]
    if (lv) return lv.state
    if (seen.has(id)) return 'pending'
    seen.add(id)
    const from = into(id).map(x => of(x, seen))
    return from.includes('done') ? 'done' : from.includes('running') ? 'running' : 'pending'
  }
  for (const c of p.geo.cards) out[c.id] = of(c.id, new Set())
  return out
}

// An edge: future (its source not done), taken, or live (it leads into a running card). Plan has one look.
function kinds(p: FlowSvg, st: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const branch = new Set(p.geo.cards.filter(c => c.kind === 'decision' || c.kind === 'loop').map(c => c.id))
  for (const e of p.geo.edges) {
    // Out of a decision, only the branch the run took: its target has left pending.
    const isTaken = st[e.from] === 'done' && (!branch.has(e.from) || st[e.to] !== 'pending')
    out[e.id] = !p.live ? 'plan' : e.arrow === 'left' || !isTaken ? 'future' : st[e.to] === 'running' ? 'live' : 'taken'
  }
  return out
}

// The camera: the whole graph when it fits the frame, else a window of FRAME px around the card to follow.
export function camera(p: FlowSvg): { w: number; h: number; y: number; frame: number } {
  const w = p.geo.width * CX, h = p.geo.height * CY
  if (h <= FRAME) return { w, h, y: 0, frame: h }
  const c = p.geo.cards.find(x => x.id === p.follow)
  const y = c ? Math.max(0, Math.min(h - FRAME, c.y * CY - FRAME * 0.3)) : 0
  return { w, h, y: Math.round(y), frame: FRAME }
}

// The values the motion follows, flat.
export function snapshot(p: FlowSvg): Record<string, string> {
  const st = states(p), ek = kinds(p, st)
  const s: Record<string, string> = { sel: p.selected ?? '', cam: String(camera(p).y) }
  for (const [id, v] of Object.entries(st)) s[`n:${id}`] = v
  for (const [id, v] of Object.entries(ek)) s[`e:${id}`] = v
  for (const [id, ws] of Object.entries(p.workers ?? {})) ws.forEach((w, i) => { s[`w:${id}:${i}`] = w })
  return s
}

// The next memory: each key keeps the instant it last changed; a key seen for the first time never animates.
export function remember(m: Motion | undefined, snap: Record<string, string>, now: number): Motion {
  const out: Motion = {}
  for (const [k, v] of Object.entries(snap)) out[k] = move(m?.[k], v, now)
  return out
}

const css = (n: number) => `
.cd{fill:var(--sf);stroke-width:1.5}.sel .cd{stroke:var(--ac);stroke-width:2.4}
text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;fill:var(--ink)}
.ph{font-size:9.5px;font-weight:600;letter-spacing:.06em;fill:var(--mu)}.lb{font-size:12.5px;font-weight:600}
.ms{font-size:11px;fill:var(--mu)}.gd{font-size:11px;fill:#d19a66}.pl{font-size:10px;font-weight:600;fill:#1e2127}.pct{font-size:10px;fill:var(--mu)}
.trk{fill:var(--ln)}.e{fill:none;stroke-width:1.6}.future{stroke:var(--ln);stroke-dasharray:3 4}.taken{stroke:var(--mu)}
.live{stroke:var(--ac);stroke-dasharray:5 4}.draw{fill:none;stroke-width:2.2;stroke-linecap:round}.draw.taken{stroke:var(--mu)}.draw.live{stroke:var(--ac)}
.el{font-size:10px;font-weight:600}.tok{fill:var(--ac)}.dia{fill:var(--sf);stroke:#e5c07b;stroke-width:1.5}
.halo{fill:none;stroke-width:2}.halo.run{stroke:#e5c07b}.halo.ok{stroke:#98c379}.halo.sel{stroke:var(--ac)}
.i-run{fill:#e5c07b}.i-ring{fill:none;stroke:#e5c07b;stroke-width:1.5}.i-ok{fill:#98c379}.i-bad{fill:#e06c75}
.chk{fill:none;stroke:var(--sf);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.i-wait{fill:none;stroke:var(--mu);stroke-width:1.4}
.dot{fill:var(--ink)}.wb{fill:#1e2127}.n{transition:opacity 120ms}.e,.el,.tg{transition:opacity 120ms}
svg{--sf:#fff;--ink:#14171c;--mu:#5b6270;--ln:#d8dce2;--ac:#2e59e6}
@media (prefers-color-scheme:dark){svg{--sf:#161920;--ink:#e6e8ec;--mu:#8c94a2;--ln:#2f3540;--ac:#7f9dff}}
${Array.from({ length: n }, (_, i) => `svg:has(.n${i}:hover) .e:not(.f${i}):not(.t${i}),svg:has(.n${i}:hover) .el:not(.f${i}):not(.t${i}),svg:has(.n${i}:hover) .tg:not(.f${i}):not(.t${i}){opacity:.15}svg:has(.n${i}:hover) .n:not(.n${i}):not(.a${i}){opacity:.4}`).join('')}`

// The Svg source; `lean` drops titles and the hover rules, then every animation, to stay under the cap.
export function flowSvg(p: FlowSvg, m: Motion, now: number, lean = 0): string {
  const { cards, edges } = p.geo
  const st = states(p), ek = kinds(p, st)
  const idx = new Map(cards.map((c, i) => [c.id, i]))
  const age = (k: string) => (lean >= 2 ? Infinity : ageOf(m[k], now))
  const loop = (ms: number) => beginAt(now % ms) // loops anchored on the clock: a redraw resumes them
  const spl = spline(), emph = spline(EASE.emph)

  // Edges: cells to px, the ends snapped to the cards' sides.
  const path = (e: Edge) => e.pts.map(([x, y], i) => {
    const last = i === e.pts.length - 1
    const px = e.arrow === 'left' && (i === 0 || last) ? x * CX + (last ? 2 : 0) : (x + 0.5) * CX
    const py = e.arrow === 'down' && i === 0 ? y * CY : e.arrow === 'down' && last ? (y + 1) * CY - 2 : (y + 0.5) * CY
    return `${i ? 'L' : 'M'}${f1(px)} ${f1(py)}`
  }).join(' ')
  const markers = Object.entries(TONE).map(([t, c]) => `<marker id="m-${t}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('')
  const edgeSvg = edges.map(e => {
    const d = path(e), k = ek[e.id]!, a = age(`e:${e.id}`), cls = `f${idx.get(e.from) ?? 'x'} t${idx.get(e.to) ?? 'x'}`
    const stroke = k === 'plan' || k === 'taken' ? ` style="stroke:${TONE[e.tone]}"` : ''
    const flow = k === 'live' && lean < 2 ? `<animate attributeName="stroke-dashoffset" from="18" to="0" dur="700ms" begin="${loop(700)}" repeatCount="indefinite"/>` : ''
    const drawn = (k === 'taken' || k === 'live') && isMoving(a, MS.slow, 120) ? drawOn(d, a, { cls: `draw ${k}`, delay: 120 }) : '' // the base path stays once drawn
    const toks = k === 'live' && lean < 2 ? `<g class="tg ${cls}">${comet(d, { phase: -(now % 1100) })}${comet(d, { phase: -(now % 1100) - 550 })}</g>` : ''
    const end = e.pts.at(-1)!, mid = e.pts[Math.floor(e.pts.length / 2)]!
    const label = !e.label ? '' : e.arrow === 'left'
      ? `<text class="el ${cls}" x="${f1(mid[0] * CX + 4)}" y="${f1((mid[1] + 0.5) * CY)}" fill="${TONE.back}">↺ ${esc(cut(e.label, 18))}</text>`
      : `<text class="el ${cls}" x="${f1((end[0] + 0.5) * CX + 6)}" y="${f1((end[1] + 0.5) * CY)}" fill="${TONE[e.tone]}">${esc(cut(e.label, 18))}</text>`
    return `<path class="e ${k} ${cls}" d="${d}" marker-end="url(#m-${e.tone})"${stroke}>${flow}</path>${drawn}${toks}${label}`
  }).join('')

  const cardSvg = (c: Card) => {
    const i = idx.get(c.id)!, s = st[c.id], k = `n:${c.id}`, a = age(k), sel = c.id === p.selected
    const adj = edges.filter(e => e.from === c.id || e.to === c.id).map(e => `a${idx.get(e.from === c.id ? e.to : e.from)}`).join(' ')
    const fan = !!c.fan, X = c.x * CX, Y = c.y * CY, W = (c.w - (fan ? 1 : 0)) * CX, H = (c.h - (fan ? 1 : 0)) * CY
    const row = (r: number) => Y + r * CY + 13
    const color = MODEL_COLOR[c.model ?? 'inherited'] ?? '#7f848e'
    const title = lean ? '' : `<title>${esc(cut([c.label, c.fan, c.model, c.purpose].filter(Boolean).join(' · '), 300))}</title>`
    const ripple = lean < 2 && s === 'done' ? halo({ x: X, y: Y, w: W, h: H }, a, { cls: 'halo ok' }) : lean < 2 && s === 'running' ? halo({ x: X, y: Y, w: W, h: H }, a, { cls: 'halo run' }) : sel ? halo({ x: X, y: Y, w: W, h: H }, age('sel'), { cls: 'halo sel', dur: MS.base }) : ''
    const g = (body: string) => `<g class="n n${i} ${adj}${sel ? ' sel' : ''}">${title}${ripple}${body}</g>`
    if (c.kind === 'start' || c.kind === 'end') {
      const on = c.kind === 'start' || s === 'done' || !p.live
      return g(`<circle class="dot" cx="${X + 9}" cy="${Y + 9}" r="${c.kind === 'end' ? 4 : 6}" opacity="${on ? 1 : 0.3}"/>${c.kind === 'end' ? `<circle cx="${X + 9}" cy="${Y + 9}" r="8" fill="none" stroke="var(--ink)" stroke-width="1.6"/>` : ''}<text class="ms" x="${X + 22}" y="${Y + 13}">${esc(c.label)}</text>`)
    }
    if (c.kind === 'decision' || c.kind === 'loop') {
      const cy = Y + H / 2, flash = lean < 2 && s === 'done' && isMoving(a, MS.slow) ? `<animate attributeName="opacity" from="0.7" to="0" begin="${beginAt(a)}" dur="${MS.slow}ms" fill="freeze"/>` : ''
      const hex = `${X + 12},${Y} ${X + W - 12},${Y} ${X + W},${cy} ${X + W - 12},${Y + H} ${X + 12},${Y + H} ${X},${cy}`
      return g(`<polygon class="dia" points="${hex}"/>${flash ? `<polygon points="${hex}" fill="#e5c07b" opacity="0">${flash}</polygon>` : ''}<text class="lb" x="${X + W / 2}" y="${cy + 4}" text-anchor="middle" style="fill:#e5c07b">${s === 'done' ? '✓ ' : ''}${c.kind === 'loop' ? '↻' : '◆'} ${esc(cut(c.label, c.w - 6))}</text>`)
    }
    // A fan-out is a stack of cards; when it starts, the cards behind spread out from the front one.
    const spread = lean < 2 && fan && s === 'running' && isMoving(a, MS.slow, 160)
    const layer = (o: number, op: number) => `<rect x="${X + o}" y="${Y + o}" width="${W}" height="${H}" rx="10" fill="var(--sf)" stroke="${color}" stroke-opacity="${op}">${spread ? `<animate attributeName="x" from="${X}" to="${X + o}" begin="${beginAt(a, 120 + o * 12)}" dur="${MS.slow}ms" ${emph} fill="freeze"/><animate attributeName="y" from="${Y}" to="${Y + o}" begin="${beginAt(a, 120 + o * 12)}" dur="${MS.slow}ms" ${emph} fill="freeze"/>` : ''}</rect>`
    const lift = lean < 2 && s === 'running' && isMoving(a, MS.slow) ? `<animateTransform attributeName="transform" type="translate" from="0 6" to="0 0" begin="${beginAt(a)}" dur="${MS.slow}ms" ${emph} fill="freeze"/>` : ''
    const border = sel ? '' : s === 'running' ? ' style="stroke:#e5c07b"' : s === 'failed' ? ' style="stroke:#e06c75"' : ` style="stroke:${color}"`
    const pw = 8 + 6.2 * (c.model ?? 'inherited').length
    const pill = `<rect x="${f1(X + W - pw - 8)}" y="${Y + 5}" width="${f1(pw)}" height="15" rx="7.5" fill="${color}"/><text class="pl" x="${f1(X + W - 8 - pw / 2)}" y="${Y + 16}" text-anchor="middle">${esc(c.model ?? 'inherited')}</text>`
    const w = p.warn?.[c.id]
    const badge = w ? `<rect x="${f1(X + W - pw - 46)}" y="${Y + 5}" width="32" height="15" rx="4" fill="#e5c07b"/><text class="pl" x="${f1(X + W - pw - 30)}" y="${Y + 16}" text-anchor="middle">⚠ ${Math.min(w.n, 99)}</text>` : ''
    const chars = c.w - 5
    // The state icon: a ring pulsing while it runs, a check that draws itself when it ends.
    const ix = X + 14, iy = row(1) - 4
    const icon = s === 'running'
      ? `<circle class="i-run" cx="${ix}" cy="${iy}" r="4"/>${lean < 2 ? `<circle class="i-ring" cx="${ix}" cy="${iy}" r="4"><animate attributeName="r" values="4;9" dur="1200ms" begin="${loop(1200)}" repeatCount="indefinite"/><animate attributeName="opacity" values=".7;0" dur="1200ms" begin="${loop(1200)}" repeatCount="indefinite"/></circle>` : ''}`
      : s === 'done'
        ? `<circle class="i-ok" cx="${ix}" cy="${iy}" r="6">${lean < 2 && isMoving(a, 300) ? `<animate attributeName="r" values="0;7;6" keyTimes="0;.6;1" begin="${beginAt(a)}" dur="300ms" fill="freeze"/>` : ''}</circle>${drawOn(`M${ix - 3} ${iy} l2.2 2.3 l4 -4.6`, a, { cls: 'chk', delay: 80, dur: MS.base })}`
        : s === 'failed' ? `<circle class="i-bad" cx="${ix}" cy="${iy}" r="6"/><path class="chk" d="M${ix - 2.5} ${iy - 2.5}l5 5m0 -5l-5 5"/>`
        : p.live ? `<circle class="i-wait" cx="${ix}" cy="${iy}" r="5"/>` : `<text class="ms" x="${ix - 4}" y="${iy + 4}">▸</text>`
    const head = `<text class="ph" x="${X + 10}" y="${row(0)}">${esc(cut(`${(c.phase ?? c.kind).toUpperCase()}${c.fan ? ' ' + c.fan : ''}`, Math.floor((W - pw - (w ? 60 : 20)) / 6.4)))}</text>`
    const label = `<text class="lb" x="${X + 26}" y="${row(1)}">${esc(cut(c.label, chars - 2))}</text>`
    const body = (c.body ?? []).map((l, j) => `<text class="ms" x="${X + 12}" y="${row(2 + j)}"${l.c ? ` style="fill:${l.c}"` : ''}${l.b ? ' font-weight="600"' : ''}>${esc(cut(l.t, chars))}</text>`).join('')
    const foot = 2 + (c.body?.length ?? 0)
    const lv = p.live?.[c.id]
    let lines = ''
    if (lv) {
      // A fan-out's agents, one square each, popping as they end; else the run's note on the card.
      const ws = p.workers?.[c.id] ?? []
      const squares = fan && ws.length ? ws.slice(0, Math.floor((W - 60) / 13)).map((x, j) => {
        const wa = age(`w:${c.id}:${j}`), px = X + 12 + j * 13, py = row(foot) - 8
        const pop = lean < 2 && x === 'ok' && isMoving(wa, MS.base) ? `<animate attributeName="y" values="${py};${py - 3};${py}" begin="${beginAt(wa)}" dur="${MS.base}ms"/>` : lean < 2 && x === 'run' && isMoving(wa, MS.base) ? `<animate attributeName="width" from="0" to="10" begin="${beginAt(wa)}" dur="${MS.base}ms" ${spl} fill="freeze"/>` : ''
        return `<rect x="${px}" y="${py}" width="10" height="8" rx="2" fill="${x === 'ok' ? '#98c379' : x === 'run' ? '#e5c07b' : x === 'fail' ? '#e06c75' : 'var(--ln)'}">${pop}</rect>`
      }).join('') + `<text class="ms" x="${X + 16 + Math.min(ws.length, Math.floor((W - 60) / 13)) * 13}" y="${row(foot)}">${ws.filter(x => x === 'ok').length}/${ws.length}</text>` : ''
      const bw = W - 64, pr = Math.max(0, Math.min(1, s === 'done' ? 1 : lv.progress ?? 0))
      lines = (squares || `<text class="ms" x="${X + 12}" y="${row(foot)}">${esc(cut(lv.note ?? '', chars))}</text>`)
        + `<rect class="trk" x="${X + 12}" y="${row(foot + 1) - 7}" width="${bw}" height="5" rx="2.5"/><rect x="${X + 12}" y="${row(foot + 1) - 7}" width="${f1(bw * pr)}" height="5" rx="2.5" fill="${s === 'done' ? '#98c379' : s === 'failed' ? '#e06c75' : s === 'running' ? '#e5c07b' : 'var(--mu)'}"/>`
        + `<text class="pct" x="${X + W - 10}" y="${row(foot + 1) - 2}" text-anchor="end">${lv.isEstimate ? '~' : ''}${Math.round(pr * 100)}%</text>`
    } else {
      const meta = [c.fan, c.guard, c.effort && `effort ${c.effort}`, c.isolation].filter(Boolean).join(' · ')
      lines = (c.body?.length ? '' : `<text class="ms" x="${X + 12}" y="${row(foot)}">${esc(cut(c.purpose || '—', chars))}</text>`)
        + (meta || w ? `<text class="${w || c.guard ? 'gd' : 'ms'}" x="${X + 12}" y="${row(foot + (c.body?.length ? 0 : 1))}">${esc(cut(w ? `⚠ ${w.text}` : meta, chars))}</text>` : '')
    }
    const stack = fan ? layer(8, 0.35) + layer(4, 0.55) : ''
    return g(`<g>${lift}${stack}<rect class="cd" x="${X}" y="${Y}" width="${W}" height="${H}" rx="10"${border}/>${head}${badge}${pill}${icon}${label}${body}${lines}</g>`)
  }

  // The camera: the viewBox slides from the last frame to the new one.
  const cam = camera(p), ca = age('cam'), from = m.cam ? Number(m.cam.from) : cam.y
  const vb = (y: number) => `0 ${y} ${cam.w} ${cam.frame}`
  const pan = cam.frame < cam.h && isMoving(ca, MS.camera) ? `<animate attributeName="viewBox" from="${vb(from)}" to="${vb(cam.y)}" begin="${beginAt(ca)}" dur="${MS.camera}ms" ${spline(EASE.camera)} fill="freeze"/>` : ''
  const src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb(cam.y)}" width="${cam.w}" height="${cam.frame}">${pan}<style>${lean ? css(0) : css(cards.length)}</style><defs>${markers}</defs>${edgeSvg}${cards.map(cardSvg).join('')}</svg>`
  return src.length > SOURCE_MAX && lean < 2 ? flowSvg(p, m, now, lean + 1) : src
}
