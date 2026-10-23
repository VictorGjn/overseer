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
      "n": 22,
      "title": "The decision card",
      "status": "done",
      "depends": [
        20
      ],
      "model": "sonnet",
      "doneWhen": "a waiting session shows one decision card (band: NEXT only; pane; web) with the question, the session's recommendation from `[ask: <question> | recommend: <option> — <why>]`, and the lots it blocks (from `depends`); `SESSION_RULES` asks for that line once per session; tests cover a card with and without a recommendation; golden screens updated; `./check.sh` exits 0",
      "check": "./check.sh",
      "verdict": {
        "verdict": "done",
        "note": "check.sh green"
      },
      "verdictAt": 1791996400000,
      "tokens": 1000000
    },
    {
      "n": 23,
      "title": "“At risk”",
      "status": "done",
      "depends": [
        20
      ],
      "model": "sonnet",
      "doneWhen": "the pane and the web board list, per worktree, the uncommitted files, the running workflows and their agents, and the sessions in `work` with no commit since their lot started; local commits are not listed (closing a session keeps its branch); tests on a sample; `./check.sh` exits 0",
      "check": "./check.sh",
      "verdict": {
        "verdict": "done",
        "note": "check.sh green"
      },
      "verdictAt": 1791996400000,
      "tokens": 1000000
    },
    {
      "n": 24,
      "title": "The decision log",
      "status": "done",
      "depends": [
        20
      ],
      "model": "sonnet",
      "doneWhen": "when a session that waited gets the person's answer, a line `date · lot · question · answer (200 chars)` is appended to `DECISIONS.md` at the repository top, shown in the pane's Log and on the web board; tests cover an answer in the terminal and one from the board (lot 19); `./check.sh` exits 0",
      "check": "./check.sh",
      "verdict": {
        "verdict": "done",
        "note": "check.sh green"
      },
      "verdictAt": 1791996400000,
      "tokens": 1000000
    },
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
      "marks": [
        {
          "i": 0,
          "mark": "met"
        },
        {
          "i": 1,
          "mark": "todo"
        },
        {
          "i": 2,
          "mark": "todo"
        },
        {
          "i": 3,
          "mark": "todo"
        }
      ]
    },
    {
      "n": 28,
      "title": "The band follows the mockup",
      "status": "todo",
      "depends": [],
      "model": "sonnet",
      "doneWhen": "the band above the prompt matches `overseer/mockups/band.html` \"Proposed\": calm = chip in the calm colour, \"✓ 4/9 lots · 2 working · next pass HH:MM\"; needs you = coral chip, \"▶ <the one action>\" and \"· +N\" for the others, nothing else; error = \"✗ <what failed> · <what to do>\"; opened = 5 lines at most (recommends/blocks/waited, the next need, the progress bar, the sessions); \"Board b · Pass now\" on the right; golden screens (band-*) regenerated and reviewed; `./check.sh` exits 0",
      "check": "./check.sh"
    }
  ],
  "sessions": [
    {
      "sessionId": "00000000-0000-4000-8000-000000000027",
      "label": "worker-dd",
      "stage": "work",
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
  ],
  "budget": {
    "spent": 2.9,
    "budget": 15,
    "level": "normal"
  },
  "pace": 4200000,
  "graph": [
    {
      "graph": "*",
      "hash": "bbeac00",
      "parents": [
        "30ee6f1"
      ],
      "refs": [],
      "subject": "feat(ste100): add issue skill (Context, Problem, Solution, Risk, Action block)",
      "at": 1792582740000,
      "lane": 0,
      "x": 76
    },
    {
      "graph": "*",
      "hash": "a293aeb",
      "parents": [
        "8b58bc2"
      ],
      "refs": [
        "lot/26-web-mockups"
      ],
      "subject": "feat(overseer): the web board follows the v1 mockups, calm and needs you",
      "at": 1792570920000,
      "lane": 1,
      "x": 75,
      "lot": 26
    },
    {
      "graph": "*",
      "hash": "ef2e919",
      "parents": [
        "30ee6f1"
      ],
      "refs": [
        "pre/mockups"
      ],
      "subject": "docs(overseer): the v1 pane and band mockups",
      "at": 1792570320000,
      "lane": 2,
      "x": 74
    },
    {
      "graph": "*",
      "hash": "8b58bc2",
      "parents": [
        "30ee6f1"
      ],
      "refs": [],
      "subject": "docs(overseer): the v1 web board mockups, calm and needs you",
      "at": 1792567620000,
      "lane": 1,
      "x": 73,
      "lot": 26
    },
    {
      "graph": "*",
      "hash": "634d280",
      "parents": [
        "caa4740",
        "247cfcc"
      ],
      "refs": [
        "int/3"
      ],
      "subject": "fix(overseer): integration 3, conclude lot 19 merge, answer buttons and link inside the de",
      "at": 1792567020000,
      "lane": 3,
      "x": 72
    },
    {
      "graph": "*",
      "hash": "30ee6f1",
      "parents": [
        "4b93a6b"
      ],
      "refs": [
        "pre/int-4"
      ],
      "subject": "chore(overseer): 0.2.6, integration 3 (lots 18 to 24)",
      "at": 1792544820000,
      "lane": 0,
      "x": 71,
      "lot": 26,
      "version": "0.2.6"
    },
    {
      "graph": "*",
      "hash": "4b93a6b",
      "parents": [
        "ece86c9"
      ],
      "refs": [],
      "subject": "test(overseer): golden screens of integration 3",
      "at": 1792544820000,
      "lane": 0,
      "x": 70,
      "lot": 26
    },
    {
      "graph": "*",
      "hash": "ece86c9",
      "parents": [
        "f5b0831",
        "1cf490f"
      ],
      "refs": [],
      "subject": "Merge branch 'lot/24-decisions' into pre/int-4",
      "at": 1792544700000,
      "lane": 0,
      "x": 69,
      "lot": 26
    },
    {
      "graph": "*",
      "hash": "f5b0831",
      "parents": [
        "f37bcb3",
        "78e73b9"
      ],
      "refs": [],
      "subject": "Merge branch 'lot/23-at-risk' into pre/int-4",
      "at": 1792544700000,
      "lane": 0,
      "x": 68,
      "lot": 26
    },
    {
      "graph": "*",
      "hash": "f37bcb3",
      "parents": [
        "84aeb7b",
        "1c6c3bf"
      ],
      "refs": [],
      "subject": "Merge branch 'lot/22-decision-card' into pre/int-4",
      "at": 1792544640000,
      "lane": 0,
      "x": 67,
      "lot": 26
    },
    {
      "graph": "*",
      "hash": "84aeb7b",
      "parents": [
        "4b5d11a",
        "f66f101"
      ],
      "refs": [],
      "subject": "Merge branch 'lot/21-verdict-line' into pre/int-4",
      "at": 1792544520000,
      "lane": 0,
      "x": 66,
      "lot": 26
    },
    {
      "graph": "*",
      "hash": "4b5d11a",
      "parents": [
        "dfe1c4a",
        "e798501"
      ],
      "refs": [],
      "subject": "Merge branch 'lot/20-two-states' into pre/int-4",
      "at": 1792544460000,
      "lane": 0,
      "x": 65,
      "lot": 26
    },
    {
      "graph": "*",
      "hash": "dfe1c4a",
      "parents": [
        "c45056b",
        "247cfcc"
      ],
      "refs": [],
      "subject": "Merge branch 'lot/19-answer-board' into pre/int-4",
      "at": 1792544460000,
      "lane": 0,
      "x": 64,
      "lot": 26
    },
    {
      "graph": "*",
      "hash": "c45056b",
      "parents": [
        "3a279e1",
        "35d9b20"
      ],
      "refs": [],
      "subject": "Merge branch 'pre/int-3' into pre/int-4",
      "at": 1792544460000,
      "lane": 0,
      "x": 63,
      "lot": 26
    },
    {
      "graph": "*",
      "hash": "caa4740",
      "parents": [
        "b030be4",
        "1c6c3bf"
      ],
      "refs": [],
      "subject": "Merge branch 'lot/22-decision-card' into int/3",
      "at": 1792544460000,
      "lane": 3,
      "x": 62
    },
    {
      "graph": "*",
      "hash": "b030be4",
      "parents": [
        "ccc9b48",
        "1cf490f"
      ],
      "refs": [],
      "subject": "Merge branch 'lot/24-decisions' into int/3",
      "at": 1792544400000,
      "lane": 3,
      "x": 61
    },
    {
      "graph": "*",
      "hash": "ccc9b48",
      "parents": [
        "679c508",
        "78e73b9"
      ],
      "refs": [],
      "subject": "Merge branch 'lot/23-at-risk' into int/3",
      "at": 1792544400000,
      "lane": 3,
      "x": 60
    },
    {
      "graph": "*",
      "hash": "679c508",
      "parents": [
        "cb799ab",
        "f66f101"
      ],
      "refs": [],
      "subject": "Merge branch 'lot/21-verdict-line' into int/3",
      "at": 1792544340000,
      "lane": 3,
      "x": 59
    },
    {
      "graph": "*",
      "hash": "cb799ab",
      "parents": [
        "3a279e1",
        "35d9b20"
      ],
      "refs": [],
      "subject": "Merge branch 'pre/int-3' into int/3",
      "at": 1792544340000,
      "lane": 3,
      "x": 58
    },
    {
      "graph": "*",
      "hash": "1c6c3bf",
      "parents": [
        "8b25044"
      ],
      "refs": [
        "lot/22-decision-card"
      ],
      "subject": "test(overseer): a 64-column golden of the More view, the narrow layout",
      "at": 1792541700000,
      "lane": 5,
      "x": 57,
      "lot": 22
    }
  ]
} satisfies Board
