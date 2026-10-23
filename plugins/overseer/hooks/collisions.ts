// Files two watched sessions changed close together, counted from the transcripts: pure, tested on a made-up sample.
// Only the file path and the time are kept (no content, no diff). An Edit/Write/MultiEdit counts once its tool_result is not an error.
// ponytail: the main transcript only; a session's subagents are not read. Add them as extra files of the same session if it bites.

export const WINDOW = 15 * 60e3
export type EditState = { off: number; open: Record<string, { file: string; at: number }>; at: Record<string, number> } // bytes read, calls awaiting their result, file → last successful edit
export type Collision = { file: string; sessions: string[]; at: number }
const TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])

// New bytes of a transcript (read from byte `start`) → its state, like tokens.ts advance: a trailing partial line waits for the next read.
// A call and its result are on different lines, maybe in different reads, so the call waits in `open` until its result arrives.
export function edits(prev: EditState | undefined, raw: string, start: number): EditState {
  const skip = !prev && start > 0 ? raw.indexOf('\n') + 1 : 0
  const text = raw.slice(skip, raw.lastIndexOf('\n') + 1)
  const open = { ...prev?.open }, at = { ...prev?.at }
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use')) continue // matches "tool_use" and "tool_use_id"
    let d: { timestamp?: string; message?: { content?: unknown } }
    try { d = JSON.parse(line) } catch { continue }
    const t = Date.parse(d.timestamp ?? '')
    if (!Array.isArray(d.message?.content) || Number.isNaN(t)) continue
    for (const c of d.message.content as { type?: string; id?: string; name?: string; input?: { file_path?: unknown }; tool_use_id?: string; is_error?: boolean }[]) {
      if (c.type === 'tool_use' && c.id && TOOLS.has(c.name ?? '') && typeof c.input?.file_path === 'string') open[c.id] = { file: c.input.file_path, at: t }
      if (c.type === 'tool_result' && c.tool_use_id && open[c.tool_use_id]) {
        const { file, at: when } = open[c.tool_use_id]!
        if (!c.is_error && when > (at[file] ?? 0)) at[file] = when
        delete open[c.tool_use_id]
      }
    }
  }
  return { off: (prev?.off ?? start) + new TextEncoder().encode(raw.slice(0, skip) + text).length, open, at }
}

// Forget what is older than two windows (an older edit can no longer sit within the window of a still-fresh one), so the stored state stays small.
export function prune(s: EditState, now: number, win = 2 * WINDOW): EditState {
  const keep = <T,>(o: Record<string, T>, f: (v: T) => number) => Object.fromEntries(Object.entries(o).filter(([, v]) => now - f(v) <= win))
  return { off: s.off, open: keep(s.open, v => v.at), at: keep(s.at, v => v) }
}

// Files edited by 2+ distinct sessions, each within the window of the latest edit; at = that latest edit. Stays until that latest edit is older than the window.
export function collisionsOf(bySession: Record<string, Record<string, number>>, now: number, win = WINDOW): Collision[] {
  const files = new Map<string, [string, number][]>()
  for (const [s, m] of Object.entries(bySession)) for (const [f, at] of Object.entries(m)) files.set(f, [...(files.get(f) ?? []), [s, at]])
  return [...files].flatMap(([file, xs]) => {
    const at = Math.max(...xs.map(x => x[1]))
    const sessions = xs.filter(x => at - x[1] <= win).map(x => x[0]).sort()
    return sessions.length > 1 && now - at <= win ? [{ file, sessions, at }] : []
  }).sort((a, b) => b.at - a.at || a.file.localeCompare(b.file))
}
