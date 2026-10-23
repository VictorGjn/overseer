// lot 38: the plan's git tree, its lanes checked on the mockup's 77 commits, the rest on a fixture repository.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { test } from 'node:test'

import { GRAPH_FORMAT, lanesOf, parseGraph, treeOf } from '../hooks/tree.ts'

test('lanes: on the mockup\'s 77 commits, each lane and x equal the mockup\'s l and x', () => {
  const html = readFileSync(new URL('./mockups/board-v3.html', import.meta.url), 'utf8')
  const GTREE = JSON.parse(html.match(/^const GTREE = (\[.*\])$/m)[1])
  assert.equal(GTREE.length, 77)
  const newest = [...GTREE].reverse().map(c => ({ hash: c.h, parents: c.p }))
  const lanes = lanesOf(newest, 'bbeac00') // the trunk's tip when the mockup was made
  assert.deepEqual([...lanes].reverse(), GTREE.map(c => c.l))
  assert.deepEqual(newest.map((_, i) => newest.length - 1 - i).reverse(), GTREE.map(c => c.x))
})

test('GRAPH_FORMAT carries the parents', () => {
  assert.match(GRAPH_FORMAT, /%p/)
  const [row] = parseGraph(`* \x1fabc1234\x1fdef5678 0123456\x1fHEAD -> feat/x, lot/2-y\x1fMerge it\x1f1700000000`)
  assert.deepEqual(row.parents, ['def5678', '0123456'])
  assert.deepEqual(row.refs, ['feat/x', 'lot/2-y'])
  assert.equal(row.subject, 'Merge it')
})

const git = top => async args => { const r = spawnSync('git', ['-C', top, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return { code: r.status ?? 1, out: r.stdout ?? '' } }

// main ─ feat/board (the integration branch, not main): the run starts at `start`; lot/1 merged (its branch deleted),
// a release commit 0.2.8, lot/2 still open, and one plain commit on feat/board.
function fixture() {
  const top = mkdtempSync(`${tmpdir()}/ov-tree-`)
  let t = 0
  const g = (...a) => { t += 60; const d = new Date(Date.parse('2026-10-22T10:00:00Z') + t * 1000).toISOString(); return execFileSync('git', ['-C', top, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } }).trim() }
  const put = (path, text) => { mkdirSync(dirname(`${top}/${path}`), { recursive: true }); writeFileSync(`${top}/${path}`, text) }
  const commit = (path, text, msg) => { put(path, text); g('add', '-A'); g('commit', '-qm', msg); return g('rev-parse', '--short', 'HEAD') }
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
  commit('overseer/.claude-plugin/plugin.json', '{"version":"0.2.7"}\n', 'init')
  g('switch', '-qc', 'feat/board')
  const before = commit('a.txt', 'a\n', 'feat: before the run')
  const start = g('rev-parse', 'HEAD')
  g('switch', '-qc', 'lot/1-one')
  const l1a = commit('one.txt', '1\n', 'feat: one')
  const l1b = commit('one.txt', '1\n2\n', 'test: one')
  g('switch', '-q', 'feat/board')
  const plain = commit('b.txt', 'b\n', 'docs: plain')
  g('merge', '-q', '--no-ff', '-m', "Merge branch 'lot/1-one' into feat/board", 'lot/1-one')
  const merge = g('rev-parse', '--short', 'HEAD')
  g('branch', '-qD', 'lot/1-one') // merged and gone: its merge still names it
  const release = commit('overseer/.claude-plugin/plugin.json', '{"version":"0.2.8"}\n', 'chore: 0.2.8')
  g('switch', '-qc', 'lot/2-two')
  const l2 = commit('two.txt', '2\n', 'feat: two')
  g('switch', '-q', 'main')
  return { top, start, before, l1a, l1b, plain, merge, release, l2 }
}

test('the tree since the run started: lanes, the lot of each commit, the release ring, the cut', async () => {
  const f = fixture()
  const { rows, cut } = await treeOf(git(f.top), { since: f.start, base: 'feat/board', branches: ['lot/2-two'], pluginJson: 'overseer/.claude-plugin/plugin.json' })
  const c = Object.fromEntries(rows.filter(r => r.hash).map(r => [r.hash, r]))
  assert.deepEqual(Object.keys(c).sort(), [f.l1a, f.l1b, f.plain, f.merge, f.release, f.l2].sort()) // not `before`, not main's init
  assert.equal(cut, 0)
  assert.deepEqual([c[f.l1a].lot, c[f.l1b].lot], [1, 1]) // from the merge's second-parent range: the branch is gone
  assert.equal(c[f.l2].lot, 2) // from base..lot/2-two
  assert.equal(c[f.plain].lot, undefined) // grey
  assert.equal(c[f.merge].lot, undefined)
  assert.equal(c[f.release].version, '0.2.8')
  assert.equal(c[f.merge].version, undefined)
  assert.deepEqual(c[f.merge].parents, [f.plain, f.l1b])
  for (const h of [f.plain, f.merge, f.release]) assert.equal(c[h].lane, 0, h) // the trunk
  assert.notEqual(c[f.l1b].lane, 0)
  assert.deepEqual(rows.filter(r => r.hash).map(r => r.x), [5, 4, 3, 2, 1, 0]) // x: oldest 0

  const small = await treeOf(git(f.top), { since: f.start, base: 'feat/board', branches: [], cap: 4 })
  assert.equal(small.rows.filter(r => r.hash).length, 4)
  assert.equal(small.cut, 2) // the cut is shown
  const all = await treeOf(git(f.top), { base: 'feat/board', branches: [] }) // no run: every local branch
  assert.ok(all.rows.some(r => r.hash === f.before))
})
