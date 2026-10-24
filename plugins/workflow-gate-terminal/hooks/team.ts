// The team's shared learnings about designing workflows: how to structure them, pick model tiers,
// write missions, verify, keep cost down. Project specifics (verdicts, step labels, lessons about
// the project itself, rewritten missions) stay on each machine. One JSON file per run, on a git
// branch everyone reads and those who opted in write. Pure here; the git plumbing is in register.tsx.

export type Topic = 'structure' | 'models' | 'missions' | 'verification' | 'cost'
export type Pattern = { topic: Topic; lesson: string; when: string }
export type TeamRun = { v: 2; id: string; user: string; at: number; agents: number; cost?: number; patterns: Pattern[] }

const TOPICS: readonly Topic[] = ['structure', 'models', 'missions', 'verification', 'cost']

// Where a run's file goes: the author's folder, by day.
export const teamPath = (r: Pick<TeamRun, 'user' | 'at' | 'id'>) =>
  `${r.user.replace(/[^\w.-]/g, '_')}/${new Date(r.at).toISOString().slice(0, 10)}-${r.id.replace(/[^\w-]/g, '_')}.json`

// Who is writing: the git email's local part, else the OS user.
export const teamUser = (gitEmail: string, osUser: string) => (gitEmail.trim().split('@')[0] || osUser || 'someone').toLowerCase()

// A lesson that names a path, a URL, an address, code or the project is not general: it stays home.
// ponytail: a pattern filter behind the prompt's own rule, not a guarantee; widen it if one slips by.
export function isShareable(p: Pattern, projectWords: string[] = []): boolean {
  const text = `${p.lesson} ${p.when}`
  if (/(^|[\s(])[~.]?\/[\w.-]+\/|\bhttps?:|\S+@\S+\.\w|`|\b[\w-]+\.(js|ts|tsx|py|json|md|mjs|sh)\b|\b(wf|ag|run)_[\w-]{4,}/i.test(text)) return false
  return !projectWords.some(w => w.length > 3 && text.toLowerCase().includes(w.toLowerCase()))
}

export function parsePatterns(raw: unknown, projectWords: string[] = []): Pattern[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(p => p && TOPICS.includes(p.topic) && typeof p.lesson === 'string' && p.lesson.trim())
    .map(p => ({ topic: p.topic as Topic, lesson: String(p.lesson).slice(0, 240), when: String(p.when ?? '').slice(0, 160) }))
    .filter(p => isShareable(p, projectWords))
    .slice(0, 3)
}

// A file from the branch, kept only when it has the shape this version writes.
export function readTeamRun(text: string): TeamRun | undefined {
  try {
    const d = JSON.parse(text)
    // Anyone on the team writes this branch: every pattern is checked as one of ours would be.
    if (d?.v !== 2 || !Array.isArray(d.patterns) || typeof d.at !== 'number') return undefined
    return { ...d, user: String(d.user ?? 'someone'), patterns: parsePatterns(d.patterns) } as TeamRun
  } catch {
    return undefined
  }
}

// Everyone's lessons, newest first, the same lesson said twice kept once (with how many said it).
export function teamPatterns(runs: TeamRun[]): (Pattern & { user: string; at: number; times: number })[] {
  const seen = new Map<string, Pattern & { user: string; at: number; times: number }>()
  for (const r of [...runs].sort((a, b) => b.at - a.at)) for (const p of r.patterns) {
    const key = p.lesson.toLowerCase().replace(/\W+/g, ' ').trim()
    const x = seen.get(key)
    if (x) x.times++
    else seen.set(key, { ...p, user: r.user, at: r.at, times: 1 })
  }
  return [...seen.values()]
}
