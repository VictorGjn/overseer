import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Board } from './board.ts'

// lot 33 in a run: the integration branch is the one checked out at the top when /oversee run starts (not main),
// an assignment keeps the fork point as a `base:` line, and each lot's git evidence reaches the board, read at pass
// time through $.process.run with argv arrays. The git answers below are those of a repository whose integration
// branch is feat/board: lot 1 merged (0.2.8), lot 2 free to give, lot 3 a decision with no branch.
const T0 = Date.parse('2026-10-22T10:00:00Z')
const say = (id: string, text: string) => JSON.stringify({ type: 'assistant', sessionId: id, cwd: '/r', timestamp: new Date(T0).toISOString(), message: { content: [{ type: 'text', text }] } })
const PLAN = `# Plan — Ship it

## [x] 1. First
done when: it ships

## [ ] 2. Second
done when: tests pass

## [ ] 3. Which colour
type: decision
done when: decided
depends: 2
`
const GIT: [RegExp, string, number?][] = [
  [/^rev-parse --abbrev-ref HEAD$/, 'feat/board'],
  [/^rev-parse feat\/board\^\{commit\}$/, 'fork2'],
  [/^for-each-ref --format=%\(refname:short\) refs\/heads\/lot\/1-\*$/, 'lot/1-first'],
  [/^for-each-ref --format=%\(refname:short\) refs\/heads\/lot\/\d+-\*$/, ''],
  [/^rev-parse --verify --quiet lot\/1-first\^\{commit\}$/, 'tip1'],
  [/^rev-list --first-parent -n2000 feat\/board$/, 'bump\nmerge1\nfork1\nroot'], // the integration branch's first-parent line
  [/^rev-list --first-parent --ancestry-path --merges tip1\.\.feat\/board$/, 'merge1'],
  [/^rev-list --first-parent -n2000 tip1$/, 'tip1\nmid1\nfork1\nroot'], // the lot's own line meets it at fork1
  [/^log -n50 --format=%h%x09%s fork1\.\.tip1$/, 'abc1234\ttest: a\ndef5678\tfeat: a'],
  [/^diff --numstat fork1 tip1$/, '2\t0\toverseer/hooks/a.ts\n1\t0\toverseer/hooks/a.test.ts\n1\t0\toverseer/hooks/golden/pane-64.ts'],
  [/^show merge1\^1:overseer\/\.claude-plugin\/plugin\.json$/, '{"name":"overseer","version":"0.2.7"}'],
  [/^log --first-parent --reverse --format=%H merge1\^1\.\.feat\/board -- overseer\/\.claude-plugin\/plugin\.json$/, 'bump'],
  [/^show bump:overseer\/\.claude-plugin\/plugin\.json$/, '{"name":"overseer","version":"0.2.8"}'],
]

function setup(on: On) {
  const files: Record<string, string> = { '/r/PLAN.md': PLAN }
  const runs: string[][] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 + 5 * 60e3 })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    runs.push(c)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '' : '/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(say('w1', 'Ready.'))
    if (c[0] !== 'git') return out('')
    if (c.includes('--show-toplevel')) return out('/r')
    const args = c.slice(3).join(' ') // git -C <cwd> …
    const hit = GIT.find(([re]) => re.test(args))
    return hit ? out(hit[1], hit[2] ?? 0) : out('', 1)
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('session.send', () => ({ isDelivered: true }) as never)
  return { files, runs, clock, board: () => JSON.parse(files['/h/.claude/overseer/boards/r.json']!) as Board }
}

test('lot 33 in a run: the integration branch, the base line at assignment, each lot\'s git evidence on the board', async ($, on) => {
  const s = setup(on)
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never) // no run yet: its pass has no integration branch
  s.runs.length = 0
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  await $.command.run({ command: 'oversee', args: 'show' } as never)

  const b = s.board()
  expect(b.base).toBe('feat/board') // not origin/HEAD, not main
  expect(s.runs.some(c => c.includes('symbolic-ref'))).toBe(false)
  expect(s.runs.some(c => c.join(' ').includes('main...'))).toBe(false)
  expect(s.files['/r/PLAN.md']).toMatch(/## \[~\] 2\. Second\nbase: fork2\nsession: w1/) // the fork point, kept at assignment

  const one = b.lots.find(l => l.n === 1)!
  expect(one).toMatchObject({ branch: 'lot/1-first', base: 'fork1', tip: 'tip1', merged: 'merge1', release: '0.2.8', stat: { files: 3, add: 4, del: 0 } })
  expect(one.commits).toEqual([{ hash: 'abc1234', subject: 'test: a' }, { hash: 'def5678', subject: 'feat: a' }])
  expect(one.files).toEqual([[2, 0, 'overseer/hooks/a.ts'], [1, 0, 'overseer/hooks/a.test.ts'], [1, 0, 'overseer/hooks/golden/pane-64.ts']])
  expect(one.tests).toEqual({ unit: ['overseer/hooks/a.test.ts'], functional: [], screens: ['overseer/hooks/golden/pane-64.ts'] })
  const three = b.lots.find(l => l.n === 3)!
  expect(three.branch).toBeUndefined() // a decision: no branch, and the board still holds it
  expect(three.title).toBe('Which colour')

  // git only through $.process.run, as an argv array: no shell anywhere
  expect(s.runs.filter(c => c[0] === 'sh' || c[0] === 'bash' || c[0] === 'zsh')).toEqual([])
  // never at render: the pane redraws each second, and no git runs between passes
  await s.clock.advance(2500) // the start's delayed pass
  s.runs.length = 0
  await s.clock.advance(1000)
  await s.clock.advance(1000)
  expect(s.runs.filter(c => c[0] === 'git')).toEqual([])
})
