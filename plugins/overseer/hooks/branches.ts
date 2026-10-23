// The project's branches as the overseer sees them: which session works on which branch (through
// its worktree), what each changes against the base, and in which order they merge. Pure: tested
// without a repository; register.tsx runs the git commands.

export type Branch = {
  name: string
  path?: string // its worktree, when it has one
  owner?: string // the session working on it: its id is in the worktree's path, or the worktree is its cwd
  ahead: number
  behind: number
  files: string[] // changed against the merge base with the base branch
  overlaps: string[] // other branches changing some of the same files
  merge?: { order: number; conflicts: string[] } // the trial merge, in order, onto the base: [] = clean
}

// `git worktree list --porcelain` → path and branch of each worktree (a detached one has no branch).
export function parseWorktrees(porcelain: string): { path: string; branch?: string; isPrunable: boolean }[] {
  return porcelain.split('\n\n').map(b => ({
    path: b.match(/^worktree (.+)$/m)?.[1] ?? '',
    branch: b.match(/^branch refs\/heads\/(.+)$/m)?.[1],
    isPrunable: /^prunable/m.test(b), // its folder is gone: `git worktree prune` would drop it
  })).filter(w => w.path)
}

// Sessions keep their worktrees in their scratchpad, whose path holds the session id (an owner even
// when it is not watched); otherwise the worktree is the folder a known session runs in.
export function ownerOf(path: string, sessions: { sessionId: string; cwd: string }[]): string | undefined {
  return path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//)?.[1]
    ?? sessions.find(s => s.cwd === path)?.sessionId
}

// Every worktree of the repository, the main checkout included: its branch (none when detached),
// the session in it, and how many files it has not committed.
export type Worktree = { path: string; branch?: string; owner?: string; dirty: number; files?: string[]; lastCommitAt?: number; isMain: boolean; isPrunable?: boolean }

export function withOverlaps<T extends { name: string; files: string[] }>(bs: T[]): (T & { overlaps: string[] })[] {
  return bs.map(b => ({ ...b, overlaps: bs.filter(o => o !== b && o.files.some(f => b.files.includes(f))).map(o => o.name) }))
}

// The order to try: branches sharing no file with the others first (they cannot collide), then the
// smallest; ties by name, so the order is the same from one pass to the next.
export const tryOrder = <T extends { name: string; files: string[]; overlaps: string[] }>(bs: T[]) =>
  [...bs].sort((a, b) => a.overlaps.length - b.overlaps.length || a.files.length - b.files.length || a.name.localeCompare(b.name))

// `git merge-tree --write-tree --name-only --no-messages` output → the conflicted files (first line is the tree).
export const conflictsOf = (out: string) => out.split('\n').slice(1).map(l => l.trim()).filter(Boolean)

// A branch this far behind the base is an old one (a finished agent's, a forgotten try): left out.
export const STALE = 100

// The lot that reconciles the branches: given to one session, on an integration branch of its own.
export function reconcileMessage(base: string, into: string, bs: Branch[], label: (id?: string) => string): string {
  const ordered = bs.filter(b => b.merge).sort((a, b) => a.merge!.order - b.merge!.order)
  const rows = ordered.map(b => `${b.merge!.order}. ${b.name} (+${b.ahead}${b.behind ? `, ${b.behind} behind ${base}` : ''}${b.owner ? `, session ${label(b.owner)}` : ''}): ${b.behind > STALE ? 'STALE: skip it, name it in the report' : b.merge!.conflicts.length ? `CONFLICTS on ${b.merge!.conflicts.join(', ')}` : 'clean'}`)
  return `Reconcile the project's branches for a merge into ${base}. Work in a new worktree on branch ${into}, created from ${base}; do not touch ${base}, the other worktrees or their branches.
Merge in this order (the trial merge already ran; the clean ones go in as they are):
${rows.join('\n')}
For each conflict: read both sides' commits (git log ${base}..<branch> -- <file>) and keep both intents; when a file is generated from sources, resolve the sources and regenerate it with the project's own build. If two intents truly exclude each other, keep ${base}'s side, note it, and go on.
After the last merge: build and run the project's checks (see its CLAUDE.md), commit, and report: the order, each conflict and how it was resolved, the checks' output. The owner merges ${into} into ${base} and pushes.`
}
