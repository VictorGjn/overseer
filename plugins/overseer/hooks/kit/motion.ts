// Motion for the desktop's Svg: every redraw hands the surface a new source, so a CSS transition has no
// state before. The mod keeps what moved (`moved`, in an atom of its own) and writes, for what changed,
// a SMIL "from → to" that starts at `beginAt(age)` and freezes. Nothing ticks on the plugin's side.
// ponytail: copied as-is into each mod (a mod cannot import another's files); check.sh keeps the copies identical.
// Pure: no atom, no $, no clock read here (b000042: a shared file reading state through $ unloaded every mod).

// Durations, ms: hover and focus; selection and check; state change, drawn edge, fan-out; camera.
export const MS = { fast: 120, base: 240, slow: 420, camera: 650 } as const
// Curves as SMIL keySplines (cubic-bezier(...) in CSS): standard, emphasised, camera in-out.
export const EASE = { std: '.2 0 0 1', emph: '.3 0 0 1', camera: '.65 0 .35 1' } as const
export const spline = (ease: string = EASE.std) => `calcMode="spline" keyTimes="0;1" keySplines="${ease}"`

// What moved: the value before, the value now, and when it changed (engine ms). Plain JSON, so an atom holds it.
export type Moved<T> = { from: T; to: T; at: number }

// The next Moved when the value is `next` at `now`: unchanged while the value is the same, so `at` keeps the
// first instant of the change. The first value (an atom starts at null) has nothing before it: from = to, at 0.
export function move<T>(m: Moved<T> | null | undefined, next: T, now: number, same: (a: T, b: T) => boolean = Object.is): Moved<T> {
  if (!m) return { from: next, to: next, at: 0 }
  return same(m.to, next) ? m : { from: m.to, to: next, at: now }
}

// How long ago the change was, ms; a value that never changed is old.
export const ageOf = (m: Moved<unknown> | null | undefined, now: number) => (m && m.at > 0 ? Math.max(0, now - m.at) : Infinity)

// SMIL `begin` for an animation of a change `age` ms old that starts `delay` ms after it: a source redrawn
// mid-flight resumes the motion where it was. Lot 0: a desktop frame starts its clock when shown, a little
// after the hook computed `age`; invisible for transitions of ≤ 420 ms, so never redraw during a long one.
export const beginAt = (age: number, delay = 0) => `${((delay - age) / 1000).toFixed(3)}s`

// Still moving at `age`: what decides whether to write the animation or the final state alone.
export const isMoving = (age: number, dur: number, delay = 0) => age < delay + dur

type Box = { x: number; y: number; w: number; h: number }
const f = (n: number) => +n.toFixed(2)

// A ripple: an outline that grows by `grow` and fades, once. Its colour comes from `cls` (SMIL reads no CSS
// variable); nothing once the change is older than the ripple.
export function halo(b: Box, age: number, o: { cls?: string; rx?: number; grow?: number; dur?: number; delay?: number } = {}): string {
  const { cls = 'halo', rx = 10, grow = 9, dur = MS.slow, delay = 0 } = o
  if (!isMoving(age, dur, delay)) return ''
  const a = (attr: string, from: number, to: number) => `<animate attributeName="${attr}" from="${f(from)}" to="${f(to)}" begin="${beginAt(age, delay)}" dur="${dur}ms" ${spline()} fill="freeze"/>`
  return `<rect class="${cls}" x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" rx="${rx}" fill="none" opacity="0">`
    + `<animate attributeName="opacity" from="0.9" to="0" begin="${beginAt(age, delay)}" dur="${dur}ms" ${spline()} fill="freeze"/>`
    + a('x', b.x, b.x - grow) + a('y', b.y, b.y - grow) + a('width', b.w, b.w + 2 * grow) + a('height', b.h, b.h + 2 * grow) + '</rect>'
}

// A path that draws itself from start to end (pathLength 1), once; the plain path once it is drawn.
export function drawOn(d: string, age: number, o: { cls?: string; attrs?: string; dur?: number; delay?: number } = {}): string {
  const { cls = 'draw', attrs = '', dur = MS.slow, delay = 0 } = o
  const head = `<path class="${cls}" d="${d}" fill="none"${attrs ? ' ' + attrs : ''}`
  if (!isMoving(age, dur, delay)) return `${head}/>`
  return `${head} pathLength="1" stroke-dasharray="1" stroke-dashoffset="1">`
    + `<animate attributeName="stroke-dashoffset" from="1" to="0" begin="${beginAt(age, delay)}" dur="${dur}ms" ${spline(EASE.emph)} fill="freeze"/></path>`
}

// Tokens running along a live edge: a comet of three dots, speeding up then braking, in a loop. A loop has
// no change to resume, so `phase` (ms) only staggers comets on one edge.
export function comet(d: string, o: { cls?: string; dur?: number; phase?: number } = {}): string {
  const { cls = 'tok', dur = 1100, phase = 0 } = o
  return ([[3.4, 1, 0], [2.4, 0.5, 60], [1.6, 0.25, 120]] as const).map(([r, op, lag]) =>
    `<circle class="${cls}" r="${r}" opacity="${op}"><animateMotion path="${d}" dur="${dur}ms" begin="${beginAt(lag, phase)}" repeatCount="indefinite" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines=".4 0 .2 1"/></circle>`).join('')
}
