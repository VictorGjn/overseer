import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { quietClock } from './clock.testkit.ts'
import { openMore } from './pane.testkit.ts'

const PLAN = `# Plan — Ship it

## [x] 1. Spec
done when: written

## [ ] 2. API endpoint
done when: GET /reports/nav returns the fixture
depends: 1
`

// A run with one watched session (w1) that is free for a lot; `deliver` answers each $.session.send.
async function startRun($: Engine, on: On, deliver: () => object, quiet = false) {
  const files: Record<string, string> = { '/r/PLAN.md': PLAN }
  const tail = [JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: '2026-10-09T10:00:00Z', message: { content: [{ type: 'text', text: 'Ready.' }] } })]
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(quiet ? quietClock(on) : on, { now: Date.parse('2026-10-09T10:05:00Z') })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '' : '/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(tail.join('\n'))
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse')) return out('base123')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.send', () => deliver() as never)
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  return { files, clock }
}

test('a task the session cannot be sent is logged with its reason, once, shown on the band and in /oversee log; the task stays todo', async ($, on) => {
  let isDelivered = false
  const { files, clock } = await startRun($, on, () => (isDelivered ? { isDelivered: true } : { isDelivered: false, reason: 'the classifier gave no verdict for SendMessage' }), true)
  await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  expect(files['/r/PLAN.md']).toContain('## [ ] 2. API endpoint')
  await clock.advance(7 * 60e3) // two more passes, the same refusal
  const log = JSON.stringify(await $.command.run({ command: 'oversee', args: 'log' } as never))
  expect(log).toContain('send-refused → r (w1)')
  expect(log).toContain('message not delivered: the classifier gave no verdict for SendMessage')
  expect(log.match(/send-refused/g)?.length).toBe(1)
  // Every pass read the weekly limit: the board's budget curve has a point per pass (40 % all along: ▁▁▁).
  const pane = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'Pane', requestId: 'overseer', props: { title: 'x', isFocused: true, bodyColumns: 120, placement: 'dock' } as never, viewport: { columns: 124, rows: 60 } as never })
  await openMore(pane)
  expect(await pane.find({ text: /BUDGET .* ▁▁▁/ })).toBeDefined()
  await pane.unmount()
  for (const surface of ['terminal', 'desktop'] as const) {
    const b = await $.ui.mount({ plugin: 'overseer', surface, component: 'AbovePrompt', props: { bodyColumns: 160 } as never, viewport: { columns: 160, rows: 40 } as never })
    expect(await b.find({ text: /✗ not delivered to r: the classifier gave no verdict for SendMessage/ })).toBeDefined()
    expect(await b.find({ text: /✗ not delivered to r: .* · open its session$/ })).toBeDefined() // what failed, then what to do
  }
  // Once a message gets through, the refusal is cleared and the lot goes out.
  isDelivered = true
  await clock.advance(3 * 60e3)
  expect(files['/r/PLAN.md']).toContain('## [~] 2. API endpoint')
  const b = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 160 } as never, viewport: { columns: 160, rows: 40 } as never })
  expect(await b.find({ text: /not delivered/ })).toBeUndefined()
})
