// What a lot costs, counted from the transcripts: pure, so it is tested on a recorded sample. Only counts are kept.
// Window: a record counts when its timestamp is in [from, to]: from = the lot's first assignment, to = its verdict
// (open while the lot runs). A retry keeps the window open, so its tokens stay on the lot.

export type Win = { from: number; to?: number }
export type FileTokens = { off: number; last?: string; n: number } // bytes read so far, the last message.id counted, the tokens
export type LotTokens = { session: string; from: number; to?: number; files: Record<string, FileTokens>; wf: Record<string, number> } // wf: runId → tokens in the window
export const READ_CAP = 4 * 1024 * 1024 // a file new to a lot is read from its last 4 MiB only. ponytail: older records of a huge transcript are missed; page backwards if it bites.

const inWin = (at: number, w: Win) => at >= w.from && (w.to === undefined || at <= w.to)
export const totalOf = (t?: LotTokens) => t && Object.values(t.files).reduce((s, f) => s + f.n, 0) + Object.values(t.wf).reduce((s, n) => s + n, 0)

// UTF-8 length of a string without Buffer.
const bytes = (s: string) => { let n = 0; for (const c of s) { const p = c.codePointAt(0)!; n += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4 } return n }

// New bytes of a transcript (read from byte `start`) → its state. A trailing partial line is left unread (off stops before it)
// and comes again with the next read. One API call is split over several assistant records that repeat message.id and usage:
// each id counts once (the last id is kept across reads; ids repeat back to back).
export function advance(prev: FileTokens | undefined, raw: string, start: number, w: Win): FileTokens {
  const skip = !prev && start > 0 ? raw.indexOf('\n') + 1 : 0 // a read that starts mid-file begins in the middle of a line
  const text = raw.slice(skip, raw.lastIndexOf('\n') + 1)
  let { last, n } = prev ?? { n: 0 } as FileTokens
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue
    let d: { type?: string; timestamp?: string; message?: { id?: string; usage?: Record<string, number> } }
    try { d = JSON.parse(line) } catch { continue }
    const u = d.message?.usage, id = d.message?.id
    if (d.type !== 'assistant' || !u || !id || id === last || seen.has(id) || !inWin(Date.parse(d.timestamp ?? ''), w)) continue
    seen.add(id)
    last = id
    n += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0)
  }
  return { off: start + bytes(raw.slice(0, skip) + text), last, n }
}

// A finished workflow's wf_<runId>.json (written only when the run ends: one in flight is not counted yet) → its totalTokens
// if it started in the window.
export function wfTokens(json: string, w: Win): number {
  try {
    const d = JSON.parse(json) as { startTime?: number; timestamp?: string; totalTokens?: number }
    return inWin(d.startTime ?? Date.parse(d.timestamp ?? ''), w) ? d.totalTokens ?? 0 : 0
  } catch { return 0 }
}
