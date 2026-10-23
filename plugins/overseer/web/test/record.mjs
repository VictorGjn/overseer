// Records the mockup's reference: node overseer/web/test/record.mjs. One DOM skeleton and one screenshot per width x theme under ./ref/.
// The mockup is the contract of the page (lot 40): record again only when the mockup is changed on purpose, and read the git diff.
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './cdp.mjs'
import { HEIGHT, refName, saveRef, SKELETON_JS, THEMES, WIDTHS } from './ref.mjs'
import { stub } from './stub.mjs'

export const MOCKUP = '/mockups/board-v3.html'
export const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')

// One page at one width and theme: { skeleton, png }. The page is opened fresh, with the browser's storage emptied.
export async function capture(page, url, width, theme) {
  await page.view({ width, height: HEIGHT, dark: theme === 'dark' })
  await page.goto(url)
  await page.evaluate(`localStorage.clear()`)
  await page.goto(url)
  return { skeleton: await page.evaluate(SKELETON_JS), png: await page.screenshot() }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const server = await stub({ root: WEB })
  const page = await launch()
  try {
    for (const width of WIDTHS) for (const theme of THEMES) {
      const { skeleton, png } = await capture(page, server.url + MOCKUP, width, theme)
      saveRef(refName(width, theme), skeleton, png)
      console.log(`${refName(width, theme)}: ${skeleton.length} elements, ${(png.length / 1024).toFixed(0)} KiB`)
    }
  } finally { await page.close(); server.close() }
}
