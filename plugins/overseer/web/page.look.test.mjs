import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { boards } from './fixtures/make.mjs'
import { browserTest, launch } from './test/cdp.mjs'
import { decodePng, HEIGHT, loadRef, refName, skeletonDiff, SKELETON_JS, THEMES, WIDTHS } from './test/ref.mjs'
import { stub } from './test/stub.mjs'

// The look of the page against the references of the mockup (test/ref/, recorded by lot 50): at 4 widths in 2 themes the page has the frame
// of the mockup (the same elements in the same order: top bar, rail, list, lot pane, HUD, side) and its top bar looks like the mockup's.
// The data of the two differ (the mockup has sample data), so the frame is compared as a skeleton and the picture only on the top bar.
const { skip } = browserTest()
const WEB = new URL('.', import.meta.url).pathname
let page
before(async () => { if (!skip) page = await launch() })
after(async () => { await page?.close() })

// The mockup's top bar in a board: its project, three sessions with two at work, 7.2 of 15 points at 1.4 a point an hour, a pass every 10 min.
const mockupLike = () => {
  const now = Date.now(), b = boards['needs-you']
  const s = n => b.sessions.find(x => x.lot === n)
  return { ...b, at: now, repo: '/x/claude-mods', goal: 'reliable signals and a low-cost run', nextPassAt: now + 179.6e3, passEvery: 600e3,
    sessions: [{ ...s(27), stage: 'work', question: undefined, ask: undefined }, { ...s(28), stage: 'work' }, { ...s(27), sessionId: 'f', stage: 'free', lot: undefined }],
    budget: { spent: 7.2, budget: 15, level: 'normal', series: [{ at: now - 3500e3, spent: 5.8 }, { at: now, spent: 7.2 }] } }
}
// the skeleton of the frame: the cockpit's children, the top bar to 3 levels, the rail to 2; the modifiers that come with data (.none) are dropped
function frame(lines) {
  const rows = lines.map(l => { const m = l.match(/^(\d+) (.*)$/); return [Number(m[1]), m[2].replace(/\.none\b/, '')] })
  const start = rows.findIndex(([, t]) => /^div\.ck(\.|$)/.test(t)), base = rows[start][0], out = []
  let kind = ''
  for (let i = start; i < rows.length; i++) {
    const [d, t] = rows[i]
    if (i > start && d <= base) break
    const r = d - base
    if (r === 1) kind = t
    if (r <= 1 || (kind.startsWith('header.ck-top') && r <= 3) || (kind.startsWith('div.ck-rail') && r <= 2)) out.push(`${r} ${t}`)
  }
  return out
}
// the share of pixels that differ in the top 70 rows
function bandRatio(a, b, rows = 70, tol = 8) {
  const A = decodePng(a), B = decodePng(b)
  let diff = 0
  for (let y = 0; y < rows; y++) for (let x = 0; x < A.width; x++) { const i = (y * A.width + x) * 4; if (Math.abs(A.data[i] - B.data[i]) > tol || Math.abs(A.data[i + 1] - B.data[i + 1]) > tol || Math.abs(A.data[i + 2] - B.data[i + 2]) > tol) diff++ }
  return diff / (rows * A.width)
}
const MAX = { 390: 0.035, 1024: 0.035, 1280: 0.035, 1600: 0.035 } // calibrated: measured 0 to 2.0% (the clock digit, the count and the sample text differ)

describe('the page against the mockup references', { skip }, () => {
  // below 600 px the page is the phone of lot 67 (mockups/phone), not this frame: phone.browser.test.mjs checks it
  for (const width of WIDTHS.filter(w => w >= 600)) for (const theme of THEMES) test(`${refName(width, theme)}: the frame of the mockup, and its top bar`, async () => {
    const server = await stub({ root: WEB, boards: { 'repo-x': mockupLike() } })
    try {
      await page.view({ width, height: HEIGHT, dark: theme === 'dark' })
      await page.goto('about:blank'); await page.goto(`${server.url}/`)
      await page.waitFor(`document.querySelector('#ck-main .ck-mh')`)
      const ref = loadRef(refName(width, theme))
      const diffs = skeletonDiff(frame(ref.skeleton), frame(await page.evaluate(SKELETON_JS)))
      assert.deepEqual(diffs, [], `the frame differs from the mockup at ${refName(width, theme)}`)
      const ratio = bandRatio(await page.screenshot(), ref.png)
      assert.ok(ratio <= MAX[width], `the top bar differs from the mockup by ${(ratio * 100).toFixed(1)}% of its pixels at ${refName(width, theme)}`)
      assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true) // no scroll to the side
      assert.equal(await page.evaluate(`document.body.className === '' && !document.querySelector('[class*="proposal"]')`), true)
    } finally { server.close() }
  })
  test('the matrix measures what it should: a page with another top bar differs by more', async () => {
    const server = await stub({ root: WEB, boards: { 'repo-x': { ...mockupLike(), goal: 'a very different goal that is long enough to move the top bar', repo: '/x/another-project-with-a-long-name' } } })
    try {
      await page.view({ width: 1280, height: HEIGHT }); await page.goto('about:blank'); await page.goto(`${server.url}/`); await page.waitFor(`document.querySelector('#ck-main .ck-mh')`)
      const same = bandRatio(await page.screenshot(), loadRef(refName(1280, 'light')).png)
      assert.ok(same > 0.02, `${same}`)
    } finally { server.close() }
  })
})
