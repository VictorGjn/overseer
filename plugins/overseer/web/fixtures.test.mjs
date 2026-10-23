import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

import { boards, write } from './fixtures/make.mjs'

const NAMES = ['calm', 'needs-you', 'paused', 'live', 'done-gaps', 'reopened', 'planned', 'gate', 'empty', 'old']
const here = new URL('./fixtures/', import.meta.url)

test('the 10 fixtures exist, are not empty, and the script gives the same bytes again', () => {
  assert.deepEqual(Object.keys(boards), NAMES)
  const dir = mkdtempSync(`${tmpdir()}/fx-`)
  write(dir)
  for (const n of NAMES) {
    assert.ok(statSync(new URL(`${n}.ts`, here)).size > 0, n)
    assert.equal(readFileSync(`${dir}/${n}.ts`, 'utf8'), readFileSync(new URL(`${n}.ts`, here), 'utf8'), n)
  }
})

test('the old board carries no v3 field (the type check is tsc, in check.sh)', () => {
  const v3 = ['error', 'requests', 'passing', 'paused', 'passEvery', 'proposed']
  const lot = ['brief', 'base', 'tip', 'dirty', 'retry', 'marks', 'gaps', 'changes']
  assert.ok(!v3.some(k => k in boards.old))
  for (const l of boards.old.lots) assert.ok(!lot.some(k => k in l) && (l.check === undefined || typeof l.check === 'string'))
})
