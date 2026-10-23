// The web board's server starts on its own (lot 51): the overseer session probes 127.0.0.1:4318/version at /oversee run
// and at each pass, and starts server.mjs from its own plugin root when nothing answers or an older version does.
// Probed on Claude Code 2.1.308 (EXPLORE.md): $.process.run returns at once from a launcher that spawns the server
// detached, and the server outlives the session. Pure, so the decision is tested without a machine.

export const PORT = 4318
export type Answer = { version: string; dir: string; pid?: number }

// -1, 0 or 1, as a is older, the same or newer than b (x.y.z; a missing part counts 0).
export function compareVersions(a: string, b: string): number {
  const p = (v: string) => v.split('.').map(n => Number.parseInt(n, 10) || 0)
  const [x, y] = [p(a), p(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1
  return 0
}

// What /version answered, when it is an overseer board's answer.
export function parseAnswer(text: string | undefined): Answer | undefined {
  try {
    const v = JSON.parse(text ?? '')
    return typeof v.version === 'string' && typeof v.dir === 'string' ? { version: v.version, dir: v.dir, pid: Number.isInteger(v.pid) ? v.pid : undefined } : undefined
  } catch { return undefined }
}

// none: nothing to do. start: nothing answers. replace: an older board answers (stop its pid first, then start).
// A newer one, or the same version, is left alone.
export function serverAction(answer: Answer | undefined, own: string): 'none' | 'start' | 'replace' {
  if (!answer) return 'start'
  return compareVersions(answer.version, own) < 0 ? 'replace' : 'none'
}
// Only a pid that an overseer board's /version gave is ever stopped: its folder ends in overseer/web.
export const isBoardPid = (a: Answer | undefined): a is Answer & { pid: number } => !!a?.pid && a.pid > 1 && /\/overseer\/web$/.test(a.dir)

// A node launcher: it starts the server detached, its output in a log file, and exits at once (no shell).
export const LAUNCHER = "const [s, log] = process.argv.slice(1); const fs = require('fs'); const fd = fs.openSync(log, 'a'); require('child_process').spawn(process.execPath, [s], { detached: true, stdio: ['ignore', fd, fd] }).unref()"
export const launchArgv = (root: string, log: string) => ['node', '-e', LAUNCHER, `${root}/web/server.mjs`, log]
// What /oversee prints when the overseer cannot start it.
export const startCommand = (root: string) => `node ${JSON.stringify(`${root}/web/server.mjs`)} &`
