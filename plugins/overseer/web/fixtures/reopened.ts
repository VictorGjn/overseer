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
      "status": "running",
      "depends": [],
      "model": "sonnet",
      "doneWhen": "the terminal Board pane matches `overseer/mockups/pane-terminal.html`: the header line (OVERSEER chip, goal, \"next pass in\", Pass now p / Log l / More f buttons), the FOCUS box (▶ NEXT with recommends and blocks lines, ● NOW, ✓ DONE, THEN 1. 2.), the PROGRESS bar with ◐ ○ ! counts, one line per session, the open lots with their done-when, \"✓ N done · More (f)…\", and the branches line; calm keeps the same frame with \"nothing needs you\"; the golden screens (pane-*) are regenerated and reviewed; `./check.sh` exits 0",
      "check": {
        "ok": true,
        "at": 1791999820000,
        "tests": {
          "pass": 146,
          "fail": 0
        },
        "tail": "check.sh green"
      },
      "session": "00000000-0000-4000-8000-000000000027",
      "base": "f473ce0",
      "tip": "a293aeb",
      "dirty": [
        {
          "path": "overseer/hooks/pane.tsx",
          "add": 40,
          "del": 9
        }
      ],
      "retry": {
        "verdict": "retry",
        "note": "Open the More button as a view."
      },
      "verdict": {
        "verdict": "done",
        "note": "first pass"
      },
      "verdictAt": 1791994600000,
      "changes": [
        {
          "id": "ch-2",
          "text": "Open the More button as a view.",
          "at": 1791999520000,
          "state": "sent"
        },
        {
          "id": "ch-3",
          "text": "Rename the tab.",
          "at": 1791995200000,
          "state": "done"
        }
      ]
    }
  ],
  "sessions": [
    {
      "sessionId": "00000000-0000-4000-8000-000000000027",
      "label": "worker-dd",
      "stage": "assigned",
      "lot": 27,
      "lotStartedAt": 1791995620000,
      "since": 1791999700000,
      "lastText": "Working on it.",
      "tries": 1,
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
