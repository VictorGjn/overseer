// lot 33: a lot's git evidence, read from a real fixture repository whose integration branch is not main.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { test } from 'node:test'

import { integrationOf, lotGit, numstat, testTiers } from '../hooks/proofs.ts'

const git = async (cwd, args) => { const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return { code: r.status ?? 1, out: r.stdout ?? '' } }

// main ─ feat/board (the integration branch) ─ lot/1 merged with --no-ff (0.2.8), lot/2 running in a worktree with
// uncommitted edits, lot/5 merged fast-forward; lot 3 is a decision and lot 4 a done lot, neither with a branch.
function fixture() {
  const top = mkdtempSync(`${tmpdir()}/ov-proofs-`)
  const g = (...a) => execFileSync('git', ['-C', top, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-22T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-22T10:00:00Z' } }).trim()
  const put = (path, text, root = top) => { mkdirSync(dirname(`${root}/${path}`), { recursive: true }); writeFileSync(`${root}/${path}`, text) }
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
  put('overseer/.claude-plugin/plugin.json', '{"name":"overseer","version":"0.2.7"}\n')
  put('README.md', 'one\n')
  g('add', '-A'); g('commit', '-qm', 'init')
  g('switch', '-qc', 'feat/board')
  put('overseer/hooks/board.ts', 'export const a = 1\n'); g('add', '-A'); g('commit', '-qm', 'feat: board')
  const fork1 = g('rev-parse', 'HEAD')

  g('switch', '-qc', 'lot/1-merged')
  put('overseer/hooks/a.ts', 'export const x = 1\nexport const y = 2\n')
  put('overseer/hooks/a.test.ts', 'test\n')
  put('overseer/hooks/golden.test.ts', 'golden\n')
  g('add', '-A'); g('commit', '-qm', 'feat: a')
  put('overseer/web/a.test.mjs', 'web\n')
  put('overseer/hooks/golden/pane-64.ts', 'screen\n')
  put('README.md', 'two\n')
  g('add', '-A'); g('commit', '-qm', 'test: a')
  g('switch', '-q', 'feat/board')
  put('overseer/hooks/board.ts', 'export const a = 2\n'); g('add', '-A'); g('commit', '-qm', 'fix: board moves on')
  g('merge', '-q', '--no-ff', '--no-commit', 'lot/1-merged')
  put('overseer/.claude-plugin/plugin.json', '{"name":"overseer","version":"0.2.8"}\n'); g('add', '-A'); g('commit', '-qm', 'Merge lot/1-merged, 0.2.8')
  const merge1 = g('rev-parse', 'HEAD')

  const fork5 = g('rev-parse', 'HEAD')
  g('switch', '-qc', 'lot/5-ff')
  put('overseer/hooks/five.ts', 'five\n'); g('add', '-A'); g('commit', '-qm', 'feat: five')
  g('switch', '-q', 'feat/board'); g('merge', '-q', '--ff-only', 'lot/5-ff')
  const tip5 = g('rev-parse', 'HEAD')
  // an integration lot bumps the version in a commit of its own, after the merges
  put('overseer/.claude-plugin/plugin.json', '{"name":"overseer","version":"0.2.9"}\n'); g('add', '-A'); g('commit', '-qm', 'chore: 0.2.9')

  // lot 6 is merged twice: its fork point stays where it left, and no bump has come after it yet
  const fork6 = g('rev-parse', 'HEAD')
  g('switch', '-qc', 'lot/6-twice')
  put('overseer/hooks/six.ts', 'six\n'); g('add', '-A'); g('commit', '-qm', 'feat: six')
  g('switch', '-q', 'feat/board'); g('merge', '-q', '--no-ff', '-m', 'Merge lot/6 once', 'lot/6-twice')
  g('switch', '-q', 'lot/6-twice')
  put('overseer/hooks/six.ts', 'six\nseven\n'); g('add', '-A'); g('commit', '-qm', 'fix: six')
  g('switch', '-q', 'feat/board'); g('merge', '-q', '--no-ff', '-m', 'Merge lot/6 again', 'lot/6-twice')

  const wt = `${top}-lot2`
  g('worktree', 'add', '-q', '-b', 'lot/2-running', wt, 'feat/board')
  const fork2 = g('rev-parse', 'HEAD')
  put('overseer/hooks/two.ts', 'two\n', wt)
  execFileSync('git', ['-C', wt, 'add', '-A']); execFileSync('git', ['-C', wt, 'commit', '-qm', 'feat: two'])
  put('overseer/hooks/two.ts', 'two\nthree\nfour\n', wt) // uncommitted
  put('overseer/hooks/board.ts', '', wt) // uncommitted: a line removed
  g('switch', '-q', 'main') // the main checkout is elsewhere: the integration branch is named, not HEAD
  return { top, wt, fork1, merge1, fork2, fork5, tip5, fork6 }
}

test('lot 33: branch, fork point, tip, commits, files, test tiers, dirty, merge and release, on a fixture repository', async () => {
  const f = fixture()
  const run = lot => lotGit(git, f.top, 'feat/board', lot)

  const one = await run({ n: 1, status: 'done' })
  assert.equal(one.branch, 'lot/1-merged')
  assert.equal(one.base, f.fork1) // not the integration tip: a merged lot still has its diff
  assert.equal(one.merged, f.merge1)
  assert.equal(one.release, '0.2.8')
  assert.deepEqual(one.commits.map(c => c.subject), ['test: a', 'feat: a'])
  assert.match(one.commits[0].hash, /^[0-9a-f]{7,}$/)
  assert.deepEqual(one.files, [[1, 1, 'README.md'], [1, 0, 'overseer/hooks/a.test.ts'], [2, 0, 'overseer/hooks/a.ts'], [1, 0, 'overseer/hooks/golden.test.ts'], [1, 0, 'overseer/hooks/golden/pane-64.ts'], [1, 0, 'overseer/web/a.test.mjs']]) // the board.ts change on feat/board is not the lot's
  assert.deepEqual(one.stat, { files: 6, add: 7, del: 1 })
  assert.deepEqual(one.tests, { unit: ['overseer/hooks/a.test.ts'], functional: ['overseer/web/a.test.mjs'], screens: ['overseer/hooks/golden/pane-64.ts'] })
  assert.equal(one.dirty, undefined)

  const two = await run({ n: 2, status: 'running', worktree: { path: f.wt, branch: 'lot/2-running' } })
  assert.equal(two.branch, 'lot/2-running')
  assert.equal(two.base, f.fork2)
  assert.deepEqual(two.commits.map(c => c.subject), ['feat: two'])
  assert.equal(two.merged, undefined)
  assert.deepEqual(two.dirty, [{ path: 'overseer/hooks/board.ts', add: 0, del: 1 }, { path: 'overseer/hooks/two.ts', add: 2, del: 0 }])
  // without its session's worktree, a running lot is found by its name, lot/<n>-*; dirty needs the worktree
  const byName = await run({ n: 2, status: 'running' })
  assert.equal(byName.branch, 'lot/2-running')
  assert.equal(byName.dirty, undefined)

  assert.deepEqual(await run({ n: 3, status: 'todo' }), {}) // a decision lot: no branch, nothing to show, and it still opens
  assert.deepEqual(await run({ n: 4, status: 'done' }), {})
  assert.deepEqual(await run({ n: 4, status: 'done', branch: 'gone/branch' }), { branch: 'gone/branch' }) // a deleted branch

  const five = await run({ n: 5, status: 'done', base: f.fork5 }) // fast-forward: the base line written at assignment
  assert.equal(five.merged, f.tip5)
  assert.equal(five.base, f.fork5)
  assert.deepEqual(five.files, [[1, 0, 'overseer/hooks/five.ts']])
  assert.equal(five.release, '0.2.9') // the bump came in a later commit, not in the merge
  assert.equal(one.release, '0.2.8') // the bump inside the merge commit

  const six = await run({ n: 6, status: 'done' })
  assert.equal(six.base, f.fork6) // merged twice: the whole diff, not the last delta
  assert.deepEqual(six.files, [[2, 0, 'overseer/hooks/six.ts']])
  assert.deepEqual(six.commits.map(c => c.subject), ['fix: six', 'feat: six'])
  assert.match(six.merged, /^[0-9a-f]{40}$/)
  assert.equal(six.release, undefined) // no bump since it was merged: not released yet
})

test('the integration branch is the one checked out at the top; a detached HEAD has none', async () => {
  const f = fixture()
  execFileSync('git', ['-C', f.top, 'switch', '-q', 'feat/board'])
  assert.equal(await integrationOf(git, f.top), 'feat/board')
  execFileSync('git', ['-C', f.top, 'switch', '-q', '--detach', 'feat/board'])
  assert.equal(await integrationOf(git, f.top), undefined)
})

test('a second read with the same tips comes from the cache, but a running lot\'s uncommitted files are read again', async () => {
  const f = fixture()
  const calls = []
  const counted = async (cwd, args) => { calls.push(args.join(' ')); return git(cwd, args) }
  const cache = new Map(), integrationTip = (await git(f.top, ['rev-parse', 'feat/board'])).out.trim()
  const lot = { n: 2, status: 'running', worktree: { path: f.wt, branch: 'lot/2-running' } }
  const first = await lotGit(counted, f.top, 'feat/board', lot, { cache, integrationTip })
  const n1 = calls.length
  calls.length = 0
  writeFileSync(`${f.wt}/overseer/hooks/new.ts`, 'x\n'); execFileSync('git', ['-C', f.wt, 'add', 'overseer/hooks/new.ts']) // staged: diff HEAD sees it
  const second = await lotGit(counted, f.top, 'feat/board', lot, { cache, integrationTip })
  assert.ok(calls.length < n1, `${calls.length} calls, then ${n1}`)
  assert.deepEqual(calls.filter(c => c.startsWith('log') || c.startsWith('rev-list')), [])
  assert.deepEqual(second.commits, first.commits)
  assert.deepEqual(second.dirty.map(d => d.path), ['overseer/hooks/board.ts', 'overseer/hooks/new.ts', 'overseer/hooks/two.ts'])
})

test('numstat caps its lines and counts a binary file as 0; the test tiers keep golden.test.ts out of unit', () => {
  assert.deepEqual(numstat('1\t2\ta.ts\n-\t-\tlogo.png\n3\t0\tb.ts\n', 2), [[1, 2, 'a.ts'], [0, 0, 'logo.png']])
  assert.deepEqual(testTiers(['x/golden.test.ts', 'x/y.test.ts', 'w/z.test.mjs', 'x/golden/band-80.ts', 'x/y.ts']), { unit: ['x/y.test.ts'], functional: ['w/z.test.mjs'], screens: ['x/golden/band-80.ts'] })
})
