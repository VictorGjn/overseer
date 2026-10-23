// Recorded-shape transcript tails for stuck detection: rows built from call durations (seconds), checked in stuck.test.ts.
type Call = { name: string; input: object; secs?: number; err?: boolean } // secs: how long it ran; none = still pending

export const NOW = Date.parse('2026-10-09T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const row = (at: number, type: string, content: object[]) => JSON.stringify({ type, sessionId: 's-st', cwd: '/r/app', timestamp: iso(at), message: { content } })

// Calls run one after the other and end just before `end`; a pending one starts `age` s before NOW.
function rows(done: Call[], pending?: { call: Call; age: number }): string[] {
  const out: string[] = []
  let t = NOW - (pending?.age ?? 0) * 1000 - done.reduce((s, c) => s + (c.secs ?? 0) + 1, 0) * 1000
  done.forEach((c, i) => {
    out.push(row(t, 'assistant', [{ type: 'tool_use', id: `d${i}`, name: c.name, input: c.input }]))
    t += (c.secs ?? 0) * 1000
    out.push(row(t, 'user', [{ type: 'tool_result', tool_use_id: `d${i}`, content: 'x', ...(c.err ? { is_error: true } : {}) }]))
    t += 1000
  })
  if (pending) out.push(row(NOW - pending.age * 1000, 'assistant', [{ type: 'tool_use', id: 'p', name: pending.call.name, input: pending.call.input }]))
  return out
}

const npm = (secs: number, i = 0): Call => ({ name: 'Bash', input: { command: i ? `npm test -- part${i}` : 'npm test' }, secs })
// Earlier calls differ (a run of the same one is a loop): each gets its own input.
const hist = (mk: (s: number, i: number) => Call, ds: number[]) => ds.map((d, i) => mk(d, i + 1))
const wait = (mk: Call, age: number) => ({ call: mk, age })

export const SAMPLES: { name: string; rows: string[]; stuck: boolean; why?: string }[] = [
  { name: 'a slow call: 14 min against a 60-100 s habit', rows: rows(hist(npm, [60, 70, 80, 90, 100]), wait(npm(0), 840)), stuck: true, why: 'Bash:npm has run 14m, 10x its usual' },
  { name: 'a long but usual call: 12 min against a 9-11 min habit', rows: rows(hist(npm, [540, 570, 600, 630, 660]), wait(npm(0), 720)), stuck: false },
  { name: 'a short history: only 4 earlier calls', rows: rows(hist(npm, [60, 70, 80, 90]), wait(npm(0), 840)), stuck: false },
  { name: 'under 5 min: 4 min against a 10 s habit', rows: rows(hist((s, i) => ({ name: 'Read', input: { file_path: `/r/f${i}.ts` }, secs: s }), [10, 10, 10, 10, 10]), wait({ name: 'Read', input: { file_path: '/r/b.ts' } }, 240)), stuck: false },
  { name: 'a call that waits on purpose: a Workflow for 30 min', rows: rows(hist((s, i) => ({ name: 'Workflow', input: { script: `w${i}` }, secs: s }), [60, 60, 60, 60, 60]), wait({ name: 'Workflow', input: { script: 'x' } }, 1800)), stuck: false },
  { name: 'a loop: the same Read 4 times in a row', rows: rows(Array(4).fill({ name: 'Read', input: { file_path: '/r/a.ts' }, secs: 1 })), stuck: true, why: 'same call 4 times in a row' },
  { name: 'not a loop: 3 such Reads, then another file', rows: rows([...Array(3).fill({ name: 'Read', input: { file_path: '/r/a.ts' }, secs: 1 }), { name: 'Read', input: { file_path: '/r/b.ts' }, secs: 1 }]), stuck: false },
  { name: 'repeated failures: 3 Edits with different inputs, all errors', rows: rows([1, 2, 3].map(n => ({ name: 'Edit', input: { file_path: '/r/a.ts', old_string: `v${n}` }, secs: 1, err: true }))), stuck: true, why: 'Edit failed 3 times in a row' },
]
