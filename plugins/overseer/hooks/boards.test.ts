import { expect, mock, test } from 'claude-code/testing'

const PLAN = '# Plan — Ship /r\n\n## [ ] 1. First\ndone when: it ships\n'
const OTHER = { at: 9e15, overseer: 'other', repo: '/b', goal: 'Other repo goal', nextPassAt: 9e15, lots: [], sessions: [], feed: [] }

test('two overseers: a pass on /r leaves /b alone, writes board:/r and boards/r.json, and the pane shows /r', async ($, on) => {
  const files: Record<string, string> = { '/r/PLAN.md': PLAN, '/h/.claude/sessions/4242.json': JSON.stringify({ pid: 4242, sessionId: 'w1', name: 'worker-8f' }) }
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: Date.parse('2026-10-09T10:05:00Z') })
  const store: Record<string, unknown> = { 'board:/b': OTHER }
  on('store.get', (_$, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.set', (_$, e) => { store[(e as { key: string }).key] = (e as { value: unknown }).value; return { value: undefined } as never })
  on('store.delete', (_$, e) => { delete store[(e as { key: string }).key]; return { value: undefined } as never })
  on('store.keys', () => ({ value: Object.keys(store) }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  const written: string[] = []
  on('fs.write', (_$, e) => { written.push((e as { path: string }).path); files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '/h/.claude/sessions/4242.json' : '/h/.claude/projects/x/w1.jsonl')
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse') && c.includes('HEAD')) return out('base123')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.send', () => ({ isDelivered: true }) as never)

  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  await $.command.run({ command: 'oversee', args: 'focus' } as never) // a second pass-time write
  expect(store['board:/b']).toEqual(OTHER)
  expect((store['board:/r'] as { goal: string }).goal).toBe('Ship /r')
  expect(store['board']).toBeUndefined()
  expect(Object.keys(store).sort()).toEqual(['board:/b', 'board:/r'])
  expect(written).toContain('/h/.claude/overseer/boards/r.json')
  expect(written).not.toContain('/h/.claude/overseer/board.json')

  await $.command.run({ command: 'oversee', args: 'show' } as never)
  const pane = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'Pane', requestId: 'overseer', props: { title: '👁 Overseer', isFocused: true, bodyColumns: 120, placement: 'dock' } as never, viewport: { columns: 130, rows: 50 } as never })
  expect(await pane.find({ text: /Ship \/r/ })).toBeDefined()
  expect(await pane.find({ text: /Other repo goal/ })).toBeUndefined()
  await pane.unmount()

  await $.command.run({ command: 'oversee', args: 'off' } as never)
  written.length = 0
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  expect(written).toEqual([])
})
