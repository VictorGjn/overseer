import { test, expect } from 'claude-code/testing'
import { conflictsOf, ownerOf, parseWorktrees, reconcileMessage, tryOrder, withOverlaps } from './branches.ts'

const ID = '0000aa71-0000-4000-8000-0000000000a5'

test('each worktree has its branch, and the session on it: the id in its scratchpad path, else the session running there', async () => {
  const wts = parseWorktrees(`worktree /r/game\nHEAD 1\nbranch refs/heads/docs/x\n\nworktree /tmp/-home-u/${ID}/scratchpad/wt-main\nHEAD 2\nbranch refs/heads/son/console\n\nworktree /r/game/.claude/worktrees/a\nHEAD 3\ndetached\n`)
  expect(wts).toEqual([{ path: '/r/game', branch: 'docs/x', isPrunable: false }, { path: `/tmp/-home-u/${ID}/scratchpad/wt-main`, branch: 'son/console', isPrunable: false }, { path: '/r/game/.claude/worktrees/a', branch: undefined, isPrunable: false }])
  expect(parseWorktrees('worktree /tmp/gone\nHEAD 3\nbranch refs/heads/a10\nprunable gitdir file points to non-existent location')[0]!.isPrunable).toBe(true)
  const sessions = [{ sessionId: 'aaa', cwd: '/r/game' }]
  expect(ownerOf(wts[1]!.path, sessions)).toBe(ID) // not watched, still named
  expect(ownerOf('/r/game', sessions)).toBe('aaa')
  expect(ownerOf('/r/game/.claude/worktrees/a', sessions)).toBeUndefined()
})

test('branches touching no shared file go first, then the smallest; a trial merge lists its conflicts', async () => {
  const bs = withOverlaps([
    { name: 'nuit', files: ['src/sons.js', 'src/ships.js', 'a.glb'] },
    { name: 'canyon', files: ['assets/canyon.glb'] },
    { name: 'docs', files: ['src/sons.js'] },
  ])
  expect(bs.map(b => b.overlaps)).toEqual([['docs'], [], ['nuit']])
  expect(tryOrder(bs).map(b => b.name)).toEqual(['canyon', 'docs', 'nuit'])
  expect(conflictsOf('f862b69a\nsrc/sons.js\ngame3d.html\n')).toEqual(['src/sons.js', 'game3d.html'])
  expect(conflictsOf('f862b69a\n')).toEqual([])
})

test('the reconciliation task names the order, the conflicts and their sessions, and leaves the base to the owner', async () => {
  const msg = reconcileMessage('main', 'integration/1', [
    { name: 'nuit', ahead: 13, behind: 1, files: [], overlaps: ['docs'], owner: 'x1', merge: { order: 2, conflicts: ['src/sons.js'] } },
    { name: 'canyon', ahead: 2, behind: 0, files: [], overlaps: [], merge: { order: 1, conflicts: [] } },
    { name: 'old-agent', ahead: 4, behind: 477, files: [], overlaps: [], merge: { order: 3, conflicts: ['kit.py'] } },
  ], id => (id === 'x1' ? 'campagne' : ''))
  expect(msg).toContain('1. canyon (+2): clean\n2. nuit (+13, 1 behind main, session campagne): CONFLICTS on src/sons.js')
  expect(msg).toContain('3. old-agent (+4, 477 behind main): STALE: skip it')
  expect(msg).toContain('branch integration/1, created from main; do not touch main')
  expect(msg).toContain('The owner merges integration/1 into main and pushes.')
})
