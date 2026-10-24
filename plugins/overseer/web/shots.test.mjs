import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { browserTest } from './test/cdp.mjs'

// shots.mjs rebuilds every README image from the fixtures: here into a temp folder, where each file must exist and fit its size limit.
const { skip } = browserTest()
// the contract: PNG at most 300 KB, GIF at most 3 MB
const PNG_MAX = 300 * 1024, GIF_MAX = 3 * 1024 * 1024
const FILES = ['board-light.png', 'board-dark.png', 'needs-you.png', 'zen.png', 'activity.png', 'gate.png', 'budget.png', 'phone-needs.png', 'phone-tasks.png', 'phone-activity.png', 'hero.gif', 'zen.gif', 'phone.gif']

test('shots.mjs makes every image of the contract, each within its size limit', { skip, timeout: 240000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ov-shots-test-'))
  try {
    execFileSync(process.execPath, [new URL('./shots.mjs', import.meta.url).pathname, dir], { stdio: 'pipe', timeout: 200000 })
    for (const f of FILES) {
      const size = statSync(join(dir, f)).size, max = f.endsWith('.gif') ? GIF_MAX : PNG_MAX
      assert.ok(size > 1000 && size <= max, `${f}: ${size} bytes, the limit is ${max}`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
