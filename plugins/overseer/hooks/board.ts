import { LANES, PALETTE } from './band.tsx'
import { gitSvg } from './gitsvg.ts'
// The overseer's board: what the pane draws, built after each pass and kept in the plugin's store
// so any session with the mod can open it (/oversee show), not only the overseer's own.
import { stuckWhy, type Peer, type Registry } from './peers.ts'
import type { BoardGate } from './gate.ts'
import { missing, type Lot, type Verdict } from './plan.ts'
import type { LotGit } from './proofs.ts'
import type { GatePlan, Step } from './steps.ts'
import type { GraphRow } from './tree.ts'

export type Stage = 'free' | 'assigned' | 'work' | 'stuck' | 'report' | 'judge' | 'waits' | 'gate' | 'blocked'
export const LOOP: Stage[] = ['assigned', 'work', 'report', 'judge']
export type BoardSession = { sessionId: string; label: string; stage: Stage; lot?: number; lotStartedAt?: number; since: number; lastText: string; question?: string; recommend?: { option: string; why?: string }; tries: number; model?: string; note?: string; ask?: { id: string; question: string; options: string[] }; link?: string; caption?: string; departs?: string; gate?: SessionGate }
// The workflow a session's gate holds: its plan (steps.ts, lot 35) and, once the lead has read the transcript, the fingerprint the board shows and the decision (gate.ts, lot 48).
export type SessionGate = Partial<GatePlan> & { name: string; fp?: string; state?: BoardGate['state']; at?: number }
// check: the last run when there is one, else the command.
export const boardLot = (l: Lot): Board['lots'][number] => ({
  n: l.n,
  title: l.title,
  status: l.status,
  depends: l.depends,
  session: l.session,
  note: l.note,
  model: l.model,
  doneWhen: l.doneWhen,
  check: l.checkResult ?? l.check,
  verdict: l.verdict,
  verdictAt: l.verdictAt,
  brief: l.brief,
  base: l.base,
  tip: l.tip,
  dirty: l.dirty,
  retry: l.retry,
  marks: l.marks,
  gaps: l.gaps,
  changes: l.changes,
  review: l.review,
})
// UI v3 (overseer/web/CONTRACT.md): every field below is optional; each is written by the lot named in CONTRACT.md.
export type CheckRun = { ok: boolean; at: number; tests?: { pass: number; fail: number }; tail: string }
export type Mark = { i: number; mark: 'met' | 'gap' | 'todo'; ev?: string }
export type Change = { id: string; file?: string; line?: number; text: string; at: number; state: 'sent' | 'done' | 'dropped'; queued?: string } // queued: the caption when the session was busy at the time ("queued until the workflow ends")
export type Brief = { type?: 'bug' | 'feature' | 'probe' | 'decision' | 'integration'; problem?: string; direction?: string; question?: string; options?: string[]; notIn?: string[]; keep?: string[]; risk?: { event: string; mitigation: string }[]; linear?: string; lots?: number[]; version?: string; criteria: string[] }
export type BoardRequest = { id: string; kind: 'run' | 'pass' | 'plan' | 'change' | 'lot' | 'answer' | 'gate' | 'unknown'; state: 'done' | 'dropped'; why?: string; at: number }
export type Board = {
  at: number
  overseer: string // the overseer's session id
  repo: string // the repository this board is about; the key and the file name derive from it
  goal: string
  nextPassAt: number
  error?: { text: string; at: number; source: string }
  requests?: BoardRequest[]
  passing?: boolean
  paused?: boolean
  passEvery?: number
  proposed?: number[]
  budget?: { spent: number; budget: number; level: string; series?: { at: number; spent: number }[] }
  lots: (Pick<Lot, 'n' | 'title' | 'status' | 'depends' | 'session' | 'note' | 'model'> & Partial<Pick<Lot, 'doneWhen' | 'verdict' | 'verdictAt'>> & { tokens?: number; brief?: Brief; base?: string; tip?: string; dirty?: { path: string; add: number; del: number }[]; check?: string | CheckRun; retry?: Verdict; marks?: Mark[]; gaps?: string[]; changes?: Change[]; review?: string; noVerdict?: boolean } & Omit<LotGit, 'base' | 'tip' | 'dirty'>)[] // tokens: its session's and subagents' usage, assignment to verdict (tokens.ts)
  sessions: BoardSession[]
  base?: string
  branches?: { name: string; path?: string; owner?: string; ahead: number; behind: number; files: number; overlaps: string[]; merge?: { order: number; conflicts: string[] } }[]
  top?: string // the repository's main checkout
  worktrees?: { path: string; branch?: string; owner?: string; dirty: number; files?: string[]; lastCommitAt?: number; isMain: boolean; isPrunable?: boolean }[]
  atRisk?: AtRisk[] // what closing every session now would lose (UX.md Q8); absent when nothing is
  workflows?: WorkflowRun[]
  decisions?: Decision[] // the last of DECISIONS.md, newest first
  collisions?: { file: string; sessions: string[]; at: number }[] // files changed by 2+ watched sessions within 15 min (collisions.ts)
  graph?: GraphRow[] // the commit graph of the local branches, newest first: since the run started, 300 commits at most
  graphCut?: number // the commits since the run started that the graph leaves out (lot 38)
  feed: { at: number; action: string; label: string; text: string }[]
  pace?: number // median time from a lot's assignment to its "done", over this run's finished lots
  mod?: { version: string } // the overseer mod that wrote the board: the page compares it with its server's (lot 51)
  wins?: { n: number; title: string; at: number }[] // lots finished in the last 12 h, newest first
}

// The file name of a repository's board. ponytail: /a/b-c and /a/b/c collide, rare; add a path hash if it bites.
export const slugOf = (repo: string) => repo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Which board a session reads when several overseers share the store: the one it leads, the one that
// watches it, the one whose repository holds its folder, else the newest. No git call: boards carry their paths.
export function boardFor<B extends Pick<Board, 'at' | 'overseer' | 'sessions' | 'top' | 'worktrees'>>(boards: B[], { self, cwd }: { self: string; cwd: string }): B | undefined {
  const inside = (root?: string) => !!root && !!cwd && (cwd === root || cwd.startsWith(`${root.replace(/\/$/, '')}/`))
  const newest = [...boards].sort((a, b) => b.at - a.at)
  return newest.find(b => b.overseer === self) ?? newest.find(b => b.sessions.some(s => s.sessionId === self))
    ?? newest.find(b => inside(b.top) || b.worktrees?.some(w => inside(w.path))) ?? newest[0]
}

// Where a watched session stands in the overseer's loop.
// The task a session is blocked on (lot 59): its last report is `[lot N blocked: …]` and PLAN.md still has that task `[!]`.
// It gets no new task until the block closes ([x] or [ ]).
export const blockedOn = (p: Pick<Peer, 'marker'> | undefined, lots: Pick<Lot, 'n' | 'status'>[] | undefined) =>
  p?.marker?.status === 'blocked' && lots?.some(l => l.n === p.marker!.lot && l.status === 'blocked') ? p.marker : undefined
export function stageOf(p: Peer | undefined, a: { lot: number; assignedAt: number } | undefined, isJudging: boolean, now: number, lots?: Pick<Lot, 'n' | 'status'>[]): Stage {
  if (p?.question) return 'waits'
  if (p?.marker?.status === 'departs' && a && p.marker.lot === a.lot && p.marker.at > a.assignedAt) return 'waits' // it left the direction: it waits for the person
  if (!a && blockedOn(p, lots)) return 'blocked'
  if (!a) return 'free'
  if (isJudging) return 'judge'
  if (!p || p.lastAt <= a.assignedAt) return 'assigned' // the lot was sent; the session has not spoken since
  if (p.marker && p.marker.lot === a.lot && p.marker.at > a.assignedAt) return 'report' // it said done or blocked: next pass judges
  if (stuckWhy(p, now)) return 'stuck'
  return 'work' // silence is work: only its own word ends a lot
}

// What the board offers for a waiting session: buttons for an open one-question, single-choice AskUserQuestion; else, when it
// waits on a plan or a permission, a link to answer in claude.ai (a link: claude.ai refuses to be framed). No bridge id: no link.
export function answerView(p: Peer | undefined, stage: Stage, reg: Registry | undefined): Pick<BoardSession, 'ask' | 'link' | 'caption'> {
  const a = p?.ask
  const ask = a && a.n === 1 && !a.multiSelect && a.options.length ? { id: a.id, question: a.question, options: a.options } : undefined
  const waits = stage === 'waits' || reg?.status === 'waiting'
  const link = !ask && waits && reg?.bridge && /^[A-Za-z0-9_-]{1,80}$/.test(reg.bridge) ? `https://claude.ai/code/${reg.bridge}` : undefined
  // several questions, or several choices: the board cannot answer them, the session can (lot 54)
  const caption = link && a && (a.n > 1 || a.multiSelect) ? 'answer in the session' : undefined
  return { ...(ask ? { ask } : {}), ...(link ? { link } : {}), ...(caption ? { caption } : {}) }
}

const SPIN = ['◐', '◓', '◑', '◒']
export const spinner = (tick: number) => SPIN[tick % SPIN.length]!
export const STATUS_GLYPH: Record<string, string> = { todo: '○', running: '◐', done: '✓', blocked: '!', proposed: '?' }

export const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
}

// A lot's outcome lines (UX.md Q2, Q7), one line each: the judge's verdict and its age once judged, then what it is done when and the check.
export const lotLines = (l: Board['lots'][number], now: number) => [
  l.verdict && l.status !== 'running' ? `${l.verdict.verdict}: ${l.verdict.note}${l.verdictAt ? ` · ${ago(now - l.verdictAt)} ago` : ''}` : '',
  l.doneWhen ? `done when: ${l.doneWhen}${l.check ? ` · check: ${l.check}` : ''}` : '',
].filter(Boolean)

export function bar(frac: number, w: number): string {
  const f = Math.max(0, Math.min(w, Math.round(frac * w)))
  return '█'.repeat(f) + '░'.repeat(w - f)
}

// The loop as one line, the session's stage lit: assign ─▶ work ─▶ report ─▶ judge, a moving dot on it.
export function loopLine(stage: Stage, tick: number): { t: string; on: boolean }[] {
  const names: Record<string, string> = { assigned: 'assign', work: 'work', report: 'report', judge: 'judge' }
  const at = LOOP.indexOf(stage === 'stuck' ? 'work' : stage)
  return LOOP.flatMap((s, i) => {
    const on = i === at
    const seg = [{ t: on ? `${spinner(tick)} ${names[s]}` : `  ${names[s]}`, on }]
    if (i < LOOP.length - 1) seg.push({ t: i === at ? ' ' + '─'.repeat(tick % 3) + '▶' + '─'.repeat(2 - (tick % 3)) + ' ' : ' ──▶ ', on: false })
    return seg
  })
}

// ---------------------------------------------------------------- pure parts of the pane

export const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s.padEnd(n))
export const STALE_MS = 10 * 60e3
export const isStale = (b: Pick<Board, 'at'>, now: number) => now - b.at > STALE_MS
// The stage glyph a session keeps when nothing may move (a stale board): the same family as the band.
export const STAGE_GLYPH: Record<Stage, string> = { free: '○', assigned: '◔', work: '◑', stuck: '◍', report: '◕', judge: '◕', waits: '❓', gate: '⛩', blocked: '!' }
export const MOVING: Stage[] = ['assigned', 'work', 'report', 'judge'] // the stages that spin
const ORDER: Stage[] = ['waits', 'gate', 'stuck', 'blocked', 'judge', 'report', 'work', 'assigned', 'free']
export const sortSessions = (s: BoardSession[]) => [...s].sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage))
// Running lots, then blocked, then todo, each by n; done lots apart.
export const planOrder = (lots: Board['lots']) => {
  const rank: Record<string, number> = { running: 0, blocked: 1, todo: 2, proposed: 3 }
  return {
    open: lots.filter(l => l.status !== 'done').sort((a, b) => rank[a.status]! - rank[b.status]! || a.n - b.n),
    done: lots.filter(l => l.status === 'done').sort((a, b) => a.n - b.n),
  }
}

// The segmented gauge: green done, yellow running, gray rest. The three widths always sum to w.
export function gaugeSegs(done: number, running: number, n: number, w: number): [number, number, number] {
  if (n <= 0) return [0, 0, w]
  const d = Math.min(w, Math.round((done / n) * w))
  const r = Math.min(w - d, Math.round((running / n) * w))
  return [d, r, w - d - r]
}

// What needs the person, ranked: sessions that wait, sessions stuck, blocked lots, the budget, a silent overseer.
export type Need =
  | { kind: 'waits' | 'stuck'; id: string; red: true; session: BoardSession }
  | { kind: 'blocked'; id: string; red: true; lot: Board['lots'][number] }
  | { kind: 'budget'; id: string; red: boolean; level: string }
  | { kind: 'stale'; id: string; red: false }
  | { kind: 'plan' | 'incomplete' | 'departs' | 'judge' | 'reinstall' | 'gate' | 'review'; id: string; red: boolean; lot?: Board['lots'][number]; session?: BoardSession; text?: string }
// The command a blocked task asks the person to run: the last ": <cmd>" before ", then" in its note, as the session wrote it
// (`[lot N blocked: reinstall: claude plugin update overseer@claude-mods, then restart the overseer session]`).
export const cmdOf = (note?: string) => note?.match(/:\s*([^:]+?),\s*then\b/)?.[1]?.trim() || undefined
const isReinstall = (l: Pick<Board['lots'][number], 'status' | 'note'>) => l.status === 'blocked' && /^reinstall\b/i.test(l.note ?? '')
export function needsYou(b: Board, now: number): Need[] {
  const ss = (stage: Stage) => b.sessions.filter(s => s.stage === stage).sort((a, c) => a.since - c.since)
  return [
    ...ss('waits').map(session => session.departs
      ? { kind: 'departs' as const, id: `departs:${session.sessionId}`, red: true, session, text: `task ${session.lot} departs: ${session.departs}` }
      : { kind: 'waits' as const, id: session.sessionId, red: true as const, session }),
    ...ss('gate').map(session => ({ kind: 'gate' as const, id: session.sessionId, red: true, session, text: session.gate?.name })),
    ...ss('stuck').map(session => ({ kind: 'stuck' as const, id: session.sessionId, red: true as const, session })),
    ...b.lots.filter(l => l.status === 'blocked').sort((a, c) => a.n - c.n).map(lot => isReinstall(lot)
      ? { kind: 'reinstall' as const, id: `reinstall:${lot.n}`, red: true, lot, text: cmdOf(lot.note) ?? lot.note }
      : { kind: 'blocked' as const, id: String(lot.n), red: true as const, lot }),
    ...b.lots.filter(l => l.noVerdict).map(lot => ({ kind: 'judge' as const, id: `judge:${lot.n}`, red: true, lot, text: `task ${lot.n}: the judge gave no verdict` })),
    ...(b.proposed?.length ? [{ kind: 'plan' as const, id: 'plan', red: true, text: `Approve ${b.proposed.length} new task${b.proposed.length > 1 ? 's' : ''} of PLAN.md?` }] : []),
    ...b.lots.filter(l => l.status === 'done' && l.review).map(lot => ({ kind: 'review' as const, id: `review:${lot.n}`, red: false, lot, text: lot.review })),
    ...b.lots.filter(l => l.status === 'todo' && l.brief && missing(l.brief).length).map(lot => ({ kind: 'incomplete' as const, id: `incomplete:${lot.n}`, red: true, lot, text: `plan incomplete: task ${lot.n} needs ${missing(lot.brief!).join(', ')}` })),
    ...(b.budget && (b.budget.level === 'reduce' || b.budget.level === 'stop') ? [{ kind: 'budget' as const, id: 'budget', red: b.budget.level === 'stop', level: b.budget.level }] : []),
    ...(isStale(b, now) ? [{ kind: 'stale' as const, id: 'stale', red: false as const }] : []),
  ]
}
// The lot the focus block's next action is about, for the graph to ring: a blocked lot, or the lot of a
// session that waits on the person or is stuck; none when the next action is about no lot.
export function focusLot(b: Board, now: number): number | undefined {
  const n = needsYou(b, now)[0]
  return n?.kind === 'blocked' ? n.lot.n : n?.kind === 'reinstall' || n?.kind === 'judge' ? n.lot?.n : n?.kind === 'waits' || n?.kind === 'stuck' ? n.session.lot : undefined
}
// The pane's tone: red when something red needs the person, yellow when only a warning does, else magenta.
export const toneOf = (needs: Need[]) => (needs.some(n => n.red) ? PALETTE.alert : needs.length ? PALETTE.warn : PALETTE.accent)

// The branches as they sit in the repository's worktrees, a tree rooted on the base branch: the main
// checkout first, then each worktree (in merge order), then the branches no worktree holds, then
// detached worktrees. A branch is only ever one row; a worktree on the base branch is the main one.
export type TreeRow = {
  kind: 'main' | 'worktree' | 'branch' | 'detached'
  where: string // the worktree's path, short; "(no worktree)" for a bare branch
  branch?: string
  owner?: string
  dirty: number
  ahead?: number; behind?: number; files?: number
  merge?: { order: number; conflicts: string[] }
  overlaps?: string[]
  stale: boolean
  isPrunable?: boolean
}
export function shortPath(path: string, top?: string, home?: string): string {
  if (top && path === top) return './'
  if (top && path.startsWith(`${top}/`)) return `./${path.slice(top.length + 1)}`
  const p = home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
  const parts = p.split('/')
  return parts.length > 4 ? `…/${parts.slice(-2).join('/')}` : p
}
export function worktreeTree(b: Pick<Board, 'branches' | 'worktrees' | 'top' | 'base'>, home?: string, staleBehind = 100): TreeRow[] {
  const wts = b.worktrees ?? []
  const brs = b.branches ?? []
  const byName = new Map(brs.map(x => [x.name, x]))
  const rows: TreeRow[] = []
  for (const w of wts.filter(w => w.isMain)) rows.push({ kind: 'main', where: shortPath(w.path, b.top, home), branch: w.branch, owner: w.owner, dirty: w.dirty, stale: false })
  const held = wts.filter(w => !w.isMain && w.branch)
  const order = (name?: string) => byName.get(name ?? '')?.merge?.order ?? 999
  for (const w of [...held].sort((x, y) => order(x.branch) - order(y.branch) || (x.branch ?? '').localeCompare(y.branch ?? ''))) {
    const br = byName.get(w.branch!)
    rows.push({ kind: 'worktree', where: shortPath(w.path, b.top, home), branch: w.branch, owner: w.owner ?? br?.owner, dirty: w.dirty, isPrunable: w.isPrunable, ahead: br?.ahead, behind: br?.behind, files: br?.files, merge: br?.merge, overlaps: br?.overlaps, stale: (br?.behind ?? 0) > staleBehind })
  }
  const inTree = new Set(wts.map(w => w.branch).filter(Boolean))
  for (const br of [...brs].filter(x => !inTree.has(x.name)).sort((x, y) => (x.merge?.order ?? 999) - (y.merge?.order ?? 999))) {
    rows.push({ kind: 'branch', where: '(no worktree)', branch: br.name, owner: br.owner, dirty: 0, ahead: br.ahead, behind: br.behind, files: br.files, merge: br.merge, overlaps: br.overlaps, stale: br.behind > staleBehind })
  }
  for (const w of wts.filter(w => !w.isMain && !w.branch)) rows.push({ kind: 'detached', where: shortPath(w.path, b.top, home), owner: w.owner, dirty: w.dirty, stale: false })
  return rows
}

// The commit graph with the worktrees and sessions on their branches, as one Svg: the desktop pane and the web board draw the same one.
export function boardGitSvg(b: Board, rows: GraphRow[], now: number, home: string, label: (id?: string) => string, width: number): { svg: string; height: number } {
  const tree = worktreeTree(b, home)
  const byBranch = new Map(tree.filter(x => x.branch).map(x => [x.branch!, x]))
  return gitSvg({
    rows,
    chipOf: ref => {
      const x = byBranch.get(ref)
      const isBase = ref === (b.base ?? 'main')
      const note = [x?.owner ? label(x.owner) : '', x?.dirty ? `●${x.dirty}` : ''].filter(Boolean).join(' · ')
      return { text: ref, color: isBase ? PALETTE.accent : x?.kind === 'branch' || !x ? PALETTE.muted : PALETTE.info, ...(note ? { note, noteColor: PALETTE.info } : {}), ...(x?.merge?.conflicts.length ? { conflicts: x.merge.conflicts } : {}) }
    },
    ago: at => ago(now - at),
    worktrees: tree.filter(x => x.kind !== 'branch').map(x => ({
      icon: x.kind === 'main' ? '▣' : x.kind === 'detached' ? '◇' : '▢',
      branch: x.branch ?? '(detached)',
      where: x.where,
      ...(x.owner ? { owner: label(x.owner) } : {}),
      state: x.isPrunable ? 'folder gone (git worktree prune)' : x.merge?.conflicts.length ? `✗ ${x.merge.conflicts.join(', ')}` : x.dirty ? `● ${x.dirty} uncommitted` : x.merge ? `✓ merges clean (${x.merge.order})` : x.stale ? 'stale' : '—',
      stateColor: x.merge?.conflicts.length ? PALETTE.alert : x.dirty ? PALETTE.warn : x.merge ? PALETTE.ok : PALETTE.muted,
      title: [x.branch ?? '(detached)', x.where, x.owner ? label(x.owner) : '', ...(x.merge?.conflicts ?? [])].filter(Boolean).join(' · '),
      isMain: x.kind === 'main',
    })),
    width, laneColors: LANES, ink: '#d7dae0', muted: PALETTE.muted, alert: PALETTE.alert,
  })
}

// A workflow run of a watched session, read from its journal (one line per agent started / returned).
// startedAt, endedAt, durationMs, model, state and preview come from wf_*.json (a run that ended) or the agents' transcripts; steps are one per agent.
export type WorkflowRun = { runId: string; name: string; session: string; started: number; done: number; running: string[]; phase?: string; isActive: boolean; startedAt?: number; endedAt?: number; durationMs?: number; model?: string; state?: string; preview?: string; steps?: Step[] }
export function readJournal(text: string): Pick<WorkflowRun, 'started' | 'done' | 'running' | 'phase'> {
  const open = new Map<string, { label: string; phase?: string }>()
  let started = 0, done = 0, phase: string | undefined
  for (const line of text.split('\n')) {
    let d: { type?: string; agentId?: string; label?: string; phase?: string }
    try { d = JSON.parse(line) } catch { continue }
    if (d.type === 'started' && d.agentId) { started++; open.set(d.agentId, { label: d.label ?? d.agentId, phase: d.phase }); phase = d.phase ?? phase }
    if (d.type === 'result' && d.agentId) { done++; open.delete(d.agentId) }
  }
  return { started, done, running: [...open.values()].map(x => x.label), phase }
}

// The commit graph rows (tree.ts): the --graph prefix, the commit, its parents, lane, lot and release.
export { GRAPH_FORMAT, parseGraph, type GraphRow } from './tree.ts'

// One graph cell per character, in the look of a git graph view: a node, a lane, a fork or a join,
// each lane in its own colour (the column it sits in, two characters per lane, as git draws them).
export { LANES as LANE_COLORS } from './band.tsx' // six soft OKLCH hues at one lightness
export function graphCells(graph: string): { ch: string; lane: number }[] {
  const map: Record<string, string> = { '*': '●', '|': '│', '/': '╱', '\\': '╲', '_': '─', '-': '─', '.': '·' }
  return [...graph].map((c, i) => ({ ch: map[c] ?? c, lane: Math.floor(i / 2) }))
}

// Lot durations and recent wins, from the overseer's own log: "assign" (text "lot N. title") then
// "done" (label "lot N"). The median is what the focus block's estimate rests on.
export function paceOf(log: { at: number; action: string; label: string; text: string }[], _lots: { n: number; title: string }[], now: number): { pace?: number; wins: { n: number; title: string; at: number }[] } {
  // Each assignment carries its own title (a later plan may reuse the number); a "done" consumes it,
  // so a completion logged twice counts once in the pace.
  const assigned = new Map<number, { at: number; title: string }>()
  const took: number[] = []
  const wins = new Map<number, { n: number; title: string; at: number }>()
  for (const e of log) {
    const a = e.action === 'assign' ? e.text.match(/^(?:lot|task) (\d+)\.\s*(.*)$/) : null
    if (a) assigned.set(Number(a[1]), { at: e.at, title: a[2]!.trim() })
    const d = e.action === 'done' ? e.label.match(/^(?:lot|task) (\d+)$/) : null
    if (!d) continue
    const n = Number(d[1])
    const from = assigned.get(n)
    if (from) { took.push(e.at - from.at); assigned.delete(n) }
    if (now - e.at <= 12 * 3600e3) wins.set(n, { n, title: from?.title ?? wins.get(n)?.title ?? '', at: e.at })
  }
  took.sort((x, y) => x - y)
  return { pace: took.length ? took[Math.floor(took.length / 2)] : undefined, wins: [...wins.values()].sort((x, y) => y.at - x.at) }
}

// The ADHD focus block: ONE next action (doable in about 2 min), where things stand, an estimate in
// concrete units, the wins made visible, and at most three things after. Ranked by what costs most
// when left waiting: a session blocked on the person first.
export type Focus = { next: string; why?: string; card?: string[]; state: string; activity: string; eta?: string; wins: string[]; then: string[] }
// The actions to take, ranked: one per need (same order as needsYou, so the first needs.length are the needs), then suggestions.
// The lots that wait on lot n, directly or through depends, ascending.
export function blocksOf(lots: Pick<Board['lots'][number], 'n' | 'depends'>[], n: number): number[] {
  const out = new Set<number>()
  for (let grew = true; grew;) { grew = false; for (const l of lots) if (!out.has(l.n) && l.depends.some(d => d === n || out.has(d))) { out.add(l.n); grew = true } }
  return [...out].sort((a, c) => a - c)
}
// One card for a session that waits on the person (lot 19 puts the answer buttons in it): the question, what the session recommends (only if it wrote one), what it blocks and for how long.
export function decisionCard(s: BoardSession, lots: Board['lots'], now: number): string[] {
  const blocks = s.lot ? blocksOf(lots, s.lot) : []
  return [
    `Answer ${s.label}${s.lot ? ` (task ${s.lot})` : ''}: “${(s.question ?? '').slice(0, 90)}”`,
    ...(s.recommend ? [`recommends: ${s.recommend.option}${s.recommend.why ? ` — ${s.recommend.why}` : ''}`] : []),
    `${blocks.length ? `blocks: tasks ${blocks.join(', ')} · ` : ''}waited ${ago(now - s.since)}`,
  ]
}
// A lot's criteria with their marks (lot 34): the judge's mark, or "not judged" for a done lot the judge did not mark
// (judged before lot 34, by hand, or with a length mismatch), or "todo" for an open lot.
export function checklist(l: Pick<Board['lots'][number], 'status' | 'brief' | 'marks'>): { text: string; mark: Mark['mark'] | 'not judged'; ev?: string }[] {
  return (l.brief?.criteria ?? []).map((text, i) => {
    const m = l.marks?.find(x => x.i === i)
    return m ? { text, mark: m.mark, ...(m.ev ? { ev: m.ev } : {}) } : { text, mark: l.status === 'done' ? 'not judged' as const : 'todo' as const }
  })
}
// One need, one action (lot 54): its text, and what closes it: `act` is the request the board sends (the KEYS table of
// CONTRACT.md: `e` done, `a`/`c`/`r` for a gate or a plan, an option or a text for a question), `cmd` the command to copy
// (`y`). A need with no `act` is closed by the person outside the board (stale: the silent overseer reads no request).
export type Act = { kind: 'answer'; sessionId: string } | { kind: 'lot'; lot: number; action: 'done' | 'retry' | 'drop' | 'accept-departure' | 'reviewed' } | { kind: 'run'; paused: boolean } | { kind: 'gate'; session: string; plan: string; action: 'approve' } | { kind: 'plan'; approve: number[] }
export type Action = { text: string; why?: string; card?: string[]; act?: Act; cmd?: string }
export function actionOf(n: Need, b: Board, now: number): Action {
  switch (n.kind) {
    case 'waits': { const card = decisionCard(n.session, b.lots, now); return { text: card[0]!, card, act: { kind: 'answer', sessionId: n.session.sessionId } } }
    case 'stuck': return { text: `Look at ${n.session.label}: stuck for ${ago(now - n.session.since)}`, why: n.session.note, ...(n.session.lot ? { act: { kind: 'lot', lot: n.session.lot, action: 'retry' } } : {}) }
    case 'blocked': { const cmd = cmdOf(n.lot.note); return { text: `Unblock task ${n.lot.n} (${n.lot.title})${n.lot.note ? `: ${n.lot.note.slice(0, 90)}` : ''}`, why: 'every task after it waits too', act: { kind: 'lot', lot: n.lot.n, action: 'done' }, ...(cmd ? { cmd } : {}) } }
    case 'reinstall': return { text: `Reinstall, then press e: ${n.text ?? ''}`, why: `task ${n.lot!.n} waits for it; e checks the installed version first`, act: { kind: 'lot', lot: n.lot!.n, action: 'done' }, ...(n.text ? { cmd: n.text } : {}) }
    case 'budget': return n.level === 'stop' ? { text: 'Budget spent: raise it (/oversee run <points>) or let the run stop', why: 'no new task goes out', act: { kind: 'run', paused: true } } : { text: 'Budget low: raise it (/oversee run <points>) or let the models step down', why: 'the run goes on', act: { kind: 'run', paused: true } }
    case 'stale': return { text: 'The overseer is silent: open its session and check it is still on', why: `last update ${ago(now - b.at)} ago`, cmd: `claude --resume ${b.overseer}` }
    case 'incomplete': return { text: `Complete task ${n.lot!.n} in PLAN.md: ${n.text ?? ''}`, why: 'it is not handed out until then' }
    case 'departs': return { text: `Task ${n.session!.lot} departs from the plan: accept it, or send it back`, why: n.text, act: { kind: 'lot', lot: n.session!.lot!, action: 'accept-departure' } }
    case 'judge': return { text: `Judge task ${n.lot!.n} (${n.lot!.title}) yourself: the judge gave no verdict twice`, why: 'e marks it done; it is not judged again until its session reports again', act: { kind: 'lot', lot: n.lot!.n, action: 'done' } }
    case 'plan': return { text: n.text!, why: 'proposed tasks wait; none is handed out before you approve', act: { kind: 'plan', approve: b.proposed ?? [] } }
    case 'gate': return { text: `A workflow waits for your approval: ${n.text ?? ''}`, act: { kind: 'gate', session: n.session!.sessionId, plan: n.session!.gate?.fp ?? '', action: 'approve' } }
    case 'review': return { text: `Look at it: ${n.text ?? ''}`, why: `task ${n.lot!.n} is done; its session left this for you`, act: { kind: 'lot', lot: n.lot!.n, action: 'reviewed' } }
  }
}
export function actionsOf(b: Board, now: number): Action[] {
  const needs = needsYou(b, now)
  const todo = b.lots.filter(l => l.status === 'todo').length
  const running = b.lots.filter(l => l.status === 'running').length
  const free = b.sessions.filter(s => s.stage === 'free')
  const clean = (b.branches ?? []).filter(x => x.merge && !x.merge.conflicts.length).length
  const actions: Action[] = needs.map(n => actionOf(n, b, now)) // action i is need i's
  if (clean >= 2) actions.push({ text: `Run /oversee merge: ${clean} branches merge clean onto ${b.base ?? 'main'}`, why: 'merging early keeps conflicts small' })
  if (free.length && !todo && !running && b.lots.length) actions.push({ text: 'Every task is done or taken: write the next tasks (/oversee plan <goal>)', why: `${free.length} session${free.length > 1 ? 's' : ''} idle` })
  return actions
}

// The ADHD focus block: ONE next action (doable in about 2 min), where things stand, an estimate in
// concrete units, the wins made visible, and at most three things after. Ranked by what costs most
// when left waiting: a session blocked on the person first.
export function focusOf(b: Board, now: number): Focus {
  const todo = b.lots.filter(l => l.status === 'todo').length
  const running = b.lots.filter(l => l.status === 'running').length
  const done = b.lots.filter(l => l.status === 'done').length
  const working = b.sessions.filter(s => ['assigned', 'work', 'report', 'judge'].includes(s.stage)).length
  const free = b.sessions.filter(s => s.stage === 'free')
  const actions = actionsOf(b, now)
  const left = todo + running
  const lanes = Math.max(1, working)
  const eta = b.pace && left ? `about ${ago(Math.round((left / lanes) * b.pace))} left at this pace (${left} task${left > 1 ? 's' : ''}, ${ago(b.pace)} each, ${lanes} at a time)` : undefined
  const next = actions[0] ?? { text: working ? `Nothing needs you. ${working} session${working > 1 ? 's' : ''} at work; look again at the next pass (${ago(Math.max(0, b.nextPassAt - now))})` : 'Nothing needs you and nothing runs: start a run (/oversee run) or close the board' }
  return {
    next: next.text, why: next.why, card: next.card,
    state: `${done}/${b.lots.length} tasks done · ${working} working · ${free.length} free${b.budget ? ` · ${b.budget.spent.toFixed(1)}/${b.budget.budget} pts` : ''}`,
    activity: `${working} working · ${free.length} free`, // the state without what the PROGRESS · BUDGET line already says
    eta,
    wins: (b.wins ?? []).slice(0, 3).map(w => `task ${w.n}${w.title ? ` ${w.title}` : ''} (${ago(now - w.at)} ago)`),
    then: actions.slice(1, 4).map(a => a.text),
  }
}

// If every session closed now, what would be lost (UX.md Q8), per worktree: the uncommitted files, the running workflows
// and their agents, and the sessions in `work` with no commit since their lot started. Local commits are not at risk:
// closing a session keeps its branch. A workflow whose session has no worktree here is listed under "(no worktree)".
export type AtRisk = { where: string; branch?: string; files: string[]; workflows: { name: string; agents: string[] }[]; silent: { label: string; lot?: number; since: number }[] } // silent.since: when the lot started
export function atRisk(b: Pick<Board, 'worktrees' | 'workflows' | 'sessions' | 'top'>, home?: string): AtRisk[] {
  const wfs = (b.workflows ?? []).filter(w => w.isActive)
  const rows: AtRisk[] = []
  const taken = new Set<string>()
  for (const w of b.worktrees ?? []) {
    if (w.isPrunable) continue
    const mine = wfs.filter(x => w.owner && x.session === w.owner)
    mine.forEach(x => taken.add(x.runId))
    const silent = b.sessions.filter(s => s.stage === 'work' && w.owner === s.sessionId && s.lotStartedAt !== undefined && (w.lastCommitAt ?? 0) < s.lotStartedAt)
    const row: AtRisk = { where: shortPath(w.path, b.top, home), branch: w.branch, files: w.files ?? [], workflows: mine.map(x => ({ name: x.name, agents: x.running })), silent: silent.map(s => ({ label: s.label, lot: s.lot, since: s.lotStartedAt! })) }
    if (row.files.length || row.workflows.length || row.silent.length) rows.push(row)
  }
  const loose = wfs.filter(x => !taken.has(x.runId))
  if (loose.length) rows.push({ where: '(no worktree)', files: [], workflows: loose.map(x => ({ name: x.name, agents: x.running })), silent: [] })
  return rows
}

// One line of it: `./ main · 3 uncommitted (a.ts, b.ts +1) · workflow build: 2 agents running · alpha: no commit since lot 2 started`
export function atRiskLine(r: AtRisk, now: number): string {
  const f = r.files.length ? [`${r.files.length} uncommitted (${r.files.slice(0, 2).join(', ')}${r.files.length > 2 ? ` +${r.files.length - 2}` : ''})`] : []
  const w = r.workflows.map(x => `workflow ${x.name}: ${x.agents.length} agent${x.agents.length === 1 ? '' : 's'} running`)
  const s = r.silent.map(x => `${x.label}: no commit since ${x.lot ? `task ${x.lot}` : 'its task'} started (${ago(now - x.since)})`)
  return [`${r.where}${r.branch ? ` ${r.branch}` : ''}`, ...f, ...w, ...s].join(' · ')
}

// DECISIONS.md at the repository top: what the person decided, one line each, so a fresh session can pick it up
// (UX.md Q6). No prompt reads it: the judge reads PLAN.md only.
export type Decision = { at: string; lot: string; question: string; answer: string }
const one = (t: string) => t.replace(/\s+/g, ' ').replace(/ · /g, ' ∙ ').trim()
export const decisionLine = (at: number, lot: number | undefined, question: string, answer: string) =>
  `- ${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} · ${lot ? `task ${lot}` : 'no task'} · ${one(question).slice(0, 140)} · ${one(answer).slice(0, 200)}`
export function parseDecisions(md: string, n = 12): Decision[] {
  return md.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).split(' · ')).filter(p => p.length >= 4)
    .map(p => ({ at: p[0]!, lot: p[1]!, question: p.slice(2, -1).join(' · '), answer: p.at(-1)! })).slice(-n).reverse()
}
