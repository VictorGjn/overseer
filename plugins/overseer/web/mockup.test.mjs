import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserTest, launch } from './test/cdp.mjs'
import { MOCKUP, WEB } from './test/record.mjs'
import { stub } from './test/stub.mjs'

// The mockup in a real Chrome (test/cdp.mjs): a page error is a failure, and the empty project shows its message.
// Fails where Chrome is missing, unless OVERSEER_NO_BROWSER=1.
const { skip } = browserTest()

test('mockup #empty shows the empty project and throws no page error', { skip }, async () => {
  const server = await stub({ root: WEB }), page = await launch()
  try {
    await page.view({ width: 1280, height: 900 })
    await page.goto(`${server.url}${MOCKUP}#empty`)
    assert.deepEqual(page.errors, [])
    assert.equal(await page.evaluate(`(() => { const e = document.querySelector('.ck-empty'); return !!e && !e.hidden && e.offsetParent !== null })()`), true)
  } finally { await page.close(); server.close() }
})
