// lot 51: the launcher the overseer runs starts server.mjs detached and returns at once; the server outlives it.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

import { compareVersions, isBoardPid, launchArgv, parseAnswer, serverAction, startCommand } from '../hooks/webserver.ts'
import { probe } from './server.mjs'

const freePort = () => new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))

test('the launcher returns at once and leaves server.mjs running, detached, its output in the log', async () => {
  const port = await freePort(), log = `${mkdtempSync(`${tmpdir()}/ov-launch-`)}/server.log`
  const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
  const [cmd, ...args] = launchArgv(root, log)
  const t = Date.now()
  const tokenFile = `${mkdtempSync(`${tmpdir()}/ov-token-`)}/web.json`
  const r = spawnSync(cmd, args, { env: { ...process.env, PORT: String(port), OVERSEER_WEB_TOKEN_FILE: tokenFile }, encoding: 'utf8', timeout: 10000 })
  assert.equal(r.status, 0)
  assert.ok(Date.now() - t < 5000, 'returned at once')
  let v
  for (let i = 0; i < 40 && !(v = await probe(port)); i++) await wait(100)
  try {
    assert.ok(v, 'the server answers /version')
    assert.equal(v.dir, `${root}/web`)
    assert.notEqual(v.pid, process.pid)
    assert.match(readFileSync(log, 'utf8'), new RegExp(`overseer board on http://127.0.0.1:${port}`))
    assert.equal(JSON.parse(readFileSync(tokenFile, 'utf8')).port, port) // the token went where the test said
  } finally { if (v?.pid) process.kill(v.pid) }
})

test('the decision: start when nothing answers, replace an older board, leave the same or a newer one', () => {
  assert.equal(compareVersions('0.2.6', '0.2.7'), -1)
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1)
  assert.equal(compareVersions('0.2.7', '0.2.7'), 0)
  const at = v => ({ version: v, dir: '/x/overseer/web', pid: 4242 })
  assert.equal(serverAction(undefined, '0.2.7'), 'start')
  assert.equal(serverAction(at('0.2.6'), '0.2.7'), 'replace')
  assert.equal(serverAction(at('0.2.7'), '0.2.7'), 'none')
  assert.equal(serverAction(at('0.3.0'), '0.2.7'), 'none')
  assert.deepEqual(parseAnswer('{"version":"0.2.6","dir":"/x/overseer/web","pid":4242}'), at('0.2.6'))
  assert.equal(parseAnswer('not json'), undefined)
  assert.equal(parseAnswer('{"ok":true}'), undefined)
  assert.equal(isBoardPid(at('0.2.6')), true)
  assert.equal(isBoardPid({ version: '1', dir: '/usr/lib/other', pid: 4242 }), false) // another program's pid is never stopped
  assert.equal(isBoardPid({ version: '1', dir: '/x/overseer/web', pid: 1 }), false)
  assert.equal(startCommand('/p/overseer'), 'node "/p/overseer/web/server.mjs" &')
})
