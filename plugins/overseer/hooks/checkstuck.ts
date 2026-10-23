// A test file that takes long (check-watch.sh, task 61): after 5 min it writes its diagnostic to ~/.claude/overseer/check-stuck/<id>.txt, with the folder
// check.sh runs in on the first line. The overseer shows the watched session that works in that folder as stuck, the diagnostic as its note.
// The file goes when the file stops or ends; a file older than 25 min is a check that died, and is ignored.
export type CheckStuck = { cwd: string; file: string; text: string }
export const CHECK_STUCK_DIR = '.claude/overseer/check-stuck'
export const CHECK_STUCK_MIN = 25

export function parseStuck(raw: string): CheckStuck | undefined {
  const m = raw.match(/^cwd: (.+)\nfile: (.+)\n([^]*)$/)
  return m ? { cwd: m[1]!.trim(), file: m[2]!.trim(), text: m[3]!.trim().slice(0, 600) } : undefined
}
// The check that runs in a session's folder: the folder itself or a folder above it (the session may sit in a subfolder of the repository).
export const stuckFor = (cwd: string | undefined, all: CheckStuck[]) => cwd ? all.find(c => cwd === c.cwd || cwd.startsWith(`${c.cwd.replace(/\/$/, '')}/`)) : undefined
