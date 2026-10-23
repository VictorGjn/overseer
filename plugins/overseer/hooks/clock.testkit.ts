import type { On } from 'claude-code'

// The `on` to give mock.clock in a test that advances 20 min or more with no pane open and no request posted: the
// pane's 1 s tick and the 2 s request poll would fire ~1800 times for nothing (lot 1, ff019e6), and a refused period
// ends an interval, so both stop at their first period. `maxMs` 1000 stops only the 1 s tick, for a test that posts requests. Every other wait goes to the mock clock unchanged.
export const quietClock = (on: On, maxMs = 2000): On => ((event: string, ...rest: unknown[]) => {
  if (event !== 'clock.every') return (on as (...a: unknown[]) => unknown)(event, ...rest)
  const handler = rest.at(-1) as (...a: unknown[]) => unknown
  return (on as (...a: unknown[]) => unknown)(event, ...rest.slice(0, -1), ($: unknown, e: { ms: number }, next: unknown) => (e.ms <= maxMs ? { deny: 'not used in this test' } : handler($, e, next)))
}) as On
