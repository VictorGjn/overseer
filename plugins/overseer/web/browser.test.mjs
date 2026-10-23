import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { browserTest, launch } from './test/cdp.mjs'
import { capture, MOCKUP, WEB } from './test/record.mjs'
import { compare, hasRef, pixelRatio, refName, skeletonDiff, THEMES, WIDTHS } from './test/ref.mjs'
import { stub } from './test/stub.mjs'

// The mockup in a real Chrome (test/cdp.mjs): one test for each key of the CONTRACT.md KEYS table, the look against its recorded
// reference (test/ref/) at 4 widths in 2 themes, and the harness itself. A machine with no Chrome fails here, or sets
// OVERSEER_NO_BROWSER=1 to skip. The keys act on the mockup, which has no server: its sample lots stand in for the board,
// and a key that sends a request (POST /answer, /gate, /plan, /lot, /change; GET /boards) is checked on its DOM result here
// and on its request by the v3 page (lot 40), against the stub server's recorded bodies.
const { skip } = browserTest()

let page, server
before(async () => { if (skip) return; server = await stub({ root: WEB }); page = await launch() })
after(async () => { await page?.close(); server?.close() })

// The page, fresh: storage emptied, then loaded again, at one size.
const open = async (hash = '', size = { width: 1280, height: 900 }) => {
  await page.view(size)
  await page.goto(server.url + MOCKUP)
  await page.evaluate('localStorage.clear()')
  await page.goto(server.url + MOCKUP + hash)
}
const state = () => page.evaluate(`(() => { const q = s => document.querySelector(s); return {
  view: !q('#view-cockpit').hidden ? 'overview' : !q('#view-review').hidden ? 'review' : 'board',
  lot: q('.ck-row[aria-current="true"]')?.dataset.n, tab: q('[data-tab][aria-pressed="true"]')?.dataset.tab,
  listOff: q('#view-cockpit').classList.contains('list-off'), listBtn: q('#ck-lt').textContent,
  tree: q('#view-cockpit').classList.contains('gt-open') && !q('#ck-gtree').hidden,
  menu: !q('#pj-menu').hidden, menuFocus: !!document.activeElement?.closest('#pj-menu'), draft: document.activeElement?.id === 'cr-text',
  card: [...document.querySelectorAll('.zcard[data-z]')].findIndex(c => !c.hidden), pos: q('#z-pos').textContent, end: !q('#z-end').hidden,
  reply: [...document.querySelectorAll('.zreply')].some(e => !e.hidden), file: q('#z-file')?.textContent } })()`)
const key = async (k, mods) => { await page.press(k, mods); await page.wait(60) }
const goReview = async (card = 0) => { await open(); await key('z'); await key('m'); if (card) { await page.evaluate(`zi = ${card}; zrender()`) } }

describe('Overview keys', { skip }, () => {
  test('j and ↓ select the next lot', async () => {
    await open(); assert.equal((await state()).lot, '27')
    await key('j'); assert.equal((await state()).lot, '28')
    await key('ArrowDown'); assert.equal((await state()).lot, '26')
  })
  test('k and ↑ select the previous lot', async () => {
    await open(); await key('j'); await key('j')
    await key('k'); assert.equal((await state()).lot, '28')
    await key('ArrowUp'); assert.equal((await state()).lot, '27')
  })
  test('w, c and t open the Workflow, Changes and Tests stage', async () => {
    await open()
    await key('c'); assert.equal((await state()).tab, 'ch')
    await key('t'); assert.equal((await state()).tab, 'te')
    await key('w'); assert.equal((await state()).tab, 'wf')
  })
  test('Enter opens the lot\'s need in Review', async () => {
    await open(); await key('j') // lot 28, whose need is card 0
    await key('Enter')
    const s = await state(); assert.equal(s.view, 'review'); assert.equal(s.card, 0)
  })
  test('[ folds the list, and shows it again', async () => {
    await open()
    await key('['); assert.deepEqual([(await state()).listOff, (await state()).listBtn], [true, 'Show the list'])
    await key('['); assert.deepEqual([(await state()).listOff, (await state()).listBtn], [false, 'Hide the list'])
  })
  test('g opens the git tree, and closes it', async () => {
    await open()
    await key('g'); assert.equal((await state()).tree, true)
    await key('g'); assert.equal((await state()).tree, false)
  })
  test('p opens the projects menu with the focus in it; Esc closes it', async () => {
    await open()
    await key('p'); assert.deepEqual([(await state()).menu, (await state()).menuFocus], [true, true]) // GET /boards feeds the rows on the v3 page
    await key('Escape'); assert.equal((await state()).menu, false)
  })
  test('r opens the change request with the focus in its text box', async () => {
    await open()
    await key('r'); const s = await state(); assert.deepEqual([s.tab, s.draft], ['ch', true]) // POST /change on submit (v3 page)
    await key('Escape'); assert.equal((await state()).draft, false)
  })
  test('z then m opens Review; m alone does nothing', async () => {
    await open()
    await key('m'); assert.equal((await state()).view, 'overview')
    await key('z'); await key('m'); assert.equal((await state()).view, 'review')
  })
  test('a key typed in a text box is not a shortcut', async () => {
    await open(); await key('r'); await page.type('j'); await key('j')
    assert.equal((await state()).lot, '27')
  })
})

describe('Review keys', { skip }, () => {
  test('Esc goes back to the view you came from', async () => {
    await goReview(); assert.equal((await state()).view, 'review')
    await key('Escape'); assert.equal((await state()).view, 'overview')
  })
  test('j and ← go to the previous card, k and → to the next', async () => {
    await goReview()
    await key('ArrowRight'); assert.equal((await state()).card, 1)
    await key('j'); assert.equal((await state()).card, 0)
    await key('k'); assert.equal((await state()).card, 1)
    await key('ArrowLeft'); assert.equal((await state()).card, 0)
  })
  test(', and . change the file', async () => {
    await goReview(1); assert.equal((await state()).file, '1')
    await key('.'); assert.equal((await state()).file, '2')
    await key(','); assert.equal((await state()).file, '1')
  })
  test('Enter opens the reply box, and Enter again with a text sends it: the card is done', async () => {
    await goReview(); const before = (await state()).pos
    await key('Enter'); assert.equal((await state()).reply, true)
    await page.type('Keep it.'); await key('Enter') // POST /answer { text } on the v3 page
    const s = await state(); assert.equal(s.reply, false); assert.notEqual(s.pos, before)
  })
  test('⌘Enter sends the recommended answer: the card is done', async () => {
    await goReview(1); const before = (await state()).pos
    await key('Enter', ['meta']) // POST /answer { label } on the v3 page
    assert.notEqual((await state()).pos, before)
  })
  test('1 chooses the first option: the card is done', async () => {
    await goReview(1); const before = (await state()).pos
    await key('1'); assert.notEqual((await state()).pos, before)
  })
  test('2 chooses the second option: the card is done', async () => {
    await goReview(1); const before = (await state()).pos
    await key('2'); assert.notEqual((await state()).pos, before)
  })
  test('a approves: the card is done', async () => {
    await goReview(); const before = (await state()).pos
    await key('a'); assert.notEqual((await state()).pos, before) // POST /gate or /plan on the v3 page
  })
  test('c asks for a change: the reply box opens', async () => {
    await goReview(); await key('c'); assert.equal((await state()).reply, true)
  })
  test('r rejects: the card is done', async () => {
    await goReview(); const before = (await state()).pos
    await key('r'); assert.notEqual((await state()).pos, before)
  })
  test('e marks the card done', async () => {
    await goReview(); await page.evaluate('zdone.clear(); zi = 2; zrender()') // the reinstall card, open again
    const before = (await state()).pos; await key('e'); assert.notEqual((await state()).pos, before) // POST /lot on the v3 page
  })
  test('y copies the command', async () => {
    await goReview(); await page.evaluate(`zdone.clear(); zi = 2; zrender(); Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve() } }, configurable: true })`)
    await key('y'); await page.waitFor(`window.__copied === 'claude plugin update overseer@claude-mods'`)
    assert.match(await page.evaluate(`document.querySelector('.zcard:not([hidden]) [data-act="copy"]').textContent`), /Copied/)
  })
  test('a key with a modifier is not a shortcut', async () => {
    await goReview(); const before = (await state()).pos
    await key('a', ['ctrl']); assert.equal((await state()).pos, before)
  })
})

describe('the look against the reference', { skip }, () => {
  for (const width of WIDTHS) for (const theme of THEMES) {
    test(`${refName(width, theme)}: the same elements, the same pixels`, async () => {
      assert.equal(hasRef(refName(width, theme)), true, `no reference for ${refName(width, theme)}: run node overseer/web/test/record.mjs`)
      assert.deepEqual(await page.evaluate('[document.querySelectorAll("#view-cockpit").length]'), [1])
      const got = await capture(page, server.url + MOCKUP, width, theme)
      const d = compare(refName(width, theme), got.skeleton, got.png)
      assert.deepEqual(d.skeleton.slice(0, 5), [], `${d.skeleton.length} skeleton differences`)
      assert.ok(d.ratio < 0.002, `${(d.ratio * 100).toFixed(2)}% of the pixels differ from test/ref/${refName(width, theme)}.png`)
    })
  }
  test('the theme and the width change the picture, so the references are not all one', async () => {
    const png = async (width, dark) => { await page.view({ width, height: 900, dark }); await page.goto(server.url + MOCKUP); return page.screenshot() }
    const light = await png(1280, false)
    assert.ok(pixelRatio(light, await png(1280, true)) > 0.5)
    assert.equal(pixelRatio(light, await png(1280, false)), 0)
  })
})

describe('the harness', { skip }, () => {
  test('a click reaches the page and a POST reaches the stub, body and origin recorded', async () => {
    await page.view({ width: 800, height: 600 })
    server.posts.length = 0
    await page.goto(`${server.url}/test/fixture/post.html`)
    await page.click('#send')
    await page.waitFor('document.title === "sent"')
    assert.deepEqual(server.posts.map(p => [p.path, p.body]), [['/answer', { slug: 'x', id: 'q1', label: 'keep them' }]])
    assert.equal(server.posts[0].origin, server.url)
  })
  test('the page reports its colour scheme, its size and a computed style as it was set', async () => {
    await page.view({ width: 500, height: 400, dark: true })
    await page.goto(`${server.url}/test/fixture/post.html`)
    assert.equal(await page.evaluate('matchMedia("(prefers-color-scheme: dark)").matches'), true)
    assert.equal(await page.evaluate('innerWidth'), 500)
    assert.equal(await page.style('#send', 'display'), 'inline-block')
    await page.view({ width: 500, height: 400, dark: false })
    assert.equal(await page.evaluate('matchMedia("(prefers-color-scheme: dark)").matches'), false)
  })
  test('a page error is collected', async () => {
    await page.goto(`${server.url}/test/fixture/post.html`)
    const before = page.errors.length
    await page.evaluate('setTimeout(() => { throw new Error("boom") }, 0)')
    await page.waitFor('true'); await page.wait(100)
    assert.equal(page.errors.length, before + 1)
    page.errors.length = 0
  })
})

describe('the comparison', () => {
  test('with no Chrome the browser tests fail, unless OVERSEER_NO_BROWSER=1 skips them', () => {
    assert.throws(() => browserTest({}, () => false), /Chrome not found/)
    assert.throws(() => browserTest({ OVERSEER_NO_BROWSER: '0' }, () => false), /Chrome not found/)
    assert.match(browserTest({ OVERSEER_NO_BROWSER: '1' }, () => false).skip, /no Chrome/)
    assert.deepEqual(browserTest({ CHROME: '/x/chrome' }, p => p === '/x/chrome'), { skip: false })
  })
  test('skeletonDiff says where two skeletons stop agreeing', () => {
    const ref = ['0 body', '1 div.a', '2 p', '1 div.b']
    assert.deepEqual(skeletonDiff(ref, ref), [])
    assert.deepEqual(skeletonDiff(ref, ['0 body', '1 div.a', '1 div.b']), [{ at: 2, ref: '2 p' }])
    assert.deepEqual(skeletonDiff(ref, ['0 body', '1 div.a', '2 p', '2 span', '1 div.b']), [{ at: 3, got: '2 span' }])
    assert.deepEqual(skeletonDiff(ref, ['0 body', '1 div.a', '2 p', '1 div.c']), [{ at: 3, got: '1 div.c' }, { at: 3, ref: '1 div.b' }])
  })
  test('pixelRatio is 0 for the same picture, 1 for another size, and the share that differs otherwise', { skip }, async () => {
    const shot = async (html, w = 100, h = 50) => { await page.view({ width: w, height: h }); await page.goto(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:#fff">${html}`)}`); return page.screenshot() }
    const white = await shot(''), quarter = await shot('<div style="width:50px;height:25px;background:#000"></div>')
    assert.equal(pixelRatio(white, white), 0)
    assert.equal(pixelRatio(white, quarter), 0.25)
    assert.equal(pixelRatio(white, await shot('', 120, 50)), 1)
  })
})
