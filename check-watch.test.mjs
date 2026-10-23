import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// check-watch.sh (task 61): a hung file gives the diagnostic, then a fail; a slow file that works does not fail. The limits are 5 and 20 min in
// check.sh; here they are seconds (CHECK_WARN_SECS, CHECK_KILL_SECS), and the folder the overseer reads is a temporary one.
const SCRIPT = new URL('./check-watch.sh', import.meta.url).pathname
const wait = ms => new Promise(r => setTimeout(r, ms))
function watch(cwd, label, cmd, { warn = 1, kill = 5 } = {}) {
  const dir = join(cwd, 'stuck')
  const p = spawn('bash', [SCRIPT, label, ...cmd], { cwd, env: { ...process.env, CHECK_WARN_SECS: String(warn), CHECK_KILL_SECS: String(kill), CHECK_STUCK_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', err = ''
  p.stdout.on('data', d => { out += d }); p.stderr.on('data', d => { err += d })
  const done = new Promise(r => p.on('close', code => r({ code, out, err, left: existsSync(dir) ? readdirSync(dir) : [] })))
  return { done, dir, seen: () => (existsSync(dir) ? readdirSync(dir).map(f => readFileSync(join(dir, f), 'utf8')) : []) }
}
const tmp = () => mkdtempSync(join(tmpdir(), 'cw-'))

test('a fake hung file: the diagnostic (file, CPU, child processes), written where the overseer reads it, then a fail that stops it', async () => {
  const cwd = tmp(), t0 = Date.now()
  const w = watch(cwd, 'web/fake.test.mjs', ['sleep', '60'], { warn: 1, kill: 5 })
  await wait(2500)
  const [text] = w.seen()
  assert.ok(text, 'the diagnostic is written while the file runs')
  assert.match(text, new RegExp(`^cwd: ${realpathSync(cwd).replace(/[/.]/g, '\\$&')}\\nfile: web/fake\\.test\\.mjs\\n`)) // the overseer matches the session by this folder
  assert.match(text, /check\.sh: web\/fake\.test\.mjs has run 0m0\d with no end\./)
  assert.match(text, /CPU of its \d+ processes \(pid, cpu now, cpu used, command\):/)
  assert.match(text, /\d+\s+[\d.]+%\s+[\d:.]+\s+sleep 60/) // its child processes
  const r = await w.done
  assert.equal(r.code, 124) // fail
  assert.match(r.err, /web\/fake\.test\.mjs has run 0m0\d with no end\./) // printed too
  assert.match(r.err, /stopped after 0m05: it did not end\./)
  assert.deepEqual(r.left, []) // nothing left for the overseer to read once it is stopped
  assert.ok(Date.now() - t0 < 12000)
  assert.equal(spawnSync('pgrep', ['-f', 'sleep 60']).stdout.toString().trim(), '') // the process is gone
})

test('a slow file that uses CPU does not fail before the limit, and says it is working', async () => {
  const cwd = tmp()
  const w = watch(cwd, 'web/slow.test.mjs', ['node', '-e', 'const e = Date.now() + 3500; while (Date.now() < e);'], { warn: 1, kill: 20 })
  const r = await w.done
  assert.equal(r.code, 0)
  assert.match(r.err, /has run 0m01 with no end\./)
  assert.ok(Number(r.err.match(/(\d+(?:\.\d+)?)%\s+[\d:.]+\s+node -e/)?.[1]) > 30, r.err) // its CPU is in the text: busy, not hung
  assert.ok(!/stopped/.test(r.err))
  assert.deepEqual(r.left, [])
})

test('a browser test with no browser child says the sandbox may block the launch; a file that is not a browser test does not', async () => {
  const cwd = tmp()
  mkdirSync(join(cwd, 'web'))
  writeFileSync(join(cwd, 'web/b.test.mjs'), "import { launch } from './test/cdp.mjs'\n"); writeFileSync(join(cwd, 'web/p.test.mjs'), "import 'node:test'\n")
  const [b, p] = await Promise.all([watch(cwd, 'web/b.test.mjs', ['sleep', '3'], { warn: 1, kill: 20 }).done, watch(tmp(), 'web/p.test.mjs', ['sleep', '3'], { warn: 1, kill: 20 }).done])
  assert.match(b.err, /no browser child: is the sandbox blocking the launch\?/)
  assert.ok(!/no browser child/.test(p.err))
  // a browser test that has a browser child does not get the line
  writeFileSync(join(cwd, 'web/c.test.mjs'), "import { launch } from './test/cdp.mjs'\n")
  const c = await watch(cwd, 'web/c.test.mjs', ['bash', '-c', 'exec -a "Google Chrome headless" sleep 3'], { warn: 1, kill: 20 }).done
  assert.ok(!/no browser child/.test(c.err), c.err)
})

test('a file that ends in time leaves no diagnostic and no file; its exit code is the command\'s', async () => {
  const w = watch(tmp(), 'web/quick.test.mjs', ['bash', '-c', 'exit 3'], { warn: 5, kill: 10 })
  const r = await w.done
  assert.deepEqual([r.code, r.err, r.left], [3, '', []])
})

test('after a stopped file the next one runs: check.sh calls it for every file and never stops at a fail', async () => {
  const cwd = tmp()
  const loop = `fail=0; for t in hung quick; do bash ./check-watch.sh $t $( [ $t = hung ] && echo sleep 60 || echo true ); code=$?; [ $code -eq 124 ] && echo "stopped $t" ; [ $code -eq 0 ] && echo "ok $t"; done`
  writeFileSync(join(cwd, 'check-watch.sh'), readFileSync(SCRIPT))
  const r = spawnSync('bash', ['-c', loop], { cwd, env: { ...process.env, CHECK_WARN_SECS: '1', CHECK_KILL_SECS: '3', CHECK_STUCK_DIR: join(cwd, 's') }, encoding: 'utf8' })
  assert.match(r.stdout, /stopped hung\nok quick\n/)
  const check = readFileSync(new URL('./check.sh', import.meta.url), 'utf8')
  assert.match(check, /\.\/check-watch\.sh "\$t" node --test/) // the web files
  assert.match(check, /\.\/check-watch\.sh "\$m" claude plugin test "\$m"/) // the mods' tests
  assert.match(check, /elif \[ \$code -eq 124 \]; then echo "web ✘ \$t \(stopped/)
  assert.match(check, /CHECK_WARN_SECS and CHECK_KILL_SECS/)
  assert.ok(!/\bbreak\b/.test(check.slice(check.indexOf('for t in */web')))) // a fail does not end the loop
  assert.match(readFileSync(SCRIPT, 'utf8'), /\$\{CHECK_WARN_SECS:-300\}.*\$\{CHECK_KILL_SECS:-1200\}/) // 5 min and 20 min
})
