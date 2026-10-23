// Approving a watched session's workflow from the board (lot 48): pure, so the checks are tested without a machine.
// The web page leaves a request (~/.claude/overseer/requests/<slug>/<id>.json); only the lead acts on it: it finds the
// plan the session's gate holds (its transcript), checks the fingerprint the board showed, and approves through the
// installed workflow-gate's own CLI (approve-path), the way workflow-gate-terminal does.

export type GateAction = 'approve' | 'change' | 'reject'
export type GateRequest = { id: string; session: string; plan: string; action: GateAction; text?: string }
export type GateState = { fp: string; name: string; state: 'approved' | 'changed' | 'rejected'; at: number; path?: string }
// What a board shows of a session's held workflow: its card reads it.
export type BoardGate = { name: string; fp: string; state: 'pending' | GateState['state']; at?: number }

export const SUMMARY = 'approved from the overseer board'

// The board's fingerprint of a plan: its content only. The gate's own fingerprint adds its version, which the board
// cannot know; approve-path recomputes that one from the file.
export async function fingerprintOf(content: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

export const nameOf = (content: string, fallback = 'workflow') => content.match(/\bname:\s*['"`]([^'"`\n]+)['"`]/)?.[1] ?? fallback

// A request file, as server.mjs writes it; anything else is dropped unread.
export function parseGateRequest(raw: string): GateRequest | undefined {
  let q: Record<string, unknown>
  try { q = JSON.parse(raw) } catch { return undefined }
  if (!q || q.kind !== 'gate' || typeof q.id !== 'string' || typeof q.session !== 'string' || typeof q.plan !== 'string') return undefined
  if (q.action !== 'approve' && q.action !== 'change' && q.action !== 'reject') return undefined
  if (q.action === 'change' && (typeof q.text !== 'string' || !q.text.trim())) return undefined
  return { id: q.id, session: q.session, plan: q.plan, action: q.action, ...(q.action === 'change' ? { text: String(q.text).slice(0, 2000) } : {}) }
}

// Why a request is dropped, or undefined when it holds. shown: the fingerprint the board exported for that session;
// now: the fingerprint of the plan the session holds at this moment (undefined: nothing pending).
export function gateRefusal(req: GateRequest, o: { isWatched: boolean; shown?: string; now?: string; done?: GateState }): string | undefined {
  if (!o.isWatched) return 'the session is not watched'
  if (!o.now) return 'no workflow plan is pending in that session'
  if (o.done?.fp === o.now && o.done.state === 'approved') return 'this plan is already approved'
  if (req.plan !== o.shown) return 'the board did not show this plan'
  if (req.plan !== o.now) return 'the plan changed since the board showed it'
  return undefined
}

// The installed gate's CLI for one session: the copy that runs its hooks writes active/<session>.json (a newer gate);
// else the first workflow-gate entry of installed_plugins.json, as workflow-gate-terminal does.
export function gateCliOf(active: string | undefined, installed: string | undefined): string | undefined {
  try { const a = JSON.parse(active ?? ''); if (typeof a.hook === 'string' && a.hook) return a.hook } catch {}
  try {
    const plugins = JSON.parse(installed ?? '').plugins ?? {}
    const key = Object.keys(plugins).find(k => k.startsWith('workflow-gate@'))
    const root = key ? plugins[key]?.[0]?.installPath : undefined
    return typeof root === 'string' && root ? `${root}/hooks/workflow-plan-gate.mjs` : undefined
  } catch { return undefined }
}

export const approvedMessage = (name: string, path: string) =>
  `[workflow-gate] Plan "${name}" approved from the board. Run Workflow now with { scriptPath: ${JSON.stringify(path)} } — not inline, and do not change the file.`
export const changeMessage = (name: string, text: string) =>
  `[workflow-gate] Plan "${name}" is not approved: Victor asks for a change from the board. Change the plan, then call Workflow again.\nThe change: ${text}`
export const rejectMessage = (name: string) =>
  `[workflow-gate] Plan "${name}" rejected from the board. Do not run it and do not retry it as is: ask what to do instead.`

// The decision line's question and answer (DECISIONS.md, board.ts decisionLine).
export const decisionOf = (name: string, req: Pick<GateRequest, 'action' | 'text'>) =>
  ({ question: `Run the workflow "${name}"?`, answer: req.action === 'approve' ? SUMMARY : req.action === 'reject' ? 'rejected from the board' : `change from the board: ${req.text}` })

const hhmm = (at: number) => new Date(at).toTimeString().slice(0, 5)
// The approval card's lines: what waits, or what was decided and when.
export function gateCard(g: Partial<BoardGate> & { name: string }): string[] {
  if (!g.state || g.state === 'pending') return [`Approve the workflow "${g.name}"?`, `plan ${g.fp}`]
  const said = g.state === 'approved' ? 'approved from the board' : g.state === 'rejected' ? 'rejected from the board' : 'change asked from the board'
  return [`Workflow "${g.name}"`, `${said}${g.at ? `, ${hhmm(g.at)}` : ''}`]
}
