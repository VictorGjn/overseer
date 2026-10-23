import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { browserTest, launch } from './test/cdp.mjs'
import { stub } from './test/stub.mjs'
import { boards } from './fixtures/make.mjs'

// Lot 42: the Changes stage of the lot pane, in a real Chrome (test/cdp.mjs, lot 50) on the stub server. Fails where Chrome is
// missing, unless OVERSEER_NO_BROWSER=1.
const { skip } = browserTest()
const WEB = new URL('.', import.meta.url).pathname
let page
before(async () => { if (!skip) page = await launch() })
after(async () => { await page?.close() })

// lot 27 of the live fixture, with what lot 33 exports for a lot that has a branch
const EVIDENCE = { branch: 'lot/27-pane', base: 'f473ce0aa', tip: 'a293aebbb', commits: [{ hash: 'a293aebbb1', subject: 'feat(overseer): the pane follows the mockup' }, { hash: '4f1c2a9cc2', subject: 'test(overseer): pane-64' }], files: [[31, 7, 'overseer/hooks/golden/pane-120.ts'], [12, 3, 'overseer/hooks/band.tsx']], stat: { files: 2, add: 43, del: 10 } }
const board = (name, patch = {}) => { const b = boards[name]; return { ...b, at: Date.now(), nextPassAt: Date.now() + 150e3, lots: b.lots.map(l => (l.n === 27 ? { ...l, ...EVIDENCE, ...patch } : l)) } }
const DIFF = { rows: [['@', 912, '@@ -912,3 +912,4 @@ function Pane'], [' ', 912, '  const needs = needsYou(board, now)'], ['-', 913, '  const head = <Text bold>👁 OVERSEER</Text>'], ['+', 913, '  const head = <Row>'], ['+', 914, '  </Row>']], cut: 37 }
async function open(b, files = { '/diff/repo-x': JSON.stringify(DIFF) }) {
  const server = await stub({ root: WEB, boards: { 'repo-x': b }, files })
  await page.view({ width: 1280, height: 900 })
  await page.goto('about:blank')
  await page.goto(`${server.url}/`)
  await page.waitFor(`document.querySelector('#ck-main .ck-mh')`)
  await page.press('c'); await page.wait(80) // the Changes stage
  await page.waitFor(`document.querySelector('#ck-stage .dv, #ck-stage .say')`)
  return { server, close: () => server.close() }
}
const text = sel => page.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)
const files = () => page.evaluate(`[...document.querySelectorAll('#ck-stage .dv-f')].map(b => [b.dataset.diffView, b.textContent.trim()])`)

describe('the Changes stage', { skip }, () => {
  test('the files: uncommitted ones tagged "not committed", then the committed ones; a click opens /diff with the matching view; the cut note says the real cut', async () => {
    const s = await open(board('live'))
    try {
      assert.deepEqual(await files(), [['worktree', '▸ overseer/hooks/pane.tsx not committed'], ['branch', '▸ overseer/hooks/golden/pane-120.ts'], ['branch', '▸ overseer/hooks/band.tsx']])
      await page.click('#ck-stage .dv-f[data-diff-view="worktree"]')
      await page.waitFor(`document.querySelectorAll('#ck-stage .dl').length >= 5`)
      assert.ok(s.server.seen.includes('/diff/repo-x?lot=27&file=overseer%2Fhooks%2Fpane.tsx&view=worktree'), s.server.seen.join(' '))
      assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#ck-stage .dl')].map(d => d.className.replace('dl', '').trim() + '|' + d.querySelector('.ln').textContent + '|' + d.querySelector('.sg').textContent)`), ['hunk||', '|912| ', 'del|913|−', 'add|913|+', 'add|914|+'])
      assert.match(await text('#ck-stage .dv-diff .diff-note'), /^37 more lines not shown · open the full diff$/)
      await page.click('#ck-stage .dv-f[data-file="overseer/hooks/band.tsx"]')
      await page.waitFor(`document.querySelectorAll('#ck-stage .dv-diff').length === 2`)
      assert.ok(s.server.seen.includes('/diff/repo-x?lot=27&file=overseer%2Fhooks%2Fband.tsx&view=branch'))
      await page.click('#ck-stage .dv-f[data-diff-view="worktree"]') // closes it, no new fetch
      await page.waitFor(`document.querySelectorAll('#ck-stage .dv-diff').length === 1`)
      assert.equal(s.server.seen.filter(u => u.includes('pane.tsx')).length, 1)
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })

  test('a click on a diff line, on a file, or the R key opens a change request; ⌘↵ sends it to /change', async () => {
    const s = await open(board('live'))
    try {
      await page.click('#ck-stage .dv-f[data-diff-view="worktree"]')
      await page.waitFor(`document.querySelector('#ck-stage .dl.add')`)
      await page.click('#ck-stage .dl.add')
      await page.waitFor(`document.activeElement?.id === 'cr-text'`)
      assert.equal(await text('#cr-form .eyebrow'), 'On overseer/hooks/pane.tsx:913')
      await page.type('Keep the chip on one line.')
      await page.press('Enter', ['meta']); await page.wait(150)
      assert.deepEqual(s.server.posts.map(p => ({ path: p.path, lot: p.body.lot, text: p.body.text, file: p.body.file, line: p.body.line })), [{ path: '/change', lot: 27, text: 'Keep the chip on one line.', file: 'overseer/hooks/pane.tsx', line: 913 }])
      await page.press('Escape'); await page.wait(60)
      await page.click('#ck-stage .dv-f[data-diff-view="worktree"]'); await page.click('#ck-stage .dv-f[data-diff-view="worktree"]') // the stage is drawn again: open it again
      await page.waitFor(`document.querySelector('#ck-stage .dh')`)
      await page.click('#ck-stage .dh')
      await page.waitFor(`document.activeElement?.id === 'cr-text'`)
      assert.equal(await text('#cr-form .eyebrow'), 'On overseer/hooks/pane.tsx')
      await page.press('Escape'); await page.wait(60)
      await page.press('r'); await page.wait(80)
      assert.equal(await text('#cr-form .eyebrow'), 'On the whole task')
    } finally { s.close() }
  })

  test('a reopened lot says "Reopened"; each request shows its state from changes', async () => {
    const s = await open(board('reopened'))
    try {
      assert.match(await text('#ck-main .cr-head .say'), /^Reopened\. /)
      assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#ck-main .cr-item')].map(x => x.className.replace('cr-item ', '') + ': ' + x.querySelector('small').textContent.split(' · ')[1])`), ['sent: sent', 'done: made'])
    } finally { s.close() }
    const t = await open(board('live'))
    try { assert.doesNotMatch(await text('#ck-main .cr-head .say'), /Reopened/) } finally { t.close() }
  })

  test('"open the full diff" and "compare with its base" copy their git command, with the clipboard code of Y', async () => {
    const s = await open(board('live'))
    try {
      await page.evaluate(`Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { (window.__copied ??= []).push(t); return Promise.resolve() } }, configurable: true })`)
      assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#ck-stage [data-copy]')].map(b => b.textContent)`), ['open the full diff', 'compare with its base'])
      await page.click('#ck-stage [data-copy]:first-of-type'); await page.wait(60)
      await page.click('#ck-stage .links [data-copy]:last-child'); await page.wait(60)
      assert.deepEqual(await page.evaluate(`window.__copied`), ['git diff f473ce0aa..a293aebbb', 'git diff --stat f473ce0aa..a293aebbb'])
      assert.equal(await text('#ck-stage .links [data-copy]:last-child'), 'Copied')
      assert.match(await page.evaluate(`document.querySelector('#ck-stage .links').textContent`), /last commit a293aeb/)
    } finally { s.close() }
  })

  test('the merge line: "Merged in X → 0.2.x"; an integration lot lists its lots; a lot with no branch says so', async () => {
    const s = await open(board('done-gaps', { merged: 'b0d2dd19ab', release: '0.2.7' }))
    try {
      assert.match(await text('#ck-stage .dv .say'), /^2 commits on lot\/27-pane · 2 files, \+43 −10\. Merged in b0d2dd1 → 0\.2\.7\.$/)
    } finally { s.close() }
    const integ = board('live', { brief: { type: 'integration', lots: [26, 28], criteria: ['merge them'] }, merged: 'c0ffee1234', release: '0.2.8' })
    integ.lots.push({ n: 26, title: 'The web board', status: 'done', depends: [] })
    const t = await open(integ)
    try {
      assert.match(await text('#ck-stage .dv .say'), /^The task merges tasks 26, 28 into .*\. Merged in c0ffee1 → 0\.2\.8\.$/)
      assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#ck-stage .dv-lots [data-goto]')].map(b => b.dataset.goto + ' ' + b.textContent)`), ['26 26 · The web board', '28 28 · The band follows the mockup'])
      await page.click('#ck-stage .dv-lots [data-goto="26"]'); await page.wait(80)
      assert.equal(await text('#ck-main .ck-mh .num'), '26') // its pane opens
    } finally { t.close() }
    const none = { branch: undefined, base: undefined, tip: undefined, commits: undefined, files: undefined, stat: undefined, dirty: undefined }
    const u = await open(board('done-gaps', none))
    try { assert.equal(await text('#ck-stage .say'), 'No branch: this task changed no code.') } finally { u.close() }
    const v = await open(board('live', none))
    try { assert.equal(await text('#ck-stage .say'), 'No branch yet.') } finally { v.close() }
  })
})
