// The commit graph and the worktrees as one Svg for the desktop board. `git log --graph` lays its lanes
// on a monospace grid, which a proportional desktop font breaks; here every grid cell becomes a stroke,
// so the lanes stay continuous at any font. Pure: what the board paints and what the tests check.
import type { GraphRow } from './board.ts'

export type Chip = { text: string; color: string; note?: string; noteColor?: string; conflicts?: string[] }
export type WorktreeLine = { icon: string; branch: string; where: string; owner?: string; state: string; stateColor: string; title?: string; isMain?: boolean }
export type GitSvgInput = {
  rows: GraphRow[]
  chipOf: (ref: string) => Chip
  ago: (at: number) => string
  worktrees: WorktreeLine[]
  width: number // CSS px of the room in the pane
  laneColors: readonly string[]
  ink: string
  muted: string
  alert: string
}

const COMMIT_H = 24 // a commit row
const LINK_H = 10 // a row of only lane links (\ / |)
const STEP = 8 // px per graph column: lanes sit on even columns, 16 px apart
const PAD = 10
const CHAR_W = 6.9 // ~12.5px system-ui, for cutting a subject to its room
const WT_H = 22

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
export const fitText = (s: string, room: number) => {
  const n = Math.max(0, Math.floor(room / CHAR_W))
  return s.length <= n ? s : n <= 1 ? '' : s.slice(0, n - 1).trimEnd() + '…'
}

export function gitSvg(p: GitSvgInput): { svg: string; height: number } {
  const graphW = Math.max(1, ...p.rows.map(r => r.graph.length))
  const textX = PAD + graphW * STEP + 10
  const lane = (col: number) => p.laneColors[Math.floor(col / 2) % p.laneColors.length]!
  const out: string[] = []
  let y = PAD

  p.rows.forEach((r, i) => {
    const h = r.hash ? COMMIT_H : LINK_H
    const top = y, mid = y + h / 2, bot = y + h
    // An open end at the top or bottom of the drawing stops at the dot, not past it.
    const prev = p.rows[i - 1], next = p.rows[i + 1]
    ;[...r.graph].forEach((c, col) => {
      const x = PAD + col * STEP
      const stroke = `stroke="${lane(col)}" stroke-width="2" stroke-linecap="round" fill="none"`
      if (c === '|') out.push(`<path d="M${x} ${top} V${bot}" ${stroke}/>`)
      else if (c === '\\') out.push(`<path d="M${x - STEP} ${top} L${x + STEP} ${bot}" ${stroke}/>`)
      else if (c === '/') out.push(`<path d="M${x + STEP} ${top} L${x - STEP} ${bot}" ${stroke}/>`)
      else if (c === '_') out.push(`<path d="M${x - STEP} ${bot} H${x + STEP}" ${stroke}/>`)
      else if (c === '*') {
        const up = prev && /[|*\\/]/.test(prev.graph[col] ?? '') ? top : mid
        const down = next && /[|*\\/]/.test(next.graph[col] ?? '') ? bot : mid
        if (up !== down) out.push(`<path d="M${x} ${up} V${down}" ${stroke}/>`)
        out.push(`<circle cx="${x}" cy="${mid}" r="5" fill="${lane(col)}"/>`)
      }
    })
    if (r.hash) {
      const title = esc(`${r.hash} ${r.subject ?? ''}${(r.refs ?? []).length ? ` (${r.refs!.join(', ')})` : ''}`)
      let x = textX
      const parts: string[] = [`<title>${title}</title>`, `<text x="${x}" y="${mid + 4}" class="h">${esc(r.hash)}</text>`]
      x += r.hash.length * 7.4 + 8
      const agoText = r.at ? p.ago(r.at) : ''
      const right = p.width - PAD
      const end = right - (agoText ? agoText.length * CHAR_W + 12 : 0) // where the subject must stop, the age after it
      const chips = (r.refs ?? []).map(p.chipOf)
      const badgeOf = (c: Chip) => {
        if (!c.conflicts?.length) return undefined
        const label = `✗ conflict · ${c.conflicts.length} file${c.conflicts.length > 1 ? 's' : ''}`
        return { label, w: label.length * 6.6 + 14 }
      }
      // A conflict badge is what the row is for: its room is kept first, chips and notes get what is left.
      let reserve = chips.reduce((n, c) => n + (badgeOf(c)?.w ?? 0) + 8, 0)
      for (const c of chips) {
        const badge = badgeOf(c)
        if (badge) reserve -= badge.w + 8
        const room = end - reserve - x
        const text = fitText(c.text, Math.min(room - 14, 220))
        if (text) {
          const w = text.length * 7 + 14
          parts.push(`<rect x="${x}" y="${mid - 9}" width="${w}" height="18" rx="9" fill="${c.color}"/><text x="${x + 7}" y="${mid + 4}" class="chip">${esc(text)}</text>`)
          x += w + 6
          const note = c.note ? fitText(c.note, end - reserve - (badge ? badge.w + 8 : 0) - x - 8) : ''
          if (note) { parts.push(`<text x="${x}" y="${mid + 4}" class="note" style="fill:${c.noteColor ?? p.muted}">${esc(note)}</text>`); x += note.length * CHAR_W + 8 }
        }
        if (badge) {
          const bx = Math.min(x, right - badge.w) // never past the edge, even when nothing else fits
          parts.push(`<g><title>${esc(c.conflicts!.join('\n'))}</title><rect x="${bx}" y="${mid - 9}" width="${badge.w}" height="18" rx="4" fill="${p.alert}"/><text x="${bx + 7}" y="${mid + 4}" class="chip">${esc(badge.label)}</text></g>`)
          x = bx + badge.w + 8
        }
      }
      parts.push(`<text x="${x}" y="${mid + 4}" class="s">${esc(fitText(r.subject ?? '', end - x))}</text>`)
      if (agoText) parts.push(`<text x="${right}" y="${mid + 4}" class="a" text-anchor="end">${esc(agoText)}</text>`)
      out.push(`<g class="row">${parts.join('')}</g>`)
    }
    y = bot
  })

  // The worktrees: one line each, the state where the eye lands first.
  if (p.worktrees.length) {
    y += 14
    out.push(`<text x="${PAD}" y="${y}" class="t">WORKTREES · ${p.worktrees.length}</text>`)
    y += 8
    // Columns from the room: on a narrow pane the branch keeps a third, the state the next third.
    const stateX = PAD + Math.min(210, Math.round((p.width - 2 * PAD) * 0.34)), ownerX = stateX + Math.min(190, Math.round((p.width - 2 * PAD) * 0.33))
    for (const w of p.worktrees) {
      const mid = y + WT_H / 2
      const title = esc(w.title ?? `${w.branch} · ${w.where}`)
      out.push(`<g class="row"><title>${title}</title>`
        + `<text x="${PAD}" y="${mid + 4}" class="${w.isMain ? 'b' : 's'}">${esc(w.icon)} ${esc(fitText(w.branch, stateX - PAD - 24))}</text>`
        + `<text x="${stateX}" y="${mid + 4}" class="st" style="fill:${w.stateColor}">${esc(fitText(w.state, ownerX - stateX - 10))}</text>`
        + `<text x="${ownerX}" y="${mid + 4}" class="a">${esc(fitText([w.owner, w.where].filter(Boolean).join(' · '), p.width - PAD - ownerX))}</text>`
        + `</g>`)
      y += WT_H
    }
  }

  const height = Math.ceil(y + PAD)
  const style = `<style>text{font:12.5px ui-sans-serif,system-ui,sans-serif;fill:${p.ink}}.h{font:12px ui-monospace,monospace;fill:${p.muted}}`
    + `.chip{font:600 11.5px ui-sans-serif,system-ui,sans-serif;fill:#1e2127}.note,.a{fill:${p.muted}}.a{font-size:12px}`
    + `.b{font-weight:600}.t{font:600 11px ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;fill:${p.muted}}.st{font-weight:600}`
    + `.row:hover text.s{text-decoration:underline}</style>`
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${p.width} ${height}" width="${p.width}" height="${height}" role="img">${style}${out.join('')}</svg>`,
    height,
  }
}
