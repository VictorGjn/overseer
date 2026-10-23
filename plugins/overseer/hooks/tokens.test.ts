import { test, expect } from 'claude-code/testing'
import { advance, totalOf, wfTokens } from './tokens.ts'
import recorded from './fixtures/tokens-recorded.ts'

const T = (s: number) => new Date(Date.UTC(2026, 9, 20, 10, 0, s)).toISOString()
const ms = (s: number) => Date.parse(T(s))
const rec = (id: string, s: number, u = [10, 100, 1000, 5]) => JSON.stringify({ type: 'assistant', timestamp: T(s), message: { id, usage: { input_tokens: u[0], cache_creation_input_tokens: u[1], cache_read_input_tokens: u[2], output_tokens: u[3] } } })
const user = JSON.stringify({ type: 'user', timestamp: T(5), message: { content: 'hi' } })
// m1 is split over three records (one per content block); m0 is before the window, m3 after it
const sample = [rec('m0', 1), user, rec('m1', 10), rec('m1', 10), rec('m1', 11), rec('m2', 20, [1, 2, 3, 4]), rec('m3', 90)].join('\n') + '\n'

test('counts the usage of one API call once, however many records repeat it, inside the window only', () => {
  const r = advance(undefined, sample, 0, { from: ms(5), to: ms(60) })
  expect(r.n).toBe(1115 + 10) // m1 once + m2
  expect(r.last).toBe('m2')
  expect(advance(undefined, sample, 0, { from: 0 }).n).toBe(1115 * 2 + 10 + 1115) // m0, m1, m2, m3 with no end
})

test('reads incrementally: a partial line waits for the next read, the last id dedupes across reads', () => {
  const w = { from: 0 }
  const a = advance(undefined, `${rec('a', 1)}\n${rec('b', 2).slice(0, 30)}`, 0, w)
  expect(a.n).toBe(1115)
  expect(a.off).toBe(rec('a', 1).length + 1) // stops before the partial line
  const tail = `${rec('b', 2)}\n${rec('b', 3)}\n${rec('c', 4)}\n`
  const b = advance(a, tail, a.off, w)
  expect(b.n).toBe(1115 * 3)
  const c = advance({ ...b, last: 'c' }, `${rec('c', 5)}\n`, b.off, w) // the same call again in a later read
  expect(c.n).toBe(b.n)
  expect(advance(undefined, 'not json\n{"usage"\n', 0, w).n).toBe(0)
})

test('a read that starts mid-file drops the cut line; offsets count bytes', () => {
  const cut = `ing":1}}\n${rec('x', 1, [1, 0, 0, 1])}\n`
  const r = advance(undefined, cut, 1000, { from: 0 })
  expect(r.n).toBe(2)
  expect(r.off).toBe(1000 + cut.length)
  expect(advance(undefined, `${rec('é', 1, [1, 0, 0, 1])}\n`, 0, { from: 0 }).off).toBe(rec('é', 1, [1, 0, 0, 1]).length + 2) // é is 2 bytes
})

test('a workflow counts by its totalTokens when it started in the window', () => {
  const wf = JSON.stringify({ runId: 'wf_1', status: 'completed', startTime: ms(30), totalTokens: 5000 })
  expect(wfTokens(wf, { from: ms(5), to: ms(60) })).toBe(5000)
  expect(wfTokens(wf, { from: ms(5), to: ms(20) })).toBe(0)
  expect(wfTokens('{', { from: 0 })).toBe(0)
  expect(totalOf({ session: 's', from: 0, files: { f: { off: 1, n: 7 } }, wf: { wf_1: 5000 } })).toBe(5007)
  expect(totalOf(undefined)).toBeUndefined()
})

// The recorded sample (fixtures/tokens-recorded.ts, records shaped after real ones). Expected total computed once,
// outside tokens.ts, from the trimmed fixture alone (dedupe by message.id, keep the last record per id):
//   sed '1,/^export default$/d' overseer/hooks/fixtures/tokens-recorded.ts | jq -r '((.session, .subagent) | group_by(.message.id) | map(last) | .[] | "\(.message.id) \(.message.usage | .input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens + .output_tokens)"), "wf.totalTokens \(.wf.totalTokens)"' | awk '{print; t += $2} END {print "total", t}'
//   file      id / source                    records  input + cache_creation + cache_read + output = tokens
//   session   msg_000000000000000000000001   2        2 + 57228 + 32064 + 214   =  89508
//   session   msg_000000000000000000000002   1        2 + 1339 + 89292 + 221    =  90854
//   session   msg_000000000000000000000003   2        2 + 1394 + 90631 + 283    =  92310   session  272672
//   subagent  msg_000000000000000000000004   3        10 + 60407 + 0 + 3        =  60420
//   subagent  msg_000000000000000000000005   2        8 + 7047 + 60407 + 1      =  67463
//   subagent  msg_000000000000000000000006   1        8 + 11036 + 67454 + 1     =  78499   subagent 206382
//   wf        totalTokens                                                          = 480145
//   total                                                                          = 959199
const jsonl = (rs: readonly unknown[]) => rs.map(r => JSON.stringify(r)).join('\n') + '\n'

test('recorded: a real session, subagent and workflow add up to the total counted by hand, each split call once', () => {
  const w = { from: Date.parse(recorded.session[0]!.timestamp) } // the window opens on the first record: inclusive
  const s = advance(undefined, jsonl(recorded.session), 0, w)
  const a = advance(undefined, jsonl(recorded.subagent), 0, w)
  expect(s.n).toBe(272672)
  expect(s.last).toBe('msg_000000000000000000000003')
  expect(a.n).toBe(206382)
  expect(advance(undefined, jsonl(recorded.session.slice(0, 2)), 0, w).n).toBe(89508) // one call over 2 records counts once
  expect(advance(undefined, jsonl(recorded.subagent.slice(0, 3)), 0, w).n).toBe(60420) // one call over 3 records counts once
  const wf = wfTokens(JSON.stringify(recorded.wf), w)
  expect(wf).toBe(480145)
  expect(totalOf({ session: 's', from: w.from, files: { session: s, subagent: a }, wf: { wf } })).toBe(959199)
})
