import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// lot 51: at /oversee run and at each pass the overseer probes 127.0.0.1:4318/version; nothing there or an older board,
// and it starts server.mjs from its own plugin root; a failed start makes /oversee print the command.
const T0 = Date.parse('2026-10-22T10:00:00Z')
type World = { answer?: object; launchCode?: number }

function setup(on: On, w: World) {
  const files: Record<string, string> = { '/r/PLAN.md': '# Plan — Ship it\n\n## [ ] 1. First\ndone when: it ships\n' }
  const runs: string[][] = []
  const fetched: string[] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => { const p = (e as { path: string }).path; return (p.endsWith('/.claude-plugin/plugin.json') ? { value: '{"name":"overseer","version":"0.2.7"}' } : p in files ? { value: files[p] } : { deny: 'none' }) as never })
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('http.fetch', (_$, e) => {
    fetched.push((e as { url: string }).url)
    return (w.answer ? { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(w.answer) } } : { deny: 'ECONNREFUSED' }) as never
  })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    runs.push(c)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '' : '/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: new Date(T0).toISOString(), message: { content: [{ type: 'text', text: 'Working.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } }))
    if (c[0] === 'node' && c[1] === '-e') { if (!w.launchCode) w.answer = { version: '0.2.7', dir: '/p/overseer/web', pid: 77 }; return out('', w.launchCode ?? 0) }
    if (c[0] === 'kill') { w.answer = undefined; return out('') }
    if (c.includes('--show-toplevel')) return out('/r')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('session.send', () => ({ isDelivered: true }) as never)
  const launches = () => runs.filter(c => c[0] === 'node' && c[1] === '-e')
  return { files, runs, fetched, clock, launches }
}
const start = async ($: Engine) => {
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  return (await $.command.run({ command: 'oversee', args: 'run 10' } as never)) as unknown as { text: string }
}

test('nothing answers /version: /oversee run starts server.mjs from the plugin root, detached, once', async ($, on) => {
  const s = setup(on, {})
  await start($)
  expect(s.fetched.every(u => u === 'http://127.0.0.1:4318/version')).toBe(true)
  expect(s.fetched.length).toBeGreaterThan(0)
  expect(s.launches()).toEqual([['node', '-e', expect.stringContaining('detached: true'), expect.stringMatching(/\/overseer\/web\/server\.mjs$/), '/h/.claude/overseer/server.log']])
  const server = s.launches()[0]![3]! // the mod's own plugin root
  const log = (await $.command.run({ command: 'oversee', args: 'log' } as never)) as unknown as { text: string }
  expect(log.text).toContain(`server → web board: started ${server} 0.2.7`)
})

test('the same version answers: nothing is started; an older board is stopped by the pid it gave, then replaced', async ($, on) => {
  const w: World = { answer: { version: '0.2.6', dir: '/old/claude-mods.wt/lot-26/overseer/web', pid: 4242 } }
  const s = setup(on, w)
  await start($)
  expect(s.runs.filter(c => c[0] === 'kill')).toEqual([['kill', '4242']])
  expect(s.launches().length).toBe(1)
  const n = s.fetched.length
  await s.clock.advance(3 * 60e3 + 10) // the next pass probes again: the new one answers 0.2.7
  expect(s.fetched.length).toBeGreaterThan(n)
  expect(s.launches().length).toBe(1)
})

test('a start that fails: /oversee and /oversee run print the exact command to run', async ($, on) => {
  const s = setup(on, { launchCode: 1 })
  const ran = await start($)
  const cmd = `node "${s.launches()[0]![3]}" &`
  expect(ran.text).toContain(cmd)
  const listed = (await $.command.run({ command: 'oversee', args: '' } as never)) as unknown as { text: string }
  expect(listed.text).toContain(`could not be started: run \`${cmd}\``)
  await s.clock.advance(3 * 60e3 + 10) // within 5 min: no second try
  expect(s.launches().length).toBe(1)
  await s.clock.advance(3 * 60e3) // past 5 min: one more
  expect(s.launches().length).toBe(2)
})
