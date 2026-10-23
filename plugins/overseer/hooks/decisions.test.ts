import { test, expect, mock } from 'claude-code/testing'
import { answerOf, peerOf } from './peers.ts'
import { decisionLine, parseDecisions } from './board.ts'
import { quietClock } from './clock.testkit.ts'

// A session that waited gets the person's answer: DECISIONS.md at the repository top gets one line, once.
const T0 = Date.parse('2026-10-12T21:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const ask = (min: number, q: string) => JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ question: q }] } }] } })
const reply = (min: number, content: string) => JSON.stringify({ type: 'user', sessionId: 'w1', cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'tool_result', tool_use_id: 'q1', content }] } })
const typed = (min: number, text: string) => JSON.stringify({ type: 'user', sessionId: 'w1', cwd: '/r', timestamp: iso(min), message: { content: text } })
const say = (min: number, text: string) => JSON.stringify({ type: 'assistant', sessionId: 'w1', cwd: '/r', timestamp: iso(min), message: { content: [{ type: 'text', text }] } })

test('the answer is read from the terminal, from the board, or typed; no answer, no decision', () => {
  const term = peerOf([ask(0, 'Keep the legacy route?'), reply(2, 'User has answered your questions: "Keep the legacy route?"="Keep it, behind a flag". You can now continue.')])!
  expect(term.answered).toEqual({ question: 'Keep the legacy route?', answer: 'Keep it, behind a flag', at: T0 + 2 * 60e3 })
  const board = peerOf([ask(0, 'Which colour?'), reply(1, 'The user answered from the overseer board: Blue')])!
  expect(board.answered).toMatchObject({ question: 'Which colour?', answer: 'Blue' })
  const text = peerOf([say(0, 'Done with the API.\nShall I start the UI task?'), typed(3, 'yes, start it')])!
  expect(text.answered).toMatchObject({ question: expect.stringContaining('Shall I start the UI task?'), answer: 'yes, start it' })
  expect(peerOf([ask(0, 'Which colour?')])!.answered).toBeUndefined() // still waiting
  expect(peerOf([say(0, 'Working.'), typed(1, 'ok')])!.answered).toBeUndefined() // it asked nothing
  expect(answerOf('x'.repeat(500)).length).toBe(200)
})

test('a decision line: date · task · question · answer; parsed back newest first; a dot-separated answer cannot break the columns', () => {
  const line = decisionLine(T0, 2, 'Keep the legacy route?', 'Keep it · behind a flag')
  expect(line).toBe('- 2026-10-12 21:00 · task 2 · Keep the legacy route? · Keep it ∙ behind a flag')
  const md = `# Decisions\n\n${line}\n${decisionLine(T0 + 60e3, undefined, 'Q2', 'A2')}\n`
  expect(parseDecisions(md)).toEqual([
    { at: '2026-10-12 21:01', lot: 'no task', question: 'Q2', answer: 'A2' },
    { at: '2026-10-12 21:00', lot: 'task 2', question: 'Keep the legacy route?', answer: 'Keep it ∙ behind a flag' },
  ])
})

const PLAN = '# Plan — Ship it\n\n## [ ] 1. First\ndone when: it ships\n'

test('a pass writes DECISIONS.md at the repository top once, shows it in the Log and on the board; the board answer and the terminal answer both count', async ($, on) => {
  const files: Record<string, string> = { '/r/PLAN.md': PLAN, '/h/.claude/sessions/4242.json': JSON.stringify({ pid: 4242, sessionId: 'w1', name: 'alpha' }) }
  const tail = { rows: [ask(0, 'Which colour?'), reply(1, 'The user answered from the overseer board: Blue')] }
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(quietClock(on, 15000), { now: T0 + 5 * 60e3 }) // no pane open, no request posted, no workflow: the 1 s tick, the 2 s poll and the 15 s light export stop at once (lot 64)
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
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'find') return out(c[1]!.endsWith('/sessions') ? '/h/.claude/sessions/4242.json' : '/h/.claude/projects/x/w1.jsonl')
    if (c[0] === 'tail') return out(tail.rows.join('\n'))
    if (c.includes('--show-toplevel')) return out('/r')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('session.send', () => ({ isDelivered: true }) as never)

  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  const r1 = await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  const r2 = await $.command.run({ command: 'oversee', args: 'run 10' } as never)
  void r1; void r2
  const line = '- 2026-10-12 21:01 · no task · Which colour? · Blue'
  expect(files['/r/DECISIONS.md']).toContain(line) // the answer came from the board
  await clock.advance(3 * 60e3 + 10) // another pass: nothing is added twice
  expect(files['/r/DECISIONS.md']!.split(line).length - 1).toBe(1)
  expect(JSON.stringify(await $.command.run({ command: 'oversee', args: 'log' } as never))).toContain('decided')

  tail.rows.push(ask(3, 'Keep the route?'), reply(4, 'User has answered your questions: "Keep the route?"="Yes". You can now continue.')) // then one in the terminal
  await clock.advance(3 * 60e3 + 10)
  expect(files['/r/DECISIONS.md']).toContain('- 2026-10-12 21:04 · task 1 · Keep the route? · Yes')
  const web = JSON.parse(files['/h/.claude/overseer/boards/r.json']!)
  expect(web.decisions.map((d: { answer: string }) => d.answer)).toEqual(['Yes', 'Blue'])
})
