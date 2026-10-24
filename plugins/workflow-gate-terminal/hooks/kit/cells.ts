// The terminal's motion: a Raster painted as a pure function of the state and the frame number, repainted
// by $.ui.blit. No interpolator, cells: every element remembers the frame it last changed at and each
// effect is computed from that gap.
// ponytail: copied as-is into each mod (a mod cannot import another's files); check.sh keeps the copies identical.
// Pure: `loop` takes the engine's timer and blit as arguments, no $ here (b000042).

// A colour is 0x00RRGGBB; this one is the terminal's own (fg or bg).
export const DEFAULT = 0x01000000
export const rgb = (hex: string) => parseInt(hex.slice(1, 7), 16)

// A colour `t` of the way from a to b (0 → a, 1 → b), channel by channel. The terminal default mixes as itself.
export function mix(a: number, b: number, t: number): number {
  if (a === DEFAULT || b === DEFAULT) return t < 0.5 ? a : b
  const k = Math.max(0, Math.min(1, t))
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

// Heat for a 0..1 level (token rate, activity): eight steps from night blue to pale, the lab's ramp.
export const HEAT = ['#1f2a3d', '#26385a', '#2d4677', '#355594', '#4a6cb5', '#5f84d2', '#7aa2f7', '#a9c4ff'].map(rgb)
export const heat = (t: number) => HEAT[Math.max(0, Math.min(HEAT.length - 1, Math.round(t * (HEAT.length - 1))))]!

// A grid of cells, row-major: three u32 per cell, [code point, fg, bg].
export type Grid = { columns: number; rows: number; data: Uint32Array }
export function grid(columns: number, rows: number, bg = DEFAULT): Grid {
  const c = Math.max(1, Math.min(512, Math.floor(columns))), r = Math.max(1, Math.min(256, Math.floor(rows)))
  const data = new Uint32Array(c * r * 3)
  for (let i = 0; i < c * r; i++) data.set([32, DEFAULT, bg], i * 3)
  return { columns: c, rows: r, data }
}

// A Raster takes printable width-1 BMP characters only (blocks, box drawing, braille), or the tree is refused.
// ponytail: wide is emoji presentation (⚡ ⛔ ✅, BMP too) and the CJK scripts and full-width forms; a rarer
// wide character still gets through, add its range here if a tree is refused naming its cell.
const WIDE = /[\p{Emoji_Presentation}\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uff60\uffe0-\uffe6]/u
const isCell = (ch: string, cp: number) => cp >= 32 && cp <= 0xffff && !(cp >= 0x7f && cp < 0xa0) && !(cp >= 0xd800 && cp <= 0xdfff) && !WIDE.test(ch)

// Writes `text` from (x, y), one cell per character, clipped to the grid; a character a cell cannot hold is drawn as '·'.
export function put(g: Grid, x: number, y: number, text: string, fg = DEFAULT, bg?: number) {
  if (y < 0 || y >= g.rows) return
  let i = 0
  for (const ch of text) {
    const cx = x + i++
    if (cx < 0 || cx >= g.columns) continue
    const cp = ch.codePointAt(0)!
    const o = (y * g.columns + cx) * 3
    g.data[o] = isCell(ch, cp) ? cp : 0xb7
    g.data[o + 1] = fg
    if (bg !== undefined) g.data[o + 2] = bg
  }
}

// Recolours a cell without changing its glyph.
export function tint(g: Grid, x: number, y: number, fg?: number, bg?: number) {
  if (x < 0 || y < 0 || x >= g.columns || y >= g.rows) return
  const o = (y * g.columns + x) * 3
  if (fg !== undefined) g.data[o + 1] = fg
  if (bg !== undefined) g.data[o + 2] = bg
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
// Standard padded base64 of bytes (Uint8Array.toBase64 is not in every runtime the mod meets).
export function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? B64[n & 63]! : '=')
  }
  return s
}

// A Raster's `cells`: every u32 little-endian whatever the machine's order, then base64.
export function pack(g: Grid): string {
  const bytes = new Uint8Array(g.data.length * 4)
  const v = new DataView(bytes.buffer)
  g.data.forEach((w, i) => v.setUint32(i * 4, w, true))
  return base64(bytes)
}

// The cells round a box's border, clockwise from its top-left corner: what a glint runs along, one cell per frame.
export function perimeter(x: number, y: number, w: number, h: number): [number, number][] {
  const p: [number, number][] = []
  for (let i = 0; i < w; i++) p.push([x + i, y])
  for (let j = 1; j < h - 1; j++) p.push([x + w - 1, y + j])
  if (h > 1) for (let i = w - 1; i >= 0; i--) p.push([x + i, y + h - 1])
  if (w > 1) for (let j = h - 2; j > 0; j--) p.push([x, y + j])
  return p
}

// A blit loop that stops at rest: `wake()` starts it if it is not running; each period it asks `frame(n)`
// for the cells (n counts from the wake) and stops when frame says null (nothing moves any more) or the
// blit is refused (the Raster is gone or resized: a redraw must mount a new one, then wake again).
// Lot 0: 80×24 holds 14 fps on the terminal, so 15 fps is the default. Wire it from the mod's own hooks module:
// `every: (ms, f) => $.clock.every(ms, f), blit: a => $.ui.blit(a)`; the host scans each module for the $ calls
// it spells and refuses any other (a bare `$.clock.every` passed along is refused).
type Blit = (a: { requestId: string; key: string; cells: string }) => Promise<{ deny?: string } | object>
export function loop(o: { every: (ms: number, fn: () => void) => { cancel: () => void }; blit: Blit; requestId: string; key: string; frame: (n: number) => string | null; fps?: number }) {
  let timer: { cancel: () => void } | null = null
  let n = 0
  const stop = () => { timer?.cancel(); timer = null }
  const tick = async () => {
    const cells = o.frame(n++)
    if (cells === null) return stop()
    const r = await o.blit({ requestId: o.requestId, key: o.key, cells }).catch(() => ({ deny: 'failed' }))
    if ('deny' in r && r.deny) stop()
  }
  return {
    wake() { if (!timer) { n = 0; timer = o.every(Math.round(1000 / (o.fps ?? 15)), () => void tick()) } },
    stop,
    get isRunning() { return timer !== null },
  }
}
