// The workflow stage of the lot pane (lot 41): the steps of the lot's run, or of the plan that waits on the gate, as the mockup's .wf.
// render(ctx) → HTML; mount(box) wires the turn tabs. ctx: { lot, board, slug, now, esc, sico }. A field the board lacks says "Not exported yet".
const NX = '<dd class="nx">Not exported yet</dd>'
const KINDS = ['think', 'build', 'test', 'verify', 'fix', 'commit']
const EFF = { low: 1, medium: 2, high: 3, xhigh: 3, max: 3 }
const icon = k => `<svg class="ico"><use href="#i-${k}"/></svg>`
const cap = s => s[0].toUpperCase() + s.slice(1)
const hhmm = at => new Date(at).toTimeString().slice(0, 5)
const SAID = { approved: 'approved from the board', rejected: 'rejected from the board', change: 'change asked from the board' } // gate.ts gateCard
const span = ms => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}` }

export function render({ lot, board, esc: h }) {
  const sess = board.sessions ?? [], s = sess.find(x => x.sessionId === lot.session || x.lot === lot.n)
  const run = (board.workflows ?? []).find(w => w.session === s?.sessionId || w.session === s?.label || w.session === lot.session)
  const gate = s?.gate
  const steps = run?.steps?.length ? run.steps : (gate?.agents ?? []).map((a, i) => ({ id: `${gate.fp ?? gate.name}:${i}`, label: a.label, kind: KINDS.includes(a.label) ? a.label : undefined, model: a.model }))
  const effort = e => EFF[e] ? `<span class="effort" data-e="${EFF[e]}" role="img" aria-label="effort ${h(e)}"><i></i><i></i><i></i></span>` : ''
  const model = x => x.model ? `<span class="model" title="${h(x.model)}">${h(x.model.replace(/^claude-/, '').replace(/-\d.*$/, ''))} ${effort(x.effort)}</span>` : '<span></span>'
  const why = x => `<dl class="why"><dt>Goal</dt>${x.goal ? `<dd>${h(x.goal)}</dd>` : NX}<dt>How</dt>${x.how ? `<dd>${h(x.how)}</dd>` : NX}<dt>Deliverable</dt>${x.out ? `<dd>${h(x.out)}</dd>` : NX}</dl>`
  const step = x => {
    const st = x.state === 'done' ? 'done' : x.state === 'running' ? 'run' : ''
    const label = x.state === 'done' ? (x.startedAt && x.endedAt ? span(x.endedAt - x.startedAt) : 'done') : x.state === 'running' ? 'in progress' : ''
    return `<details class="wstep ${st}${x.kind === 'gate' ? ' gate' : ''}" data-id="${h(x.id)}"><summary><span class="bead">${icon(st === 'done' ? 'check' : KINDS.includes(x.kind) ? x.kind : 'gate')}</span>
      <span class="nm"><b>${h(x.kind ? cap(x.kind) : x.label)}</b><span>${h(x.goal ?? '')}</span></span>${model(x)}<span class="state">${label}</span></summary>${why(x)}</details>`
  }
  // consecutive parallel steps make one group, consecutive loop steps another (their turns are tabs)
  const out = []
  for (let i = 0; i < steps.length;) {
    const g = steps[i].group
    let j = i + 1
    while (g && j < steps.length && steps[j].group === g) j++
    const part = steps.slice(i, j)
    if (g === 'parallel') out.push(`<div class="grp"><div class="grp-h"><span class="gi">${icon('par')}</span><b>in parallel</b><span>${part.length} agents</span></div><div class="wf">${part.map(step).join('')}</div></div>`)
    else if (g === 'loop') {
      const turns = [...new Set(part.map(x => x.turn))].sort((a, b) => a - b), last = turns.length - 1
      const tab = (t, k) => `<button type="button" data-turn="${k}" aria-pressed="${k === last}"><span class="k" style="background:${part.some(x => x.turn === t && x.state === 'running') ? 'var(--watch)' : 'var(--ink-3)'}"></span>turn ${t}</button>`
      out.push(`<div class="grp"><div class="grp-h"><span class="gi">${icon('loop')}</span><b>verification loop</b><span class="tabs" role="group" aria-label="Turns">${turns.map(tab).join('')}</span></div>
        ${turns.map((t, k) => `<div class="wf" data-turn-box="${k}"${k === last ? '' : ' hidden'}>${part.filter(x => x.turn === t).map(step).join('')}</div>`).join('')}</div>`)
    } else out.push(step(steps[i]))
    i = j
  }
  const sum = gate && (gate.state && gate.state !== 'pending'
    ? `<div class="wf-sum mono">Workflow "${h(gate.name)}" · ${SAID[gate.state] ?? h(gate.state)}${gate.at ? `, ${hhmm(gate.at)}` : ''}</div>`
    : `<div class="wf-sum mono"><span>${(gate.agents ?? []).length} steps</span>${(gate.agents ?? []).map(a => `<span>${h(a.label)}${a.model ? ` · ${h(a.model)}` : ''}</span>`).join('')}<span>waits for your approval</span></div>`)
  if (out.length) return `${sum ?? ''}<div class="wf">${out.join('')}</div>`
  if (sum) return sum
  if (board.proposed?.includes(lot.n) || lot.status === 'proposed') {
    const type = lot.brief?.type
    return `<p class="say">Proposed in <span class="mono">PLAN.md</span>${type ? ` as a <b>${h(type)}</b> task` : ''}. When you approve the plan, the overseer gives it to a free session, and an agent proposes the workflow${lot.model ? ` (build in ${h(lot.model)})` : ''}.</p>`
  }
  return '<p class="say nx">Not exported yet</p>'
}

// A turn tab shows its turn and hides the others.
export function mount(box) {
  for (const grp of box.querySelectorAll('.grp')) {
    const tabs = grp.querySelectorAll('[data-turn]')
    tabs.forEach(b => { b.onclick = () => {
      tabs.forEach(o => o.setAttribute('aria-pressed', o === b))
      grp.querySelectorAll('[data-turn-box]').forEach(w => { w.hidden = w.dataset.turnBox !== b.dataset.turn })
    } })
  }
}
