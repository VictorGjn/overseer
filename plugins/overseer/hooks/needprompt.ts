import { needsYou, type Board } from './board.ts'

// A need for Victor becomes one prompt to the overseer session (lot 57): a toast does not reach Remote Control, and the model of the
// overseer session reads no toast. The prompt asks that session to say it in its answer and to push a notification. One prompt for each
// need: its key stays in Oversight.needed while the need is open, and is forgotten when it closes, so a need that opens again prompts again.
export type NeedPrompt = { key: string; text: string }

const KIND: Record<string, string> = { waits: 'decision', gate: 'review', plan: 'review', review: 'review' }
const ASK = 'Tell Victor in your answer what he must do.' // no PushNotification: the board's push (task 69) tells his phone, once (Victor, 2026-10-23)

export function needPrompts(b: Board, now: number): NeedPrompt[] {
  const out: NeedPrompt[] = []
  for (const n of needsYou(b, now)) {
    if (n.kind === 'stale') continue // the overseer is silent: it cannot be the one to tell
    const lot = 'lot' in n && n.lot ? n.lot.n : 'session' in n ? n.session?.lot : undefined
    const todo = n.kind === 'waits' ? `answer "${n.session.ask?.question ?? n.session.question ?? n.session.label}"`
      : n.kind === 'gate' ? `approve the workflow ${n.session?.gate?.name ?? ''}`.trim()
      : n.kind === 'blocked' ? `unblock${n.lot.note ? `: ${n.lot.note}` : ''}`
      : n.kind === 'reinstall' ? `run ${n.text ?? 'the reinstall'}, then restart the overseer session`
      : n.kind === 'stuck' ? `look at ${n.session.label}: stuck`
      : n.kind === 'budget' ? `raise the budget (/oversee run <points>) or let the run stop (${n.level})`
      : ('text' in n && n.text) || n.kind
    out.push({ key: `${n.kind}:${n.id}`, text: `[overseer-need] ${KIND[n.kind] ?? n.kind}${lot !== undefined ? ` · lot ${lot}` : ''} · ${todo}\n${ASK}` })
  }
  if (b.error) out.push({ key: `error:${b.error.source}`, text: `[overseer-need] error · ${b.error.text}\n${ASK}` })
  return out
}

// What to prompt now: the needs of the board not told yet, and the keys to keep (the ones still open). The prompt of a need is sent only
// when the overseer session takes it (it is refused while a turn runs): the rest wait for the next pass.
export const newNeeds = (found: NeedPrompt[], told: string[] = []) => ({ fresh: found.filter(n => !told.includes(n.key)), kept: told.filter(k => found.some(n => n.key === k)) })
