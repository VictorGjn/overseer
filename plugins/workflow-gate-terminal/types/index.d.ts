export type Site = {
  label: string
  phase?: string
  purpose: string
  model?: string
  modelAt?: number
  isFanOut: boolean
}

export type Edits = Record<string, { model?: string; mission?: string }>

export type Plan = {
  name: string
  source: string
  sites: Site[] // fallback list view when the flow parser cannot read the script
  models: Record<number, string>
  edits: Edits
  status: 'pending' | 'approved' | 'cancelled'
  path?: string
  review?: PlanReview // Opus, before approval
  tiers?: Record<string, { tier: string; from: string; why: string; n: number }> // the bandit's suggestions, by card id
  proposals?: Record<string, MissionProposal> // mission rewrites waiting for this workflow, by label
}

export type LiveAgent = {
  key: string // the run's agent index: unique even when agents spawn in parallel
  id?: string
  label: string
  model?: string
  cardId?: string
  isGuess?: boolean
  status: 'running' | 'done' | 'failed'
  lastTool?: string
  doing?: string // the tool call in flight, as one readable line
  thought?: string // the latest sentence of its thinking (💭) or of what it writes (💬)
  tasks?: { text: string; ok: boolean; at: number }[] // tool calls it finished, newest last (last 25)
  steps?: number
  cost?: number // $ so far, from each model request's usage
  startedAt: number
  endedAt?: number
}

export type Run = {
  toolUseId: string
  name: string
  source?: string
  sites: number
  startedAt: number
  costAt?: number
  expected?: Record<string, number> // typical model requests per agent, by card, from past runs
  flags?: Flag[] // what the live fallacy check surfaced, oldest first
  checks?: number // live checks spent on this run
  taskId?: string // the background task the Workflow call started, for a stop
  decisions?: Decision[] // what the Opus orchestrator decided about the flags
  opusCalls?: number
  opusError?: string // the last Opus call that did not answer, shown on the card
  runId?: string
  journal?: string // <transcript dir>/journal.jsonl: what each agent returned
  retro?: Retro | { pending: true } | { error: string }
  endedAt?: number // the run's background task reported back (its notification reached the session)
  lateSent?: boolean // Opus's corrections that missed their agent were handed to the main session
  agents: LiveAgent[]
}

export type FlagDecision = { action: 'ignore' | 'steer' | 'ask_human' | 'stop_run' | 'too-late'; message?: string; target?: string; why?: string }
export type Flag = { cardId: string; kind: string; why: string; severity?: 'high' | 'low'; quote?: string; agent?: string; agentId?: string; at?: number; sentAt?: number; decision?: FlagDecision }

export type Decision = { at: number; about?: string; agentId: string; agent: string; action: 'ignore' | 'steer' | 'ask_human' | 'stop_run'; message?: string; options?: string[]; why: string; isDelivered?: boolean; isAnswered?: boolean; answer?: string }

export type PlanReview = { status: 'pending' | 'done' | 'error'; verdict?: 'ok' | 'concerns'; items?: { card: string; issue: string; fix?: string; patch?: { model?: string; missionAppend?: string; cascade?: boolean } }[]; error?: string }

export type Retro = {
  at: number
  cards: { card: string; delivered: 'yes' | 'partial' | 'no'; why: string }[]
  flags: { n: number; founded: boolean; why: string }[] // n: 1-based index into the run's flags
  summary: string
  patterns?: unknown // general workflow-design lessons, raw: filtered before they are shared
}

// One label's record across runs and sessions ($.store), from the retros.
export type LabelRecord = { runs: number; yes: number; partial: number; no: number; founded: number; unfounded: number; lastAt?: number }

// Per label, per tier: retros seen (n), quality summed (q: yes 1, partial 0.5, no 0), $ per agent summed.
export type BanditStats = Record<string, Record<string, { n: number; q: number; cost: number }>>

// A mission Opus rewrote after a card under-delivered, kept per workflow name and label ($.store).
export type MissionProposal = {
  workflow: string
  label: string
  from: string // the mission as it was
  mission: string // the rewrite
  why: string
  at: number
  model?: string
  lastPrompt: string // what the agent was really sent last time: the replay's input
  oldResult: string
  failure: string
  replay?: { status: 'running' | 'done' | 'error'; agentId?: string; better?: boolean; why?: string }
}

export type Tab = 'plan' | 'live' | 'history' | 'agent'

// One line of an agent's story, in order: what it thought or wrote, the tools it used, what the
// checks and the orchestrator said, how it ended.
// A run's retro as History keeps it ($.store `retro:<runId>`). Older records have no verdicts/cost.
export type RetroRecord = {
  name: string; at: number; summary: string; delivered: number; cards: number
  startedAt?: number; cost?: number; agents?: number
  verdicts?: { card: string; delivered: 'yes' | 'partial' | 'no'; why: string }[]
  flags?: { founded: number; unfounded: number }
}

export type TimelineEntry = { at: number; kind: 'thought' | 'text' | 'tool' | 'flag' | 'steer' | 'end'; text: string; ok?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'workflow-gate-terminal': {
      pan: { left: number; top: number; manualAt?: number } | null // the terminal canvas's pan by the person's buttons
      plan: Plan | null
      approved: Record<string, string>
      run: Run | null
      isBandHidden: boolean
      isBandOpen: boolean
      passOnce: boolean
      tab: Tab
      selected: string | null
      mainFlags: Flag[] // the live check on the main session's own reasoning
      mainSeen: number // how many of them the person dismissed
      isCheckOpen: boolean // the check band's accordion
      agentView: string | null // the agent the Agent tab shows
      historyOpen: string | null // the past run whose retro the History tab shows open
      timelines: Record<string, TimelineEntry[]> // per run agent, oldest first (last 300)
    }
  }
}
