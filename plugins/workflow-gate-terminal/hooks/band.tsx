// One band above the prompt, the same look in every mod: a coloured name chip, the key figures,
// the actions on the right, and a chevron that opens a framed detail underneath (an accordion).
// ponytail: copied as-is into each mod (a mod cannot import another's files); keep the copies identical.
import type { Color, Elements, RenderElement, RenderSurface } from 'claude-code'
import { isTerminal } from './kit/surface.ts'

export type Seg = string | { t: string; c?: Color; b?: boolean; d?: boolean }
export type BandAction = { key: string; label: string; onPress: () => void; primary?: boolean; hotkey?: string }
export type BandSpec = {
  id: string // unique among all mods: the keys of every element derive from it
  icon: string
  name: string
  color: Color // the chip and the frame
  summary: Seg[] // the collapsed line, after the chip
  open: boolean
  onToggle: () => void
  actions?: BandAction[]
  detail?: RenderElement[] // the rows shown when open; no chevron without them
  tone?: 'ok' | 'warn' | 'alert' // tints the chip: a band that needs the person stands out
  surface: RenderSurface // e.surface, required: the terminal draws a colour block behind the name, the others their plain name in colour
  compact?: boolean // a sub-line under activity-band's line (see underActivity in each register.tsx): no chip, same figures and buttons
  visual?: RenderElement // drawn on the line itself, closed or open, before the actions: a Raster on the terminal, an Svg elsewhere
}


// A soft palette for a command center, defined in OKLCH (even lightness, low chroma) and turned into
// hex for the terminal. Named colours given to a band (magenta, red, green…) map onto it.
export function oklch(l: number, c: number, h: number): string {
  const hr = (h * Math.PI) / 180
  const [L, a, b] = [l, c * Math.cos(hr), c * Math.sin(hr)]
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_]
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
  return `#${lin.map(x => Math.round(Math.max(0, Math.min(1, gamma(x))) * 255).toString(16).padStart(2, '0')).join('')}`
}
export const PALETTE = {
  accent: oklch(0.74, 0.07, 295), // lavender: the overseer, frames
  info: oklch(0.74, 0.06, 235), // steel blue: sessions, worktrees
  ok: oklch(0.78, 0.07, 150), // sage: done, clean
  warn: oklch(0.82, 0.08, 85), // soft amber: attention
  alert: oklch(0.72, 0.10, 28), // soft coral: needs you
  night: oklch(0.70, 0.07, 265), // dusk blue: night mode
  muted: oklch(0.62, 0.02, 260), // slate: secondary
}
// The graph's lanes: six hues at one lightness and chroma, so no lane shouts.
export const LANES = [295, 200, 150, 85, 25, 340].map(h => oklch(0.75, 0.07, h))
const NAMED: Record<string, string> = { magenta: PALETTE.accent, cyan: PALETTE.info, blue: PALETTE.night, green: PALETTE.ok, yellow: PALETTE.warn, red: PALETTE.alert, gray: PALETTE.muted, grey: PALETTE.muted }
export const soft = (c?: Color): Color | undefined => (c === undefined ? undefined : NAMED[c as string] ?? c)

const TONE: Record<string, Color> = { warn: PALETTE.warn, alert: PALETTE.alert }

export function band(els: Pick<Elements['terminal'], 'Box' | 'Button' | 'Text'>, s: BandSpec): RenderElement {
  const { Box, Button, Text } = els
  const isNative = !isTerminal(s.surface) // desktop, mobile, vscode: their own controls, no block of colour behind the name
  const chip = TONE[s.tone ?? ''] ?? soft(s.color)!
  const hasDetail = !!s.detail?.length
  return (
    <Box key={`${s.id}-band`} flexDirection="column">
      <Box key={`${s.id}-row`} justifyContent="space-between">
        <Box key={`${s.id}-left`} flexShrink={1}>
          {s.compact
            ? <Text key={`${s.id}-chip`} color={chip} bold>{`  ↳ ${s.icon} ${s.name}`}</Text>
            : isNative
            ? <Text key={`${s.id}-chip`} color={chip} bold>{`${s.icon} ${s.name}`}</Text>
            : <Text key={`${s.id}-chip`} backgroundColor={chip} color="black" bold>{` ${s.icon} ${s.name.toUpperCase()} `}</Text>}
          <Text key={`${s.id}-sum`} wrap="truncate-end">
            {' '}
            {s.summary.map((g, i) => (typeof g === 'string'
              ? <Text key={`${s.id}-s${i}`} dimColor>{g}</Text>
              : <Text key={`${s.id}-s${i}`} {...(g.c ? { color: soft(g.c) } : {})} {...(g.b ? { bold: true } : {})} {...(g.d ? { dimColor: true } : {})}>{g.t}</Text>))}
          </Text>
        </Box>
        {s.visual ? <Box key={`${s.id}-visual`} flexShrink={0} marginLeft={1}>{s.visual}</Box> : null}
        <Box key={`${s.id}-right`} flexShrink={0}>
          {(s.actions ?? []).map(a => <Button key={`${s.id}-${a.key}`} label={a.label} {...(a.primary ? { variant: 'primary' as const } : {})} {...(a.hotkey ? { hotkey: a.hotkey } : {})} onPress={a.onPress} />)}
          {hasDetail ? <Button key={`${s.id}-toggle`} label={s.open ? '▾' : '▸'} plain onPress={s.onToggle} /> : null}
        </Box>
      </Box>
      {s.open && hasDetail
        ? <Box key={`${s.id}-detail`} flexDirection="column" borderStyle="round" borderColor={soft(s.color)} paddingX={1}>{s.detail}</Box>
        : null}
    </Box>
  )
}

// A gauge for a share: ▰▰▰▱▱▱, light enough to sit in a line of text on any surface.
export const gauge = (frac: number, w = 16) => {
  const f = Math.max(0, Math.min(w, Math.round(frac * w)))
  return `${'▰'.repeat(f)}${'▱'.repeat(w - f)}`
}
