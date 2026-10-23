import type { Oversight, Watched } from '../types'

// A watched worker that ran /clear goes on under a new session id (lot 56): the lead follows it there, with its label,
// its task and everything it keeps about it. Pure, so it is tested without a machine.

export type Proc = { pid?: number; procStart?: string }
export type Cleared = { old: string; new: string; at: number }

// Where a watched session went: its own mod's note (~/.claude/overseer/cleared/<old>.json, written on session.end reason
// clear) first; else, once its id has left the registry, the registry entry of the same process: same pid AND same start
// time (a pid can be reused; a cwd is shared by many sessions). Undefined: it did not move.
export function newIdOf(w: Watched & Proc, cleared: Cleared | undefined, reg: Map<string, Proc>): string | undefined {
  if (cleared?.old === w.sessionId && cleared.new && cleared.new !== w.sessionId) return cleared.new
  if (reg.has(w.sessionId) || !w.pid || !w.procStart) return undefined
  for (const [id, p] of reg) if (id !== w.sessionId && p.pid === w.pid && p.procStart === w.procStart) return id
  return undefined
}

// PLAN.md with the old id replaced on the `session:` and `owner:` lines; nothing else is touched.
export const renamePlan = (md: string, from: string, to: string) =>
  md.split('\n').map(l => (/^(session|owner):\s*/i.test(l) && l.replace(/^(session|owner):\s*/i, '').trim() === from ? l.replace(from, to) : l)).join('\n')

const rekey = <T>(r: Record<string, T> | undefined, from: string, to: string) =>
  r && from in r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k === from ? to : k, v])) : r

// The oversight with the session renamed everywhere it is kept: the watch list (same label, the transcript in the same
// folder under the new id), the assignments, and the per-session records.
export function renameOversight(o: Oversight, from: string, to: string): Oversight {
  const file = (f: string) => f.replace(/[^/]*\.jsonl$/, `${to}.jsonl`)
  return {
    ...o,
    watched: o.watched.map(w => (w.sessionId === from ? { ...w, sessionId: to, file: file(w.file) } : w)),
    ...(o.run ? { run: { ...o.run, assigned: o.run.assigned.map(a => (a.sessionId === from ? { ...a, sessionId: to } : a)) } } : {}),
    sent: rekey(o.sent, from, to),
    asked: rekey(o.asked, from, to),
    refused: rekey(o.refused, from, to),
    budgetTold: rekey(o.budgetTold, from, to),
    gates: rekey(o.gates, from, to),
    ...(o.tokens ? { tokens: Object.fromEntries(Object.entries(o.tokens).map(([n, t]) => [n, t.session === from ? { ...t, session: to } : t])) } : {}),
  }
}
