import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { quietClock } from './clock.testkit.ts'
import { forgetModuleMemory } from './register.tsx'

// task 76: the watch list survives a restart of the overseer session. A restart = a new engine (empty store) and the module's memory forgotten.
const T0 = Date.parse('2026-10-23T10:00:00Z')
const WATCHED = ['aaaa1111', 'bbbb2222', 'cccc3333'].map((id, i) => ({ sessionId: id, label: `worker-${i + 1}`, file: `/h/.claude/projects/x/${id}.jsonl` }))

function setup(on: On, o: { alive: string[] }) {
  const files: Record<string, string> = { '/r/PLAN.md': '# Plan — Ship it\n\n## [ ] 1. First\ndone when: it ships\n', '/h/.claude/overseer/watched.json': JSON.stringify({ watched: WATCHED }) }
  const sessions = o.alive.map(id => `/h/.claude/sessions/${id}.json`)
  for (const [i, id] of o.alive.entries()) files[`/h/.claude/sessions/${id}.json`] = JSON.stringify({ sessionId: id, name: id, pid: 100 + i, procStart: 'x', status: 'idle' })
  mock.env(on, { HOME: '/h' })
  mock.clock(quietClock(on), { now: T0 })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => { const p = (e as { path: string }).path; return (p.endsWith('/.claude-plugin/plugin.json') ? { value: '{"version":"0.4.1"}' } : p in files ? { value: files[p] } : { deny: 'none' }) as never })
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ version: '0.4.1', dir: '/p/overseer/web', pid: 77 }) } }) as never)
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? sessions.join('\n') : '')
    if (c.includes('--show-toplevel')) return out('/r')
    return out('') // kill -0: every listed process is alive
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('session.send', () => ({ isDelivered: true }) as never)
  return { files }
}
const cmd = async ($: Engine, args: string) => ((await $.command.run({ command: 'oversee', args } as never)) as unknown as { text: string }).text

test('a restart: /oversee run finds the 3 watched sessions with no /oversee watch', async ($, on) => {
  forgetModuleMemory()
  setup(on, { alive: WATCHED.map(w => w.sessionId) })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  const text = await cmd($, 'run 10')
  for (const w of WATCHED) expect(text).toContain(w.label)
  expect(text).not.toContain('no session is watched')
})

test('a watched session that ended while the overseer was away is dropped, with a log line', async ($, on) => {
  forgetModuleMemory()
  const s = setup(on, { alive: ['aaaa1111', 'bbbb2222'] })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  const text = await cmd($, 'run 10')
  expect(text).toContain('worker-1')
  expect(text).toContain('worker-2')
  expect(text).not.toContain('worker-3')
  expect(await cmd($, 'log')).toContain('worker-3 ended while the overseer was away')
  expect(JSON.parse(s.files['/h/.claude/overseer/watched.json']!).watched.map((w: { sessionId: string }) => w.sessionId)).toEqual(['aaaa1111', 'bbbb2222'])
})

test('/oversee off forgets the saved list: nothing comes back after a restart', async ($, on) => {
  forgetModuleMemory()
  const s = setup(on, { alive: WATCHED.map(w => w.sessionId) })
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await cmd($, 'off')
  expect(JSON.parse(s.files['/h/.claude/overseer/watched.json']!)).toEqual({ watched: [] })
})
