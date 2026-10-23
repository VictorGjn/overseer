import type { Board } from './board.ts'
import type { Peer } from './peers.ts'

// The lead's reply to an open AskUserQuestion: pure, so the sender check is tested without a machine.

export type Reg = { sessionId: string; name?: string; socket?: string }
type Q = { question: string; options: { label: string }[]; multiSelect?: boolean }

const FRAME = /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/
const attr = (s: string, k: string) => s.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1]

// "[overseer-answer] <label>" in a cross-session message whose sender is the lead, else undefined.
// The sender is the registry entry behind from="uds:<socket>" (or from-name): never the text alone, never origin.plugin.
// A cross-session message's text when its sender is the lead (found by its socket, then its name), else undefined.
export function fromLead(text: string, reg: Reg[], lead?: string): string | undefined {
  const f = text.match(FRAME)
  if (!f || !lead) return undefined
  const sock = attr(f[1]!, 'from')?.replace(/^uds:/, ''), name = attr(f[1]!, 'from-name')
  const from = sock ? reg.find(r => r.socket === sock) : name ? reg.find(r => r.name === name) : undefined
  return from?.sessionId === lead ? f[2] : undefined
}
export function answerFrom(text: string, reg: Reg[], lead?: string): string | undefined {
  const f = text.match(FRAME)
  if (!f || !lead) return undefined
  const sock = attr(f[1]!, 'from')?.replace(/^uds:/, ''), name = attr(f[1]!, 'from-name')
  const from = sock ? reg.find(r => r.socket === sock) : name ? reg.find(r => r.name === name) : undefined // ponytail: a name can be reused; the socket wins when given
  if (from?.sessionId !== lead) return undefined
  return f[2]!.match(/\[overseer-answer\]\s*([\s\S]*\S)/)?.[1] || undefined // to the end of the message: a free text keeps its lines
}

// What the model reads: the label, and truthfully who chose it; a label that is no option is free text ("Other").
export function answerResult(q: Q, label: string): { answers: Record<string, string>; response: string } {
  const parts = q.multiSelect ? label.split(',').map(s => s.trim()) : [label]
  const isOption = parts.every(p => q.options.some(o => o.label === p))
  return { answers: { [q.question]: label }, response: `The user answered from the overseer board${isOption ? '' : ' with free text (Other)'}: ${label}` }
}

// A request from the board (web POST or pane button) for the lead to send: the answer when it still holds, else undefined (dropped).
// It holds when the session is on the board, its open question is the one asked about, a single choice, and the label is an
// option. A free text (lot 54) holds for the same question: answerResult reads it as "Other", its lines kept.
export type Request = { sessionId: string; askId?: string; label?: string; text?: string }
export function checkRequest(req: Request, board: Pick<Board, 'sessions'>, peer: Peer | undefined): string | undefined {
  const a = peer?.ask
  if (!a || !board.sessions.some(s => s.sessionId === req.sessionId) || peer!.sessionId !== req.sessionId) return undefined
  if (a.id !== req.askId || a.n !== 1 || a.multiSelect) return undefined
  if (req.label !== undefined) return a.options.includes(req.label) ? req.label : undefined
  return req.text?.trim() ? req.text : undefined
}
// A session that asked in plain text (its last words end in a question, no dialog open): a free text goes to it as a message.
export const asksInText = (peer: Peer | undefined, sessionId: string) => !!peer && peer.sessionId === sessionId && !!peer.question && !peer.open
