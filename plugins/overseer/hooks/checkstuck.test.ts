import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { parseStuck, stuckFor } from './checkstuck.ts'

// Task 61: a check that runs long (check-watch.sh) shows its session as stuck, with the diagnostic as the need.
const DIAG = 'cwd: /r\nfile: overseer/web/page.browser.test.mjs\ncheck.sh: overseer/web/page.browser.test.mjs has run 5m00 with no end.\nCPU of its 2 processes (pid, cpu now, cpu used, command):\n  41 0.0% 0:01.20 node --test page.browser.test.mjs\nno browser child: is the sandbox blocking the launch?\n'

test('the diagnostic file: the folder and the file on two lines, then the text; a file of another shape is nothing', () => {
  const c = parseStuck(DIAG)!
  expect(c.cwd).toBe('/r'); expect(c.file).toBe('overseer/web/page.browser.test.mjs')
  expect(c.text).toContain('has run 5m00 with no end.'); expect(c.text).toContain('no browser child: is the sandbox blocking the launch?')
  expect(parseStuck('nothing')).toBeUndefined()
})

test('a session belongs to the check that runs in its folder or in a folder above it', () => {
  const all = [{ cwd: '/r/wt', file: 'f', text: 't' }]
  expect(stuckFor('/r/wt', all)).toBeDefined(); expect(stuckFor('/r/wt/overseer', all)).toBeDefined()
  expect(stuckFor('/r/wt2', all)).toBeUndefined(); expect(stuckFor('/r', all)).toBeUndefined(); expect(stuckFor(undefined, all)).toBeUndefined()
})

const T0 = Date.parse('2026-10-22T08:00:00Z')
const iso = (min: number) => new Date(T0 + min * 60e3).toISOString()
const say = (id: string, cwd: string, min: number, text: string) => JSON.stringify({ type: 'assistant', sessionId: id, cwd, timestamp: iso(min), message: { content: [{ type: 'text', text }] } })
const PLAN = '# Plan — T\n\n## [ ] 1. First\ndone when: it works\n'
function setup(on: On, tails: Record<string, string[]>, stuck: Record<string, string>) {
  const files: Record<string, string> = { '/r/PLAN.md': PLAN, ...Object.fromEntries(Object.entries(stuck).map(([k, v]) => [`/h/.claude/overseer/check-stuck/${k}.txt`, v])) }
  const finds: string[][] = []
  mock.env(on, { HOME: '/h' })
  const clock = mock.clock(on, { now: T0 + 5 * 60e3 })
  mock.store(on)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/r' }) as never)
  on('session.id', () => ({ value: 'lead' }) as never)
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40 }] } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('fs.read', (_$, e) => ((e as { path: string }).path in files ? { value: files[(e as { path: string }).path] } : { deny: 'none' }) as never)
  on('fs.write', (_$, e) => { files[(e as { path: string }).path] = (e as { text: string }).text; return { value: undefined } as never })
  on('process.run', (_$, e) => {
    const c = ((e as { argv?: string[] }).argv ?? []) as string[]
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (c[0] === 'ls') return out('')
    if (c[0] === 'find' && c.some(x => x.includes('check-stuck'))) { finds.push(c); return out(Object.keys(files).filter(k => k.includes('check-stuck')).join('\n')) }
    if (c[0] === 'find') return out(Object.keys(tails).map(id => `/h/.claude/projects/x/${id}.jsonl`).join('\n'))
    if (c[0] === 'tail') return out((tails[String(c[c.length - 1]).match(/x\/([\w-]+)\.jsonl/)?.[1] ?? ''] ?? []).join('\n'))
    if (c.includes('--show-toplevel')) return out('/r')
    if (c.includes('rev-parse')) return out('base123')
    return out('')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: {} } }) as never)
  on('session.send', () => ({ isDelivered: true }) as never)
  on('prompt.submit', () => ({ drop: 'captured' }) as never)
  return { files, finds, clock, board: () => JSON.parse(files['/h/.claude/overseer/boards/r.json']!) }
}
const go = async ($: any) => {
  await $.session.start({ source: 'startup', cwd: '/r' } as never)
  await $.command.run({ command: 'oversee', args: 'watch w1' } as never)
  await $.command.run({ command: 'oversee', args: 'run 15' } as never)
}

test('a session at work in the folder of a long check is stuck, with the diagnostic as its note and as a need; one elsewhere is not', async ($, on) => {
  const tails = { w1: [say('w1', '/r', 0, 'Ready.')] }
  const s = setup(on, tails, { abc: DIAG })
  await go($)
  tails.w1.push(say('w1', '/r', 6, 'Running ./check.sh now.'))
  await s.clock.advance(4 * 60e3)
  const w1 = s.board().sessions[0]
  expect(w1.stage).toBe('stuck')
  expect(w1.note).toContain('has run 5m00 with no end.')
  expect(w1.note).toContain('no browser child: is the sandbox blocking the launch?')
  const need = s.board().needs.find((n: { text: string }) => /w1/.test(n.text))
  expect(need.text).toContain('Look at')
  expect(need.why).toContain('has run 5m00 with no end.') // the text is the need
  expect(s.finds[0]).toEqual(expect.arrayContaining(['-name', '*.txt', '-mmin', '-25'])) // a check that died long ago is not read
})

test('with no diagnostic file the session stays at work; when the file is gone the session is at work again', async ($, on) => {
  const tails = { w1: [say('w1', '/r', 0, 'Ready.')] }
  const s = setup(on, tails, {})
  await go($)
  tails.w1.push(say('w1', '/r', 6, 'Running ./check.sh now.'))
  await s.clock.advance(4 * 60e3)
  expect(s.board().sessions[0].stage).toBe('work')
  s.files['/h/.claude/overseer/check-stuck/abc.txt'] = DIAG
  await s.clock.advance(3 * 60e3)
  expect(s.board().sessions[0].stage).toBe('stuck')
  delete s.files['/h/.claude/overseer/check-stuck/abc.txt'] // check-watch.sh removes it when the check ends
  await s.clock.advance(3 * 60e3)
  expect(s.board().sessions[0].stage).toBe('work')
})

test('a long check in another folder does not make this session stuck', async ($, on) => {
  const tails = { w1: [say('w1', '/r', 0, 'Ready.')] }
  const s = setup(on, tails, { abc: DIAG.replace('cwd: /r', 'cwd: /other') })
  await go($)
  tails.w1.push(say('w1', '/r', 6, 'Running ./check.sh now.'))
  await s.clock.advance(4 * 60e3)
  expect(s.board().sessions[0].stage).toBe('work')
})
