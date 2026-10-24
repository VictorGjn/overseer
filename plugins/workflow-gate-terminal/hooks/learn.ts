// What makes runs cheaper and better over time, all pure:
//  - cost: what an agent's model requests cost (workflow-gate's price table, API-equivalent $)
//  - bandit: which model tier a label should run on, learned from retros (Thompson sampling)
//  - cascade: rewrite a call site to try a cheap tier first, judged, escalating only on failure
//  - evolve: Opus rewrites a mission that under-delivered; a replay of the card judges the rewrite
import * as acorn from './vendor/acorn.mjs'

import type { BanditStats } from '../types'

// ---------------------------------------------------------------- cost

// Copied from workflow-gate hooks/cost.mjs (PRICES_AT 2026-06-24): $ per million tokens.
// ponytail: a copy, not an import (a mod cannot read outside its folder); re-copy when that table moves.
const PRICE: Record<string, { in: number; out: number; cacheRead?: number }> = {
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
}

export type Usage = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; model?: string }

export function priceOf(model = ''): { in: number; out: number; cacheRead?: number } | undefined {
  const k = model.replace(/\[1m\]$/, '').replace(/-\d{8}$/, '')
  const alias: Record<string, string> = { opus: 'claude-opus-5', fable: 'claude-fable-5-1', sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5' }
  return PRICE[alias[k] ?? k] ?? PRICE[Object.keys(PRICE).find(p => k.startsWith(p)) ?? '']
    ?? (/opus/.test(k) ? PRICE['claude-opus-5'] : /sonnet/.test(k) ? PRICE['claude-sonnet-5'] : /haiku/.test(k) ? PRICE['claude-haiku-4-5'] : /fable/.test(k) ? PRICE['claude-fable-5-1'] : undefined)
}

// One model request's cost: cache writes at 1.25× input, cache reads at 0.1× (or the published rate).
export function costOf(u: Usage | null | undefined): number {
  const p = priceOf(u?.model)
  if (!u || !p) return 0
  return ((u.input_tokens ?? 0) * p.in + (u.cache_creation_input_tokens ?? 0) * p.in * 1.25 + (u.cache_read_input_tokens ?? 0) * (p.cacheRead ?? p.in * 0.1) + (u.output_tokens ?? 0) * p.out) / 1e6
}

export const tierOf = (model = '') => (/haiku/.test(model) ? 'haiku' : /sonnet/.test(model) ? 'sonnet' : /fable/.test(model) ? 'fable' : /opus/.test(model) ? 'opus' : 'inherited')

// ---------------------------------------------------------------- bandit

const TIERS = ['haiku', 'sonnet', 'opus'] as const
// $ per agent by tier when a label has no history of its own: the medians this machine had (2026-10).
export const PRIOR_COST: Record<string, number> = { haiku: 0.33, sonnet: 3.7, opus: 10.4, fable: 9.2 }
// What a dollar is worth in quality points (quality is 0..1 per agent): opus must deliver ~0.3 more
// than haiku to be worth its price. ponytail: one global trade-off; make it per workflow if needed.
export const LAMBDA = 0.03

// Folds one retro verdict into a label's stats for the tier it ran on.
export function banditUpdate(stats: BanditStats, label: string, tier: string, quality: number, costPerAgent: number): BanditStats {
  if (!TIERS.includes(tier as never)) return stats
  const byTier = { ...(stats[label] ?? {}) }
  const s = byTier[tier] ?? { n: 0, q: 0, cost: 0 }
  byTier[tier] = { n: s.n + 1, q: s.q + quality, cost: s.cost + costPerAgent }
  return { ...stats, [label]: byTier }
}

// Seeded, so one plan shows one suggestion however often the pane redraws.
export function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// Marsaglia–Tsang gamma, then Beta(a, b) = X / (X + Y).
function gamma(k: number, r: () => number): number {
  if (k < 1) return gamma(k + 1, r) * Math.pow(r(), 1 / k)
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x = 0, v = 0
    do { const u1 = r() || 1e-12, u2 = r(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x } while (v <= 0)
    v = v * v * v
    const u = r()
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}
export const beta = (a: number, b: number, r: () => number) => { const x = gamma(a, r); return x / (x + gamma(b, r)) }

export type TierSuggestion = { tier: string; from: string; why: string; n: number }

// Thompson sampling over tiers for one label: each tier's quality ~ Beta(1 + q, 1 + n − q), the
// current tier credited one prior success (the author chose it), minus LAMBDA × its expected $.
// No suggestion until the label has 2 retros: with less, a sample says nothing. A tier that failed
// on the label (3+ tries, a third delivered or less) is not offered again.
export function suggestTier(stats: BanditStats, label: string, current: string, r: () => number): TierSuggestion | undefined {
  const byTier = stats[label] ?? {}
  const seen = Object.values(byTier).reduce((t, s) => t + s.n, 0)
  if (seen < 2) return undefined
  let best = { tier: current, u: -Infinity }
  for (const tier of TIERS) {
    const s = byTier[tier] ?? { n: 0, q: 0, cost: 0 }
    if (tier !== current && s.n >= 3 && s.q / s.n < 0.34) continue // failed on this label: not offered again
    const bonus = tier === current ? 1 : 0
    const quality = beta(1 + s.q + bonus, 1 + (s.n - s.q), r)
    const cost = s.n ? s.cost / s.n : PRIOR_COST[tier]!
    const u = quality - LAMBDA * cost
    if (u > best.u) best = { tier, u }
  }
  if (best.tier === current) return undefined
  const fmt = (t: string) => { const s = byTier[t]; return s ? `${t} ${Math.round((s.q / s.n) * 100)}% delivered over ${s.n}, $${(s.cost / s.n).toFixed(2)}/agent` : `${t} untried (prior $${PRIOR_COST[t]})` }
  return { tier: best.tier, from: current, n: seen, why: `${fmt(best.tier)} vs ${fmt(current)}` }
}

// ---------------------------------------------------------------- cascade

// The agent() call sites of a script, in source order (the order extract() numbers them a0, a1…).
export function callSpans(src: string): { start: number; end: number; args: number }[] {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true })
  const out: { start: number; end: number; args: number }[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; callee?: { type?: string; name?: string }; arguments?: unknown[]; start: number; end: number }
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'agent') out.push({ start: node.start, end: node.end, args: node.arguments?.length ?? 0 })
    for (const v of Object.values(n as Record<string, unknown>)) Array.isArray(v) ? v.forEach(walk) : walk(v)
  }
  walk(ast)
  return out.sort((a, b) => a.start - b.start)
}

export const CASCADE_HELPER = `
// Added by the terminal gate: try the cheap tier first, keep it when a judge says it did the job,
// escalate to the call's own model otherwise. Labels: <label>·try, <label>·judge.
async function __gateCascade(prompt, opts = {}, cheap = 'haiku') {
  const label = opts.label ?? 'agent'
  const tried = await agent(prompt, { ...opts, model: cheap, label: label + '·try' })
  const answer = typeof tried === 'string' ? tried : JSON.stringify(tried)
  const verdict = await agent('Judge strictly: does ANSWER fully do TASK (complete, correct, no invented facts)? Reply ok=false when unsure.\\n\\nTASK:\\n' + String(prompt).slice(0, 6000) + '\\n\\nANSWER:\\n' + String(answer).slice(0, 8000),
    { label: label + '·judge', model: 'sonnet', schema: { type: 'object', properties: { ok: { type: 'boolean' }, why: { type: 'string' } }, required: ['ok'] } })
  return verdict && verdict.ok ? tried : agent(prompt, opts)
}
`

// Wraps call site `index` (0-based, extract()'s order) in the cascade; adds the helper once, after
// the `meta` export so the script still begins with it.
export function cascade(src: string, index: number, cheap = 'haiku'): string {
  const span = callSpans(src)[index]
  if (!span) throw new Error(`no agent() call site #${index}`)
  const call = src.slice(span.start, span.end)
  const args = call.slice(call.indexOf('(') + 1, call.lastIndexOf(')')).replace(/,\s*$/, '')
  // A call with only a prompt gets an explicit empty opts so `cheap` lands in the right slot.
  let out = src.slice(0, span.start) + `__gateCascade(${args}${span.args < 2 ? ', {}' : ''}, ${JSON.stringify(cheap)})` + src.slice(span.end)
  if (!out.includes('async function __gateCascade(')) {
    const meta = out.match(/export const meta\s*=\s*\{/)
    let at = 0
    if (meta) { // after the meta object's closing brace
      let depth = 0
      for (let i = meta.index! + meta[0].length - 1; i < out.length; i++) {
        if (out[i] === '{') depth++
        else if (out[i] === '}' && --depth === 0) { at = i + 1; break }
      }
    }
    out = out.slice(0, at) + '\n' + CASCADE_HELPER + out.slice(at)
  }
  return out
}

// ---------------------------------------------------------------- evolve + replay

export const EVOLVE_SYSTEM = `An agent in a multi-agent workflow under-delivered. Rewrite its MISSION so the same agent, given the same inputs, would succeed next time.
Use what actually went wrong (the result, the retro's reason, the flags). Keep everything the mission already does right, its output format and any placeholders like ⟨…⟩ exactly. Be concrete: add the missing check, criterion or constraint; do not pad.
Answer ONLY JSON: {"mission":"<the full rewritten mission>","why":"<max 160 chars: what changed and why>"}`

export function evolvePrompt(label: string, mission: string, results: string[], why: string, flags: string[]): string {
  return [`AGENT: ${label}`, `MISSION:\n${mission}`, `WHAT IT RETURNED:\n${results.map(r => r.slice(0, 2500)).join('\n---\n') || '(nothing)'}`, `RETRO: ${why}`, flags.length ? `FLAGS DURING THE RUN:\n${flags.join('\n')}` : ''].filter(Boolean).join('\n\n')
}

export function parseEvolution(text: string): { mission: string; why: string } | undefined {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return undefined
  try {
    const d = JSON.parse(m[0])
    return typeof d.mission === 'string' && d.mission.trim().length > 20 ? { mission: d.mission.slice(0, 20000), why: String(d.why ?? '').slice(0, 200) } : undefined
  } catch {
    return undefined
  }
}

// The replay: the card's last real prompt, with its old mission swapped for the new one.
export function replayPrompt(lastPrompt: string, oldMission: string, newMission: string): string {
  const head = 'REPLAY FOR EVALUATION. Do not modify any file, do not commit, push, send or delete anything: read and reason only, then return your answer.\n\n'
  const body = oldMission && lastPrompt.includes(oldMission) ? lastPrompt.replace(oldMission, newMission) : `${newMission}\n\n(Context from the original run follows.)\n\n${lastPrompt}`
  return head + body
}

export const JUDGE_SYSTEM = `Compare two answers by the same agent to the same task: OLD (from a real run, judged under-delivered for the reason given) and NEW (a replay with a rewritten mission). Is NEW clearly better at the task, without new errors?
Answer ONLY JSON: {"better": true|false, "why": "<max 160 chars>"}`

export const judgePrompt = (task: string, failure: string, oldAnswer: string, newAnswer: string) =>
  `TASK:\n${task.slice(0, 4000)}\n\nWHY OLD UNDER-DELIVERED: ${failure}\n\nOLD:\n${oldAnswer.slice(0, 5000)}\n\nNEW:\n${newAnswer.slice(0, 5000)}`

export function parseJudge(text: string): { better: boolean; why: string } | undefined {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return undefined
  try { const d = JSON.parse(m[0]); return typeof d.better === 'boolean' ? { better: d.better, why: String(d.why ?? '').slice(0, 200) } : undefined } catch { return undefined }
}
