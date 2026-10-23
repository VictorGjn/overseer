// The changes stage of the lot pane (lot 42): what the branch changed, file by file, with each file's diff on demand
// (GET /diff, lot 39), the commits, the copy chips, the merge line and, for an integration lot, the lots it merges.
// The page calls render(ctx) and shows the HTML it returns, then attach(box, ctx) for the clicks.
// ctx: { lot, board, now, esc, sico, slug, rerender, draft(where), copy(text, el) }.

// The diffs already asked for, by board, lot, view and path: a board that comes in redraws the stage, not the fetch.
const open = new Set()
const diffs = new Map() // key → { rows, cut } | 'loading' | 'error'
const keyOf = (slug, n, view, path) => `${slug}\u0000${n}\u0000${view}\u0000${path}`

// The files of the lot: the uncommitted ones first ("not committed", their diff against HEAD in the worktree), then the
// committed ones (their diff between the lot's base and tip).
export function filesOf(l) {
  const dirty = (l.dirty ?? []).map(d => ({ path: d.path, add: d.add, del: d.del, view: 'worktree' }))
  const committed = (l.files ?? []).map(([add, del, path]) => ({ path, add, del, view: 'branch' }))
  return [...dirty, ...committed]
}
export const diffURL = (slug, n, f) => `/diff/${encodeURIComponent(slug)}?lot=${n}&file=${encodeURIComponent(f.path)}&view=${f.view}`
export const copies = l => (l.base && l.tip ? [['open the full diff', `git diff ${l.base}..${l.tip}`], ['compare with its base', `git diff --stat ${l.base}..${l.tip}`]] : [])

const SG = { '+': '+', '-': '−', ' ': ' ' }
const KIND = { '+': 'add', '-': 'del', '@': 'hunk', ' ': '' }
export function diffHTML(d, f, esc) {
  if (d === 'loading' || !d) return '<span class="diff-note">Loading the diff…</span>'
  if (d === 'error') return '<span class="diff-note">The diff could not be read.</span>'
  const rows = d.rows.map(([k, ln, text]) => k === '@'
    ? `<div class="dl hunk"><span class="ln"></span><span class="sg"></span><span>${esc(text)}</span></div>`
    : `<div class="dl ${KIND[k] ?? ''}" data-cr="${esc(`${f.path}:${ln}`)}" title="Request a change on line ${ln}"><span class="ln">${ln}</span><span class="sg">${SG[k] ?? ' '}</span><span>${esc(text)}</span></div>`).join('')
  return `${rows || '<span class="diff-note">No change in this file.</span>'}${d.cut ? `<span class="diff-note">${d.cut} more line${d.cut === 1 ? '' : 's'} not shown · open the full diff</span>` : ''}`
}

export function render(ctx) {
  const { lot: l, board: b, esc, sico, slug } = ctx
  const br = l.brief ?? {}
  if (br.type === 'integration' && (br.lots ?? []).length) {
    const lot = n => (b.lots ?? []).find(x => x.n === n)
    return `<div class="dv"><p class="say">The task merges tasks ${br.lots.join(', ')} into <span class="mono">${esc(b.base ?? 'the base')}</span>.${l.merged ? ` Merged in <span class="mono">${esc(l.merged.slice(0, 7))}</span>${l.release ? ` → ${esc(l.release)}` : ''}.` : ''}</p>
      <div class="dv-sec"><span class="eyebrow">Its tasks</span><div class="dv-lots">${br.lots.map(n => `<button type="button" class="ck-go" data-goto="${n}">${sico(lot(n)?.status === 'done' ? 'done' : 'todo')}${n} · ${esc(lot(n)?.title ?? '')}</button>`).join('')}</div></div></div>`
  }
  const files = filesOf(l)
  if (!l.tip && !files.length) return `<p class="say">${l.status === 'todo' || l.status === 'running' ? 'No branch yet.' : 'No branch: this task changed no code.'}</p>`
  const st = l.stat, n = (l.commits ?? []).length
  const head = `<p class="say">${l.branch ? `<b>${n} commit${n === 1 ? '' : 's'}</b> on <span class="mono">${esc(l.branch)}</span>` : 'Uncommitted changes'}${st ? ` · ${st.files} files, <span class="a">+${st.add}</span> <span class="r">−${st.del}</span>` : ''}${l.merged ? `. Merged in <span class="mono">${esc(l.merged.slice(0, 7))}</span>${l.release ? ` → ${esc(l.release)}` : ''}.` : ''}</p>`
  const fileRows = files.map(f => {
    const k = keyOf(slug, l.n, f.view, f.path), on = open.has(k)
    return `<span class="a">+${f.add}</span><span class="r">−${f.del}</span><button type="button" class="mono dv-f" data-file="${esc(f.path)}" data-diff-view="${f.view}" aria-expanded="${on}">${on ? '▾' : '▸'} ${esc(f.path)}${f.view === 'worktree' ? ' <span class="tag">not committed</span>' : ''}</button>${on ? `<div class="dv-diff"><div class="diff"><div class="dh" data-cr="${esc(f.path)}" title="Request a change on this file"><span class="mono">${esc(f.path)}</span><span>${f.view === 'worktree' ? '<span class="tag">not committed</span> ' : ''}<span class="fs"><span class="a">+${f.add}</span> <span class="r">−${f.del}</span></span></span></div>${diffHTML(diffs.get(k), f, esc)}</div></div>` : ''}`
  }).join('')
  const commits = (l.commits ?? []).map(c => `<span class="mono">${esc(c.hash.slice(0, 7))}</span><span>${esc(c.subject)}</span>`).join('')
  const links = [l.tip ? `<span class="lk"><svg class="ico"><use href="#i-commit"/></svg>last commit <span class="mono">${esc(l.tip.slice(0, 7))}</span></span>` : '',
    ...copies(l).map(([label, cmd]) => `<button type="button" class="lk chip" data-copy="${esc(cmd)}" title="${esc(cmd)}"><svg class="ico"><use href="#i-verify"/></svg><span>${label}</span></button>`)].filter(Boolean).join('')
  return `<div class="dv">${head}
    ${files.length ? `<div class="dv-sec"><span class="eyebrow">Files</span><div class="dv-files">${fileRows}</div></div>` : ''}
    ${commits ? `<div class="dv-sec"><span class="eyebrow">Commits</span><div class="dv-commits">${commits}</div></div>` : ''}
    ${links ? `<div class="links">${links}</div>` : ''}</div>`
}

// The clicks of the stage: a file opens or closes its diff (fetched once), a diff line or a file head opens a change
// request on it, a chip copies its command with the page's own clipboard code (the one Y uses).
export function attach(box, ctx) {
  box.addEventListener('click', e => {
    const t = e.target
    const chip = t.closest('[data-copy]')
    if (chip) return void ctx.copy(chip.dataset.copy, chip)
    const at = t.closest('.dv-diff [data-cr]')
    if (at) return void ctx.draft(at.dataset.cr)
    const btn = t.closest('.dv-f')
    if (!btn) return
    const f = filesOf(ctx.lot).find(x => x.path === btn.dataset.file && x.view === btn.dataset.diffView)
    if (!f) return
    const k = keyOf(ctx.slug, ctx.lot.n, f.view, f.path)
    if (open.has(k)) { open.delete(k); return void ctx.rerender() }
    open.add(k)
    if (!diffs.has(k) || diffs.get(k) === 'error') {
      diffs.set(k, 'loading')
      fetch(diffURL(ctx.slug, ctx.lot.n, f)).then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .then(d => { diffs.set(k, { rows: d.rows ?? [], cut: d.cut ?? 0 }); ctx.rerender() }, () => { diffs.set(k, 'error'); ctx.rerender() })
    }
    ctx.rerender()
  })
}
