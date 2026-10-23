// Task 63: no test writes the board token to the real ~/.claude/overseer/web.json (each ./check.sh used to break /oversee show until the
// board server restarted). The two files that start a server run in a child with HOME in a temp directory: os.homedir() follows HOME,
// so anything written to the home path lands there, and nothing may.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

test('server.test.mjs and webserver.test.mjs leave no web.json under a temp HOME', () => {
  const home = mkdtempSync(`${tmpdir()}/ov-home-`), cwd = new URL('.', import.meta.url).pathname
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=120000', 'server.test.mjs', 'webserver.test.mjs'], { cwd, env: { ...process.env, HOME: home, NODE_TEST_CONTEXT: undefined }, encoding: 'utf8', timeout: 170000 })
  assert.equal(r.status, 0, `the child run is green: ${(r.stdout ?? '').slice(-600)}`)
  assert.equal(existsSync(`${home}/.claude/overseer/web.json`), false, `web.json written under HOME: ${existsSync(`${home}/.claude`) ? readdirSync(`${home}/.claude/overseer`) : ''}`)
})
