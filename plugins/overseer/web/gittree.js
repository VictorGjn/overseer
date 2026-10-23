// The git tree of the rail (lot 43): the rows of Board.graph (hooks/tree.ts) as in the mockup. Time runs left to right, one lane per branch
// and the trunk on top. A commit is a dot (a release is a ring with its version above), an edge is a stroke in the hue of the lot, and a branch
// carries its label. The hue of a lot is its number times the golden angle (DESIGN.md), the trunk is --ink and a commit of no lot is grey.
// The page calls draw(el, { board, selected, select(n), esc }) each time the tree is open; treeSVG is pure and tested on its own.
const X = 22, Y = 20, TOP = 30, CH = 6.8, GAP = 10 // CH: the width of a character at 11px mono, a little over
const hue = n => Math.round(Number(n) * 137.5 % 360)
const colorOf = c => (c.lane === 0 ? 'var(--ink)' : !c.lot ? 'var(--ink-3)' : `oklch(var(--gt-l) var(--gt-c) ${hue(c.lot)})`)
const html = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pad = n => String(n).padStart(2, '0')
const stamp = at => { if (!at) return ''; const d = new Date(at); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}` }

// The commits of Board.graph (connector rows have no hash), oldest first, with a lane and a place (x) when the board did not set them.
export function commitsOf(graph) {
  const rows = (graph ?? []).filter(r => r.hash).slice().reverse()
  return rows.map((r, i) => ({ ...r, lane: r.lane ?? 0, x: r.x ?? i, parents: r.parents ?? [], refs: r.refs ?? [] }))
}

// The tree as an SVG string; '' when there is no commit. selected: the lot to ring; trunk: the label of lane 0.
export function treeSVG(graph, { selected, trunk = '' } = {}) {
  const cs = commitsOf(graph)
  if (!cs.length) return ''
  const at = Object.fromEntries(cs.map(c => [c.hash, c])), lanes = Math.max(...cs.map(c => c.lane)) + 1
  const px = c => 16 + c.x * X, py = c => TOP + c.lane * Y
  // Labels never overlap: each sits at the end of its commit, or right of the label before it on its row when that one is in the way.
  const place = items => { let end = -Infinity; return items.sort((a, b) => a.x - b.x).map(it => { const x = Math.max(it.x, end + GAP); end = x + it.w; return { ...it, x } }) }
  const tipItems = cs.filter(c => c.lane && c.refs.some(r => !/^tag:/.test(r))).map(c => {
    const r = c.refs.filter(x => !/^tag:/.test(x)).map(x => x.replace(/^lot\//, '')).join(', '), t = r.length > 34 ? `${r.slice(0, 33)}…` : r
    return { c, t, x: px(c) + 9, w: t.length * CH, row: c.lane }
  })
  const tips = [...Map.groupBy(tipItems, i => i.row).values()].flatMap(place).map(i => `<text class="ref" style="fill:${colorOf(i.c)}" x="${i.x}" y="${py(i.c) + 4}">${html(i.t)}</text>`).join('')
  const tagItems = cs.filter(c => c.version).map(c => ({ c, t: c.version, x: px(c) - c.version.length * CH / 2, w: c.version.length * CH }))
  const tags = place(tagItems).map(i => `<text class="tag" x="${i.x}" y="12">${html(i.t)}</text>`).join('')
  const W = Math.max(px(cs[cs.length - 1]) + 220, ...tipItems.map(i => i.x + i.w + 12)), H = TOP + lanes * Y + 6
  const edges = cs.flatMap(c => c.parents.map(h => {
    const p = at[h]
    if (!p) return ''
    const x1 = px(p), y1 = py(p), x2 = px(c), y2 = py(c)
    const d = y1 === y2 ? `M${x1} ${y1}H${x2}` : y2 > y1 ? `M${x1} ${y1}C${x1 + 12} ${y1} ${x1 + 6} ${y2} ${x1 + 18} ${y2}H${x2}` : `M${x1} ${y1}H${x2 - 18}C${x2 - 6} ${y1} ${x2 - 12} ${y2} ${x2} ${y2}`
    return `<path class="e" d="${d}" stroke="${colorOf(c.lane > p.lane ? c : p)}"/>`
  })).join('')
  const dots = cs.map(c => `<circle class="c${c.version ? ' rel' : ''}${c.lot ? ' lot' : ''}${c.lot && String(c.lot) === String(selected) ? ' sel' : ''}" data-n="${c.lot ?? ''}" cx="${px(c)}" cy="${py(c)}" r="${c.version ? 6 : c.lane === 0 ? 4 : 4.5}" fill="${colorOf(c)}"><title>${html(c.hash)} · ${stamp(c.at)}${c.lot ? ` · task ${c.lot}` : ''}
${html(c.subject)}</title></circle>`).join('')
  return `<svg width="${W}" height="${H}" role="img" aria-label="Git tree since the plan started: ${cs.length} commits"><text x="${px(cs[cs.length - 1]) + 20}" y="${TOP + 4}" class="ref">${html(trunk)}</text>${edges}${dots}${tags}${tips}</svg>`
}

export function draw(el, { board, selected, select } = {}) {
  if (!board?.graph) return void (el.innerHTML = '<p class="dl nx">Not exported yet</p>')
  const svg = treeSVG(board.graph, { selected, trunk: board.base ?? '' })
  if (!svg) return void (el.innerHTML = '<p class="dl">No commits yet</p>')
  el.innerHTML = svg
  el.querySelectorAll('.c.lot').forEach(d => { d.onclick = () => select?.(d.dataset.n) }) // a click on a commit selects its lot
  const sel = el.querySelector('.c.sel')
  el.scrollLeft = sel ? Math.max(0, Number(sel.getAttribute('cx')) - el.clientWidth / 2) : el.scrollWidth
}
