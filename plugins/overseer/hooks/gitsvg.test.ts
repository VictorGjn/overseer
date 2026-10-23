import { expect, test } from 'claude-code/testing'

import { fitText, gitSvg } from './gitsvg.ts'

const base = {
  chipOf: (ref: string) => (ref === 'feature/x'
    ? { text: ref, color: '#61afef', note: 'session A', conflicts: ['activity-band/hooks/register.tsx'] }
    : { text: ref, color: '#c678dd' }),
  ago: () => '5h',
  worktrees: [
    { icon: '▣', branch: 'main', where: './', state: '● 2 uncommitted', stateColor: '#e5c07b', isMain: true },
    { icon: '▢', branch: 'feature/x', where: './.claude/worktrees/x', owner: 'session A', state: '✗ activity-band/hooks/register.tsx', stateColor: '#e06c75' },
  ],
  width: 720, laneColors: ['#aaa', '#bbb'], ink: '#eee', muted: '#888', alert: '#e06c75',
}

test('every commit is a dot on its lane, links are strokes, and no row wraps: a long subject is cut to its room', () => {
  const long = 'fix(claude-mods): a subject far too long to fit on one row of the desktop board, so it must be cut with an ellipsis'
  const { svg, height } = gitSvg({
    ...base,
    rows: [
      { graph: '*', hash: 'c9800e1', refs: ['main'], subject: long, at: 1 },
      { graph: '|\\' },
      { graph: '| *', hash: '7427f3d', refs: ['feature/x'], subject: 'one line above the prompt', at: 1 },
      { graph: '|/' },
      { graph: '*', hash: '44fa43a', subject: 'docs', at: 1 },
    ],
  })
  expect((svg.match(/<circle/g) ?? []).length).toBe(3)
  expect(svg).toContain('<path d="M10 34 L26 44"') // the \ of the link row: from lane 0 (x 10) down to lane 1 (x 26)
  expect(svg).not.toContain(`class="s">${long}<`) // cut on its row…
  expect(svg).toContain(`<title>c9800e1 ${long} (main)</title>`) // …but whole on hover
  expect(svg).toContain('✗ conflict · 1 file')
  expect(svg).toContain('<title>activity-band/hooks/register.tsx</title>')
  expect(svg).toContain('WORKTREES · 2')
  expect(height).toBeGreaterThan(5 * 10)
})

test('fitText keeps what fits and cuts the rest with an ellipsis', () => {
  expect(fitText('short', 200)).toBe('short')
  expect(fitText('a much longer subject', 60)).toBe('a much…')
  expect(fitText('anything', 3)).toBe('')
})

test('a narrow pane keeps the conflict badge inside the drawing, and per-item colours win over the stylesheet', () => {
  const { svg } = gitSvg({
    ...base,
    width: 360,
    chipOf: () => ({ text: 'claude/a-very-long-branch-name-for-a-narrow-pane', color: '#61afef', note: 'Rework claude-mods · session de travail A', noteColor: '#56b6c2', conflicts: ['a.ts', 'b.ts'] }),
    rows: [{ graph: '*', hash: '7427f3d', refs: ['x'], subject: 'one line above the prompt', at: 1 }],
  })
  const badge = svg.match(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="18" rx="4"/)
  expect(badge).toBeTruthy()
  expect(Number(badge![1]) + Number(badge![2])).toBeLessThanOrEqual(360 - 10)
  expect(svg).toContain('✗ conflict · 2 files')
  expect(svg).toContain('style="fill:#e5c07b"') // the worktree state keeps its colour
  expect(svg).not.toMatch(/class="st" fill=/)
})
