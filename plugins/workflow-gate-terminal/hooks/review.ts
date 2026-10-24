// Opus around a run: a review of the plan before approval, and a retro once it has run.
// Prompts, parsers and the per-label track record here; the plumbing in register.tsx.
import type { Flag, LabelRecord, PlanReview, Retro } from '../types'

// ---------------------------------------------------------------- the journal

export type JournalAgent = { agentId: string; label?: string; phase?: string; result?: string }

// <run transcript dir>/journal.jsonl: `started` (agentId, label) and `result` (agentId, result) lines.
export function readJournal(text: string): Map<string, JournalAgent> {
  const out = new Map<string, JournalAgent>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const d = JSON.parse(line)
      if (!d.agentId) continue
      const a: JournalAgent = out.get(d.agentId) ?? { agentId: d.agentId }
      if (d.type === 'started') Object.assign(a, { label: d.label, phase: d.phase })
      if (d.type === 'result') a.result = typeof d.result === 'string' ? d.result : JSON.stringify(d.result, null, 1)
      out.set(d.agentId, a)
    } catch {}
  }
  return out
}

// What the Workflow tool said when it launched the run.
export function launchInfo(text: string): { taskId?: string; runId?: string; dir?: string } {
  return {
    taskId: text.match(/Task ID:\s*(\S+)/)?.[1],
    runId: text.match(/Run ID:\s*(wf_[\w-]+)/)?.[1],
    dir: text.match(/Transcript dir:\s*(\S+)/)?.[1],
  }
}

const firstJson = (text: string) => { const m = text.match(/\{[\s\S]*\}/); if (!m) return undefined; try { return JSON.parse(m[0]) } catch { return undefined } }

// ---------------------------------------------------------------- plan review (before approval)

export const REVIEW_SYSTEM = `You review a multi-agent workflow script BEFORE a human approves it to run. Be the senior engineer who saves the run: find what will make it waste money or produce a wrong answer.
Quality: missions too vague to succeed; a verifier no stronger than what it checks; a decision on unstructured output; fan-outs whose results are never reconciled; missing context an agent needs; steps that duplicate each other.
Cost (agents re-read their whole context on every model request, so long loops on big contexts are what costs): opus or fable on mechanical work; an output that feeds a decision or a later agent without a "schema"; no "agentType", so the agent carries every tool of the session in its context; a whole upstream result passed raw (JSON.stringify of a large result) where a summary would do; an open-ended exploration mission with no stopping rule.
Static checks already ran (listed); do not repeat them unless you add something.
At most 5 items, most important first. If the plan is sound, say so with no items.
When a fix is one of these, add it as "patch" so the human can apply it in one click: {"model":"haiku|sonnet|opus"} to change the card's tier; {"missionAppend":"<one or two sentences to add to its mission>"}; {"cascade":true} for a mechanical card that should try haiku first and escalate only when a judge rejects the answer.
Answer ONLY JSON: {"verdict":"ok|concerns","items":[{"card":"<agent label>","issue":"<max 160 chars>","fix":"<max 160 chars>","patch":{...}}]}`

export function reviewPrompt(source: string, cards: { label: string; model: string; mission: string }[], flags: Flag[], records: Record<string, LabelRecord>, teamLessons: string[] = []): string {
  const track = cards.map(c => records[c.label]).filter(Boolean)
  return [
    `CARDS:\n${cards.map(c => `- ${c.label} · ${c.model}: ${c.mission.slice(0, 300)}`).join('\n')}`,
    flags.length ? `STATIC CHECKS:\n${flags.map(f => `- ${f.kind}: ${f.why}`).join('\n')}` : 'STATIC CHECKS: none',
    track.length ? `TRACK RECORD OF THESE LABELS (past runs on this machine):\n${cards.filter(c => records[c.label]).map(c => `- ${c.label}: ${recordLine(records[c.label]!)}`).join('\n')}` : '',
    teamLessons.length ? `TEAM LESSONS ON DESIGNING WORKFLOWS (learned from the team's past runs; flag where this plan goes against one):\n${teamLessons.map(l => `- ${l}`).join('\n')}` : '',
    `SCRIPT:\n${source.slice(0, 40000)}`,
  ].filter(Boolean).join('\n\n')
}

// Only the three one-click edits survive: a known tier, a short mission addition, a cascade.
function patchOf(p: { model?: unknown; missionAppend?: unknown; cascade?: unknown } | undefined) {
  if (!p || typeof p !== 'object') return undefined
  const out: { model?: string; missionAppend?: string; cascade?: boolean } = {}
  if (typeof p.model === 'string' && ['haiku', 'sonnet', 'opus'].includes(p.model)) out.model = p.model
  if (typeof p.missionAppend === 'string' && p.missionAppend.trim()) out.missionAppend = p.missionAppend.trim().slice(0, 400)
  if (p.cascade === true) out.cascade = true
  return Object.keys(out).length ? out : undefined
}

export function parseReview(text: string): Pick<PlanReview, 'verdict' | 'items'> | undefined {
  const d = firstJson(text)
  if (!d || (d.verdict !== 'ok' && d.verdict !== 'concerns')) return undefined
  const items = Array.isArray(d.items) ? d.items.filter((x: { issue?: unknown }) => x && typeof x.issue === 'string').slice(0, 5)
    .map((x: { card?: unknown; issue: string; fix?: unknown; patch?: { model?: unknown; missionAppend?: unknown; cascade?: unknown } }) => ({
      card: String(x.card ?? '').slice(0, 60),
      issue: x.issue.slice(0, 200),
      fix: typeof x.fix === 'string' ? x.fix.slice(0, 200) : undefined,
      patch: patchOf(x.patch),
    })) : []
  return { verdict: items.length ? 'concerns' : d.verdict, items }
}

// ---------------------------------------------------------------- retro (after the run)

export const RETRO_SYSTEM = `A multi-agent workflow run just finished. Judge it from what each agent was asked and what it returned.
For each card: did it deliver its mission? "yes", "partial" or "no", with why.
For each flag a cheap checker raised during the run: was it founded (a real fault in the agent's work) or not?
Then one sentence: what to change in this workflow next time.
Last, up to 3 lessons about DESIGNING WORKFLOWS IN GENERAL that this run teaches — how to structure them, pick model tiers, write missions, verify, keep cost down — useful to someone writing a different workflow on a different project. No project name, product, file, path, code, person or customer; nothing true only of this project. None when nothing generalizes.
Answer ONLY JSON: {"cards":[{"card":"<label>","delivered":"yes|partial|no","why":"<max 140 chars>"}],"flags":[{"n":<flag number>,"founded":true|false,"why":"<max 120 chars>"}],"summary":"<max 200 chars>","patterns":[{"topic":"structure|models|missions|verification|cost","lesson":"<max 200 chars>","when":"<when it applies, max 120 chars>"}]}`

export function retroPrompt(name: string, cards: { label: string; mission: string; results: string[] }[], flags: Flag[]): string {
  return [
    `RUN: ${name}`,
    ...cards.map(c => `CARD ${c.label}\nMISSION: ${c.mission.slice(0, 800)}\nRESULTS:\n${c.results.map((r, i) => `[${i + 1}] ${r.slice(0, 1500)}`).join('\n') || '(none)'}`),
    `FLAGS:\n${flags.map((f, i) => `${i + 1}. ${f.agent ?? '?'} · ${f.kind}${f.quote ? ` “${f.quote}”` : ''}: ${f.why}${f.decision ? ` (Opus: ${f.decision.action})` : ''}`).join('\n') || '(none)'}`,
  ].join('\n\n')
}

export function parseRetro(text: string, flagCount: number): Omit<Retro, 'at'> | undefined {
  const d = firstJson(text)
  if (!d || !Array.isArray(d.cards)) return undefined
  const ok = ['yes', 'partial', 'no']
  return {
    cards: d.cards.filter((c: { card?: unknown; delivered?: unknown }) => c && typeof c.card === 'string' && ok.includes(String(c.delivered)))
      .map((c: { card: string; delivered: 'yes' | 'partial' | 'no'; why?: unknown }) => ({ card: c.card.slice(0, 60), delivered: c.delivered, why: String(c.why ?? '').slice(0, 160) })),
    flags: (Array.isArray(d.flags) ? d.flags : []).filter((f: { n?: unknown; founded?: unknown }) => f && Number.isInteger(f.n) && (f.n as number) >= 1 && (f.n as number) <= flagCount && typeof f.founded === 'boolean')
      .map((f: { n: number; founded: boolean; why?: unknown }) => ({ n: f.n, founded: f.founded, why: String(f.why ?? '').slice(0, 140) })),
    summary: String(d.summary ?? '').slice(0, 240),
    patterns: d.patterns, // checked and filtered by the caller (team.ts parsePatterns), which knows the project's words
  }
}

// ---------------------------------------------------------------- track record per label

// Folds one retro into the per-label record kept across sessions.
export function mergeRecords(records: Record<string, LabelRecord>, retro: Omit<Retro, 'at'>, flags: Flag[], at: number): Record<string, LabelRecord> {
  const out = { ...records }
  const bump = (label: string) => (out[label] = { ...(out[label] ?? { runs: 0, yes: 0, partial: 0, no: 0, founded: 0, unfounded: 0 }), lastAt: at })
  for (const c of retro.cards) { const r = bump(c.card); r.runs++; r[c.delivered]++ }
  for (const f of retro.flags) {
    const label = flags[f.n - 1]?.agent
    if (!label) continue
    const r = bump(label)
    if (f.founded) r.founded++
    else r.unfounded++
  }
  return out
}

export const recordLine = (r: LabelRecord) =>
  `delivered ${r.yes}/${r.runs}${r.partial ? ` (+${r.partial} partial)` : ''} past runs · checks founded ${r.founded}/${r.founded + r.unfounded}`

// ---------------------------------------------------------------- readable card descriptions

export type Summary = { goal: string; does: string; delivers: string }

export const SUMMARY_SYSTEM = `You explain the agents of a multi-agent workflow to a product lead who will approve it. For each agent, from its mission:
- goal: the target it pursues, the outcome that means it succeeded (max 20 words)
- does: how it gets there, concretely (max 30 words)
- delivers: what it hands to the next step (max 20 words)
Plain words, no code, no jargon, no restating the mission's wording. Placeholders like ⟨x⟩ are values filled at run time: say what they stand for.
Answer ONLY JSON: {"cards":[{"id":"<id as given>","goal":"…","does":"…","delivers":"…"}]}`

export const summaryPrompt = (cards: { id: string; label: string; mission: string }[]) =>
  cards.map(c => `AGENT ${c.id} (${c.label}):\n${c.mission.replace(/\\n/g, '\n').slice(0, 1500)}`).join('\n\n')

export function parseSummaries(text: string, ids: readonly string[]): Record<string, Summary> {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return {}
  try {
    const out: Record<string, Summary> = {}
    for (const c of JSON.parse(m[0]).cards ?? []) {
      if (!c || !ids.includes(c.id) || typeof c.goal !== 'string') continue
      out[c.id] = { goal: c.goal.slice(0, 200), does: String(c.does ?? '').slice(0, 260), delivers: String(c.delivers ?? '').slice(0, 200) }
    }
    return out
  } catch {
    return {}
  }
}

// A stable key for a mission: same label and text, same description, across sessions.
export function missionKey(label: string, mission: string): string {
  let h = 2166136261
  for (const ch of label + '\u0000' + mission) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return (h >>> 0).toString(16)
}
