import { test, expect } from 'claude-code/testing'
import { boardLot } from './board.ts'
import { parsePlan, setLot } from './plan.ts'

const PLAN = `# Plan — g

## [~] 1. Running
done when: it runs
check: \`true\`

## [~] 2. Finished
done when: tests pass
check: \`false\`
`

test('verdict and verdictAt survive a reload and reach the board tasks', () => {
  const md = setLot(PLAN, 2, { status: 'done', verdict: { verdict: 'done', note: 'tests | green' }, verdictAt: 1700000000000 })
  const [running, done] = parsePlan(md).lots.map(boardLot)
  expect(done).toMatchObject({ n: 2, status: 'done', doneWhen: 'tests pass', check: 'false', verdict: { verdict: 'done', note: 'tests | green' }, verdictAt: 1700000000000 })
  expect(running).toMatchObject({ status: 'running', doneWhen: 'it runs', check: 'true', verdict: undefined, verdictAt: undefined })
  expect(setLot(md, 2, { verdict: { verdict: 'retry', note: 'x' }, verdictAt: 5 }).match(/^verdict(at)?:/gm)).toHaveLength(2)
})
