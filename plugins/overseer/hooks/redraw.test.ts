import { expect, mock, test } from 'claude-code/testing'
import { openMore } from './pane.testkit.ts'

const BOARD = {
  at: 990_000, overseer: 'me', goal: 'Rework', nextPassAt: 1_100_000, budget: { spent: 4, budget: 20, level: 'normal', series: [{ at: 900_000, spent: 1 }, { at: 990_000, spent: 4 }] },
  lots: [{ n: 1, title: 'Fondation & kit', status: 'done', depends: [], session: 'aaa' }, { n: 2, title: 'activity-band', status: 'running', depends: [1], session: 'aaa' }, { n: 3, title: 'session-ttl', status: 'todo', depends: [1] }],
  sessions: [{ sessionId: 'aaa', label: 'rework-a', stage: 'work', lot: 2, since: 900_000, lastText: '', tries: 0 }],
  feed: [],
}

// Each desktop redraw hands the Svg a new source, which recreates its frame: a pane that redraws every second flickers.
test('desktop: with the pane open and nothing moving, three seconds pass without a redraw of the tasks graph', async ($, on) => {
  mock.store(on, { board: BOARD })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.id', () => ({ value: 'me' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  const d = await $.ui.mount({ plugin: 'overseer', surface: 'desktop', component: 'Pane', requestId: 'overseer', props: { title: 'x', isFocused: true, bodyColumns: 140, placement: 'inline' } as never, viewport: { columns: 144, rows: 60 } as never })
  await openMore(d)
  const source = async () => String(((await d.find({ type: 'Svg' }))?.props as { source?: string } | undefined)?.source ?? '')
  await clock.advance(1_000) // the first tick may set the motion's first values
  const before = await source()
  await clock.advance(3_000)
  expect(await source()).toBe(before)
  await d.unmount()
})

// Whatever redraws the pane (a click that moves the focus, a resize, another plugin), the same board must give the
// same source: a different source recreates the Svg frame, which is the flicker.
test('desktop: the same board draws the same lots-graph source at another instant (no clock in the source)', async ($, on) => {
  mock.store(on, { board: BOARD })
  const clock = mock.clock(on, { now: 1_000_000 })
  on('session.id', () => ({ value: 'me' }) as never)
  const mount = async () => { const m = await $.ui.mount({ plugin: 'overseer', surface: 'desktop', component: 'Pane', requestId: 'overseer', props: { title: 'x', isFocused: true, bodyColumns: 140, placement: 'inline' } as never, viewport: { columns: 144, rows: 60 } as never }); await openMore(m); return m }
  const source = async (d: Awaited<ReturnType<typeof mount>>) => String(((await d.find({ type: 'Svg' }))?.props as { source?: string } | undefined)?.source ?? '')
  const a = await mount(); const first = await source(a); await a.unmount()
  await clock.advance(7_345)
  const b = await mount(); const second = await source(b); await b.unmount()
  expect(first.length).toBeGreaterThan(0)
  expect(second).toBe(first)
})
