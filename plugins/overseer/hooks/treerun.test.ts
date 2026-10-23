import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Board } from './board.ts'

// lot 38 in a run: the tree begins at the commit checked out when /oversee run started, and the web export keeps every
// row (the 40-row cut is gone; 300 commits at most, with the cut counted).
const T0 = Date.parse('2026-10-22T10:00:00Z')
const PLAN = '# Plan — Ship it\n\n## [ ] 1. First\ndone when: it ships\n'
const ROWS = Array.from({ length: 50 }, (_, i) => `* \x1fc${String(49 - i).padStart(5, '0')}\x1f${i < 49 ? `c${String(48 - i).padStart(5, '0')}` : ''}\x1f\x1fcommit ${49 - i}\x1f${1791900000 - i}`).join('\n')

function setup(on: On) {
  const files: Record<string, string> = { '/r/PLAN.md': PLAN }
  const runs: string[][] = []
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: T0 })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    runs.push(c)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    const a = c.slice(3).join(' ')
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '' : '/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: new Date(T0).toISOString(), message: { content: [{ type: 'text', text: 'Working.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } }))
    if (c[0] !== 'git') return out('')
    if (c.includes('--show-toplevel')) return out('/r')
    if (a === 'rev-parse --abbrev-ref HEAD') return out('feat/board')
    if (a === 'rev-parse HEAD') return out('start0')
    if (a.startsWith('rev-list --count')) return out('320')
    if (a.startsWith('log --graph')) return out(ROWS)
    return out('', 1)
  })
  on('session.send', () => ({ isDelivered: true }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  return { files, runs, board: () => JSON.parse(files['/h/.claude/overseer/boards/r.json']!) as Board }
}

test('lot 38 in a run: the tree starts at the run\'s first commit, on the integration branch; the export keeps every row and the cut', async ($, on) => {
  const s = setup(on)
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  const log = s.runs.filter(c => c[3] === 'log' && c.includes('--graph')).at(-1)!
  expect(log).toContain('^start0') // since the run started
  expect(log).toContain('-n300')
  expect(s.runs.some(c => c.slice(3).join(' ') === 'rev-parse --short feat/board')).toBe(true) // lane 0 is the integration branch
  const b = s.board()
  expect(b.graph!.filter(r => r.hash).length).toBe(50) // not cut at 40
  expect(b.graphCut).toBe(270)
  expect(b.graph![0]).toMatchObject({ hash: 'c00049', parents: ['c00048'], x: 49, lane: 0 })
})
