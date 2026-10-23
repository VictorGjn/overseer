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
      "n": 30,
      "title": "The data contract of the v3 board",
      "status": "todo",
      "depends": [
        29
      ],
      "model": "sonnet",
      "doneWhen": "`overseer/web/CONTRACT.md` maps each element of the mockup (top bar, Now/Next/Done list, rail, lot pane brief, funnel, the stages Workflow, Changes and Tests, HUD, Review mode, git tree, project switcher) to one source: an existing `Board` field, a new field (name, type, the lot that adds it), a server endpoint, or \"dropped\" with the reason;; `overseer/hooks/board.ts` declares the new fields as optional types only (no producer in this lot);; `overseer/web/fixtures/board-v3.json` is a sample board with every field filled, made from the mockup's sample data; a test type-checks it against `Board`.; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "the v3 mockup draws from sample constants, and the real `Board` has only part of these fields. Cost: page lots invent fields, or two lots add the same field twice. Direction: one table per screen area in CONTRACT.md. The lots that fill a field are 31 (brief), 33 (git evidence), 34 (marks), 35 (workflow steps), 36 (run state), 37 (changes), 38 (graph), 39 (diff endpoint).",
        "keep": [],
        "criteria": [
          "`overseer/web/CONTRACT.md` maps each element of the mockup (top bar, Now/Next/Done list, rail, lot pane brief, funnel, the stages Workflow, Changes and Tests, HUD, Review mode, git tree, project switcher) to one source: an existing `Board` field, a new field (name, type, the lot that adds it), a server endpoint, or \"dropped\" with the reason;",
          "`overseer/hooks/board.ts` declares the new fields as optional types only (no producer in this lot);",
          "`overseer/web/fixtures/board-v3.json` is a sample board with every field filled, made from the mockup's sample data; a test type-checks it against `Board`.",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 31,
      "title": "The task format in the plan",
      "status": "todo",
      "depends": [
        30
      ],
      "model": "sonnet",
      "doneWhen": "`parsePlan` reads `type:` (bug, feature, probe, decision, integration), `problem:`, `direction:`, `question:`, `options:`, `not in:`, `keep:` (one rule per line), `risk:` (event → mitigation), `linear:`, and the `- ` lines under `done when:` as a list of criteria;; `Board.lots` exports them as `brief`;; a lot with `type:` and an empty required field (bug: problem with `Cause:`, and a regression test in done when; feature: problem and done when; probe: question and done when; decision: question and options, 3 at most; integration: lots and version) is never assigned and shows as \"plan incomplete\" in needs you;; a lot without `type:` keeps today's rules, so lots 1 to 29 are unchanged;; `lotMessage` sends `direction:` and asks the think step to say \"follows\" or \"departs, because …\"; a report `[lot N departs: …]` waits for Victor as a needs-you item.; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "`parsePlan` reads 10 keys, and the brief needs more (Victor's task format, 2026-10-21). Unknown keys fall into `body`, so the board cannot show them as fields. Cost: the lot pane has no Context, Done when list, Keep or Not in.",
        "keep": [
          "STE applies to the prose fields only, never to the criteria. Do not check STE in code."
        ],
        "criteria": [
          "`parsePlan` reads `type:` (bug, feature, probe, decision, integration), `problem:`, `direction:`, `question:`, `options:`, `not in:`, `keep:` (one rule per line), `risk:` (event → mitigation), `linear:`, and the `- ` lines under `done when:` as a list of criteria;",
          "`Board.lots` exports them as `brief`;",
          "a lot with `type:` and an empty required field (bug: problem with `Cause:`, and a regression test in done when; feature: problem and done when; probe: question and done when; decision: question and options, 3 at most; integration: lots and version) is never assigned and shows as \"plan incomplete\" in needs you;",
          "a lot without `type:` keeps today's rules, so lots 1 to 29 are unchanged;",
          "`lotMessage` sends `direction:` and asks the think step to say \"follows\" or \"departs, because …\"; a report `[lot N departs: …]` waits for Victor as a needs-you item.",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 32,
      "title": "ste100:issue gets a task mode",
      "status": "todo",
      "depends": [
        31
      ],
      "model": "sonnet",
      "doneWhen": "`ste100/skills/issue/SKILL.md` has a \"Task mode\" section: the fields per type, the required ones, one example lot per type; a test reads the required fields in SKILL.md and in the parser (lot 31) and fails if they differ; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "Victor decided the task format lives in an extended `ste100:issue`. The lead drafts new lots with it, and Victor approves them.",
        "keep": [],
        "criteria": [
          "`ste100/skills/issue/SKILL.md` has a \"Task mode\" section: the fields per type, the required ones, one example lot per type",
          "a test reads the required fields in SKILL.md and in the parser (lot 31) and fails if they differ",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 33,
      "title": "The git evidence of a lot on the board",
      "status": "todo",
      "depends": [
        30
      ],
      "model": "sonnet",
      "doneWhen": "each lot with a branch exports `branch`, `tip`, `commits` (hash and subject), `files` (`[added, removed, path]`), `stat`;; the changed test files are sorted in 3 tiers: unit (`*.test.ts` except `golden.test.ts`), functional (`*.test.mjs`), screens (`golden/*`);; a merged lot exports `merged` (the merge commit) and `release` (the version of the integration that merged it);; git runs at pass time through `execFile` with no shell, never at render; the output is capped.; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "the Changes stage and the rail need, per lot, its branch, commits, files and release. Today `Board.branches` has counts only. Cost: no Changes stage and no \"delivered in 0.2.x\".",
        "keep": [],
        "criteria": [
          "each lot with a branch exports `branch`, `tip`, `commits` (hash and subject), `files` (`[added, removed, path]`), `stat`;",
          "the changed test files are sorted in 3 tiers: unit (`*.test.ts` except `golden.test.ts`), functional (`*.test.mjs`), screens (`golden/*`);",
          "a merged lot exports `merged` (the merge commit) and `release` (the version of the integration that merged it);",
          "git runs at pass time through `execFile` with no shell, never at render; the output is capped.",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 34,
      "title": "The judge marks each criterion",
      "status": "todo",
      "depends": [
        31
      ],
      "model": "sonnet",
      "doneWhen": "the judge's one call returns one mark per criterion (`met`, `gap`, `todo`) with one line of evidence, and the open gaps;; `PLAN.md` keeps them as `marks:` and `gap:` lines, and `Board.lots` exports `marks` and `gaps`;; a lot with no criteria list keeps today's single verdict;; the test counts the model calls per judgement: still one.; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "the brief checklist shows each criterion as accepted, a gap, or not met yet. Today the judge returns one note for the lot. Cost: the checklist cannot say which criterion failed.",
        "keep": [
          "no second model call, no new call at runtime."
        ],
        "criteria": [
          "the judge's one call returns one mark per criterion (`met`, `gap`, `todo`) with one line of evidence, and the open gaps;",
          "`PLAN.md` keeps them as `marks:` and `gap:` lines, and `Board.lots` exports `marks` and `gaps`;",
          "a lot with no criteria list keeps today's single verdict;",
          "the test counts the model calls per judgement: still one.",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 35,
      "title": "The workflow steps of a lot",
      "status": "todo",
      "depends": [
        30
      ],
      "model": "sonnet",
      "doneWhen": "each lot exports `workflow`: the run id, and per agent its label, phase, model, start, end and state, read from the journal and `agent-*.meta.json` (fields from lot 4); a test on a recorded journal covers a done run, a running one and a parallel phase; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "the Workflow stage shows each step (label, model, duration, state, turn). `WorkflowRun` has counts and the running labels only. Cost: no Workflow stage.",
        "keep": [],
        "criteria": [
          "each lot exports `workflow`: the run id, and per agent its label, phase, model, start, end and state, read from the journal and `agent-*.meta.json` (fields from lot 4)",
          "a test on a recorded journal covers a done run, a running one and a parallel phase",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 36,
      "title": "Live, pause and pass now from the web",
      "status": "todo",
      "depends": [
        29
      ],
      "model": "sonnet",
      "doneWhen": "a POST `/run` (`pause` or `live`) and a POST `/pass` exist, with the Host and Origin check of `/answer`; a cross-origin POST gets a 403;; paused: the pass loop gives out no new lot; running lots go on, and the judge goes on;; `Board` exports `paused` and `passEvery`;; `/oversee run` and `/oversee off` keep their meaning.; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "the v3 top bar has \"live\" (a click pauses the run) and \"next pass\" (a click passes now). The pass loop has no pause state, and the web cannot start a pass. Cost: you must type a command in the overseer session.",
        "keep": [],
        "criteria": [
          "a POST `/run` (`pause` or `live`) and a POST `/pass` exist, with the Host and Origin check of `/answer`; a cross-origin POST gets a 403;",
          "paused: the pass loop gives out no new lot; running lots go on, and the judge goes on;",
          "`Board` exports `paused` and `passEvery`;",
          "`/oversee run` and `/oversee off` keep their meaning.",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 37,
      "title": "Change requests",
      "status": "todo",
      "depends": [
        36
      ],
      "model": "sonnet",
      "doneWhen": "a POST `/change` (`lot`, optional `file` and `line`, `text`) exists, with the Host and Origin check;; on a running lot, the lead sends `[overseer-change] lot N · file:line · text` to the session that has it;; on a done lot, the lead reopens it: the mark goes back to `[ ]`, a `change:` line (date · file:line · text) is added, and the next lot message carries the change;; `Board.lots` exports `changes` (open requests).; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "in the v3 board, a click on a diff line, a file or the lot opens a change request. Nothing carries it today. Cost: you leave the board to tell the session.",
        "keep": [
          "only the lead writes `PLAN.md`."
        ],
        "criteria": [
          "a POST `/change` (`lot`, optional `file` and `line`, `text`) exists, with the Host and Origin check;",
          "on a running lot, the lead sends `[overseer-change] lot N · file:line · text` to the session that has it;",
          "on a done lot, the lead reopens it: the mark goes back to `[ ]`, a `change:` line (date · file:line · text) is added, and the next lot message carries the change;",
          "`Board.lots` exports `changes` (open requests).",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 38,
      "title": "The git tree of the plan",
      "status": "todo",
      "depends": [
        30
      ],
      "model": "sonnet",
      "doneWhen": "`GRAPH_FORMAT` gains the parents (`%p`);; each row exports `lot` (from `lot/<n>-` in its refs, or its merge subject) and `version` (from the integration commit);; a pure function gives each commit a lane, like `git log --graph` turned on its side.; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "the v3 git tree draws each commit since the plan started, in lanes, with its lot and the release rings. `GRAPH_FORMAT` has no parents. Cost: no tree.",
        "keep": [],
        "criteria": [
          "`GRAPH_FORMAT` gains the parents (`%p`);",
          "each row exports `lot` (from `lot/<n>-` in its refs, or its merge subject) and `version` (from the integration commit);",
          "a pure function gives each commit a lane, like `git log --graph` turned on its side.",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 39,
      "title": "One file's diff on request",
      "status": "todo",
      "depends": [
        33
      ],
      "model": "sonnet",
      "doneWhen": "`GET /diff/<slug>?lot=N&file=<path>` returns the diff of that file on that lot's branch against its base;; only a ref and a path that the board lists are accepted; any other gets a 404 (a test tries `../` and an unknown ref);; git runs through `execFile` with no shell; the output is capped at 400 lines.; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "the Changes stage opens a file's diff on a click. Diffs in the board file would make it too large. Cost: no diff in the board.",
        "keep": [],
        "criteria": [
          "`GET /diff/<slug>?lot=N&file=<path>` returns the diff of that file on that lot's branch against its base;",
          "only a ref and a path that the board lists are accepted; any other gets a 404 (a test tries `../` and an unknown ref);",
          "git runs through `execFile` with no shell; the output is capped at 400 lines.",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 40,
      "title": "The v3 page: the frame",
      "status": "todo",
      "depends": [
        30
      ],
      "model": "sonnet",
      "doneWhen": "`index.html` follows `mockups/board-v3.html`: top bar (project switcher from `/boards`, view, Lean/Full, the live/next-pass group, sessions busy, budget, Review), the Now/Next/Done list, the rail, the lot pane (brief with its criteria checklist, then the funnel Workflow/Changes/Tests), the HUD above 1280px, Review mode, and the keys of the mockup;; it reads `/board/<slug>` and `/events/<slug>`, and shows \"not exported yet\" for a missing field, never sample data;; both themes, and 390px with no page scroll to the side;; the stage contents load from `web/stages/workflow.js`, `changes.js`, `tests.js` and the tree from `web/gittree.js`, empty modules for lots 41 to 43;; `server.mjs` reads the page and these files on each request (no stale page after an update), and serves only these names;; a stdlib test runs the system Chrome headless (`--dump-dom`) on the page served with `fixtures/board-v3.json`, and checks the key strings; it skips when Chrome is absent. No npm dependency in `check.sh`.; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "`overseer/web/index.html` is the v1 page of lot 26. Victor wants the v3 board. Cost: the board in the browser is not the one we designed.",
        "keep": [],
        "criteria": [
          "`index.html` follows `mockups/board-v3.html`: top bar (project switcher from `/boards`, view, Lean/Full, the live/next-pass group, sessions busy, budget, Review), the Now/Next/Done list, the rail, the lot pane (brief with its criteria checklist, then the funnel Workflow/Changes/Tests), the HUD above 1280px, Review mode, and the keys of the mockup;",
          "it reads `/board/<slug>` and `/events/<slug>`, and shows \"not exported yet\" for a missing field, never sample data;",
          "both themes, and 390px with no page scroll to the side;",
          "the stage contents load from `web/stages/workflow.js`, `changes.js`, `tests.js` and the tree from `web/gittree.js`, empty modules for lots 41 to 43;",
          "`server.mjs` reads the page and these files on each request (no stale page after an update), and serves only these names;",
          "a stdlib test runs the system Chrome headless (`--dump-dom`) on the page served with `fixtures/board-v3.json`, and checks the key strings; it skips when Chrome is absent. No npm dependency in `check.sh`.",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 41,
      "title": "The Workflow and Tests stages",
      "status": "todo",
      "depends": [
        40,
        33,
        34,
        35
      ],
      "model": "sonnet",
      "doneWhen": "`web/stages/workflow.js` draws the steps of lot 35 as in the mockup;; `web/stages/tests.js` draws the judge note on top, then Unit, Functional and Screenshots (lot 33 tiers, the reference screens with a picker); a gap shows one time only.; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "",
        "keep": [],
        "criteria": [
          "`web/stages/workflow.js` draws the steps of lot 35 as in the mockup;",
          "`web/stages/tests.js` draws the judge note on top, then Unit, Functional and Screenshots (lot 33 tiers, the reference screens with a picker); a gap shows one time only.",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 42,
      "title": "The Changes stage and change requests",
      "status": "todo",
      "depends": [
        40,
        33,
        37,
        39
      ],
      "model": "sonnet",
      "doneWhen": "`web/stages/changes.js` lists the files (lot 33), and opens a file's diff from `/diff` (lot 39) on a click;; a click on a diff line or a file, or the R key, opens a change request; ⌘↵ sends it to `/change` (lot 37); on a done lot, the caption says \"reopened\";; the merge line (\"Merged in X → 0.2.x\") and, for an integration lot, its lots.; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "",
        "keep": [],
        "criteria": [
          "`web/stages/changes.js` lists the files (lot 33), and opens a file's diff from `/diff` (lot 39) on a click;",
          "a click on a diff line or a file, or the R key, opens a change request; ⌘↵ sends it to `/change` (lot 37); on a done lot, the caption says \"reopened\";",
          "the merge line (\"Merged in X → 0.2.x\") and, for an integration lot, its lots.",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 43,
      "title": "The git tree view",
      "status": "todo",
      "depends": [
        40,
        38
      ],
      "model": "sonnet",
      "doneWhen": "`web/gittree.js` draws the rows of lot 38 as in the mockup (lanes, one OKLCH hue per lot that shows only when the tree is open, release rings, the branch labels), opens on G, and a click on a commit selects its lot; a test on `fixtures/board-v3.json` with the browser check; `./check.sh` exits 0",
      "check": "./check.sh",
      "brief": {
        "type": "feature",
        "problem": "",
        "keep": [],
        "criteria": [
          "`web/gittree.js` draws the rows of lot 38 as in the mockup (lanes, one OKLCH hue per lot that shows only when the tree is open, release rings, the branch labels), opens on G, and a click on a commit selects its lot",
          "a test on `fixtures/board-v3.json` with the browser check",
          "`./check.sh` exits 0"
        ]
      }
    },
    {
      "n": 44,
      "title": "Integration 5 → 0.3.0",
      "status": "todo",
      "depends": [
        30,
        31,
        32,
        33,
        34,
        35,
        36,
        37,
        38,
        39,
        40,
        41,
        42,
        43
      ],
      "model": "sonnet",
      "doneWhen": "the branches of lots 30 to 43 are merged into `feat/overseer-board`; the golden screens are regenerated once and reviewed; the browser check is green on the merged result; `plugin.json` is at 0.3.0; `./check.sh` exits 0 on `feat/overseer-board`; Victor accepts the live board: one pass, pause then live, pass now, one change request",
      "check": "./check.sh",
      "brief": {
        "type": "integration",
        "problem": "Then the lot ends with `[lot 44 blocked: reinstall: claude plugin update overseer@claude-mods, then restart the overseer session]`. After the reinstall, Victor accepts the board: the live board next to the mockup, one pass, pause then live, pass now, one change request on a running lot.",
        "keep": [],
        "criteria": [
          "the branches of lots 30 to 43 are merged into `feat/overseer-board`",
          "the golden screens are regenerated once and reviewed",
          "the browser check is green on the merged result",
          "`plugin.json` is at 0.3.0",
          "`./check.sh` exits 0 on `feat/overseer-board`",
          "Victor accepts the live board: one pass, pause then live, pass now, one change request"
        ]
      }
    }
  ],
  "sessions": [],
  "feed": [
    {
      "at": 1791999880000,
      "action": "assign",
      "label": "worker-dd",
      "text": "lot 27"
    }
  ],
  "proposed": [
    30,
    31,
    32,
    33,
    34,
    35,
    36,
    37,
    38,
    39,
    40,
    41,
    42,
    43,
    44
  ]
} satisfies Board
