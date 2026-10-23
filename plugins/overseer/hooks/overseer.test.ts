import { test, expect, mock } from 'claude-code/testing'
import { identity, needsHelp, parseActions, parseRoles, peerOf, pick } from './peers.ts'
import { forgetModuleMemory } from './register.tsx'
import { quietClock } from './clock.testkit.ts'
import { openMore } from './pane.testkit.ts'

const row = (o: object) => JSON.stringify({ sessionId: 's-abc123', cwd: '/r/app', timestamp: '2026-10-09T10:00:00Z', ...o })
const asks = [
  row({ type: 'user', message: { role: 'user', content: 'refactor the parser' } }),
  row({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Two ways to do it.' }, { type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { questions: [{ question: 'Keep the old API?' }] } }] } }),
]

test('a transcript tail says where the session stands: its model, its question, its last words', async () => {
  const p = peerOf(asks)!
  expect(p.sessionId).toBe('s-abc123')
  expect(p.model).toBe('claude-opus-5-5')
  expect(p.question).toBe('Keep the old API?')
  const answered = peerOf([...asks, row({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'yes' }] } })])!
  expect(answered.question).toBeUndefined()
  const textQ = peerOf([row({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done with step 1.\nShould I also migrate the tests?' }] } })])!
  expect(textQ.question).toContain('migrate the tests?')
  expect(peerOf(['not json', row({ type: 'assistant', isSidechain: true, message: { content: [] } })])).toBeUndefined()
})

test('help goes to a session waiting or stalled, not one working, and not twice in a row', async () => {
  const p = peerOf(asks)!
  const now = p.lastAt + 60e3
  expect(needsHelp(p, now, undefined)).toBe(true)
  expect(needsHelp(p, now, now - 60e3)).toBe(false) // messaged a minute ago
  const working = peerOf([...asks, row({ type: 'user', message: { content: 'go on' } })])!
  expect(needsHelp(working, now, undefined)).toBe(false)
  const silent = peerOf([row({ type: 'assistant', message: { content: [{ type: 'text', text: 'Running the build.' }] } })])!
  expect(needsHelp(silent, silent.lastAt + 5 * 60e3, undefined)).toBe(false)
  expect(needsHelp(silent, silent.lastAt + 11 * 60e3, undefined)).toBe(true)
})

test('only listed sessions can be picked, by unique prefix; the model only acts on the sessions asked about', async () => {
  const listed = [{ sessionId: 'abc111' }, { sessionId: 'abc222' }, { sessionId: 'def333' }]
  expect(pick('def abc1 abc zzz', listed)).toEqual({ found: ['def333', 'abc111'], unknown: ['abc', 'zzz'] })
  const acts = parseActions('ok [{"sessionId":"abc111","action":"answer","message":"Keep it."},{"sessionId":"evil","action":"nudge","message":"x"},{"sessionId":"def333","action":"none","message":""}]', ['abc111', 'def333'])
  expect(acts).toEqual([{ sessionId: 'abc111', action: 'answer', message: 'Keep it.' }])
})

test('/oversee lists, watch picks, a pass answers the waiting session and logs it', async ($, on) => {
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(quietClock(on))
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r/app' }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('process.run', (_$, e) => {
    const cmd = (e as { cmd?: string[]; argv?: string[] }).cmd ?? (e as { argv?: string[] }).argv ?? (e as unknown as string[])
    const c = Array.isArray(cmd) ? cmd : []
    if (c[0] === 'find') return { value: { exitCode: 0, stdout: '/h/.claude/projects/x/s-abc123.jsonl\n/h/.claude/projects/x/me.jsonl', stderr: '' } } as never
    if (c[0] === 'tail') return { value: { exitCode: 0, stdout: (String(c[c.length - 1]).includes('/me.jsonl') ? asks.map(r => r.replace('s-abc123', 'me')) : asks).join('\n'), stderr: '' } } as never
    return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[{"sessionId":"s-abc123","action":"answer","message":"Keep the old API for one release."}]', usage: {} } }) as never)
  const sent: unknown[] = []
  on('session.send', (_$, e) => { sent.push(e); return { isDelivered: true } as never })
  await $.session.start({ source: 'startup', cwd: '/r/app' } as never)
  const listed = JSON.stringify(await $.command.run({ command: 'oversee', args: '' } as never))
  expect(listed).toContain('s-abc123'.slice(0, 8))
  const res = JSON.stringify(await $.command.run({ command: 'oversee', args: 'watch s-abc' } as never))
  expect(res).toContain('Watching: app')
  await clock.advance(1000)
  expect(JSON.stringify(sent)).toContain('[overseer] Keep the old API for one release.')
  await clock.advance(1000)
  expect(JSON.stringify(await $.command.run({ command: 'oversee', args: 'log' } as never))).toContain('answer → app')
  await $.command.run({ command: 'oversee', args: 'drop s-abc' } as never)
  sent.length = 0
  await clock.advance(20 * 60e3) // dropped: never read or written to again
  expect(sent).toEqual([])
})

test('the overseer drives its own session too: `watch self`, answered by a prompt between turns', async ($, on) => {
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: Date.parse('2026-10-09T10:05:00Z') })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r/app' }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out('/h/.claude/projects/x/me.jsonl')
    if (c[0] === 'tail') return out(asks.map(r => r.replace('s-abc123', 'me')).join('\n'))
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[{"sessionId":"me","action":"answer","message":"Keep the old API."}]', usage: {} } }) as never)
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => { submitted.push((e as { text: string }).text); return { drop: 'captured' } as never })
  on('session.send', () => { throw new Error('never sends a message to itself') })
  await $.session.start({ source: 'startup', cwd: '/r/app' } as never)
  expect(JSON.stringify(await $.command.run({ command: 'oversee', args: '' } as never))).toContain('(this session')
  expect(JSON.stringify(await $.command.run({ command: 'oversee', args: 'watch self' } as never))).toContain('Watching: app (me)')
  await clock.advance(3 * 60e3) // the next pass, between turns
  expect(submitted.join('\n')).toContain('[overseer] Keep the old API.')
})

test('roles and names: the "Sessions dédiées" line of PLAN.md and the session registry', async () => {
  const md = "# Plan\n\n- **Sessions dédiées** (Victor, 9 et 13 octobre 2026) : raid et jeu `worker-a1` ; son `worker-71` (0000aa71) ; assets 3D et canyon `worker-8f` (0000aa8f). L'overseer (`worker-b4`) relaie, ne construit pas.\n"
  const roles = parseRoles(md)
  expect(roles).toEqual([
    { role: 'raid et jeu', name: 'worker-a1', idPrefix: undefined },
    { role: 'son', name: 'worker-71', idPrefix: '0000aa71' },
    { role: 'assets 3D et canyon', name: 'worker-8f', idPrefix: '0000aa8f' },
  ])
  const names = new Map([['0000aa8f-1111', 'worker-8f'], ['c0ffee00-2222', 'worker-a1']])
  expect(identity('0000aa8f-1111', names, roles, 'game-3d').text).toBe('worker-8f · assets 3D et canyon (0000aa8f)')
  expect(identity('c0ffee00-2222', names, roles, 'x').text).toBe('worker-a1 · raid et jeu (c0ffee00)') // role found by name
  expect(identity('0000aa71-3333', new Map(), roles, 'terminal').text).toBe('son (0000aa71)') // role by id, no name known
  expect(identity('deadbeef-4444', new Map(), roles, 'terminal').text).toBe('terminal (deadbeef)')
  // An id match wins over a reused name; a role keeps its own periods.
  expect(identity('0000aa71-5555', new Map([['0000aa71-5555', 'worker-8f']]), roles, 'x').text).toBe('worker-8f · son (0000aa71)')
  expect(parseRoles('- Sessions : v2.1 build `worker-a1` ; son `worker-71`')[0]!.role).toBe('v2.1 build')
})

test('a reload of the mod forgets nothing that matters: no second message to a session it just answered, the board stays full', async ($, on) => {
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: Date.parse('2026-10-09T10:05:00Z') })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r/app' }) as never)
  on('session.id', () => ({ value: 'me' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({}))
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out('/h/.claude/projects/x/s-abc123.jsonl')
    if (c[0] === 'tail') return out(asks.join('\n'))
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[{"sessionId":"s-abc123","action":"answer","message":"Keep the old API."}]', usage: {} } }) as never)
  const sent: unknown[] = []
  on('session.send', (_$, e) => { sent.push(e); return { isDelivered: true } as never })
  await $.session.start({ source: 'startup', cwd: '/r/app' } as never)
  await $.command.run({ command: 'oversee', args: 'watch s-abc' } as never)
  await clock.advance(1000)
  expect(sent.length).toBe(1)
  forgetModuleMemory() // what /reload-plugins does to the module
  await $.session.start({ source: 'startup', cwd: '/r/app' } as never) // a reload replays session.start
  await clock.advance(4 * 60e3) // the pass after the reload, then the next one
  expect(sent.length).toBe(1) // answered 4 min ago: not again
  await $.command.run({ command: 'oversee', args: 'show' } as never)
  const pane = await $.ui.mount({ plugin: 'overseer', surface: 'terminal', component: 'Pane', requestId: 'overseer', props: { title: 'x', isFocused: true, bodyColumns: 140, placement: 'dock' } as never, viewport: { columns: 150, rows: 50 } as never })
  await openMore(pane)
  expect(await pane.find({ text: /waits/ })).toBeDefined() // the session's state, read again after the reload
})
