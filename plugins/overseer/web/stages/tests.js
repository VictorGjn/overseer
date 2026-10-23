// The tests stage of the lot pane (lot 41): the judge's note, then Unit, Functional and Screenshots from check, tests and marks.
// render(ctx) → HTML; mount(box, ctx) fills the screen tabs from GET /file. ctx: { lot, board, slug, now, esc, sico }.
const NX = '<span class="nx">Not exported yet</span>'
const base = p => p.split('/').pop()
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

export function render({ lot: l, esc: h, sico }) {
  const ck = l.check && typeof l.check === 'object' ? l.check : undefined, t = l.tests
  const chips = a => a?.length ? `<div class="refs">${a.map(f => `<span class="chip">${h(base(f))}</span>`).join('')}</div>` : ''
  const shots = t?.screens ?? []
  let rows
  if (!ck && l.status !== 'done') rows = [['none', 'Unit tests', 'They run after the workflow builds the change.'], ['none', 'Functional tests', 'Not run yet.'], ['none', 'Screenshots', 'Not taken yet.']]
  else {
    const fun = t?.functional ?? []
    rows = [
      ck ? [ck.ok ? 'done' : 'gap', 'Unit tests', ck.tests ? `${ck.tests.pass} tests pass, ${ck.tests.fail} fail.` : `check.sh ${ck.ok ? 'is green' : 'failed'}.`, chips(t?.unit) + (ck.ok ? '' : `<pre class="term">${h(ck.tail)}</pre>`)]
        : ['none', 'Unit tests', 'No check result is recorded.', chips(t?.unit)],
      !t ? ['none', 'Functional tests', NX] : fun.length && ck?.ok ? ['done', 'Functional tests', `${plural(fun.length, 'functional test')} changed.`, chips(fun)]
        : ['none', 'Functional tests', fun.length ? `${plural(fun.length, 'functional test')} changed, but the check did not pass.` : 'No functional test changed.', chips(fun)],
      !t ? ['none', 'Screenshots', NX] : shots.length ? ['done', 'Screenshots', `${plural(shots.length, 'reference screen')} changed.`,
        `<div class="tabs">${shots.map((p, i) => `<button type="button" data-shot="${h(p)}" aria-pressed="${i === 0}">${h(base(p))}</button>`).join('')}</div><pre class="term"></pre>`]
        : ['none', 'Screenshots', 'No reference screen changed.'],
    ]
  }
  // a gap shows once: the lot's gaps and the judge's gap marks, without duplicates and without a gap a row already says
  const norm = g => String(g).trim().replace(/\.$/, '')
  const seen = new Set(), gaps = [...(l.gaps ?? []), ...(l.marks ?? []).filter(m => m.mark === 'gap' && m.ev).map(m => m.ev)].filter(g => {
    const k = norm(g)
    return k && !seen.has(k) && seen.add(k) && !rows.some(r => r[2].includes(k))
  })
  return `<div class="dv">${l.verdict?.note ? `<div class="dv-verdict"><span class="eyebrow">Judge</span><p>${h(l.verdict.note)}</p>${l.retry?.note ? `<p class="retry"><b>First pass: retry.</b> ${h(l.retry.note)}</p>` : ''}</div>` : ''}
    <div class="tst">${rows.map(([st, name, line, extra = '']) => `<section class="tr ${st}">${sico(st)}<div><b>${name}</b><span>${line.startsWith('<') ? line : h(line)}</span>${extra}</div></section>`).join('')}</div>${gaps.length ? `<ul class="gaps">${gaps.map(g => `<li>${sico('gap')}<span>${h(g)}</span></li>`).join('')}</ul>` : ''}</div>`
}

// A screen tab loads that file at the lot's tip (GET /file, lot 39) into the pre.
export function mount(box, { lot, slug }) {
  const pre = box.querySelector('.tabs + pre.term'), tabs = box.querySelectorAll('[data-shot]')
  if (!pre || !tabs.length) return
  const load = async p => {
    pre.textContent = ''
    try {
      const r = await fetch(`/file/${encodeURIComponent(slug)}?lot=${lot.n}&path=${encodeURIComponent(p)}`)
      const { text, cut } = await r.json()
      pre.textContent = text + (cut > 0 ? `\n${cut} more lines` : '')
    } catch { pre.textContent = 'Not exported yet' }
  }
  tabs.forEach(b => { b.onclick = () => { tabs.forEach(o => o.setAttribute('aria-pressed', o === b)); load(b.dataset.shot) } })
  load(tabs[0].dataset.shot)
}
