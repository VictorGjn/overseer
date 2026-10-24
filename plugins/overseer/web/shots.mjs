// Rebuilds every image of the README (docs/img/) from the fixtures: `node plugins/overseer/web/shots.mjs [outDir]`.
// The board runs on the stub server (test/stub.mjs) in the system Chrome (test/cdp.mjs), fed with fixtures/make.mjs and nothing else.
// Needs Chrome and ffmpeg (FFMPEG, else /opt/homebrew/bin/ffmpeg, else the one on PATH). Stdlib only.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './test/cdp.mjs'
import { stub } from './test/stub.mjs'
import { boards } from './fixtures/make.mjs'

const WEB = fileURLToPath(new URL('.', import.meta.url))
const MIN = 60e3, FIXTURE_NOW = 1792000000000 // the fixtures' "now" (make.mjs: T)
const FFMPEG = process.env.FFMPEG ?? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(existsSync) ?? 'ffmpeg'

// The fixtures' clock is fixed, the page reads the real one: move every time of a board by the difference, so "waited 3 min" reads right.
const rebase = (x, d) => typeof x === 'number' ? (Math.abs(x - FIXTURE_NOW) < 2e9 ? x + d : x) : Array.isArray(x) ? x.map(v => rebase(v, d)) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, rebase(v, d)])) : x
const now = b => ({ ...rebase(b, Date.now() - FIXTURE_NOW), at: Date.now(), nextPassAt: Date.now() + 150e3 })

// A few lines of the log, so the Activity has something to say (labels and texts of the fixtures only).
const feed = [
  [2, 'assign', 'worker-dd', 'lot 27'], [9, 'done', 'worker-bf', 'lot 24'], [21, 'decided', 'worker-bf', 'drawer'], [34, 'retry', 'worker-dd', 'lot 23'],
  [47, 'blocked', 'worker-bf', 'lot 26'], [58, 'done', 'worker-dd', 'lot 23'], [71, 'assign', 'worker-bf', 'lot 24'], [96, 'done', 'worker-dd', 'lot 22'],
].map(([m, action, label, text]) => ({ at: FIXTURE_NOW - m * MIN, action, label, text }))

// A run in progress: `k` of the planned tasks are done, two are running, the others wait.
const doneT = boards.calm.lots[0], runT = boards.live.lots[0], todoT = boards.planned.lots.slice(0, 8)
function story(k) {
  const lots = todoT.map((t, i) => i < k ? { ...doneT, n: t.n, title: t.title, brief: t.brief } : i < k + 2 ? { ...runT, n: t.n, title: t.title, brief: t.brief, session: sid(i) } : t)
  const sessions = lots.filter(l => l.status === 'running').map((l, j) => ({ ...boards.live.sessions[0], sessionId: sid(l.n), label: ['worker-dd', 'worker-bf'][(l.n + j) % 2], lot: l.n }))
  return { ...boards.live, lots, sessions, feed, proposed: [], passing: k % 3 === 1, graph: undefined }
}
const sid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const live = { ...boards.live, feed }

const out = resolve(process.argv[2] ?? fileURLToPath(new URL('../../../docs/img', import.meta.url)))
mkdirSync(out, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'ov-shots-'))
const page = await launch()
let server
const wait = ms => new Promise(ok => setTimeout(ok, ms))

async function open(board, { width = 1440, height = 900, dark = false, phone = false } = {}) {
  server?.close()
  server = await stub({ root: WEB, boards: { 'repo-x': now(board) } })
  await page.view({ width, height, dark })
  if (phone) await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false })
  await page.goto('about:blank'); await page.goto(`${server.url}/`)
  await page.waitFor(`document.querySelector('#ck-main .ck-mh, #ck-main .ck-empty, #phone .pp-top')`)
  await page.wait(600)
}
// The gate's graph editor (workflow-gate) on a six-step fixture: its own server in a throwaway HOME, so ~/.claude stays untouched.
async function gate() {
  const hooks = resolve(WEB, '../../workflow-gate/hooks'), home = join(tmp, 'gate-home'), portFile = join(home, 'port')
  mkdirSync(home, { recursive: true })
  const srv = spawn(process.execPath, [join(hooks, 'approve-server.mjs'), 'shots-nonce', portFile, join(hooks, 'test/fixtures/six-steps.mjs')], { env: { ...process.env, HOME: home, USERPROFILE: home, TYPESAFE_API_KEY: '' }, stdio: 'ignore' })
  try {
    let port
    for (let i = 0; i < 100 && !port; i++) { await wait(50); try { port = JSON.parse(readFileSync(portFile, 'utf8')).port } catch {} }
    if (!port) throw new Error('the approval server did not start')
    await page.view({ width: 1440, height: 900 })
    await page.goto('about:blank'); await page.goto(`http://127.0.0.1:${port}/?n=shots-nonce`) // the editor loads acorn and cytoscape from their CDNs
    await page.waitFor(`document.querySelectorAll('canvas').length > 0 && /approve/i.test(document.body.innerText)`)
    await page.wait(1500)
    await save('gate.png')
  } finally { srv.kill() }
}
const set = async board => { server.setBoard('repo-x', now(board)); await page.wait(350) }
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.press(k); await page.wait(150) } }
const tap = async sel => { await page.click(sel); await page.wait(250) }
const review = async () => { await key('z'); await key('m'); await page.waitFor(`!document.querySelector('#view-review').hidden`) }
const save = async (name, clip) => writeFileSync(join(out, name), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png', ...(clip && { clip: { ...clip, scale: 1 } }) })).data, 'base64'))
// the box around some elements, with a margin, inside the page
const around = async (sels, pad = 24) => page.evaluate(`(() => { const r = ${JSON.stringify(sels)}.map(s => document.querySelector(s).getBoundingClientRect()), l = Math.max(0, Math.min(...r.map(x => x.left)) - ${pad}), t = Math.max(0, Math.min(...r.map(x => x.top)) - ${pad}); return { x: l, y: t, width: Math.min(innerWidth - l, Math.max(...r.map(x => x.right)) + ${pad} - l), height: Math.min(innerHeight - t, Math.max(...r.map(x => x.bottom)) + ${pad} - t) } })()`)

// frames of a GIF: a list of [png path, seconds]; ffmpeg builds the palette from all of them
const frames = []
const frame = async (name, secs = 0.8) => { const f = join(tmp, `${name}-${frames.length}.png`); writeFileSync(f, Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); frames.push([f, secs]) }
function gif(name, width, fps = 10) {
  const list = join(tmp, `${name}.txt`), last = frames[frames.length - 1]
  writeFileSync(list, [...frames.flatMap(([f, s]) => [`file '${f}'`, `duration ${s}`]), `file '${last[0]}'`].join('\n'))
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', join(out, name)])
  frames.length = 0
}

try {
  // the board, light and dark
  await open(live); await save('board-light.png')
  await open(live, { dark: true }); await save('board-dark.png')
  // what needs you: the overview, then the review (zen), its decision, the gate, the budget, and the log
  await open(boards['needs-you']); await save('needs-you.png')
  await review(); await save('zen.png')
  await key('j', 3); await save('budget.png', await around(['#z-pos', '#z-cards']))
  await gate()
  await open(live); await save('activity.png', await around(['#ck-list'], 0))
  // the phone
  const P = { width: 393, height: 852, phone: true }
  await open(boards['needs-you'], P); await save('phone-needs.png')
  await open(story(3), P); await tap('[data-pp-tab="tasks"]'); await save('phone-tasks.png')
  await open(live, P); await tap('[data-pp-tab="activity"]'); await save('phone-activity.png')

  // hero.gif: the run moves across the lanes, Next to Now to done
  await open(story(0), { height: 960 }) // taller than the others, so the long Planned list does not push the log off the frame
  for (let k = 0; k <= 6; k++) { await set(story(k)); await tap(`.ck-row[data-n="${todoT[k].n}"]`); await frame('hero', k === 0 ? 1.2 : 0.9) }
  await frame('hero', 1.5)
  gif('hero.gif', 1100, 8)
  // zen.gif: the review goes through its cards
  await open(boards['needs-you']); await review(); await frame('zen', 1.1)
  for (let i = 0; i < 3; i++) { await key('j'); await frame('zen', 1.1) }
  gif('zen.gif', 960, 8)
  // phone.gif: needs, then tasks, then activity
  await open(boards['needs-you'], P); await frame('phone', 1.6)
  await set(story(3)); await tap('[data-pp-tab="tasks"]'); await frame('phone', 1.6)
  await set(live); await tap('[data-pp-tab="activity"]'); await frame('phone', 1.6)
  gif('phone.gif', 393 * 2, 8)
} finally {
  server?.close(); await page.close(); rmSync(tmp, { recursive: true, force: true })
}
console.log(`images in ${out}`)
