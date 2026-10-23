import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const mock = read('./mockups/board-v3.html')

test('mockup: doctype, charset and viewport come before the comment; the empty and not-exported designs exist', () => {
  assert.match(mock, /^<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<!--/)
  assert.match(mock, /<section class="ck-empty" hidden>[^]*No tasks yet: write PLAN\.md/)
  assert.match(mock, /\.nx\{color:var\(--muted/)
  assert.match(mock, /class="nx"/)
  assert.match(mock, /'#empty'/)
  assert.match(mock, /'#nx'/)
})

test('gtDraw does not throw on 0 commits', () => {
  const src = mock.slice(mock.indexOf('const gtDraw'), mock.indexOf('const ltBtn'))
  const g = { innerHTML: '' }
  const ctx = vm.createContext({ document: { getElementById: () => g } })
  vm.runInContext(`const GTREE = [], ckSel = '', html = s => s, gtColor = () => ''; ${src}; gtDraw()`, ctx)
  assert.match(g.innerHTML, /No commits yet/)
})

test('boardLot has one field per line, and the v3 fields', () => {
  const body = read('../hooks/board.ts').match(/export const boardLot = [^\n]*\{\n([^]*?)\n\}\)?\n/)?.[1] ?? ''
  const lines = body.split('\n').map(l => l.trim())
  assert.ok(lines.length >= 19 && lines.every(l => /^\w+: [^,]+,?$/.test(l)), lines.join('\n'))
  for (const k of ['brief', 'base', 'tip', 'dirty', 'check', 'retry', 'marks', 'gaps', 'changes']) assert.ok(lines.some(l => l.startsWith(`${k}: `)), k)
})

test('server.mjs has one route table', () => {
  assert.equal(read('./server.mjs').match(/const ROUTES = /g)?.length, 1)
})

// ---- CONTRACT.md -------------------------------------------------------------------------------
const contract = read('./CONTRACT.md')
const boardTs = read('../hooks/board.ts')
const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
// Every table of the file: { head: cells, rows: cells[] }.
const tables = (() => {
  const out = []
  let cur
  for (const l of contract.split('\n')) {
    if (!l.startsWith('|')) { cur = undefined; continue }
    if (/^\|[\s:|-]+\|$/.test(l)) continue
    if (!cur) out.push(cur = { head: cells(l).map(c => c.toLowerCase()), rows: [] })
    else cur.rows.push(cells(l))
  }
  return out
})()
const byHead = h => tables.filter(t => t.head[0] === h)
const areaRows = byHead('selector').flatMap(t => t.rows)
const KINDS = ['mapped', 'derived', 'dropped']

// The ids and classes the mockup holds after the Review view opens (that is Review and Overview), `${…}` skipped.
const tokens = (() => {
  const t = mock.slice(mock.indexOf('id="view-review"'))
  const set = new Set()
  for (const [, k, v] of t.matchAll(/\b(id|class)="([^"]*)"/g))
    for (const w of v.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean)) set.add((k === 'id' ? '#' : '.') + w)
  return [...set]
})()
const has = (cell, tok) => new RegExp(`(^|[^\\w#.-])${tok.replace(/[.#]/g, '\\$&')}(?![\\w-])`).test(cell)

test('CONTRACT: the area tables hold one row for every id and class of the Review and Overview views', () => {
  assert.ok(tokens.length > 150, `${tokens.length} tokens`)
  for (const h of ['selector']) assert.ok(byHead(h).length >= 7, 'one table per screen area')
  const missing = tokens.filter(tok => !areaRows.some(r => has(r[0] ?? '', tok)))
  assert.deepEqual(missing, [])
})

test('CONTRACT: each row has a view, a kind of mapped, derived or dropped, a source and a last cell that is not empty', () => {
  for (const r of areaRows) {
    assert.equal(r.length, 5, r.join(' | '))
    assert.ok(KINDS.includes(r[2] ?? ''), `kind of ${r[0]}`)
    assert.match(r[1] ?? '', /^(Overview|Review|Overview \+ Review)$/, `view of ${r[0]}`)
    assert.ok(r[4], `last cell of ${r[0]}`)
    if (r[2] !== 'dropped') assert.ok(r[3] && r[3] !== '-', `source of ${r[0]}`)
  }
})

test('CONTRACT: a mapped row names a field of board.ts, or an endpoint', () => {
  for (const r of areaRows.filter(r => r[2] === 'mapped')) {
    const src = r[3]?.match(/`([^`]+)`/)?.[1] ?? ''
    if (/^(POST|GET) \//.test(src)) continue
    const field = src.split(/[.[\]()]+/).filter(Boolean).pop() ?? ''
    assert.match(boardTs, new RegExp(`\\b${field}\\b`), `${r[0]}: ${src}`)
    if (/\(new,/.test(r[3] ?? '')) assert.match(r[3] ?? '', /lot \d+/, `${r[0]}: a new field names its producer lot`)
  }
})

test('CONTRACT: the producer lot of each new field', () => {
  const producers = { brief: 31, incomplete: 31, departs: 31, base: 33, tip: 33, dirty: 33, check: 34, retry: 34, marks: 34, gaps: 34, judge: 34, gate: 35, error: 36, requests: 36, passing: 36, nextPassAt: 36, paused: 36, passEvery: 36, changes: 37, proposed: 53, plan: 53, reinstall: 54 }
  const t = byHead('field')[0]
  assert.ok(t, 'a table of the new fields')
  for (const [f, lot] of Object.entries(producers)) {
    const row = t.rows.find(r => r[0]?.replace(/`/g, '') === f)
    assert.ok(row, f)
    assert.match(row[2] ?? '', new RegExp(`^${lot}$`), `${f} is produced by lot ${lot}`)
    assert.match(boardTs, new RegExp(`\\b${f}\\b`), `${f} is in board.ts`)
  }
})

const keyCell = k => `\`${k}\``
const KEY_NAME = { Escape: 'Esc', ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→' }
test('CONTRACT: the KEYS table holds every data-key and every handler key of the mockup', () => {
  const t = byHead('key')[0]
  assert.deepEqual(t?.head, ['key', 'view', 'action', 'endpoint'])
  const keyCells = t.rows.map(r => r[0] ?? '').join(' ')
  // the key handlers: each `keydown` line and the 14 lines after it
  const ls = mock.split('\n')
  const hs = ls.flatMap((l, i) => (/keydown/.test(l) ? ls.slice(i, i + 15) : [])).join('\n')
  const handlers = [...hs.matchAll(/\b(?:k|e\.key) === '([^']+)'/g)].map(m => m[1])
  const wct = hs.match(/'([a-z]+)'\.includes\(k\)/)?.[1] ?? ''
  const keys = new Set([...mock.matchAll(/data-key="([^"$]+)"/g)].map(m => m[1]).concat(handlers, wct.split('')))
  assert.ok(keys.size >= 20, [...keys].join(' '))
  for (const k of keys) assert.ok(keyCells.includes(keyCell(KEY_NAME[k] ?? k)), `key ${k}`)
  for (const r of t.rows) { assert.match(r[1] ?? '', /^(Overview|Review)$/); assert.ok(r[2], r[0]); assert.ok(r[3], r[0]) }
  const row = (view, k) => t.rows.find(r => r[1] === view && r[0]?.includes(keyCell(k)))
  assert.match(row('Overview', 'p')?.[3] ?? '', /\/boards/)
  assert.match(row('Overview', 'r')?.[3] ?? '', /POST \/change/)
  assert.match(row('Review', 'Enter')?.[3] ?? '', /POST \/answer/)
  assert.match(row('Review', '⌘Enter')?.[3] ?? '', /POST \/answer/)
  assert.match(row('Review', '1')?.[3] ?? '', /\/answer/)
  assert.match(row('Review', 'a')?.[3] ?? '', /\/gate.*\/plan|\/plan.*\/gate/)
  assert.match(row('Review', 'e')?.[3] ?? '', /POST \/lot/)
  assert.match(row('Review', 'y')?.[3] ?? '', /none/)
})

test('CONTRACT: the two clicks go to POST /run and POST /pass', () => {
  const t = byHead('click')[0]
  assert.match(t?.rows.find(r => r[0]?.includes('#ck-live'))?.[2] ?? '', /POST \/run/)
  assert.match(t?.rows.find(r => r[0]?.includes('#ck-pass'))?.[2] ?? '', /POST \/pass/)
})

test('CONTRACT: the 6 failure states each have a source and a place on the page', () => {
  const t = byHead('state')[0]
  assert.deepEqual(t?.head, ['state', 'source', 'place on the page'])
  const want = [[/^Disconnected/, /EventSource/, /live pill/], [/^Silent/, /isStale\(Board\.at\)/, /silent Xm.*stale need/], [/^Overseer error/, /Board\.error.*lot 36/, /red pill.*\.ck-banner/],
    [/^Judge gave no verdict/, /Need `judge`.*lot 34/, /need card.*quiet line.*lot pane/], [/^Budget reduce and stop/, /budget\.level/, /meter.*budget need/], [/^Plan incomplete/, /Need `incomplete`.*lot 31/, /need card.*lot badge/]]
  assert.equal(t.rows.length, 6)
  for (const [a, b, c] of want) {
    const r = t.rows.find(r => a.test(r[0] ?? ''))
    assert.ok(r, String(a))
    assert.match(r[1] ?? '', b); assert.match(r[2] ?? '', c)
  }
})

test('CONTRACT: ETA and points are derived per lot; duplicate branch and the per-step ETA are dropped', () => {
  const eta = areaRows.find(r => has(r[0] ?? '', '.eta'))
  assert.equal(eta?.[2], 'derived')
  assert.match(eta?.[4] ?? '', /session\.lotStartedAt \+ Board\.pace/)
  assert.match(eta?.[4] ?? '', /running lots only/)
  assert.match(eta?.[4] ?? '', /hidden when `pace` is absent/)
  const pts = areaRows.find(r => /tokens × budget\.spent \/ Σ tokens of the lots in the window/.test(r[4] ?? ''))
  assert.equal(pts?.[2], 'derived')
  const dup = areaRows.find(r => /duplicate branch/i.test(r[0] ?? ''))
  assert.equal(dup?.[2], 'dropped'); assert.match(dup?.[4] ?? '', /no source/)
  const step = areaRows.find(r => /per-step ETA/i.test(r[0] ?? ''))
  assert.equal(step?.[2], 'dropped'); assert.match(step?.[4] ?? '', /Victor, 2026-10-21/)
  const ctl = areaRows.find(r => has(r[0] ?? '', '#view-board') && has(r[0] ?? '', '#st-calm') && has(r[0] ?? '', '#st-needs') && has(r[0] ?? '', '#z-again'))
  assert.equal(ctl?.[2], 'dropped'); assert.match(ctl?.[4] ?? '', /test control/)
  assert.ok(areaRows.some(r => r[2] === 'dropped' && /Sample.*#pj-menu/.test(r[0] ?? '')))
  assert.ok(areaRows.some(r => r[2] === 'dropped' && /Sample.*\.ck-log/.test(r[0] ?? '')))
})

test('CONTRACT: the lot 26 features each have a place in a view', () => {
  const v1 = n => areaRows.find(r => (r[0] ?? '').startsWith(`v1 · ${n}`))
  for (const n of ['Decision cards', 'Answers', 'At risk', 'Decisions', 'Remote Control link']) {
    const r = v1(n)
    assert.ok(r, n); assert.match(r[1] ?? '', /Overview|Review/); assert.equal(r[2], 'mapped')
  }
  assert.match(v1('Decision cards')?.[0] ?? '', /\.k-decision.*\.ck-need/)
  assert.match(v1('Answers')?.[3] ?? '', /POST \/answer/)
  assert.match(v1('At risk')?.[1] ?? '', /^Overview/)
  assert.match(v1('Decisions')?.[0] ?? '', /\.rail-notes.*\.zctx/)
  assert.match(v1('Remote Control link')?.[0] ?? '', /\.zcard/)
  assert.match(v1('Remote Control link')?.[3] ?? '', /session\.link/)
})
