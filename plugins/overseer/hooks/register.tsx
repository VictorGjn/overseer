import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Assignment, Intervention, Oversight, Watched } from '../types'
import { band, gauge, oklch, PALETTE } from './band.tsx'
import { actionOf, actionsOf, ago, blockedOn, checklist, decisionLine, parseDecisions, answerView, atRisk, atRiskLine, boardFor, boardLot, boardGitSvg, focusLot, isStale, loopLine, lotLines, MOVING, needsYou, pad, planOrder, readJournal, focusOf, paceOf, graphCells, LANE_COLORS, slugOf, sortSessions, spinner, stageOf, STAGE_GLYPH, STATUS_GLYPH, toneOf, worktreeTree } from './board.ts'
import { conflictsOf, ownerOf, parseWorktrees, reconcileMessage, tryOrder, withOverlaps } from './branches.ts'
import type { Branch, Worktree } from './branches.ts'
import type { Board, BoardRequest, Change, GraphRow, SessionGate, Stage, WorkflowRun } from './board.ts'
import { doneRun, gatePlan, ownsRun, readAgent, stepsOf, windowMins } from './steps.ts'
import type { AgentInfo, GatePlan } from './steps.ts'
import { fromLead, answerFrom, answerResult, asksInText, checkRequest } from './answer.ts'
import { approvedMessage, changeMessage as gateChangeMessage, decisionOf, fingerprintOf, gateCliOf, gateRefusal, parseGateRequest, rejectMessage, SUMMARY, type BoardGate, type GateRequest } from './gate.ts'
import type { Request } from './answer.ts'
import { identity, parseRoles } from './peers.ts'
import type { RoleEntry } from './peers.ts'
import { liveBackground, needsHelp, OVERSEER_SYSTEM, overseerPrompt, parseActions, peerOf, pick, stuckWhy, waitsOn } from './peers.ts'
import type { Peer, Registry } from './peers.ts'
import { changeMessage, checkRun, fileUnderWaiting, isIdle, judgeContext, judgeTokens, LEAD_SYSTEM, leadPrompt, levelOf, lotMessage, openChanges, ownedBy, parsePlan, parseVerdict, PLAN_FORMAT, readyLots, reviewOf, setLot, statusTable, tierFor } from './plan.ts'
import type { Lot } from './plan.ts'
import { advance, READ_CAP, totalOf, wfTokens } from './tokens.ts'
import type { LotTokens } from './tokens.ts'
import { CHECK_STUCK_DIR, CHECK_STUCK_MIN, parseStuck, stuckFor } from './checkstuck.ts'
import type { CheckStuck } from './checkstuck.ts'
import { needPrompts, newNeeds } from './needprompt.ts'
import { rebase, spentOf } from './budget.ts'
import { collisionsOf, edits, prune } from './collisions.ts'
import { QR_SCRIPT, qrLines, SERVE, SERVE_OFF, SETUP, tailnetOf } from './phone.ts'
import { newIdOf, renameOversight, renamePlan, type Cleared } from './follow.ts'
import { isBoardPid, launchArgv, parseAnswer, PORT, serverAction, startCommand } from './webserver.ts'
import { integrationOf, lotGit, type Git, type LotGit } from './proofs.ts'
import { treeOf as gitTreeOf } from './tree.ts'
import { camColsFor, compactRaster, graphRaster, graphSvg, layout, sparkline, step } from './graph.ts'
import { table, zoomOf } from './kit/surface.ts'

// The overseer holds the project: it runs PLAN.md through the sessions the person picked
// (/oversee watch), giving each a lot, judging the work, keeping a weekly-limit budget, and
// answering what they wait on. It never starts, stops or reads any other session.
const oversight = atom({ plugin: 'overseer', key: 'oversight' } as const, null)
const lastSent = new Map<string, number>() // sessionId → when the overseer last wrote to it
const MAX_TRIES = 2 // a lot judged "retry" goes back to its session once, then is marked blocked
// A need for Victor makes one prompt to this session (needprompt.ts), once the session takes it: the next pass tries again while a turn runs.
async function promptNeeds($: EngineInterface) {
  const o = await read($, oversight)
  const b = o?.isOn ? await readBoard($) : undefined
  if (!o || !b || b.overseer !== (await $.session.id())) return
  const { fresh, kept } = newNeeds(needPrompts(b, await $.clock.now()), o.needed)
  const told = [...kept]
  for (const n of fresh) {
    if (!(await $.prompt.submit({ text: n.text }).then(() => true, () => false))) break // busy: the rest wait, none is lost
    told.push(n.key)
  }
  if (JSON.stringify(told) !== JSON.stringify(o.needed ?? [])) await update($, oversight, x => x && { ...x, needed: told })
}

let isPassing = false
let passQueued = false // a /pass that came during a pass: it runs once that pass ends
let passTimer: { cancel(): void } | undefined // the every() clock of the passes; /pass cancels and re-arms it
let passStartedAt = 0 // a pass stuck on an await that never settles must not stop every later one
const PANE = 'overseer'
const PHONE_PANE = 'overseer-phone'
const FOCUS_BORDER = oklch(0.43, 0.05, 25) // #6b4642, a dark coral: the focus block's border while something needs the person (band.tsx is frozen)
const isOpen = atom({ plugin: 'overseer', key: 'isOpen' } as const, false) // the band's accordion
const tick = atom({ plugin: 'overseer', key: 'tick' } as const, 0) // moves the pane's spinners while it is open
const paneOpen = atom({ plugin: 'overseer', key: 'paneOpen' } as const, false)
const boardAt = atom({ plugin: 'overseer', key: 'boardAt' } as const, 0) // when writeBoard last wrote: the pane reads it, so it redraws then
const paneMore = atom({ plugin: 'overseer', key: 'paneMore' } as const, false) // the pane's "More": done lots, the whole feed, last words
const paneLog = atom({ plugin: 'overseer', key: 'paneLog' } as const, false) // the pane's log view
const motion = atom({ plugin: 'overseer', key: 'motion' } as const, null) // what moved on the graph since this session last looked
const judging = new Set<string>() // sessions whose lot the lead is judging right now
let lastPeers = new Map<string, Peer>()
let lastBranches: { top: string; base: string; branches: Branch[]; worktrees?: Worktree[]; graph?: GraphRow[]; graphCut?: number } | undefined
let lastProofs = new Map<number, LotGit>() // lot → its git evidence, read at the last pass (lot 33)
const proofCache = new Map<string, LotGit>() // ponytail: module memory, cleared past 500 keys; a reload reads everything once
const CACHE_TTL_MS = 60 * 60e3 // the prompt cache's lifetime (1 h)
let cfg = { model: 'sonnet', leadModel: 'opus', planFile: 'PLAN.md', everyMs: 3 * 60e3 }

const sh = async ($: EngineInterface, cmd: string[]) => {
  const r = await $.process.run(cmd).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout.trim() : ''
}
const weekly = async ($: EngineInterface) => (await $.session.usage()).rateLimits.find(r => r.kind === 'seven_day')?.percentUsed ?? null
// To another session, a message; to the overseer's own session, a prompt between its turns (refused
// while a turn runs: the next pass tries again, nothing logged). A message that is not delivered is
// logged with its reason (send-refused), once per session and reason until one gets through: a lot
// that cannot be sent stays todo and is tried again every pass, so a run is never silently empty.
const send = async ($: EngineInterface, sessionId: string, text: string) => {
  if (sessionId === (await $.session.id())) return $.prompt.submit({ text: `[overseer] ${text}` }).then(() => true, () => false)
  const r = await $.session.send({ to: { sessionId }, text: `[overseer] ${text}` }).catch((err: unknown) => ({ isDelivered: false as const, reason: String(err) }))
  const o = await read($, oversight)
  if (r.isDelivered) {
    if (o?.refused?.[sessionId] !== undefined) await update($, oversight, x => x && { ...x, refused: Object.fromEntries(Object.entries(x.refused ?? {}).filter(([id]) => id !== sessionId)) })
    return true
  }
  const reason = r.reason || 'not delivered'
  if (o?.refused?.[sessionId] === reason) return false
  await update($, oversight, x => x && { ...x, refused: { ...x.refused, [sessionId]: reason } })
  await note($, { sessionId, label: o?.watched.find(w => w.sessionId === sessionId)?.label ?? sessionId.slice(0, 8), action: 'send-refused', text: `message not delivered: ${reason}` })
  return false
}
// Everything goes to the log; only what needs the person toasts (UX.md rule 7: once per item): a new
// wait, a block, the budget spent, an overseer error, a refused message. The same toast seen again
// within 10 min shows with a count (×3); the window slides from the last sighting.
const LOUD = new Set(['waits', 'blocked', 'error', 'send-refused'])
const toasted = new Map<string, { at: number; n: number }>() // action+label → last toast
const waiting = new Set<string>() // sessions already noted as waiting on a question
const note = async ($: EngineInterface, i: Omit<Intervention, 'at'>, isLoud = LOUD.has(i.action)) => {
  const at = await $.clock.now()
  await update($, oversight, x => x && { ...x, log: [...x.log, { ...i, at }].slice(-150) })
  if (!isLoud) return
  for (const [key, v] of toasted) if (at - v.at >= 10 * 60e3) toasted.delete(key)
  const k = `${i.action}\0${i.label}`
  const t = toasted.get(k)
  const n = t && at - t.at < 10 * 60e3 ? t.n + 1 : 1
  toasted.set(k, { at, n })
  $.ui.toast(`👁 overseer: ${i.action} → ${i.label}${n > 1 ? ` ×${n}` : ''}`)
}

// Every local branch ahead of the base: its worktree and the session on it, the files it changes,
// then a trial merge of all of them onto the base, in order, without touching any branch or worktree
// (merge-tree and commit-tree only write objects; nothing points at them).
async function branchesOf($: EngineInterface, top: string, sessions: { sessionId: string; cwd: string }[], run?: { integration?: string; start?: string }) {
  const git = (...a: string[]) => sh($, ['git', '-C', top, ...a])
  // A run's base is its integration branch (lot 33); with no run, origin's default branch, else main.
  const base = run?.integration || (await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).replace(/^origin\//, '') || 'main'
  const wts = parseWorktrees(await git('worktree', 'list', '--porcelain'))
  const raw: Omit<Branch, 'overlaps'>[] = []
  for (const name of (await git('for-each-ref', '--format=%(refname:short)', 'refs/heads')).split('\n')) {
    if (!name || name === base) continue
    const [behind = 0, ahead = 0] = (await git('rev-list', '--left-right', '--count', `${base}...${name}`)).split(/\s+/).map(Number)
    if (!ahead) continue
    const path = wts.find(w => w.branch === name)?.path
    raw.push({ name, path, owner: path ? ownerOf(path, sessions) : undefined, ahead, behind, files: (await git('diff', '--name-only', `${base}...${name}`)).split('\n').filter(Boolean) })
  }
  const branches: Branch[] = tryOrder(withOverlaps(raw))
  let cur = await git('rev-parse', base)
  let order = 0
  for (const b of branches) {
    const r = await $.process.run(['git', '-C', top, 'merge-tree', '--write-tree', '--name-only', '--no-messages', cur, b.name]).catch(() => undefined)
    if (!r || r.exitCode > 1) continue // git too old or the branch is gone: no trial for it
    b.merge = { order: ++order, conflicts: r.exitCode === 0 ? [] : conflictsOf(r.stdout) }
    if (r.exitCode === 0) cur = (await git('commit-tree', r.stdout.split('\n')[0]!.trim(), '-p', cur, '-p', b.name, '-m', 'overseer: trial merge')) || cur
  }
  // The worktrees themselves, each with its uncommitted files: the branches live in them.
  const worktrees: Worktree[] = []
  for (const [i, w] of wts.entries()) {
    const files = w.isPrunable ? [] : (await sh($, ['git', '-C', w.path, 'status', '--porcelain'])).split('\n').filter(Boolean).map(l => l.slice(3))
    const lastCommitAt = w.isPrunable ? undefined : Number(await sh($, ['git', '-C', w.path, 'log', '-1', '--format=%ct'])) * 1000 || undefined
    worktrees.push({ path: w.path, branch: w.branch, owner: ownerOf(w.path, sessions), dirty: files.length, files: files.slice(0, 20), lastCommitAt, isMain: i === 0, isPrunable: w.isPrunable })
  }
  // The commit graph since the run started, newest first, in lanes, with each commit's lot and the release rings (tree.ts).
  const tree = await gitTreeOf(async args => { const r = await $.process.run(['git', '-C', top, ...args]).catch(() => undefined); return { code: r?.exitCode ?? 1, out: r?.stdout ?? '' } },
    { since: run?.start, base: run?.integration || base, branches: branches.map(b => b.name), pluginJson: 'overseer/.claude-plugin/plugin.json' })
  return { top, base, branches, worktrees, graph: tree.rows, graphCut: tree.cut }
}

const gitRun = ($: EngineInterface): Git => async (cwd, args) => { const r = await $.process.run(['git', '-C', cwd, ...args]).catch(() => undefined); return { code: r?.exitCode ?? 1, out: r?.stdout ?? '' } }
// Each started lot's git evidence (proofs.ts), at pass time: git through $.process.run with an argv array, no shell.
// A running lot's worktree is its session's.
async function proofsOf($: EngineInterface, top: string, integration: string, lots: Lot[]): Promise<Map<number, LotGit>> {
  const git = gitRun($)
  const out = new Map<number, LotGit>()
  const integrationTip = (await git(top, ['rev-parse', `${integration}^{commit}`])).out.trim()
  if (proofCache.size > 500) proofCache.clear()
  for (const l of lots.filter(l => l.status !== 'todo' || l.branch)) {
    const wt = l.session ? lastBranches?.worktrees?.find(w => w.owner === l.session && !w.isMain) : undefined
    const g = await lotGit(git, top, integration, { n: l.n, status: l.status, branch: l.branch, base: l.base, worktree: wt && { path: wt.path, branch: wt.branch } }, { cache: proofCache, integrationTip })
    if (Object.keys(g).length) out.set(l.n, g)
  }
  return out
}

const branchLines = (x: { base: string; branches: Branch[] }, label: (id?: string) => string) =>
  `BRANCHES ahead of ${x.base}, in merge order:\n` + x.branches.map(b => `- ${b.name}${b.owner ? ` (session ${label(b.owner)})` : ''}: +${b.ahead}, ${b.behind} behind, ${b.files.length} files${b.overlaps.length ? `, shares files with ${b.overlaps.join(', ')}` : ''}${b.merge ? (b.merge.conflicts.length ? `, CONFLICTS on ${b.merge.conflicts.join(', ')}` : ', merges clean') : ''}`).join('\n')

// A watched worker that ran /clear goes on under a new id (lot 56). The lead follows it there before anything reads an
// id: its own mod's note (cleared/<old>.json) first, else the registry entry of the same pid and process start. Its
// label, task, PLAN.md lines and records move with it; it is fresh (no transcript yet) until its next task message.
// The pid and process start of each watched session are kept while the registry still has its id.
async function followCleared($: EngineInterface): Promise<Oversight | undefined> {
  let o = await read($, oversight)
  if (!o?.watched.length) return o ?? undefined
  const home = (await $.env.get('HOME')) ?? ''
  const procs = new Map([...registry].map(([id, r]) => [id, { pid: r.pid, procStart: r.procStart }]))
  const known = o.watched.map(w => { const r = registry.get(w.sessionId); return r?.pid && r.procStart && (r.pid !== w.pid || r.procStart !== w.procStart) ? { ...w, pid: r.pid, procStart: r.procStart } : w })
  if (known.some((w, i) => w !== o!.watched[i])) { await update($, oversight, x => x && { ...x, watched: x.watched.map(w => known.find(k => k.sessionId === w.sessionId) ?? w) }); o = (await read($, oversight))! }
  const at = await $.clock.now()
  for (const w of o.watched) {
    const file = `${home}/.claude/overseer/cleared/${w.sessionId}.json`
    let cleared: Cleared | undefined
    try { cleared = JSON.parse(await $.fs.read(file)) } catch {}
    const to = newIdOf(w, cleared, procs)
    if (!to || o.watched.some(x => x.sessionId === to)) continue
    const from = w.sessionId, a = o.run?.assigned.find(x => x.sessionId === from)
    await update($, oversight, x => x && { ...renameOversight(x, from, to), fresh: { ...Object.fromEntries(Object.entries(x.fresh ?? {}).filter(([k]) => k !== from)), [to]: { at, from, cwd: a?.cwd ?? '' } }, clearing: Object.fromEntries(Object.entries(x.clearing ?? {}).filter(([k]) => k !== from)) })
    if (o.run) { const planPath = o.run.planPath; await withPlan(async () => { const md = await $.fs.read(planPath).catch(() => ''); const next = renamePlan(md, from, to); if (next !== md) await $.fs.write(planPath, next) }) }
    for (const m of [lastSent, shared] as Map<string, unknown>[]) if (m.has(from)) { m.set(to, m.get(from)); m.delete(from) }
    for (const s of [waiting, judging]) if (s.delete(from)) s.add(to)
    await sh($, ['rm', '-f', file])
    await note($, { sessionId: to, label: short(to, w.label), action: 'followed', text: `${short(to, w.label)} cleared its context: ${from.slice(0, 8)} → ${to.slice(0, 8)}${a ? `, task ${a.lot} stays with it` : ''}` })
    o = (await read($, oversight))!
  }
  return o
}

// A session has ended when its ~/.claude/sessions/<pid>.json is gone or its process is dead. An empty registry (nothing
// could be read) is no evidence: nothing is ended on it.
async function sessionEnded($: EngineInterface, sessionId: string): Promise<boolean> {
  if (!registry.size) return false
  if ((await read($, oversight))?.fresh?.[sessionId] && !registry.has(sessionId)) return false // followed after a /clear, not registered yet (lot 56)
  const r = registry.get(sessionId)
  if (!r) return true
  return r.pid !== undefined && (await $.process.run(['kill', '-0', String(r.pid)]).catch(() => ({ exitCode: 1 }))).exitCode !== 0
}

// The watch list outlives the overseer session (task 76): it is kept in ~/.claude/overseer/watched.json at each /oversee watch, drop
// and off, and read back once after a restart (session start, /oversee run, a pass) when this session holds none. A watched
// session that ended meanwhile is dropped with a log line.
let restoring: Promise<void> | undefined // one read per start: a command that comes while it runs waits for it
const watchedFile = async ($: EngineInterface) => `${(await $.env.get('HOME')) ?? ''}/.claude/overseer/watched.json`
async function saveWatched($: EngineInterface, watched: Watched[]) {
  const file = await watchedFile($)
  await sh($, ['mkdir', '-p', file.replace(/\/[^/]*$/, '')])
  await $.fs.write(file, JSON.stringify({ watched })).catch(() => undefined)
}
const restoreWatched = ($: EngineInterface) => (restoring ??= restoreOnce($))
async function restoreOnce($: EngineInterface) {
  if ((await read($, oversight))?.watched.length) return
  let saved: Watched[] = []
  try { saved = (JSON.parse(await $.fs.read(await watchedFile($))).watched as Watched[]).filter(w => w?.sessionId && w.file) } catch { return }
  if (!saved.length) return
  await refreshIdents($)
  const gone: Watched[] = []
  const kept: Watched[] = []
  for (const w of saved) (await sessionEnded($, w.sessionId) ? gone : kept).push(w)
  await update($, oversight, x => ({ passes: x?.passes ?? 0, log: x?.log ?? [], ...(x?.run ? { run: x.run } : {}), isOn: kept.length > 0, watched: kept }))
  for (const w of gone) await note($, { sessionId: w.sessionId, label: w.label, action: 'release', text: `${w.label} ended while the overseer was away: no longer watched` }, false)
  if (gone.length) await saveWatched($, kept)
}

// Who each session is: its name (~/.claude/sessions/<pid>.json, what SendMessage calls it) and its
// role (the "Sessions" line of the project's PLAN.md), refreshed each pass and before each listing.
let names = new Map<string, string>()
let registry = new Map<string, Registry>()
let roles: RoleEntry[] = []
async function refreshIdents($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const next = new Map<string, string>(), reg = new Map<string, Registry>()
  for (const f of (await sh($, ['find', `${home}/.claude/sessions`, '-maxdepth', '1', '-name', '*.json'])).split('\n').filter(Boolean)) {
    try { const d = JSON.parse(await $.fs.read(f)); if (d.sessionId && d.name) next.set(d.sessionId, d.name); if (d.sessionId) reg.set(d.sessionId, { pid: d.pid, procStart: d.procStart, status: d.status, waitingFor: d.waitingFor, name: d.name, socket: d.messagingSocketPath, bridge: d.bridgeSessionId }) } catch {}
  }
  names = next
  registry = reg
  const o = await read($, oversight)
  const cwd = await $.session.cwd().catch(() => '')
  const top = o?.run?.top ?? (cwd ? await sh($, ['git', '-C', cwd, 'rev-parse', '--show-toplevel']) : '')
  const planPath = o?.run?.planPath ?? (top ? `${top}/${cfg.planFile}` : '')
  roles = planPath ? parseRoles(await $.fs.read(planPath).catch(() => '')) : []
}
// "worker-8f · assets 3D et canyon (0000aa8f)"; `short` leaves the id out where it is shown beside it.
const who = (id: string, fallback: string) => identity(id, names, roles, fallback)
const short = (id: string, fallback: string) => who(id, fallback).text.replace(/ \([0-9a-f]{8}\)$/, '')

const readPeer = async ($: EngineInterface, file: string) => { const p = peerOf((await sh($, ['tail', '-n', '120', file])).split('\n')); return p && waitsOn(p, registry.get(p.sessionId)) }

// Sessions active in the last hour, this one included (the overseer can drive its own session too):
// what /oversee lists for the person to pick from.
async function activeSessions($: EngineInterface): Promise<(Peer & { file: string; isSelf: boolean })[]> {
  const home = (await $.env.get('HOME')) ?? ''
  const self = await $.session.id()
  const files = (await sh($, ['find', `${home}/.claude/projects`, '-maxdepth', '2', '-name', '*.jsonl', '-mmin', '-60'])).split('\n').filter(Boolean)
  const out: (Peer & { file: string; isSelf: boolean })[] = []
  for (const file of files) {
    const p = await readPeer($, file)
    if (p) out.push({ ...p, file, isSelf: p.sessionId === self })
  }
  return out.sort((a, b) => b.lastAt - a.lastAt)
}

// What the lead keeps in mind: the plan, the project's own guide, the latest history.
async function projectContext($: EngineInterface, top: string, plan: string, n?: number) {
  const guide = (await $.fs.read(`${top}/CLAUDE.md`).catch(() => '')) || (await $.fs.read(`${top}/README.md`).catch(() => ''))
  const history = await sh($, ['git', '-C', top, 'log', '--oneline', '-15'])
  return `${n === undefined ? `PLAN.md:\n${plan.slice(0, 12000)}` : `PLAN.md (the parts that bear on this lot):\n${judgeContext(plan, n)}`}\n\nPROJECT GUIDE (excerpt):\n${guide.slice(0, 3000)}\n\nRECENT COMMITS:\n${history}`
}

// ---------------------------------------------------------------- the plan, through the watched sessions

const shared = new Map<string, string>() // sessionId → why it gets no lot (it shares a working tree)

// The working tree a session's folder belongs to, or '' when it is not in one (then nothing to compare).
const treeOf = async ($: EngineInterface, cwd?: string) => (cwd ? sh($, ['git', '-C', cwd, 'rev-parse', '--show-toplevel']) : '')

// A lot's `check:` command, run on its branch in a throwaway worktree (the main checkout is never
// switched), or on the repository's current state when the session named no branch.
async function runCheck($: EngineInterface, top: string, lot: Lot, branch: string): Promise<{ cmd: string; ok: boolean; out: string }> {
  const dir = `${(await $.env.get('HOME')) ?? ''}/.claude/overseer/check-lot-${lot.n}`
  await $.process.run(['git', '-C', top, 'worktree', 'remove', '--force', dir]).catch(() => undefined)
  const made = branch ? (await $.process.run(['git', '-C', top, 'worktree', 'add', '--detach', dir, branch]).catch(() => ({ exitCode: 1, stdout: '', stderr: 'worktree add failed' }))) : undefined
  // A named branch that cannot be checked out is a failed check: never test the main checkout in its place.
  if (made && made.exitCode !== 0) return { cmd: lot.check!, ok: false, out: `could not check out branch ${branch}: ${made.stderr || made.stdout}`.trim() }
  const cwd = made ? dir : top
  const r = await $.process.run(['sh', '-c', lot.check!], { cwd, timeoutMs: 10 * 60e3 }).catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }))
  if (made?.exitCode === 0) await $.process.run(['git', '-C', top, 'worktree', 'remove', '--force', dir]).catch(() => undefined)
  return { cmd: lot.check!, ok: r.exitCode === 0, out: `${branch ? '' : '(no branch named: ran on the current checkout)\n'}${r.stdout}\n${r.stderr}`.trim() }
}

async function runPlan($: EngineInterface, o: Oversight, peers: Map<string, Peer>) {
  const run = o.run!
  const selfId = await $.session.id()
  const md = await $.fs.read(run.planPath).catch(() => '')
  if (!md) {
    const errorAt = await $.clock.now()
    await update($, oversight, x => x && { ...x, error: `no ${cfg.planFile} at ${run.top}`, errorAt, errorSource: 'plan' as const })
    return void (await note($, { sessionId: '', label: 'overseer', action: 'error', text: `no ${cfg.planFile} at ${run.top}` }))
  }
  let plan = md
  const { goal, lots } = parsePlan(md)
  const now = await $.clock.now()

  // Budget: the weekly limit is the account's, so it counts every session at once.
  const w = await weekly($)
  const rb = w === null ? undefined : rebase(run, w) // a weekly reset must not make the spent negative (task 71)
  const spent = spentOf(rb ?? run)
  const level = levelOf(spent, run.budget)
  const text = level === 'normal'
    ? `Budget ${run.level === 'normal' ? 'normal' : 'back to normal'} (${spent.toFixed(1)} of ${run.budget} weekly-limit points)${run.level === 'normal' ? '' : ': tasks resume'}.`
    : level === 'reduce'
      ? `Budget at half (${spent.toFixed(1)} of ${run.budget} weekly-limit points): step down to sonnet or haiku wherever they do the job, no new fan-outs, and an explicit model on every workflow agent (none means Opus).`
      : `Budget spent (${spent.toFixed(1)} of ${run.budget} points): commit what you have, write your report and stop. No new task will come.`
  if (level !== run.level) {
    // Saved at once: a pass that fails further down must not log (or send) the same change again.
    await update($, oversight, x => x && x.run ? { ...x, run: { ...x.run, level } } : x)
    await note($, { sessionId: '', label: 'budget', action: 'budget', text }, level === 'stop')
  }
  // A budget message wakes a session, which re-reads its whole context. So a session hears it at most
  // once an hour and only while its prompt cache is warm; a quiet one hears it just before that cache
  // expires, which keeps the cache and reports the credits. Spent is told at once.
  for (const wd of o.watched) {
    const p = peers.get(wd.sessionId)
    const idle = p ? now - p.lastAt : Infinity
    if (idle >= CACHE_TTL_MS) continue // cold cache: waking it would write the whole context again
    // A session with no lot that has finished its turn spends nothing: the budget is no news to it, and a warm cache
    // is not worth a turn each hour. It hears the budget again with its next lot.
    if (p && !run.assigned.some(a => a.sessionId === wd.sessionId) && isIdle(p, now, registry.get(wd.sessionId))) continue
    const t = (await read($, oversight))?.budgetTold?.[wd.sessionId]
    const hourly = !t || now - t.at >= 60 * 60e3
    const changed = (t?.level ?? 'normal') !== level
    // Before expiry, once per quiet spell: the session's reply restarts its TTL, so this comes about hourly.
    const expiring = idle >= CACHE_TTL_MS - 10 * 60e3 && (!t || t.at < p!.lastAt)
    if (!((changed && (level === 'stop' || hourly)) || expiring)) continue
    const msg = changed ? text : `${text} Nothing to do, no reply needed: this keeps your cache warm.`
    if (await send($, wd.sessionId, msg)) await update($, oversight, x => x && { ...x, budgetTold: { ...x.budgetTold, [wd.sessionId]: { level, at: now } } })
  }

  // A lot is judged on its session's own word ([lot N done on <branch>] / [lot N blocked: why]),
  // never on silence: a long test, a background workflow or a pause is still work.
  const assigned: Assignment[] = []
  for (const a of run.assigned) {
    const p = peers.get(a.sessionId)
    const lot = lots.find(x => x.n === a.lot)
    // Its session ended, watched or not: the assignment ends and the lot is free for another session (PLAN.md is the truth:
    // only a lot it still names as running is freed).
    if (lot && await sessionEnded($, a.sessionId)) {
      if (lot.status === 'running' && (!lot.session || lot.session === a.sessionId)) plan = setLot(plan, lot.n, { status: 'todo', session: '', note: 'its session ended: free again' })
      await note($, { sessionId: a.sessionId, label: `task ${lot.n}`, action: 'release', text: `${short(a.sessionId, o.watched.find(wd => wd.sessionId === a.sessionId)?.label ?? a.sessionId.slice(0, 8))} ended: task ${lot.n} is free again` })
      continue
    }
    if (lot?.status === 'done') continue // marked done (from the board, or by hand): the session is free
    if (!lot || !o.watched.some(wd => wd.sessionId === a.sessionId)) continue // dropped: the lot stays as the plan says
    // PLAN.md is the truth, run.assigned its cache: a lot that PLAN.md gives to another session is not this assignment's.
    // A stale duplicate is dropped; the lot stays open, and this session's report is never read against it.
    if (lot.status === 'running' && lot.session && lot.session !== a.sessionId) continue
    // [change N done]: the change requests it was sent before that line are made.
    const cd = p?.changeDone
    const open = cd && cd.lot === a.lot ? openChanges(parsePlan(plan).lots.find(x => x.n === a.lot) ?? {}).filter(c => c.at <= cd.at) : []
    if (open.length) plan = setLot(plan, a.lot, { changes: (parsePlan(plan).lots.find(x => x.n === a.lot)!.changes ?? []).map(c => (open.some(x => x.id === c.id) ? { ...c, state: 'done' as const } : c)) })
    // Followed after a /clear with its task open (lot 56): it no longer knows the task. The task goes to it again, with the
    // rules, as a first message; not a try.
    if (o.fresh?.[a.sessionId]) {
      if (await send($, a.sessionId, lotMessage(goal, lot, true))) {
        await update($, oversight, x => x && { ...x, fresh: Object.fromEntries(Object.entries(x.fresh ?? {}).filter(([k]) => k !== a.sessionId)) })
        await note($, { sessionId: a.sessionId, label: `task ${lot.n}`, action: 'assign', text: `task ${lot.n}. ${lot.title} (sent again after its session cleared its context)` })
      }
      assigned.push(a)
      continue
    }
    const m = p?.marker
    // The session reported another lot since it was given this one: it gave this one away. The assignment ends, the session is free.
    if (m && m.lot !== a.lot && m.at > a.assignedAt) {
      await note($, { sessionId: a.sessionId, label: `task ${lot.n}`, action: 'release', text: `${short(a.sessionId, o.watched.find(wd => wd.sessionId === a.sessionId)?.label ?? a.sessionId.slice(0, 8))} reported task ${m.lot}: task ${lot.n} is no longer its own` })
      continue
    }
    if (!m || m.lot !== a.lot || m.at <= a.assignedAt) { assigned.push(a); continue }
    const label = `task ${lot.n}`
    if (a.noVerdict?.at === m.at && a.noVerdict.n >= 2) { assigned.push(a); continue } // the need "judge gave no verdict": not judged again until a new report
    if (m.status === 'departs') { assigned.push(a); continue } // it leaves the plan's direction: not judged, it waits for the person
    if (m.status === 'blocked') {
      plan = setLot(plan, lot.n, { status: 'blocked', note: m.why ?? 'the session says it is blocked' })
      await note($, { sessionId: a.sessionId, label, action: 'blocked', text: m.why ?? 'blocked, by its own word' })
      continue
    }
    // The commits, read in the project's repository (a session's own folder may be anywhere).
    const branch = m.branch ?? ''
    const commits = branch
      ? await sh($, ['git', '-C', run.top, 'log', '--oneline', `${a.base}..${branch}`])
      : await sh($, ['git', '-C', run.top, 'log', '--all', '--source', '--oneline', `--since=@${Math.floor(a.assignedAt / 1000)}`])
    judging.add(a.sessionId)
    await writeBoard($)
    const check = lot.check ? await runCheck($, run.top, lot, branch) : undefined
    const criteria = lot.brief?.type ? lot.brief.criteria.length : 0
    const res = await $.model.complete({ model: cfg.leadModel, system: LEAD_SYSTEM, prompt: leadPrompt(await projectContext($, run.top, plan, lot.n), lot, p!.lastText, commits, check), maxTokens: judgeTokens(criteria), timeoutMs: 120000 })
    judging.delete(a.sessionId)
    let v = res.isAnswered ? parseVerdict(res.text, criteria) : undefined
    if (!v) { // judged on the next pass; after 2 misses on one report, the person judges it
      const n = (a.noVerdict?.at === m.at ? a.noVerdict.n : 0) + 1
      await note($, { sessionId: a.sessionId, label, action: 'error', text: `${res.isAnswered ? 'the judge gave no verdict' : `the judge did not answer (${res.reason})`}${n >= 2 ? ': not judged again until its session reports again' : ''}` })
      assigned.push({ ...a, noVerdict: { at: m.at, n } })
      continue
    }
    const checked = check ? { checkResult: checkRun(check.ok, await $.clock.now(), check.out) } : {}
    const marked = { marks: v.marks ?? null, gaps: v.gaps?.length ? v.gaps : null } // a verdict with no marks clears the older ones
    if (v.verdict === 'done' && check && !check.ok) v = { verdict: 'retry', note: `check \`${lot.check}\` fails`, instructions: `Make \`${lot.check}\` pass on your branch. Its output ends with:\n${check.out.slice(-800)}` }
    if (v.verdict === 'retry' && a.tries + 1 < MAX_TRIES && level !== 'stop' && (await send($, a.sessionId, `Task ${lot.n} is not done yet: ${v.note}\n${v.instructions}\nEnd again with [task ${lot.n} done on <branch>] when it is.`))) {
      assigned.push({ ...a, assignedAt: Math.max(now, m.at), tries: a.tries + 1 }) // the marker just judged never counts twice
      plan = setLot(plan, lot.n, { note: `retry: ${v.note}`, verdict: { verdict: v.verdict, note: v.note }, verdictAt: await $.clock.now(), retry: { verdict: v.verdict, note: v.note }, ...checked, ...marked })
      await note($, { sessionId: a.sessionId, label, action: 'retry', text: v.note })
      continue
    }
    const status = v.verdict === 'done' ? 'done' as const : 'blocked' as const
    const mine = parsePlan(plan).lots.find(x => x.n === lot.n)?.changes ?? []
    plan = setLot(plan, lot.n, { status, note: `${v.note}${check ? ` · check ${check.ok ? 'passed' : 'failed'}` : ''}`, ...(branch ? { branch } : {}), verdict: { verdict: v.verdict, note: v.note }, verdictAt: await $.clock.now(), ...(status === 'done' && openChanges({ changes: mine }).length ? { changes: mine.map(c => (c.state === 'sent' ? { ...c, state: 'done' as const } : c)) } : {}), ...(status === 'done' && reviewOf(p!.lastText) ? { review: reviewOf(p!.lastText) } : {}), ...checked, ...marked }) // a verdict of done closes the change requests
    await note($, { sessionId: a.sessionId, label, action: status, text: `${v.note}${branch ? ` · branch ${branch}` : ''}` })
  }

  // A lot marked running that no watched session holds (its session was dropped, or the run restarted)
  // is not handed out again on its own: its former session may still be at it, and two sessions on
  // one lot collide. It is marked blocked, visibly, for the person to check and set back to [ ].
  for (const l of parsePlan(plan).lots) {
    if (l.status !== 'running' || assigned.some(a => a.lot === l.n)) continue
    const why = `its session${l.session ? ` (${l.session.slice(0, 8)})` : ''} is no longer watched: check it stopped, then set this task back to [ ] to hand it out again`
    plan = setLot(plan, l.n, { status: 'blocked', note: why })
    await note($, { sessionId: l.session ?? '', label: `task ${l.n}`, action: 'blocked', text: why })
  }

  // A session blocked on a task that is still [!] (lot 59): a newer blocked report for the same task replaces its note, so
  // the need says the latest blocker; the session gets no new task until the block closes.
  for (const wd of o.watched) {
    const m = blockedOn(peers.get(wd.sessionId), parsePlan(plan).lots)
    const l = m && parsePlan(plan).lots.find(x => x.n === m.lot)
    if (!m || !l || !m.why || l.note === m.why || (l.session && l.session !== wd.sessionId)) continue
    plan = setLot(plan, l.n, { note: m.why })
    await note($, { sessionId: wd.sessionId, label: `task ${l.n}`, action: 'blocked', text: `new blocker: ${m.why}` })
  }

  // Free watched sessions get the next lots: their own lots only when a lot names an owner, and
  // never two sessions in one working tree (their branch switches and commits would collide).
  if (level !== 'stop' && !(await read($, oversight))?.run?.paused) { // paused: running lots go on (judged above), nothing new goes out
    const ready = readyLots(parsePlan(plan).lots)
    // Read PLAN.md again before handing anything out: another writer may have taken a lot since this pass began. A lot
    // is never given when it is no longer `[ ]` on disk, when another session holds it (`session:`), or when the
    // worktree of its branch has another session in it.
    const disk = parsePlan(await $.fs.read(run.planPath).catch(() => md)).lots
    const heldElsewhere = (l: Lot, sid: string) => {
      const d = disk.find(x => x.n === l.n), start = lots.find(x => x.n === l.n)
      const moved = !!d && !!start && (d.status !== start.status || d.session !== start.session) // another writer, since this pass began
      if (moved && d!.status !== 'todo') return true
      const holder = (moved ? d!.session : undefined) || l.session
      if (holder && holder !== sid) return true
      const wt = l.branch ? lastBranches?.worktrees?.find(w => w.branch === l.branch) : undefined
      return !!wt?.owner && wt.owner !== sid
    }
    const trees = new Map<string, string>() // working tree → the session holding a lot in it
    for (const a of assigned) { const t = await treeOf($, peers.get(a.sessionId)?.cwd); if (t) trees.set(t, a.sessionId) }
    // The session free the longest goes first (its last word is the oldest), so three free sessions and three tasks give one each, the first to the longest-idle.
    const byIdle = [...o.watched].sort((a, b) => (peers.get(a.sessionId)?.lastAt ?? now) - (peers.get(b.sessionId)?.lastAt ?? now))
    for (const wd of byIdle) {
      const p = peers.get(wd.sessionId)
      const fresh = o.fresh?.[wd.sessionId] // followed after a /clear, no transcript yet: free (lot 56)
      if ((!p && !fresh) || assigned.some(a => a.sessionId === wd.sessionId) || (p && !isIdle(p, now, registry.get(wd.sessionId))) || (p && blockedOn(p, parsePlan(plan).lots)) || await sessionEnded($, wd.sessionId)) continue // an ended or blocked session is given nothing
      const cwd = p?.cwd ?? fresh!.cwd
      const tree = await treeOf($, cwd)
      if (tree && trees.has(tree)) { shared.set(wd.sessionId, `shares ${tree.split('/').pop()} with ${o.watched.find(x => x.sessionId === trees.get(tree))?.label ?? 'another session'}: open it in its own worktree (claude -w)`); continue }
      shared.delete(wd.sessionId)
      // An owner that is a session id no longer watched (a reopened lot's last session) frees the lot for any free session.
      const ownerGone = (l: Lot) => !!l.owner && /^[0-9a-f-]{8,36}$/.test(l.owner) && !o.watched.some(x => x.sessionId.startsWith(l.owner!))
      const i = ready.findIndex(l => (ownerGone(l) || ownedBy(l, { ...wd, ...who(wd.sessionId, wd.label) })) && !heldElsewhere(l, wd.sessionId))
      if (i < 0) continue
      const hadTask = run.assigned.some(a => a.sessionId === wd.sessionId) || o.log.some(x => x.sessionId === wd.sessionId && x.action === 'assign')
      // An empty context for each task (lot 56): a worker that had a task is asked to clear itself first, and gets the next
      // task under its new id at a later pass. CAUTION: never the overseer's own session. A worker with an older mod does not
      // clear: after one pass the task goes anyway.
      const next = ready[i]!
      const canClear = !!(await $.fs.read(`${(await $.env.get('HOME')) ?? ''}/.claude/overseer/workers/${wd.sessionId}.json`).catch(() => '')) // its mod says it can clear itself
      if (hadTask && !fresh && canClear && wd.sessionId !== selfId && next.owner !== wd.sessionId) { // a reopened task goes back to the context that made it
        const asked = o.clearing?.[wd.sessionId]
        if (!asked) {
          const r = await $.session.send({ to: { sessionId: wd.sessionId }, text: '[overseer-clear] Your next task comes in a fresh context: clear this one.' }).catch(() => ({ isDelivered: false }))
          if (r.isDelivered) {
            await update($, oversight, x => x && { ...x, clearing: { ...x.clearing, [wd.sessionId]: now } })
            await note($, { sessionId: wd.sessionId, label: short(wd.sessionId, wd.label), action: 'nudge', text: 'asked to clear its context before its next task' })
            continue
          }
        } else await note($, { sessionId: wd.sessionId, label: short(wd.sessionId, wd.label), action: 'nudge', text: 'did not clear its context: its next task goes anyway' })
        await update($, oversight, x => x && { ...x, clearing: Object.fromEntries(Object.entries(x.clearing ?? {}).filter(([k]) => k !== wd.sessionId)) })
      }
      const lot = ready.splice(i, 1)[0]!
      const first = !hadTask || !!fresh
      // The earlier work of a lot that was sent back (a change request, a blocked lot set to [ ]) goes on in its branch until it is merged.
      const unmerged = lot.branch && (await $.process.run(['git', '-C', run.top, 'merge-base', '--is-ancestor', lot.branch, run.integration || 'HEAD']).catch(() => ({ exitCode: 0 }))).exitCode !== 0 ? lot.branch : undefined
      if (!(await send($, wd.sessionId, lotMessage(goal, { ...lot, model: lot.model || level === 'reduce' ? tierFor(lot.model, level) : undefined }, first, unmerged)))) continue
      const base = await sh($, ['git', '-C', run.top, 'rev-parse', run.integration ? `${run.integration}^{commit}` : 'HEAD'])
      assigned.push({ lot: lot.n, sessionId: wd.sessionId, cwd, base, assignedAt: now, tries: 0 })
      if (fresh) await update($, oversight, x => x && { ...x, fresh: Object.fromEntries(Object.entries(x.fresh ?? {}).filter(([k]) => k !== wd.sessionId)) })
      if (tree) trees.set(tree, wd.sessionId)
      lastSent.set(wd.sessionId, now)
      plan = setLot(plan, lot.n, { status: 'running', session: wd.sessionId, ...(base ? { base } : {}) }) // the fork point, for a lot merged fast-forward
      await note($, { sessionId: wd.sessionId, label: short(wd.sessionId, wd.label), action: 'assign', text: `task ${lot.n}. ${lot.title}` })
    }
  }

  if (plan !== md) await $.fs.write(run.planPath, plan)
  await update($, oversight, x => x && x.run ? { ...x, run: { ...x.run, assigned, level, ...(rb ?? {}), series: w === null ? x.run.series : [...(x.run.series ?? []), { at: now, spent }].slice(-240) } } : x)
}

// ---------------------------------------------------------------- helping the watched sessions

async function help($: EngineInterface, o: Oversight, peers: Map<string, Peer>) {
  const now = await $.clock.now()
  const due = [...peers.values()].filter(p => needsHelp(p, now, lastSent.get(p.sessionId)) && (p.question || !o.run))
  if (!due.length) return
  const label = (id?: string) => o.watched.find(w => w.sessionId === id)?.label ?? id?.slice(0, 8) ?? ''
  const context = (o.run ? `${await projectContext($, o.run.top, await $.fs.read(o.run.planPath).catch(() => ''))}\n\n` : '')
    + (lastBranches?.branches.length ? `${branchLines(lastBranches, label)}\n\n` : '')
  const res = await $.model.complete({ model: cfg.model, system: OVERSEER_SYSTEM, prompt: context + overseerPrompt(due), maxTokens: 1500, timeoutMs: 120000 })
  if (!res.isAnswered) {
    const errorAt = await $.clock.now()
    await update($, oversight, x => x && { ...x, error: `the model did not answer (${res.reason})`, errorAt, errorSource: 'model' as const })
    return void (await note($, { sessionId: '', label: 'overseer', action: 'error', text: `the model did not answer (${res.reason})` }))
  }
  for (const a of parseActions(res.text, due.map(p => p.sessionId))) {
    if (!(await send($, a.sessionId, a.message))) continue
    lastSent.set(a.sessionId, now)
    await note($, { sessionId: a.sessionId, label: short(a.sessionId, o.watched.find(w => w.sessionId === a.sessionId)?.label ?? a.sessionId.slice(0, 8)), action: a.action, text: a.message })
  }
}

// Work outside the plan is never refused: a session writes [new lot: <title> — <why>], the owner is
// asked (with what it would delay, to keep focus) and, on yes, the lot is added to PLAN.md.
// A session that waited and got the person's answer (the terminal's or the board's) leaves a line in DECISIONS.md at the
// repository top, and in the log. Its minute, question and answer are its key: one already in the file is never written
// twice, so a restart or a second watcher adds nothing. ponytail: answers older than 30 min are history, not news; no backfill.
async function recordDecisions($: EngineInterface, o: Oversight, peers: Map<string, Peer>, top: string | undefined) {
  if (!top) return
  const now = await $.clock.now()
  const path = `${top}/DECISIONS.md`
  let md: string | undefined
  for (const w of o.watched) {
    const a = peers.get(w.sessionId)?.answered
    if (!a || now - a.at > 30 * 60e3) continue
    const line = decisionLine(a.at, o.run?.assigned.find(x => x.sessionId === w.sessionId)?.lot, a.question, a.answer)
    md ??= await $.fs.read(path).catch(() => '')
    const next = withDecision(md, line)
    if (next === undefined) continue
    md = next
    await $.fs.write(path, md)
    await note($, { sessionId: w.sessionId, label: short(w.sessionId, w.label), action: 'decided', text: line.slice(2) })
  }
}
// DECISIONS.md with one more line, or undefined when it holds that line already.
function withDecision(md: string, line: string): string | undefined {
  const d = parseDecisions(line + '\n', 1)[0]!
  if (parseDecisions(md, Infinity).some(x => x.at === d.at && x.question === d.question && x.answer === d.answer)) return undefined // the lot may differ between passes: the answer is the key
  return `${md || '# Decisions\n\nWhat the person decided, and why. Newest last.\n\n'}${md && !md.endsWith('\n') ? '\n' : ''}${line}\n`
}

async function decide($: EngineInterface, top: string, lot: number, question: string, answer: string) {
  const line = decisionLine(await $.clock.now(), lot, question, answer)
  const md = withDecision(await $.fs.read(`${top}/DECISIONS.md`).catch(() => ''), line)
  if (md !== undefined) await $.fs.write(`${top}/DECISIONS.md`, md)
  await note($, { sessionId: '', label: `task ${lot}`, action: 'decided', text: line.slice(2) })
}

// The installed overseer's version, for a reinstall: the installed_plugins.json entry whose folder is this session's plugin
// root, else the newest of the overseer@* entries (there can be several: a marketplace copy and a synced one).
export function installedVersion(installed: string, root: string): string | undefined {
  let entries: { installPath?: string; version?: string }[] = []
  try { const p = JSON.parse(installed).plugins ?? {}; entries = Object.keys(p).filter(k => k.startsWith('overseer@')).flatMap(k => p[k] ?? []) } catch { return undefined }
  const mine = entries.find(e => e.installPath === root)?.version
  return mine ?? entries.map(e => e.version).filter((v): v is string => !!v).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
}

const asked = new Map<string, number>() // sessionId → the proposal already put to the owner
// PLAN.md is read, changed and written back by a pass (which can take minutes) and by an approved
// new lot (whenever the owner answers): one at a time, or the later write drops the other's change.
let planChain: Promise<unknown> = Promise.resolve()
function withPlan<T>(fn: () => Promise<T>): Promise<T> {
  const run = planChain.then(fn, fn)
  planChain = run.catch(() => undefined)
  return run
}

async function proposeLots($: EngineInterface, o: Oversight, peers: Map<string, Peer>) {
  if (!o.run) return
  for (const w of o.watched) {
    const pr = peers.get(w.sessionId)?.proposal
    if (!pr || asked.get(w.sessionId) === pr.at) continue
    asked.set(w.sessionId, pr.at)
    const md = await $.fs.read(o.run.planPath).catch(() => '')
    const { lots } = parsePlan(md)
    const open = lots.filter(l => l.status === 'todo' || l.status === 'running')
    const mine = o.run.assigned.find(a => a.sessionId === w.sessionId)
    const current = mine ? lots.find(l => l.n === mine.lot) : undefined
    const focus = [current ? `it delays task ${current.n} (${current.title}), which this session holds` : '', `${open.length} task${open.length === 1 ? '' : 's'} still open`].filter(Boolean).join('; ')
    // The dialog waits for the person, not the pass. If it fails, the proposal is forgotten in state
    // too, so it is put again (a reload would otherwise restore it as already asked).
    void askOpen($, o.run.planPath, w.sessionId, short(w.sessionId, w.label), pr.text, focus).catch(async () => {
      if (asked.get(w.sessionId) === pr.at) { asked.delete(w.sessionId); await memorize($).catch(() => undefined) }
      await note($, { sessionId: w.sessionId, label: short(w.sessionId, w.label), action: 'error', text: 'the new-task question failed' }).catch(() => undefined)
    })
  }
}
async function askOpen($: EngineInterface, planPath: string, sessionId: string, who: string, text: string, focus: string) {
  const [title, why = ''] = text.split(/\s+[—-]\s+/)
  // The proposal goes into PLAN.md as [?] at once (the board can approve it too); the dialog is a second way.
  const n = await withPlan(async () => {
    // An unreadable plan is never rewritten from scratch: that would drop every lot in it.
    const md = await $.fs.read(planPath).catch(() => undefined)
    if (md === undefined) return undefined
    const next = Math.max(0, ...parsePlan(md).lots.map(l => l.n)) + 1
    await $.fs.write(planPath, `${md.trimEnd()}\n\n## [?] ${next}. ${title}\ndone when: (to state)\nowner: ${sessionId.slice(0, 8)}\n${why}\n`)
    return next
  })
  if (n === undefined) {
    await note($, { sessionId, label: who, action: 'blocked', text: `new task not opened: PLAN.md could not be read (${title})` })
    return
  }
  const answer = await $.ui.ask(`👁 ${who} proposes a new task: “${text}”. Open it? To keep focus: ${focus}.`, { header: 'New task', options: ['Open the task', 'Not now'] })
  // Only a task still [?] is settled: the board may have approved it while the dialog was open.
  const proposed = (md: string) => parsePlan(md).lots.some(l => l.n === n && l.status === 'proposed')
  if (answer !== 'Open the task') {
    const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
    await withPlan(async () => {
      const md = await $.fs.read(planPath).catch(() => '')
      if (!proposed(md)) return
      await $.fs.write(planPath, fileUnderWaiting(md, n, `- **${title}.** ${why} (from ${who}, ${day})`))
    })
    await send($, sessionId, `Not now: stay on your task. Your proposal (${text}) is noted.`)
    await note($, { sessionId, label: who, action: 'answer', text: `new task declined: ${text}` })
    return
  }
  await withPlan(async () => {
    const md = await $.fs.read(planPath).catch(() => '')
    if (proposed(md)) await $.fs.write(planPath, setLot(md, n, { status: 'todo' }))
  })
  await send($, sessionId, `Task ${n} opened in PLAN.md: ${title}. Finish your current task first; it comes to you after.`)
  await note($, { sessionId, label: who, action: 'assign', text: `new task ${n} opened: ${title}` })
}

// A reload of the mod resets its module memory; what must survive lives in the oversight state and
// is read back here (who was written to and when, which proposals were already asked).
async function remember($: EngineInterface) {
  const o = await read($, oversight)
  for (const [id, at] of Object.entries(o?.sent ?? {})) if (!lastSent.has(id)) lastSent.set(id, at)
  for (const [id, at] of Object.entries(o?.asked ?? {})) if (!asked.has(id)) asked.set(id, at)
}
async function memorize($: EngineInterface) {
  await update($, oversight, x => x && { ...x, sent: Object.fromEntries(lastSent), asked: Object.fromEntries(asked) })
}
// Test hook: what a reload does to the module's memory.
export function forgetModuleMemory() { restoring = undefined; lastSent.clear(); asked.clear(); toasted.clear(); waiting.clear(); lastPeers = new Map(); names = new Map(); registry = new Map(); roles = [] }

async function pass($: EngineInterface) {
  await restoreWatched($).catch(() => undefined)
  let o = await read($, oversight)
  if (!o?.isOn || !o.watched.length) return
  const started = await $.clock.now()
  // ponytail: a pass older than 10 min is taken as stuck and overlapped, not cancelled (no handle to abort it)
  if (isPassing && started - passStartedAt < 10 * 60e3) return
  isPassing = true
  passStartedAt = started
  await remember($)
  try {
    const at = await $.clock.now()
    await update($, oversight, x => x && { ...x, passes: x.passes + 1, lastAt: at, error: undefined, errorAt: undefined, errorSource: undefined })
    await ensureServer($).catch(() => undefined)
    await writeBoard($).catch(() => undefined) // the page sees passing: true
    await refreshIdents($)
    o = (await followCleared($)) ?? o // before anything reads an id: a worker that ran /clear is not an ended one
    const peers = new Map<string, Peer>()
    for (const w of o.watched) { const p = await readPeer($, w.file); if (p) peers.set(p.sessionId, p) }
    const top = o.run?.top ?? (await sh($, ['git', '-C', [...peers.values()][0]?.cwd ?? '.', 'rev-parse', '--show-toplevel']))
    if (top) lastBranches = await branchesOf($, top, [...peers.values()], o.run)
    if (top && o.run?.integration) lastProofs = await proofsOf($, top, o.run.integration, parsePlan(await $.fs.read(o.run.planPath).catch(() => '')).lots).catch(() => lastProofs)
    // A session enters waits once: one note, not one per pass while it stays on its question. First,
    // so a later throw in this pass cannot skip it; a session no longer watched is forgotten.
    for (const id of waiting) if (!o.watched.some(w => w.sessionId === id)) waiting.delete(id)
    for (const w of o.watched) {
      if (!peers.get(w.sessionId)?.question) { waiting.delete(w.sessionId); continue }
      if (waiting.has(w.sessionId)) continue
      waiting.add(w.sessionId)
      await note($, { sessionId: w.sessionId, label: short(w.sessionId, w.label), action: 'waits', text: peers.get(w.sessionId)!.question!.slice(0, 140) })
    }
    await recordDecisions($, o, peers, top).catch(err => note($, { sessionId: '', label: 'overseer', action: 'error', text: `DECISIONS.md: ${String(err).slice(0, 120)}` }))
    if (o.run) await withPlan(() => runPlan($, o!, peers))
    await proposeLots($, o, peers)
    // A session with a question gets an answer; with a plan running, a quiet one is the plan's to handle.
    const now = await read($, oversight)
    if (now) await help($, now, peers)
    lastPeers = peers
  } catch (err) {
    const error = String(err).slice(0, 160)
    const errorAt = await $.clock.now()
    await update($, oversight, x => x && { ...x, error, errorAt, errorSource: 'pass' as const })
    await note($, { sessionId: '', label: 'overseer', action: 'error', text: error }).catch(() => undefined)
  } finally {
    isPassing = false
    judging.clear()
    await memorize($).catch(() => undefined)
    await writeBoard($).catch(() => undefined)
    await promptNeeds($).catch(() => undefined)
    if (passQueued) { passQueued = false; $.clock.after(0, () => void passNow($)) } // a /pass that came during this pass
  }
}
// /pass: one pass now, and the clock starts over from it (the next one is everyMs after this one, not after the old timer).
async function passNow($: EngineInterface) {
  if (isPassing) { passQueued = true; return }
  passTimer?.cancel()
  passTimer = $.clock.every(cfg.everyMs, () => void pass($))
  await pass($)
}

// The workflows of the watched sessions (and this one), read from disk (steps.ts): a run that ended from its wf_*.json, a run that
// is going from its journal. A session with a lot is read back to its assignment, however old; the others for 3 h. A run is active
// while an agent has not returned or its journal moved in the last 2 min. The name comes from the run's saved script (<name>-<runId>.js).
const runNames = new Map<string, string>()
const agentCache = new Map<string, { info: AgentInfo; alias?: string; final: boolean }>()
// One agent's model, effort, Goal/How/Out and times. Its first lines never change, so they are read until the model shows; the
// last record time moves while it runs, and stays once its result is in.
async function agentOf($: EngineInterface, dir: string, id: string, finished: boolean): Promise<AgentInfo> {
  let c = agentCache.get(id)
  if (c?.final) return { ...c.info, model: c.info.model ?? c.alias }
  if (!c || !c.info.model) {
    const head = (await $.process.run(['head', '-c', '300000', `${dir}/agent-${id}.jsonl`]).catch(() => undefined))?.stdout ?? ''
    let alias: string | undefined
    try { alias = JSON.parse(await $.fs.read(`${dir}/agent-${id}.meta.json`)).model } catch {}
    c = { info: readAgent(head), alias, final: false }
    agentCache.set(id, c)
  }
  const end = readAgent('', (await $.process.run(['tail', '-n', '3', `${dir}/agent-${id}.jsonl`]).catch(() => undefined))?.stdout ?? '').endedAt
  if (end) c.info.endedAt = end
  c.final = finished && !!end && !!c.info.model
  return { ...c.info, model: c.info.model ?? c.alias }
}
async function workflowsOf($: EngineInterface, targets: { sid: string; from?: number }[], now: number): Promise<WorkflowRun[]> {
  const home = (await $.env.get('HOME')) ?? ''
  const out: WorkflowRun[] = []
  for (const { sid, from } of targets) {
    const mins = windowMins(from, now)
    const list = async (args: string[]) => (await sh($, ['find', `${home}/.claude/projects`, ...args, '-mmin', `-${mins}`])).split('\n').filter(Boolean)
    const dirs = await list(['-mindepth', '5', '-maxdepth', '5', '-type', 'd', '-path', `*/${sid}/subagents/workflows/wf_*`])
    const files = await list(['-mindepth', '4', '-maxdepth', '4', '-type', 'f', '-path', `*/${sid}/workflows/wf_*.json`])
    const ids = new Set([...dirs.map(d => d.split('/').pop()!), ...files.map(f => f.split('/').pop()!.replace(/\.json$/, ''))])
    for (const runId of ids) {
      const dir = dirs.find(d => d.endsWith(`/${runId}`))
      const file = files.find(f => f.endsWith(`/${runId}.json`))
      const ended = file ? doneRun(await $.fs.read(file).catch(() => '')) : undefined
      const journal = dir ? await $.fs.read(`${dir}/journal.jsonl`).catch(() => '') : ''
      const j = readJournal(journal)
      if (!j.started && !ended) continue
      const steps = stepsOf(journal)
      for (const st of steps) Object.assign(st, await agentOf($, dir!, st.id, st.state === 'done'))
      if (!runNames.has(runId)) {
        const script = (await sh($, ['find', `${home}/.claude/projects`, '-maxdepth', '5', '-name', `*-${runId}.js`])).split('\n')[0] ?? ''
        runNames.set(runId, script.split('/').pop()?.replace(`-${runId}.js`, '') || runId)
      }
      const recent = dir ? !!(await sh($, ['find', `${dir}/journal.jsonl`, '-mmin', '-2'])) : false
      const isActive = !ended && (j.running.length > 0 || recent)
      const starts = steps.map(x => x.startedAt).filter((x): x is number => !!x)
      const ends = steps.map(x => x.endedAt).filter((x): x is number => !!x)
      const startedAt = ended?.startedAt ?? (starts.length ? Math.min(...starts) : undefined)
      const run: WorkflowRun = {
        runId, name: runNames.get(runId)!, session: sid, ...j, isActive,
        ...(startedAt ? { startedAt } : {}),
        ...(ended?.durationMs && startedAt ? { endedAt: startedAt + ended.durationMs, durationMs: ended.durationMs } : !isActive && ends.length ? { endedAt: Math.max(...ends) } : {}),
        ...(ended?.model ? { model: ended.model } : {}),
        state: ended?.state ?? (isActive ? 'running' : 'done'),
        ...(ended?.preview ? { preview: ended.preview } : {}),
        ...(steps.length ? { steps } : {}),
      }
      if (from === undefined || startedAt === undefined || ownsRun(from, run)) out.push(run)
    }
  }
  return out.sort((a, b) => Number(b.isActive) - Number(a.isActive) || (b.startedAt ?? 0) - (a.startedAt ?? 0))
}
// The sessions to read workflows for: each watched one back to its lot's assignment, and this one.
const wfTargets = (o: Oversight, self: string) => [...o.watched.map(w => ({ sid: w.sessionId, from: o.run?.assigned.find(a => a.sessionId === w.sessionId)?.assignedAt })), ...(o.watched.some(w => w.sessionId === self) ? [] : [{ sid: self }])]
// A session whose plan waits on the workflow gate (steps.ts gatePlan): the gate's active file says `pending`.
async function gateOf($: EngineInterface, sid: string): Promise<GatePlan | undefined> {
  return gatePlan(await $.fs.read(`${(await $.env.get('HOME')) ?? ''}/.claude/workflow-gate/active/${sid.replace(/[^a-z0-9_-]/gi, '_')}.json`).catch(() => undefined))
}
const stageFor = (o: Oversight, sid: string, now: number, gate?: GatePlan, check?: CheckStuck, lots?: Pick<Lot, 'n' | 'status'>[]): Stage => {
  const s = stageOf(lastPeers.get(sid), o.run?.assigned.find(x => x.sessionId === sid), judging.has(sid), now, lots)
  if (check && s === 'work') return 'stuck' // its check has run long (check-watch.sh): the session is at work, but stuck on that
  return gate && s !== 'waits' ? 'gate' : s
}
// The checks that have run long in a session's folder (check-watch.sh writes one file each, and removes it when the check ends).
async function checksStuck($: EngineInterface): Promise<CheckStuck[]> {
  const dir = `${(await $.env.get('HOME')) ?? ''}/${CHECK_STUCK_DIR}`
  const out: CheckStuck[] = []
  for (const f of (await sh($, ['find', dir, '-name', '*.txt', '-mmin', `-${CHECK_STUCK_MIN}`])).split('\n').filter(Boolean)) {
    const c = parseStuck(await $.fs.read(f).catch(() => ''))
    if (c) out.push(c)
  }
  return out
}

// Tokens per lot (tokens.ts): its session's transcript and its subagents (not those of workflows: their run's totalTokens
// counts instead, once the run has ended), read from the byte where the last read stopped. $.fs.read has no offset and caps
// at 4 MiB, so the new bytes come through tail. A lot with no assignment left has had its verdict: one last read, then frozen.
async function countTokens($: EngineInterface, o: Oversight, now: number): Promise<Record<number, LotTokens>> {
  const all = { ...o.tokens }
  const live = new Set(o.run?.assigned.map(a => a.lot))
  for (const a of o.run?.assigned ?? []) if (!all[a.lot] || (all[a.lot]!.to !== undefined && a.assignedAt > all[a.lot]!.to!)) all[a.lot] = { session: a.sessionId, from: a.assignedAt, files: {}, wf: {} }
  for (const [k, t] of Object.entries(all)) {
    const lot = Number(k)
    const sid = o.run?.assigned.find(a => a.lot === lot)?.sessionId ?? t.session
    const base = o.watched.find(w => w.sessionId === sid)?.file.replace(/\.jsonl$/, '')
    if (t.to !== undefined || !base) continue
    const win = { from: t.from, to: live.has(lot) ? undefined : now }
    const mins = Math.ceil((now - t.from) / 60e3) + 1
    const subs = (await sh($, ['find', `${base}/subagents`, '-name', 'agent-*.jsonl', '-not', '-path', `${base}/subagents/workflows/*`, '-mmin', `-${mins}`])).split('\n').filter(Boolean)
    for (const f of [`${base}.jsonl`, ...subs]) {
      const size = Number((await sh($, ['wc', '-c', f])).trim().split(/\s+/)[0])
      const prev = t.files[f]
      if (!(size > (prev?.off ?? 0))) continue
      const start = prev ? prev.off : Math.max(0, size - READ_CAP)
      const r = await $.process.run(['tail', '-c', `+${start + 1}`, f]).catch(() => undefined) // not sh: it trims the last newline
      if (r?.exitCode === 0) t.files[f] = advance(prev, r.stdout, start, win)
    }
    for (const f of (await sh($, ['find', `${base}/workflows`, '-name', 'wf_*.json'])).split('\n').filter(Boolean)) {
      const id = f.split('/').pop()!
      if (id in t.wf) continue
      const json = await $.fs.read(f).catch(() => undefined)
      if (json !== undefined) t.wf[id] = wfTokens(json, win)
    }
    if (!live.has(lot)) t.to = now
  }
  if (JSON.stringify(all) !== JSON.stringify(o.tokens ?? {})) await update($, oversight, x => x && { ...x, tokens: all })
  return all
}

// Collisions (collisions.ts): the watched sessions' transcripts, read from where the last read stopped like countTokens.
async function collisionsNow($: EngineInterface, o: Oversight, now: number) {
  const all: NonNullable<Oversight['edits']> = {}
  const by: Record<string, Record<string, number>> = {}
  for (const w of o.watched) {
    let s = o.edits?.[w.file]
    const size = Number((await sh($, ['wc', '-c', w.file]).catch(() => '0')).trim().split(/\s+/)[0])
    if (size > (s?.off ?? 0)) {
      const start = s ? s.off : Math.max(0, size - READ_CAP)
      const r = await $.process.run(['tail', '-c', `+${start + 1}`, w.file]).catch(() => undefined)
      if (r?.exitCode === 0) s = edits(s, r.stdout, start)
    }
    if (!s) continue
    all[w.file] = prune(s, now)
    by[w.sessionId] = all[w.file]!.at
  }
  if (JSON.stringify(all) !== JSON.stringify(o.edits ?? {})) await update($, oversight, x => x && { ...x, edits: all })
  return collisionsOf(by, now)
}

// The board every session can open: the plan's lots, where each watched session stands in the
// loop, the budget, the latest events. Written to the plugin's store, which all sessions share.
// One write at a time: a pass's slow write that started before a board request was acted on must not land after it.
let boardChain: Promise<void> = Promise.resolve()
function writeBoard($: EngineInterface): Promise<void> {
  const run = boardChain.then(() => writeBoardNow($))
  boardChain = run.catch(() => undefined)
  return run
}
async function writeBoardNow($: EngineInterface) {
  const o = await read($, oversight)
  if (!o?.isOn) return
  // Right after a reload the module has read nothing yet: read the sessions now rather than
  // overwrite a good board with an empty one.
  if (!names.size) await refreshIdents($).catch(() => undefined)
  if (!lastPeers.size && o.watched.length) {
    const peers = new Map<string, Peer>()
    for (const w of o.watched) { const p = await readPeer($, w.file); if (p) peers.set(p.sessionId, p) }
    lastPeers = peers
  }
  const now = await $.clock.now()
  const counted = await countTokens($, o, now).catch(() => o.tokens ?? {})
  const collisions = await collisionsNow($, o, now).catch(() => [])
  const md = o.run ? await $.fs.read(o.run.planPath).catch(() => '') : ''
  const decisionsTop = o.run?.top ?? lastBranches?.top
  const decisions = decisionsTop ? parseDecisions(await $.fs.read(`${decisionsTop}/DECISIONS.md`).catch(() => '')) : []
  const { goal, lots } = parsePlan(md)
  const id = await $.session.id()
  const gates = new Map<string, GatePlan>()
  for (const w of o.watched) { const g = await gateOf($, w.sessionId); if (g) gates.set(w.sessionId, g) }
  const stuckChecks = await checksStuck($).catch(() => [])
  const repo = o.run?.top ?? lastBranches?.top ?? `session-${id.slice(0, 8)}`
  const mod = await modVersion($)
  const cards: Record<string, BoardGate> = {}
  for (const w of o.watched) { const g = await gateCardOf($, o, lastPeers.get(w.sessionId), w.sessionId, now); if (g) cards[w.sessionId] = g }
  const board: Board = {
    at: now,
    overseer: id,
    repo,
    goal: goal || (o.run ? '' : 'watching sessions (no plan running)'),
    nextPassAt: (o.lastAt ?? now) + cfg.everyMs,
    ...(mod ? { mod: { version: mod } } : {}),
    paused: o.run?.paused ?? false,
    passEvery: cfg.everyMs,
    passing: isPassing,
    ...(o.error ? { error: { text: o.error, at: o.errorAt ?? now, source: o.errorSource ?? 'pass' } } : {}),
    ...(o.requests?.length ? { requests: o.requests } : {}),
    ...(o.run ? { budget: { spent: spentOf(o.run), budget: o.run.budget, level: o.run.level, series: o.run.series ?? [] } } : {}),
    proposed: lots.filter(l => l.status === 'proposed').map(l => l.n),
    lots: lots.map(l => ({ ...boardLot(l), tokens: totalOf(counted[l.n]), ...lastProofs.get(l.n), ...(o.run?.assigned.some(a => a.lot === l.n && (a.noVerdict?.n ?? 0) >= 2) ? { noVerdict: true } : {}) })),
    sessions: o.watched.map(w => {
      const p = lastPeers.get(w.sessionId)
      const a = o.run?.assigned.find(x => x.sessionId === w.sessionId)
      const check = stuckFor(p?.cwd, stuckChecks)
      const stage = stageFor(o, w.sessionId, now, gates.get(w.sessionId), check, lots)
      const block = stage === 'blocked' ? p!.marker! : undefined // lot 59: its task and the blocker it wrote last
      const why = shared.get(w.sessionId) ?? (block ? block.why ?? 'blocked, by its own word' : p?.mode === 'plan' ? 'in plan mode' : stage === 'stuck' && check ? check.text : stage === 'stuck' && p ? stuckWhy(p, now) : p && liveBackground(p, now).length ? `${liveBackground(p, now).length} background task${liveBackground(p, now).length > 1 ? 's' : ''} running` : undefined)
      return { ...(why ? { note: why } : {}), sessionId: w.sessionId, label: short(w.sessionId, w.label), stage, lot: a?.lot ?? block?.lot, lotStartedAt: a?.assignedAt, since: stage === 'work' || stage === 'report' ? (p?.lastAt ?? now) : (a?.assignedAt ?? p?.lastAt ?? now), lastText: p?.lastText.split('\n').filter(l => l.trim()).pop()?.slice(0, 160) ?? '', question: p?.question?.slice(0, 160), recommend: p?.rec && { option: p.rec.option, why: p.rec.why }, tries: a?.tries ?? 0, model: p?.model, ...(p?.marker?.status === 'departs' && p.marker.lot === a?.lot && stage === 'waits' ? { departs: p.marker.why ?? 'no reason given' } : {}), ...answerView(p, stage, registry.get(w.sessionId)), ...(gates.has(w.sessionId) || cards[w.sessionId] ? { gate: { ...gates.get(w.sessionId), ...cards[w.sessionId] } as SessionGate } : {}) }
    }),
    ...(lastBranches ? { base: lastBranches.base, top: lastBranches.top, worktrees: lastBranches.worktrees ?? [], graph: lastBranches.graph ?? [], ...(lastBranches.graphCut ? { graphCut: lastBranches.graphCut } : {}), branches: lastBranches.branches.map(b => ({ name: b.name, path: b.path, owner: b.owner, ahead: b.ahead, behind: b.behind, files: b.files.length, overlaps: b.overlaps, merge: b.merge })) } : {}),
    feed: o.log.slice(-10).reverse().map(i => ({ at: i.at, action: i.action, label: i.label, text: i.text.slice(0, 140) })),
    ...paceOf(o.log, lots, now),
    ...(collisions.length ? { collisions } : {}),
    ...(decisions.length ? { decisions } : {}),
    workflows: await workflowsOf($, wfTargets(o, id), now).catch(() => []),
  }
  // One key per repository, so overseers on other repositories keep their own board. The old shared 'board' key is dropped.
  // ponytail: boards are never pruned; prune those older than 7 days if the store grows.
  // /oversee merge <path> with no run moves this key to that repository until the next pass.
  const risk = atRisk(board, (await $.env.get('HOME')) ?? '')
  if (risk.length) board.atRisk = risk
  await $.store.set(`board:${repo}`, board)
  await $.store.delete('board').catch(() => undefined)
  // This overseer's own earlier boards under another key (the repository was unknown, or it changed) would shadow this one.
  for (const k of (await $.store.keys().catch(() => undefined)) ?? []) {
    if (k.startsWith('board:') && k !== `board:${repo}` && ((await $.store.get(k).catch(() => undefined)) as Board | undefined)?.overseer === id) await $.store.delete(k).catch(() => undefined)
  }
  // The board lives in the store, which draws nothing by itself: an atom written here redraws the pane, and only
  // the pane (an invalidate would redraw every instance this plugin draws).
  const at = await $.clock.now()
  await update($, boardAt, () => at)
  await exportBoard($, board).catch(() => undefined) // the web board is a side view: a failed write never stops the pass
}

// The light export, every 15 s while a run or a gate is showing on the last board: only the workflows and the gate stages are read
// again, no token or collision scan, and the board file is rewritten. ponytail: a run that starts between two passes shows at the
// next full pass (everyMs); watch the registry's busy status here if that is too late.
async function lightExport($: EngineInterface) {
  const o = await read($, oversight)
  if (!o?.isOn) return
  const id = await $.session.id()
  const repo = o.run?.top ?? lastBranches?.top ?? `session-${id.slice(0, 8)}`
  const prev = (await $.store.get(`board:${repo}`).catch(() => undefined)) as Board | undefined
  if (!prev || prev.overseer !== id || !(prev.workflows?.some(w => w.isActive) || prev.sessions.some(s => s.stage === 'gate'))) return
  const now = await $.clock.now()
  const workflows = await workflowsOf($, wfTargets(o, id), now).catch(() => prev.workflows ?? [])
  const sessions = await Promise.all(prev.sessions.map(async ({ gate: prevGate, ...s }) => {
    const gate = await gateOf($, s.sessionId)
    return { ...s, stage: s.stage === 'gate' || gate ? stageFor(o, s.sessionId, now, gate, undefined, prev.lots) : s.stage, ...(gate ? { gate: { ...prevGate, ...gate } as SessionGate } : prevGate?.fp && prevGate.state && prevGate.state !== 'pending' ? { gate: prevGate } : {}) } // the card of a decided plan stays
  }))
  const board: Board = { ...prev, at: now, workflows, sessions }
  await $.store.set(`board:${repo}`, board)
  await update($, boardAt, () => now)
  await exportBoard($, board).catch(() => undefined)
}

// The board for the web view (overseer/web/server.mjs), with its two drawings pre-rendered: the browser cannot load graph.ts.
async function exportBoard($: EngineInterface, board: Board) {
  const home = (await $.env.get('HOME')) ?? ''
  if (!home) return
  const label = (id?: string) => board.sessions.find(x => x.sessionId === id)?.label ?? (id ? id.slice(0, 8) : '')
  const rows = board.graph ?? [] // every row since the run started (300 commits at most): the page scrolls
  const svg = {
    graph: board.lots.length ? graphSvg(layout(board.lots), null, board.at, label, focusLot(board, board.at), 99) /* every column: the page scrolls, no camera */ : '',
    git: rows.length ? boardGitSvg(board, rows, board.at, home, label, 1100).svg : '',
  }
  await $.fs.write(`${home}/.claude/overseer/boards/${slugOf(board.repo)}.json`, JSON.stringify({ ...board, lots: board.lots.map(l => (l.brief?.criteria.length ? { ...l, checklist: checklist(l) } : l)), svg, needs: needsYou(board, board.at).map(n => ({ ...actionOf(n, board, board.at), red: n.red, id: n.id, kind: n.kind, lot: 'lot' in n && n.lot ? n.lot.n : 'session' in n ? n.session?.lot : undefined })) })) // needs: the same list the band and pane read, ranked by board.ts, each with its own action
}

// An answer asked for from the board: the lead re-checks it against the session's transcript and sends it, or drops it.
// Only the lead ever messages the session; the web page and any other pane leave a request file (~/.claude/overseer/requests/<slug>/<id>.json) for it.
async function deliver($: EngineInterface, board: Board, sessionId: string, req: Omit<Request, 'sessionId'>) {
  const file = (await read($, oversight))?.watched.find(w => w.sessionId === sessionId)?.file
  const peer = file ? await readPeer($, file) : undefined
  const answer = checkRequest({ ...req, sessionId }, board, peer)
  if (answer) { await $.session.send({ to: { sessionId }, text: `[overseer-answer] ${answer}` }).catch(() => undefined); return true } // not send(): no "[overseer] " prefix
  // A session that asked in plain text: the free text goes to it as a message from the lead (lot 54).
  if (req.text?.trim() && req.askId === undefined && board.sessions.some(s => s.sessionId === sessionId) && asksInText(peer, sessionId)) return send($, sessionId, req.text)
  return false
}
// What the lead does with one request file: done, or dropped with the reason the page shows. change, gate and plan are valid
// (server.mjs checked them); ponytail: lot actions other than done wait for lot 47 or the page.
async function handleRequest($: EngineInterface, board: Board, q: Record<string, unknown>): Promise<Pick<BoardRequest, 'state' | 'why'>> {
  const drop = (why: string) => ({ state: 'dropped' as const, why })
  const ok = { state: 'done' as const }
  switch (q.kind) {
    case 'answer':
      return typeof q.sessionId === 'string' && await deliver($, board, q.sessionId, { askId: typeof q.askId === 'string' ? q.askId : undefined, label: typeof q.label === 'string' ? q.label : undefined, text: typeof q.text === 'string' ? q.text : undefined }) ? ok : drop('the question changed or was answered')
    case 'run': {
      const run = (await read($, oversight))?.run
      if (!run) return drop('no plan running')
      await update($, oversight, x => x && x.run ? { ...x, run: { ...x.run, paused: q.paused === true } } : x)
      await note($, { sessionId: '', label: 'overseer', action: 'decided', text: q.paused === true ? 'paused from the board: running tasks go on, nothing new starts' : 'resumed from the board' })
      return ok
    }
    case 'pass':
      void passNow($).catch(() => undefined) // not awaited: a pass takes minutes, and the queue goes on
      return ok
    case 'lot': {
      const o = await read($, oversight)
      const run = o?.run
      if (!run) return drop('no plan running')
      return lotAction($, o!, q.lot as number, q.action as LotAction)
    }
    case 'change':
      return applyChange($, board, q)
    case 'gate': {
      const req = parseGateRequest(JSON.stringify(q))
      if (!req) return drop('a malformed request')
      const why = await actOnGate($, board, req).catch((err: unknown) => `the lead failed: ${String(err).slice(0, 120)}`)
      return why ? drop(why) : ok
    }
    case 'plan': { // approve: [?] → [ ]; change: one "sent" entry in the lot's changes (lot 37's list), still [?]
      const run = (await read($, oversight))?.run
      if (!run) return drop('no plan running')
      const ch = q.change as { lot: number; text: string } | undefined
      const declined = Array.isArray(q.decline) // "Not now": the task leaves the plan for « En attente », as the question in the terminal does
      const asked = ch ? [ch.lot] : Array.isArray(q.approve) ? q.approve.filter(Number.isInteger) as number[] : declined ? (q.decline as unknown[]).filter(Number.isInteger) as number[] : []
      const why: string[] = [], good: number[] = [], at = await $.clock.now()
      const day = new Date(at).toISOString().slice(0, 10)
      await withPlan(async () => {
        let md = await $.fs.read(run.planPath).catch(() => '')
        const lots = parsePlan(md).lots
        for (const n of asked) {
          const l = lots.find(x => x.n === n)
          if (!l) why.push(`no task ${n} in the plan`)
          else if (l.status !== 'proposed') why.push(`task ${n} is not proposed`)
          else if (declined) { md = fileUnderWaiting(md, n, `- **${l.title}.** ${l.body.split('\n')[0] ?? ''} (from ${l.owner || 'the board'}, ${day})`); good.push(n) }
          else { md = setLot(md, n, ch ? { changes: [...(l.changes ?? []), { id: String(q.id), text: ch.text, at, state: 'sent' }] } : { status: 'todo' }); good.push(n) }
        }
        if (good.length) await $.fs.write(run.planPath, md)
      })
      if (!good.length) return drop(why.join('; ') || 'bad request')
      await note($, { sessionId: '', label: 'overseer', action: 'decided', text: ch ? `task ${ch.lot} changed from the board: ${ch.text.slice(0, 100)}` : declined ? `tasks ${good.join(', ')} put under « En attente » from the board` : `tasks ${good.join(', ')} approved from the board` })
      return why.length ? { state: 'done' as const, why: why.join('; ') } : ok
    }
    default:
      return drop('bad request')
  }
}
// A change request on a lot (lot 37). Running: sent to its session as `[overseer-change] lot N · file:line · text`, and kept on the
// lot's `change:` line as `sent` until the session writes [change N done] or the next verdict closes it. Todo or blocked: kept on
// the line, and the next lot message carries it. Done: the lot is reopened ([ ], no session, no verdict), its branch kept, and its last
// session, when still watched, becomes its owner. Only this session writes PLAN.md (under withPlan).
async function applyChange($: EngineInterface, board: Board, q: Record<string, unknown>): Promise<Pick<BoardRequest, 'state' | 'why'>> {
  const drop = (why: string) => ({ state: 'dropped' as const, why })
  const o = await read($, oversight)
  if (!o?.run) return drop('no plan running')
  const run = o.run, n = q.lot as number
  return withPlan(async () => {
    const md = await $.fs.read(run.planPath).catch(() => '')
    const lot = parsePlan(md).lots.find(l => l.n === n)
    if (!lot) return drop(`no task ${n} in the plan`)
    const now = await $.clock.now()
    const change: Change = { id: String(q.id), ...(typeof q.file === 'string' ? { file: q.file } : {}), ...(typeof q.line === 'number' ? { line: q.line } : {}), text: String(q.text), at: now, state: 'sent' }
    const watched = (sid?: string) => !!sid && o.watched.some(w => w.sessionId === sid)
    const patch: Parameters<typeof setLot>[2] = {}
    if (lot.status === 'running') {
      if (!watched(lot.session)) return drop(`task ${n}: its session is not watched`)
      const p = lastPeers.get(lot.session!)
      if (p && !isIdle(p, now, registry.get(lot.session!))) change.queued = liveBackground(p, now).length ? 'queued until the workflow ends' : 'queued until the session ends its turn'
      const text = changeMessage(n, change) // not send(): the text starts with [overseer-change], no "[overseer] " prefix
      const sent = lot.session === (await $.session.id()) ? await $.prompt.submit({ text }).then(() => true, () => false) : (await $.session.send({ to: { sessionId: lot.session! }, text }).catch(() => ({ isDelivered: false }))).isDelivered
      if (!sent) return drop(`task ${n}: the message was not delivered`)
    } else if (lot.status === 'done') {
      Object.assign(patch, { status: 'todo' as const, session: null, verdict: null, verdictAt: null, note: 'reopened: a change was requested', ...(watched(lot.session) ? { owner: lot.session! } : {}) })
    }
    await $.fs.write(run.planPath, setLot(md, n, { ...patch, changes: [...(lot.changes ?? []).filter(c => c.id !== change.id), change] }))
    await note($, { sessionId: lot.session ?? '', label: `task ${n}`, action: 'decided', text: `change requested on task ${n}${lot.status === 'done' ? ' (reopened)' : ''}: ${change.text.slice(0, 80)}` })
    return { state: 'done' as const }
  })
}
// What the board's buttons do to a task (lot 54), under withPlan, with a decision line each:
// done: [x] (a task blocked for a reinstall first needs the installed version to equal the repository's);
// retry: back to [~] and to its session, which is told to go on; drop: back to [ ] with no session, free for the next one;
// accept-departure: its session is told to go on its way; reviewed: the item left for Victor is closed.
type LotAction = 'done' | 'retry' | 'drop' | 'accept-departure' | 'reviewed'
async function lotAction($: EngineInterface, o: Oversight, n: number, action: LotAction): Promise<Pick<BoardRequest, 'state' | 'why'>> {
  const run = o.run!
  const drop = (why: string) => ({ state: 'dropped' as const, why })
  const lot = parsePlan(await $.fs.read(run.planPath).catch(() => '')).lots.find(l => l.n === n)
  if (!lot) return drop(`no task ${n} in the plan`)
  const holder = lot.session ?? run.assigned.find(a => a.lot === n)?.sessionId
  if (action === 'done' && lot.status === 'blocked' && /^reinstall\b/i.test(lot.note ?? '')) {
    const want = JSON.parse(await $.fs.read(`${run.top}/overseer/.claude-plugin/plugin.json`).catch(() => '{}')).version as string | undefined
    const have = installedVersion(await $.fs.read(`${(await $.env.get('HOME')) ?? ''}/.claude/plugins/installed_plugins.json`).catch(() => ''), $.plugin.root)
    if (!want || have !== want) return drop(`not reinstalled yet: installed ${have ?? 'none'}, the repository has ${want ?? 'none'}`)
  }
  if ((action === 'retry' || action === 'accept-departure') && !holder) return drop(`task ${n} has no session`)
  if (action === 'reviewed' && !lot.review) return drop(`task ${n} has nothing left to review`)
  const patch = action === 'done' ? { status: 'done' as const }
    : action === 'retry' ? { status: 'running' as const, note: 'sent back from the board' }
    : action === 'drop' ? { status: 'todo' as const, session: null, note: 'dropped from its session from the board' }
    : action === 'reviewed' ? { review: null }
    : {}
  if (Object.keys(patch).length) await withPlan(async () => { const md = await $.fs.read(run.planPath).catch(() => ''); await $.fs.write(run.planPath, setLot(md, n, patch)) })
  if (action === 'retry') {
    const file = o.watched.find(w => w.sessionId === holder)?.file
    const p = file ? await readPeer($, file) : undefined
    const at = await $.clock.now()
    await update($, oversight, x => x && x.run ? { ...x, run: { ...x.run, assigned: [...x.run.assigned.filter(a => a.lot !== n), { lot: n, sessionId: holder!, cwd: p?.cwd ?? '', base: x.run.assigned.find(a => a.lot === n)?.base ?? lot.base ?? '', assignedAt: at, tries: 0 }] } } : x)
    await send($, holder!, `Task ${n} comes back to you from the board: go on with it, then end with [task ${n} done on <branch>].`)
  }
  if (action === 'drop') await update($, oversight, x => x && x.run ? { ...x, run: { ...x.run, assigned: x.run.assigned.filter(a => a.lot !== n) } } : x)
  if (action === 'accept-departure') await send($, holder!, `Task ${n}: your departure from the plan is accepted. Go on that way, then end with [task ${n} done on <branch>].`)
  const said = { done: 'marked done from the board', retry: 'sent back to its session from the board', drop: 'dropped from its session from the board', 'accept-departure': 'its departure accepted from the board', reviewed: `looked at from the board: ${lot.review ?? ''}` }[action]
  await decide($, run.top, n, `What becomes of task ${n} (${lot.title})?`, said)
  return { state: 'done' }
}

let pulling = false
async function pullRequests($: EngineInterface) {
  if (pulling) return
  pulling = true
  try {
    const o = await read($, oversight)
    if (!o?.isOn || !o.watched.length) return
    const board = await readBoard($)
    const home = (await $.env.get('HOME')) ?? ''
    if (!board || board.overseer !== (await $.session.id()) || !home) return
    const dir = `${home}/.claude/overseer/requests/${slugOf(board.repo)}`
    const handled: BoardRequest[] = []
    for (const name of (await sh($, ['ls', dir])).split('\n').filter(n => n.endsWith('.json'))) {
      const path = `${dir}/${name}`
      const raw = await $.fs.read(path).catch(() => '')
      if (!raw) continue
      let q: Record<string, unknown> = {}
      try { q = JSON.parse(raw) } catch {}
      const kind = KINDS.includes(q.kind as BoardRequest['kind']) ? q.kind as BoardRequest['kind'] : 'unknown'
      const r = await handleRequest($, board, kind === 'unknown' ? {} : q).catch((): Pick<BoardRequest, 'state' | 'why'> => ({ state: 'dropped', why: 'bad request' }))
      await sh($, ['rm', '-f', path]) // done or dropped, never kept
      handled.push({ id: typeof q.id === 'string' ? q.id : name.replace(/\.json$/, ''), kind, ...r, at: await $.clock.now() })
    }
    if (!handled.length) return
    const now = await $.clock.now()
    await update($, oversight, x => x && { ...x, requests: [...handled.reverse(), ...(x.requests ?? [])].filter(r => now - r.at < 24 * 3600e3).slice(0, 20) }) // newest first
    await writeBoard($) // the page sees the outcome at once
  } finally { pulling = false }
}
const KINDS: string[] = ['answer', 'run', 'pass', 'lot', 'change', 'gate', 'plan']
async function pressAnswer($: EngineInterface, board: Board, sessionId: string, askId: string, label: string) {
  if (board.overseer === (await $.session.id())) return deliver($, board, sessionId, { askId, label })
  const dir = `${(await $.env.get('HOME')) ?? ''}/.claude/overseer/requests/${slugOf(board.repo)}`
  const id = `${sessionId}-${askId}`.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 64) // the id server.mjs accepts: toolu_ ids carry an underscore
  await sh($, ['mkdir', '-p', dir])
  await $.fs.write(`${dir}/${id}.json`, JSON.stringify({ kind: 'answer', id, sessionId, askId, label, at: await $.clock.now() }))
}

// The workflow a watched session's gate holds, as the board shows it: pending, or decided from the board (the decision
// stays on the card for 30 min after the session ran or dropped the plan).
async function planOf($: EngineInterface, p: Peer | undefined): Promise<{ name: string; content: string; fp: string } | undefined> {
  const g = p?.gate
  const content = g ? (g.script ?? (g.scriptPath ? await $.fs.read(g.scriptPath).catch(() => '') : '')) : ''
  return g && content ? { name: g.name, content, fp: await fingerprintOf(content) } : undefined
}
async function gateCardOf($: EngineInterface, o: Oversight, p: Peer | undefined, sessionId: string, now: number): Promise<BoardGate | undefined> {
  const plan = await planOf($, p), done = o.gates?.[sessionId]
  if (plan && done?.fp !== plan.fp) return { name: plan.name, fp: plan.fp, state: 'pending' }
  return done && (plan || now - done.at < 30 * 60e3) ? { name: done.name, fp: done.fp, state: done.state, at: done.at } : undefined
}

// Approve, change or reject the plan a session's gate holds. Returns why it was dropped, or undefined when done.
// The lead refuses a plan the board did not show (a watched agent cannot approve its own new plan through the board).
async function actOnGate($: EngineInterface, board: Board, req: GateRequest): Promise<string | undefined> {
  const o = (await read($, oversight))!
  const w = o.watched.find(x => x.sessionId === req.session)
  const plan = w ? await planOf($, await readPeer($, w.file)) : undefined
  const why = gateRefusal(req, { isWatched: !!w, shown: board.sessions.find(s => s.sessionId === req.session)?.gate?.fp, now: plan?.fp, done: o.gates?.[req.session] })
  const label = w ? short(w.sessionId, w.label) : req.session.slice(0, 8)
  if (why || !plan || !w) { await note($, { sessionId: req.session, label, action: 'gate-dropped', text: `${req.action}: ${why}` }); return why ?? 'no plan' }
  const home = (await $.env.get('HOME')) ?? ''
  let path: string | undefined
  if (req.action === 'approve') {
    const sid = req.session.replace(/[^a-z0-9_-]/gi, '_')
    const cli = gateCliOf(await $.fs.read(`${home}/.claude/workflow-gate/active/${sid}.json`).catch(() => undefined), await $.fs.read(`${home}/.claude/plugins/installed_plugins.json`).catch(() => undefined))
    if (!cli) return 'the workflow-gate plugin was not found'
    path = `${home}/.claude/overseer/gate/gate-${plan.fp}.mjs`
    await sh($, ['mkdir', '-p', `${home}/.claude/overseer/gate`])
    await $.fs.write(path, plan.content)
    const res = await $.process.run(['node', cli, 'approve-path', '--path', path, '--summary', SUMMARY]).catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }))
    if (res.exitCode !== 0) { await note($, { sessionId: req.session, label, action: 'gate-dropped', text: `approve: approval NOT recorded: ${res.stderr.slice(0, 120)}` }); return `the gate did not record the approval: ${res.stderr.slice(0, 120)}` }
  }
  const text = req.action === 'approve' ? approvedMessage(plan.name, path!) : req.action === 'change' ? gateChangeMessage(plan.name, req.text ?? '') : rejectMessage(plan.name)
  const sent = await $.session.send({ to: { sessionId: req.session }, text }).catch(() => ({ isDelivered: false })) // not send(): the text starts with [workflow-gate], no "[overseer] " prefix
  const at = await $.clock.now()
  const state = req.action === 'approve' ? 'approved' as const : req.action === 'change' ? 'changed' as const : 'rejected' as const
  await update($, oversight, x => x && { ...x, gates: { ...x.gates, [req.session]: { fp: plan.fp, name: plan.name, state, at, ...(path ? { path } : {}) } } })
  const d = decisionOf(plan.name, req)
  await note($, { sessionId: req.session, label, action: state, text: `workflow "${plan.name}" (${plan.fp}): ${d.answer}${sent.isDelivered ? '' : ' · message not delivered'}` })
  const top = o.run?.top ?? board.top
  if (top) {
    const md = withDecision(await $.fs.read(`${top}/DECISIONS.md`).catch(() => ''), decisionLine(at, o.run?.assigned.find(x => x.sessionId === req.session)?.lot, d.question, d.answer))
    if (md !== undefined) await $.fs.write(`${top}/DECISIONS.md`, md)
  }
  return sent.isDelivered || req.action === 'approve' ? undefined : 'the message was not delivered'
}

// The board this session reads: of the boards in the store (the old 'board' key counts), the one boardFor picks.
async function readBoard($: EngineInterface): Promise<Board | undefined> {
  const keys = ((await $.store.keys().catch(() => undefined)) ?? ['board']).filter(k => k === 'board' || k.startsWith('board:'))
  const all = (await Promise.all(keys.map(k => $.store.get(k).catch(() => undefined)))).filter((b): b is Board => !!b && typeof b === 'object')
  return boardFor(all, { self: await $.session.id(), cwd: await $.session.cwd().catch(() => '') })
}

// What moved on the graph, read off the board each tick while the pane is open (never in the render
// hook: an atom written while drawing draws again). The first look sets the values, no motion.
async function stepMotion($: EngineInterface) {
  const b = await readBoard($)
  if (!b) return
  const cur = await read($, motion)
  const next = step(cur, layout(b.lots), await $.clock.now())
  if (JSON.stringify(next) !== JSON.stringify(cur)) await update($, motion, () => next)
}

// ---------------------------------------------------------------- commands

// The web board with its token (server.mjs writes ~/.claude/overseer/web.json at start): the browser opens the URL and
// trades the token for a cookie. The token goes to the browser only: never in a command's text, a toast or the log,
// which the session's model can read. Once per server start.
let webOpened: string | undefined
async function openWeb($: EngineInterface): Promise<boolean> {
  try {
    const w = JSON.parse(await $.fs.read(`${(await $.env.get('HOME')) ?? ''}/.claude/overseer/web.json`))
    if (!/^[0-9a-f]{64}$/.test(w.token) || !Number.isInteger(w.port) || webOpened === w.token) return false
    const r = await $.process.run(['open', `http://127.0.0.1:${w.port}/?t=${w.token}`])
    if (r.exitCode !== 0) return false
    webOpened = w.token
    return true
  } catch { return false }
}

// The phone link (lot 68). CAUTION: the board can approve workflows: tailnet only (`tailscale serve`, never funnel), and the
// QR code's link carries the board token, so it goes to a pane only (module memory, never the store, a toast, the log, the
// board or this command's text, which the model reads).
let phoneView: { name: string; lines: string[] } | undefined
async function phone($: EngineInterface, off: boolean): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  const webFile = `${home}/.claude/overseer/web.json`
  const web = async () => { try { return JSON.parse(await $.fs.read(webFile)) as { port?: number; token?: string; host?: string } } catch { return undefined } }
  const run = (argv: string[]) => $.process.run(argv, { timeoutMs: 20000 }).catch((err: unknown) => ({ exitCode: 127, stdout: '', stderr: String(err) }))
  if (off) {
    const r = await run(SERVE_OFF)
    const w = await web()
    if (w?.host) { const { host: _, ...rest } = w; await $.fs.write(webFile, JSON.stringify(rest)) }
    phoneView = undefined
    return `📱 Phone link off${r.exitCode === 0 ? ': tailscale serve stopped' : ` (tailscale serve said: ${r.stderr.trim().slice(0, 160) || 'nothing'})`}; the board answers on this Mac only.`
  }
  if ((await run(['tailscale', 'version'])).exitCode !== 0) return `📱 Tailscale is not installed. Run:\n  ${SETUP.install.join('\n  ')}\nthen /oversee phone again.`
  const net = tailnetOf((await run(['tailscale', 'status', '--json'])).stdout)
  if (!net.loggedIn || !net.name) return `📱 Tailscale is not logged in. Run:\n  ${SETUP.login.join('\n  ')}\nthen /oversee phone again.`
  if (await ensureServer($, true).catch(() => undefined) === 'started') for (let i = 0; i < 20 && !await askServer($); i++) await new Promise(r => $.clock.after(250, () => r(undefined))) // the new board answers, and has written its token, before the serve starts
  const w = await web()
  if (!w?.token || !/^[0-9a-f]{64}$/.test(w.token)) return '📱 The web board is not running yet: run /oversee show, then /oversee phone again.'
  const served = await run(SERVE)
  if (served.exitCode !== 0) return `📱 tailscale serve failed: ${served.stderr.trim().slice(0, 200)}`
  await $.fs.write(webFile, JSON.stringify({ ...w, host: net.name }))
  const qr = await run(['osascript', '-l', 'JavaScript', '-e', QR_SCRIPT, `https://${net.name}/?t=${w.token}`])
  const lines = qr.exitCode === 0 ? qrLines(qr.stdout) : []
  if (!lines.length) return `📱 The board is on https://${net.name} for your tailnet, but the QR code could not be drawn. Open /oversee show on this Mac instead.`
  phoneView = { name: net.name, lines }
  await $.ui.open({ id: PHONE_PANE, title: '📱 Overseer on your phone' })
  return `📱 The board is on https://${net.name}, for your tailnet only. Scan the QR code in the pane with the phone (Tailscale on): it logs the phone in. Keep the Mac awake (caffeinate -s). /oversee phone off stops it.`
}

const quiet = (p: Peer) => `${Math.max(0, Math.round((Date.now() - p.lastAt) / 60e3))} min`
const labelOf = (p: Peer) => p.cwd.split('/').pop() || p.sessionId.slice(0, 8)

// The web board's server (lot 51): at /oversee run and at each pass, 127.0.0.1:4318/version is probed; nothing there or an
// older version, and this session starts server.mjs from its own plugin root (an older board is stopped first: its pid
// comes from its own /version). One try per 5 min. When the start fails, /oversee prints the command instead.
let serverTriedAt = -Infinity
let serverHint: string | undefined
const modVersion = async ($: EngineInterface) => { try { return JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).version as string } catch { return undefined } }
const askServer = async ($: EngineInterface) => parseAnswer(await $.http.fetch(`http://127.0.0.1:${PORT}/version`).then(r => (r.ok ? r.text : undefined), () => undefined))
async function ensureServer($: EngineInterface, force = false): Promise<'none' | 'wait' | 'started' | 'failed'> {
  const own = await modVersion($)
  if (!own) return 'none'
  const answer = await askServer($)
  const action = serverAction(answer, own)
  if (action === 'none') { serverHint = undefined; return 'none' }
  const now = await $.clock.now()
  if (!force && now - serverTriedAt < 5 * 60e3) return 'wait' // /oversee phone forces it: the serve must not point at an older board
  serverTriedAt = now
  if (action === 'replace' && isBoardPid(answer)) {
    await $.process.run(['kill', String(answer.pid)]).catch(() => undefined)
    for (let i = 0; i < 8 && await askServer($); i++) await new Promise(r => $.clock.after(250, () => r(undefined))) // the port is free once it stops answering
  }
  const home = (await $.env.get('HOME')) ?? ''
  await sh($, ['mkdir', '-p', `${home}/.claude/overseer`])
  const r = await $.process.run(launchArgv($.plugin.root, `${home}/.claude/overseer/server.log`), { timeoutMs: 10000 }).catch(() => undefined)
  if (!r || r.exitCode !== 0) {
    serverHint = startCommand($.plugin.root)
    await note($, { sessionId: '', label: 'web board', action: 'error', text: `could not start its server: run ${serverHint}` })
    return 'failed'
  }
  serverHint = undefined
  await note($, { sessionId: '', label: 'web board', action: 'server', text: `started ${$.plugin.root}/web/server.mjs ${own}${answer ? ` in place of ${answer.version}` : ''}` }, false)
  return 'started'
}
const serverLine = () => (serverHint ? `\n\n⚠️ The web board's server is not running and could not be started: run \`${serverHint}\`` : '')

async function list($: EngineInterface): Promise<string> {
  await refreshIdents($)
  const o = await read($, oversight)
  const all = await activeSessions($)
  const watched = new Set(o?.watched.map(w => w.sessionId))
  const rows = all.map(p => `- ${watched.has(p.sessionId) ? '👁 ' : ''}**${who(p.sessionId, labelOf(p)).text}**${p.isSelf ? ' (this session: driven by prompts between its turns)' : ''} · ${p.model ?? '?'} · quiet ${quiet(p)}${p.question ? ' · ❓ waits on a question' : ''}\n  ${p.lastText.split('\n').filter(l => l.trim()).pop()?.slice(0, 140) ?? ''}`)
  return [
    `**Sessions active in the last hour** (👁 = watched)`,
    rows.join('\n') || '- none',
    '',
    '`/oversee show` opens the board (from any session) · `/oversee watch <id|self> [id…]` picks the sessions it drives (self: this one) · `/oversee merge [go]` shows the branches, who is on them and the merge order, then hands the reconciliation to a session · `/oversee plan <goal>` writes PLAN.md · `/oversee run [budget pts]` runs it through them (a night budget: 15–20 weekly-limit points) · `/oversee drop <id>` · `/oversee log` · `/oversee off`',
  ].join('\n') + serverLine()
}

const logText = (o: Oversight | null) => (o?.log.length
  ? o.log.slice(-20).map(i => `- ${new Date(i.at).toLocaleTimeString()} ${i.action} → ${i.label}${i.sessionId ? ` (${i.sessionId.slice(0, 8)})` : ''}: ${i.text}`).join('\n')
  : 'Nothing done yet.') + (o?.error ? `\n✗ last pass: ${o.error}` : '')

// activity-band's line is drawn above the other bands: while it shows, a mod draws a sub-line under it, not a second band.
// ponytail: assumes activity-band's hook wraps the others (it draws its line above `below`); if a band ever lands above it, order the hooks.
type AnyGet = (ref: unknown) => Promise<{ value?: unknown }>
// Kept in this file with inline refs: Claude Code 2.1.295 unloads a mod whose imported module (band.tsx) reads state through $, or whose ref is a const.
async function underActivity($: EngineInterface): Promise<boolean> {
  try {
    const a = (await ($.state.get as AnyGet)({ plugin: 'activity-band', key: 'now' })).value as { startedAt?: number | null } | undefined
    return a?.startedAt != null && (await ($.state.get as AnyGet)({ plugin: 'activity-band', key: 'isHidden' })).value !== true
  } catch {
    return false // activity-band absent or unreadable: a full band
  }
}

let waiter: ((label: string) => void) | undefined // the open AskUserQuestion, waiting for the lead's reply

// A worker asked by its lead to clear its context before its next task (lot 56): only from the lead of the board this
// session is on, and never in the overseer's own session (CAUTION: the lead keeps the history).
async function sayCanClear($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  await sh($, ['mkdir', '-p', `${home}/.claude/overseer/workers`])
  await $.fs.write(`${home}/.claude/overseer/workers/${await $.session.id()}.json`, JSON.stringify({ clear: true })).catch(() => undefined)
}
async function clearAsked($: EngineInterface, e: { text: string }): Promise<boolean> {
  await refreshIdents($)
  const self = await $.session.id(), lead = (await readBoard($))?.overseer
  const said = fromLead(e.text, [...registry].map(([sessionId, r]) => ({ sessionId, name: r.name, socket: r.socket })), lead)
  if (!said?.includes('[overseer-clear]') || !lead || lead === self) return false
  $.clock.after(0, () => void $.command.run({ command: 'clear' } as never).catch(() => undefined))
  return true
}

export const register: Register = (on, options) => {
  const o = (options ?? {}) as { model?: string; leadModel?: string; planFile?: string; everyMinutes?: number }
  cfg = { model: o.model || 'sonnet', leadModel: o.leadModel || 'opus', planFile: o.planFile || 'PLAN.md', everyMs: Math.max(1, Number(o.everyMinutes) || 3) * 60e3 }

  // The lead answers a watched session's open question with "[overseer-answer] <label>": whoever answers first wins, the terminal included.
  // Several questions in one call are never answered (nothing to invent for them); ExitPlanMode and permission prompts are not matched.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const qs = (e as unknown as { questions?: (Parameters<typeof answerResult>[0])[] }).questions ?? []
    if (qs.length !== 1) return next(e)
    const peer = new Promise<{ peer: string }>(r => { waiter = label => r({ peer: label }) })
    try {
      const first = await Promise.race([next(e), peer])
      if (!(first && typeof first === 'object' && 'peer' in first)) return first
      const label = (first as { peer: string }).peer
      $.ui.log(`overseer: the lead answered "${label}" from the board`)
      return { result: { questions: qs, ...answerResult(qs[0]!, label) } } as never
    } finally { waiter = undefined }
  })
  // A worker asked by its lead to clear its context before its next task (lot 56): only from the lead of the board this
  // session is on, and never in the overseer's own session (CAUTION: the lead keeps the history). The message is consumed.
  // After a /clear (by hand or asked by the lead), this session tells where it went: the lead follows it to the new id.
  // And each session says it can clear itself (workers/<id>.json): a lead asks only those, never an older mod.
  on('session.end', async ($, e, next) => {
    if ((e as { reason?: string }).reason !== 'clear') return next(e)
    const old = await $.session.id()
    const home = (await $.env.get('HOME')) ?? ''
    const tell = (n: number) => $.clock.after(500, async () => {
      const now = await $.session.id().catch(() => old)
      if (now === old) { if (n < 10) tell(n + 1); return }
      await sh($, ['mkdir', '-p', `${home}/.claude/overseer/cleared`])
      await $.fs.write(`${home}/.claude/overseer/cleared/${old}.json`, JSON.stringify({ old, new: now, at: await $.clock.now() })).catch(() => undefined)
      await sayCanClear($)
    }) // ponytail: files of sessions no lead watches stay; prune old ones if the folder grows
    tell(0)
    return next(e)
  })
  on('session.receive', async ($, e, next) => {
    if (e.text.includes('[overseer-clear]') && await clearAsked($, e)) return { consumed: 'overseer clear' }
    if (!waiter || !e.text.includes('[overseer-answer]')) return next(e)
    await refreshIdents($)
    const label = answerFrom(e.text, [...registry].map(([sessionId, r]) => ({ sessionId, name: r.name, socket: r.socket })), (await readBoard($))?.overseer)
    if (!label || !waiter) return next(e) // the terminal may have answered while the board was read
    waiter(label)
    return { consumed: 'overseer answer' }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'oversee', description: 'Overseer: drive the sessions you pick through PLAN.md on a budget. /oversee [watch|drop|merge|plan|run|status|log|focus|show|phone|off]' })
    void restoreWatched($).catch(() => undefined)
    passTimer = $.clock.every(cfg.everyMs, () => void pass($))
    $.clock.after(2000, () => void pass($)) // after a reload too: a fresh board, not one 3 min stale
    void sayCanClear($).catch(() => undefined) // lot 56: a lead may ask this session to clear itself between tasks
    $.clock.every(15000, () => void lightExport($).catch(() => undefined))
    $.clock.every(2000, () => void pullRequests($).catch(() => undefined)) // the lead's pass is minutes apart, too slow for a click; it returns at once unless this session leads
    $.clock.every(1000, () => void read($, paneOpen).then(async isOpen => {
      if (!isOpen) return
      await stepMotion($)
      await update($, tick, n => n + 1)
    }).catch(() => undefined))
    return next(e)
  })

  on('command.run', { command: 'oversee' }, async ($, e) => {
    const [verb = '', ...rest] = String(e.args ?? '').trim().split(/\s+/)
    if (verb === 'log') return { text: logText(await read($, oversight)) }
    if (verb === 'status') {
      const o = await read($, oversight)
      const top = o?.run?.top ?? await sh($, ['git', '-C', await $.session.cwd(), 'rev-parse', '--show-toplevel'])
      const path = o?.run?.planPath ?? (top ? `${top}/${cfg.planFile}` : '')
      const md = path ? await $.fs.read(path).catch(() => '') : ''
      if (!md) return { text: `👁 No ${cfg.planFile} at ${top || 'this folder'}: /oversee plan <goal> writes one.` }
      const r = o?.run
      const label = (id: string) => o?.watched.find(w => w.sessionId === id)?.label ?? id.slice(0, 8)
      return { text: `👁 ${path}\n\n${statusTable(parsePlan(md).lots, label, r && { spent: spentOf(r), budget: r.budget, level: r.level })}` }
    }
    if (verb === 'focus') {
      await writeBoard($).catch(() => undefined)
      const b = await readBoard($)
      if (!b) return { text: '👁 No overseer has run yet: /oversee watch <sessions>, then /oversee run.' }
      const f = focusOf(b, await $.clock.now())
      return { text: [
        `**Next (2 min):** ${f.next}${f.why ? ` — ${f.why}` : ''}`,
        `**Now:** ${f.state}${f.eta ? ` · ${f.eta}` : ''}`,
        ...(f.wins.length ? [`**Done ✓:** ${f.wins.join(' · ')}`] : []),
        ...(f.then.length ? ['**Then:**', ...f.then.map((t, i) => `${i + 1}. ${t}`)] : []),
      ].join('\n') }
    }
    if (verb === 'phone') return { text: await phone($, rest[0] === 'off') }
    if (verb === 'show') {
      await update($, paneOpen, () => true)
      await writeBoard($).catch(() => undefined) // a fresh board when this session is the overseer
      await stepMotion($).catch(() => undefined)
      await $.ui.open({ id: PANE, title: '👁 Overseer' })
      return { text: `👁 Overseer board opened.${(await openWeb($)) ? ' The web board opened in your browser, with the right to approve workflows.' : ''}` }
    }
    if (verb === 'off') {
      await update($, oversight, x => x && { ...x, isOn: false, watched: [], run: undefined })
      await saveWatched($, [])
      return { text: '👁 Overseer off: no session watched, no plan running.' }
    }
    if (verb === 'plan' || verb === 'run') {
      const top = await sh($, ['git', '-C', await $.session.cwd(), 'rev-parse', '--show-toplevel'])
      if (!top) return { text: '👁 Not in a git repository.' }
      if (verb === 'plan') {
        // A command cannot submit while it holds the turn: the prompt goes once the command has answered.
        const text = `Write ${cfg.planFile} at ${top} for this goal: ${rest.join(' ') || '(ask me the goal in one line)'}.\nRead the project first. Cut the work into tasks small enough for one session each, with a check anyone can run as "done when", the cheapest model that will do each task well, and dependencies. Use exactly this format:\n\n${PLAN_FORMAT}\n\nThen tell me to review it, pick the sessions with /oversee watch, and start with /oversee run.`
        $.clock.after(0, () => void $.prompt.submit({ text }).catch(() => undefined))
        return { text: `👁 Asked Claude to write ${cfg.planFile}. Review it, then /oversee watch <sessions> and /oversee run.` }
      }
      await restoreWatched($).catch(() => undefined)
      const planPath = `${top}/${cfg.planFile}`
      const n = parsePlan(await $.fs.read(planPath).catch(() => '')).lots.length
      if (!n) return { text: `👁 No tasks in ${planPath}. Write one with /oversee plan <goal>, in this format:\n\n${PLAN_FORMAT}` }
      const w = await weekly($)
      if (w === null) return { text: '👁 Not started: no weekly-limit reading yet, so the run would have no budget. Send any message, then /oversee run again.' }
      const budget = Number(rest[0]) || 15 // sized for a night of work: 15–20 weekly-limit points
      // The integration branch: what is checked out at the top now; a run already going on keeps its own. start: the commit the git tree begins after.
      const prev = (await read($, oversight))?.run
      const integration = (prev?.top === top ? prev.integration : undefined) ?? await integrationOf(gitRun($), top)
      const start = (prev?.top === top ? prev.start : undefined) ?? (await sh($, ['git', '-C', top, 'rev-parse', 'HEAD']) || undefined)
      await update($, oversight, x => ({ passes: x?.passes ?? 0, log: x?.log ?? [], watched: x?.watched ?? [], isOn: true, run: { top, planPath, budget, weeklyAt: w, weeklyNow: w, level: 'normal' as const, assigned: x?.run?.assigned ?? [], ...(integration ? { integration } : {}), ...(start ? { start } : {}) } }))
      await ensureServer($).catch(() => undefined)
      const s = await read($, oversight)
      if (!s?.watched.length) return { text: `👁 ${cfg.planFile} loaded (${n} tasks, budget ${budget} weekly-limit points), but no session is watched: pick the ones to drive with /oversee watch <id> (/oversee lists them).` }
      await pass($)
      const now = await read($, oversight)
      return { text: `👁 Running ${cfg.planFile} (${n} tasks) through ${s.watched.map(w => w.label).join(', ')}: each free session gets the next task; finished tasks are judged by ${cfg.leadModel} and marked in the plan. Budget ${budget} weekly-limit points: models step down at half, no new task at the end. ${now?.run?.assigned.length ?? 0} task(s) given. /oversee log${serverLine()}` }
    }
    if (verb === 'merge') {
      // The repository: a path given, else the plan's, else the first watched session's, else this session's folder.
      const o = await read($, oversight)
      const all = await activeSessions($)
      const home = (await $.env.get('HOME')) ?? ''
      const at = rest.find(w => /^[~/]/.test(w))?.replace(/^~/, home)
      if (at) rest.splice(rest.indexOf(rest.find(w => /^[~/]/.test(w))!), 1)
      const firstWatched = all.find(p => o?.watched.some(w => w.sessionId === p.sessionId))?.cwd
      const top = await sh($, ['git', '-C', at ?? o?.run?.top ?? firstWatched ?? (await $.session.cwd()), 'rev-parse', '--show-toplevel'])
      if (!top) return { text: `👁 Not a git repository: ${at ?? 'this session\'s folder'}. /oversee merge <repo path>` }
      const x = lastBranches = await branchesOf($, top, all)
      await writeBoard($).catch(() => undefined)
      const label = (id?: string) => {
        const p = all.find(p => p.sessionId === id)
        return o?.watched.find(w => w.sessionId === id)?.label ?? (id ? `${p ? `${labelOf(p)} ` : ''}${id.slice(0, 8)}` : '')
      }
      if (!x.branches.length) return { text: `👁 No branch ahead of ${x.base} in ${top}: nothing to merge. Another repository: /oversee merge <path>` }
      const table = [`| # | branch | session | ahead/behind | files | trial merge onto ${x.base} |`, '|---|---|---|---|---|---|',
        ...x.branches.map(b => `| ${b.merge?.order ?? '·'} | \`${b.name}\` | ${b.owner ? label(b.owner) : '—'} | +${b.ahead} / −${b.behind} | ${b.files.length} | ${!b.merge ? 'not tried' : b.merge.conflicts.length ? `✗ ${b.merge.conflicts.join(', ')}` : b.overlaps.length ? `✓ (shares files with ${b.overlaps.join(', ')})` : '✓'} |`)].join('\n')
      if (rest[0] !== 'go') return { text: `👁 ${top}\n\n${table}\n\n\`/oversee merge go [id|self] [path]\` hands the reconciliation to that session (this one by default), on a new integration branch from ${x.base}; ${x.base} itself is left to you.` }
      const self = await $.session.id()
      const who = rest[1] && rest[1] !== 'self' ? pick(rest[1], all).found[0] : self
      if (!who) return { text: `👁 Session ${rest[1]} not found (see /oversee).` }
      const now = await $.clock.now()
      const into = `integration/${new Date(now).toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
      const msg = reconcileMessage(x.base, into, x.branches, label)
      if (who === self) $.clock.after(0, () => void $.prompt.submit({ text: `[overseer] ${msg}` }).catch(() => undefined)) // after the command answers
      else if (!(await send($, who, msg))) return { text: `👁 Could not reach ${who.slice(0, 8)}.` }
      await note($, { sessionId: who, label: label(who) || 'this session', action: 'assign', text: `reconcile ${x.branches.length} branches into ${into}` })
      return { text: `👁 ${table}\n\nReconciliation handed to ${who === self ? 'this session' : label(who)} on \`${into}\`.` }
    }
    if (verb === 'watch' || verb === 'drop') {
      await refreshIdents($)
      const all = await activeSessions($)
      const cur = (await read($, oversight))?.watched ?? []
      const self = await $.session.id()
      const words = rest.map(w => (w === 'self' || w === 'this' ? self : w)) // `self` names this session
      const { found, unknown } = pick(words.join(' '), verb === 'watch' ? all : cur)
      const watched: Watched[] = verb === 'watch'
        ? [...cur, ...all.filter(p => found.includes(p.sessionId) && !cur.some(w => w.sessionId === p.sessionId)).map(p => ({ sessionId: p.sessionId, label: labelOf(p), file: p.file }))]
        : cur.filter(w => !found.includes(w.sessionId))
      // a dropped session lets go of its lot at once (PLAN.md keeps the lot as it is; the next pass marks it for the person to check)
      await update($, oversight, x => ({ passes: x?.passes ?? 0, log: x?.log ?? [], ...(x?.run ? { run: verb === 'drop' ? { ...x.run, assigned: x.run.assigned.filter(a => watched.some(w => w.sessionId === a.sessionId)) } : x.run } : {}), isOn: watched.length > 0, watched }))
      await saveWatched($, watched)
      if (verb === 'watch' && watched.length) await pass($) // a first read now: the person sees it work
      const picked = watched.map(w => who(w.sessionId, w.label).text).join(', ') || 'none'
      return { text: `👁 Watching: ${picked}.${unknown.length ? ` Not found or ambiguous: ${unknown.join(', ')} (see /oversee).` : ''} Every ${Math.round(cfg.everyMs / 60e3)} min it answers what they wait on${(await read($, oversight))?.run ? ' and gives free ones the next task of the plan' : ' and nudges stalled ones'}; it never authorizes a push, a merge, a deploy or a deletion.` }
    }
    return { text: await list($) }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, paneOpen, () => false)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PHONE_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (!phoneView) return <Box flexDirection="column"><Text dimColor>No phone link here: run /oversee phone.</Text></Box>
    return (
      <Box flexDirection="column">
        {phoneView.lines.map((l, i) => <Text key={`qr-${i}`} color="black" backgroundColor="white">{l}</Text>)}
        <Text key="qr-name">https://{phoneView.name} · tailnet only</Text>
        <Text key="qr-how" dimColor>Scan with the phone's camera, Tailscale on. Keep the Mac awake. /oversee phone off stops it.</Text>
      </Box>
    )
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Only the terminal reads the per-second tick (its spinners are text). On the desktop every source recreates the
    // Svg frame, so a redraw each second made the graphs flicker: the desktop redraws when the board or the motion
    // changes (writeBoard invalidates), and its animations run in SMIL.
    const t = e.surface === 'terminal' ? await read($, tick) : 0
    await read($, boardAt) // subscribes the pane to each board write
    const more = await read($, paneMore)
    const showLog = await read($, paneLog)
    const b = await readBoard($)
    const now = await $.clock.now()
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? '' // only to shorten paths
    if (!b) return <Box flexDirection="column"><Text dimColor>No overseer has run yet. In the session that should lead: /oversee watch &lt;sessions&gt;, /oversee plan &lt;goal&gt;, /oversee run.</Text></Box>
    const self = await $.session.id()
    const width = Math.max(40, (e.props.bodyColumns ?? 100) - 2)
    const narrow = width < 110
    const stageColor: Record<string, string> = { free: PALETTE.muted, assigned: PALETTE.info, work: PALETTE.warn, stuck: PALETTE.warn, report: PALETTE.accent, judge: PALETTE.night, waits: PALETTE.warn, blocked: PALETTE.warn } // the NEXT row in the focus block is the only coral one
    const lotColor: Record<string, string> = { todo: PALETTE.muted, running: PALETTE.warn, done: PALETTE.ok, blocked: PALETTE.alert, proposed: PALETTE.muted }
    const label = (id?: string) => b.sessions.find(x => x.sessionId === id)?.label ?? (id ? id.slice(0, 8) : '')
    const stale = isStale(b, now) // a dead overseer must not look alive: nothing spins
    const st = stale ? 0 : t
    const needs = needsYou(b, now)
    const first = needs[0]?.kind === 'waits' || needs[0]?.kind === 'stuck' ? needs[0].session.sessionId : undefined // the session the focus block's NEXT is about
    const tone = toneOf(needs)
    const clock = (at: number) => new Date(at).toTimeString().slice(0, 5)
    const lotGlyph = (status: string) => (status === 'running' && !stale ? spinner(t) : STATUS_GLYPH[status])
    const done = b.lots.filter(l => l.status === 'done').length
    const count = (s: string) => b.lots.filter(l => l.status === s).length
    const frame = (id: string, color: string, title: string, rows: RenderElement[], titleColor = color) => (
      <Box key={id} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
        <Text key={`${id}-title`} bold color={titleColor} wrap="truncate-end">{title}</Text>
        {rows}
      </Box>
    )

    // 1. header: the chip, the goal, when the next pass comes (a stale board says so instead), the buttons
    const header = (
      <Box key="ovp-head" justifyContent="space-between">
        <Box key="ovp-head-l" flexShrink={1}>
          <Text key="ovp-chip" backgroundColor={tone} color="black" bold>{' OVERSEER '}</Text>
          <Text key="ovp-goal" bold wrap="truncate-end">{` ${b.goal || 'Overseer'}`}</Text>
          {stale ? <Text key="ovp-meta-stale" color={PALETTE.warn}>{'  stale: is the overseer still on?  '}</Text> : <Text key="ovp-next" dimColor>{`  next pass in ${ago(Math.max(0, b.nextPassAt - now))}  `}</Text>}
        </Box>
        <Box key="ovp-head-r" flexShrink={0}>
          {b.overseer === self ? <Button key="ovp-btn-pass" label="Pass now" variant="primary" hotkey="p" onPress={() => void pass($)} /> : null}
          <Button key="ovp-btn-log" label="Log" hotkey="l" onPress={() => void update($, paneLog, x => !x)} />
          <Button key="ovp-btn-more" label={more ? 'Less' : 'More'} plain hotkey="f" onPress={() => void update($, paneMore, x => !x)} />
        </Box>
      </Box>
    )
    // Behind More: who leads, how fresh, and which copy draws (an installed one ends its root with its version, a working folder with its name).
    const lead = <Text key="ovp-lead" dimColor wrap="truncate-end">{b.overseer === self ? 'this session leads' : `led by ${b.overseer.slice(0, 8)} · seen from here`} · updated {ago(now - b.at)} ago · {$.plugin.root.split('/').filter(Boolean).pop()}</Text>
    // 3. progress: two cells per lot, done / running / todo / blocked, then the counts
    const cells: [string, string, string][] = [['done', '▰▰', PALETTE.ok], ['running', '▰▰', PALETTE.warn], ['todo', '▱▱', PALETTE.muted], ['blocked', '▰▰', PALETTE.alert]]
    const counts: [string, string][] = [['running', '◐'], ['todo', '○'], ['blocked', '!']]
    const progress = b.lots.length ? (
      <Text key="ovp-prog" wrap="truncate-end">
        <Text key="ovp-prog-lbl" dimColor>PROGRESS </Text>
        {cells.map(([s, g, c]) => <Text key={`ovp-prog-b-${s}`} color={c}>{g.repeat(count(s))}</Text>)}
        <Text key="ovp-prog-n" dimColor> {done}/{b.lots.length} tasks </Text>
        {counts.filter(([s]) => count(s)).map(([s, g]) => <Text key={`ovp-prog-c-${s}`} color={lotColor[s]}> {g}{count(s)}</Text>)}
      </Text>
    ) : null
    const bc = b.budget ? (b.budget.level === 'stop' ? PALETTE.alert : b.budget.level === 'reduce' ? PALETTE.warn : PALETTE.ok) : PALETTE.ok
    const budget = b.budget ? (
      <Text key="ovp-budget" wrap="truncate-end">
        <Text key="ovp-budget-lbl" dimColor>BUDGET </Text>
        <Text key="ovp-budget-bar" color={bc}>{gauge(b.budget.spent / Math.max(1, b.budget.budget), 16)}</Text>
        <Text key="ovp-budget-n" dimColor> {b.budget.spent.toFixed(1)}/{b.budget.budget} pts · </Text>
        <Text key="ovp-budget-level" color={bc}>{b.budget.level}</Text>
        {e.surface === 'terminal' && (b.budget.series?.length ?? 0) > 1 ? <Text key="ovp-budget-curve" color={bc}> {sparkline(b.budget.series!, b.budget.budget)}</Text> : null}
      </Text>
    ) : null

    // 5. the sessions table, with each loop (behind More)
    const sessions = b.sessions.length ? frame('ovp-sess', PALETTE.accent, `SESSIONS · ${b.sessions.length}`, sortSessions(b.sessions).map(x => {
      const k = `ovp-s-${x.sessionId}`
      const moving = MOVING.includes(x.stage)
      const glyph = moving && !stale ? spinner(t) : STAGE_GLYPH[x.stage]
      const showLoop = !narrow && moving && x.lot !== undefined
      return (
        <Box key={k} flexDirection="column">
          <Text key={`${k}-row`} wrap="truncate-end">
            <Text key={`${k}-glyph`} color={stageColor[x.stage]}>{glyph === '❓' ? glyph : pad(glyph, 2)}{/* ❓ is two columns wide on its own */}</Text>
            <Text key={`${k}-lbl`} bold>{pad(x.label, 16)} </Text>
            <Text key={`${k}-lot`} dimColor>{pad(x.lot !== undefined ? `T${x.lot}` : '', 4)} </Text>
            <Text key={`${k}-stage`} color={stageColor[x.stage]}>{pad(x.stage, 8)} </Text>
            <Text key={`${k}-t`} dimColor>{pad(ago(now - x.since), 7)}</Text>
            <Text key={`${k}-tries`} color={PALETTE.warn}>{x.tries > 0 ? `↺${x.tries} ` : ''}</Text>
            {!narrow && x.model ? <Text key={`${k}-model`} dimColor>{pad(x.model, 8)} </Text> : null}
            {x.stage === 'free' ? <Text key={`${k}-free`} dimColor>free, waiting for a task</Text> : null}
            {x.stage === 'blocked' ? <Text key={`${k}-blocked`} color={PALETTE.warn}>{x.note ?? 'blocked'}</Text> : null}
            {x.stage === 'waits' || x.stage === 'stuck' ? <Text key={`${k}-next`} dimColor>→ {x.sessionId === first ? 'NEXT' : 'THEN'}</Text> : null}
            {x.stage === 'free' && x.note ? <Text key={`${k}-note`} color={PALETTE.warn}> · {x.note}</Text> : null}
            {showLoop ? loopLine(x.stage, st).map((g, i) => <Text key={`${k}-g${i}`} color={g.on ? stageColor[x.stage] : PALETTE.muted} bold={g.on}>{g.t}</Text>) : null}
          </Text>
        </Box>
      )
    })) : null

    // 6. the lots with their verdicts (behind More)
    const { open: openLots, done: doneLots } = planOrder(b.lots)
    const lotRow = (l: (typeof b.lots)[number]) => {
      const k = `ovp-lot-${l.n}`
      return (
        <Text key={k} wrap="truncate-end">
          <Text key={`${k}-glyph`} color={lotColor[l.status]}>{lotGlyph(l.status)} {String(l.n).padStart(2)} </Text>
          <Text key={`${k}-lbl`} bold={l.status === 'running'} color={l.status === 'done' ? PALETTE.ok : undefined}>{narrow ? l.title : l.title.padEnd(30)}</Text>
          {l.status !== 'done' && l.depends.length ? <Text key={`${k}-dep`} dimColor> ⟵ {l.depends.join(', ')}</Text> : null}
          {l.session ? <Text key={`${k}-own`} color={PALETTE.info}> · {label(l.session)}</Text> : null}
          {!narrow && l.model ? <Text key={`${k}-model`} dimColor> · {l.model}</Text> : null}
          {l.note ? <Text key={`${k}-note`} dimColor> · {l.note}</Text> : null}
          {lotLines(l, now).map((t, i) => <Text key={`${k}-line${i}`} dimColor> · {t}</Text>)}
        </Text>
      )
    }
    const plan = b.lots.length ? frame('ovp-plan', PALETTE.accent, `PLAN · ${done}/${b.lots.length}`, [
      ...openLots.map(lotRow),
      ...doneLots.map(lotRow),
    ]) : null

    // 6a. the plan as a dependency graph: a Raster on the terminal (a list under 60 columns), Svg elsewhere
    const tb = table(e, $.ui.resolve(e))
    const L = layout(b.lots)
    const mo = stale ? null : await read($, motion)
    const room = Math.max(20, (e.props.bodyColumns ?? 100) - 4) // inside frame(): its border and padding
    const paneWidth = Math.max(360, room * 8) // CSS px on the desktop, the same 8 px a column camColsFor counts
    const graph = !b.lots.length ? null
      : tb.surface === 'terminal'
      ? frame('ovp-graph', PALETTE.accent, `TASKS · ${done}/${b.lots.length} · one lane per session`, [tb.el.Raster({ key: 'ovp-graph-r', ...(zoomOf(e.props.bodyColumns ?? 100) === 'compact' ? compactRaster(L, st, room, label) : graphRaster(L, mo, now, st, room, label, focusLot(b, now))) })])
      : (
        // Drawn at the markup's own width, which camColsFor sizes to the pane; no budget curve here: the
        // PROGRESS · BUDGET line above already says it.
        <Box key="ovp-graph" flexDirection="column">
          {tb.el.Svg({ source: graphSvg(L, mo, now, label, focusLot(b, now), camColsFor(e.props.bodyColumns ?? 100)), alt: `Tasks of the plan as a graph: ${b.lots.map(l => `${l.n} ${l.title} ${l.status}`).join(', ')}`, isInteractive: true })}
        </Box>
      )

    // 6a. at risk: what closing every session now would lose; the default view folds it into the branches line
    const risk = b.atRisk ?? []
    const atRiskFrame = risk.length ? frame('ovp-risk', PALETTE.warn, `AT RISK · ${risk.length} ${risk.length === 1 ? 'worktree' : 'worktrees'} · closing every session now would lose this`, [
      ...risk.slice(0, 5).map((r, i) => <Text key={`ovp-risk-${i}`} wrap="truncate-end"><Text color={PALETTE.warn}>● </Text>{atRiskLine(r, now)}</Text>),
      ...(risk.length > 5 ? [<Text key="ovp-risk-more" dimColor>+{risk.length - 5} more</Text>] : []),
    ]) : null

    // 6b. workflows of the watched sessions
    const wfs = b.workflows ?? []
    const workflows = wfs.length ? frame('ovp-wf', PALETTE.ok, `WORKFLOWS · ${wfs.filter(w => w.isActive).length} running · ${wfs.length} in the last 3 h`, wfs.slice(0, 12).map(w => (
      <Text key={`ovp-wf-${w.runId}`} wrap="truncate-end">
        <Text color={w.isActive ? PALETTE.warn : PALETTE.ok}>{w.isActive ? (stale ? '◑' : spinner(t)) : '✓'} </Text>
        <Text bold>{pad(w.name, 28)}</Text>
        <Text color={w.isActive ? PALETTE.warn : PALETTE.ok}> {gauge(w.done / Math.max(1, w.started), 10)}</Text>
        <Text dimColor> {w.done}/{w.started} agents</Text>
        <Text color={PALETTE.info}> · {label(w.session)}</Text>
        {w.phase ? <Text dimColor> · {w.phase}</Text> : null}
        {w.running.length ? <Text color={PALETTE.warn}> · running {w.running.slice(0, 3).join(', ')}{w.running.length > 3 ? ` +${w.running.length - 3}` : ''}</Text> : null}
      </Text>
    ))) : null

    // 7. the commit graph of the local branches, with the worktrees and sessions on their branches
    const tree = worktreeTree(b, home)
    const byBranch = new Map(tree.filter(x => x.branch).map(x => [x.branch!, x]))
    const clean = tree.filter(x => x.merge && !x.merge.conflicts.length).length
    const tried = tree.filter(x => x.merge).length
    const rows = (b.graph ?? []).slice(0, 40)
    const shown = new Set(rows.flatMap(r => r.refs ?? []))
    const offGraph = tree.filter(x => x.kind !== 'main' && (!x.branch || !shown.has(x.branch)))
    const graphW = Math.max(...rows.map(r => r.graph.length), 1)
    const refChip = (ref: string, k: string) => {
      const x = byBranch.get(ref)
      const isBase = ref === (b.base ?? 'main')
      return [
        <Text key={`${k}-n`} backgroundColor={isBase ? PALETTE.accent : x?.kind === 'branch' || !x ? PALETTE.muted : PALETTE.info} color="black" bold>{` ${ref} `}</Text>,
        ...(x && x.kind !== 'branch' ? [<Text key={`${k}-w`} color={PALETTE.info}> {x.kind === 'main' ? '▣' : '▢'} {x.where}</Text>] : []),
        ...(x?.owner ? [<Text key={`${k}-o`} color={PALETTE.info}> · {label(x.owner)}</Text>] : []),
        ...(x?.dirty ? [<Text key={`${k}-d`} color={PALETTE.warn}> ●{x.dirty}</Text>] : []),
        ...(x?.merge ? [<Text key={`${k}-m`} color={x.merge.conflicts.length ? PALETTE.alert : PALETTE.ok}> {x.merge.conflicts.length ? `✗ ${x.merge.conflicts.join(', ')}` : '✓'}</Text>] : []),
        ...(x?.stale ? [<Text key={`${k}-s`} dimColor> stale</Text>] : []),
        <Text key={`${k}-sp`}> </Text>,
      ]
    }
    const branchesTitle = `GRAPH · ${b.base ?? 'main'} · ${tree.filter(x => x.kind === 'main' || x.kind === 'worktree').length} worktrees${tried ? ` · ${clean}/${tried} merge clean · /oversee merge` : ''}`
    // Desktop: the commit graph and the worktrees as one Svg. Text cells break the lanes in a proportional font and
    // wrap long subjects; strokes keep the lanes whole, and a subject is cut to its room with its full text on hover.
    const desktopBranches = tb.surface === 'terminal' || !rows.length ? null : (() => {
      const g = boardGitSvg(b, rows, now, home, label, paneWidth)
      return frame('ovp-br', PALETTE.accent, branchesTitle, [
        <Box key="ovp-br-svg">{tb.el.Svg({ source: g.svg, alt: `Commit graph of ${b.base ?? 'main'} with ${tree.filter(x => x.kind !== 'branch').length} worktrees`, isInteractive: true, width: paneWidth, height: g.height })}</Box>,
      ])
    })()
    const branches = desktopBranches ?? (rows.length ? frame('ovp-br', PALETTE.accent, branchesTitle, [
      ...rows.map((r, i) => (
        <Text key={`ovp-g-${i}`} wrap="truncate-end">
          {graphCells(r.graph.padEnd(graphW)).map((c, j) => <Text key={`ovp-g-${i}-${j}`} color={LANE_COLORS[c.lane % LANE_COLORS.length]} bold={c.ch === '●'}>{c.ch}</Text>)}
          {r.hash ? <Text key={`ovp-g-${i}-h`} dimColor>{` ${r.hash} `}</Text> : null}
          {(r.refs ?? []).flatMap((ref, k) => refChip(ref, `ovp-g-${i}-r${k}`))}
          {r.subject ? <Text key={`ovp-g-${i}-s`}>{r.subject}</Text> : null}
          {r.at ? <Text key={`ovp-g-${i}-a`} dimColor>{` · ${ago(now - r.at)}`}</Text> : null}
        </Text>
      )),
      // Every worktree, one row each (the graph only shows the branches of its last commits).
      <Text key="ovp-wt-title" bold color={PALETTE.info}>WORKTREES · {tree.filter(x => x.kind !== 'branch').length}</Text>,
      ...tree.filter(x => x.kind !== 'branch').map((x, i) => (
        <Text key={`ovp-wt-${i}`} wrap="truncate-end">
          <Text color={x.kind === 'main' ? PALETTE.accent : x.isPrunable ? PALETTE.muted : PALETTE.info}>{x.kind === 'main' ? '▣' : x.kind === 'detached' ? '◇' : '▢'} </Text>
          <Text bold={x.kind === 'main'} color={x.isPrunable ? PALETTE.muted : undefined}>{pad(x.branch ?? '(detached)', 26)}</Text>
          <Text color={PALETTE.muted}> {pad(x.where, 34)}</Text>
          {x.owner ? <Text color={PALETTE.info}> {label(x.owner)}</Text> : null}
          {x.dirty ? <Text color={PALETTE.warn}> ●{x.dirty} uncommitted</Text> : null}
          {x.merge ? <Text color={x.merge.conflicts.length ? PALETTE.alert : PALETTE.ok}> {x.merge.conflicts.length ? `✗ ${x.merge.conflicts.join(', ')}` : `✓ merges clean (${x.merge.order})`}</Text> : null}
          {x.isPrunable ? <Text color={PALETTE.muted}> · folder gone (git worktree prune)</Text> : null}
          {x.stale ? <Text color={PALETTE.muted}> · stale</Text> : null}
        </Text>
      )),
    ]) : null)

    // 8. feed
    const feed = b.feed.map((f, i) => (
      <Text key={`ovp-feed-${i}`} wrap="truncate-end">
        {i === 0 ? <Text bold>FEED </Text> : '     '}
        <Text dimColor>{clock(f.at)} </Text>
        <Text color={f.action === 'done' ? PALETTE.ok : f.action === 'blocked' ? PALETTE.alert : f.action === 'retry' ? PALETTE.warn : f.action === 'budget' ? PALETTE.accent : PALETTE.info}>{f.action}</Text>
        <Text> → {f.label}: </Text>
        <Text dimColor>{f.text}</Text>
      </Text>
    ))

    const logRows = showLog ? logText(await read($, oversight)).split('\n') : []
    // 0. focus, shaped for an ADHD reader: one next action first, then where things stand, the wins, at most three next
    const f = focusOf(b, now)
    // Coral only on the row that names the action (the first need); calm is muted.
    const answering = needs[0]?.kind === 'waits' && (needs[0].session.ask || needs[0].session.link) ? needs[0].session : undefined // lot 19: answer buttons and link under NEXT
    const nextColor = !needs.length ? PALETTE.muted : needs[0]!.red ? PALETTE.alert : PALETTE.warn
    const focus = frame('ovp-focus', needs.length ? FOCUS_BORDER : PALETTE.accent, 'FOCUS', [
      <Text key="ovp-f-next" wrap="truncate-end"><Text bold color={nextColor}>▶ NEXT  </Text>{needs.length ? <Text bold color={nextColor}>{f.next}</Text> : <Text color={PALETTE.muted}>{f.next}</Text>}{f.why && !f.card ? <Text color={PALETTE.muted}> · {f.why}</Text> : null}</Text>,
      ...(f.card ? f.card.slice(1).map((l, i) => <Text key={`ovp-f-card-${i}`} color={PALETTE.muted} wrap="truncate-end">{'        '}{l}</Text>) : []),
      ...(answering ? [<Box key="ovp-f-ans" flexDirection="column">
        {answering.ask ? <Box key="ovp-f-opts" gap={1}>{answering.ask.options.map(label => <Button key={`ovp-f-o-${label}`} label={label} onPress={() => void pressAnswer($, b, answering.sessionId, answering.ask!.id, label)} />)}</Box> : null}
        {answering.link ? <Text key="ovp-f-link" dimColor>répondre {answering.link}</Text> : null}
      </Box>] : []),
      <Text key="ovp-f-gap"> </Text>,
      <Text key="ovp-f-now" wrap="truncate-end"><Text color={PALETTE.info}>● NOW   </Text>{tb.surface === 'terminal' ? f.state : f.activity}{f.eta ? <Text color={PALETTE.muted}> · {f.eta}</Text> : null}</Text>,
      ...(f.wins.length ? [<Text key="ovp-f-won" wrap="truncate-end"><Text color={PALETTE.ok}>✓ DONE  </Text><Text color={PALETTE.ok}>{f.wins.join('  ·  ')}</Text></Text>] : []),
      ...f.then.map((t, i) => <Text key={`ovp-f-then-${i}`} wrap="truncate-end"><Text color={PALETTE.muted}>{i === 0 ? '  THEN  ' : '        '}{i + 1}. </Text>{needs[i + 1]?.kind === 'stuck' ? <Text color={PALETTE.warn}>{t}</Text> : t}</Text>),
    ], needs.length ? PALETTE.alert : PALETTE.accent)
    // the default view, top to bottom, one group per mockup block (pane-terminal.html); an empty group drops out with its gap
    const sess = sortSessions(b.sessions)
    const sessRows = sess.filter(x => x.stage !== 'free').map(x => {
      const k = `ovp-s-${x.sessionId}`
      const glyph = x.stage === 'waits' ? '?' : x.stage === 'stuck' ? '◍' : x.stage === 'blocked' ? '!' : MOVING.includes(x.stage) && !stale ? spinner(t) : STAGE_GLYPH[x.stage]
      return (
        <Text key={k} wrap="truncate-end">
          <Text key={`${k}-glyph`} color={x.stage === 'waits' ? PALETTE.alert : PALETTE.warn}>{glyph} </Text>
          <Text key={`${k}-lbl`}>{pad(x.label, 12)} </Text>
          <Text key={`${k}-lot`} dimColor>{pad(x.lot !== undefined ? `task ${x.lot} ${b.lots.find(l => l.n === x.lot)?.title ?? ''}`.trimEnd() : '', 24)} </Text>
          {x.stage === 'waits' ? <Text key={`${k}-next`} dimColor>→ {x.sessionId === first ? 'NEXT' : 'THEN'}</Text>
            : x.stage === 'stuck' || x.stage === 'blocked' ? <Text key={`${k}-why`} color={PALETTE.warn}>{x.stage === 'blocked' ? 'blocked: ' : ''}{x.note ?? ago(now - x.since)}</Text>
            : [<Text key={`${k}-stage`} color={stageColor[x.stage]}>{x.stage}</Text>, <Text key={`${k}-t`} dimColor> {ago(now - x.since)}</Text>]}
        </Text>
      )
    })
    const frees = sess.filter(x => x.stage === 'free').map(x => x.label)
    if (frees.length) sessRows.push(<Text key="ovp-s-free" dimColor wrap="truncate-end">○ free: {frees.join(', ')}</Text>)
    const openRows = openLots.map(l => {
      const k = `ovp-lot-${l.n}`
      return (
        <Text key={k} wrap="truncate-end">
          <Text key={`${k}-glyph`} color={lotColor[l.status]}>{lotGlyph(l.status)} {l.n} {pad(l.title, 16)} </Text>
          {l.status === 'blocked' ? <Text key={`${k}-why`} dimColor>{l.note ?? 'blocked'}</Text> : l.doneWhen ? <Text key={`${k}-dw`} dimColor>done when: {l.doneWhen}</Text> : null}
        </Text>
      )
    })
    if (doneLots.length) openRows.push(<Text key="ovp-lot-done" wrap="truncate-end"><Text color={PALETTE.ok}>✓ {doneLots.length} done</Text><Text dimColor>{'  · More (f) for verdicts, the tasks graph and the branches'}</Text></Text>)
    // branches in one line: what is ahead of the base, whether they merge, what closing now would lose
    const ahead = tree.reduce((n, x) => n + (x.kind === 'main' ? 0 : x.ahead ?? 0), 0)
    const conflicts = tree.filter(x => x.merge?.conflicts.length).length
    const lost = risk.reduce((n, r) => n + r.files.length, 0)
    const brParts = [...(ahead ? [`${ahead} ahead of ${b.base ?? 'main'}`] : []), ...(tried ? [conflicts ? `${conflicts} conflict` : 'no conflict'] : [])]
    const atRiskTxt = risk.length ? `${risk.length} ${risk.length === 1 ? 'worktree' : 'worktrees'}${lost ? `, ${lost} uncommitted` : ' at risk'}` : ''
    const branchLine = brParts.length || atRiskTxt ? (
      <Text key="ovp-branches" wrap="truncate-end">
        <Text key="ovp-br-l" dimColor>{`branches  ${brParts.join(' · ')}${brParts.length && atRiskTxt ? ' · ' : ''}`}</Text>
        {atRiskTxt ? <Text key="ovp-br-risk" color={PALETTE.warn}>{atRiskTxt}</Text> : null}
      </Text>
    ) : null
    const groups: RenderElement[][] = [
      [header],
      [focus, ...(showLog ? [frame('ovp-log', PALETTE.muted, 'LOG', logRows.map((r, i) => <Text key={`ovp-log-${i}`} dimColor wrap="truncate-end">{r}</Text>))] : [])],
      progress ? [progress] : [], sessRows, openRows, branchLine ? [branchLine] : [],
    ].filter(g => g.length)
    return (
      <Box flexDirection="column">
        {groups.flatMap((g, i) => (i ? [<Text key={`ovp-gap-${i}`}> </Text>, ...g] : g))}
        {/* what the default view does not say is folded behind More (UX.md rules 1, 2) */}
        {more ? [lead, atRiskFrame, budget, sessions, workflows, graph, plan, branches, feed] : null}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const s = await read($, oversight)
    if (!s?.isOn || e.props.hasSurvey) return below
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const r = s.run
    const b = await readBoard($)
    const lots = b?.lots ?? []
    const done = lots.filter(l => l.status === 'done').length
    const blocked = lots.filter(l => l.status === 'blocked').length
    const working = b?.sessions.filter(x => MOVING.includes(x.stage)) ?? []
    const stalled = b?.sessions.filter(x => x.stage === 'blocked') ?? [] // lot 59: blocked on its task, not free
    const open = await read($, isOpen)
    const now = await $.clock.now() // the engine's clock, as the pane reads it: a mocked one gives the same screen every time
    const needs = b ? needsYou(b, now) : []
    const actions = b && needs.length ? actionsOf(b, now).slice(0, needs.length) : [] // one action per need, same order
    const needColor = (i: number) => (needs[i]!.red ? PALETTE.alert : PALETTE.warn) // coral only on a row that names the action
    const [rid, rwhy] = Object.entries(s.refused ?? {}).filter(([id]) => s.watched.some(w => w.sessionId === id)).at(-1) ?? []
    const refusal = rid ? { label: s.watched.find(w => w.sessionId === rid)?.label ?? rid.slice(0, 8), reason: rwhy! } : undefined
    // error: what failed, then what to do (the mockup's "✗ … · …"); the first is coral, the second muted
    const failure: { what: string; todo: string } | undefined = s.error ? { what: s.error, todo: 'open the Board, then Log' }
      : refusal ? { what: `not delivered to ${refusal.label}: ${refusal.reason}`, todo: /closed|gone|exit/i.test(refusal.reason) ? '/oversee watch it again' : 'open its session' } : undefined
    // Open, 5 lines at most: what the first need recommends/blocks/waited, the next need, the progress bar, the sessions.
    const bar = (w: number) => {
      const n = Math.max(1, lots.length), part = (c: number) => Math.round((c / n) * w)
      const d = part(done), run = part(lots.filter(l => l.status === 'running').length), bl = part(blocked)
      return [{ t: '▰'.repeat(d), c: PALETTE.ok }, { t: '▰'.repeat(run), c: PALETTE.warn }, { t: '▱'.repeat(Math.max(0, w - d - run - bl)), c: PALETTE.muted }, { t: '▰'.repeat(bl), c: PALETTE.alert }]
    }
    const card = actions[0]?.card?.slice(1).join(' · ')
    const detail = [
      ...(card ? [<Text key="ov-card" dimColor wrap="truncate-end">  {card}</Text>] : []),
      ...(actions[1] ? [<Text key="ov-next" wrap="truncate-end"><Text color={needColor(1)}>  ! </Text>{actions[1].text}{actions[1].why && needs[1]?.kind !== 'blocked' ? <Text dimColor>: {actions[1].why}</Text> : null}</Text>] : []),
      ...(r && lots.length ? [<Text key="ov-plan">  {bar(12).map((g, i) => <Text key={`ov-bar${i}`} color={g.c}>{g.t}</Text>)}<Text dimColor> {done}/{lots.length}{blocked ? ` · ${blocked} blocked` : ''}</Text></Text>] : []),
      ...(working.length ? [<Text key="ov-work" dimColor wrap="truncate-end"><Text color={PALETTE.warn}>  ◑ </Text>{working.map(x => `${x.label} task ${x.lot ?? '?'}${x.note ? ` (${x.note})` : ''}`).join(' · ')}</Text>] : []),
      ...(stalled.length ? [<Text key="ov-blocked" dimColor wrap="truncate-end"><Text color={PALETTE.warn}>  ! </Text>{stalled.map(x => `${x.label} blocked on task ${x.lot ?? '?'}${x.note ? `: ${x.note}` : ''}`).join(' · ')}</Text>] : []),
    ]
    const compact = await underActivity($)
    const calm = [r && lots.length ? `${done}/${lots.length} tasks` : '', b ? `${working.length} working` : `${s.watched.length} watched`, stalled.length ? `${stalled.length} blocked` : '', b ? `next pass ${new Date(b.nextPassAt).toTimeString().slice(0, 5)}` : ''].filter(Boolean).join(' · ')
    return (
      <Box flexDirection="column">
        {below /* the others first: a band sits under activity-band's line whatever the load order */}
        {band(els, {
          id: 'ov', surface: e.surface, icon: '👁', name: 'Overseer', color: PALETTE.accent, open, compact,
          tone: failure || needs.some(n => n.red) ? 'alert' : needs.length ? 'warn' : 'ok',
          onToggle: () => void update($, isOpen, x => !x),
          // One thing to read: the failure, else the next action, else one muted line.
          summary: failure ? [{ t: `✗ ${failure.what}`, c: PALETTE.alert }, ` · ${failure.todo}`]
            : actions.length ? [{ t: `▶ ${actions[0]!.text}`, c: needColor(0), b: true }, ...(needs.length > 1 ? [` · +${needs.length - 1}`] : [])]
            : [{ t: '✓', c: PALETTE.ok }, ` ${calm}`],
          actions: [
            { key: 'board', label: 'Board', hotkey: 'b', onPress: () => void (async () => { await update($, paneOpen, () => true); await writeBoard($).catch(() => undefined); await $.ui.open({ id: PANE, title: '👁 Overseer' }) })() },
            { key: 'pass', label: 'Pass now', onPress: () => void pass($) },
          ],
          detail,
        })}
      </Box>
    )
  })
}
