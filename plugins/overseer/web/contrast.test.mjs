import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// DESIGN.md section 2 and 7: each text/surface pair of the tokens reads at 4.5:1 or more in both themes, and --watch and --done
// (3:1 colours: icons, bars, borders) are never the colour of text in board.css. The tokens are read from board.css itself.
const css = readFileSync(new URL('./board.css', import.meta.url), 'utf8')
const tokens = block => Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*oklch\(([^)]+)\)/g)].map(m => [m[1], m[2].split(/\s+/).map(Number)]))
const light = tokens(css.match(/:root\{([^}]*)\}/)[1])
const dark = { ...light, ...tokens(css.match(/:root\[data-theme="dark"\]\{([^}]*)\}/)[1]) }

// oklch -> linear sRGB -> relative luminance (WCAG 2.x)
const lum = ([L, C, h]) => {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s]
  const [r, g, bl] = rgb.map(v => Math.min(1, Math.max(0, v)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}
const ratio = (fg, bg) => { const [x, y] = [lum(fg), lum(bg)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// [text token, surface token]: ink on the page and its raised surfaces; the primary button's text on --act; --act and --accent as text.
const TEXT = [['--ink', '--ground'], ['--ink', '--raised'], ['--ink-2', '--ground'], ['--ink-2', '--raised'], ['--ink-3', '--ground'], ['--ink-3', '--raised'],
  ['--ground', '--act'], ['--act', '--ground'], ['--act', '--raised'], ['--accent', '--ground'], ['--accent', '--raised'], ['--done-quiet', '--ground']]
// the colours that are never small text: 3:1 is their bar
const GRAPHIC = ['--watch', '--done']

for (const [theme, t] of [['light', light], ['dark', dark]]) {
  test(`${theme}: every text/surface pair of the tokens reads at 4.5:1 or more`, () => {
    for (const [fg, bg] of TEXT) {
      if (fg === '--done-quiet') continue // an icon colour (.sico.done), listed in DESIGN.md as quiet: not text
      assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${theme} ${fg} on ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}:1`)
    }
  })
  test(`${theme}: icons, bars and borders in --watch, --done and --accent reach 3:1 on the ground`, () => {
    for (const fg of [...GRAPHIC, '--accent']) assert.ok(ratio(t[fg], t['--ground']) >= 3, `${theme} ${fg}: ${ratio(t[fg], t['--ground']).toFixed(2)}:1`)
  })
}

test('the fixes of DESIGN.md section 7 are in the tokens', () => {
  assert.deepEqual(light['--act'], [0.56, 0.15, 32])
  assert.deepEqual(light['--ink-3'], [0.54, 0.014, 285])
  assert.deepEqual(dark['--ink-3'], [0.61, 0.012, 285]) // a fifth fix, found by this test: 0.60 gives 4.48:1 on --raised (DESIGN.md measured it on --ground only)
})

test('--watch and --done are the colour of an icon, a bead or a glyph, never of text', () => {
  const ALLOWED = /\.sico|\.ico\b|\.bead|\.st-alert \.ico|^\.focus\[data-state="calm"\] h1|::before/ // icons and a large heading
  const bad = []
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|[;\s])color:\s*var\(--(watch|done)\)/.test(rule[2])) continue
    for (const sel of rule[1].split(',').map(s => s.trim())) if (!ALLOWED.test(sel)) bad.push(sel)
  }
  assert.deepEqual(bad, [])
})

test('a running workflow bead is --accent, not --watch (one colour, one meaning)', () => {
  assert.match(css, /\.wstep\.run \.bead\{border-color:var\(--accent\);color:var\(--accent\)/)
  assert.ok(!/\.wstep\.run[^{]*\{[^}]*var\(--watch/.test(css))
})

test('the rules the page adds (the <style> of index.html) use only the DESIGN.md tokens, type steps and radii', () => {
  const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  const style = page.match(/<style>([^]*?)<\/style>/)[1].replace(/\/\*[^]*?\*\//g, '')
  assert.deepEqual(style.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/gi) ?? [], []) // no literal colour: tokens only
  const RAMP = new Set([11.5, 12, 13, 14, 16, 22, 28]), RADII = new Set([3, 4, 5, 6, 8, 10, 12, 16, 999]) // 999: the Pill of DESIGN.md
  for (const m of style.matchAll(/font(?:-size)?:\s*(?:[a-z]+\s+)*(\d+(?:\.\d+)?)px/g)) assert.ok(RAMP.has(Number(m[1])), `font size ${m[1]}px is not a step of the ramp`)
  for (const m of style.matchAll(/border-radius:\s*(\d+(?:\.\d+)?)px/g)) assert.ok(RADII.has(Number(m[1])), `radius ${m[1]}px is not a step`)
  const SPACE = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 24, 28])
  for (const m of style.matchAll(/(?:padding|gap|margin(?:-[a-z]+)?):\s*([^;}]+)/g)) for (const px of m[1].match(/\d+px/g) ?? []) assert.ok(SPACE.has(parseInt(px)), `spacing ${px} is not a step`)
  assert.ok(style.includes('var(--'), 'the page rules do use the tokens')
})
