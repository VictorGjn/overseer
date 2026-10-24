import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, ToolCallResult } from 'claude-code'
import { band, gauge, soft, type BandSpec } from './band.tsx'

import type { RetroRecord, TimelineEntry } from '../types'
import type { BanditStats, Decision, Edits, Flag, FlagDecision, LabelRecord, LiveAgent, MissionProposal, Plan, Run, Tab } from '../types'
import { extract, splice, TIERS } from './plan.ts'
import { applyEdits, extract as extractFlow, withModel } from './flow.ts'
import { layout } from './layout.ts'
import { bar, MODEL_COLOR, SQUEEZED } from './canvas.tsx'
import { compact, criticalPath, frame, MAX, scene } from './canvas-raster.ts'
import type { Scene } from './canvas-raster.ts'
import { loop } from './kit/cells.ts'
import { flowSvg, remember, snapshot, SOURCE_MAX } from './canvas-svg.ts'
import type { FlowSvg, Motion, Worker } from './canvas-svg.ts'
import { hasSvg, zoomOf } from './kit/surface.ts'
import { checkRows, LIVE_SYSTEM, livePrompt, parseFlags, planFlags } from './fallacy.ts'
import { OPUS_SYSTEM, opusPrompt, parseDecisions, steerNote } from './orchestrator.ts'
import { graphCols, orchestratorLines, placeSide, planLines } from './side.ts'
import { missionKey, parseSummaries, SUMMARY_SYSTEM, summaryPrompt } from './review.ts'
import type { Summary } from './review.ts'
import { wrap } from './side.ts'
import { launchInfo, mergeRecords, parseRetro, parseReview, readJournal, recordLine, RETRO_SYSTEM, retroPrompt, REVIEW_SYSTEM, reviewPrompt } from './review.ts'
import { tidyLabel } from './layout.ts'
import { parsePatterns, readTeamRun, teamPath, teamPatterns, teamUser } from './team.ts'
import type { TeamRun } from './team.ts'
import { REVIEWER_ROLE, REVIEWS } from './fallacy.ts'
import { banditUpdate, callSpans, cascade, costOf, EVOLVE_SYSTEM, evolvePrompt, JUDGE_SYSTEM, judgePrompt, parseEvolution, parseJudge, replayPrompt, rng, suggestTier, tierOf } from './learn.ts'
import type { Usage } from './learn.ts'
import type { Case } from './orchestrator.ts'
import type { Expand, Geometry, Graph, SiteNode } from './layout.ts'

const PANE = 'workflow-gate'
const plan = atom({ plugin: 'workflow-gate-terminal', key: 'plan' } as const, null)
const approved = atom({ plugin: 'workflow-gate-terminal', key: 'approved' } as const, {})
const run = atom({ plugin: 'workflow-gate-terminal', key: 'run' } as const, null)
const isBandHidden = atom({ plugin: 'workflow-gate-terminal', key: 'isBandHidden' } as const, false)
const isBandOpen = atom({ plugin: 'workflow-gate-terminal', key: 'isBandOpen' } as const, false) // the band's accordion
const passOnce = atom({ plugin: 'workflow-gate-terminal', key: 'passOnce' } as const, false)
const tab = atom({ plugin: 'workflow-gate-terminal', key: 'tab' } as const, 'plan')
const selected = atom({ plugin: 'workflow-gate-terminal', key: 'selected' } as const, null)
const agentView = atom({ plugin: 'workflow-gate-terminal', key: 'agentView' } as const, null)
const timelines = atom({ plugin: 'workflow-gate-terminal', key: 'timelines' } as const, {})
const historyOpen = atom({ plugin: 'workflow-gate-terminal', key: 'historyOpen' } as const, null)
const mainFlags = atom({ plugin: 'workflow-gate-terminal', key: 'mainFlags' } as const, [])
const mainSeen = atom({ plugin: 'workflow-gate-terminal', key: 'mainSeen' } as const, 0)
const isCheckOpen = atom({ plugin: 'workflow-gate-terminal', key: 'isCheckOpen' } as const, false) // the check band's accordion
const pan = atom({ plugin: 'workflow-gate-terminal', key: 'pan' } as const, null) // the terminal canvas's pan (◀ ▶ ▲ ▼)

type FlowGraph = Omit<Graph, 'nodes'> & {
  minAgents: number
  phases: string[]
  edges: { source: string; target: string; via?: string }[]
  nodes: (SiteNode & { matchChunks?: string[]; missionSpan?: unknown; modelSpan?: unknown; modelInsert?: unknown; modelText?: string | null; agentType?: string | null; schemaKeys?: string[] | null; context?: { expr: string; kind: string; producers?: string[] }[] })[]
}

const home = async ($: EngineInterface) => (await $.env.get('HOME')) ?? ''

// ---------------------------------------------------------------- the classic gate, reused

// The installed workflow-gate's CLI: approvals go through its own `approve-path`, so the
// classic gate recomputes the same fingerprint and lets the retry through.
// WHICH copy matters. Claude Code can hold two installs of workflow-gate at once — a marketplace
// cache and a synced remote copy — at different versions, and only one of them runs the hooks. The
// fingerprint carries the plugin version, so an approval recorded against the other copy is real
// but filed under a key the gate that enforces never reads: the human approves, this mod confirms,
// the gate refuses. The copy that actually runs writes active/<session>.json at session start and
// is believed first — per session, because a desktop session runs the remote copy while a terminal
// one runs the cache copy at the same time. installed_plugins.json (any `workflow-gate@<marketplace>`
// entry, the enabled one first) is only the fallback, and reads as not installed with no registry.
async function gate($: EngineInterface): Promise<{ cli: string; version?: string } | undefined> {
  try {
    const sid = (await $.session.id()).replace(/[^a-z0-9_-]/gi, '_')
    const a = JSON.parse(await $.fs.read(`${await home($)}/.claude/workflow-gate/active/${sid}.json`))
    if (a.hook) return { cli: a.hook, version: a.version }
  } catch {}
  let plugins: Record<string, { installPath?: string }[]> = {}
  try { plugins = JSON.parse(await $.fs.read(`${await home($)}/.claude/plugins/installed_plugins.json`)).plugins ?? {} } catch {}
  // Any marketplace: `workflow-gate@<marketplace>`; the one settings.json enables wins.
  let enabled: Record<string, unknown> = {}
  try { enabled = JSON.parse(await $.fs.read(`${await home($)}/.claude/settings.json`)).enabledPlugins ?? {} } catch {}
  const keys = Object.keys(plugins).filter(k => k.startsWith('workflow-gate@'))
  const key = keys.find(k => enabled[k] === true) ?? keys[0]
  const root = key ? plugins[key]?.[0]?.installPath : undefined
  if (!root) return undefined
  const cli = `${root}/hooks/workflow-plan-gate.mjs`
  try { return { cli, version: JSON.parse(await $.fs.read(`${root}/.claude-plugin/plugin.json`)).version } } catch { return { cli } }
}

async function sha($: EngineInterface, text: string, n: number): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, n)
}

// Approved by any route the classic gate knows (browser, chat approve-path, record): same
// fingerprint as its fingerprintOf(), looked up in its own state file.
async function isApprovedByGate($: EngineInterface, scriptPath: string | undefined, content: string): Promise<boolean> {
  try {
    const g = await gate($)
    if (!g?.version) return false
    const fp = (scriptPath ? 'path:' : 'script:') + (await sha($, content + ':' + g.version, 16))
    const state = JSON.parse(await $.fs.read(`${await home($)}/.claude/workflow-plan-gate-state.json`))
    return !!state[fp]
  } catch {
    return false
  }
}

// Same override file the gate reads ("override manual approval", or night mode).
async function isOverridden($: EngineInterface): Promise<boolean> {
  try {
    const o = JSON.parse(await $.fs.read(`${await home($)}/.claude/workflow-gate-override.json`))
    const now = await $.clock.now()
    const sid = await $.session.id()
    return o.global?.until > now || o.sessions?.[sid]?.until > now
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- graph

// Parsing is the expensive part: once per (source, edits), never per redraw.
let cache: { key: string; graph: FlowGraph | null; source: string } | null = null
function graphOf(source: string, edits: Edits = {}): { graph: FlowGraph | null; source: string } {
  const key = source + '\u0000' + JSON.stringify(edits)
  if (cache?.key === key) return cache
  let graph: FlowGraph | null = null, edited = source
  try {
    const base = extractFlow(source) as FlowGraph
    edited = Object.keys(edits).length ? applyEdits(source, base.nodes, edits) : source
    graph = edited === source ? base : (extractFlow(edited) as FlowGraph)
  } catch { graph = null }
  cache = { key, graph, source: edited }
  return cache
}

let geoCache: { graph: FlowGraph; cols: number; open: string; geo: Geometry } | null = null
function geoOf(graph: FlowGraph, cols: number, expand?: Expand): Geometry {
  const open = expand ? JSON.stringify(expand) : ''
  if (geoCache?.graph === graph && geoCache.cols === cols && geoCache.open === open) return geoCache.geo
  geoCache = { graph, cols, open, geo: layout(graph, cols, expand) }
  return geoCache.geo
}

const modelOf = (g: FlowGraph, id: string) => g.nodes.find(n => n.id === id)?.model ?? 'inherited'
const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const ROWS_ABOVE_CANVAS = 2 // the tabs row and the plan's header line
// The pane rows in view, in canvas rows: the Client canvas draws only those (and a margin).
const winOf = (e: { props: { scroll?: { offset: number; bodyRows: number } } }) =>
  e.props.scroll ? { from: Math.max(0, e.props.scroll.offset - ROWS_ABOVE_CANVAS), rows: e.props.scroll.bodyRows } : undefined
const tierMixOf = (g: FlowGraph | null, p: Plan) => {
  const n: Record<string, number> = {}
  if (g) g.nodes.forEach(x => { n[x.model ?? 'inherited'] = (n[x.model ?? 'inherited'] ?? 0) + 1 })
  else p.sites.forEach((s, i) => { const m = p.models[i] ?? s.model ?? 'inherited'; n[m] = (n[m] ?? 0) + 1 })
  return Object.entries(n).map(([m, k]) => `${k} ${m}`).join(' · ')
}

// Which call site launched this agent: the one whose literal chunks its prompt contains. Shared or
// missing literals fall back to arrival order and say so; a guess must never look like a fact.
export function placeAgent(g: FlowGraph, prompt: string, taken: Record<string, number>): { cardId?: string; isGuess: boolean } {
  const hits = g.nodes.filter(n => (n.matchChunks ?? []).filter(c => c.length >= 24).some(c => prompt.includes(c)))
  if (hits.length === 1) return { cardId: hits[0]!.id, isGuess: false }
  const pool = hits.length ? hits : g.nodes
  const pick = pool.find(n => (taken[n.id] ?? 0) < (n.fanOut ? Infinity : 1)) ?? pool[0]
  return { cardId: pick?.id, isGuess: true }
}

// Typical model requests per agent for each card, from the costed runs on this machine: the median
// `turns` of past agents whose label starts with the card's static label. None found: no entry.
export function expectedSteps(g: FlowGraph, past: { agents?: { label?: string; turns?: number }[] }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const n of g.nodes) {
    const stem = n.label.split(/[⟨:'"`$ ]/)[0]!.toLowerCase()
    if (stem.length < 3) continue
    const turns = past.flatMap(r => r.agents ?? []).filter(a => a.label?.toLowerCase().startsWith(stem) && a.turns).map(a => a.turns!).sort((a, b) => a - b)
    if (turns.length) out[n.id] = turns[Math.floor(turns.length / 2)]!
  }
  return out
}

// One agent's bar: done is full, running creeps toward its typical step count but never claims done.
export function agentProgress(a: LiveAgent, expected: number | undefined): { progress: number; isEstimate: boolean } {
  if (a.status !== 'running') return { progress: 1, isEstimate: false }
  return { progress: Math.min(0.95, (a.steps ?? 0) / (expected ?? 8)), isEstimate: true }
}


const mmss = (ms: number) => `${Math.floor(ms / 60000)}m${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}s`

// ---------------------------------------------------------------- the human's buttons

async function approve($: EngineInterface) {
  const p = await read($, plan)
  const g = await gate($)
  // One toast for three different dead ends left the human sure they had approved while the agent
  // waited for a path that never came. Each says what to do instead.
  if (!p) return $.ui.toast('workflow-gate: this session holds no plan any more (a plugin reload empties it) — ask Claude to retry the Workflow call')
  if (p.status !== 'pending') return $.ui.toast(`workflow-gate: this plan is already ${p.status} — nothing left to approve`)
  if (!g) return $.ui.toast('workflow-gate: the workflow-gate plugin was not found — use Browser editor instead')
  const flow = graphOf(p.source, p.edits)
  const source = flow.graph ? flow.source : splice(p.source, p.sites, p.models)
  const path = `${await home($)}/.claude/workflow-gate/terminal/gate-${await sha($, source, 12)}.mjs`
  await $.fs.write(path, source)
  const summary = `approved in terminal: ${p.name}, ${tierMixOf(flow.graph, p)}`
  const res = await $.process.run(['node', g.cli, 'approve-path', '--path', path, '--summary', summary])
  if (res.exitCode !== 0) return $.ui.toast(`workflow-gate: approval NOT recorded — ${res.stderr.slice(0, 120)}`)
  await update($, approved, a => ({ ...a, [path]: source }))
  await update($, plan, x => (x ? { ...x, status: 'approved' as const, path } : x))
  await update($, tab, () => 'live' as const)
  await update($, selected, () => null) // the plan's first card was picked for review: Live follows the running one
  const edited = source !== p.source ? ' The human EDITED the plan in the terminal: the file differs from your draft, re-read it.' : ''
  await $.prompt.submit({ text: `[workflow-gate] Plan "${p.name}" approved in the terminal.${edited} Run Workflow now with { scriptPath: ${JSON.stringify(path)} } — not inline.` })
}

// The full graph editor: let the next Workflow call through to the classic gate, which opens it.
async function browser($: EngineInterface) {
  await update($, passOnce, () => true)
  await update($, plan, x => (x ? { ...x, status: 'cancelled' as const } : x))
  await $.prompt.submit({ text: '[workflow-gate] The human wants the browser editor: retry the same Workflow call once, unchanged.' })
}

async function cancel($: EngineInterface) {
  await update($, plan, x => (x ? { ...x, status: 'cancelled' as const } : x))
  $.ui.toast('Workflow plan cancelled. Tell Claude what to change.')
}

// A tier or mission edit, checked by the ported withModel/applyEdits: the spliced script must parse.
async function setModel($: EngineInterface, id: string, tier: string) {
  const p = await read($, plan)
  if (!p) return
  const g = graphOf(p.source).graph
  if (!g) return
  const res = withModel(p.source, g.nodes, p.edits ?? {}, id, tier) as { edits?: Edits; error?: string }
  if (res.error) return $.ui.toast(`Not applied: ${res.error}`)
  await update($, plan, x => x && { ...x, edits: res.edits! })
}

async function setMission($: EngineInterface, id: string, text: string) {
  const p = await read($, plan)
  if (!p) return
  const edits = { ...p.edits, [id]: { ...p.edits?.[id], mission: text } }
  try { extractFlow(applyEdits(p.source, (graphOf(p.source).graph as FlowGraph).nodes, edits)) } catch (err) { return $.ui.toast(`Not applied: the script would not parse (${String(err).slice(0, 80)})`) }
  await update($, plan, x => x && { ...x, edits })
}

async function openPane($: EngineInterface, to?: Tab) {
  if (to) await update($, tab, () => to)
  return $.ui.open({ id: PANE, title: 'Workflow gate' })
}

// ---------------------------------------------------------------- live fallacy check

// What each agent (a run's, or `main` for this session's own loop) has written or thought since
// its last check, waiting for the checker.
const pending = new Map<string, string>()
const MIN_CHARS = 500 // a run agent's batch; ponytail: fixed sizes, tune if checks feel late or noisy
const MIN_MAIN = 1500 // the main loop runs all day: bigger batches, fewer calls
const MAX_MAIN_PER_TURN = 3
let isChecking = false
let mainMission = ''
let lastHumanAt = -Infinity // the person's last prompt: the notification rule reads it
let records: Record<string, LabelRecord> = {} // per-label track record, from $.store at session start

// A card's name as people read it: 'build:' + s.k → build:⟨s.k⟩.
const cardLabel = (n: { label: string; labelDynamic?: boolean }) => (n.labelDynamic ? tidyLabel(n.label) : n.label)

// A phone notification when the person is away (no prompt for 2 min), or always when `always`.
async function notify($: EngineInterface, message: string, always = false) {
  if (!always && (await $.clock.now()) - lastHumanAt < 120000) return
  await $.tool.call({ tool: 'PushNotification', message: message.slice(0, 190), status: 'proactive' }).catch(() => undefined)
}
let mainChecks = 0
let lastToast = -Infinity

async function nightOf($: EngineInterface): Promise<{ isOn?: boolean; level?: string } | undefined> {
  try {
    return (await ($.state.get as (ref: unknown) => Promise<{ value?: { isOn?: boolean; level?: string } }>)({ plugin: 'night-mode', key: 'night' })).value
  } catch {
    return undefined
  }
}

// Night mode at reduce or stop: the main-loop check pauses (its spend counts against the same limit).
const isFrugal = async ($: EngineInterface) => { const n = await nightOf($); return !!n?.isOn && n.level !== 'normal' }

async function toastOnce($: EngineInterface, text: string) {
  const now = await $.clock.now()
  if (now - lastToast < 20000) return // parallel agents: one toast per 20 s, the rest is in the pane
  lastToast = now
  $.ui.toast(text)
}

// One pass: the agent with the most unread text gets read by haiku; its flags land on its card,
// or, for the main loop, in the band above the prompt.
async function checkOne($: EngineInterface) {
  if (isChecking) return
  const r = await read($, run)
  const isRunning = (id: string) => (id === 'main' ? false : !!r?.agents.some(a => a.id === id && a.status === 'running'))
  // Ready: enough new text, or the agent finished (its last words are read whatever their length).
  const ready = [...pending.entries()].filter(([id, t]) => {
    if (id === 'main') return t.length >= MIN_MAIN && mainChecks < MAX_MAIN_PER_TURN
    return !!r && (t.length >= MIN_CHARS || !isRunning(id))
  })
  const [key, text] = ready.sort((a, b) => b[1].length - a[1].length)[0] ?? []
  if (!key) return
  pending.delete(key)
  if (!text?.trim()) return
  const isMain = key === 'main'
  if (isMain && (await isFrugal($))) return
  const agent = isMain ? undefined : r?.agents.find(a => a.id === key)
  const g = !isMain && r?.source ? graphOf(r.source).graph : null
  const node = g?.nodes.find(n => n.id === agent?.cardId)
  const mission = isMain ? mainMission : node?.assembled || node?.mission || agent?.label || ''
  isChecking = true
  try {
    if (isMain) mainChecks++
    else await update($, run, x => x && { ...x, checks: (x.checks ?? 0) + 1 })
    const res = await $.model.complete({ model: 'haiku', system: LIVE_SYSTEM, prompt: livePrompt(mission + (agent && effRecords()[agent.label] ? `\n\nTRACK RECORD OF THIS LABEL: ${recordLine(effRecords()[agent.label]!)} — weigh your flags by it.` : ''), text.slice(-2500)), maxTokens: 400, timeoutMs: 30000 })
    if (!res.isAnswered) return
    const at = await $.clock.now()
    const prior = isMain ? await read($, mainFlags) : r?.flags ?? []
    const seen = new Set(prior.map(f => f.quote))
    const who = isMain ? 'Claude' : agent?.label ?? 'agent'
    const fresh: Flag[] = parseFlags(res.text).filter(f => !f.quote || !seen.has(f.quote)).map(f => ({ ...f, cardId: isMain ? 'main' : agent?.cardId ?? '', agent: who, agentId: isMain ? undefined : key, at }))
    if (!fresh.length) return
    // A low-stakes flag is shown but never costs an Opus read: decided here.
    for (const f of fresh) if (f.severity === 'low') f.decision = { action: 'ignore', why: 'low stakes: shown, not sent to Opus' }
    if (isMain) await update($, mainFlags, x => [...x, ...fresh].slice(-30))
    else {
      await update($, run, x => x && { ...x, flags: [...(x.flags ?? []), ...fresh].slice(-100) })
      for (const f of fresh) await log($, key, 'flag', `${f.kind}${f.quote ? ` “${f.quote}”` : ''} — ${f.why}`)
      excerpts.set(key, text.slice(-2500))
    }
    await toastOnce($, `⚠ ${who}: ${fresh[0]!.kind} — ${fresh[0]!.why}`)
  } finally {
    isChecking = false
  }
}

// ---------------------------------------------------------------- the Opus orchestrator

// Opus's queue is the run's own flags with no decision yet: state, so a reload loses nothing.
// Only the agents' latest words live here (lost on reload: Opus then reads the quotes alone).
const excerpts = new Map<string, string>()
const notes = new Map<string, string[]>() // steers waiting for the agent's next tool result
const OPUS_EVERY_MS = 10000 // batch flags: one Opus read per 10 s at most (only high-stakes flags reach it); no cap per run
let lastOpus = -Infinity
let isOrchestrating = false

async function orchestrate($: EngineInterface) {
  if (isOrchestrating) return
  const r = await read($, run)
  const now = await $.clock.now()
  if (!r || now - lastOpus < OPUS_EVERY_MS) return
  const waiting = (r.flags ?? []).filter(f => f.agentId && !f.decision && !f.sentAt)
  if (!waiting.length) return
  // One case per flagged agent; finished agents go too: their output may feed agents still running.
  const g0 = r.source ? graphOf(r.source).graph : null
  const cases: Case[] = [...new Set(waiting.map(f => f.agentId!))].map(id => {
    const a = r.agents.find(x => x.id === id)
    const node = g0?.nodes.find(n => n.id === a?.cardId)
    return { agentId: id, label: a?.label ?? id, mission: node?.assembled || node?.mission || a?.label || '', excerpt: excerpts.get(id) ?? '', flags: waiting.filter(f => f.agentId === id), isRunning: a?.status === 'running' }
  })
  isOrchestrating = true
  lastOpus = now
    await update($, run, x => x && { ...x, opusCalls: (x.opusCalls ?? 0) + 1, flags: (x.flags ?? []).map(f => (f.agentId && !f.decision && !f.sentAt && waiting.some(w => w.at === f.at && w.quote === f.quote) ? { ...f, sentAt: now } : f)) })
  try {
    const g = r.source ? graphOf(r.source).graph : null
    const cards = (g?.nodes ?? []).map(n => {
      const mine = r.agents.filter(a => a.cardId === n.id)
      return { label: n.label, model: n.model ?? 'inherited', state: !mine.length ? 'pending' : mine.some(a => a.status === 'running') ? 'running' : 'done' }
    })
    const running = r.agents.filter(a => a.status === 'running' && a.id).map(a => ({ id: a.id!, label: a.label }))
    const res = await $.model.complete({ model: 'opus', system: OPUS_SYSTEM, prompt: opusPrompt({ name: r.name, cards, decided: r.decisions ?? [], running }, cases), maxTokens: 1200, timeoutMs: 90000 })
    if (!res.isAnswered) {
      const why = res.reason === 'api-error' ? `api-error ${res.status ?? ''} ${res.error ?? ''}`.trim() : res.reason
      // Back in the queue for the next pass (the budget still counts the attempt).
      await update($, run, x => x && { ...x, opusError: `Opus did not answer (${why})`, flags: (x.flags ?? []).map(f => (f.sentAt === now && !f.decision ? { ...f, sentAt: undefined } : f)) })
      return
    }
    const at = await $.clock.now()
    const labelOf = (id: string) => r.agents.find(a => a.id === id)?.label ?? id
    const made: Decision[] = parseDecisions(res.text, cases.map(c => c.agentId), running.map(a => a.id)).map(d => ({ ...d, at, agent: labelOf(d.agentId) }))
    // A steer reaches only a running agent; one aimed at a finished agent is recorded as too late.
    const live = new Set(running.map(a => a.id))
    // Steers wait in the run's decisions (isDelivered false) for the agent's next tool call: a reload keeps them.
    const onFlag = (d: Decision): FlagDecision => ({
      action: d.action === 'steer' && !live.has(d.agentId) ? 'too-late' : d.action,
      message: d.message, why: d.why, target: d.agentId !== d.about ? d.agent : undefined,
    })
    await update($, run, x => x && {
      ...x,
      decisions: [...(x.decisions ?? []), ...made].slice(-50),
      opusError: undefined,
      // A case Opus left out is a decision too: nothing to do about it.
      flags: (x.flags ?? []).map(f => {
        if (f.decision || f.sentAt !== now) return f
        const d = made.find(m => m.about === f.agentId)
        return { ...f, decision: d ? onFlag(d) : { action: 'ignore' as const, why: 'Opus saw no need to act' } }
      }),
    })
    const loud = made.find(d => d.action === 'ask_human' || d.action === 'stop_run')
    // Opus's advice is applied, not proposed: a stop is carried out day and night. A question
    // goes to the person by day and waits for the morning at night.
    if (loud?.action === 'stop_run') { await notify($, `🧭 Opus stopped «${r.name}»: ${loud.message ?? loud.why}`, true); return void (await stopRun($)) }
    if (loud && !(await nightOf($))?.isOn) void askHuman($, loud).catch(() => undefined) // the dialog waits for the person, not this pass
    else if (made.some(d => d.action === 'steer')) await toastOnce($, `🧭 Opus steered ${made.filter(d => d.action === 'steer').map(d => d.agent).join(', ')}`)
  } finally {
    isOrchestrating = false
  }
}

// Corrections that missed their agent (it finished before its next tool call, or before Opus
// answered) are not dropped: once nothing of the run is running, the main session gets them, to
// check and redo what those agents returned.
export function lateSteers(r: Pick<Run, 'decisions' | 'agents'>): Decision[] {
  const running = new Set(r.agents.filter(a => a.status === 'running').map(a => a.id))
  return (r.decisions ?? []).filter(d => d.action === 'steer' && d.message && !d.isDelivered && !running.has(d.agentId))
}
// A run is over when its background task reported back, or, without that notice, when no agent
// has run for 2 min: a sequential workflow has gaps between agents shorter than that.
export const QUIET_END_MS = 120000
export function isRunOver(r: Pick<Run, 'agents' | 'endedAt'>, now: number): boolean {
  if (r.endedAt !== undefined) return true
  if (!r.agents.length || r.agents.some(a => a.status === 'running')) return false
  return now - Math.max(...r.agents.map(a => a.endedAt ?? a.startedAt)) >= QUIET_END_MS
}
async function handLate($: EngineInterface) {
  const r = await read($, run)
  if (!r || r.lateSent || !isRunOver(r, await $.clock.now())) return
  const late = lateSteers(r)
  if (!late.length) return
  const text = `[workflow-gate] During run "${r.name}", Opus corrected ${late.length === 1 ? 'an agent' : `${late.length} agents`} after ${late.length === 1 ? 'it' : 'they'} had finished, so the correction never reached ${late.length === 1 ? 'it' : 'them'}:\n${late.map(d => `- ${d.agent}: ${d.message}`).join('\n')}\nCheck whether what ${late.length === 1 ? 'that agent' : 'those agents'} returned carries this fault, and fix or redo it before relying on the run.`
  // Refused while a turn runs: the next tick tries again.
  const sent = await $.prompt.submit({ text }).then(() => true, () => false)
  if (sent) await update($, run, x => x && { ...x, lateSent: true })
}

// Opus needs the person: the engine's own AskUserQuestion dialog. Stop and Let it run are always
// offered; another choice, or text typed under Other, goes to the agent Opus named if it is still
// running, else to the main session (Claude) to act on.
async function askHuman($: EngineInterface, d: Decision) {
  const r = await read($, run)
  const question = d.action === 'stop_run'
    ? `Opus proposes stopping "${r?.name ?? 'the run'}": ${d.message ?? d.why} Stop it?`
    : `${d.message ?? d.why}`.replace(/\??\s*$/, '?')
  const options = [...(d.options ?? []), 'Let it run', 'Stop run'].slice(-4)
  await notify($, `🧭 Opus needs you (${d.agent}): ${question}`, true)
  const answer = await $.ui.ask(`🧭 ${d.agent}: ${question}`, { header: 'Opus', options })
  await update($, run, x => x && { ...x, decisions: (x.decisions ?? []).map(y => (y.at === d.at && y.agentId === d.agentId ? { ...y, isAnswered: true, answer } : y)) })
  if (answer === 'Stop run') return stopRun($)
  if (answer === 'Let it run') return
  const now = await read($, run)
  if (now?.agents.some(a => a.id === d.agentId && a.status === 'running')) {
    notes.set(d.agentId, [...(notes.get(d.agentId) ?? []), steerNote(`The human answered the orchestrator's question "${question}": ${answer}`)])
    $.ui.toast(`🧭 Sent to ${d.agent}: ${answer}`)
  } else {
    await $.prompt.submit({ text: `[workflow-gate] During run "${now?.name}", Opus asked about ${d.agent}: ${question}\nThe human answered: ${answer}\nThat agent has finished: act on the answer (re-run or fix what it produced).` })
  }
}

// ---------------------------------------------------------------- Opus before and after the run

let isReviewing = false
// The plan waiting for approval gets one Opus read: missions, tiers, structure. Its fixes are
// applied as soon as it answers (the person still approves by day); `extra` adds night rules.
let isNightPrep = false // a night plan is being prepared: only its own review (with the night rules) may run
async function reviewPlan($: EngineInterface, extra = '') {
  if (isNightPrep && !extra) return
  const p = await read($, plan)
  if (isReviewing || !p || p.status !== 'pending' || p.review?.status !== 'pending') return
  const g = graphOf(p.source, p.edits).graph
  isReviewing = true
  try {
    const cards = (g?.nodes ?? []).map(n => ({ label: cardLabel(n), model: n.model ?? 'inherited', mission: n.assembled || n.mission || '' }))
    const flags = g ? planFlags(g as never, graphOf(p.source, p.edits).source) : []
    const res = await $.model.complete({ model: 'opus', system: REVIEW_SYSTEM, prompt: reviewPrompt(graphOf(p.source, p.edits).source, cards, flags, effRecords(), teamLessons.slice(0, 15).map(x => `[${x.topic}] ${x.lesson}${x.when ? ` (when ${x.when})` : ''}`)) + extra, maxTokens: 1200, timeoutMs: 120000 })
    const parsed = res.isAnswered ? parseReview(res.text) : undefined
    const review = parsed ? { status: 'done' as const, ...parsed } : { status: 'error' as const, error: res.isAnswered ? 'unreadable answer' : res.reason }
    await update($, plan, x => (x && x.source === p.source ? { ...x, review } : x))
    const applied = await applyAllFixes($)
    if (parsed?.verdict === 'concerns' && !(await nightOf($))?.isOn) await notify($, `⛔ Workflow «${p.name}» waits for you · Opus: ${applied ? `${applied} fix${applied > 1 ? 'es' : ''} applied` : parsed.items?.[0]?.issue ?? 'concerns'}`)
  } finally {
    isReviewing = false
  }
}

// The run's journal, re-read only when another agent has finished.
let journalCache: { path: string; done: number; agents: ReturnType<typeof readJournal> } | null = null
async function journalOf($: EngineInterface, r: Run) {
  if (!r.journal) return new Map() as ReturnType<typeof readJournal>
  const done = r.agents.filter(a => a.status !== 'running').length
  if (journalCache?.path !== r.journal || journalCache.done !== done) {
    journalCache = { path: r.journal, done, agents: readJournal(await $.fs.read(r.journal).catch(() => '')) }
  }
  return journalCache.agents
}

// ---------------------------------------------------------------- what each agent is doing

const liveIds = new Set<string>() // the run's agents this module has seen spawn

// Is this one of the run's running agents? The set is the module's and empties when the mod reloads
// mid-run: the run's own state, which survives, fills it back.
async function isTracked($: EngineInterface, id: string | undefined): Promise<boolean> {
  if (!id) return false
  if (liveIds.has(id)) return true
  const r = await read($, run)
  if (!r?.agents.some(a => a.id === id && a.status === 'running')) return false
  liveIds.add(id)
  return true
}

// One readable line for a tool call: its own description when it has one, else its main argument.
export function describeCall(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  // A command without a description: drop the `cd <dir> &&` preamble and shorten home paths.
  const command = s('command').replace(/^\s*cd\s+\S+\s*&&\s*/, '').replace(/\/(?:Users|home)\/[^/\s]+/g, '~')
  const detail = s('description') || s('file_path').replace(/\/(?:Users|home)\/[^/\s]+/g, '~') || s('pattern') || s('query') || s('url') || s('skill') || s('prompt') || command
  return (detail ? `${tool}: ${detail.split('\n')[0]}` : tool).slice(0, 90)
}

// An agent's result as lines a person reads: JSON as `key: value` and bullets, text as it is.
export function prettyResult(result: string, max = 40): string[] {
  let v: unknown
  try { v = JSON.parse(result) } catch { return result.split('\n').slice(0, max) }
  const out: string[] = []
  const show = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x))
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(x)) { out.push(`${k}:`); for (const it of x.slice(0, 10)) out.push(`  • ${show(it).slice(0, 200)}`); if (x.length > 10) out.push(`  … ${x.length - 10} more`) }
      else out.push(`${k}: ${show(x).slice(0, 200)}`)
    }
  } else if (Array.isArray(v)) for (const it of v.slice(0, max)) out.push(`• ${show(it).slice(0, 200)}`)
  else out.push(show(v))
  return out.slice(0, max)
}

// The latest sentence of a stream of thinking or text, so the card reads like a ticker.
export function lastSentence(text: string): string {
  const parts = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?:])\s/)
  return (parts.filter(p => p.length > 2).at(-1) ?? '').slice(-240)
}

// One entry on an agent's timeline (kept in state, so a reload loses nothing).
async function log($: EngineInterface, agentId: string, kind: TimelineEntry['kind'], text: string, ok?: boolean) {
  const at = await $.clock.now()
  await update($, timelines, all => ({ ...all, [agentId]: [...(all[agentId] ?? []), { at, kind, text: text.slice(0, 1500), ok }].slice(-300) }))
}
const stepText = new Map<string, { thinking: string; text: string }>() // this request's words, per agent

const thoughts = new Map<string, { text: string; kind: 'thinking' | 'text'; pushedAt: number }>()

// ---------------------------------------------------------------- the team's learnings

// Lessons about designing workflows, never about a project: one JSON file per run on a git branch
// (teamHistoryRemote @ teamHistoryBranch), cloned under ~/.claude. `read` pulls everyone's;
// `share` also commits and pushes this machine's. Retros, track records, the bandit and rewritten
// missions are about a project and stay local. Set in /config: teamHistory, teamHistoryRemote/Branch.
let team = { mode: 'read' as 'off' | 'read' | 'share', remote: '', branch: '', dir: '', user: '' }
let teamRuns: TeamRun[] = []
let teamLessons: ReturnType<typeof teamPatterns> = []
let isSyncing = false

const git = ($: EngineInterface, ...args: string[]) => $.process.run(['git', '-C', team.dir, ...args], { timeoutMs: 60000 })

// Track records and the bandit are about this machine's projects: local only.
const effRecords = () => records
const effBandit = () => bandit

// Clone (or start) the branch once, pull, push what is waiting, and read every run file.
async function teamSync($: EngineInterface) {
  if (team.mode === 'off' || isSyncing) return
  isSyncing = true
  try {
    const home = (await $.env.get('HOME')) ?? ''
    team.dir ||= `${home}/.claude/workflow-gate-team-history`
    if (!team.user) {
      const email = (await $.process.run(['git', 'config', 'user.email']).catch(() => ({ stdout: '' }))).stdout
      team.user = teamUser(email, (await $.env.get('USER')) ?? '')
    }
    if (!(await $.fs.exists(`${team.dir}/.git`))) {
      const cloned = await $.process.run(['git', 'clone', '--quiet', '--single-branch', '--branch', team.branch, team.remote, team.dir], { timeoutMs: 120000 })
      if (cloned.exitCode !== 0) {
        if (team.mode !== 'share') return // nothing to read yet; only a sharer starts the branch
        await $.process.run(['git', 'init', '--quiet', team.dir])
        await git($, 'checkout', '--quiet', '--orphan', team.branch)
        await git($, 'remote', 'add', 'origin', team.remote)
      }
    } else {
      await git($, 'pull', '--quiet', '--rebase', 'origin', team.branch)
    }
    if (team.mode === 'share') await git($, 'push', '--quiet', 'origin', `HEAD:${team.branch}`) // anything committed while offline
    const runs: TeamRun[] = []
    for (const who of (await $.fs.list(team.dir).catch(() => [])).filter(x => x.kind === 'dir' && !x.name.startsWith('.'))) {
      for (const f of (await $.fs.list(`${team.dir}/${who.name}`).catch(() => [])).filter(x => x.kind === 'file' && x.name.endsWith('.json'))) {
        const run = readTeamRun(await $.fs.read(`${team.dir}/${who.name}/${f.name}`).catch(() => ''))
        if (run) runs.push(run)
      }
    }
    teamRuns = runs
    teamLessons = teamPatterns(runs)
  } finally {
    isSyncing = false
  }
}

// After a retro, when sharing: the run's learnings as one file, committed and pushed.
async function teamPublish($: EngineInterface, run: TeamRun) {
  if (team.mode !== 'share' || !team.dir || !run.patterns.length) return // nothing general learned: nothing to share
  const path = teamPath(run)
  await $.fs.write(`${team.dir}/${path}`, JSON.stringify(run, null, 2) + '\n')
  await git($, 'add', path)
  const done = await git($, 'commit', '--quiet', '-m', `chore(workflow-history): ${run.patterns.length} workflow-design lesson${run.patterns.length > 1 ? "s" : ""} from ${run.user}`)
  if (done.exitCode !== 0) return
  let pushed = await git($, 'push', '--quiet', 'origin', `HEAD:${team.branch}`)
  if (pushed.exitCode !== 0) { // someone pushed first: replay ours on theirs, once
    await git($, 'pull', '--quiet', '--rebase', 'origin', team.branch)
    pushed = await git($, 'push', '--quiet', 'origin', `HEAD:${team.branch}`)
  }
  if (pushed.exitCode !== 0) $.ui.toast('Team history: committed locally, push failed — retried at next session start.')
  teamRuns = [...teamRuns.filter(x => x.id !== run.id), run]
  teamLessons = teamPatterns(teamRuns)
}

// ---------------------------------------------------------------- the canvases' memory

// The Svg canvas's motion memory (kit/motion's `move` per key), for the tab and run or plan it was drawn for.
// ponytail: module state for one pane, written at draw time without an atom (an atom written from the draw redraws it).
let svgMotion: { key: string; m: Motion } | null = null
function svgOf(p: FlowSvg, key: string, now: number): string {
  const m = remember(svgMotion?.key === key ? svgMotion.m : undefined, snapshot(p), now)
  svgMotion = { key, m }
  return flowSvg(p, m, now)
}

// The terminal canvas: the scene last drawn and the one blit loop that animates it in Live (particles,
// glint, worker pips), stopped when nothing moves or the Raster is gone (another tab, the pane closed).
// ponytail: module state for one pane, like svgMotion.
let rasterScene: Scene | null = null
let blitLoop: ReturnType<typeof loop> | null = null
let blitFrom = 0 // the frame number the loop's first blit stands for: frames count on the clock, so a redraw and a blit agree
export const FRAME_MS = 66 // 15 fps: what lot 0 measured an 80×24 Raster holds on the terminal
// ponytail: the blitted window stays at most 30 rows. Measured on a real terminal (16/10, this wiring): 12 fps at 80×24, 14 at 110×30,
// 14 at 200×30, no blit refused; past 30 rows is unmeasured, raise it after measuring.
const LIVE_ROWS = 30

// A fan-out's agents, one pip (terminal) or square (Svg) each, waiting ones included.
function workersOf(g: FlowGraph | null, r: Run): Record<string, Worker[]> {
  return Object.fromEntries((g?.nodes ?? []).filter(n => n.fanOut).map(n => {
    const mine = r.agents.filter(a => a.cardId === n.id).map((a): Worker => (a.status === 'running' ? 'run' : a.status === 'done' ? 'ok' : 'fail'))
    return [n.id, [...mine, ...Array<Worker>(Math.max(0, (n.fanOut?.n ?? 0) - mine.length)).fill('wait')]]
  }))
}

// ---------------------------------------------------------------- readable descriptions

const summaries = new Map<string, Summary>() // by missionKey; also kept in $.store across sessions
let isSummarizing = false

const missionOf = (n: { assembled?: string; mission?: string }) => (n.assembled || n.mission || '').replace(/\\n/g, '\n')

// One haiku call describes every card of the plan (or run) on screen that has no description yet.
async function summarize($: EngineInterface) {
  if (isSummarizing) return
  const [p, r] = [await read($, plan), await read($, run)]
  const source = p?.status === 'pending' ? graphOf(p.source, p.edits).source : r?.source
  const g = source ? graphOf(source).graph : null
  if (!g) return
  const missing: { id: string; label: string; mission: string; key: string }[] = []
  for (const n of g.nodes) {
    const key = missionKey(cardLabel(n), missionOf(n))
    if (summaries.has(key)) continue
    const kept = (await $.store.get(`summary:${key}`).catch(() => undefined)) as Summary | undefined
    if (kept) summaries.set(key, kept)
    else missing.push({ id: n.id, label: cardLabel(n), mission: missionOf(n), key })
  }
  if (!missing.length) return
  isSummarizing = true
  try {
    const batch = missing.slice(0, 12)
    const res = await $.model.complete({ model: 'haiku', system: SUMMARY_SYSTEM, prompt: summaryPrompt(batch), maxTokens: 1500, timeoutMs: 60000 })
    const got = res.isAnswered ? parseSummaries(res.text, batch.map(b => b.id)) : {}
    for (const b of batch) {
      const s = got[b.id]
      if (!s) continue
      summaries.set(b.key, s)
      await $.store.set(`summary:${b.key}`, s)
    }
    if (Object.keys(got).length) await update($, selected, x => x) // redraw the open card
  } finally {
    isSummarizing = false
  }
}

// The open card's inside: what it is for, in plain words, then (in Live) what it is doing now.
function expandFor(n: FlowGraph['nodes'][number], w: number, agents: LiveAgent[] = []): Expand {
  const inner = w - 4
  const s = summaries.get(missionKey(cardLabel(n), missionOf(n)))
  const body: Expand['body'] = []
  const put = (text: string, c?: string, b?: boolean) => body.push(...wrap(text, inner).map(t => ({ t, c, b })))
  if (s) {
    put(`🎯 ${s.goal}`, '#e6e6e6', true)
    put(`⚙ ${s.does}`, '#abb2bf')
    put(`📦 ${s.delivers}`, '#98c379')
  } else {
    put('⧗ describing this step…', '#56b6c2')
    put(missionOf(n).replace(/\s+/g, ' ').split(/(?<=[.!?])\s/).slice(0, 2).join(' ').slice(0, 300), '#7f848e')
  }
  const now = agents.find(a => a.status === 'running')
  if (now) {
    body.push({ t: '' })
    put(`● now: ${now.doing ?? (now.thought ? 'thinking' : 'starting')}`, '#e5c07b', true)
    if (now.thought) put(now.thought, '#9da5b4')
  }
  return { id: n.id, w, body: body.slice(0, 16) }
}

// ---------------------------------------------------------------- learning

let bandit: BanditStats = {} // per label, per tier: what retros said, from $.store at session start
const lastPrompts = new Map<string, string>() // a run agent's real prompt: a replay's input
const replays = new Map<string, string>() // a replay agent's id → its proposal's store key

const isChecker = (n: { label: string; mission?: string; assembled?: string }) =>
  REVIEWS.test(n.label) || REVIEWER_ROLE.test((n.assembled || n.mission || '').slice(0, 300))

// The bandit's tier per card, for cards with a model slot that are not checkers (a verifier is never
// made cheaper than what it checks). Seeded by the script, so a plan shows one stable suggestion.
async function tierSuggestions($: EngineInterface, source: string, edits: Edits) {
  const g = graphOf(source, edits).graph
  const out: NonNullable<Plan['tiers']> = {}
  if (!g) return out
  let seed = 0
  for (const ch of source) seed = (seed * 31 + ch.charCodeAt(0)) | 0
  const r = rng(seed)
  for (const n of g.nodes) {
    if (isChecker(n) || !(n.modelSpan || n.modelInsert)) continue
    const s = suggestTier(effBandit(), cardLabel(n), tierOf(n.model ?? ''), r)
    if (s) out[n.id] = s
  }
  return out
}

// Mission rewrites waiting for this workflow, kept per label across sessions.
async function proposalsFor($: EngineInterface, workflow: string): Promise<Record<string, MissionProposal>> {
  const out: Record<string, MissionProposal> = {}
  const keys = ((await $.store.keys().catch(() => [])) as string[]).filter(k => k.startsWith(`mission:${workflow}:`))
  for (const k of keys) { const v = (await $.store.get(k).catch(() => undefined)) as MissionProposal | undefined; if (v) out[v.label] = v }
  return out
}

async function applyTiers($: EngineInterface) {
  const p = await read($, plan)
  if (!p?.tiers) return
  for (const [id, s] of Object.entries(p.tiers)) await setModel($, id, s.tier)
  await update($, plan, x => x && { ...x, tiers: {} })
}

// One of Opus's review fixes, by its index: a tier, a mission addition, or a cascade.
async function applyFix($: EngineInterface, i: number) {
  const p = await read($, plan)
  const item = p?.review?.items?.[i]
  const g = p && graphOf(p.source, p.edits).graph
  const node = g?.nodes.find(n => cardLabel(n) === item?.card || n.label === item?.card)
  if (!p || !item?.patch || !g || !node) return $.ui.toast('workflow-gate: that fix names no card of this plan')
  if (item.patch.model) await setModel($, node.id, item.patch.model)
  if (item.patch.missionAppend && node.missionSpan) await setMission($, node.id, `${(p.edits?.[node.id]?.mission ?? node.mission ?? '').trimEnd()} ${item.patch.missionAppend}`)
  if (item.patch.cascade) await applyCascade($, node.id)
  await update($, plan, x => x && x.review ? { ...x, review: { ...x.review, items: x.review.items?.map((it, k) => (k === i ? { ...it, patch: undefined, fix: `✓ applied · ${it.fix ?? ''}` } : it)) } } : x)
}

// Wraps a card in the cascade (cheap try → judge → escalate): edits so far are baked into the source.
async function applyCascade($: EngineInterface, id: string) {
  const p = await read($, plan)
  if (!p) return
  const cur = graphOf(p.source, p.edits)
  const node = cur.graph?.nodes.find(n => n.id === id)
  try {
    // The graph numbers workflow() calls too; the cascade counts agent() calls only: match by place.
    const at = node?.missionSpan as [number, number] | null | undefined
    const index = at ? innermostCall(callSpans(cur.source), at) : -1
    if (index < 0) throw new Error('no agent() call for this card')
    const source = cascade(cur.source, index)
    if (!graphOf(source).graph) throw new Error('the rewritten script does not parse')
    await update($, plan, x => x && { ...x, source, edits: {}, tiers: {} })
  } catch (err) {
    $.ui.toast(`Cascade not applied: ${String(err).slice(0, 100)}`)
  }
}

// The agent() call a mission sits in: the smallest span holding it (an agent() nested in another's
// arguments is held by both, and the outer one comes first).
export function innermostCall(spans: { start: number; end: number }[], at: [number, number]): number {
  let best = -1
  spans.forEach((s, i) => { if (s.start <= at[0] && at[1] <= s.end && (best < 0 || s.end - s.start < spans[best]!.end - spans[best]!.start)) best = i })
  return best
}

// Every fix Opus attached to its review, cascades last (they rewrite the source the others edit).
async function applyAllFixes($: EngineInterface): Promise<number> {
  const items = (await read($, plan))?.review?.items ?? []
  const order = items.map((it, i) => ({ it, i })).filter(x => x.it.patch).sort((a, b) => Number(!!a.it.patch?.cascade) - Number(!!b.it.patch?.cascade))
  for (const { i } of order) await applyFix($, i).catch(() => undefined)
  return order.length
}

// An agent left on the session's model gets one picked for its task: Opus's pick when it made
// one, else sonnet (opus for a checker, which must be stronger than what it checks). On a frugal
// night nothing runs above sonnet.
export const fallbackTier = (isCheck: boolean, isFrugalNight: boolean) => (isCheck && !isFrugalNight ? 'opus' : 'sonnet')
async function pickModels($: EngineInterface) {
  const p = await read($, plan)
  const g = p && graphOf(p.source, p.edits).graph
  if (!g) return
  const frugal = await isFrugal($)
  for (const n of g.nodes) {
    if (!(n.modelSpan || n.modelInsert)) continue
    if (!n.model) await setModel($, n.id, fallbackTier(isChecker(n), frugal))
    else if (frugal && n.model === 'opus') await setModel($, n.id, 'sonnet')
  }
}

const NIGHT_REVIEW = '\n\nNIGHT RUN: nobody approves this plan; your fixes are applied as they are. Every card whose model is "inherited" MUST get a {"model"} patch: the cheapest tier that will do its task well.'

async function prepareNight($: EngineInterface, source: string): Promise<string> {
  isNightPrep = true
  try { return await prepareNightPlan($, source) } finally { isNightPrep = false }
}
async function prepareNightPlan($: EngineInterface, source: string): Promise<string> {
  const { name, sites } = extract(source)
  await update($, plan, (): Plan => ({ name, source, sites, models: {}, edits: {}, status: 'pending', review: { status: 'pending' } }))
  await update($, plan, x => x && { ...x, tiers: {} })
  for (const [id, s] of Object.entries(await tierSuggestions($, source, {}))) await setModel($, id, s.tier)
  await reviewPlan($, NIGHT_REVIEW + ((await isFrugal($)) ? ' The night budget is tight: no opus.' : ''))
  await pickModels($)
  const p = await read($, plan)
  const out = p ? graphOf(p.source, p.edits).source : source
  await update($, plan, x => x && { ...x, status: 'approved' as const })
  return out
}

// A proposed mission, replayed on the card's last real input by one agent, then judged by Opus.
async function replayMission($: EngineInterface, label: string) {
  const p = await read($, plan)
  const prop = p?.proposals?.[label]
  if (!p || !prop) return
  const key = `mission:${prop.workflow}:${prop.label}`
  const description = `gate replay: ${label} · ${await $.clock.now()}`
  const res = await $.agent.spawn({ prompt: replayPrompt(prop.lastPrompt, prop.from, prop.mission), description, model: prop.model })
  if (res.deny) return $.ui.toast(`Replay refused: ${res.deny}`)
  // Core names the agent; when another hook answered the spawn, find it by its description.
  const agentId = res.agentId ?? (await $.agent.list().catch(() => [])).find(a => a.description === description)?.id
  if (!agentId) return $.ui.toast('Replay started, but its agent could not be found: its answer will not be judged.')
  replays.set(agentId, key)
  const next: MissionProposal = { ...prop, replay: { status: 'running', agentId } }
  await $.store.set(key, next)
  await update($, plan, x => x && { ...x, proposals: { ...x.proposals, [label]: next } })
}

async function judgeReplay($: EngineInterface, key: string, answer: string) {
  const prop = (await $.store.get(key).catch(() => undefined)) as MissionProposal | undefined
  if (!prop) return
  const res = await $.model.complete({ model: 'opus', system: JUDGE_SYSTEM, prompt: judgePrompt(prop.mission, prop.failure, prop.oldResult, answer), maxTokens: 400, timeoutMs: 90000 })
  const v = res.isAnswered ? parseJudge(res.text) : undefined
  const next: MissionProposal = { ...prop, replay: v ? { status: 'done', better: v.better, why: v.why } : { status: 'error', why: res.isAnswered ? 'unreadable verdict' : res.reason } }
  await $.store.set(key, next)
  await update($, plan, x => x && x.name === prop.workflow ? { ...x, proposals: { ...x.proposals, [prop.label]: next } } : x)
  await notify($, `🔁 Replay of ${prop.label}: ${v ? (v.better ? 'the new mission did better' : 'not better') : 'no verdict'}${v?.why ? ` — ${v.why}` : ''}`)
}

async function adoptMission($: EngineInterface, label: string) {
  const p = await read($, plan)
  const prop = p?.proposals?.[label]
  const g = p && graphOf(p.source, p.edits).graph
  const node = g?.nodes.find(n => cardLabel(n) === label)
  if (!p || !prop || !node?.missionSpan) return $.ui.toast('This card has no literal mission to replace.')
  await setMission($, node.id, prop.mission)
  await $.store.delete(`mission:${prop.workflow}:${prop.label}`).catch(() => undefined)
  await update($, plan, x => { if (!x) return x; const { [label]: _, ...rest } = x.proposals ?? {}; return { ...x, proposals: rest } })
}

async function dropMission($: EngineInterface, label: string) {
  const p = await read($, plan)
  const prop = p?.proposals?.[label]
  if (!prop) return
  await $.store.delete(`mission:${prop.workflow}:${prop.label}`).catch(() => undefined)
  await update($, plan, x => { if (!x) return x; const { [label]: _, ...rest } = x.proposals ?? {}; return { ...x, proposals: rest } })
}

let isRetro = false
// Once every agent has ended and nothing new started for 15 s: Opus judges the run, card by card and
// flag by flag, and the verdicts feed each label's track record.
async function retro($: EngineInterface) {
  const r = await read($, run)
  if (isRetro || !r || r.retro || !isRunOver(r, await $.clock.now())) return
  isRetro = true
  await update($, run, x => x && { ...x, retro: { pending: true as const } })
  try {
    const journal = await journalOf($, r)
    const g = r.source ? graphOf(r.source).graph : null
    const cards = (g?.nodes ?? []).filter(n => r.agents.some(a => a.cardId === n.id)).map(n => ({
      label: cardLabel(n),
      mission: n.assembled || n.mission || '',
      results: r.agents.filter(a => a.cardId === n.id).map(a => (a.id && journal.get(a.id)?.result) || (a.status === 'failed' ? '(failed)' : '(no result recorded)')),
    }))
    const flags = r.flags ?? []
    const res = await $.model.complete({ model: 'opus', system: RETRO_SYSTEM, prompt: retroPrompt(r.name, cards, flags), maxTokens: 1500, timeoutMs: 120000 })
    const parsed = res.isAnswered ? parseRetro(res.text, flags.length) : undefined
    if (!parsed) { await update($, run, x => x && { ...x, retro: { error: res.isAnswered ? 'unreadable answer' : res.reason } }); return }
    const at = await $.clock.now()
    await update($, run, x => x && { ...x, retro: { ...parsed, at } })
    records = mergeRecords(records, parsed, flags, at)
    await $.store.set('labels', records)
    // The bandit learns per card: the tier it ran on, the verdict, what an agent cost there.
    const score = { yes: 1, partial: 0.5, no: 0 } as const
    for (const c of parsed.cards) {
      const node = g?.nodes.find(n => cardLabel(n) === c.card)
      const mine = r.agents.filter(a => a.cardId === node?.id)
      if (!node || !mine.length) continue
      const cost = mine.reduce((t, a) => t + (a.cost ?? 0), 0) / mine.length
      bandit = banditUpdate(bandit, c.card, tierOf(mine[0]!.model ?? node.model ?? ''), score[c.delivered], cost)
    }
    await $.store.set('bandit', bandit)
    // Under-delivered cards with a literal mission: Opus rewrites it (two per run at most).
    const missionChanges: { label: string; why: string }[] = []
    for (const c of parsed.cards.filter(x => x.delivered !== 'yes').slice(0, 2)) {
      const node = g?.nodes.find(n => cardLabel(n) === c.card)
      const mine = r.agents.filter(a => a.cardId === node?.id)
      if (!node?.missionSpan || !node.mission) continue
      const results = mine.map(a => (a.id && journal.get(a.id)?.result) || '').filter(Boolean)
      const cardFlags = flags.filter(f => f.cardId === node.id).map(f => `- ${f.kind}: ${f.why}`)
      const ev = await $.model.complete({ model: 'opus', system: EVOLVE_SYSTEM, prompt: evolvePrompt(c.card, node.mission, results, c.why, cardFlags), maxTokens: 3000, timeoutMs: 120000 })
      const proposal = ev.isAnswered ? parseEvolution(ev.text) : undefined
      if (!proposal) continue
      const prop: MissionProposal = {
        workflow: r.name, label: c.card, from: node.mission, mission: proposal.mission, why: proposal.why, at,
        model: mine[0]?.model, lastPrompt: (mine[0]?.id && lastPrompts.get(mine[0].id)) || node.assembled || node.mission,
        oldResult: results[0] ?? '', failure: c.why,
      }
      await $.store.set(`mission:${r.name}:${c.card}`, prop)
      missionChanges.push({ label: c.card, why: proposal.why })
    }
    const record: RetroRecord = {
      name: r.name, at, summary: parsed.summary, startedAt: r.startedAt, agents: r.agents.length,
      delivered: parsed.cards.filter(c => c.delivered === 'yes').length, cards: parsed.cards.length,
      cost: r.agents.reduce((t, a) => t + (a.cost ?? 0), 0) || undefined,
      verdicts: parsed.cards,
      flags: { founded: parsed.flags.filter(f => f.founded).length, unfounded: parsed.flags.filter(f => !f.founded).length },
    }
    await $.store.set(`retro:${r.runId ?? `local-${r.startedAt}`}`, record)
    // The team's copy: only what this run teaches about designing workflows, filtered of anything
    // that names the project (its workflow, paths, code, addresses).
    // The workflow's own name and its parts (step labels are mostly roles — specifier, verify — and stay allowed).
    const projectWords = [r.name, ...r.name.split(/[-_\s]+/)]
    const patterns = parsePatterns(parsed.patterns, projectWords)
    void teamPublish($, { v: 2, id: await sha($, `${r.runId ?? r.startedAt}`, 12), user: team.user || 'someone', at, agents: r.agents.length, cost: record.cost, patterns })
      .catch(() => $.ui.toast('Team history: could not write this run.'))
    const missed = parsed.cards.filter(c => c.delivered !== 'yes')
    await notify($, `✓ «${r.name}» done · ${parsed.cards.length - missed.length}/${parsed.cards.length} delivered${missed.length ? ` · ${missed[0]!.card}: ${missed[0]!.why}` : ''}`)
  } finally {
    isRetro = false
  }
}

// The Agent tab: one agent's story, opened from its row in Live, scrolled to the latest.
async function openAgent($: EngineInterface, id: string) {
  await update($, agentView, () => id)
  await update($, tab, () => 'agent' as const)
  await $.ui.scroll({ to: 'end', in: PANE }).catch(() => undefined)
}

// The human's answer to Opus: stop the run (Claude Code's TaskStop on the run's task), or let it run.
async function stopRun($: EngineInterface) {
  const r = await read($, run)
  if (!r?.taskId) return $.ui.toast('No task id for this run: stop it with /workflows.')
  await $.tool.call({ tool: 'TaskStop', task_id: r.taskId })
  await update($, run, x => x && { ...x, decisions: (x.decisions ?? []).map(d => ({ ...d, isAnswered: true })) })
  $.ui.toast(`Run ${r.name} stopped.`)
}

async function letItRun($: EngineInterface) {
  await update($, run, x => x && { ...x, decisions: (x.decisions ?? []).map(d => ({ ...d, isAnswered: true })) })
}

// Flags as the canvas shows them: per card, how many and the latest reason.
const warnOf = (flags: Flag[]) => {
  const out: Record<string, { n: number; text: string }> = {}
  for (const f of flags) if (f.cardId) out[f.cardId] = { n: (out[f.cardId]?.n ?? 0) + 1, text: `${f.kind}: ${f.why}` }
  return out
}

// ---------------------------------------------------------------- hooks

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

export const register: Register = (on, options) => {
  const o = (options ?? {}) as { teamHistory?: string; teamHistoryRemote?: string; teamHistoryBranch?: string }
  const remote = o.teamHistoryRemote || ''
  // No remote, no team history: the mode only applies once a team has a repo to share in.
  team = { ...team, mode: (remote && ['off', 'read', 'share'].includes(o.teamHistory ?? '') ? o.teamHistory : 'off') as typeof team.mode, remote, branch: o.teamHistoryBranch || 'workflow-history' }

  on('session.start', async ($, e, next) => {
    records = ((await $.store.get('labels').catch(() => undefined)) as Record<string, LabelRecord> | undefined) ?? {}
    bandit = ((await $.store.get('bandit').catch(() => undefined)) as BanditStats | undefined) ?? {}
    $.clock.after(0, () => void teamSync($).catch(() => { isSyncing = false })) // never holds the session's start
    $.clock.every(4000, () => void checkOne($).catch(() => { isChecking = false })
      .then(() => orchestrate($)).catch(() => { isOrchestrating = false })
      .then(() => handLate($)).catch(() => undefined)
      .then(() => reviewPlan($)).catch(() => { isReviewing = false })
      .then(() => retro($)).catch(() => { isRetro = false })
      .then(() => summarize($)).catch(() => { isSummarizing = false }))
    await $.command.register({ name: 'gate', description: 'Workflow gate: the pending plan, the live run, past runs' })
    // A plugin reload (/reload-plugins) runs this again mid-session, and the pane on screen is still
    // the one the gone module drew: its buttons are there, their handlers are not, so Approve & run
    // does nothing at all — the human believes they approved while the agent waits for a path that
    // never comes. A plan still pending is exactly when that matters: seat the pane again from here.
    if ((await read($, plan))?.status === 'pending') {
      await $.ui.close({ id: PANE }).catch(() => undefined)
      await openPane($).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'gate' }, async $ => {
    // A pane already open is only retitled, never seated again: close it first so /gate always brings it back.
    await $.ui.close({ id: PANE }).catch(() => undefined)
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Workflow gate pane opened.' : `Workflow gate pane could not be shown: ${opened.reason}` }
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const source = e.scriptPath ? await $.fs.read(e.scriptPath).catch(() => undefined) : e.script
    const script0 = source
    const track = async (call: typeof e = e, source = script0): Promise<ToolCallResult> => {
      const p = await read($, plan)
      const usage = await $.session.usage()
      const g = source ? graphOf(source).graph : null
      let past: { agents?: { label?: string; turns?: number }[] }[] = []
      try { past = Object.values(JSON.parse(await $.fs.read(`${await home($)}/.claude/workflow-gate-cost-cache.json`))) } catch {}
      const r: Run = { toolUseId: e.tool_use_id ?? '', name: (p?.source === source ? p?.name : undefined) ?? (source ? extract(source).name : undefined) ?? e.name ?? 'workflow', source, sites: g?.minAgents ?? 0, startedAt: await $.clock.now(), costAt: usage.cost?.usd, expected: g ? expectedSteps(g, past) : {}, agents: [] }
      await update($, run, () => r)
      liveIds.clear()
      for (const k of [...pending.keys()]) if (k !== 'main') pending.delete(k)
      excerpts.clear(); notes.clear()
      const res = await next(call)
      // Core sets `text`; a hook's own answer (a test's, another plugin's) may only carry `result`.
      const out = res as { text?: string; result?: { text?: unknown } | string }
      const info = launchInfo(String(out.text ?? (typeof out.result === 'string' ? out.result : out.result?.text) ?? ''))
      if (info.taskId || info.dir) await update($, run, x => x && { ...x, taskId: info.taskId, runId: info.runId, journal: info.dir ? `${info.dir}/journal.jsonl` : undefined })
      return res
    }
    // At night nobody approves: the plan goes through the same process unattended (learned tiers,
    // Opus's review and fixes, a model on every agent), is approved, and Claude runs the file it
    // became. A rewrite cannot swap a Workflow call's script, so the call is sent back once, as by day.
    const isPrepared = !!e.scriptPath && (await read($, approved))[e.scriptPath] === source
    if (!e.resumeFromRunId && source && !isPrepared && (await isOverridden($)) && (await nightOf($))?.isOn && graphOf(source).graph) {
      const tuned = await prepareNight($, source)
      const path = `${await home($)}/.claude/workflow-gate/terminal/night-${await sha($, tuned, 12)}.mjs`
      await $.fs.write(path, tuned)
      await update($, approved, a => ({ ...a, [path]: tuned }))
      const p = await read($, plan)
      return { deny: `[workflow-gate] Night mode: plan "${p?.name ?? 'workflow'}" reviewed by Opus, its fixes applied, a model set on every agent (${tierMixOf(graphOf(tuned).graph, { models: {}, edits: {} } as never)}), and approved. Run Workflow now with { scriptPath: ${JSON.stringify(path)} } — not inline, and do not change the file.` } as never
    }
    if ((await $.env.get('WORKFLOW_GATE_OFF')) || e.resumeFromRunId || (await isOverridden($))) return track()
    if (!source) return next(e) // a saved workflow by name: the browser gate handles it
    if (isPrepared) return track()
    if (await isApprovedByGate($, e.scriptPath, source)) return track()
    if (await read($, passOnce)) {
      await update($, passOnce, () => false)
      return next(e) // the classic gate opens its browser editor and waits
    }

    const { name, sites } = extract(source)
    const g = graphOf(source).graph
    await update($, plan, (): Plan => ({ name, source, sites, models: {}, edits: {}, status: 'pending', review: { status: 'pending' } }))
    const learned = { tiers: await tierSuggestions($, source, {}), proposals: await proposalsFor($, name) }
    await update($, plan, x => x && { ...x, ...learned })
    await notify($, `⛔ Workflow «${name}» waits for your approval${g ? ` · ≥${g.minAgents} agents` : ''}`)
    await update($, selected, () => g?.nodes[0]?.id ?? null)
    await update($, tab, () => 'plan' as const)
    await update($, isBandHidden, () => false)
    // Unasked, a pane seats only from 144 columns (a desktop window is often narrower): say how to open it.
    const opened = await $.ui.open({ id: PANE, title: `Workflow gate — ${name}` }).catch(() => undefined)
    const isShown = opened?.isPlaced !== false
    if (!isShown) $.ui.toast(`⛔ Workflow «${name}» held: type /gate to see the plan and approve it`)
    return {
      deny: `⛔ workflow-gate (terminal): the plan "${name}" (${g ? `≥${g.minAgents} agents` : `${sites.length} agent() sites`}) is ${isShown ? 'shown to the human in the terminal' : 'held, but its pane could not open on its own (the window is too narrow): tell the human to type /gate to see it and approve'}. ` +
        `Do NOT retry and do NOT record an approval yourself. End your turn now: if they approve, you will receive a message with the scriptPath to run.`,
    }
  }).catch(($, e, next) => next(e)) // fail open: the browser gate decides

  // The main loop's mission is what the person last asked, so scope drift can be judged.
  on('prompt.submit', async ($, e, next) => {
    if (!/^(\[workflow-gate\]|\[overseer\]|🌙|<)/.test(e.text)) { mainMission = e.text.slice(0, 1200); lastHumanAt = await $.clock.now() }
    // The run's background task reporting back is the run's end.
    const r = e.text.includes('<task-notification>') ? await read($, run) : null
    if (r?.taskId && !r.endedAt && e.text.includes(`<task-id>${r.taskId}</task-id>`) && !/<status>running<\/status>/.test(e.text)) {
      const at = await $.clock.now()
      await update($, run, x => x && { ...x, endedAt: at })
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!(e as unknown as { agentId?: string }).agentId) mainChecks = 0
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await read($, run)
    if (!e.workflow || !r || (e.tool_use_id && r.toolUseId && e.tool_use_id !== r.toolUseId)) return next(e)
    const g = r.source ? graphOf(r.source).graph : null
    const taken: Record<string, number> = {}
    r.agents.forEach(a => { if (a.cardId) taken[a.cardId] = (taken[a.cardId] ?? 0) + 1 })
    const place = g ? placeAgent(g, e.prompt, taken) : { isGuess: true }
    const node = place.cardId ? g?.nodes.find(n => n.id === place.cardId) : undefined
    const label = (node && cardLabel(node)) || e.description || `agent ${e.workflow.agentIndex}`
    // Keyed by the run's agent index, never by position: parallel spawns read the same run state.
    const key = `${e.workflow.runId}#${e.workflow.agentIndex}`
    const agent: LiveAgent = { key, label, model: e.model, ...place, status: 'running', startedAt: await $.clock.now() }
    await update($, run, x => (x ? { ...x, agents: [...x.agents, agent] } : x))
    const res = await next(e)
    if (res.agentId) { liveIds.add(res.agentId); lastPrompts.set(res.agentId, e.prompt.slice(0, 40000)) }
    await update($, run, x => x && { ...x, agents: x.agents.map(a => (a.key === key ? { ...a, id: res.agentId, model: res.model ?? a.model, status: res.deny ? 'failed' as const : a.status } : a)) })
    return res
  })

  // Each model request of a run's agent is one step on its progress bar.
  on('turn.step', async function* ($, e, next) {
    const isRunAgent = await isTracked($, e.agentId)
    if (e.agentId && !isRunAgent) return yield* next(e) // other subagents: not ours to judge
    const id = e.agentId ?? 'main'
    if (isRunAgent) {
      await update($, run, x => x && { ...x, agents: x.agents.map(a => (a.id === id ? { ...a, steps: (a.steps ?? 0) + 1 } : a)) })
    }
    // Forward every chunk untouched; keep a copy of its text and thinking for the fallacy check.
    const it = next(e)[Symbol.asyncIterator]()
    for (;;) {
      const step = await it.next()
      if (step.done) {
        // What this request cost, on the agent's running total.
        const spent = isRunAgent ? costOf(step.value?.usage as Usage | null) : 0
        if (spent) await update($, run, x => x && { ...x, agents: x.agents.map(a => (a.id === id ? { ...a, cost: (a.cost ?? 0) + spent } : a)) })
        // This request's thinking and writing go on the agent's timeline, one entry each.
        const words = isRunAgent ? stepText.get(id) : undefined
        if (words) {
          stepText.delete(id)
          if (words.thinking.trim()) await log($, id, 'thought', words.thinking.trim())
          if (words.text.trim()) await log($, id, 'text', words.text.trim())
        }
        return step.value
      }
      const c = step.value
      if (c.kind === 'text' || c.kind === 'thinking') {
        pending.set(id, ((pending.get(id) ?? '') + c.text).slice(-6000))
        if (isRunAgent) {
          // The agent's live thought on its card, at most twice a second.
          const t = thoughts.get(id)
          const buf = t && t.kind === c.kind ? (t.text + c.text).slice(-1200) : c.text
          const now = Date.now()
          thoughts.set(id, { text: buf, kind: c.kind, pushedAt: t?.pushedAt ?? 0 })
          const words = stepText.get(id) ?? { thinking: '', text: '' }
          words[c.kind] += c.text
          stepText.set(id, words)
          const sentence = lastSentence(buf)
          if (sentence && now - (t?.pushedAt ?? 0) > 500) { // thinking can arrive without text: nothing to show then
            thoughts.set(id, { text: buf, kind: c.kind, pushedAt: now })
            const thought = `${c.kind === 'thinking' ? '💭' : '💬'} ${sentence}`
            await update($, run, x => x && { ...x, agents: x.agents.map(a => (a.id === id ? { ...a, thought } : a)) })
          }
        }
      }
      yield c
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    // A replay is an evaluation: it reads and reasons, it never changes anything.
    if (id && replays.has(id) && (['Write', 'Edit', 'NotebookEdit'].includes(e.tool) || (e.tool === 'Bash' && /(^|[;&|]\s*)(rm|mv|cp|mkdir|touch|git\s+(commit|push|reset|checkout|merge)|npm\s+(i|install|publish)|sed\s+-i)\b|>\s*\S/.test(String((e as { command?: unknown }).command ?? ''))))) {
      return { deny: 'Replay for evaluation: read-only. Answer from what you can read.' }
    }
    if (!id || !(await isTracked($, id))) return next(e)
    const doing = describeCall(e.tool, e as unknown as Record<string, unknown>)
    await update($, run, x => x && { ...x, agents: x.agents.map(a => (a.id === id ? { ...a, lastTool: e.tool, doing } : a)) })
    const res = await next(e)
    const ok = res.deny === undefined && !(res as { isError?: boolean }).isError
    const at = await $.clock.now()
    await update($, run, x => x && { ...x, agents: x.agents.map(a => (a.id === id ? { ...a, doing: undefined, tasks: [...(a.tasks ?? []), { text: doing, ok, at }].slice(-25) } : a)) })
    await log($, id, 'tool', doing, ok)
    // An Opus steer rides on this tool's result: the agent reads it, nothing is refused or redone.
    if (res.deny !== undefined) return res
    const steers = ((await read($, run))?.decisions ?? []).filter(d => d.agentId === id && d.action === 'steer' && d.message && !d.isDelivered)
    const waiting = [...steers.map(d => steerNote(d.message!)), ...(notes.get(id) ?? [])]
    if (!waiting.length) return res
    notes.delete(id)
    await update($, run, x => x && { ...x, decisions: (x.decisions ?? []).map(d => (steers.some(s => s.at === d.at && s.agentId === d.agentId) ? { ...d, isDelivered: true } : d)) })
    for (const n of waiting) await log($, id, 'steer', n)
    return { ...res, context: [...(res.context ?? []), ...waiting] }
  })

  on('turn.complete', async ($, e, next) => {
    const replayKey = e.agentId ? replays.get(e.agentId) : undefined
    if (replayKey) {
      replays.delete(e.agentId!)
      void judgeReplay($, replayKey, 'answer' in e ? String(e.answer ?? '') : '').catch(() => undefined)
    }
    if (await isTracked($, e.agentId)) {
      const endedAt = await $.clock.now()
      await update($, run, x => x && { ...x, agents: x.agents.map(a => (a.id === e.agentId ? { ...a, status: e.isAborted ? 'failed' as const : 'done' as const, endedAt } : a)) })
      await log($, e.agentId!, 'end', e.isAborted ? 'stopped before it finished' : 'finished', !e.isAborted)
    }
    return next(e)
  })

  // The Client canvas's clicks and keys: open a card (a second click closes it), cycle its model.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const d = e.data as { select?: string; cycleModel?: string }
    if (d.select) await update($, selected, cur => (cur === d.select ? null : d.select!))
    if (d.cycleModel) {
      const p = await read($, plan)
      const g = p && graphOf(p.source, p.edits).graph
      if (p?.status === 'pending' && g) {
        const order = ['haiku', 'sonnet', 'opus', 'fable']
        await setModel($, d.cycleModel, order[(order.indexOf(modelOf(g, d.cycleModel)) + 1) % order.length]!)
      }
    }
    return {}
  })

  // ---------------------------------------------------------------- band above the prompt

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const [p, r] = [await read($, plan), await read($, run)]
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const parts: BandSpec[] = [] // what wants the person's eye; folded into one line at the end
    const compact = await underActivity($)
    const open = await read($, isBandOpen)
    const toggle = () => void update($, isBandOpen, x => !x)
    const now = await $.clock.now()

    // The main session's own reasoning: the latest flag the person has not dismissed.
    const mf = await read($, mainFlags)
    const unseen = mf.slice(await read($, mainSeen))
    const { rows, more } = checkRows(unseen)
    const high = rows.filter(f => f.severity !== 'low').length
    if (high) { // low-weight remarks alone never raise the band; they show under the high ones when it opens
      const checkOpen = await read($, isCheckOpen)
      parts.push({
        id: 'wg-check', surface: e.surface, compact, icon: '⚠', name: 'Check', color: 'yellow', open: checkOpen, onToggle: () => void update($, isCheckOpen, x => !x), tone: 'warn',
        // Closed: what and how many, short enough to read whole. Open: every remark in full.
        summary: [{ t: rows[0]!.kind, c: 'yellow', b: true }, ` · ${rows.length + more} to read${high ? ` (${high} high)` : ''}`],
        actions: [{ key: 'ok', label: 'Dismiss', onPress: () => void (update($, mainSeen, () => mf.length), update($, isCheckOpen, () => false)) }],
        detail: [
          ...rows.map((f, i) => (
            <Box key={`wg-ck${i}`} flexDirection="column">
              <Text key={`wg-ck${i}-w`} wrap="wrap"><Text color={f.severity === 'low' ? undefined : 'yellow'} bold>{f.kind}</Text> — {f.why}</Text>
              {f.quote ? <Text key={`wg-ck${i}-q`} dimColor italic wrap="wrap">  “{f.quote}”</Text> : null}
            </Box>
          )),
          ...(more ? [<Text key="wg-ck-more" dimColor>+{more} more of lower weight</Text>] : []),
        ],
      })
    }

    const isRunning = r?.agents.some(a => a.status === 'running')
    const ask = isRunning ? (r?.decisions ?? []).filter(d => (d.action === 'ask_human' || d.action === 'stop_run') && !d.isAnswered).at(-1) : undefined
    const hidden = await read($, isBandHidden)
    if (!hidden && p?.status === 'pending') {
      const g = graphOf(p.source, p.edits).graph
      const flags = g ? planFlags(g as never, graphOf(p.source, p.edits).source) : []
      const review = p.review?.status === 'done' ? (p.review.verdict === 'ok' ? 'Opus: sound' : `Opus: ${p.review.items?.length ?? 0} concerns`) : p.review?.status === 'pending' ? 'Opus is reviewing…' : ''
      parts.push({
        id: 'wg', surface: e.surface, compact, icon: '⛔', name: 'Workflow', color: 'yellow', tone: 'warn', open, onToggle: toggle,
        summary: [{ t: `«${p.name}»`, b: true }, ` waits for you · ${g ? `≥${g.minAgents} agents` : `${p.sites.length} sites`} · ${tierMixOf(g, p)}`, ...(review ? [` · ${review}`] : []), ...(flags.length ? [{ t: ` · ⚠ ${flags.length}`, c: 'yellow' as const }] : [])],
        actions: [
          { key: 'approve', label: 'Approve & run', primary: true, hotkey: 'a', onPress: () => void approve($) },
          { key: 'plan', label: 'Plan', hotkey: 'p', onPress: () => void openPane($, 'plan') },
          { key: 'cancel', label: 'Cancel', onPress: () => void cancel($) },
        ],
        detail: [
          ...flags.map((f, i) => <Text key={`wg-f${i}`} color="yellow" wrap="truncate-end">⚠ {f.kind}: {f.why}</Text>),
          ...(p.review?.status === 'done' ? (p.review.items ?? []).map((it, i) => <Text key={`wg-r${i}`} wrap="truncate-end"><Text color="blue">🧭 {it.card}</Text> {it.issue}{it.fix ? <Text dimColor> → {it.fix}</Text> : null}</Text>) : []),
        ],
      })
    }
    // An unanswered question from Opus always shows, whatever else the band holds (a new plan
    // waiting, the band hidden): its Stop run / Let it run must stay within reach.
    if (ask && r) {
      parts.push({
        id: 'wg-ask', surface: e.surface, compact, icon: '🧭', name: 'Opus', color: 'magenta', tone: 'alert', open: false, onToggle: () => undefined,
        summary: [{ t: `${ask.action === 'stop_run' ? 'proposes stopping' : 'asks'} (${ask.agent}): `, c: 'magenta', b: true }, ask.message ?? ask.why, ` · run ${r.name}`],
        actions: [{ key: 'stop', label: 'Stop run', onPress: () => void stopRun($) }, { key: 'go', label: 'Let it run', primary: true, onPress: () => void letItRun($) }],
      })
    }
    if (p?.status !== 'pending' && !hidden && isRunning && r) {
      const done = r.agents.filter(a => a.status === 'done').length
      const cost = r.agents.reduce((t, a) => t + (a.cost ?? 0), 0)
      const glyph: Record<string, { g: string; c: string }> = { running: { g: '◑', c: 'yellow' }, done: { g: '✓', c: 'green' }, failed: { g: '✗', c: 'red' } }
      parts.push({
        id: 'wg', surface: e.surface, compact, icon: '▶', name: 'Workflow', color: 'green', tone: 'ok', open, onToggle: toggle,
        summary: [{ t: r.name, b: true }, ` · ${done}/${r.agents.length} agents${r.sites ? ` (≥${r.sites} approved)` : ''} · ${mmss(now - r.startedAt)}`, ...(cost ? [` · $${cost.toFixed(2)}`] : []), ...((r.flags ?? []).length ? [{ t: ` · ⚠ ${(r.flags ?? []).length}`, c: 'yellow' as const }] : [])],
        actions: [{ key: 'live', label: 'Live', hotkey: 'l', onPress: () => void openPane($, 'live') }, { key: 'hide', label: 'Hide', onPress: () => void update($, isBandHidden, () => true) }],
        detail: [
          <Text key="wg-g"><Text color="green">{gauge(done / Math.max(1, r.agents.length), 20)}</Text><Text> {done}/{r.agents.length} agents done</Text><Text dimColor> · {(r.flags ?? []).length} checks · {(r.decisions ?? []).filter(d => d.action === 'steer').length} steers</Text></Text>,
          ...r.agents.slice(-6).map((a, i) => (
            <Text key={`wg-a${i}`} wrap="truncate-end"><Text color={glyph[a.status]?.c}>{glyph[a.status]?.g ?? '·'} </Text><Text bold>{a.label}</Text><Text dimColor> {a.model ? `${a.model.replace('claude-', '')} · ` : ''}{a.doing ?? a.lastTool ?? (a.status === 'done' ? 'done' : '…')}</Text></Text>
          )),
        ],
      })
    }
    if (!parts.length) return below
    // One line above the prompt (lot 12): the most urgent part draws the band (Opus asking, then a plan waiting,
    // a run, a remark); the others ride on its line as a tag and open under it, their buttons kept.
    const RANK = ['wg-ask', 'wg', 'wg-check']
    const [lead, ...rest] = [...parts].sort((a, b) => RANK.indexOf(a.id) - RANK.indexOf(b.id))
    const segs = (r: BandSpec) => r.summary.map((g, i) => (typeof g === 'string'
      ? <Text key={`${r.id}-h${i}`} dimColor>{g}</Text>
      : <Text key={`${r.id}-h${i}`} {...(g.c ? { color: soft(g.c) } : {})} {...(g.b ? { bold: true } : {})}>{g.t}</Text>))
    const spec: BandSpec = !rest.length ? lead! : {
      ...lead!,
      open: lead!.detail?.length ? lead!.open : open,
      onToggle: lead!.detail?.length ? lead!.onToggle : toggle,
      summary: [...lead!.summary, ...rest.map(r => ({ t: ` · ${r.icon} ${typeof r.summary[0] === 'string' ? r.summary[0] : r.summary[0]?.t ?? r.name}`, c: r.color }))],
      detail: [
        ...(lead!.detail ?? []),
        ...rest.map(r => (
          <Box key={`${r.id}-part`} flexDirection="column">
            <Box key={`${r.id}-head`} justifyContent="space-between">
              <Text key={`${r.id}-name`} wrap="truncate-end"><Text color={soft(r.color)} bold>{r.icon} {r.name} </Text>{segs(r)}</Text>
              <Box key={`${r.id}-acts`} flexShrink={0}>{(r.actions ?? []).map(a => <Button key={`${r.id}-${a.key}`} label={a.label} {...(a.primary ? { variant: 'primary' as const } : {})} onPress={a.onPress} />)}</Box>
            </Box>
            {r.detail ?? []}
          </Box>
        )),
      ],
    }
    return <Box flexDirection="column">{below}{band(els, spec)}</Box> // the others first: under activity-band's line whatever the load order
  })

  // ---------------------------------------------------------------- the pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // Mobile's table has neither, but its runtime table still carries them and draws a blank: ask the surface.
    const Select = e.surface !== 'mobile' && 'Select' in els ? els.Select : undefined
    const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
    // The terminal draws the flowchart as a Raster (canvas-raster.ts), animated by blit in Live.
    const Raster = e.surface === 'terminal' && 'Raster' in els ? els.Raster : undefined
    const Svg = hasSvg(e.surface) && 'Svg' in els ? els.Svg : undefined // off the terminal the canvas is an Svg, the camera its viewBox
    // The terminal's Plan tab is the interactive Client canvas (click a card, drag, keys, the review card beside the graph):
    // that is where the person decides. Live keeps the animated Raster.
    const Client = e.surface === 'terminal' && 'Client' in els ? els.Client : undefined
    const [p, r, t, sel] = [await read($, plan), await read($, run), await read($, tab), await read($, selected)]
    const cols = e.props.bodyColumns ?? 100
    const rows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 40 // the pane's body, not the terminal
    const now = await $.clock.now()
    // Off the terminal: the Svg, a card picker (an Svg takes no press), and the side card as plain rows.
    type SideCard = { title: string; badge?: string; lines: { t: string; c?: string; b?: boolean; d?: boolean }[] }
    const svgCanvas = (key: string, f: FlowSvg, motion: string, cards: { id: string; label: string }[], side: SideCard | null, alt: string, body: Expand['body'] = []) => (
      <Box key={`${key}-hold`} flexDirection="column" flexShrink={0}>
        {(() => {
          const src = Svg ? svgOf(f, motion, now) : ''
          // Past the source cap even lean, the whole pane would be refused (its Approve too): the steps as text.
          return Svg && src.length <= SOURCE_MAX ? <Svg key={key} source={src} alt={alt} isInteractive /> : <Text key={key} wrap="wrap">{cards.map(c => c.label).join(' → ')}</Text>
        })()}
        {Select && cards.length
          // ponytail: a Select holds 64 options; past that the first 64 cards, add a search Input if a plan ever needs more.
          ? <Select key={`${key}-pick`} label="card" value={f.selected} options={cards.slice(0, 64).map(c => ({ value: c.id, label: c.label.slice(0, 60) }))} onSelect={(v: string) => update($, selected, () => v)} />
          : <Box key={`${key}-pick`} flexWrap="wrap">{cards.map(c => <Button key={`${key}-pick-${c.id}`} label={c.label.slice(0, 24)} {...(c.id === f.selected ? { variant: 'primary' as const } : {})} onPress={() => update($, selected, cur => (cur === c.id ? null : c.id))} />)}</Box>}
        {/* The open card's goal, task and deliverable, read whole: the Svg card cuts them to its width. */}
        {body.length ? <Box key={`${key}-body`} flexDirection="column" paddingX={1}>{body.map((l, i) => <Text key={`${key}-body${i}`} wrap="wrap" {...(l.c ? { color: l.c } : {})} {...(l.b ? { bold: true } : {})}>{l.t}</Text>)}</Box> : null}
        {/* The review / orchestrator card, framed as on the terminal, every line whole. */}
        {side ? (
          <Box key={`${key}-side`} flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
            <Text key={`${key}-side-t`} bold color="cyan">{side.title}{side.badge ? <Text dimColor> · {side.badge}</Text> : null}</Text>
            {side.lines.filter(l => l.t.trim()).map((l, i) => <Text key={`${key}-side${i}`} wrap="wrap" {...(l.c ? { color: l.c } : {})} {...(l.b ? { bold: true } : {})} {...(l.d ? { dimColor: true } : {})}>{l.t}</Text>)}
          </Box>
        ) : null}
      </Box>
    )

    // The terminal: the Raster (one row per card under 60 columns), ◀ ▶ ▲ ▼ when the graph is bigger than
    // its window, then the card picker, the open card's inside and the side card as rows, as off the terminal.
    // A Raster takes no press: the picker and the inspector's Select replace the Client's click, the
    // buttons and the camera that follows the running card replace its drag.
    type Draw = { geo: Geometry; live?: Record<string, { state: 'pending' | 'running' | 'done' | 'failed'; note?: string; progress?: number; isEstimate?: boolean }>; selected?: string; warn?: Record<string, { n: number; text: string }>; follow?: string; workers?: Record<string, Worker[]>; critical?: Set<string> }
    const panNow = await read($, pan)
    const rasterCanvas = (key: string, f: Draw, cards: { id: string; label: string }[], body: Expand['body'], side: SideCard | null, windowRows: number, animate: boolean) => {
      if (!Raster) return null
      // A body too short to show the grid at all reads as nothing: say so, and list the steps as text.
      if (rows < Math.min(SQUEEZED, f.geo.height)) {
        const steps = f.geo.cards.filter(c => c.kind !== 'start' && c.kind !== 'end').sort((a, b) => a.y - b.y || a.x - b.x)
        return (
          <Box key={`${key}-hold`} flexDirection="column">
            <Text key={`${key}-sq`} wrap="truncate-end" color="#e5c07b">{`↕ Too short for the diagram (${rows} row${rows > 1 ? 's' : ''}): enlarge the pane.`}</Text>
            <Text key={`${key}-sq-steps`} wrap="wrap">{steps.map(c => `${c.label}${c.model ? ` (${c.model})` : ''}`).join(' → ')}</Text>
          </Box>
        )
      }
      const width = Math.max(10, cols - 1)
      let drawing: RenderElement
      let sc: Scene | null = null
      if (zoomOf(cols) === 'compact') drawing = Raster({ key, ...compact(f.geo, f.live, f.workers, width, MODEL_COLOR) })
      else {
        sc = scene({ ...f, columns: width, rows: windowRows, pan: panNow, now })
        drawing = Raster({ key, columns: sc.base.columns, rows: sc.base.rows, cells: frame(sc, Math.floor(now / FRAME_MS)) })
        if (animate) {
          rasterScene = sc
          if (sc.isMoving) {
            if (!blitLoop?.isRunning) {
              blitFrom = Math.floor(now / FRAME_MS)
              blitLoop = loop({ every: (ms, fn) => $.clock.every(ms, fn), blit: a => $.ui.blit(a), requestId: PANE, key, fps: 1000 / FRAME_MS, frame: n => (rasterScene?.isMoving ? frame(rasterScene, blitFrom + n) : null) })
            }
            blitLoop.wake()
          }
        }
      }
      const s0 = sc
      const isBig = !!s0 && (s0.base.columns < f.geo.width + 1 || s0.base.rows < f.geo.height)
      const move = (dx: number, dy: number) => async () => { const at = await $.clock.now(); await update($, pan, () => ({ left: Math.max(0, s0!.left + dx), top: Math.max(0, s0!.top + dy), manualAt: at })) }
      return (
        <Box key={`${key}-hold`} flexDirection="column" flexShrink={0}>
          {drawing}
          {isBig ? (
            <Box key={`${key}-pan`}>
              <Button key={`${key}-pan-l`} label="◀" onPress={move(-20, 0)} />
              <Button key={`${key}-pan-r`} label="▶" onPress={move(20, 0)} />
              <Button key={`${key}-pan-u`} label="▲" onPress={move(0, -10)} />
              <Button key={`${key}-pan-d`} label="▼" onPress={move(0, 10)} />
              {panNow ? <Button key={`${key}-pan-f`} label="Follow" onPress={() => update($, pan, () => null)} /> : null}
              <Text dimColor>{`  columns ${s0!.left}–${s0!.left + s0!.base.columns} of ${f.geo.width}, rows ${s0!.top}–${s0!.top + s0!.base.rows} of ${f.geo.height}${panNow ? '' : ' · following'}`}</Text>
            </Box>
          ) : null}
          {Select && cards.length
            // ponytail: a Select holds 64 options; past that the first 64 cards, as off the terminal.
            ? <Select key={`${key}-pick`} label="card" value={f.selected} options={cards.slice(0, 64).map(c => ({ value: c.id, label: c.label.slice(0, 60) }))} onSelect={(v: string) => update($, selected, () => v)} />
            : null}
          {/* The open card's goal, task and deliverable, framed and read whole (the grid cuts them to the card). */}
          {body.length ? <Box key={`${key}-body`} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>{body.filter(l => l.t.trim()).map((l, i) => <Text key={`${key}-body${i}`} wrap="wrap" {...(l.c ? { color: l.c } : {})} {...(l.b ? { bold: true } : {})}>{l.t}</Text>)}</Box> : null}
          {/* The review / orchestrator card, framed, every line whole. */}
          {side ? (
            <Box key={`${key}-side`} flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
              <Text key={`${key}-side-t`} bold color="cyan">{side.title}{side.badge ? <Text dimColor> · {side.badge}</Text> : null}</Text>
              {side.lines.filter(l => l.t.trim()).map((l, i) => <Text key={`${key}-side${i}`} wrap="wrap" {...(l.c ? { color: l.c } : {})} {...(l.b ? { bold: true } : {})} {...(l.d ? { dimColor: true } : {})}>{l.t}</Text>)}
            </Box>
          ) : null}
        </Box>
      )
    }

    const viewedId = await read($, agentView)
    const viewed = viewedId ? r?.agents.find(a => a.id === viewedId) : undefined
    const tabs = (
      <Box>
        {(['plan', 'live', 'history'] as const).map(k => (
          <Button key={`t-${k}`} variant={t === k ? 'primary' : 'secondary'} label={k === 'plan' ? 'Plan' : k === 'live' ? 'Live' : 'History'} onPress={() => update($, tab, () => k)} />
        ))}
        {viewed ? <Button key="t-agent" variant={t === 'agent' ? 'primary' : 'secondary'} label={`Agent: ${viewed.label.slice(0, 24)}`} onPress={() => update($, tab, () => 'agent' as const)} /> : null}
        <Text dimColor>{t === 'agent' ? '  wheel or ↑↓ scrolls' : t === 'plan' && Client ? '  click a card to open it · m cycles its model · wheel or ↑↓ scrolls · drag or Shift+←/→ pans' : Svg ? '  pick a card under the flowchart to open it · hover a card to light its edges · Open shows an agent\'s story' : '  pick a card under the flowchart to open it · wheel or ↑↓ scrolls · ◀ ▶ ▲ ▼ pan a big graph · Open shows an agent\'s story'}</Text>
      </Box>
    )

    // --- History: past runs this machine costed (workflow-gate's own cache).
    if (t === 'history') {
      // Runs this mod wrote a retro for ($.store), then runs workflow-gate's history viewer costed.
      const keys = ((await $.store.keys().catch(() => [])) as string[]).filter(k => k.startsWith('retro:'))
      const retros = (await Promise.all(keys.map(async k => [k.slice(6), (await $.store.get(k).catch(() => undefined)) as RetroRecord | undefined] as const)))
        .filter((x): x is readonly [string, RetroRecord] => !!x[1]).sort((a, b) => b[1].at - a[1].at)
      let costed: [string, { at: number; total: number; agents: { model?: string }[] }][] = []
      try { costed = Object.entries(JSON.parse(await $.fs.read(`${await home($)}/.claude/workflow-gate-cost-cache.json`))) } catch {}
      costed = costed.filter(([id]) => !retros.some(([rid]) => rid === id)).sort((a, b) => b[1].at - a[1].at)
      const open = await read($, historyOpen)
      const when = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      const mark = { yes: '✓', partial: '~', no: '✗' } as const
      const tone = { yes: 'green', partial: 'yellow', no: 'red' } as const
      const learned = Object.entries(effRecords()).sort((a, b) => (b[1].lastAt ?? 0) - (a[1].lastAt ?? 0)).slice(0, 8)
      const proposals = ((await $.store.keys().catch(() => [])) as string[]).filter(k => k.startsWith('mission:')).length
      return (
        <Box flexDirection="column">
          {tabs}
          <Text bold>Retros · {retros.length} run{retros.length === 1 ? '' : 's'} judged by Opus</Text>
          {retros.length ? null : <Text dimColor>No retro yet: one is written 15 s after a run's last agent ends, while this session is open.</Text>}
          {retros.map(([id, x]) => (
            <Box key={`rt-${id}`} flexDirection="column">
              <Box>
                <Button key={`h-${id}`} label={open === id ? 'Close' : 'Open'} onPress={() => update($, historyOpen, cur => (cur === id ? null : id))} />
                <Text wrap="truncate-end"> <Text color={x.delivered === x.cards ? 'green' : 'yellow'}>{`${x.delivered}/${x.cards} delivered`}</Text>{`  ${when(x.at)}  ${x.name}${x.cost ? ` · $${x.cost.toFixed(2)}` : ''}${x.startedAt ? ` · ${mmss(x.at - x.startedAt)}` : ''}`}</Text>
              </Box>
              {open === id ? (
                <Box flexDirection="column">
                  {(x.verdicts ?? []).map((v, i) => <Text key={`v${i}`} wrap="wrap" color={tone[v.delivered]}>    {mark[v.delivered]} {v.card} — {v.why}</Text>)}
                  {x.flags ? <Text dimColor>    checks during the run: {x.flags.founded} founded, {x.flags.unfounded} unfounded</Text> : null}
                  <Text wrap="wrap" bold>    → next time: {x.summary}</Text>
                </Box>
              ) : <Text wrap="truncate-end" dimColor>    → {x.summary}</Text>}
            </Box>
          ))}
          {learned.length ? <Text bold>Track record by step · what the retros taught</Text> : null}
          {learned.map(([label, rec]) => <Text key={`l-${label}`} wrap="truncate-end" dimColor>  {label}: {recordLine(rec)}</Text>)}
          {proposals ? <Text color="magenta">  {proposals} rewritten mission{proposals > 1 ? 's' : ''} wait for the next plan of their workflow (Replay / Use / Drop there)</Text> : null}
          {team.mode !== 'off' ? <Text bold>Team lessons on designing workflows · {teamLessons.length} from {new Set(teamRuns.map(x => x.user)).size} people · {team.mode === 'share' ? 'yours are shared' : 'read only'}</Text> : null}
          {teamLessons.slice(0, 10).map((x, i) => <Text key={`tl${i}`} wrap="wrap">  <Text color="cyan">[{x.topic}]</Text> {x.lesson}<Text dimColor>{`${x.when ? ` — when ${x.when}` : ''} · ${x.user}${x.times > 1 ? ` · ×${x.times}` : ''}`}</Text></Text>)}
          {team.mode !== 'off' && !teamLessons.length ? <Text dimColor>  Nothing shared yet on {team.branch}.</Text> : null}
          {costed.length ? <Text bold>Costed by workflow-gate · no retro</Text> : null}
          {costed.slice(0, 10).map(([id, x]) => <Text key={id} wrap="truncate-end" dimColor>  {when(x.at)}  {id}  ${x.total.toFixed(2)}  {x.agents.length} agents</Text>)}
          <Text dimColor>Retros and project learnings stay here: ~/.claude/plugins/store/workflow-gate-terminal_*.json · workflow-design lessons are shared on {team.remote.replace(/^https:\/\/github.com\//, '')}@{team.branch} · set in /config</Text>
        </Box>
      )
    }

    // --- Live: the approved graph, painted with what each call site's agents are doing.
    // --- Agent: one agent's story, oldest first, ending on what it returned.
    if (t === 'agent') {
      if (!r || !viewed) return <Box flexDirection="column">{tabs}<Text dimColor>Open an agent from the Live tab.</Text></Box>
      const g = r.source ? graphOf(r.source).graph : null
      const node = g?.nodes.find(n => n.id === viewed.cardId)
      const s = node ? summaries.get(missionKey(cardLabel(node), missionOf(node))) : undefined
      const story = (await read($, timelines))[viewed.id ?? ''] ?? []
      const result = viewed.id ? (await journalOf($, r)).get(viewed.id)?.result : undefined
      const style: Record<TimelineEntry['kind'], { mark: string; color?: string; dim?: boolean }> = {
        thought: { mark: '💭', dim: true }, text: { mark: '💬', color: 'white' }, tool: { mark: '🔧', color: 'gray' },
        flag: { mark: '⚠', color: 'yellow' }, steer: { mark: '🧭', color: 'cyan' }, end: { mark: '■', color: 'green' },
      }
      const color = { running: 'yellow', done: 'green', failed: 'red' } as const
      return (
        <Box flexDirection="column">
          {tabs}
          <Text bold color={color[viewed.status]}>{viewed.status === 'running' ? '●' : viewed.status === 'done' ? '✓' : '✗'} {viewed.label} <Text dimColor>{`· ${viewed.model ?? ''} · ${viewed.steps ?? 0} requests · ${viewed.cost ? `$${viewed.cost.toFixed(2)} · ` : ''}${mmss((viewed.endedAt ?? now) - viewed.startedAt)}`}</Text></Text>
          {s ? <Text wrap="wrap">🎯 {s.goal}</Text> : null}
          {s ? <Text wrap="wrap" dimColor>📦 {s.delivers}</Text> : null}
          <Text dimColor>{'─'.repeat(Math.max(10, cols - 2))}</Text>
          {story.length ? null : <Text dimColor>Nothing recorded yet: entries appear as the agent thinks, writes and uses tools.</Text>}
          {story.map((x, i) => {
            const st = style[x.kind]
            const mark = x.kind === 'tool' ? (x.ok === false ? '✗' : '✓') : st.mark
            return <Text key={`e${i}`} wrap="wrap" color={x.kind === 'tool' && x.ok === false ? 'red' : st.color} dimColor={st.dim}>{new Date(x.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} {mark} {x.kind === 'tool' ? x.text : x.text.replace(/\s+/g, ' ')}</Text>
          })}
          {result ? <Text bold color="green">→ What it returned</Text> : null}
          {result ? prettyResult(result).map((l, i) => <Text key={`r${i}`} wrap="wrap">  {l}</Text>) : null}
          {viewed.status === 'running' ? <Text color="yellow">● now: {viewed.doing ?? 'thinking'}</Text> : null}
          <Box><Button key="back-live" label="◂ Live" onPress={() => update($, tab, () => 'live' as const)} /></Box>
        </Box>
      )
    }

    if (t === 'live') {
      if (!r) return <Box flexDirection="column">{tabs}<Text dimColor>No run yet in this session.</Text></Box>
      const g = r.source ? graphOf(r.source).graph : null
      const live: Record<string, { state: 'pending' | 'running' | 'done' | 'failed'; note?: string; progress?: number; isEstimate?: boolean }> = {}
      for (const n of g?.nodes ?? []) {
        const mine = r.agents.filter(a => a.cardId === n.id)
        if (!mine.length) { live[n.id] = { state: 'pending', note: 'not started', progress: 0 }; continue }
        const bars = mine.map(a => agentProgress(a, r.expected?.[n.id]))
        const of = n.fanOut?.n ?? mine.length
        const running = mine.filter(a => a.status === 'running'), failed = mine.filter(a => a.status === 'failed')
        const done = mine.filter(a => a.status === 'done').length
        const last = running.at(-1)?.doing ?? running.at(-1)?.lastTool
        live[n.id] = {
          state: running.length ? 'running' : failed.length ? 'failed' : 'done',
          progress: bars.reduce((t, b) => t + b.progress, 0) / Math.max(of, mine.length),
          isEstimate: bars.some(b => b.isEstimate),
          note: `${mine.some(a => a.cost) ? `$${mine.reduce((t, a) => t + (a.cost ?? 0), 0).toFixed(2)} · ` : ''}${done}/${mine.length} done${failed.length ? ` · ${failed.length} failed` : ''} · ${mmss((running.length ? now : Math.max(...mine.map(a => a.endedAt ?? now))) - Math.min(...mine.map(a => a.startedAt)))}${last ? ` · ${last}` : ''}${mine.some(a => a.isGuess) ? ' · placed by order' : ''}`,
        }
      }
      const usd = (await $.session.usage()).cost?.usd
      const spent = usd != null && r.costAt != null ? ` · ~$${(usd - r.costAt).toFixed(2)} so far` : ''
      const openNode = sel ? g?.nodes.find(n => n.id === sel) : undefined
      const openW = Math.min(68, graphCols(cols - 1) - 4)
      // The Svg draws the open card's inside in the card; the Raster leaves it as rows under the canvas.
      const openBody = openNode ? expandFor(openNode, openW, r.agents.filter(a => a.cardId === openNode.id)) : undefined
      const geo = g ? geoOf(g, Raster ? cols - 1 : graphCols(cols - 1), Raster ? undefined : openBody) : null
      const sidePos = geo ? (Raster ? { x: 0, y: 0, w: Math.max(30, cols - 2) } : placeSide(cols - 1, geo)) : null
      const side = sidePos && {
        ...sidePos,
        title: '🧭 Orchestrator · Opus',
        badge: `${(r.flags ?? []).length} checks · ${r.opusCalls ?? 0} Opus`,
        // The newest checks only: the card stays readable and the canvas under its size cap.
        lines: [...orchestratorLines((r.flags ?? []).slice(-8), r.decisions ?? [], { opusCalls: r.opusCalls ?? 0, checks: r.checks ?? 0, error: r.opusError, retro: r.retro }, sidePos.w), ...((r.flags ?? []).length > 8 ? [{ t: '' }, { t: `… ${(r.flags ?? []).length - 8} older checks — each agent's story (Open) keeps its own`, c: '#7f848e' }] : [])],
      }
      const running = [...(geo?.cards ?? [])].sort((p, q) => p.y - q.y).find(c => live[c.id]?.state === 'running')
      // The Svg's camera and the Raster's window follow the running card themselves; the Client scrolled the pane.
      // One line per agent: the selected card's, or every agent when nothing is selected.
      const shown = r.agents.filter(a => !sel || !geo || a.cardId === sel)
      const selNode = sel ? g?.nodes.find(n => n.id === sel) : undefined
      const mine = selNode ? r.agents.filter(a => a.cardId === selNode.id) : []
      const isAsking = (r.decisions ?? []).some(d => (d.action === 'ask_human' || d.action === 'stop_run') && !d.isAnswered)
      const color = { running: 'yellow', done: 'green', failed: 'red' } as const
      return (
        <Box flexDirection="column">
          {tabs}
          <Text bold>{r.name}{r.agents.some(a => a.cost) ? ` · $${r.agents.reduce((t, a) => t + (a.cost ?? 0), 0).toFixed(2)} this run` : ''} · {r.agents.filter(a => a.status === 'done').length}/{r.agents.length} done · launched {r.agents.length}{r.sites ? ` vs ≥${r.sites} approved` : ''} · {mmss(now - r.startedAt)}{spent}</Text>
          {geo && Svg
            ? svgCanvas('canvas-live', {
              geo, live, selected: sel ?? undefined, warn: warnOf(r.flags ?? []), follow: sel ?? running?.id, workers: workersOf(g, r),
            }, `live:${r.name}:${r.startedAt}`, (g?.nodes ?? []).map(n => ({ id: n.id, label: cardLabel(n) })), side, `Live flowchart of ${r.name}: ${r.agents.filter(a => a.status === 'done').length}/${r.agents.length} agents done${running ? `, ${running.label} running` : ''}`, openBody?.body ?? [])
            : geo
            // In Live the Raster is a window of the pane's body that follows the running card (it is blitted, so kept small).
            ? rasterCanvas('canvas-live', {
              geo, live, selected: sel ?? undefined, warn: warnOf(r.flags ?? []), follow: sel ?? running?.id, workers: workersOf(g, r),
              critical: criticalPath(geo, live, id => r.expected?.[id] ?? 1),
            }, (g?.nodes ?? []).map(n => ({ id: n.id, label: cardLabel(n) })), openBody?.body ?? [], side, Math.min(LIVE_ROWS, Math.max(12, rows - 6)), true)
            : null}
          {selNode ? <Text bold color="cyan" wrap="truncate-end">▸ {cardLabel(selNode)} · {mine.length ? `${mine.length} agent${mine.length > 1 ? 's' : ''}` : 'not started'}  <Text dimColor>{(selNode.assembled || selNode.mission || '').replace(/\\n/g, ' ').replace(/\s+/g, ' ')}</Text></Text> : null}
          {shown.slice(0, 12).map((a, i) => {
            const b = agentProgress(a, a.cardId ? r.expected?.[a.cardId] : undefined)
            const what = a.status === 'running' ? (a.doing ?? a.thought ?? 'thinking') : a.status === 'done' ? 'done' : 'failed'
            const n = r.agents.filter(x => x.cardId === a.cardId).indexOf(a)
            return (
              <Box key={`a${i}`}>
                <Button key={`open-${a.id ?? i}`} label="Open" onPress={() => (a.id ? openAgent($, a.id) : undefined)} />
                <Text color={color[a.status]} wrap="truncate-end"> {a.status === 'running' ? '●' : a.status === 'done' ? '✓' : '✗'} {bar(b.progress, 12, b.isEstimate)} <Text color="white">{a.label.slice(0, 24)}{n > 0 || r.agents.filter(x => x.cardId === a.cardId).length > 1 ? ` #${n + 1}` : ''}</Text><Text dimColor>{` · ${what.slice(0, Math.max(20, cols - 70))} · ${a.steps ?? 0} req · ${a.cost ? `$${a.cost.toFixed(2)} · ` : ''}${mmss((a.endedAt ?? now) - a.startedAt)}`}</Text></Text>
              </Box>
            )
          })}
          {shown.length > 12 ? <Text dimColor>+{shown.length - 12} more agents · select a card to narrow the list</Text> : null}
          {isAsking
            ? <Box><Text color="magenta">🧭 Opus is waiting for your answer (dialog dismissed?) </Text><Button key="opus-stop" label="Stop run" onPress={() => stopRun($)} /><Button key="opus-go" label="Let it run" onPress={() => letItRun($)} /></Box>
            : null}
          <Text dimColor>~ = estimated from past runs of this label (model requests so far vs. their median). Stop a run: /workflows.</Text>
        </Box>
      )
    }

    // --- Plan: the flowchart to approve, the selected card's detail beside the actions.
    if (!p || p.status !== 'pending') return <Box flexDirection="column">{tabs}<Text dimColor>No workflow plan waiting for approval.</Text></Box>
    const { graph: g } = graphOf(p.source, p.edits)
    // One-click improvements: learned tiers, Opus's patchable fixes, rewritten missions.
    const fixes = (p.review?.items ?? []).map((it, i) => ({ it, i })).filter(x => x.it.patch)
    const what = (pt: NonNullable<NonNullable<NonNullable<Plan['review']>['items']>[number]['patch']>) => [pt.model && `→ ${pt.model}`, pt.missionAppend && 'mission +', pt.cascade && 'cascade'].filter(Boolean).join(', ')
    const improve = (Object.keys(p.tiers ?? {}).length || fixes.length || Object.keys(p.proposals ?? {}).length) ? (
      <Box key="improve" flexWrap="wrap">
        {Object.keys(p.tiers ?? {}).length ? <Button key="apply-tiers" label={`Apply learned tiers (${Object.keys(p.tiers ?? {}).length})`} onPress={() => applyTiers($)} /> : null}
        {fixes.map(({ it, i }) => <Button key={`fix-${i}`} label={`[${i + 1}] ${it.card}: ${what(it.patch!)}`} onPress={() => applyFix($, i)} />)}
        {Object.values(p.proposals ?? {}).flatMap(pr => [
          pr.replay?.status === 'running' ? null : <Button key={`replay-${pr.label}`} label={`Replay ${pr.label}`} onPress={() => replayMission($, pr.label)} />,
          <Button key={`adopt-${pr.label}`} label={`Use new mission: ${pr.label}`} onPress={() => adoptMission($, pr.label)} />,
          <Button key={`drop-${pr.label}`} label={`Drop`} onPress={() => dropMission($, pr.label)} />,
        ])}
      </Box>
    ) : null
    const actions = (
      <Box>
        <Button key="approve" variant="primary" label="Approve & run" onPress={() => approve($)} />
        <Button key="browser" label="Browser editor" onPress={() => browser($)} />
        <Button key="cancel" label="Cancel" onPress={() => cancel($)} />
      </Box>
    )
    if (!g) { // the parser could not read it: the plain list, as before
      return (
        <Box flexDirection="column">
          {tabs}
          <Text color="yellow">The flowchart parser could not read this script; showing call sites.</Text>
          {p.sites.map((s, i) => <Text key={`s${i}`}>{s.isFanOut ? '×N ' : '   '}{s.phase ? `[${s.phase}] ` : ''}{s.label} · {p.models[i] ?? s.model ?? 'inherited'} — {s.purpose}</Text>)}
          {actions}
        </Box>
      )
    }
    const edited = Object.keys(p.edits ?? {}).length
    const flags = planFlags(g as never, graphOf(p.source, p.edits).source)
    const openNode = sel ? g.nodes.find(n => n.id === sel) : undefined
    const openBody = openNode && expandFor(openNode, Math.min(68, graphCols(cols - 1) - 4))
    const isGrid = !!Raster && !Client // the Raster lays the graph full width, the open card and the review card under it
    const geo = geoOf(g, isGrid ? cols - 1 : graphCols(cols - 1), isGrid ? undefined : openBody)
    const node = g.nodes.find(n => n.id === sel) ?? g.nodes[0]
    const uses = node ? g.edges.filter(x => x.target === node.id).map(x => g.nodes.find(n => n.id === x.source)?.label).filter(Boolean) : []
    const feeds = node ? g.edges.filter(x => x.source === node.id).map(x => g.nodes.find(n => n.id === x.target)?.label).filter(Boolean) : []
    const hasModelSlot = !!(node && (node.modelSpan || node.modelInsert))
    const flagLabel = (f: Flag) => g.nodes.find(n => n.id === f.cardId)?.label ?? g.flow.nodes.find(n => n.id === f.cardId)?.label ?? f.cardId
    const sidePos = isGrid ? { x: 0, y: 0, w: Math.max(30, cols - 2) } : placeSide(cols - 1, geo)
    const side = { ...sidePos, title: '🧭 Review · plan', badge: p.review?.status === 'done' ? (p.review.verdict === 'ok' ? 'Opus ✓' : `Opus: ${p.review.items?.length} concerns`) : flags.length ? `${flags.length} flags` : 'clean', lines: planLines(flags, flagLabel, sidePos.w, p.review, effRecords(), g.nodes.map(cardLabel), {
      tiers: Object.entries(p.tiers ?? {}).map(([id, s]) => ({ label: cardLabel(g.nodes.find(n => n.id === id) ?? { label: id }), ...s })),
      proposals: Object.values(p.proposals ?? {}),
    }) }
    const detailRows = 9 + (Object.keys(p.tiers ?? {}).length || (p.review?.items ?? []).some(x => x.patch) || Object.keys(p.proposals ?? {}).length ? 2 : 0)
    return (
      <Box flexDirection="column">
        {tabs}
        <Text bold>{p.name} · ≥{g.minAgents} agents · {tierMixOf(g, p)}{g.phases.length ? ` · ${g.phases.join(' → ')}` : ''}{edited ? ` · ${edited} edited` : ''}</Text>
        {Client
          ? <Box key="canvas-plan-hold" flexShrink={0}><Client key="canvas-plan" module="./canvas.tsx" props={json({ geo, selected: node?.id, warn: warnOf(flags), side, cols: cols - 1, win: winOf(e), follow: node?.id })} width={cols - 1} height={Math.max(geo.height, side.y + side.lines.length + 2)} /></Box>
          : Svg
          ? svgCanvas('canvas-plan', { geo, selected: node?.id, warn: warnOf(flags), follow: node?.id }, `plan:${p.name}`, g.nodes.map(n => ({ id: n.id, label: cardLabel(n) })), side, `Flowchart of ${p.name}: ${g.nodes.length} steps, ${tierMixOf(g, p)}`, openBody?.body ?? [])
          : Raster
          // In Plan the Raster is the whole graph (at most 256 rows) and the pane scrolls it: nothing moves, no blit.
          ? rasterCanvas('canvas-plan', { geo, selected: node?.id, warn: warnOf(flags), follow: node?.id }, g.nodes.map(n => ({ id: n.id, label: cardLabel(n) })), openBody?.body ?? [], side, MAX.rows, false)
          : <Text dimColor>This surface draws no canvas; use the browser editor.</Text>}
        {node ? (
          <Box flexDirection="column">
            <Box>
              <Text bold>▸ {node.label}</Text>
              <Text dimColor>{node.phase ? `  [${node.phase}]` : ''}{node.fanOut ? `  ×${node.fanOut.n ?? 'N'} over ${node.fanOut.over}` : ''}{node.guard ? `  ${node.guard.else ? 'else of' : 'if'} ${node.guard.text}` : ''}  </Text>
              {Select && hasModelSlot
                ? <Select key={`model-${node.id}`} label="model" value={modelOf(g, node.id) === 'inherited' ? undefined : modelOf(g, node.id)} options={TIERS.map((x: string) => ({ value: x, label: x }))} onSelect={(v: string) => setModel($, node.id, v)} />
                : <Text dimColor>model {node.modelText ?? modelOf(g, node.id)} (decided at runtime)</Text>}
            </Box>
            <Text dimColor>uses: {uses.join(', ') || '—'}   feeds: {feeds.join(', ') || '—'}   {node.agentType ? `agentType ${node.agentType}` : 'no agentType: every MCP tool of the session, writes included'}{node.schemaKeys?.length ? `   schema: ${node.schemaKeys.join(', ')}` : ''}</Text>
            {node.context?.length ? <Text dimColor>⟨⟩ {node.context.map(c => `${c.expr}: ${c.kind}`).join(' · ')}</Text> : null}
            <Text wrap="wrap">{(node.assembled || node.mission || '(prompt built at runtime)').slice(0, cols * 4)}</Text>
            {Input && node.missionSpan
              ? <Input key={`mission-${node.id}`} label="mission" placeholder="Rewrite this agent's literal mission, Enter to apply" value={p.edits?.[node.id]?.mission ?? node.mission ?? ''} submitLabel="Apply" onSubmit={(v: string) => setMission($, node.id, v)} />
              : null}
          </Box>
        ) : null}
        {improve}
        {actions}
      </Box>
    )
  })
}
