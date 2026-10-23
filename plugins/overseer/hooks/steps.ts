// The steps of a workflow run (UX: the Workflow stage), read from files Claude Code already writes. No model call.
//   done run   <session>/workflows/wf_*.json            startTime, durationMs, defaultModel, status, result
//   running    <session>/subagents/workflows/wf_*/      journal.jsonl (started / result per agent), agent-<id>.jsonl
//   gate       ~/.claude/workflow-gate/active/<sid>.json  status 'pending' while a plan waits for approval

export const KINDS = ['think', 'build', 'test', 'verify', 'fix', 'commit'] as const
export type Kind = (typeof KINDS)[number]

export type Step = {
  id: string; label: string; phase?: string
  kind?: Kind; turn?: number; group?: 'parallel' | 'loop'
  state: 'running' | 'done'
  model?: string; effort?: string
  startedAt?: number; endedAt?: number // first and last record time of the agent's transcript
  goal?: string; how?: string; out?: string // the first prompt lines `Goal:`, `How:`, `Out:`, when the plan wrote them
}

// `<kind>` or `<kind>-<turn>`: build, test-2. Any other label has no kind (the page shows it as is).
export function parseLabel(label: string): { kind?: Kind; turn?: number } {
  const m = /^(think|build|test|verify|fix|commit)(?:-(\d+))?$/.exec(label)
  return m ? { kind: m[1] as Kind, ...(m[2] ? { turn: Number(m[2]) } : {}) } : {}
}

export type AgentInfo = Pick<Step, 'model' | 'effort' | 'startedAt' | 'endedAt' | 'goal' | 'how' | 'out'>
const json = (line: string): any => { try { return JSON.parse(line) } catch { return undefined } }
const at = (r: any) => Date.parse(r?.timestamp) || undefined

// An agent's transcript, from its first lines (`head`) and its last (`tail`, may be empty). `api-request` carries the model
// (also when agent() set none) and the effort; the first blob that holds `output_config` is the fallback for the effort.
export function readAgent(head: string, tail = ''): AgentInfo {
  const out: AgentInfo = {}
  const lines = head.split('\n').map(json).filter(Boolean)
  for (const r of lines) {
    out.startedAt ??= at(r)
    if (r.type === 'api-request') {
      out.model ??= r.params?.model ?? r.model
      out.effort ??= r.params?.output_config?.effort
    } else if (r.type === 'api-request-blob') out.effort ??= r.message?.output_config?.effort
    else if (r.type === 'user' && !out.goal && !out.how && !out.out) {
      const c = r.message?.content
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? '').join('\n') : ''
      for (const key of ['goal', 'how', 'out'] as const) {
        const m = new RegExp(`^\\s*${key}:[ \\t]*(.+)$`, 'im').exec(text)
        if (m) out[key] = m[1]!.trim().slice(0, 200)
      }
    }
  }
  const last = [...tail.split('\n').map(json).filter(Boolean)].reverse().map(at).find(Boolean) ?? [...lines].reverse().map(at).find(Boolean)
  if (last) out.endedAt = last
  return out
}

// The steps of a run from its journal (one `started` and one `result` line per agent), in start order. `group` is `loop` for a
// step with a turn (`test-2`), `parallel` for steps of one phase that ran at the same time. `agents` is what readAgent found.
export function stepsOf(journal: string, agents: Record<string, AgentInfo> = {}): Step[] {
  const steps: Step[] = []
  const open = new Map<string, Step>()
  for (const d of journal.split('\n').map(json)) {
    if (d?.type === 'started' && d.agentId) {
      const label = String(d.label ?? d.agentId)
      const step: Step = { id: d.agentId, label, ...(d.phase ? { phase: d.phase } : {}), ...parseLabel(label), state: 'running', ...agents[d.agentId] }
      if (step.turn !== undefined) step.group = 'loop'
      for (const o of open.values()) if (o.phase === step.phase) { o.group ??= 'parallel'; step.group ??= 'parallel' }
      open.set(d.agentId, step)
      steps.push(step)
    } else if (d?.type === 'result' && open.has(d.agentId)) { open.get(d.agentId)!.state = 'done'; open.delete(d.agentId) }
  }
  return steps
}

// A run that ended, from its wf_*.json: when, how long, which model, how it ended, and the first 200 characters of its result.
export type DoneRun = { startedAt?: number; durationMs?: number; model?: string; state?: string; preview?: string }
export function doneRun(text: string): DoneRun | undefined {
  const d = json(text)
  if (!d || typeof d !== 'object') return undefined
  const result = typeof d.result === 'string' ? d.result : d.result === undefined ? '' : JSON.stringify(d.result)
  return {
    startedAt: Number(d.startTime) || Date.parse(d.timestamp) || undefined,
    durationMs: Number(d.durationMs) || undefined,
    model: d.defaultModel,
    state: d.status,
    ...(result ? { preview: result.slice(0, 200) } : {}),
  }
}

// How far back `find -mmin` looks for a session's runs: to the lot's assignment, however old, else 3 h.
export const windowMins = (from: number | undefined, now: number) => Math.ceil((now - (from ?? now - 3 * 3600e3)) / 60e3) + 1

// A lot owns the runs of its session that started after its assignment.
export const ownsRun = (assignedAt: number, run: { startedAt?: number }) => run.startedAt !== undefined && run.startedAt >= assignedAt

// A plan that waits on the workflow gate: the gate's active file, status `pending`. Anything else is no gate.
export type GatePlan = { name: string; agents: { label: string; model?: string }[] }
export function gatePlan(text: string | undefined): GatePlan | undefined {
  const d = text ? json(text) : undefined
  if (d?.status !== 'pending') return undefined
  const agents = (Array.isArray(d.agents) ? d.agents : []).filter((a: any) => a?.label).map((a: any) => ({ label: String(a.label), ...(a.model ? { model: String(a.model) } : {}) }))
  return { name: String(d.name ?? d.plan ?? 'workflow'), agents }
}
