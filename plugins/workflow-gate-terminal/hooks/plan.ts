import type { Site } from '../types'

export const TIERS = ['haiku', 'sonnet', 'opus', 'fable'] as const

const LITERAL = (key: string) => new RegExp(`\\b${key}\\s*:\\s*(['"\`])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1`)

// One row per agent() call site: label, model (with the offset of its literal, for splicing),
// phase, purpose (first sentence of a literal prompt) and whether it sits in a fan-out.
// ponytail: regex over a window up to the next agent(), not an AST. The browser editor
// (acorn) stays the full view; add a parser here if labels start landing on the wrong site.
export function extract(src: string): { name: string; sites: Site[] } {
  const name = src.match(/\bname\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? 'workflow'
  const starts = [...src.matchAll(/\bagent\(/g)].map(m => m.index!)
  const sites = starts.map((at, i): Site => {
    const end = starts[i + 1] ?? Math.min(src.length, at + 4000)
    const win = src.slice(at, end)
    const label = win.match(LITERAL('label'))?.[2]
    const phase = win.match(LITERAL('phase'))?.[2]
    const m = win.match(/\bmodel\s*:\s*(['"])(haiku|sonnet|opus|fable)\1/)
    const prompt = win.slice(6).match(/^\s*(['"`])((?:(?!\1)[^\\]|\\.)*)/)?.[2]
    const purpose = prompt ? prompt.replace(/\$\{[^}]*\}/g, '…').replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0]!.slice(0, 140) : '(prompt built at runtime)'
    return {
      label: label ?? `agent #${i + 1}`,
      phase,
      purpose,
      model: m?.[2],
      modelAt: m ? at + m.index! + m[0].lastIndexOf(m[2]!) : undefined,
      isFanOut: isInsideFanOut(src, at),
    }
  })
  return { name, sites }
}

// True when agent() sits inside a still-open .map( / parallel( / pipeline( call.
function isInsideFanOut(src: string, at: number): boolean {
  const opener = [...src.slice(0, at).matchAll(/(?:\.map|\bparallel|\bpipeline)\(/g)].at(-1)
  if (!opener) return false
  let depth = 0
  for (const c of src.slice(opener.index! + opener[0].length - 1, at)) depth += c === '(' ? 1 : c === ')' ? -1 : 0
  return depth > 0
}

// Applies model choices by splicing the literal in place, from the end so offsets hold.
// Untouched bytes stay identical, which the gate's content fingerprint needs.
export function splice(src: string, sites: Site[], models: Record<number, string>): string {
  return sites
    .map((s, i) => ({ s, to: models[i] }))
    .filter(({ s, to }) => s.modelAt !== undefined && to && to !== s.model)
    .sort((a, b) => b.s.modelAt! - a.s.modelAt!)
    .reduce((out, { s, to }) => out.slice(0, s.modelAt) + to + out.slice(s.modelAt! + s.model!.length), src)
}
