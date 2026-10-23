// Reading other sessions from their transcripts: pure, so it is tested without a machine.

import { nameOf } from './gate.ts'

export type Peer = {
  sessionId: string
  cwd: string
  lastAt: number // ms, the last row's time
  model?: string
  lastRole?: 'user' | 'assistant'
  open?: boolean // the question is an open AskUserQuestion/ExitPlanMode: it holds whatever the registry says
  question?: string // what the session waits on: an AskUserQuestion it asked, or its last text ending in a question
  ask?: { id: string; question: string; options: string[]; multiSelect: boolean; n: number } // the open AskUserQuestion with its options (n questions); its tool_use id says which one an answer is for
  lastText: string // its last words, for context
  tools: string[] // its last tool calls, newest last
  busySince?: number // the oldest tool call still without a result: it is working (or waits on a permission prompt)
  waiting?: { key: string; at: number; usual: number[] } // the oldest pending call that does not wait on purpose; usual: how long earlier calls of its key took (ms)
  loop?: string // why it goes in circles, when it does
  background: string[] // background tasks it started that have not reported back
  bgSeen?: Record<string, number> // task id → the time of the last row that mentions it: a task nobody mentions for 5 min is over (liveBackground)
  mode?: string // its latest permissionMode (plan, auto, default...): a session in plan mode refuses a lot
  marker?: { lot: number; status: 'done' | 'blocked' | 'departs'; branch?: string; why?: string; at: number } // its last "[task N done on <branch>]" / "[task N blocked: why]" (the older "[lot N …]" counts the same)
  changeDone?: { lot: number; at: number } // its last "[change N done]": the change requests of lot N, made (lot 37)
  rec?: { question: string; option: string; why?: string } // its last "[ask: <question> | recommend: <option> — <why>]", until the person types
  answered?: { question: string; answer: string; at: number } // the person's last answer to what it waited on (the decisions record)
  proposal?: { text: string; at: number } // its last "[new lot: <title> — <why>]": work outside the plan, for the owner to open or not
  gate?: { id: string; name: string; script?: string; scriptPath?: string; at: number } // the Workflow call its gate holds for approval, until a later Workflow call runs (gate.ts)
}

// The words a session ends a lot with; anything else is progress, however quiet.
const MARKER = /\[(?:lot|task) (\d+) (done|blocked|departs)(?: on ([^\]\s:]+))?(?::\s*([^\]]*))?\]/gi
const CHANGE_DONE = /\[change (\d+) done\]/gi
const ASK = /\[ask:\s*([^\]|]+?)\s*\|\s*recommend:\s*([^\]]+?)(?:\s+(?:—|--?)\s+([^\]]+?))?\s*\]/gi

// A call that waits on purpose (a question, a monitor, a workflow, a background shell) is never slow.
const onPurpose = (name?: string, input?: { run_in_background?: boolean }) => ['AskUserQuestion', 'ExitPlanMode', 'Monitor', 'Workflow'].includes(name ?? '') || !!input?.run_in_background
// What a call is compared with: its tool; a shell call, its program (leading `cd dir &&`, VAR=x assignments and the `rtk` wrapper skipped).
const keyOf = (name = '?', input?: { command?: string }) => name === 'Bash' ? `Bash:${(input?.command ?? '').trim().replace(/^(cd\s+\S+\s*(&&|;)\s*|\w+=\S*\s+|rtk\s+)+/, '').split(/\s/)[0]}` : name

// What the person answered, from the row that closes the question: a terminal answer reads `"Q"="A"` pairs, the board's
// answer (lot 18) reads `answered from the overseer board: <label>`, a typed one is the text itself. One line, 200 chars.
export function answerOf(raw: string): string {
  const board = raw.match(/answered from the overseer board:\s*([^"\n]+)/)?.[1]
  const pairs = [...raw.matchAll(/"[^"]*"="([^"]*)"/g)].map(m => m[1]!)
  return (board ?? (pairs.length ? pairs.join('; ') : raw)).replace(/\s+/g, ' ').trim().slice(0, 200)
}

type Row = { type?: string; permissionMode?: string; sessionId?: string; cwd?: string; timestamp?: string; isSidechain?: boolean; isCompactSummary?: boolean; message?: { role?: string; model?: string; content?: unknown } }

// The tail of one transcript (JSON lines) → where that session stands. Sidechains (subagents) are skipped.
export function peerOf(lines: string[]): Peer | undefined {
  let p: Peer | undefined
  let asked: { id: string; text: string; ask?: Peer['ask'] } | undefined
  let textQ: string | undefined // its last words when they end in a question: a typed reply answers it
  const pending = new Map<string, { at: number; name: string; key?: string; sig: string }>() // tool_use id → the call; no key: it waits on purpose
  const durations: Record<string, number[]> = {}
  const fails: Record<string, number> = {} // tool → consecutive errors
  let sigs: string[] = []
  const bg = new Set<string>()
  const seen: Record<string, number> = {}
  let mode: string | undefined
  const workflows = new Map<string, { script?: string; scriptPath?: string }>() // Workflow tool_use id → its input
  for (const line of lines) {
    let d: Row
    try { d = JSON.parse(line) } catch { continue }
    if (d.sessionId && !d.isSidechain && d.permissionMode) mode = d.permissionMode // user rows and the standalone permission-mode rows
    if (!d.sessionId || d.isSidechain || (d.type !== 'user' && d.type !== 'assistant')) continue
    p ??= { sessionId: d.sessionId, cwd: d.cwd ?? '', lastAt: 0, lastText: '', tools: [], background: [] }
    p.cwd = d.cwd ?? p.cwd
    const at = Date.parse(d.timestamp ?? '') || p.lastAt
    p.lastAt = at
    for (const id of bg) if (line.includes(id)) seen[id] = at
    if (d.isCompactSummary) continue // a compaction's summary is the engine's row, not a prompt: the session still waits for one
    const blocks = Array.isArray(d.message?.content) ? d.message!.content as { type?: string; text?: string; name?: string; id?: string; input?: { questions?: { question?: string; options?: { label?: string }[]; multiSelect?: boolean }[]; plan?: string; command?: string; run_in_background?: boolean }; tool_use_id?: string; is_error?: boolean; content?: unknown }[] : []
    if (d.type === 'assistant') {
      p.model = d.message?.model ?? p.model
      const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
      if (text) { p.lastText = text.slice(-1500); p.lastRole = 'assistant'; textQ = /\?\s*$/.test(text) ? text.split('\n').filter(l => l.trim()).slice(-3).join('\n') : undefined }
      for (const m of text.matchAll(/\[new (?:lot|task):\s*([^\]]+)\]/gi)) p.proposal = { text: m[1]!.trim(), at }
      if (text) p.rec = undefined // the marker holds only while it is in the session's last words: newer text without one is a newer question
      for (const m of text.matchAll(ASK)) p.rec = { question: m[1]!.trim(), option: m[2]!.trim(), why: m[3]?.trim() || undefined }
      for (const m of text.matchAll(CHANGE_DONE)) p.changeDone = { lot: Number(m[1]), at }
      for (const m of text.matchAll(MARKER)) p.marker = { lot: Number(m[1]), status: m[2]!.toLowerCase() as 'done' | 'blocked' | 'departs', branch: m[3], why: m[4]?.trim() || undefined, at }
      for (const b of blocks.filter(b => b.type === 'tool_use')) {
        const sig = (b.name ?? '?') + JSON.stringify(b.input ?? {})
        if (b.id) pending.set(b.id, { at, name: b.name ?? '?', key: onPurpose(b.name, b.input) ? undefined : keyOf(b.name, b.input), sig })
        sigs = [...sigs, sig].slice(-4)
        p.tools = [...p.tools, b.name ?? '?'].slice(-8)
        p.lastRole = 'assistant'
        if (b.name === 'AskUserQuestion') {
          const qs = b.input?.questions ?? []
          asked = { id: b.id ?? '', text: qs.map(q => q.question).filter(Boolean).join(' / '), ask: { id: b.id ?? '', question: qs[0]?.question ?? '', options: (qs[0]?.options ?? []).map(o => o.label ?? '').filter(Boolean), multiSelect: !!qs[0]?.multiSelect, n: qs.length } }
        }
        if (b.name === 'Workflow' && b.id) { const i = b.input as { script?: unknown; scriptPath?: unknown } | undefined; workflows.set(b.id, { script: typeof i?.script === 'string' ? i.script : undefined, scriptPath: typeof i?.scriptPath === 'string' ? i.scriptPath : undefined }) }
        if (b.name === 'ExitPlanMode') {
          const head = (b.input?.plan ?? '').split('\n').map(l => l.trim()).find(Boolean)
          asked = { id: b.id ?? '', text: head ? `approve the plan: ${head}` : 'approve the plan' }
        }
      }
    } else {
      for (const b of blocks.filter(b => b.type === 'tool_result')) {
        const call = pending.get(b.tool_use_id ?? '')
        if (call) {
          pending.delete(b.tool_use_id!)
          if (call.key) (durations[call.key] ??= []).push(at - call.at)
          fails[call.name] = b.is_error ? (fails[call.name] ?? 0) + 1 : 0
        }
        const out = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')
        const wf = workflows.get(b.tool_use_id ?? '')
        if (wf) {
          // Held by the gate (the browser gate or workflow-gate-terminal): it waits for a person. Any other result ran or failed on its own.
          const held = b.is_error && /workflow-gate|plan-gate/i.test(out) && /⛔/.test(out)
          p.gate = held && (wf.script || wf.scriptPath) ? { id: b.tool_use_id!, name: nameOf(wf.script ?? '', out.match(/the plan "([^"]+)"/)?.[1] ?? wf.scriptPath?.split('/').pop()?.replace(/\.m?js$/, '') ?? 'workflow'), ...wf, at } : undefined
        }
        const task = out.match(/Task ID:\s*([\w-]+)/)?.[1]
        if (task && /background/i.test(out)) { bg.add(task); seen[task] = at }
      }
      const raw = typeof d.message?.content === 'string' ? d.message.content : JSON.stringify(d.message?.content ?? '')
      for (const m of raw.matchAll(/<task-id>([\w-]+)<\/task-id>[\s\S]*?<status>(\w+)<\/status>/g)) if (m[2] !== 'running') bg.delete(m[1]!)
      // A tool result is the engine's row, not the person's: only a typed prompt counts as the user's turn.
      if (/<task-notification>/.test(raw)) continue
      const typed = typeof d.message?.content === 'string' ? d.message.content : blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
      if (asked && blocks.some(b => b.type === 'tool_result' && b.tool_use_id === asked!.id)) {
        const r = blocks.find(b => b.type === 'tool_result' && b.tool_use_id === asked!.id)!
        p.answered = { question: asked.text, answer: answerOf(typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? '')), at }
        asked = undefined
      } else if (typeof d.message?.content === 'string' || blocks.some(b => b.type === 'text')) {
        p.lastRole = 'user'
        const q = asked?.text ?? textQ
        if (q && typed.trim()) p.answered = { question: q, answer: answerOf(typed), at }
        asked = undefined
        p.rec = undefined
      }
      textQ = undefined
    }
  }
  if (!p) return undefined
  const calls = [...pending.values()]
  p.busySince = calls.length ? Math.min(...calls.map(c => c.at)) : undefined
  const w = calls.filter(c => c.key).sort((a, b) => a.at - b.at)[0]
  if (w) p.waiting = { key: w.key!, at: w.at, usual: durations[w.key!] ?? [] }
  const bad = Object.keys(fails).find(n => fails[n]! >= 3)
  if (sigs.length === 4 && sigs.every(x => x === sigs[0])) p.loop = 'same call 4 times in a row'
  else if (bad) p.loop = `${bad} failed 3 times in a row`
  p.background = [...bg]
  p.bgSeen = Object.fromEntries(p.background.map(id => [id, seen[id] ?? p!.lastAt]))
  p.mode = mode
  if (asked) { p.question = asked.text; p.open = true; p.ask = asked.ask }
  else if (p.lastRole === 'assistant' && p.rec) p.question = p.rec.question // the marker line ends in ], not ?
  else if (p.lastRole === 'assistant' && /\?\s*$/.test(p.lastText.split('\n').filter(l => l.trim()).pop() ?? '')) p.question = p.lastText.split('\n').filter(l => l.trim()).slice(-3).join('\n')
  if (!p.question) p.rec = undefined
  return p
}

// A background task nobody mentions for 5 min is over (a workflow stopped from /workflows sends no notification).
export const liveBackground = (p: { background: string[]; bgSeen?: Record<string, number> }, now: number) => p.background.filter(id => now - (p.bgSeen?.[id] ?? 0) < 5 * 60e3)

// Why a session is stuck, if it is: it loops, or one call has run far past what calls of its kind take.
// ponytail: five calls of a kind is the least history; a session new to a tool is never judged slow.
export function stuckWhy(p: Peer, now: number): string | undefined {
  if (p.loop) return p.loop
  const w = p.waiting
  if (!w) return undefined
  const age = now - w.at, s = [...w.usual].sort((a, b) => a - b), n = s.length
  const med = s[Math.floor(n / 2)]!, p90 = s[Math.ceil(0.9 * n) - 1]!
  if (age >= 5 * 60e3 && n >= 5 && age >= 8 * med && age >= 3 * p90) return `${w.key} has run ${Math.floor(age / 60e3)}m, ${Math.floor(age / med)}x its usual`
}

// The session registry (~/.claude/sessions/<pid>.json): status busy|shell|idle|waiting; waitingFor, only when waiting, says on what.
export type Registry = { pid?: number; procStart?: string; status?: string; waitingFor?: string; name?: string; socket?: string; bridge?: string }

// A session the registry says waits, with no question in its transcript: the registry's words for it.
// A busy one is working, whatever its last line says: no guessed question; an open tool prompt stays.
export function waitsOn(p: Peer, reg: Registry | undefined): Peer {
  if (reg?.status === 'busy' && !p.open) return { ...p, question: undefined }
  if (p.question || reg?.status !== 'waiting') return p
  return { ...p, question: `waiting: ${reg.waitingFor ?? 'input needed'}` }
}

// Worth a message: waiting on a question, or quiet for a while after speaking last; not messaged lately.
export function needsHelp(p: Peer, now: number, lastSent: number | undefined, quietMs = 10 * 60e3, gapMs = 15 * 60e3): boolean {
  if (lastSent !== undefined && now - lastSent < gapMs) return false
  if (p.lastRole !== 'assistant') return false // the person (or a message) spoke last: the session is working or answered
  if (p.busySince !== undefined || liveBackground(p, now).length) return !!p.question // a tool or a background task still runs: it is working
  return !!p.question || now - p.lastAt > quietMs
}

export const OVERSEER_SYSTEM = `You oversee Claude Code sessions their owner asked you to watch while they are away or busy. For each session you get its last words, its pending question if any, the model it runs on and its recent tool calls.
Goal: every session keeps moving, at the best quality for the lowest price.
For each session decide one action:
- "answer": it waits on a question. Answer as its owner would: pick the option you would recommend, in one or two sentences, with the reason.
- "nudge": it stalled, is going in circles, or wastes money (opus on mechanical work, re-reading huge files, no verification before calling something done). Tell it the next concrete step.
- "none": it is fine, or you cannot help without its owner.
When BRANCHES are given: a session whose branch shares files with another session's branch, or conflicts in the trial merge, is told which branch and files, and to keep its change small there or rebase on that branch once it is merged; a branch far behind the base is told to rebase before it goes further.
Work outside the plan is never refused: the plan evolves. When a session wants to start something PLAN.md does not hold, tell it to write \`[new task: <title> — <why>]\` and wait: the owner decides whether to open it.
Never authorize outward or irreversible actions (git push, PR merge, deploys, deletions, messages to people): tell it to leave them for its owner. Never invent facts about the code; when unsure, tell it how to check.
Answer ONLY JSON: [{"sessionId":"<id>","action":"answer|nudge|none","message":"<max 600 chars, addressed to that session>"}]`

export function overseerPrompt(peers: Peer[]): string {
  return peers.map(p => [
    `SESSION ${p.sessionId} · ${p.model ?? 'model ?'} · cwd ${p.cwd} · quiet for ${Math.round((Date.now() - p.lastAt) / 60e3)} min`,
    p.question ? `WAITS ON: ${p.question}` : '',
    `LAST WORDS: ${p.lastText.slice(-900)}`,
    `RECENT TOOLS: ${p.tools.join(', ') || 'none'}`,
  ].filter(Boolean).join('\n')).join('\n\n')
}

export function parseActions(text: string, ids: string[]): { sessionId: string; action: 'answer' | 'nudge'; message: string }[] {
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const d = JSON.parse(m[0])
    return (Array.isArray(d) ? d : [])
      .filter(x => x && ids.includes(x.sessionId) && (x.action === 'answer' || x.action === 'nudge') && typeof x.message === 'string' && x.message.trim())
      .map(x => ({ sessionId: x.sessionId, action: x.action, message: String(x.message).slice(0, 800) }))
  } catch {
    return []
  }
}

// /oversee watch <ids>: each id or unique prefix of a session listed by /oversee.
export function pick(args: string, listed: { sessionId: string }[]): { found: string[]; unknown: string[] } {
  const found: string[] = [], unknown: string[] = []
  for (const w of args.split(/[\s,]+/).filter(Boolean)) {
    const m = listed.filter(l => l.sessionId.startsWith(w))
    if (m.length === 1) found.push(m[0]!.sessionId)
    else unknown.push(w)
  }
  return { found: [...new Set(found)], unknown }
}

// Who a session is, from the project's PLAN.md: a "Sessions" line such as
// "- **Sessions dédiées** (…) : raid et jeu `worker-a1` ; son `worker-71` (0000aa71) ; assets 3D `worker-8f` (0000aa8f)."
// Each item: a role, the session's name in backticks, optionally an id prefix in parentheses.
export type RoleEntry = { role: string; name?: string; idPrefix?: string }
export function parseRoles(md: string): RoleEntry[] {
  const line = md.split('\n').find(l => /^\s*[-*]?\s*\**\s*sessions(\s+dédiées|\s+roles?)?\s*\**/i.test(l))
  if (!line) return []
  const body = line.replace(/^[^:]*:\s*/, '') // each item keeps its own periods: only its first `name` closes the role
  const out: RoleEntry[] = []
  for (const item of body.split(';')) {
    const m = item.match(/^\s*(.*?)\s*`([\w.-]+)`\s*(?:\(([0-9a-f]{6,})[^)]*\))?/i)
    if (m && m[1]!.trim()) out.push({ role: m[1]!.trim(), name: m[2], idPrefix: m[3] })
  }
  return out
}

// "worker-8f · assets 3D et canyon (0000aa8f)": name and role when known, the id always.
export function identity(sessionId: string, names: Map<string, string>, roles: RoleEntry[], fallback: string): { name?: string; role?: string; text: string } {
  const name = names.get(sessionId)
  // The id is exact; a name can be reused by another session: an id match wins.
  const role = (roles.find(r => r.idPrefix && sessionId.startsWith(r.idPrefix)) ?? roles.find(r => name && r.name === name))?.role
  const parts = [name, role].filter(Boolean)
  return { name, role, text: `${parts.length ? parts.join(' · ') : fallback} (${sessionId.slice(0, 8)})` }
}
