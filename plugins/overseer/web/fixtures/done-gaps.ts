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
      "n": 27,
      "title": "The terminal pane follows the mockup",
      "status": "done",
      "depends": [],
      "model": "sonnet",
      "doneWhen": "the terminal Board pane matches `overseer/mockups/pane-terminal.html`: the header line (OVERSEER chip, goal, \"next pass in\", Pass now p / Log l / More f buttons), the FOCUS box (▶ NEXT with recommends and blocks lines, ● NOW, ✓ DONE, THEN 1. 2.), the PROGRESS bar with ◐ ○ ! counts, one line per session, the open lots with their done-when, \"✓ N done · More (f)…\", and the branches line; calm keeps the same frame with \"nothing needs you\"; the golden screens (pane-*) are regenerated and reviewed; `./check.sh` exits 0",
      "check": {
        "ok": false,
        "at": 1791999280000,
        "tests": {
          "pass": 144,
          "fail": 2
        },
        "tail": "2 failed"
      },
      "base": "f473ce0",
      "tip": "a293aeb",
      "dirty": [
        {
          "path": "overseer/hooks/pane.tsx",
          "add": 40,
          "del": 9
        }
      ],
      "brief": {
        "problem": "Victor, 2026-10-21: the board does not look like the mockups. The mockup is a static page: reproduce its lines and colours with the pane's Text/Box elements.",
        "keep": [
          "branch from `pre/mockups` (feat/overseer-board 0.2.6 + the mockups): `git worktree add ../claude-mods.wt/lot-27 -b lot/27-pane pre/mockups`. Touch the pane only (register.tsx pane, board.ts helpers), not the band: lot 28 does the band at the same time. `band.tsx` and `kit/*` stay frozen."
        ],
        "criteria": [
          "the terminal Board pane matches `overseer/mockups/pane-terminal.html`: the header line (OVERSEER chip, goal, \"next pass in\", Pass now p / Log l / More f buttons), the FOCUS box (▶ NEXT with recommends and blocks lines, ● NOW, ✓ DONE, THEN 1. 2.), the PROGRESS bar with ◐ ○ ! counts, one line per session, the open lots with their done-when, \"✓ N done · More (f)…\", and the branches line",
          "calm keeps the same frame with \"nothing needs you\"",
          "the golden screens (pane-*) are regenerated and reviewed",
          "`./check.sh` exits 0"
        ]
      },
      "verdict": {
        "verdict": "done",
        "note": "2 gaps left for the owner"
      },
      "verdictAt": 1791999400000,
      "marks": [
        {
          "i": 0,
          "mark": "met"
        },
        {
          "i": 1,
          "mark": "gap",
          "ev": "verify: the More button does not open the view"
        },
        {
          "i": 2,
          "mark": "gap"
        },
        {
          "i": 3,
          "mark": "met"
        }
      ],
      "gaps": [
        "The More button does not open the view.",
        "The agent did not check the pane-64 reference screen again."
      ]
    }
  ],
  "sessions": [
    {
      "sessionId": "00000000-0000-4000-8000-000000000027",
      "label": "worker-dd",
      "stage": "free",
      "lot": 27,
      "lotStartedAt": 1791995620000,
      "since": 1791999700000,
      "lastText": "Working on it.",
      "tries": 0,
      "model": "sonnet"
    }
  ],
  "feed": [
    {
      "at": 1791999880000,
      "action": "assign",
      "label": "worker-dd",
      "text": "lot 27"
    }
  ]
} satisfies Board
