export const meta = {
  name: 'add-export-button',
  description: 'Add a CSV export button to the reports page, with tests and a review',
  phases: [{ title: 'Explore' }, { title: 'Build' }, { title: 'Check' }],
}

const GOAL = 'Add an "Export CSV" button to the reports page.'

phase('Explore')
const scout = await agent(`${GOAL} Find the reports page, its data loader and the existing export helpers. List the files to change.`, { label: 'scout the code', phase: 'Explore', model: 'haiku', agentType: 'Explore' })

phase('Build')
const tests = await agent(`${GOAL} Files: ${scout} Write failing tests for the export. Do not touch the source yet.`, { label: 'write tests', phase: 'Build', model: 'sonnet' })
const impl = await agent(`${GOAL} Tests: ${tests} Implement the button and the CSV writer until the tests pass. Keep the change small.`, { label: 'implement', phase: 'Build', model: 'opus', isolation: 'worktree' })

phase('Check')
const review = await agent(`Review this change for bugs and missing tests. Change: ${impl}`, { label: 'review', phase: 'Check', model: 'opus', agentType: 'workflow-gate:review' })
const verify = await agent(`Run the test suite and the linter. Report each failure with the command output. Review notes: ${review}`, { label: 'verify', phase: 'Check', model: 'sonnet', agentType: 'workflow-gate:verify' })
await agent(`Summarize the change in five lines for the pull request. Checks: ${verify}`, { label: 'summarize', phase: 'Check', model: 'haiku', agentType: 'workflow-gate:synthesis' })
