export type Intervention = { at: number; sessionId: string; label: string; action: 'answer' | 'nudge' | 'assign' | 'done' | 'blocked' | 'retry' | 'budget' | 'send-refused' | 'waits' | 'decided' | 'release' | 'followed' | 'error' | 'server' | 'approved' | 'changed' | 'rejected' | 'gate-dropped'; text: string }

export type Watched = { sessionId: string; label: string; file: string; pid?: number; procStart?: string } // pid and procStart: its process, to follow it across a /clear (lot 56)

// A lot of the plan given to one of the watched sessions.
export type Assignment = { lot: number; sessionId: string; cwd: string; base: string; assignedAt: number; tries: number; noVerdict?: { at: number; n: number } } // noVerdict: the judge gave no verdict n times on the report written at `at` (lot 34)

export type Oversight = {
  isOn: boolean
  watched: Watched[] // sessions the person picked: read and helped
  passes: number
  lastAt?: number
  error?: string
  errorAt?: number // when it happened
  errorSource?: 'pass' | 'plan' | 'model'
  requests?: { id: string; kind: 'run' | 'pass' | 'plan' | 'change' | 'lot' | 'answer' | 'gate' | 'unknown'; state: 'done' | 'dropped'; why?: string; at: number }[] // the board's write requests the lead handled: the last 20, newest first, none older than 24 h
  log: Intervention[]
  // What a reload of the mod must not forget (its module memory is reset; this state is kept):
  sent?: Record<string, number> // sessionId → when the overseer last wrote to it
  asked?: Record<string, number> // sessionId → the [new lot] proposal already put to the owner
  refused?: Record<string, string> // sessionId → why its last message was not delivered, until one is
  budgetTold?: Record<string, { level: 'normal' | 'reduce' | 'stop'; at: number }> // sessionId → the budget it last heard, and when
  tokens?: Record<number, { session: string; from: number; to?: number; files: Record<string, { off: number; last?: string; n: number }>; wf: Record<string, number> }> // lot → tokens counted so far (tokens.ts LotTokens: counts and offsets only)
  edits?: Record<string, { off: number; open: Record<string, { file: string; at: number }>; at: Record<string, number> }> // transcript file → file paths and times of its successful Edit/Write/MultiEdit calls (collisions.ts: no content)
  fresh?: Record<string, { at: number; from: string; cwd: string }> // a worker followed to a new id after /clear (lot 56): no transcript yet, so free; its next task message carries the rules
  clearing?: Record<string, number> // a worker asked to clear itself before its next task (lot 56): when
  needed?: string[] // the needs for Victor already put to the overseer session as a prompt, while they are open (lot 57)
  gates?: Record<string, { fp: string; name: string; state: 'approved' | 'changed' | 'rejected'; at: number; path?: string }> // sessionId → the last workflow decided from the board (lot 48)
  requests?: { id: string; kind: 'gate'; state: 'done' | 'dropped'; why?: string; at: number }[] // the web board's requests the lead acted on, newest last
  // Running the plan (/oversee run) with the watched sessions: PLAN.md at the repository's top, a weekly-limit budget.
  run?: {
    top: string // the repository's top folder
    integration?: string // the branch checked out at top when the run started: lots fork from it and merge into it (lot 33)
    start?: string // the commit at top when the run started: the git tree begins after it (lot 38)
    planPath: string
    budget: number // points of the weekly limit
    weeklyAt: number
    weeklyNow: number
    carried?: number // points spent before the weekly limit last reset (budget.ts)
    level: 'normal' | 'reduce' | 'stop'
    assigned: Assignment[]
    series?: { at: number; spent: number }[] // the budget spent at each pass, for the board's curve (12 h at most)
    paused?: boolean // from the board: running lots go on and are judged, nothing new goes out
  }
}

// What moved on the board's graph since this session last looked: each lot's status, the camera (kit/motion's Moved).
export type Moved<T> = { from: T; to: T; at: number }
export type Motion = { lots: Record<string, Moved<string>>; camera: Moved<string> | null }

declare module 'claude-code' {
  interface PluginState {
    overseer: { oversight: Oversight | null; tick: number; paneOpen: boolean; boardAt: number; isOpen: boolean; paneMore: boolean; paneLog: boolean; motion: Motion | null }
  }
}
