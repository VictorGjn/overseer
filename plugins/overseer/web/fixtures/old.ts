import type { Board } from '../../hooks/board.ts'
export default {
  "at": 1792000000000,
  "overseer": "00000000-0000-4000-8000-000000000000",
  "repo": "/home/user/Repos/claude-mods",
  "goal": "Ship the overseer 0.2.7 and the v3 board",
  "nextPassAt": 1792000180000,
  "lots": [
    {
      "n": 1,
      "title": "Data model",
      "status": "done",
      "depends": [],
      "doneWhen": "migrations run",
      "check": "./check.sh",
      "verdict": {
        "verdict": "done",
        "note": "ok"
      },
      "verdictAt": 1791996400000
    },
    {
      "n": 2,
      "title": "API endpoint",
      "status": "running",
      "depends": [
        1
      ],
      "session": "00000000-0000-4000-8000-000000000002"
    }
  ],
  "sessions": [
    {
      "sessionId": "00000000-0000-4000-8000-000000000002",
      "label": "worker-dd",
      "stage": "work",
      "lot": 2,
      "since": 1791999940000,
      "lastText": "Adding the route.",
      "tries": 0
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
  "budget": {
    "spent": 1,
    "budget": 15,
    "level": "normal"
  }
} satisfies Board
