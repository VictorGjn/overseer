// The mockup's reference, and the comparison of a page with it. A reference is a DOM skeleton (tag, class, order) and a PNG
// per width x theme, under ./ref/. compare() says where the skeletons differ and what share of the pixels differ.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

export const WIDTHS = [390, 1024, 1280, 1600]
export const THEMES = ['light', 'dark']
export const HEIGHT = 900
export const REF = join(dirname(fileURLToPath(import.meta.url)), 'ref')
export const refName = (width, theme) => `${width}-${theme}`

// The page as a list of "depth tag.class.class" lines, in document order: no text, no script, no style, so a copy change is no
// difference but a missing, extra or moved element is. Run in the page.
export const SKELETON_JS = `(() => {
  const out = []
  const walk = (el, d) => {
    if (['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT'].includes(el.tagName)) return
    out.push(d + ' ' + el.tagName.toLowerCase() + [...el.classList].map(c => '.' + c).join(''))
    for (const c of el.children) walk(c, d + 1)
  }
  walk(document.body, 0)
  return out
})()`

// Lines that are in one skeleton and not the other, in order: { at, ref, got } for each place they stop agreeing (a simple diff
// by longest common subsequence, enough for a few hundred lines).
export function skeletonDiff(ref, got) {
  const n = ref.length, m = got.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = ref[i] === got[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const diffs = []
  let i = 0, j = 0
  while (i < n || j < m) {
    if (i < n && j < m && ref[i] === got[j]) { i++; j++ }
    else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) diffs.push({ at: j, got: got[j++] })
    else diffs.push({ at: i, ref: ref[i++] })
  }
  return diffs
}

// A PNG (8 bit, not interlaced, as Chrome writes it) as { width, height, data } with RGBA bytes.
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let width = 0, height = 0, depth = 0, color = 0
  const idat = []
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; color = body[9]; if (body[12] !== 0) throw new Error('interlaced PNG') }
    if (type === 'IDAT') idat.push(body)
    if (type === 'IEND') break
    p += 12 + len
  }
  if (depth !== 8 || (color !== 2 && color !== 6)) throw new Error(`PNG depth ${depth} colour ${color} not supported`)
  const bpp = color === 6 ? 4 : 3, stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), at = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[at + x - bpp] : 0, b = y ? px[at - stride + x] : 0, c = x >= bpp && y ? px[at - stride + x - bpp] : 0
      const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c })()
      px[at + x] = (line[x] + pr) & 255
    }
  }
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) { data[i * 4] = px[i * bpp]; data[i * 4 + 1] = px[i * bpp + 1]; data[i * 4 + 2] = px[i * bpp + 2]; data[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255 }
  return { width, height, data }
}

// The share (0 to 1) of pixels that differ by more than `tolerance` in any channel. Sizes that differ are all different.
export function pixelRatio(a, b, tolerance = 8) {
  const A = decodePng(a), B = decodePng(b)
  if (A.width !== B.width || A.height !== B.height) return 1
  let diff = 0
  for (let i = 0; i < A.data.length; i += 4) if (Math.abs(A.data[i] - B.data[i]) > tolerance || Math.abs(A.data[i + 1] - B.data[i + 1]) > tolerance || Math.abs(A.data[i + 2] - B.data[i + 2]) > tolerance) diff++
  return diff / (A.width * A.height)
}

export const saveRef = (name, skeleton, png) => { mkdirSync(REF, { recursive: true }); writeFileSync(join(REF, `${name}.json`), JSON.stringify(skeleton, null, 0).replace(/","/g, '",\n"')); writeFileSync(join(REF, `${name}.png`), png) }
export const hasRef = name => existsSync(join(REF, `${name}.json`)) && existsSync(join(REF, `${name}.png`))
export const loadRef = name => ({ skeleton: JSON.parse(readFileSync(join(REF, `${name}.json`), 'utf8')), png: readFileSync(join(REF, `${name}.png`)) })

// What a page differs by from the reference `name`: { skeleton: [...diffs], ratio }.
export function compare(name, skeleton, png) {
  const ref = loadRef(name)
  return { skeleton: skeletonDiff(ref.skeleton, skeleton), ratio: pixelRatio(ref.png, png) }
}
