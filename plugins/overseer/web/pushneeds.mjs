// The needs that push (lot 69), with no import: the hooks' parity test (hooks/needprompt.test.ts) reads this rule, and a hooks module
// may import no node: builtin. Same keys as needprompt.ts: `${kind}:${id}`, stale is silent, the board's error is `error:<source>`.
const URGENT = new Set(['blocked', 'gate'])
export function pushNeeds(b) {
  const out = (b.needs ?? []).filter(n => n.kind !== 'stale').map(n => ({ key: `${n.kind}:${n.id}`, kind: n.kind, id: n.id, lot: n.lot, text: n.text ?? n.why ?? '', label: (b.sessions ?? []).find(s => s.sessionId === n.id)?.label, urgent: URGENT.has(n.kind) }))
  if (b.error) out.push({ key: `error:${b.error.source}`, kind: 'error', text: b.error.text, urgent: false })
  return out
}
