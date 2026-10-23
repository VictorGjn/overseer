import { test, expect, mock } from 'claude-code/testing'
import { quietClock } from './clock.testkit.ts'
import { forgetModuleMemory } from './register.tsx'

// task 76: among free sessions, a ready task goes to the one that has been free the longest.
const NOW = Date.parse('2026-10-23T10:00:00Z')
const PLAN = `# Plan — Share the work

## [ ] 1. One
done when: one

## [ ] 2. Two
done when: two

## [ ] 3. Three
done when: three
`
// w1 spoke 8 min ago, w2 40 min ago (the longest free), w3 15 min ago; the watch order is w1, w2, w3.
const QUIET: Record<string, number> = { w1: 8, w2: 40, w3: 15 }

test('3 free sessions, 3 ready tasks: one task each, and the first goes to the longest-idle session', async ($, on) => {
  forgetModuleMemory()
  const files: Record<string, string> = { '/r/PLAN.md': PLAN }
  for (const [i, id] of ['w1', 'w2', 'w3'].entries()) files[`/h/.claude/sessions/${4240 + i}.json`] = JSON.stringify({ pid: 4240 + i, sessionId: id, name: `victor-${id}` })
  mock.env(on, { HOME: '/h' })
  mock.clock(quietClock(on), { now: NOW })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? Object.keys(files).filter(f => f.includes('/sessions/')).join('\n') : ['w1', 'w2', 'w3'].map(id => `/h/.claude/projects/x/${id}.jsonl`).join('\n'))
    if (c[0] === 'tail') {
      const id = /\/(w\d)\.jsonl$/.exec(String(c.at(-1)))![1]!
      return out(JSON.stringify({ type: 'assistant', sessionId: id, cwd: `/wt/${id}`, timestamp: new Date(NOW - QUIET[id]! * 60e3).toISOString(), message: { content: [{ type: 'text', text: 'Ready.' }] } }))
    }
    if (c.includes('--show-toplevel')) return out(c[2]!.startsWith('/wt/') ? c[2]! : '/r') // one working tree each
    if (c.includes('rev-parse') && c.includes('HEAD')) return out('base123')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  const sent: { to: string; text: string }[] = []
  on('session.send', (_$, e) => { const x = e as unknown as { to: string | { sessionId: string }; text: string }; sent.push({ to: typeof x.to === 'string' ? x.to : x.to.sessionId, text: x.text }); return { isDelivered: true } as never })

  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1 w2 w3' } as never)
  const res = JSON.stringify(await $.command.run({ command: 'oversee', args: 'run 10' } as never))
  const tasks = sent.filter(s => s.text.includes('Your task:'))
  expect(res).toContain('3 task(s) given')
  expect(tasks.map(s => s.to).sort()).toEqual(['w1', 'w2', 'w3']) // one task each
  expect(tasks[0]!.to).toBe('w2') // the first goes to the longest-idle session
  expect(tasks[0]!.text).toContain('Your task: 1. One')
  expect(tasks.map(s => s.to)).toEqual(['w2', 'w3', 'w1']) // and so on, by idle time
})
