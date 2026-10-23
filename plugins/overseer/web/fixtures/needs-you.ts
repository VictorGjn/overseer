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
      "check": "./check.sh",
      "session": "00000000-0000-4000-8000-000000000027"
    },
    {
      "n": 28,
      "title": "The band follows the mockup",
      "status": "running",
      "depends": [],
      "model": "sonnet",
      "doneWhen": "the band above the prompt matches `overseer/mockups/band.html` \"Proposed\": calm = chip in the calm colour, \"✓ 4/9 lots · 2 working · next pass HH:MM\"; needs you = coral chip, \"▶ <the one action>\" and \"· +N\" for the others, nothing else; error = \"✗ <what failed> · <what to do>\"; opened = 5 lines at most (recommends/blocks/waited, the next need, the progress bar, the sessions); \"Board b · Pass now\" on the right; golden screens (band-*) regenerated and reviewed; `./check.sh` exits 0",
      "check": "./check.sh",
      "session": "00000000-0000-4000-8000-000000000028"
    },
    {
      "n": 26,
      "title": "The web board follows the v1 mockups",
      "status": "blocked",
      "depends": [
        25
      ],
      "model": "sonnet",
      "doneWhen": "`overseer/web/index.html` renders the live board in the layout and style of `overseer/web/mockups/calm.html` (nothing needs you) and `overseer/web/mockups/needs-you.html` (decisions wait): same palette, IBM Plex Sans and Mono, header with \"● live · next pass\", the Focus block (\"Nothing needs you.\" or \"N decisions wait on you\" with the decision cards: question, Recommends, Blocks, where to answer, and lot 19's buttons), the At risk box, the progress bar with its legend, the Lots table (Lot, On it, Done when, State) with the done lots folded, the Sessions line, then folded Branches, Lots graph, Workflows, Decisions and Log; `server.test.mjs` stays green and a test checks both states' key strings on a sample board; `./check.sh` exits 0",
      "check": "./check.sh",
      "note": "needs the Host decision"
    }
  ],
  "sessions": [
    {
      "sessionId": "00000000-0000-4000-8000-000000000027",
      "label": "worker-dd",
      "stage": "waits",
      "lot": 27,
      "lotStartedAt": 1791995620000,
      "since": 1791999700000,
      "lastText": "Working on it.",
      "tries": 0,
      "model": "sonnet",
      "question": "Open the More button as a view or a drawer?",
      "recommend": {
        "option": "view",
        "why": "the mockup shows a view"
      },
      "ask": {
        "id": "ask-27",
        "question": "Open the More button as a view or a drawer?",
        "options": [
          "view",
          "drawer"
        ]
      },
      "link": "https://claude.ai/code/session_27"
    },
    {
      "sessionId": "00000000-0000-4000-8000-000000000028",
      "label": "worker-bf",
      "stage": "stuck",
      "lot": 28,
      "lotStartedAt": 1791995620000,
      "since": 1791999700000,
      "lastText": "Working on it.",
      "tries": 2,
      "model": "sonnet",
      "note": "same error twice"
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
    "spent": 9,
    "budget": 15,
    "level": "reduce"
  },
  "atRisk": [
    {
      "where": "/home/user/Repos/claude-mods.wt/lot-27",
      "branch": "lot/27-pane",
      "files": [
        "overseer/hooks/pane.tsx"
      ],
      "workflows": [],
      "silent": []
    }
  ],
  "decisions": [
    {
      "at": "2026-10-21",
      "lot": "26",
      "question": "Serve the page on 4318?",
      "answer": "yes"
    }
  ]
} satisfies Board
