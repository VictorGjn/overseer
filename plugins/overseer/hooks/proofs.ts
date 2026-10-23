// A lot's git evidence for the board's Changes stage and rail (lot 33): its branch, fork point, tip, commits, files,
// test files, uncommitted files and, once merged, the merge commit and the release it went out in. Read at pass time
// with argv arrays (no shell), never at render. Pure but for the git runner, so it is tested on a real fixture repository.

// git -C <cwd> <args>: its exit code and stdout ('' when it failed to start).
export type Git = (cwd: string, args: string[]) => Promise<{ code: number; out: string }>
export type LotGit = {
  branch?: string
  base?: string // the fork point: where the branch left the integration branch
  tip?: string
  commits?: { hash: string; subject: string }[] // newest first
  files?: [added: number, removed: number, path: string][]
  stat?: { files: number; add: number; del: number }
  tests?: { unit: string[]; functional: string[]; screens: string[] }
  dirty?: { path: string; add: number; del: number }[] // a running lot's uncommitted paths
  merged?: string // the merge commit on the integration branch
  release?: string // the mod's version at that merge commit
}
export type LotIn = { n: number; status: string; branch?: string; base?: string; worktree?: { path: string; branch?: string } }

const CAP = 200_000 // bytes of one git output kept
const MAX_FILES = 200, MAX_COMMITS = 50, MAX_DIRTY = 50, MAX_LINE = 2000 // a first-parent line is read 2000 commits deep

const lines = (s: string) => s.slice(0, CAP).split('\n').filter(Boolean)
// `git diff --numstat` lines → [added, removed, path]; a binary file counts 0 lines.
export function numstat(s: string, max = MAX_FILES): [number, number, string][] {
  return lines(s).slice(0, max).map(l => l.split('\t')).filter(p => p.length >= 3).map(([a, d, ...p]) => [Number(a) || 0, Number(d) || 0, p.join('\t')] as [number, number, string])
}
// The changed test files, in 3 tiers: unit (*.test.ts but golden.test.ts), functional (*.test.mjs), screens (golden/*).
export function testTiers(paths: string[]): NonNullable<LotGit['tests']> {
  return {
    unit: paths.filter(p => /\.test\.ts$/.test(p) && !/(^|\/)golden\.test\.ts$/.test(p)),
    functional: paths.filter(p => /\.test\.mjs$/.test(p)),
    screens: paths.filter(p => /(^|\/)golden\//.test(p)),
  }
}

// The lot's branch: the PLAN.md `branch:` line, else its session's worktree branch (a running lot), else lot/<n>-*.
async function branchOf(git: Git, top: string, lot: LotIn): Promise<string | undefined> {
  if (lot.branch) return lot.branch
  if (lot.status === 'running' && lot.worktree?.branch) return lot.worktree.branch
  const r = await git(top, ['for-each-ref', '--format=%(refname:short)', `refs/heads/lot/${lot.n}-*`])
  return lines(r.out)[0]
}

// cache: the evidence already read, by branch, tip, integration tip and base line: a pass re-reads only what moved
// (a running lot's uncommitted files always).
export async function lotGit(git: Git, top: string, integration: string, lot: LotIn, o: { pluginJson?: string; cache?: Map<string, LotGit>; integrationTip?: string } = {}): Promise<LotGit> {
  const branch = await branchOf(git, top, lot)
  if (!branch || branch === integration) return {} // a lot with no branch (a decision, or work done on the integration branch) still opens
  const tip = (await git(top, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`])).out.trim()
  if (!tip) return { branch }
  const key = `${branch} ${tip} ${o.integrationTip ?? ''} ${lot.base ?? ''}`
  const known = o.integrationTip ? o.cache?.get(key) : undefined
  const out: LotGit = known ? { ...known } : await committed(git, top, integration, lot, branch, tip, o.pluginJson ?? 'overseer/.claude-plugin/plugin.json')
  if (!known && o.integrationTip) o.cache?.set(key, { ...out })
  if (lot.status === 'running' && lot.worktree?.path && lot.worktree.branch === branch)
    out.dirty = numstat((await git(lot.worktree.path, ['diff', '--numstat', 'HEAD'])).out, MAX_DIRTY).map(([add, del, path]) => ({ path, add, del }))
  return out
}

async function committed(git: Git, top: string, integration: string, lot: LotIn, branch: string, tip: string, pluginJson: string): Promise<LotGit> {
  // Merged: the tip itself is on the integration branch's first-parent line (a fast-forward), else the oldest merge on
  // that line that descends from the tip.
  const line = new Set(lines((await git(top, ['rev-list', '--first-parent', `-n${MAX_LINE}`, integration])).out))
  const merged = line.has(tip) ? tip : lines((await git(top, ['rev-list', '--first-parent', '--ancestry-path', '--merges', `${tip}..${integration}`])).out).at(-1)
  // The fork point: the first commit of the branch's own first-parent line that is on the integration branch's. A lot
  // merged twice keeps its whole diff. A fast-forward has none: the `base:` line written at assignment stands in.
  const fork = lines((await git(top, ['rev-list', '--first-parent', `-n${MAX_LINE}`, tip])).out).find(c => line.has(c))
  const base = fork && fork !== tip ? fork : lot.base
  const out: LotGit = { branch, tip, ...(base ? { base } : {}) }
  if (base) {
    out.commits = lines((await git(top, ['log', `-n${MAX_COMMITS}`, '--format=%h%x09%s', `${base}..${tip}`])).out).map(l => { const [hash, ...s] = l.split('\t'); return { hash: hash!, subject: s.join('\t') } })
    out.files = numstat((await git(top, ['diff', '--numstat', base, tip])).out)
    out.stat = { files: out.files.length, add: out.files.reduce((s, f) => s + f[0], 0), del: out.files.reduce((s, f) => s + f[1], 0) }
    out.tests = testTiers(out.files.map(f => f[2]))
  }
  if (merged) {
    out.merged = merged
    const release = await releaseOf(git, top, integration, merged !== tip ? `${merged}^1` : base, pluginJson)
    if (release) out.release = release
  }
  return out
}

// The release a merge went out in: the first version on the integration branch, from the merge on, that differs from
// the version before it. The bump can be in the merge commit or in a later commit (an integration lot bumps once for
// several lots); no bump yet, no release.
async function releaseOf(git: Git, top: string, integration: string, before: string | undefined, pluginJson: string): Promise<string | undefined> {
  if (!before) return undefined
  const version = async (rev: string) => { try { const v = JSON.parse((await git(top, ['show', `${rev}:${pluginJson}`])).out.slice(0, CAP)).version; return typeof v === 'string' ? v : undefined } catch { return undefined } }
  const was = await version(before)
  for (const c of lines((await git(top, ['log', '--first-parent', '--reverse', '--format=%H', `${before}..${integration}`, '--', pluginJson])).out).slice(0, 20)) {
    const v = await version(c)
    if (v && v !== was) return v
  }
  return undefined
}

// The branch checked out at the top: a run's integration branch; a detached HEAD has none.
export async function integrationOf(git: Git, top: string): Promise<string | undefined> {
  const head = (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim()
  return head && head !== 'HEAD' ? head : undefined
}
