import type { Brief, CheckRun, Change, Mark } from './board.ts'
import { liveBackground } from './peers.ts'
// PLAN.md, the project's plan the overseer runs: one `## [s] N. Title` section per lot, with
// `done when:`, optional `model:`, `depends: 2, 3`, `owner:` (the session that must take it) and
// `check:` (a shell command run on the lot's branch before it can be marked done) lines; the overseer writes `session:`,
// `branch:` and `note:` lines and the status mark: [ ] todo, [~] running, [x] done, [!] blocked, [?] proposed (waits for Victor's approval, never handed out).

export type LotStatus = 'todo' | 'running' | 'done' | 'blocked' | 'proposed'
export type Lot = { n: number; title: string; status: LotStatus; doneWhen: string; model?: string; owner?: string; check?: string; depends: number[]; session?: string; branch?: string; note?: string; verdict?: Verdict; verdictAt?: number; body: string; brief?: Brief; base?: string; tip?: string; dirty?: { path: string; add: number; del: number }[]; checkResult?: string | CheckRun; retry?: Verdict; marks?: Mark[]; gaps?: string[]; changes?: Change[]; review?: string }
// The judge's last verdict on the lot, kept in PLAN.md as `verdict: done | note` and `verdictAt: <ms>`.
export type Verdict = { verdict: 'done' | 'blocked' | 'retry'; note: string }

const MARK: Record<string, LotStatus> = { ' ': 'todo', '~': 'running', x: 'done', X: 'done', '!': 'blocked', '?': 'proposed' }
const MARK_OF: Record<LotStatus, string> = { todo: ' ', running: '~', done: 'x', blocked: '!', proposed: '?' }
const HEAD = /^## \[([ ~xX!?])\] (\d+)\.\s*(.*)$/

// The task format's keys: prose keys hold text; list keys take one item per line, then "- " lines.
const PROSE = new Set(['type', 'problem', 'direction', 'question', 'linear', 'lots', 'version'])
const LISTS = new Set(['done when', 'options', 'not in', 'keep', 'risk'])
function add(b: Brief, key: string, v: string) {
  if (!v) return
  if (key === 'options') (b.options ??= []).push(...v.split(' | ').map(x => x.trim()).filter(Boolean))
  else if (key === 'not in') (b.notIn ??= []).push(v)
  else if (key === 'keep') (b.keep ??= []).push(v)
  else if (key === 'risk') { const [e, ...m] = v.split(/\s*(?:→|->)\s*/); (b.risk ??= []).push({ event: e!.trim(), mitigation: m.join(' → ').trim() }) }
}
// The required fields per type, named as parsePlan's keys; ste100:issue's Task mode table must match (web/task-mode.test.mjs).
export const REQUIRED: Record<NonNullable<Brief['type']>, string[]> = {
  bug: ['problem', 'done when'], feature: ['problem', 'done when'], probe: ['question', 'done when'],
  decision: ['question', 'options'], integration: ['lots'],
}
const LACKS: Record<string, (b: Brief) => string | undefined> = {
  problem: b => b.type === 'bug' ? (b.problem?.includes('Cause:') ? undefined : 'problem with Cause:') : b.problem ? undefined : 'problem',
  'done when': b => b.type === 'bug' ? (b.criteria.some(c => /regression/i.test(c)) ? undefined : 'a regression test in done when') : b.criteria.length ? undefined : 'done when',
  question: b => b.question ? undefined : 'question',
  options: b => b.options?.length && b.options.length <= 3 ? undefined : 'options (1 to 3)',
  lots: b => b.lots?.length ? undefined : 'lots',
}
// What a typed lot still lacks before it can be handed out; an untyped lot lacks nothing.
export const missing = (b: Brief): string[] => (b.type ? REQUIRED[b.type] ?? [] : []).flatMap(f => LACKS[f]!(b) ?? [])

export function parsePlan(md: string): { goal: string; lots: Lot[] } {
  const goal = md.match(/^# (?:Plan\s*[—:-]\s*)?(.+)$/m)?.[1]?.trim() ?? ''
  const lots: Lot[] = []
  let cur: Lot | undefined
  let open: string | undefined // the list key a "- " line continues
  const bullets = new Map<Lot, string[]>()
  for (const line of md.split('\n')) {
    const h = line.match(HEAD)
    if (h) { cur = { n: Number(h[2]), title: h[3]!.trim(), status: MARK[h[1]!]!, doneWhen: '', depends: [], body: '' }; lots.push(cur); open = undefined; continue }
    if (/^#{1,2} /.test(line)) { cur = undefined; open = undefined; continue }
    if (!cur) continue
    const f = line.match(/^(done when|model|owner|check|depends|session|branch|note|verdict|verdictat|base|review|check result|retry|marks|gap|change|type|problem|direction|question|options|not in|keep|risk|linear|lots|version):\s*(.*)$/i)
    const key = f?.[1]?.toLowerCase()
    const b = (cur.brief ??= { criteria: [] })
    const bullet = line.match(/^- (.+)/)?.[1]?.trim()
    if (!key && bullet && open) { // a "- " line continues the last list key; a blank line, a key or a heading closes it
      if (open === 'done when') { bullets.set(cur, [...(bullets.get(cur) ?? []), bullet]); cur.body += line + '\n' } else add(b, open, bullet)
      continue
    }
    open = key && LISTS.has(key) ? key : undefined
    // the v3 lines setLot writes: base as text, the others as JSON (a line that does not parse is dropped)
    const V3: Record<string, 'checkResult' | 'retry' | 'marks' | 'gaps' | 'changes'> = { 'check result': 'checkResult', retry: 'retry', marks: 'marks', gap: 'gaps', change: 'changes' }
    if (key === 'base') cur.base = f![2]!.trim() || undefined
    else if (key === 'review') cur.review = f![2]!.trim() || undefined
    else if (key && V3[key]) { try { (cur as Record<string, unknown>)[V3[key]!] = JSON.parse(f![2]!) } catch {} }
    else if (key && PROSE.has(key)) { const v = f![2]!.trim(); if (key === 'type') b.type = v.toLowerCase() as Brief['type']; else if (key === 'lots') b.lots = (v.match(/\d+/g) ?? []).map(Number); else (b as Record<string, unknown>)[key] = v || undefined }
    else if (key && LISTS.has(key) && key !== 'done when') add(b, key, f![2]!.trim())
    else if (key === 'done when') cur.doneWhen = f![2]!.trim()
    else if (key === 'model') cur.model = f![2]!.trim() || undefined
    else if (key === 'owner') cur.owner = f![2]!.trim() || undefined
    else if (key === 'check') cur.check = f![2]!.trim().replace(/^`|`$/g, '') || undefined
    else if (key === 'depends') cur.depends = (f![2]!.match(/\d+/g) ?? []).map(Number)
    else if (key === 'verdict') { const [v, ...n] = f![2]!.split(' | '); if (v === 'done' || v === 'blocked' || v === 'retry') cur.verdict = { verdict: v, note: n.join(' | ') } }
    else if (key === 'verdictat') cur.verdictAt = Number(f![2]) || undefined
    else if (key === 'session' || key === 'branch' || key === 'note') cur[key] = f![2]!.trim() || undefined
    else cur.body += line + '\n'
  }
  for (const l of lots) {
    l.body = l.body.trim()
    const bs = bullets.get(l)
    const head = l.doneWhen.replace(/[.\s]*(In detail)?:\s*$/i, '')
    l.brief!.criteria = bs ? [...(head ? [head] : []), ...bs] : l.doneWhen.split(/;\s+/).filter(Boolean)
  }
  return { goal, lots }
}

// Lots whose turn has come: todo, every dependency done.
export const readyLots = (lots: Lot[]) => lots.filter(l => l.status === 'todo' && !(l.brief && missing(l.brief).length) && l.depends.every(d => lots.find(x => x.n === d)?.status === 'done'))

// A lot with an owner goes to that session only: its id (or a prefix of it), its name, role or label.
export const ownedBy = (lot: Pick<Lot, 'owner'>, s: { sessionId: string; label: string; name?: string; role?: string }) =>
  !lot.owner || s.sessionId.startsWith(lot.owner) || [s.label, s.name, s.role].some(x => x?.toLowerCase() === lot.owner!.toLowerCase())

// One lot's status and overseer lines rewritten in place; everything else in the file is kept as is.
// A key set to null loses its line, undefined is skipped; a value that is not a string is written as JSON.
// ponytail: parsePlan does not read the v3 lines back yet; the lot that produces a key adds its parse (CONTRACT.md).
const SET = ['session', 'owner', 'branch', 'note', 'verdict', 'verdictAt', 'base', 'checkResult', 'retry', 'marks', 'gaps', 'changes', 'review'] as const
const LINE: Partial<Record<(typeof SET)[number], string>> = { checkResult: 'check result', gaps: 'gap', changes: 'change' }
export function setLot(md: string, n: number, patch: { [K in 'status' | (typeof SET)[number]]?: Lot[K] | null }): string {
  const lines = md.split('\n')
  const at = lines.findIndex(l => l.match(HEAD)?.[2] === String(n))
  if (at < 0) return md
  if (patch.status) lines[at] = lines[at]!.replace(/^## \[.\]/, `## [${MARK_OF[patch.status]}]`)
  let end = lines.findIndex((l, i) => i > at && /^#{1,2} /.test(l))
  if (end < 0) end = lines.length
  for (const key of SET) {
    const v = patch[key]
    if (v === undefined) continue
    const name = LINE[key] ?? key.toLowerCase()
    const i = lines.findIndex((l, k) => k > at && k < end && l.toLowerCase().startsWith(`${name.toLowerCase()}:`))
    if (v === null) { if (i >= 0) { lines.splice(i, 1); end-- } continue }
    const val = key === 'verdict' ? `${(v as Verdict).verdict} | ${(v as Verdict).note}` : typeof v === 'string' ? v : JSON.stringify(v)
    const text = `${name}: ${val.replace(/\n/g, ' ')}`
    if (i >= 0) lines[i] = text
    else { lines.splice(at + 1, 0, text); end++ }
  }
  return lines.join('\n')
}

export const PLAN_FORMAT = `# Plan — <the goal in one line>

## [ ] 1. <task title>
done when: <a check anyone can run: tests pass, page renders, numbers match>
model: <haiku|sonnet|opus, optional: the cheapest that will do it well>
depends: <task numbers, optional>
owner: <session label or id, optional: only that session may take it>
check: <a shell command that exits 0 when the task is done, optional: the overseer runs it on the task's branch>
<what to do, the files concerned, the constraints>`

// Budget, in points of the weekly limit spent since the run started: half → cheaper, all → stop.
export type Level = 'normal' | 'reduce' | 'stop'
// /oversee status: the lots as a table, then the run's budget line.
export function statusTable(lots: Lot[], label: (sessionId: string) => string, budget?: { spent: number; budget: number; level: Level }): string {
  const cell = (t = '') => t.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  return [
    '| # | task | status | session | note |', '|---|---|---|---|---|',
    ...lots.map(l => `| ${l.n} | ${cell(l.title)} | ${l.status} | ${l.session ? cell(label(l.session)) : '—'} | ${cell(l.note)} |`),
    '',
    budget ? `Budget: ${budget.spent.toFixed(1)} of ${budget.budget} weekly-limit points spent · ${budget.level}` : 'Budget: no run yet (/oversee run [budget pts]).',
  ].join('\n')
}

export const levelOf = (spent: number, budget: number): Level => (spent >= budget ? 'stop' : spent >= budget / 2 ? 'reduce' : 'normal')
export const tierFor = (wanted: string | undefined, level: Level) => {
  const t = (wanted ?? 'sonnet').toLowerCase()
  return level === 'reduce' && t === 'opus' ? 'sonnet' : ['haiku', 'sonnet', 'opus'].includes(t) ? t : 'sonnet'
}

export const LEAD_SYSTEM = `You are the lead of a software project run by several Claude Code sessions. You hold the plan (PLAN.md), the budget and the quality bar.
A session working on one task of the plan has stopped. From its last words and its commits, judge the task: "done" only when its "done when" check is met, with evidence; "blocked" when it cannot be finished without the owner (say what is needed); "retry" when it should keep going or try again with clearer instructions (give them: they are sent to that session).
When a CHECK was run, it is the evidence that counts: a failed check is never "done".
In the note, say if the session ran agents bigger than their task (Opus or Fable on mechanical work, agents with no model): it does not change the verdict, it is for the owner.
Answer ONLY JSON: {"verdict":"done|blocked|retry","note":"<max 200 chars, the evidence or what is missing>","instructions":"<for retry: what the next attempt must do differently, max 600 chars>"}
When DONE WHEN is a numbered list, also mark each criterion, one entry per number, in order: "marks":[{"i":<its number>,"mark":"met|gap|todo","ev":"<max 120 chars: the evidence, or what is missing>"}] ("met": done, with evidence; "gap": done in part, or done otherwise than asked; "todo": not done), and "gaps":["<each open gap, max 160 chars>"].`

// The judge's view of PLAN.md (lot 34): the plan's title, the preamble of the \`##\` section that holds the lot (its rules),
// and the lots it depends on, whole. The lot itself comes in its own block. Not the first 12000 characters of the file.
export function judgeContext(md: string, n: number): string {
  const lines = md.split('\n')
  const at = lines.findIndex(l => l.match(HEAD)?.[2] === String(n))
  if (at < 0) return md.slice(0, 6000)
  const title = lines.find(l => /^# /.test(l)) ?? ''
  // the section: the nearest `## ` heading above the lot that is not a lot, up to the first lot under it
  let s = at - 1
  while (s >= 0 && !(/^## /.test(lines[s]!) && !HEAD.test(lines[s]!))) s--
  let e = s + 1
  while (s >= 0 && e < lines.length && !HEAD.test(lines[e]!)) e++
  const section = s >= 0 ? lines.slice(s, e).join('\n').trim().slice(0, 8000) : ''
  const lot = (k: number) => { const i = lines.findIndex(l => l.match(HEAD)?.[2] === String(k)); if (i < 0) return ''; let j = i + 1; while (j < lines.length && !/^#{1,2} /.test(lines[j]!)) j++; return lines.slice(i, j).join('\n').trim().slice(0, 2500) }
  const deps = (parsePlan(md).lots.find(l => l.n === n)?.depends ?? []).map(lot).filter(Boolean)
  return [title, section && `THE SECTION THAT HOLDS THE LOT (its rules apply):\n${section}`, deps.length ? `THE LOTS IT DEPENDS ON:\n${deps.join('\n\n')}` : ''].filter(Boolean).join('\n\n')
}

// The judge's answer budget: more criteria, more room (1600 for 12).
export const judgeTokens = (criteria: number) => Math.max(800, 400 + 100 * criteria)

// A typed lot's criteria numbered, then its keep and not-in lines; untyped lots print as they always did.
const numbered = (b: Brief) => b.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
const rules = (b: Brief, keep: string, notIn: string) => `${b.keep?.length ? `\n${keep}: ${b.keep.join('; ')}` : ''}${b.notIn?.length ? `\n${notIn}: ${b.notIn.join('; ')}` : ''}`
export function leadPrompt(context: string, lot: Lot, report: string, commits: string, check?: { cmd: string; ok: boolean; out: string }): string {
  const b = lot.brief?.type ? lot.brief : undefined
  return `${context}\n\nLOT ${lot.n}. ${lot.title}\n${b?.criteria.length ? `DONE WHEN:\n${numbered(b)}` : `DONE WHEN: ${lot.doneWhen || '(not stated)'}`}${b ? rules(b, 'KEEP', 'NOT IN') : ''}\n${lot.body}\n\nFINAL REPORT OF THE SESSION:\n${report.slice(-4000) || '(none)'}\n\nCOMMITS ON ITS BRANCH:\n${commits || '(none)'}${check ? `\n\nCHECK \`${check.cmd}\` ${check.ok ? 'PASSED' : 'FAILED'}:\n${check.out.slice(-2500)}` : ''}`
}

// An item a done report leaves for Victor ("Victor must look", "Victor must test", "left for Victor"): the line that says
// so, without its bullet (lot 54). Lot 30 wrote "…in a browser, so Victor must look at them." in its report only.
export function reviewOf(report: string): string | undefined {
  const line = report.split('\n').find(l => /\bVictor must (look|test)\b|\bleft for Victor\b/i.test(l))
  return line?.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim().slice(0, 300) || undefined
}

// The judge's JSON. With n criteria, its marks come back 0-based (the prompt numbers them from 1); marks that are not one
// per criterion, in order, are dropped and the single verdict stands alone.
export function parseVerdict(text: string, criteria = 0): { verdict: 'done' | 'blocked' | 'retry'; note: string; instructions: string; marks?: Mark[]; gaps?: string[] } | undefined {
  const m = text.match(/\{[\s\S]*\}/)
  try {
    const d = m && JSON.parse(m[0])
    if (!d || !['done', 'blocked', 'retry'].includes(d.verdict)) return undefined
    const v = { verdict: d.verdict, note: String(d.note ?? '').slice(0, 240), instructions: String(d.instructions ?? '').slice(0, 800) }
    if (!criteria || !Array.isArray(d.marks)) return v
    const marks: Mark[] = d.marks.map((x: { i?: unknown; mark?: unknown; ev?: unknown }, k: number) => ({ i: Number(x?.i) - 1, mark: x?.mark, k, ev: typeof x?.ev === 'string' && x.ev ? x.ev.slice(0, 160) : undefined }))
      .filter((x: { i: number; mark: unknown; k: number }) => x.i === x.k && ['met', 'gap', 'todo'].includes(x.mark as string))
      .map(({ i, mark, ev }: { i: number; mark: Mark['mark']; ev?: string }) => ({ i, mark, ...(ev ? { ev } : {}) }))
    if (marks.length !== criteria || d.marks.length !== criteria) return v // a length mismatch: the single verdict
    const gaps = Array.isArray(d.gaps) ? d.gaps.filter((g: unknown) => typeof g === 'string' && g.trim()).map((g: string) => g.slice(0, 200)).slice(0, 12) : []
    return { ...v, marks, gaps }
  } catch {
    return undefined
  }
}

// A check's run as the board shows it: passed or not, when, the test counts of a bun or node summary, the last 20 lines.
export function checkRun(ok: boolean, at: number, out: string): CheckRun {
  let pass = 0, fail = 0, seen = false
  for (const m of out.matchAll(/(?:^|[\s✔✘])(\d+) (pass|fail)\b|ℹ (pass|fail) (\d+)/gm)) {
    const [k, n] = m[2] ? [m[2], Number(m[1])] : [m[3]!, Number(m[4])]
    seen = true
    if (k === 'pass') pass += n; else fail += n
  }
  return { ok, at, ...(seen ? { tests: { pass, fail } } : {}), tail: out.split('\n').slice(-20).join('\n') }
}

// What a watched session is told with its first lot.
export const SESSION_RULES = (goal: string) => `You are one of several Claude Code sessions an overseer runs on the project "${goal}". It gives you tasks of PLAN.md one at a time.
- Work on a branch of your own; commit locally with conventional commits after each step. Never push, merge, deploy, delete branches or send messages to people: those are left for the owner.
- Size every agent: in a workflow, give EACH agent() an explicit \`model\` (an agent without one inherits the session's model, Opus): haiku for mechanical work (tests, captures, builds, file moves), sonnet for code and verification, opus only for orchestration or a hard critique, Fable or an advisor only for a real doubt. Opus or Fable everywhere spends the budget for nothing.
- Verify against the task's "done when" before you say it is done.
- The plan evolves: if you find work outside your task that should be done, write \`[new task: <title> — <why>]\` and carry on with your task; the owner decides whether to open it.
- When you ask the owner a question, also write \`[ask: <question> | recommend: <option> — <why>]\` on its own last line.
- Messages starting with [overseer] come from the lead: follow them.
- A message starting with [overseer-change] is a change request on your task (\`task N · file:line · text\`): make it, commit, and write \`[change N done]\` on a line of its own when every request of the task is made.
- When the task is done, end with a short report (what is done, the evidence for "done when", what is left) and a last line \`[task N done on <your branch>]\`. If you cannot finish it, end with \`[task N blocked: <what you need>]\`. Until you write one of these, the task counts as in progress, however long it takes.`

// A watched session is free for a lot when it spoke last, asks nothing and runs nothing. Plan mode is never free (it refuses a lot);
// the registry's idle is free at once, busy/waiting/shell is not; with no registry entry, quiet for 2 min.
export const isIdle = (p: { lastRole?: string; question?: string; lastAt: number; busySince?: number; background?: string[]; bgSeen?: Record<string, number>; mode?: string }, now: number, reg?: { status?: string }, ms = 2 * 60e3) => {
  if (p.mode === 'plan' || ['busy', 'waiting', 'shell'].includes(reg?.status ?? '')) return false
  if (reg?.status === 'idle') return !p.question && p.busySince === undefined // a tool still without a result beats a stale file
  return p.lastRole === 'assistant' && !p.question && p.busySince === undefined && !liveBackground({ background: p.background ?? [], bgSeen: p.bgSeen }, now).length && now - p.lastAt >= ms
}

// Sent with every lot, one line: thinking, coding, testing and fixing never share one Opus loop.
export const WORKFLOW_LINE = 'Run this task as a workflow, an explicit model on every agent: think (opus, short), build (sonnet), test (haiku), verify (sonnet), fix (sonnet). Label each agent <kind> or <kind>-<turn> (think, build, test, verify, fix, commit; test-2 is the second turn of a loop). Start each agent\'s prompt with the lines Goal:, How: and Out:. A very small task (one file, one test) may run without a workflow, but then as one subagent (Agent tool) with the model that fits it (haiku for a mechanical change, sonnet for code), never in the session\'s own loop.'
// A change request as the session reads it: `[overseer-change] task 4 · src/a.ts:12 · rename it`.
export const changeWhere = (c: Pick<Change, 'file' | 'line'>) => (c.file ? `${c.file}${c.line ? `:${c.line}` : ''} · ` : '')
export const changeMessage = (lot: number, c: Pick<Change, 'file' | 'line' | 'text'>) => `[overseer-change] task ${lot} · ${changeWhere(c)}${c.text}`
// The change requests of a lot that its session has not reported made yet.
export const openChanges = (lot: Pick<Lot, 'changes'>) => (lot.changes ?? []).filter(c => c.state === 'sent')
// continueOn: the branch of the lot's earlier work, when it is not merged into the integration branch yet.
export const lotMessage = (goal: string, lot: Lot, first: boolean, continueOn?: string) => {
  const b = lot.brief?.type ? lot.brief : undefined
  const done = b?.criteria.length ? `\n${numbered(b)}` : ` ${lot.doneWhen || '(see PLAN.md)'}`
  const dir = b?.direction ? `\nDirection: ${b.direction}\nIn the think step, say whether your plan follows this direction, or "departs, because …"; if it departs, end with [task ${lot.n} departs: <why>] and wait for Victor.` : ''
  const cont = continueOn ? `\nThe earlier work on this task is on branch ${continueOn}, not merged yet: continue on ${continueOn}.` : ''
  const open = openChanges(lot)
  const changes = open.length ? `\nChanges requested (write [change ${lot.n} done] when they are made):\n${open.map(c => `- ${changeWhere(c)}${c.text}`).join('\n')}` : ''
  return `${first ? `${SESSION_RULES(goal)}\n\n` : ''}Your task: ${lot.n}. ${lot.title}\nDone when:${done}${b ? rules(b, 'Keep', 'Not in') : ''}${dir}${cont}${changes}${lot.check ? `\nThe overseer will run \`${lot.check}\` on your branch before accepting it.` : ''}\nEnd with [task ${lot.n} done on <branch>] or [task ${lot.n} blocked: <why>].\n${WORKFLOW_LINE}${lot.model ? `\nModel: ${lot.model} is enough for it.` : ''}\n\n${lot.body}`
}

// "Not now": the proposed task `n` ([?]) leaves the plan and its `entry` goes at the end of the section « En attente » (made at the end when there is none).
export function fileUnderWaiting(md: string, n: number, entry: string): string {
  const lines = md.split('\n')
  const at = lines.findIndex(l => l.match(/^## \[\?\] (\d+)\./)?.[1] === String(n))
  if (at >= 0) {
    const end = lines.findIndex((l, i) => i > at && /^#{1,2} /.test(l))
    lines.splice(at, (end < 0 ? lines.length : end) - at)
  }
  const h = lines.findIndex(l => /^## En attente\s*$/.test(l))
  if (h < 0) return `${lines.join('\n').trimEnd()}\n\n## En attente\n\n${entry}\n`
  let e = lines.findIndex((l, i) => i > h && /^#{1,2} /.test(l))
  if (e < 0) e = lines.length
  while (e > h + 1 && !lines[e - 1]!.trim()) e--
  lines.splice(e, 0, entry)
  return `${lines.join('\n').trimEnd()}\n`
}
