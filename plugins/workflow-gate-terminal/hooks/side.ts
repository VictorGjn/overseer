// The orchestrator card's content: every check, and under it what was decided about it.
// Pure: wrapped here to the card's width, painted by canvas.tsx.
import type { Decision, Flag, LabelRecord, MissionProposal, PlanReview, Retro } from '../types'
import { recordLine } from './review.ts'

type Line = { t: string; c?: string; b?: boolean; d?: boolean }

export function wrap(text: string, width: number, indent = ''): string[] {
  width = Math.max(1, width) // a pane narrower than a card's frame: one column, never a loop that never ends
  const out: string[] = []
  let line = ''
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
    if (!word) continue
    if ((line + ' ' + word).trim().length > width && line) { out.push(line); line = indent + word }
    else line = line ? `${line} ${word}` : indent + word
    while (line.length > width) { out.push(line.slice(0, width)); line = indent + line.slice(width) }
  }
  if (line.trim()) out.push(line)
  return out.length ? out : ['']
}

const ACTION_LINE: Record<string, { c: string; label: string }> = {
  ignore: { c: '#7f848e', label: 'ignore' },
  steer: { c: '#56b6c2', label: 'steer' },
  'too-late': { c: '#e5c07b', label: 'agent had finished: handed to the main session at the run\'s end' },
  ask_human: { c: '#c678dd', label: 'asks you' },
  stop_run: { c: '#e06c75', label: 'proposes stopping the run' },
}

// Live: newest check first, each with Opus's decision (or why there is none yet).
const DELIVERED: Record<string, { mark: string; c: string }> = { yes: { mark: '✓', c: '#98c379' }, partial: { mark: '~', c: '#e5c07b' }, no: { mark: '✗', c: '#e06c75' } }

// After the run: Opus's verdict per card, and the one thing to change.
export function retroLines(retro: Retro | { pending: true } | { error: string } | undefined, w: number): Line[] {
  const inner = w - 4
  if (!retro) return []
  if ('pending' in retro) return [{ t: '⧗ Opus is writing the retro…', c: '#56b6c2' }, { t: '' }]
  if ('error' in retro) return [...wrap(`✗ retro failed: ${retro.error}`, inner).map(t => ({ t, c: '#e06c75' })), { t: '' }]
  return [
    { t: 'RETRO', c: '#56b6c2', b: true },
    ...retro.cards.flatMap(c => wrap(`${DELIVERED[c.delivered]!.mark} ${c.card} — ${c.why}`, inner).map((t, i) => ({ t: i ? '  ' + t : t, c: DELIVERED[c.delivered]!.c }))),
    ...(retro.summary ? wrap(`→ next time: ${retro.summary}`, inner).map(t => ({ t, c: '#abb2bf', b: true })) : []),
    { t: '' },
  ]
}

export function orchestratorLines(flags: Flag[], decisions: Decision[], meta: { opusCalls: number; checks: number; error?: string; retro?: Retro | { pending: true } | { error: string } }, w: number): Line[] {
  const inner = w - 4
  const verdicts = meta.retro && 'cards' in meta.retro ? meta.retro.flags : []
  const head: Line[] = [...retroLines(meta.retro, w), ...(meta.error ? [...wrap(`✗ ${meta.error}: the flags go back to Opus on its next pass (${meta.opusCalls} reads so far).`, inner).map(t => ({ t, c: '#e06c75', b: true })), { t: '' }] : [])]
  if (!flags.length) {
    return [...head,
      ...wrap('No flags yet. haiku reads each agent as it works; Opus decides on what it flags.', inner).map(t => ({ t, c: '#7f848e' })),
      { t: `${meta.checks} haiku checks · ${meta.opusCalls} Opus reads`, c: '#5c6370' },
    ]
  }
  const lines: Line[] = []
  for (const [i, f] of [...flags.entries()].reverse()) {
    const v = verdicts.find(x => x.n === i + 1)
    lines.push(...wrap(`⚠ ${f.agent ?? '?'} · ${f.kind}${v ? (v.founded ? '  ✓ founded' : '  ✗ unfounded') : ''}`, inner).map(t => ({ t, c: v && !v.founded ? '#7f848e' : '#e5c07b', b: true })))
    lines.push(...wrap(`${f.quote ? `“${f.quote}” — ` : ''}${f.why}`, inner - 2).map(t => ({ t: '  ' + t, c: '#9da5b4' })))
    const d = f.decision
    if (!d) {
      const t = !f.agentId ? '→ not sent: flagged before the orchestrator kept its queue' : f.sentAt ? '→ ⧗ Opus is reading it' : '→ ⧗ waiting for Opus (next pass ≤ 30 s)'
      lines.push({ t: `  ${t}`, c: '#5c6370' })
    } else {
      const a = ACTION_LINE[d.action] ?? { c: '#abb2bf', label: d.action }
      const sent = decisions.find(x => x.action === 'steer' && x.about === f.agentId && x.message === d.message)
      const answered = decisions.find(x => (x.action === 'ask_human' || x.action === 'stop_run') && x.about === f.agentId && x.message === d.message)
      const status = d.action === 'steer' ? (sent?.isDelivered ? ' ✓ delivered' : ' ⧗ at its next tool call')
        : answered?.answer ? ` → you: ${answered.answer}` : answered?.isAnswered ? ' → answered' : ''
      const target = d.target ? ` ${d.target}` : ''
      // Who decided: Opus, or the request-count watchdog that runs from before its removal still carry.
      const who = f.kind === 'runaway' ? '⏱ Watchdog' : '🧭 Opus'
      lines.push(...wrap(`→ ${who} ${a.label}${target}${d.message ? `: ${d.message}` : d.why ? ` — ${d.why}` : ''}${status}`, inner - 2).map(t => ({ t: '  ' + t, c: a.c, b: d.action !== 'ignore' })))
    }
    if (v?.why) lines.push(...wrap(`retro: ${v.why}`, inner - 2).map(t => ({ t: '  ' + t, c: v.founded ? '#98c379' : '#7f848e' })))
    lines.push({ t: '' })
  }
  lines.pop()
  return [...head, ...lines]
}

// Plan: the static checks, before anything runs.
export function planLines(flags: Flag[], labelOf: (f: Flag) => string, w: number, review?: PlanReview, records: Record<string, LabelRecord> = {}, labels: string[] = [], learned: { tiers?: { label: string; tier: string; from: string; why: string }[]; proposals?: MissionProposal[] } = {}): Line[] {
  const inner = w - 4
  const lines: Line[] = []
  // What past runs taught, first: the bandit's tiers, then missions Opus rewrote after a miss.
  if (learned.tiers?.length) {
    lines.push({ t: 'LEARNED TIERS · from past retros', c: '#c678dd', b: true })
    for (const t of learned.tiers) lines.push(...wrap(`${t.label}: ${t.from} → ${t.tier} · ${t.why}`, inner).map((x, i) => ({ t: i ? '  ' + x : x, c: '#e6e6e6' })))
    lines.push({ t: '' })
  }
  for (const p of learned.proposals ?? []) {
    const r = p.replay
    const status = !r ? 'not replayed yet' : r.status === 'running' ? '⧗ replaying…' : r.status === 'error' ? `replay failed: ${r.why ?? ''}` : r.better ? `✓ replay did better — ${r.why ?? ''}` : `✗ replay not better — ${r.why ?? ''}`
    lines.push({ t: `NEW MISSION · ${p.label}`, c: '#c678dd', b: true })
    lines.push(...wrap(`last run: ${p.failure}`, inner - 2).map(x => ({ t: '  ' + x, c: '#9da5b4' })))
    lines.push(...wrap(`change: ${p.why}`, inner - 2).map(x => ({ t: '  ' + x, c: '#e6e6e6' })))
    lines.push(...wrap(status, inner - 2).map(x => ({ t: '  ' + x, c: r?.better ? '#98c379' : r?.status === 'done' || r?.status === 'error' ? '#e06c75' : '#56b6c2' })))
    lines.push({ t: '' })
  }
  // Opus's review of the plan, first: it reads the missions, the static checks do not.
  if (!review || review.status === 'pending') lines.push({ t: '⧗ Opus is reviewing the plan…', c: '#56b6c2' }, { t: '' })
  else if (review.status === 'error') lines.push(...wrap(`✗ Opus review failed: ${review.error ?? ''}`, inner).map(t => ({ t, c: '#e06c75' })), { t: '' })
  else {
    lines.push({ t: review.verdict === 'ok' ? '✓ OPUS REVIEW · sound plan' : `OPUS REVIEW · ${review.items?.length ?? 0} concerns`, c: review.verdict === 'ok' ? '#98c379' : '#56b6c2', b: true })
    for (const [k, it] of (review.items ?? []).entries()) {
      lines.push(...wrap(`${it.patch ? `[${k + 1}]` : '●'} ${it.card ? `${it.card}: ` : ''}${it.issue}`, inner).map((t, i) => ({ t: i ? '  ' + t : t, c: '#e6e6e6' })))
      if (it.fix) lines.push(...wrap(`fix: ${it.fix}`, inner - 2).map(t => ({ t: '  ' + t, c: '#98c379' })))
    }
    lines.push({ t: '' })
  }
  const known = labels.filter(l => records[l])
  if (known.length) {
    lines.push({ t: 'TRACK RECORD', c: '#56b6c2', b: true })
    for (const l of known) lines.push(...wrap(`${l}: ${recordLine(records[l]!)}`, inner).map(t => ({ t, c: '#9da5b4' })))
    lines.push({ t: '' })
  }
  if (!flags.length) return [...lines, ...wrap('Static checks: nothing found. Once it runs, haiku reads each agent and Opus decides on what it flags.', inner).map(t => ({ t, c: '#98c379' }))]
  for (const f of flags) {
    lines.push(...wrap(`⚠ ${labelOf(f)} · ${f.kind}`, inner).map(t => ({ t, c: '#e5c07b', b: true })))
    lines.push(...wrap(f.why, inner - 2).map(t => ({ t: '  ' + t, c: '#9da5b4' })))
    lines.push({ t: '' })
  }
  lines.push(...wrap('Once it runs: haiku reads each agent, Opus decides on each flag.', inner).map(t => ({ t, c: '#5c6370' })))
  return lines
}

// Beside the graph when the pane is wide enough (from 110 columns), else under it.
export const sideWidth = (cols: number) => (cols >= 110 ? Math.min(60, Math.max(36, Math.floor(cols * 0.38))) : Math.min(cols - 2, 80))
export function placeSide(cols: number, graph: { width: number; height: number }): { x: number; y: number; w: number } {
  const w = sideWidth(cols)
  // Beside the graph only when both fit; a graph wider than its share pushes the card under it.
  return cols >= 110 && graph.width + w + 2 <= cols ? { x: Math.max(graph.width + 1, cols - w - 1), y: 0, w } : { x: 1, y: graph.height + 1, w: Math.min(w, cols - 2) }
}
// The columns the graph is laid out in: what the side card leaves.
export const graphCols = (cols: number) => (cols >= 110 ? cols - sideWidth(cols) - 2 : cols)
