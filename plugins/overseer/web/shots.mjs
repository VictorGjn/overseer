// Rebuilds every image of the README (docs/img/) from the fixtures: `node plugins/overseer/web/shots.mjs [outDir]`.
// The board runs on the stub server (test/stub.mjs) in the system Chrome (test/cdp.mjs), fed with fixtures/make.mjs and nothing else.
// Needs Chrome and ffmpeg (FFMPEG, else /opt/homebrew/bin/ffmpeg, else the one on PATH). Stdlib only.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launch } from './test/cdp.mjs'
import { stub } from './test/stub.mjs'
import { boards } from './fixtures/make.mjs'

const WEB = fileURLToPath(new URL('.', import.meta.url))
// The /gate terminal screens (gate-*.png, gate-live.gif): the mod's own pure code (layout, paint, the side cards) draws them, so they cannot drift from it.
// Node strips the types of .ts; canvas.tsx also holds the pane's JSX, which Node cannot read, so only its pure half (up to "Handlers are set once") is loaded.
// ponytail: cut at that comment; if the mod moves it, this import fails loudly.
registerHooks({ load(url, ctx, next) {
  if (!url.endsWith('/workflow-gate-terminal/hooks/canvas.tsx')) return next(url, ctx)
  const src = readFileSync(new URL(url), 'utf8'), cut = src.indexOf('// Handlers are set once')
  if (cut < 0) throw new Error('canvas.tsx changed: update shots.mjs where it cuts the pane out')
  return { format: 'module-typescript', source: src.slice(0, cut), shortCircuit: true }
} })
const MOD = resolve(WEB, '../../workflow-gate-terminal/hooks')
const mod = f => import(pathToFileURL(join(MOD, f)).href)
const { paint, bar, MODEL_COLOR } = await mod('canvas.tsx')
const { extract } = await mod('flow.ts')
const { layout } = await mod('layout.ts')
const { planFlags } = await mod('fallacy.ts')
const { planLines, orchestratorLines, retroLines, wrap, placeSide, graphCols } = await mod('side.ts')
const { banditUpdate, suggestTier, rng } = await mod('learn.ts')
const { recordLine } = await mod('review.ts')
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

// ---- the /gate terminal (workflow-gate-terminal): a fixture workflow, drawn as the terminal draws it --------------------------------------------
// A generic feature: scout and tests in parallel, build, three reviewers, verify, summarize. No mission of a real project.
const GATE_SRC = `export const meta = { name: 'add-csv-export', description: 'Add CSV export to the reports page', phases: [{ title: 'Scout' }, { title: 'Build' }, { title: 'Check' }] }
const [scout, tests] = await parallel([
  () => agent('You are the SCOUT. List the files that render the reports page and the functions a CSV export must touch.', { label: 'scout', phase: 'Scout', model: 'haiku' }),
  () => agent('You are the TEST WRITER. Write failing tests for a CSV export of the reports page.', { label: 'tests', phase: 'Scout', model: 'sonnet', effort: 'medium' }),
])
const built = await agent(\`You are the BUILDER. Make these tests pass: \${JSON.stringify(tests)}. Touch only these files: \${JSON.stringify(scout)}\`, { label: 'build', phase: 'Build', model: 'sonnet', effort: 'high' })
const reviews = await parallel(['correctness', 'style', 'security'].map(d => () => agent(\`You are a REVIEWER of this change: \${JSON.stringify(built)}. List the defects.\`, { label: 'review', phase: 'Check', model: 'sonnet', schema: { type: 'object', properties: { defects: { type: 'array' } } } })))
const check = await agent(\`You are the VERIFIER. Run the tests and say pass or fail. Reviews: \${JSON.stringify(reviews)}\`, { label: 'verify', phase: 'Check', model: 'opus', schema: { type: 'object', properties: { pass: { type: 'boolean' } } } })
await agent(\`You are the SUMMARIZER. Write the pull request description from \${JSON.stringify(check)}.\`, { label: 'summarize', phase: 'Check', model: 'haiku' })`
const G = extract(GATE_SRC), NAME = 'add-csv-export'
const ID = Object.fromEntries(G.nodes.map(n => [n.label, n.id])) // scout a0, tests a1, build a2, review a3, verify a4, summarize a5
const LABEL = Object.fromEntries(G.nodes.map(n => [n.id, n.label]))
const COLS = 140
// What a haiku-written description of a card says (the mod asks a model for it; here it is fixed text).
const DESCRIBE = {
  scout: ['Find where the reports page lives', 'Reads the repo and lists the files and functions to change', 'A short list of files with the functions to touch'],
  tests: ['Pin the export down before it exists', 'Writes failing tests for the CSV rows, header and escaping', 'A test file that fails for the right reason'],
  build: ['Make the failing tests pass', 'Edits only the files the scout named, then runs the tests', 'A change that turns the tests green'],
  review: ['Three independent reads of the change', 'One reviewer each for correctness, style and security', 'A list of defects per dimension'],
  verify: ['Decide if the change can ship', 'Runs the tests and weighs the three reviews', 'Pass or fail, as a boolean'],
  summarize: ['Tell the reader what changed', 'Turns the verdict into a pull request description', 'A short description to paste'],
}
const expand = (id, w) => { const [a, b, c] = DESCRIBE[LABEL[id]]; return { id, w, body: [...wrap(`🎯 ${a}`, w - 4).map(t => ({ t, c: '#e6e6e6', b: true })), ...wrap(`⚙ ${b}`, w - 4).map(t => ({ t, c: '#abb2bf' })), ...wrap(`📦 ${c}`, w - 4).map(t => ({ t, c: '#98c379' }))] } }
const geoOf = (cols, open) => layout(G, cols, open && expand(open, Math.min(68, cols - 4)))
const FG = '#abb2bf', BG = '#1e2127'
const S = (t, o = {}) => ({ t, ...o })
const chip = (label, o = {}) => [S(` ${label} `, o.on ? { c: BG, bg: o.bg ?? '#61afef', b: true } : { c: '#e6e6e6', bg: '#3e4451' }), S(' ')]
const tabs = tab => [...chip('Plan', { on: tab === 'plan' }), ...chip('Live', { on: tab === 'live' }), ...chip('History', { on: tab === 'history' })]
const text = (t, o = {}) => (t.length ? [[S(t, { c: FG, ...o })]] : [[]])

// A screen of the pane as rows of styled segments; the SVG draws each cell on the terminal's grid (8.43 px by 17 px).
const CW = 8.43, RH = 17, PX = 20, TOP = 36
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
function termSvg(rows, { cols = COLS, minRows = 0, title = 'Workflow gate' } = {}) {
  const n = Math.max(rows.length, minRows), W = Math.ceil(cols * CW + 2 * PX), H = TOP + n * RH + 16
  let boxes = '', glyphs = ''
  rows.forEach((segs, r) => {
    let col = 0
    const y = TOP + r * RH
    for (const g of segs) {
      if (g.bg) boxes += `<rect x="${(PX + col * CW).toFixed(1)}" y="${y}" width="${(g.t.length * CW).toFixed(1)}" height="${RH}" fill="${g.bg}"/>`
      const xs = [], chars = []
      let c = col
      for (const ch of g.t) { if (ch !== ' ') { chars.push(ch); xs.push((PX + c * CW).toFixed(1)) } c += ch.length }
      if (chars.length) glyphs += `<text x="${xs.join(' ')}" y="${y + 12.5}" fill="${g.c ?? FG}"${g.b ? ' font-weight="700"' : ''}${g.d ? ' opacity=".55"' : ''}>${esc(chars.join(''))}</text>`
      col += g.t.length
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${BG}"/><rect width="${W}" height="28" fill="#282c34"/><circle cx="16" cy="14" r="5" fill="#e06c75"/><circle cx="33" cy="14" r="5" fill="#e5c07b"/><circle cx="50" cy="14" r="5" fill="#98c379"/><text x="${W / 2}" y="18" text-anchor="middle" font-family="-apple-system,Helvetica,sans-serif" font-size="12" fill="#7f848e">${esc(title)}</text>${boxes}<g font-family="Menlo,'SF Mono','DejaVu Sans Mono',monospace" font-size="14">${glyphs}</g></svg>`
}
const viewBoxOf = svg => { const m = svg.match(/width="(\d+)" height="(\d+)"/); return { width: +m[1], height: +m[2] } }
// An SVG on the page, then a PNG of exactly its size. PNGs over the limit are cut to a palette (flat colours, so it costs nothing visible).
async function show(svg) {
  const f = join(tmp, 'term.html')
  writeFileSync(f, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#1e2127}svg{display:block}</style>${svg}`)
  await page.view(viewBoxOf(svg)); await page.goto(pathToFileURL(f).href)
}
async function shootSvg(svg, name) {
  await show(svg)
  await save(name)
  if (statSync(join(out, name)).size > 260 * 1024) { // ffmpeg: 64 colours, no dither
    const small = join(tmp, `slim-${name}`)
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', join(out, name), '-vf', 'split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none', small])
    renameSync(small, join(out, name))
  }
}
const flagLabel = f => LABEL[f.cardId] ?? f.cardId
const warnOf = flags => { const w = {}; for (const f of flags) w[f.cardId] = { n: (w[f.cardId]?.n ?? 0) + 1, text: `${f.kind}: ${f.why}` }; return w }
const nodeOf = id => G.nodes.find(n => n.id === id)

// The Plan tab: tabs, the flowchart with its side card, the selected card's detail, the one-click fixes, the actions.
function planScreen({ selected, side: sideOf, learned, fixes = [], records = {}, review, minRows = 0, header = true }) {
  const flags = planFlags(G, GATE_SRC)
  const geo = geoOf(sideOf ? graphCols(COLS) : COLS, selected)
  const pos = sideOf ? placeSide(COLS, geo) : null
  const side = pos && { ...pos, title: '🧭 Review · plan', badge: review?.status === 'done' ? (review.verdict === 'ok' ? 'Opus ✓' : `Opus: ${review.items.length} concerns`) : `${flags.length} flags`, lines: planLines(flags, flagLabel, pos.w, review, records, G.nodes.map(n => n.label), learned) }
  const node = nodeOf(selected), uses = G.edges.filter(e => e.target === node.id).map(e => LABEL[e.source]), feeds = G.edges.filter(e => e.source === node.id).map(e => LABEL[e.target])
  const model = node.model ?? 'inherited'
  const tiers = ['haiku', 'sonnet', 'opus', 'fable'].flatMap(t => chip(t, { on: t === model, bg: MODEL_COLOR[t] }))
  const mix = Object.entries(G.nodes.reduce((m, n) => ({ ...m, [n.model]: (m[n.model] ?? 0) + 1 }), {})).map(([m, k]) => `${k} ${m}`).join(' · ')
  const rows = [
    tabs('plan'),
    ...(header ? [[S(NAME, { b: true, c: '#e6e6e6' }), S(`  ${G.nodes.length} agents · ${mix}`, { c: '#7f848e' })]] : []),
    ...paint({ geo, selected, warn: warnOf(flags), ...(side && { side }) }),
    [],
    [S(`▸ ${node.label}`, { b: true, c: '#e6e6e6' }), S(`  [${node.phase}]${node.fanOut ? `  ×N over ${node.fanOut.over}` : ''}${node.effort ? `  effort ${node.effort}` : ''}  `, { c: '#7f848e' }), S('model ', { c: '#7f848e' }), ...tiers],
    ...text(`uses: ${uses.join(', ') || '—'}   feeds: ${feeds.join(', ') || '—'}   ${node.schemaKeys?.length ? `schema: ${node.schemaKeys.join(', ')}` : 'no schema: the next agent reads free text'}`, { c: '#7f848e' }),
    [],
    ...(fixes.length ? [fixes.flatMap(f => chip(f)), ] : []),
    [...chip('Approve & run', { on: true }), ...chip('Browser editor'), ...chip('Cancel')],
  ]
  return termSvg(rows, { minRows })
}

// Learnings: the bandit's tiers from retros that ran on those labels (the mod's own suggestTier), a rewritten mission, the labels' track records.
function learned() {
  let stats = {}
  for (const [label, tier, q, cost, k] of [['tests', 'sonnet', 1, 3.7, 4], ['tests', 'haiku', 1, 0.4, 5], ['build', 'sonnet', 0.5, 3.7, 4]])
    for (let i = 0; i < k; i++) stats = banditUpdate(stats, label, tier, q, cost)
  const tiers = []
  for (const [label, current] of [['tests', 'sonnet']]) { for (let seed = 1; seed < 400; seed++) { const t = suggestTier(stats, label, current, rng(seed)); if (t) { tiers.push({ label, tier: t.tier, from: t.from, why: t.why }); break } } }
  const proposals = [{ workflow: NAME, label: 'build', from: '', mission: '', at: 0, lastPrompt: '', oldResult: '', failure: 'the tests still failed: it edited the page but never the CSV writer', why: 'name the writer module and end with a run of the test suite', replay: { status: 'done', better: true, why: 'edits the writer and the suite passes' } }]
  const records = {
    scout: { runs: 6, yes: 6, partial: 0, no: 0, founded: 2, unfounded: 0 },
    build: { runs: 6, yes: 3, partial: 2, no: 1, founded: 5, unfounded: 1 },
    verify: { runs: 6, yes: 6, partial: 0, no: 0, founded: 3, unfounded: 1 },
  }
  return { tiers, proposals, records, stats }
}
const REVIEW = { status: 'done', verdict: 'concerns', items: [
  { card: 'review', issue: 'three reviewers on sonnet check build, which also runs on sonnet: they share its blind spots', fix: 'run the reviewers on opus' },
  { card: 'build', issue: 'it gets the scout\'s answer as raw JSON, with no schema', fix: 'ask the scout for a list of file paths' },
] }

// The Live tab: the flowchart with the run's states, the orchestrator card, one line per agent.
const MMSS = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
function liveScreen({ at, states, flags = [], decisions = [], checks = 0, opus = 0, minRows = 0, foot = '~ = estimated from past runs of this label (model requests so far vs. their median). Stop a run: /workflows.' }) {
  const live = {}, lines = []
  let cost = 0, done = 0
  for (const [label, [state, progress, doing, usd]] of Object.entries(states)) {
    const id = ID[label]
    cost += usd; if (state === 'done') done++
    live[id] = { state, progress, note: `$${usd.toFixed(2)} · ${state === 'done' ? '1/1' : '0/1'} done · ${MMSS(at)}${doing ? ` · ${doing}` : ''}` }
    lines.push([...chip('Open'), S(` ${state === 'running' ? '●' : '✓'} `, { c: state === 'running' ? '#e5c07b' : '#98c379' }), S(`${bar(progress, 12)} `, { c: state === 'running' ? '#e5c07b' : '#98c379' }), S(label.padEnd(10), { c: '#e6e6e6' }), S(doing ?? 'done', { c: '#7f848e' })])
  }
  const geo = geoOf(graphCols(COLS)), pos = placeSide(COLS, geo)
  const side = { ...pos, title: '🧭 Orchestrator · Opus', badge: `${flags.length} checks · ${opus} Opus`, lines: orchestratorLines(flags, decisions, { opusCalls: opus, checks }, pos.w) }
  const rows = [
    tabs('live'),
    [S(`${NAME} · $${cost.toFixed(2)} this run · ${done}/${G.nodes.length} done · launched ${Object.keys(states).length} · ${MMSS(at)}`, { b: true, c: '#e6e6e6' })],
    ...paint({ geo, live, warn: warnOf(flags), side }),
    [],
    ...lines,
    ...text(foot, { c: '#5c6370' }),
  ]
  return termSvg(rows, { minRows })
}

// History: the hook plugin's page, served by its own server in a throwaway HOME over transcripts written from fixtures.
async function history() {
  const hooks = resolve(WEB, '../../workflow-gate/hooks'), home = join(tmp, 'hist-home'), dot = join(home, '.claude')
  const sess = join(dot, 'projects', 'demo-app', 'session-1'), wf = join(sess, 'workflows'), sub = join(sess, 'subagents', 'workflows')
  mkdirSync(wf, { recursive: true })
  const DAY = 864e5, PRICE = { haiku: ['claude-haiku-4-5', 1, 5], sonnet: ['claude-sonnet-5', 2, 10], opus: ['claude-opus-5', 5, 25] }
  const AGENTS = [['scout', 'haiku', 'Scout', 0.5], ['tests', 'sonnet', 'Scout', 0.8], ['build', 'sonnet', 'Build', 1.4], ['review', 'sonnet', 'Check', 0.7], ['review', 'sonnet', 'Check', 0.7], ['review', 'sonnet', 'Check', 0.7], ['verify', 'opus', 'Check', 0.9], ['summarize', 'haiku', 'Check', 0.3]]
  const runs = [['add-csv-export', 0.2, 1.05], ['fix-flaky-tests', 0.9, 0.7], ['add-csv-export', 1.6, 1.3], ['triage-issues', 2.3, 0.5], ['migrate-config', 3.1, 0.9], ['add-csv-export', 4.2, 0.85], ['fix-flaky-tests', 5.4, 1.1], ['triage-issues', 6.6, 0.6]]
  runs.forEach(([name, ago, scale], i) => {
    const runId = `wf_demo${String(i).padStart(4, '0')}-aaa`, dir = join(sub, runId), when = Date.now() - ago * DAY
    mkdirSync(dir, { recursive: true })
    const prog = [{ type: 'workflow_phase', index: 1, title: 'Scout' }]
    AGENTS.slice(0, name === 'triage-issues' ? 4 : 8).forEach(([label, tier, phase, w], j) => {
      const [m, pin, pout] = PRICE[tier], mt = w * scale * (name === 'fix-flaky-tests' ? 1.2 : 1) * 0.2 // million tokens of input, a tenth of that out
      writeFileSync(join(dir, `agent-a${j}.jsonl`), JSON.stringify({ type: 'assistant', timestamp: new Date(when).toISOString(), message: { role: 'assistant', model: m, usage: { input_tokens: Math.round(mt * 1e6 * 0.5), cache_creation_input_tokens: 0, cache_read_input_tokens: Math.round(mt * 1e6 * 0.5), output_tokens: Math.round(mt * 1e5) } } }) + '\n')
      prog.push({ type: 'workflow_agent', index: j + 1, agentId: `a${j}`, label, phaseTitle: phase, model: m, state: 'done' })
    })
    writeFileSync(join(wf, `${runId}.json`), JSON.stringify({ runId, workflowName: name, status: 'completed', timestamp: when, durationMs: (140 + i * 17) * 1000, workflowProgress: prog }))
  })
  const srv = spawn(process.execPath, [join(hooks, 'history-server.mjs')], { env: { ...process.env, HOME: home, USERPROFILE: home, WORKFLOW_GATE_OUTCOME: '', TYPESAFE_API_KEY: '' }, stdio: 'ignore' })
  try {
    let cfg
    for (let i = 0; i < 100 && !cfg; i++) { await wait(50); try { cfg = JSON.parse(readFileSync(join(dot, 'workflow-gate-history-port'), 'utf8')) } catch {} }
    if (!cfg) throw new Error('the history server did not start')
    await page.view({ width: 1280, height: 900 })
    await page.goto('about:blank'); await page.goto(`http://127.0.0.1:${cfg.port}/?n=${cfg.nonce}`)
    await page.waitFor(`/\\$\\d/.test(document.body.innerText)`, 10000)
    await page.wait(4000) // the costing pass runs in the background; the page polls
    // an add-csv-export run opened: where its money went; the search box shows no example of its own
    await page.evaluate(`document.querySelector('#q').placeholder = 'search a conversation'; [...document.querySelectorAll('tr.run')].find(r => /add-csv-export/.test(r.innerText)).click()`)
    await page.wait(1500)
    await save('gate-history.png')
  } finally { srv.kill() }
}

async function gateImages() {
  const L = learned()
  // the hero: the plan review of the six agents, Opus's concerns on the side, the one-click fixes under it
  await shootSvg(planScreen({ selected: ID.review, side: true, review: REVIEW, records: L.records, fixes: [] }), 'gate-review.png')
  // the model and effort of each agent: the pill on every card, effort under it, and the selected card's model choice
  await shootSvg(planScreen({ selected: ID.build, side: false }), 'gate-models.png')
  // what past runs taught: tiers the bandit suggests, a mission Opus rewrote after a miss, the track records
  await shootSvg(planScreen({ selected: ID.verify, side: true, review: { status: 'done', verdict: 'ok', items: [] }, records: L.records, learned: { tiers: L.tiers, proposals: L.proposals }, fixes: [`Apply learned tiers (${L.tiers.length})`, 'Replay build', 'Use new mission: build', 'Drop'] }), 'gate-learn.png')
  // the live run: the agents move across the chart
  const steps = [
    { at: 12, states: { scout: ['running', 0.3, 'Grep reports', 0.01], tests: ['running', 0.15, 'Read src/reports', 0.02] } },
    { at: 31, states: { scout: ['done', 1, null, 0.04], tests: ['running', 0.7, 'Write export.test.ts', 0.19] } },
    { at: 52, states: { scout: ['done', 1, null, 0.04], tests: ['done', 1, null, 0.31], build: ['running', 0.2, 'Read src/reports/page.ts', 0.06] } },
    { at: 96, states: { scout: ['done', 1, null, 0.04], tests: ['done', 1, null, 0.31], build: ['running', 0.8, 'Edit src/reports/export.ts', 0.74] } },
    { at: 131, states: { scout: ['done', 1, null, 0.04], tests: ['done', 1, null, 0.31], build: ['done', 1, null, 0.98], review: ['running', 0.5, '2 of 3 reviewers done', 0.4] } },
    { at: 168, states: { scout: ['done', 1, null, 0.04], tests: ['done', 1, null, 0.31], build: ['done', 1, null, 0.98], review: ['done', 1, null, 0.95], verify: ['running', 0.6, 'Bash npm test', 0.7] } },
    { at: 190, states: { scout: ['done', 1, null, 0.04], tests: ['done', 1, null, 0.31], build: ['done', 1, null, 0.98], review: ['done', 1, null, 0.95], verify: ['done', 1, null, 0.84], summarize: ['running', 0.5, 'Write the description', 0.02] } },
    { at: 201, states: { scout: ['done', 1, null, 0.04], tests: ['done', 1, null, 0.31], build: ['done', 1, null, 0.98], review: ['done', 1, null, 0.95], verify: ['done', 1, null, 0.84], summarize: ['done', 1, null, 0.05] } },
  ]
  const minRows = Math.ceil((Math.max(...steps.map(f => viewBoxOf(liveScreen(f)).height)) - TOP - 16) / RH) // every frame as tall as the tallest
  for (const [i, f] of steps.entries()) {
    await show(liveScreen({ ...f, checks: i * 2, opus: i ? 1 : 0, minRows }))
    await frame('gate-live', i === steps.length - 1 ? 2.4 : 1.1)
  }
  gif('gate-live.gif', 1000, 6)
  // the orchestrator: haiku flags a fault of reasoning in what an agent wrote; Opus decides on it and applies the decision itself
  const FIN = { scout: ['done', 1, null, 0.04], tests: ['running', 0.9, 'Write export.test.ts', 0.31], build: ['running', 0.6, 'Edit src/reports/export.ts', 0.74] }
  const flags = [
    { cardId: ID.build, agentId: 'ag-build', agent: 'build', kind: 'unverified assumption', quote: 'formatDate works for every column', why: 'it never ran formatDate on a date with a comma in it', at: 80, sentAt: 85, decision: { action: 'steer', message: 'Run formatDate on a value with a comma and quote the cell before you reuse it.' } },
    { cardId: ID.tests, agentId: 'ag-tests', agent: 'tests', kind: 'hasty generalization', quote: 'one fixture row covers every edge case', why: 'it concludes from a single row; quotes and empty cells are not tested', at: 90, sentAt: 95, decision: { action: 'ignore', why: 'the next test covers quoting and empty cells' } },
    { cardId: ID.build, agentId: 'ag-build', agent: 'build', kind: 'unverified assumption', quote: 'the report owner wants a semicolon', why: 'no file or message says which separator to use', at: 120, sentAt: 125, decision: { action: 'ask_human', message: 'Comma or semicolon as the CSV separator?' } },
  ]
  const decisions = [
    { at: 85, about: 'ag-build', agentId: 'ag-build', agent: 'build', action: 'steer', message: flags[0].decision.message, why: '', isDelivered: true },
    { at: 125, about: 'ag-build', agentId: 'ag-build', agent: 'build', action: 'ask_human', message: flags[2].decision.message, why: '' },
  ]
  await shootSvg(liveScreen({ at: 131, states: FIN, flags, decisions, checks: 7, opus: 3, foot: 'The orchestrator applies its own decision: a steer reaches the agent at its next tool call. Stop a run: /workflows.' }), 'gate-orchestrator.png')
  await history()
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
  await gateImages() // the /gate terminal screens and the history page
} finally {
  server?.close(); await page.close(); rmSync(tmp, { recursive: true, force: true })
}
console.log(`images in ${out}`)
