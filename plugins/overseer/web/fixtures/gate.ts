import type { Board } from '../../hooks/board.ts'
export default {
  "at": 1792000000000,
  "overseer": "00000000-0000-4000-8000-000000000000",
  "repo": "/home/user/Repos/claude-mods",
  "goal": "Ship the overseer 0.2.7 and the v3 board",
  "nextPassAt": 1792000180000,
  "paused": false,
  "passEvery": 180000,
  "passing": false,
  "lots": [
    {
      "n": 28,
      "title": "The band follows the mockup",
      "status": "running",
      "depends": [],
      "model": "sonnet",
      "doneWhen": "the band above the prompt matches `overseer/mockups/band.html` \"Proposed\": calm = chip in the calm colour, \"✓ 4/9 lots · 2 working · next pass HH:MM\"; needs you = coral chip, \"▶ <the one action>\" and \"· +N\" for the others, nothing else; error = \"✗ <what failed> · <what to do>\"; opened = 5 lines at most (recommends/blocks/waited, the next need, the progress bar, the sessions); \"Board b · Pass now\" on the right; golden screens (band-*) regenerated and reviewed; `./check.sh` exits 0",
      "check": "./check.sh",
      "session": "00000000-0000-4000-8000-000000000028",
      "brief": {
        "problem": "",
        "keep": [
          "branch from `pre/mockups`: `git worktree add ../claude-mods.wt/lot-28 -b lot/28-band pre/mockups`. Change what the band says in register.tsx; `band.tsx` and `kit/*` stay frozen (it draws, it does not decide). Do not touch the pane: lot 27 does it at the same time."
        ],
        "criteria": [
          "the band above the prompt matches `overseer/mockups/band.html` \"Proposed\": calm = chip in the calm colour, \"✓ 4/9 lots · 2 working · next pass HH:MM\"",
          "needs you = coral chip, \"▶ <the one action>\" and \"· +N\" for the others, nothing else",
          "error = \"✗ <what failed> · <what to do>\"",
          "opened = 5 lines at most (recommends/blocks/waited, the next need, the progress bar, the sessions)",
          "\"Board b · Pass now\" on the right",
          "golden screens (band-*) regenerated and reviewed",
          "`./check.sh` exits 0"
        ]
      }
    }
  ],
  "sessions": [
    {
      "sessionId": "00000000-0000-4000-8000-000000000028",
      "label": "worker-bf",
      "stage": "waits",
      "lot": 28,
      "lotStartedAt": 1791995620000,
      "since": 1791999700000,
      "lastText": "Working on it.",
      "tries": 0,
      "model": "sonnet",
      "question": "Approve the 6-step workflow?",
      "ask": {
        "id": "gate-28",
        "question": "Approve the 6-step workflow?",
        "options": [
          "approve",
          "change",
          "reject"
        ]
      }
    }
  ],
  "feed": [
    {
      "at": 1791999880000,
      "action": "assign",
      "label": "worker-dd",
      "text": "lot 27"
    }
  ],
  "workflows": [
    {
      "runId": "wf-28",
      "name": "band-follows-mockup",
      "session": "worker-bf",
      "started": 0,
      "done": 0,
      "running": [],
      "phase": "gate",
      "isActive": true,
      "startedAt": 1791999700000
    }
  ]
} satisfies Board
