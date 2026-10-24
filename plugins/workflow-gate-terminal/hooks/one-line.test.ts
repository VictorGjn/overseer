import { test, expect, mock } from 'claude-code/testing'

// The one-band contract (lots 8 and 12): under activity-band's line, a mod draws at most one line, in its busiest state too:
// a remark on the main session, a plan waiting for approval, and Opus asking during a run, all at once.
const SRC = `export const meta = { name: 'demo', description: 'x', phases: [] }
await agent('Write the spec.', { label: 'specifier', model: 'opus' })`
const STATE: Record<string, unknown> = {
  'activity-band.now': { startedAt: 1 },
  'workflow-gate-terminal.mainFlags': [{ cardId: 'main', kind: 'unverified claim', why: 'says the tests pass without running them', severity: 'high' }],
  'workflow-gate-terminal.plan': { name: 'demo', source: SRC, sites: [], models: {}, edits: {}, status: 'pending' },
  'workflow-gate-terminal.run': { toolUseId: 'u', name: 'earlier', sites: 1, startedAt: 1, agents: [{ key: '1', label: 'writer', status: 'running' }], decisions: [{ at: 2, agentId: 'a', agent: 'writer', action: 'ask_human', message: 'Keep going?', why: 'x' }] },
}

test("the gate's busiest moment draws one line under activity-band's, on every surface", async ($, on) => {
  mock.env(on, { HOME: '/nonexistent' })
  mock.clock(on, { now: 10_000 })
  mock.store(on)
  on('state.get', (_$, e, next) => {
    const { plugin, key } = e as { plugin?: string; key?: string }
    const v = STATE[`${plugin}.${key}`]
    return (v !== undefined ? { value: { value: v, version: 1 } } : next(e)) as never
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'engine-band' } as never))
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const b = await $.ui.mount({ plugin: 'workflow-gate-terminal', surface, component: 'AbovePrompt', props: { hasSurvey: false, bodyColumns: 120 } as never, viewport: { columns: 120, rows: 40 } as never })
    const rows = (await b.findAll({})).map(x => x.key).filter(k => k && /-row$/.test(k))
    expect(rows).toEqual(['wg-ask-row']) // Opus asking leads: its answer cannot wait
    expect(await b.find({ text: /↳ 🧭 Opus/ })).toBeDefined() // a sub-line under activity-band's
    expect(await b.find({ key: 'wg-ask-stop' })).toBeDefined() // Stop run / Let it run stay on the line
    expect(await b.find({ key: 'wg-ask-go' })).toBeDefined()
    expect(await b.find({ text: /· ⛔ «demo»/ })).toBeDefined() // the others are tags on it
    expect(await b.find({ text: /· ⚠ unverified claim/ })).toBeDefined()
    expect(await b.find({ key: 'wg-approve' })).toBeUndefined()
    await b.press({ plugin: 'workflow-gate-terminal', key: 'wg-ask-toggle' } as never) // opened: each part with its own buttons
    expect(await b.find({ key: 'wg-approve' })).toBeDefined()
    expect(await b.find({ key: 'wg-check-ok' })).toBeDefined()
    expect(await b.find({ text: /says the tests pass without running them/ })).toBeDefined()
    await b.press({ plugin: 'workflow-gate-terminal', key: 'wg-ask-toggle' } as never)
    await b.unmount()
  }
})
