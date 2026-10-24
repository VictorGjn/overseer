// Where a drawing lands: which element table, how much room, whether a pane is a sidebar.
// ponytail: copied as-is into each mod (a mod cannot import another's files); check.sh keeps the copies identical.
import type { Elements, RenderSurface, ResolveInput } from 'claude-code'

// The element table, tagged by its surface so a narrow on `t.surface` reaches what only one surface has:
// Raster and Image on the terminal, Svg on desktop, mobile and vscode, Client on terminal and desktop,
// Input and Select everywhere but mobile.
export type Table = { [P in RenderSurface]: { surface: P; el: Elements[P] } }[RenderSurface]
// The caller resolves: $ never crosses an import, so the call site reads table(e, $.ui.resolve(e)).
export function table(e: ResolveInput, el: Elements[RenderSurface]): Table {
  return { surface: e.surface, el } as Table
}

// The terminal paints its own chrome (colour blocks, ▰▱ text gauges); the others draw native controls.
export const isTerminal = (surface: RenderSurface) => surface === 'terminal'
export const hasSvg = (surface: RenderSurface) => surface !== 'terminal'

// Semantic zoom on the body's width (bodyColumns of an AbovePrompt or a Pane): a compact list under 60,
// cards from 60, and from 110 the room a docked pane has beside the transcript.
export const ZOOM = { cards: 60, wide: 110 } as const
export type Zoom = 'compact' | 'cards' | 'wide'
export const zoomOf = (bodyColumns: number): Zoom => (bodyColumns < ZOOM.cards ? 'compact' : bodyColumns < ZOOM.wide ? 'cards' : 'wide')

// Whether a pane sits beside the transcript (a sidebar), not over it. A Pane knows where it was seated;
// anything else reads the layout from viewport.isFullscreen. Unknown (no viewport yet, a remote surface
// that has not reported) is undefined, not false: the caller picks the cautious side.
export function isSidePane(e: { component: string; props?: unknown; viewport?: { isFullscreen?: boolean } }): boolean | undefined {
  const placement = e.component === 'Pane' ? (e.props as { placement?: string } | undefined)?.placement : undefined
  if (placement) return placement === 'dock'
  return e.viewport?.isFullscreen
}
