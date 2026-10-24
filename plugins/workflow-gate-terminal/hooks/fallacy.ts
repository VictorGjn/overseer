// Fallacy check, two halves.
//  - planFlags: before approval, from the graph alone (deterministic, free).
//  - the live half: what a run's agents write and think, read by a cheap model as it streams; the
//    prompt and the parser live here, the plumbing (queue, timer, budget) in register.tsx.

import type { Flag } from '../types'
import { tidyLabel } from './layout.ts'

type Node = { id: string; label: string; labelDynamic?: boolean; model?: string; mission?: string; assembled?: string; fanOut?: unknown; schemaKeys?: string[] | null; line?: number }
type G = {
  nodes: Node[]
  edges: { source: string; target: string; via?: string; mayContainNull?: boolean }[]
  flow: { nodes: { id: string; kind: string; label: string }[]; edges: { source: string; target: string }[] }
}

export const REVIEWS = /\b(verif\w*|review\w*|audit\w*|check\w*|judge|critic\w*|validat\w*|grade)\b/i
export const REVIEWER_ROLE = /\byou are (?:the|an?)\b[\w\s-]{0,40}\b(verifier|reviewer|auditor|critic|judge|checker|grader)\b/i
// Fan-outs that answer (opinions, findings) rather than act (write code, files): only those must be reconciled.
const ANSWERS = /\b(review\w*|analy\w*|research\w*|assess\w*|evaluat\w*|find\w*|recommend\w*|propos\w*|investigat\w*|audit\w*|critique|judge)\b/i
const nameOf = (n: Node) => (n.labelDynamic ? tidyLabel(n.label) : n.label)
// The role sentence only: later sentences name other agents' work ("repair what the verifier found").
const textOf = (n: Node) => (n.assembled || n.mission || '').slice(0, 300).split(/(?<=[.!?])\s/)[0] ?? ''

export function planFlags(g: G, source = ''): Flag[] {
  const out: Flag[] = []
  const byId = new Map(g.nodes.map(n => [n.id, n]))
  const tier = (n?: Node) => n?.model ?? 'inherited'

  for (const n of g.nodes) {
    // Self-review: a checker on the same tier as the work it checks shares its blind spots.
    if (REVIEWS.test(nameOf(n)) || REVIEWER_ROLE.test(textOf(n))) {
      // What it checks: agents whose results it reads, else the agents that ran just before it.
      const fed = g.edges.filter(e => e.target === n.id).map(e => e.source)
      const before = g.flow.edges.filter(e => e.target === n.id).map(e => e.source)
      const checked = [...new Set(fed.length ? fed : before)].map(id => byId.get(id)).filter(Boolean) as Node[]
      const same = checked.filter(p => tier(p) === tier(n) && tier(n) !== 'inherited')
      if (same.length) out.push({ cardId: n.id, kind: 'self-review', why: `checks ${same.map(nameOf).join(', ')} on the same tier (${tier(n)}): same blind spots` })
    }
    // A fan-out whose results nobody reads: N answers, never reconciled.
    if (n.fanOut && !g.edges.some(e => e.source === n.id) && (ANSWERS.test(nameOf(n)) || ANSWERS.test(textOf(n)))) {
      out.push({ cardId: n.id, kind: 'unreconciled fan-out', why: 'its results feed no later agent: contradictions between them go unseen' })
    }
  }

  // Branches on what an agent said: free text with no schema, or a value that may be null.
  for (const d of g.flow.nodes.filter(x => x.kind === 'decision')) {
    const name = d.label.match(/^[!(\s]*([A-Za-z_$][\w$]*)/)?.[1]
    if (!name) continue
    const feeds = g.edges.filter(e => e.via === name)
    // The agent bound to that name: `const check = await agent(...)`, the first call site at or after it.
    const bound = source.match(new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*await\\b`))
    const line = bound ? source.slice(0, bound.index).split('\n').length : undefined
    const site = line === undefined ? undefined : g.nodes.filter(n => (n.line ?? 0) >= line).sort((a, b) => (a.line ?? 0) - (b.line ?? 0))[0]
    const producers = [...new Set([...feeds.map(e => e.source), ...(site ? [site.id] : [])])].map(id => byId.get(id)).filter(Boolean) as Node[]
    const loose = producers.filter(p => !p.schemaKeys?.length)
    if (loose.length) out.push({ cardId: d.id, kind: 'unverified premise', why: `branches on ${loose.map(nameOf).join(', ')}'s output, which has no schema: the field may not exist` })
    else if (feeds.some(e => e.mayContainNull)) out.push({ cardId: d.id, kind: 'null premise', why: `${name} may be null when an agent fails: the branch then takes "no" silently` })
  }
  return out
}

export const LIVE_SYSTEM = `You audit an AI agent's reasoning while it works. Flag only CLEAR instances of:
- unverified assumption: states as fact something it has not checked (a file, an API, a number, a user intent)
- hasty generalization: concludes broadly from one or two cases
- circular reasoning: its evidence presupposes its conclusion
- false dilemma: treats two options as the only ones
- confirmation bias: dismisses or skips evidence against its current idea
- post hoc: assumes causation from sequence
- scope drift: does work its mission did not ask for
Most excerpts contain none: then answer []. Never flag style, tone, or a hypothesis it says it will verify.
Severity: "high" when, left alone, it will change what the agent delivers (a wrong result, a skipped or dismissed check, the wrong file, a claim of success it has not shown); "low" when the reasoning is loose but the deliverable is unlikely to suffer.
Answer ONLY a JSON array: [{"kind": "<one of the kinds above>", "quote": "<verbatim, max 120 chars>", "why": "<max 100 chars>", "severity": "high|low"}]`

export function livePrompt(mission: string, excerpt: string): string {
  return `MISSION (what the agent was asked):\n${mission.slice(0, 600)}\n\nNEW REASONING AND OUTPUT (latest first-hand text from the agent):\n${excerpt}`
}

// The model's reply, read defensively: the first JSON array in it, entries with a kind and a why.
export function parseFlags(text: string): { kind: string; quote?: string; why: string; severity: 'high' | 'low' }[] {
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0])
    return Array.isArray(arr)
      ? arr.filter(x => x && typeof x.kind === 'string' && typeof x.why === 'string').slice(0, 3)
        .map(x => ({ kind: String(x.kind).slice(0, 40), why: String(x.why).slice(0, 140), quote: typeof x.quote === 'string' ? x.quote.slice(0, 140) : undefined, severity: x.severity === 'low' ? 'low' as const : 'high' as const })) // unrated counts as high: never lose a real one
      : []
  } catch {
    return []
  }
}

// The check band's rows: the same remark said twice counts once, high severity first, newest first, at most `max`.
export function checkRows(flags: Flag[], max = 5): { rows: Flag[]; more: number } {
  const seen = new Set<string>()
  const uniq = [...flags].reverse().filter(f => { const k = `${f.kind}|${f.why}`; return !seen.has(k) && !!seen.add(k) })
  const ranked = [...uniq.filter(f => f.severity !== 'low'), ...uniq.filter(f => f.severity === 'low')]
  return { rows: ranked.slice(0, max), more: Math.max(0, ranked.length - max) }
}
