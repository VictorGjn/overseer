import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { boards } from './fixtures/make.mjs'
import { browserTest, launch } from './test/cdp.mjs'
import { stub } from './test/stub.mjs'
import { commitsOf, draw, treeSVG } from './gittree.js'

// Lot 43: gittree.js draws the rows of Board.graph as the mockup does. The pure part runs in node; the page part on the harness of lot 50.
const { skip } = browserTest()
const WEB = new URL('.', import.meta.url).pathname
const G = boards.live.graph
const count = (svg, re) => (svg.match(re) ?? []).length

describe('treeSVG', () => {
  test('one circle for each commit, one edge for each parent in the rows, a ring and a version above for each release', () => {
    const svg = treeSVG(G, { selected: 27, trunk: 'feat/overseer-board' })
    assert.equal(count(svg, /<circle/g), 20)
    assert.equal(count(svg, /<circle class="c rel/g), 1)
    assert.equal(count(svg, /class="tag"/g), 1); assert.match(svg, /class="tag"[^>]*>0\.2\.6</)
    assert.equal(count(svg, /<path class="e"/g), G.reduce((n, r) => n + r.parents.filter(p => G.some(x => x.hash === p)).length, 0))
    assert.match(svg, /<text x="\d+" y="34" class="ref">feat\/overseer-board<\/text>/) // the trunk's label
    const three = G.map((r, i) => (i % 7 === 0 ? { ...r, version: `0.3.${i}` } : { ...r, version: undefined }))
    assert.equal(count(treeSVG(three), /<circle class="c rel/g), 3)
  })
  test('one OKLCH hue for each lot, the golden angle apart; the trunk is --ink and a commit of no lot is grey', () => {
    const svg = treeSVG(G)
    const lot = G.find(r => r.lot && r.lane); const n = lot.lot
    assert.match(svg, new RegExp(`data-n="${n}" cx="\\d+" cy="\\d+" r="[\\d.]+" fill="oklch\\(var\\(--gt-l\\) var\\(--gt-c\\) ${Math.round(n * 137.5 % 360)}\\)"`))
    assert.match(svg, /fill="var\(--ink\)"/); assert.match(svg, /fill="var\(--ink-3\)"/)
  })
  test('the selected lot is ringed, a branch is labelled without its lot/ prefix, a long label is cut', () => {
    const rows = [{ graph: '*', hash: 'b', parents: [], refs: ['lot/27-' + 'x'.repeat(60)], subject: 's', lane: 1, x: 1, lot: 27 }, { graph: '*', hash: 'a', parents: [], refs: ['tag: v1'], subject: 't', lane: 0, x: 0 }]
    const svg = treeSVG(rows, { selected: '27' })
    assert.match(svg, /<circle class="c lot sel" data-n="27"/)
    assert.match(svg, /class="ref"[^>]*>27-x+…</)
    assert.ok(!svg.includes('v1</text>'))
  })
  test('text of a commit is escaped; connector rows and rows with no hash are not commits', () => {
    const svg = treeSVG([{ graph: '|' }, { graph: '*', hash: 'a', subject: '<img src=x onerror=1>', parents: [] }])
    assert.ok(!svg.includes('<img')); assert.match(svg, /&lt;img/)
    assert.equal(commitsOf([{ graph: '|' }]).length, 0)
  })
  test('an empty graph does not throw', () => {
    assert.equal(treeSVG([]), ''); assert.equal(treeSVG(undefined), '')
    const el = { innerHTML: '' }
    draw(el, { board: { graph: [] } }); assert.match(el.innerHTML, /No commits yet/)
    draw(el, { board: {} }); assert.match(el.innerHTML, /Not exported yet/)
    draw(el, {}); assert.match(el.innerHTML, /Not exported yet/)
  })
})

let page
before(async () => { if (!skip) page = await launch() })
after(async () => { await page?.close() })
async function open(board) {
  const server = await stub({ root: WEB, boards: { 'repo-x': { ...board, at: Date.now(), nextPassAt: Date.now() + 150e3 } } })
  await page.view({ width: 1280, height: 900 }); await page.goto('about:blank'); await page.goto(`${server.url}/`)
  await page.waitFor(`document.querySelector('#ck-main .ck-mh, #ck-main .ck-empty')`)
  return server
}
const key = async k => { await page.press(k); await page.wait(60) }

describe('the git tree on the page', { skip }, () => {
  test('G opens the tree on the fixture: its circles, its release ring, its edges; the hue shows only when it is open', async () => {
    const s = await open(boards.live); try {
      assert.equal(await page.evaluate(`document.querySelectorAll('#ck-gtree svg').length`), 0) // closed: no drawing, no hue
      await key('g'); await page.waitFor(`document.querySelectorAll('#ck-gtree circle.c').length`)
      assert.deepEqual(await page.evaluate(`[document.querySelectorAll('#ck-gtree circle.c').length, document.querySelectorAll('#ck-gtree circle.c.rel').length, document.querySelectorAll('#ck-gtree path.e').length, document.querySelector('#ck-gtree .tag').textContent]`), [20, 1, 19, '0.2.6'])
      assert.equal(await page.evaluate(`!!document.querySelector('#ck-gtree').offsetParent && document.querySelector('.rail').offsetParent === null`), true) // the tree replaces the rail
      assert.match(await page.evaluate(`getComputedStyle(document.querySelector('#ck-gtree circle.c.lot')).fill`), /./)
      await key('g'); assert.equal(await page.evaluate(`document.getElementById('ck-gtree').hidden`), true)
      assert.deepEqual(page.errors, [])
    } finally { s.close() }
  })
  test('the button opens it too; a click on a commit selects its lot; the selected lot is ringed', async () => {
    const lots = [...boards.live.lots, ...[...new Set(G.filter(r => r.lot).map(r => r.lot))].filter(n => n !== 27).map(n => ({ n, title: `Lot ${n}`, status: 'done', depends: [] }))]
    const s = await open({ ...boards.live, lots }); try {
      await page.click('#ck-gt'); await page.waitFor(`document.querySelector('#ck-gtree circle.c.lot')`)
      const n = await page.evaluate(`[...document.querySelectorAll('#ck-gtree circle.c.lot')].map(c => c.dataset.n).find(n => n !== '27')`)
      assert.ok(n, 'a commit of another lot')
      await page.evaluate(`document.querySelector('#ck-gtree circle.c.lot[data-n="${n}"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
      await page.wait(100)
      assert.equal(await page.evaluate(`document.getElementById('ck-gtree').querySelector('circle.c.sel')?.dataset.n`), n)
      assert.equal(await page.evaluate(`document.querySelector('#ck-main .ck-mh .num').textContent`), n) // and the lot pane shows it
    } finally { s.close() }
  })
  test('an empty graph, and a board with no graph, do not throw', async () => {
    const empty = await open({ ...boards.live, graph: [] }); try {
      await key('g'); assert.match(await page.evaluate(`document.getElementById('ck-gtree').textContent`), /No commits yet/)
      assert.deepEqual(page.errors, [])
    } finally { empty.close() }
    const none = await open({ ...boards.live, graph: undefined }); try {
      await key('g'); assert.match(await page.evaluate(`document.getElementById('ck-gtree').textContent`), /Not exported yet/)
      assert.deepEqual(page.errors, [])
    } finally { none.close() }
  })

  test('task 63: labels of branches whose tips share a place, or follow each other on a lane, never overlap; a release has its ring and a lot its hue', async () => {
    // trunk t0..t9 (lane 0, a release at t6), lane 1 holds two branches one after the other, lanes 2 to 4 each one: all tips near x = 8
    const row = (hash, o) => ({ graph: '*', hash, parents: [], refs: [], subject: hash, at: 1792000000000 + (o.x ?? 0) * 6e4, lane: 0, x: 0, ...o })
    const trunk = Array.from({ length: 10 }, (_, i) => row(`t${i}`, { x: i, parents: i ? [`t${i - 1}`] : [], ...(i === 6 ? { version: '0.3.0', refs: ['tag: v0.3.0'] } : {}) }))
    const tip = (hash, lane, x, lot, name) => row(hash, { lane, x, lot, parents: ['t2'], refs: [`lot/${lot}-${name}`] })
    const graph = [...trunk, tip('a', 1, 5, 41, 'overseer-first-branch-name'), tip('b', 1, 7, 42, 'overseer-second-branch-name'), tip('c', 2, 8, 43, 'the-third-branch'), tip('d', 3, 8, 44, 'the-fourth-branch'), tip('e', 4, 8, 45, 'the-fifth-branch'), tip('f', 1, 9, 46, 'overseer-sixth-branch-name')].reverse()
    const s = await open({ ...boards.live, graph }); try {
      await key('g'); await page.waitFor(`document.querySelectorAll('#ck-gtree text.ref').length >= 7`)
      const boxes = await page.evaluate(`[...document.querySelectorAll('#ck-gtree text.ref, #ck-gtree text.tag')].map(t => { const b = t.getBBox(); return { t: t.textContent, x: b.x, y: b.y, r: b.x + b.width, d: b.y + b.height } })`)
      assert.ok(boxes.length >= 8, `trunk label, 6 branches and a version: ${boxes.map(b => b.t)}`)
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        assert.ok(a.r <= b.x || b.r <= a.x || a.d <= b.y || b.d <= a.y, `"${a.t}" and "${b.t}" overlap`)
      }
      assert.equal(await page.evaluate(`document.querySelectorAll('#ck-gtree circle.rel').length`), 1) // the release ring
      const hue = await page.evaluate(`(() => { const c = document.querySelector('#ck-gtree circle.c.lot[data-n="43"]'), p = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); p.setAttribute('fill', 'oklch(var(--gt-l) var(--gt-c) ' + Math.round(43 * 137.5 % 360) + ')'); c.parentNode.append(p); const out = [getComputedStyle(c).fill, getComputedStyle(p).fill]; p.remove(); return out })()`)
      assert.equal(hue[0], hue[1]); assert.match(hue[0], /oklch|color\(|lab\(/)
      assert.equal(await page.evaluate(`new Set([...document.querySelectorAll('#ck-gtree circle.c.lot')].map(c => getComputedStyle(c).fill)).size`), 6) // one hue for each task
    } finally { s.close() }
  })
})
