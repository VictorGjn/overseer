// lot 39: a file's diff and a golden screen, on demand, for what the board lists only.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { test } from 'node:test'

import { diffRows, serve } from './server.mjs'

// Every route asks for the board token's cookie (lot 68): these tests send it, as the page does once /?t= gave it.
const TOKEN = 'ab'.repeat(32)
const fetch = (url, o = {}) => globalThis.fetch(url, { ...o, headers: { cookie: `ovt=${TOKEN}`, ...o.headers } })

// feat/board with lot/1 merged (--no-ff), lot/2 running in a worktree with an uncommitted edit; the board lists both.
function fixture() {
  const top = mkdtempSync(`${tmpdir()}/ov-diff-`)
  const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const put = (root, path, text) => { mkdirSync(dirname(`${root}/${path}`), { recursive: true }); writeFileSync(`${root}/${path}`, text) }
  g(top, 'init', '-q', '-b', 'feat/board'); g(top, 'config', 'user.email', 't@t'); g(top, 'config', 'user.name', 't'); g(top, 'config', 'commit.gpgsign', 'false')
  put(top, 'src/a.ts', 'one\ntwo\nthree\n'); put(top, 'secret.txt', 'not listed\n'); g(top, 'add', '-A'); g(top, 'commit', '-qm', 'init')
  const base1 = g(top, 'rev-parse', 'HEAD')
  g(top, 'switch', '-qc', 'lot/1-a')
  put(top, 'src/a.ts', 'one\nTWO\nthree\nfour\n'); put(top, 'overseer/hooks/golden/pane-64.ts', 'export const SCREEN = `│ ok │`\n'.repeat(450))
  g(top, 'add', '-A'); g(top, 'commit', '-qm', 'feat: a')
  const tip1 = g(top, 'rev-parse', 'HEAD')
  g(top, 'switch', '-q', 'feat/board'); g(top, 'merge', '-q', '--no-ff', '-m', 'merge lot 1', 'lot/1-a')
  const wt = `${top}-lot2`
  g(top, 'worktree', 'add', '-q', '-b', 'lot/2-b', wt)
  put(wt, 'src/a.ts', 'one\nTWO\nthree\nfour\nfive\n') // its HEAD has lot 1 merged
  const board = {
    repo: top, top, goal: 'g', at: 1,
    lots: [
      { n: 1, status: 'done', branch: 'lot/1-a', base: base1, tip: tip1, files: [[2, 1, 'src/a.ts'], [450, 0, 'overseer/hooks/golden/pane-64.ts']] },
      { n: 2, status: 'running', branch: 'lot/2-b', dirty: [{ path: 'src/a.ts', add: 1, del: 0 }] },
      { n: 3, status: 'todo' },
    ],
    worktrees: [{ path: top, branch: 'feat/board', isMain: true, dirty: 0 }, { path: wt, branch: 'lot/2-b', isMain: false, dirty: 1 }],
    sessions: [], feed: [],
  }
  const dir = mkdtempSync(`${tmpdir()}/ov-boards-`)
  writeFileSync(`${dir}/r.json`, JSON.stringify(board))
  return { dir, base1, tip1 }
}

test('GET /diff and /file: a merged lot\'s diff, a running lot\'s worktree, a golden screen capped; anything not listed is a 404', async () => {
  const f = fixture()
  const server = await serve({ dir: f.dir, port: 0, every: 50, token: TOKEN })
  const base = `http://127.0.0.1:${server.address().port}`
  const get = path => fetch(`${base}${path}`)
  try {
    const merged = await (await get('/diff/r?lot=1&file=src/a.ts&view=branch')).json()
    assert.deepEqual(merged, { rows: [['@', 1, '@@ -1,3 +1,4 @@'], [' ', 1, 'one'], ['-', 2, 'two'], ['+', 2, 'TWO'], [' ', 3, 'three'], ['+', 4, 'four']], cut: 0 })
    const big = await (await get('/diff/r?lot=1&file=overseer/hooks/golden/pane-64.ts')).json() // view defaults to branch
    assert.equal(big.rows.length, 400)
    assert.equal(big.cut, 51) // 1 hunk head + 450 lines, 400 kept
    const wt = await (await get('/diff/r?lot=2&file=src/a.ts&view=worktree')).json()
    assert.deepEqual(wt.rows.filter(r => r[0] !== ' ' && r[0] !== '@'), [['+', 5, 'five']])
    const screen = await (await get('/file/r?lot=1&path=overseer/hooks/golden/pane-64.ts')).json()
    assert.equal(screen.text.split('\n').length, 400)
    assert.equal(screen.cut, 51) // 451 lines with the last empty one
    assert.match(screen.text, /│ ok │/)

    for (const bad of [
      '/diff/r?lot=1&file=../../etc/passwd', '/diff/r?lot=1&file=src/../secret.txt', '/diff/r?lot=1&file=secret.txt', // not listed
      '/diff/r?lot=9&file=src/a.ts', '/diff/nope?lot=1&file=src/a.ts', '/diff/r?lot=3&file=src/a.ts', // no such lot, board, or no branch
      '/diff/r?lot=1&file=src/a.ts&view=worktree', '/diff/r?lot=2&file=src/a.ts&view=branch', '/diff/r?lot=1&file=src/a.ts&view=all',
      '/file/r?lot=1&path=src/a.ts', '/file/r?lot=1&path=overseer/hooks/golden/other.ts', '/file/r?lot=2&path=overseer/hooks/golden/pane-64.ts',
    ]) assert.equal((await get(bad)).status, 404, bad)
  } finally { server.closeAllConnections(); server.close() }
})

test('an unknown ref is a 404 even for a listed path: the shas come from the board, never from the request', async () => {
  const f = fixture()
  const board = JSON.parse((await import('node:fs')).readFileSync(`${f.dir}/r.json`, 'utf8'))
  board.lots[0].tip = 'f'.repeat(40) // a sha git does not know
  board.lots[1] = { ...board.lots[0], n: 4, base: 'HEAD~1', tip: 'feat/board' } // refs, not shas
  writeFileSync(`${f.dir}/r.json`, JSON.stringify(board))
  const server = await serve({ dir: f.dir, port: 0, every: 50, token: TOKEN })
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(`${base}/diff/r?lot=1&file=src/a.ts`)).status, 404)
    assert.equal((await fetch(`${base}/diff/r?lot=4&file=src/a.ts`)).status, 404)
    assert.equal((await fetch(`${base}/diff/r?lot=1&file=src/a.ts&base=HEAD`)).status, 404) // a ref in the query is not read
  } finally { server.closeAllConnections(); server.close() }
})

test('diffRows: kinds and line numbers, file headers and "no newline" dropped, the cut counted', () => {
  const out = 'diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -10,3 +10,2 @@ fn\n a\n-b\n c\n\\ No newline at end of file\n@@ -20 +19,2 @@\n x\n+y\n'
  assert.deepEqual(diffRows(out), { rows: [['@', 10, '@@ -10,3 +10,2 @@ fn'], [' ', 10, 'a'], ['-', 11, 'b'], [' ', 11, 'c'], ['@', 19, '@@ -20 +19,2 @@'], [' ', 19, 'x'], ['+', 20, 'y']], cut: 0 })
  assert.deepEqual(diffRows(''), { rows: [], cut: 0 })
})
