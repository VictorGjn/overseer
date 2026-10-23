// The plan's git tree (lot 38): each commit since the run started, in lanes like `git log --graph` turned on its side,
// with the lot it belongs to and the release rings. Pure but for the git runner, so it is tested on a fixture repository.

// git -C <top> <args>: its exit code and stdout.
export type Git = (args: string[]) => Promise<{ code: number; out: string }>

// A row of `git log --graph --date-order`: the graph prefix, then the commit when the row has one. The format puts a
// \x1f before each field, so a row with no \x1f is a connector between commits.
export type GraphRow = { graph: string; hash?: string; parents?: string[]; refs?: string[]; subject?: string; at?: number; lane?: number; x?: number; lot?: number; version?: string }
export const GRAPH_FORMAT = '%x1f%h%x1f%p%x1f%D%x1f%s%x1f%ct'
export function parseGraph(out: string): GraphRow[] {
  return out.split('\n').filter(l => l.trim()).map(line => {
    const i = line.indexOf('\x1f')
    if (i < 0) return { graph: line.trimEnd() }
    const [, hash = '', parents = '', refs = '', subject = '', ct = ''] = line.slice(i).split('\x1f')
    return {
      graph: line.slice(0, i).trimEnd(),
      hash, parents: parents.split(' ').filter(Boolean), subject, at: Number(ct) * 1000 || undefined,
      refs: refs.split(',').map(r => r.trim().replace(/^HEAD -> /, '')).filter(r => r && r !== 'HEAD' && !r.startsWith('tag: ')),
    }
  })
}

// Each commit's lane, newest first, the trunk (the integration branch's tip) seeded in lane 0: a commit takes the lane
// that waits for it (the leftmost; the others free up), else the first free one; its first parent then waits in that
// lane, and each other parent not yet awaited in the first free lane. Parents outside the rows are ignored.
export function lanesOf(rows: { hash: string; parents: string[] }[], trunk?: string): number[] {
  const known = new Set(rows.map(r => r.hash))
  const lanes: (string | undefined)[] = [trunk]
  const free = () => { const i = lanes.findIndex(x => x === undefined); return i < 0 ? lanes.push(undefined) - 1 : i }
  return rows.map(r => {
    const ps = r.parents.filter(p => known.has(p))
    const waits = lanes.flatMap((x, i) => (x === r.hash ? [i] : []))
    const lane = waits.length ? waits[0]! : free()
    for (const i of waits.slice(1)) lanes[i] = undefined
    lanes[lane] = ps[0]
    for (const p of ps.slice(1)) if (!lanes.includes(p)) lanes[free()] = p
    return lane
  })
}

const CAP = 300
const lines = (s: string) => s.split('\n').filter(Boolean)
const version = async (git: Git, rev: string, path: string) => { try { const v = JSON.parse((await git(['show', `${rev}:${path}`])).out).version; return typeof v === 'string' ? v : undefined } catch { return undefined } }

// The tree since the run started (since: the integration tip then; none: every local branch), at most cap rows of
// commits, with how many were cut. base: the integration branch; branches: the branches the board lists.
export async function treeOf(git: Git, o: { since?: string; base: string; branches: string[]; cap?: number; pluginJson?: string }): Promise<{ rows: GraphRow[]; cut: number }> {
  const cap = o.cap ?? CAP
  const range = ['--branches', ...(o.since ? [`^${o.since}`] : [])]
  const total = Number((await git(['rev-list', '--count', ...range])).out.trim()) || 0
  const rows = parseGraph((await git(['log', '--graph', '--date-order', `-n${cap}`, `--format=${GRAPH_FORMAT}`, ...range])).out)
  const commits = rows.filter((r): r is GraphRow & { hash: string; parents: string[] } => !!r.hash)
  const trunk = (await git(['rev-parse', '--short', o.base])).out.trim() || undefined
  const lanes = lanesOf(commits, trunk)
  commits.forEach((c, i) => { c.lane = lanes[i]; c.x = commits.length - 1 - i })
  // The lot of a commit: the smallest range that holds it, of each listed lot branch (base..branch) and of each merge
  // of a lot branch (its second-parent range). Other commits stay without a lot: grey on the page.
  const at = new Map(commits.map(c => [c.hash, c]))
  const size = new Map<string, number>()
  const claim = (n: number, hashes: string[]) => { for (const h of hashes) { const c = at.get(h); if (c && (size.get(h) ?? Infinity) > hashes.length) { c.lot = n; size.set(h, hashes.length) } } }
  for (const b of o.branches) {
    const n = Number(b.match(/^lot\/(\d+)-/)?.[1])
    if (n) claim(n, lines((await git(['rev-list', '--abbrev-commit', `${o.base}..${b}`])).out))
  }
  for (const m of commits.filter(c => c.parents.length > 1).slice(0, 60)) {
    const n = Number(m.subject?.match(/\blot\/(\d+)-/)?.[1])
    if (n) claim(n, lines((await git(['rev-list', '--abbrev-commit', `${m.parents[0]}..${m.parents[1]}`])).out))
  }
  // The release rings: a commit whose mod version differs from its first parent's.
  if (o.pluginJson) for (const h of lines((await git(['log', '--format=%h', '-n30', ...range, '--', o.pluginJson])).out)) {
    const c = at.get(h)
    const v = c && await version(git, h, o.pluginJson)
    if (c && v && v !== await version(git, `${h}^`, o.pluginJson)) c.version = v
  }
  return { rows, cut: Math.max(0, total - commits.length) }
}
