# Board v3: the data contract

The reference is `mockups/board-v3.html`. This file says where each thing it draws comes from. The page reads the `Board` that the overseer writes (`hooks/board.ts`) and sends writes to the server (`server.mjs`). No row needs a model call at render time.

Kinds: **mapped** (a `Board` field, a new field, or an endpoint), **derived** (a rule over mapped data, or a rule for a pure style or toggle), **dropped** (not built, with the reason).
Every new field is optional in `board.ts`, so a board written by an older overseer still draws (fixture `old`).

## New fields

| field | type | producer lot | meaning |
|---|---|---|---|
| `error` | `{ text; at; source }` | 36 | the overseer's last error |
| `requests` | `BoardRequest[]` | 36 | the write queue: each request, done or dropped, with the reason |
| `passing` | `boolean` | 36 | a pass is running now |
| `nextPassAt` | `number` (exists, required) | 36 | when the next pass starts; a `POST /pass` moves it to that pass + `passEvery` |
| `paused` | `boolean` | 36 | no new lot goes out; running lots finish |
| `passEvery` | `number` | 36 | the length of the pass clock, for the ring |
| `proposed` | `number[]` | 53 | the numbers of the lots marked `[?]` in PLAN.md (proposed, waiting for approval; never handed out). Need `plan` shows while any exists |
| `brief` | `Brief` (per lot) | 31 | the task format: type, problem, direction, question, options, notIn (list), keep (list), risk (`{event, mitigation}` list), linear, lots, version, criteria; absent fields are omitted |
| `base` | `string` (per lot) | 33 | the fork-point sha of the lot's branch |
| `tip` | `string` (per lot) | 33 | the head sha of the lot's branch |
| `dirty` | `{ path; add; del }[]` (per lot) | 33 | uncommitted paths of a running lot |
| `mod` | `{ version }` | 51 | the overseer mod that wrote the board; the page compares it with `GET /version` and says "server X, overseer Y: restart it" |
| `needs[].lot` | `number` (optional, on each exported need) | 69 | the task a need names: the push text says "task N" (`register.tsx`, the `needs` export) |
| `branch` | `string` (per lot) | 33 | the lot's branch: the `branch:` line, its session's worktree branch, else `lot/<n>-*` |
| `commits` | `{ hash; subject }[]` (per lot) | 33 | the commits between `base` and `tip`, newest first |
| `files` | `[added, removed, path][]` (per lot) | 33 | the files the branch changes from `base` |
| `stat` | `{ files; add; del }` (per lot) | 33 | the totals of `files` |
| `tests` | `{ unit; functional; screens }` (per lot) | 33 | the changed test files: `*.test.ts` but `golden.test.ts`, `*.test.mjs`, `golden/*` |
| `merged` | `string` (per lot) | 33 | the merge commit on the run's integration branch |
| `release` | `string` (per lot) | 33 | the mod's version at the merge commit ("delivered in 0.2.x") |
| `graph` rows | `GraphRow`: `parents`, `lane`, `x`, `lot`, `version` | 38 | each commit since the run started (300 at most): its parents, its lane and column, its lot (none: grey), its release |
| `graphCut` | `number` | 38 | the commits since the run started that `graph` leaves out |
| `check` | `string \| CheckRun` (per lot) | 34 | the last run of the check (the command until it ran). In `plan.ts` the `Lot` field is `checkResult`; `boardLot` sends `check: l.checkResult ?? l.check` |
| `retry` | `Verdict` (per lot) | 34 | the first pass, when the judge asked to retry |
| `marks` | `Mark[]` (per lot) | 34 | the judge's mark for each criterion: met, gap or todo |
| `noVerdict` | `boolean` (per lot) | 34 | the judge gave no verdict twice on the session's last report: the need `judge`; not judged again until a new report |
| `checklist` | `{ text; mark; ev }[]` (per lot, web export only) | 34 | each criterion with its mark; a done lot the judge did not mark reads "not judged" |
| `gaps` | `string[]` (per lot) | 34 | the gaps the judge listed |
| `changes` | `Change[]` (per lot) | 37 | the change requests: `id`, `file`, `line`, `text`, `at`, `state` (sent, done or dropped), `queued` (the caption when the session was busy at the send) |
| `plan` | Need kind | 53 | the plan waits for approval |
| `incomplete` | Need kind | 31 | a task has no `done when:` or no `check:` |
| `departs` | Need kind | 31 | a task left the plan format |
| `judge` | Need kind | 34 | the judge gave no verdict |
| `reinstall` | Need kind | 54 | the installed mod is older than the repository |
| `gate` | Need kind | 35 | a workflow waits for approval (lot 48 adds the action) |
| `review` | Need kind | 54 | a done task whose report leaves an item for Victor (`review:` in `PLAN.md`); "Look at it", closed by `POST /lot` `reviewed` |
| `needs[]` | `{ kind, id, red, text, why, card, act, cmd }` (web export) | 54 | each need with its own action: `act` the request that closes it, `cmd` the command to copy (`y`), parsed from the blocked note |
| `workflows[].steps` | `Step[]` | 35 | one step per agent: `label`, `kind`, `turn`, `group` (parallel or loop), `phase`, `state`, `model`, `effort`, `startedAt`, `endedAt`, `goal`, `how`, `out` (`hooks/steps.ts`) |
| `workflows[]` run fields | `startedAt`, `endedAt`, `durationMs`, `model`, `state`, `preview` | 35 | a run that ended comes from `wf_*.json`; a lot's runs are read back to its assignment, other sessions' for 3 h |
| `sessions[].stage` `gate`, `sessions[].gate` | `{ name; agents: { label; model? }[] }` | 35 | the session's plan waits on the workflow gate (`active/<sid>.json`, status `pending`); lot 48 adds `fp` and `state` |

## Endpoints

| endpoint | what | producer lot |
|---|---|---|
| `GET /boards` | the list of boards, for `#pj-menu`: `slug`, `repo`, `goal`, `at`, and per board `needs` (the length of the `needs` the overseer wrote), `done`, `total` (lots) and `stale` (older than 10 min) | 40 |
| `GET /board/<slug>` | one board, as a stream (exists) | - |
| `POST /answer` | an option label or a free text for a waiting session: `sessionId` (uuid), then `askId` and `label`, or `text` (lines kept) with `askId` for an open question, without it for a session that asked in plain text (lot 54) | 36 |
| `POST /run` | live or paused: `paused` (boolean) | 36 |
| `POST /pass` | pass now: no field | 36 |
| `POST /lot` | close a need (`e`): `lot` (int, 1 or more), `action`: `done` (`[x]`; a task blocked for a reinstall needs the installed version to equal the repository's), `retry` (back to its session), `drop` (back to `[ ]`, no session), `accept-departure`, `reviewed` (closes a `review` need) | 54 |
| `POST /change` | a change request: `lot`, `text` (1 to 2000), optional `file` and `line`. 409 when the lot is running and the board does not watch its session. The overseer sends `[overseer-change] task N · file:line · text` to a running lot's session and keeps the request on the lot's `change:` line (`sent`, then `done` at `[change N done]` or at the next verdict of done); a todo or blocked lot carries it in its next message; a done lot is reopened (`[ ]`, no `session:`, `verdict:`, `verdictAt:`; `branch:` kept, and `owner:` the last session while it is watched) | 37 |
| `POST /gate` | approve, change or reject a workflow: `session` (uuid), `plan`, `action` (`approve`, `change`, `reject`), `text` when the action is `change` | 48 |
| `GET /diff/<slug>?lot=N&file=<path>&view=branch\|worktree` | a file's diff, `{ rows: [kind, line, text][], cut }`, 400 rows at most; only a lot, its shas, a path and a worktree the board lists | 39 |
| `GET /file/<slug>?lot=N&path=<golden path>` | a `golden/*` file at the lot's tip, `{ text, cut }`, 400 lines at most, for a path the lot's files list | 39 |
| `POST /plan` | approve, put off or change proposed lots: `approve` (an array of lot numbers), `decline` (an array: "Not now", the lot leaves the plan for the section « En attente », as the terminal question does) or `change` (`{ lot, text }`); exactly one of the three. Each lot must be `[?]`, others are named in `why`. The page sends `approve` and `decline` only for lots that `proposed` and `lots` both hold (PLAN.md at that pass); a lot only in `proposed` shows "not in the plan yet" and no control | 53, 76 |
| `GET /version` | `{ version, dir, pid }`: the mod version the server runs, its folder, its process | 51 |
| `GET /manifest.webmanifest` | the web app manifest: standalone, `scope` `/`, `start_url` `/?t=<token>` (built on each request), `theme_color` and `background_color` from `--ground` in `board.css`, the two icons | 69 |
| `GET /icon-192.png`, `GET /icon-512.png`, `GET /apple-touch-icon.png` | a PNG in memory (`push.mjs` `icon`): a ring and a dot on `--act`, on the ground; 192, 512 and 180 px | 69 |
| `GET /sw.js` | the service worker (`sw.js`): `push` shows the need, `notificationclick` focuses the board and posts `{ need, slug }`, or opens `url`; its scope is `/` | 69 |
| `GET /push/key` | `{ key, hours }`: the VAPID public key (raw, base64url) for `pushManager.subscribe`, and the quiet hours (`null` or `{ from, to }`) | 69 |
| `POST /push/subscribe` | a browser's subscription: `subscription` (`endpoint` https on a host of `PUSH_HOSTS` in push.mjs: `web.push.apple.com`, `fcm.googleapis.com`, or a subdomain of `push.services.mozilla.com`, with no port and no user; any other is 400 and gets no request; http on 127.0.0.1 in tests only; `keys.p256dh` 65 bytes, `keys.auth` 16 bytes). Writes `push.json` | 69 |
| `POST /push/schedule` | the quiet hours: `hours` (`{ from, to }`, `HH:MM`, the Mac's local time; a window may cross midnight) or `null` for always. Writes `push.json` | 69 |
| `POST /push/snooze` | a need's snooze: `slug`, `need` (its key `kind:id`, at most 200 characters), `until` (ms). The need is not pushed before `until`, and pushes once after it if still open. Writes `push.json` | 69 |

### The write queue (lot 36)

Every `POST` above is a request, not an action. Its body carries `slug` (`^[a-z0-9-]+$`, the board's) and `id` (`^[A-Za-z0-9-]{1,64}$`, chosen by the page; the same `id` replaces the earlier file) beside the fields of its kind. `server.mjs` checks, in this order: Host (403), Origin equal to the server's own (403; a missing or `null` Origin is refused), JSON content type (415), 4096 bytes (413), `slug` and `id` and the kind's fields (400). A good request gets 202 and becomes `~/.claude/overseer/requests/<slug>/<id>.json` = `{ kind, id, at, ...fields }`. The server never acts and never writes `PLAN.md`.

The overseer session reads the folder every 2 s, only when `Board.overseer` is itself, acts, removes the file, writes the board at once, and exports `Board.requests`: `[{ id, kind, state: 'done' | 'dropped', why, at }]`, the last 20, newest first, none older than 24 h. A dropped request shows its `why`.

| kind | what the lead does | dropped when |
|---|---|---|
| `answer` | re-checks the question and sends the label | the question changed or was answered |
| `run` | sets `paused`: no new lot goes out, running lots go on and are judged; `/oversee off` clears it, `/oversee run` starts live | no plan running |
| `pass` | cancels the pass timer, runs one pass, starts the timer again; during a pass it runs once after it | never |
| `lot` | the action of lot 54, under `withPlan`, with a decision line in `DECISIONS.md` | no plan running; no such task; retry or accept-departure with no session; reviewed with nothing to review; done on a reinstall not done yet |
| `plan` | `approve` sets each `[?]` lot to `[ ]`; `change` appends one entry `{id, text, at, state: "sent"}` to the lot's `changes` (the `change:` JSON list of lot 37) and keeps `[?]` | no plan running; no lot is `[?]` (`why`: "lot N is not proposed" or "no lot N in the plan"); when some lots are `[?]` and others not, the request is done and `why` names the others |
| unknown kind, bad JSON | nothing | always: "bad request" (`kind` is `unknown`) |

## Overview: top bar (`#view-cockpit`)

| selector | view | kind | source | rule/reason |
|---|---|---|---|---|
| `#view-cockpit`, `.ck`, `.ck-top`, `.ck-nav`, `.seg`, `.ck-actions`, `.ck-run`, `.ck-stats` | Overview | derived | the page | layout of the bar; the `.seg` buttons switch Overview and Review and keep the choice in the URL hash |
| `#pj-btn`, `.pj`, `.pj-btn`, `.pj-name`, `.pj-chev` | Overview | mapped | `Board.repo` | the label is the last folder of `repo` |
| `.pj-goal` | Overview | mapped | `Board.goal` | the goal under the name |
| `#pj-menu`, `.pj-menu` | Overview | mapped | `GET /boards` | one item per board, the open one checked; the choice goes in localStorage; key `p` opens it |
| `.pj-n`, `.act` | Overview | derived | `Board.lots` | the count of needs of that board (`needsYou(board, now).length`); `.act` when the count is over 0 |
| `#pj-note` | Overview | dropped | - | a note about the mockup's sample data |
| Sample `#pj-menu` rows (`data-pj`) | Overview | dropped | - | sample projects of the mockup; the real rows come from `/boards` |
| `#ck-live`, `#ck-livel`, `.stat`, `.live`, `.dot` | Overview | mapped | `Board.paused` | the pill says live, paused, `silent Xm` or error (see Failure states); a click sends `POST /run` |
| `#ck-pass`, `#ck-left`, `#ck-passl`, `.pass`, `.ring`, `#ck-arc`, `.arc` | Overview | mapped | `Board.nextPassAt` | the ring is (`nextPassAt` - now) / `passEvery`, the text is m:ss; `passing` shows "reading the sessions"; a click sends `POST /pass` |
| `.pips`, `.on` | Overview | derived | `Board.sessions` | lit pips = sessions whose `stage` is assigned, work, report or judge; total = `sessions.length` |
| `.meter`, `.half` | Overview | mapped | `Board.budget` | the fill is `spent` / `budget`; the mark is where `level` goes to reduce; at `budget` no new lot goes out |
| `.ck-review`, `#ck-count`, `#ck-count2`, `.badge` | Overview | derived | `Need` | the count is `needsYou(board, now).length`; a click or `z m` opens Review at the first card |

## Overview: lot list

| selector | view | kind | source | rule/reason |
|---|---|---|---|---|
| `#ck-list`, `.ck-list` | Overview | mapped | `Board.lots` | the lots, grouped by status: needs you, running, waiting, to do; done lots fold |
| `.ck-sec`, `.ck-flow`, `.ck-fold`, `#ck-more` | Overview | derived | `Board.lots` | section titles and the "Done" fold; `#ck-more` toggles the fold, the count is the number of done lots |
| `.ck-row`, `.gl`, `.t` | Overview | mapped | `Board.lots` | number, title and status of the lot; the sub line is its session label and stage |
| `.strip` | Overview | mapped | `Board.workflows` | one dot per workflow phase of the lot's session, from `phase`, `done` and `running` |
| `.eta` | Overview | derived | `Board.pace` | ETA per lot = `session.lotStartedAt + Board.pace`, running lots only; hidden when `pace` is absent |
| `.ask` | Overview | derived | `Need` | the dot on a row whose lot has an open need |
| `.ck-rel` | Overview | derived | `Board.graph` | a release heading in the Done fold, from the release tag of a commit |
| `.ck-side`, `.ck-box`, `.ck-h3` | Overview | derived | the page | the side column: boxes and their titles |
| `.ck-need`, `.kind`, `.what` | Overview | mapped | `Need` | one card per need: kind, title, what waits, age; a click opens Review at that card |
| `.ck-log` | Overview | mapped | `Board.feed` | the last 6 feed lines, sorted by `at`, newest first. The side column is hidden in the lean view, so the log sits under the task list |
| Sample `.ck-log` rows | Overview | dropped | - | sample lines of the mockup; the real lines come from `feed` |

## Overview: rail and git tree

| selector | view | kind | source | rule/reason |
|---|---|---|---|---|
| `.ck-rail`, `.rail-h` | Overview | derived | `Board.lots` | the heading: "N of M lots" counts done lots |
| `#ck-left2` | Overview | derived | `Board.pace` | "~N min left" = lots not done x `pace` / busy sessions; hidden when `pace` is absent; paused shows "paused: running lots finish, nothing new starts" |
| `#ck-rail`, `.rail`, `.rl` | Overview | mapped | `Board.lots` | one segment per lot, coloured by `status` |
| `.open` | Overview | mapped | `Board.branches` | an open lot's segment shows its branch name and its file count |
| `.plan` | Overview | mapped | `Board.proposed` | the dashed segment for a proposed plan (new, `number[]`, lot 53) |
| `.rn`, `.relseg` | Overview | derived | `Board.graph` | release nodes and segments, from the release tag of a commit |
| `.rail-notes`, `.ok` | Overview | mapped | `Board.branches` | the merge test of the open lots (`merge.conflicts`; `.ok` when none), the last decision and the at-risk line |
| `#ck-lt`, `.ck-lt`, `#ck-gt`, `.ck-gt` | Overview | derived | the page | toggles for the list (`[`) and the git tree (`g`); no data |
| `#ck-gtree`, `.gtree`, `.e`, `.c`, `.ref` | Overview | mapped | `Board.graph` | the commit tree: edges `.e`, commit dots `.c`, ref labels `.ref`; lot 38 adds parents, lot and version to each row |
| `#ck-lt` (0 commits) | Overview | derived | `Board.graph` | with no commit, `gtDraw` writes "No commits yet" |

## Overview: lot pane

| selector | view | kind | source | rule/reason |
|---|---|---|---|---|
| `#ck-main`, `.ck-main` | Overview | mapped | `Board.lots` | the selected lot |
| `.ck-empty` | Overview | derived | `Board.lots` | shown when `lots` is empty: "No tasks yet: write PLAN.md…" |
| `.nx` | Overview | derived | `Board.workflows` | a step whose deliverable is not exported yet shows "Not exported yet" |
| `.ck-mh`, `.num`, `.st` | Overview | mapped | `Board.lots` | number, title, and the session label, model and stage |
| `.ck-banner` | Overview | mapped | `Board.error` | the overseer's error line (new, `{ text; at; source }`, lot 36) |
| `.ck-body`, `.ck-ask` | Overview | mapped | `Need` | the line "this lot waits for you" when the lot has an open need |
| `.fun` | Overview | derived | `Board.lots` | the stage tabs; keys `w`, `c`, `t` |
| `.tabs`, `.k` | Overview | derived | `Board.workflows` | the turn tabs of a workflow loop; `.k` is the turn's colour chip |
| `.chain`, `.me`, `.chip`, `.lbl` | Overview | mapped | `Board.lots` | `depends` of the lot, and the lots that depend on it; `.me` is the lot itself |
| `.lb`, `.clamp`, `.vq` | Overview | mapped | `Board.lots[].brief` | the brief (new, `Brief`, lot 31): problem or question, direction; `.vq` marks a quote of Victor found in the text |
| `.crit`, `.lb-n` | Overview | mapped | `Board.lots[].marks` | criteria from `brief.criteria`, each with its mark (new, `Mark[]`, lot 34); `.lb-n` = "N of M met" |
| `.scope` | Overview | mapped | `Board.lots[].brief` | `notIn`, `keep` and `risk` of the brief (lot 31) |
| `.rf`, `.refs` | Overview | derived | `Board.lots` | file paths and URLs found in the brief text |
| `.lb-more`, `#lb-more` | Overview | derived | the page | shows the criteria and scope the brief clamps |
| `.cr`, `.cr-head`, `.cr-item` | Overview | mapped | `Board.lots[].changes` | the change requests with their state (new, `Change[]`, lot 37) |
| `.ck-go`, `#cr-new`, `.cr-form`, `#cr-form`, `#cr-text`, `#cr-cancel` | Overview | mapped | `POST /change` | key `r` opens the form; the send writes `lot`, optional `file` and `line`, and `text` |
| `#ck-wf`, `.wf`, `.wstep`, `.bead`, `.nm`, `.state`, `.grp`, `.grp-h`, `.gi`, `.out`, `.why`, `.effort`, `.model` | Overview | mapped | `Board.workflows` | a running workflow: `name`, `phase`, `done`, `running`; Goal, How and Deliverable of a proposed step come from the `text` of Need `gate` (lot 35) |
| `.dv`, `.dv-sec`, `.dv-lots`, `.ck-stat`, `.diff-note` | Overview | derived | `Board.lots` | the Changes stage: sections and counts |
| `.dv-files`, `.dv-f` | Overview | mapped | `Board.lots[].dirty` | files of the lot with `+` and `-` counts (new, lot 33); a finished lot lists the files of its branch, which lot 33 exports |
| `.dv-diff` | Overview | mapped | `GET /diff/<slug>?lot=N&file=P` | the diff of a file, read on a click (lot 39) |
| `.dv-commits`, `.links`, `.lk` | Overview | mapped | `Board.lots[].tip` | commits between `base` and `tip` taken from `graph`; the links show the tip sha (new, lot 33) |
| `.dv-verdict` | Overview | mapped | `Board.lots[].verdict` | the judge's verdict and its age |
| `.tst`, `.tr` | Overview | mapped | `Board.lots[].check` | one row per test tier from the last run (new, `string \| CheckRun`, lot 34) |
| `.term` | Overview | mapped | `Board.lots[].check` | `check.tail`, the end of the last run |
| `.retry` | Overview | mapped | `Board.lots[].retry` | the first pass, "retry" and its note (new, `Verdict`, lot 34) |
| `.gaps` | Overview | mapped | `Board.lots[].gaps` | the gaps the judge listed (new, `string[]`, lot 34); with no verdict a quiet line says so (Failure states) |
| `.say` | Overview | derived | the page | caption lines under a heading; plain text, no data |
| `.sico`, `.ico` | Overview + Review | derived | the page | status and kind glyphs, one SVG per state |

## Overview: HUD

| selector | view | kind | source | rule/reason |
|---|---|---|---|---|
| `#ck-hud`, `.ck-hud`, `.hud-row`, `.hud-sec`, `.hud-h` | Overview | derived | `Board.lots` | the right column for the selected lot: rows and section titles |
| `.hud-kv` | Overview | mapped | `Board.sessions`, `Board.pace` | two figures, each a mono value and a caption: elapsed = `now − session.lotStartedAt` against `pace` ("of 1h10 usual"; "not exported yet" with no `pace`; "not started" with no `lotStartedAt`), then stage and "try N" (`tries` + 1: `tries` counts the retries the judge sent back to the session, not turns) with the session `label`. Model and ETA are dropped (Victor, 2026-10-23: `pace` is one median for every task, not an estimate of this one) |
| `.hud-bar.pace` | Overview | derived | `Board.pace` | the elapsed time against the run's median: the track is 2 × `pace`, so the bar is full and `--act` exactly when elapsed is past 2 × `pace`, and the caption then adds "longer than usual"; no bar without `pace` or `lotStartedAt` |
| `.hud-bar` | Overview | derived | `Board.lots[].marks` | "N of M met": one 6px segment for each criterion (met `--done`, gap `--watch`, open `--line`); "not exported yet" with no `marks`. The points come from the next row |
| Points | Overview | derived | `Board.budget` | points per lot = `lot.tokens × budget.spent / Σ tokens of the lots in the window`; "not exported yet" without `tokens` or `budget` |
| Workflow step (`.hud-row`) | Overview | derived | `Board.workflows` | "step i of n" of the run matched on the session: n = `steps.length` (else `started`), i = the steps done + 1 while it runs; "no workflow" when none matches |
| Last test run (`.hud-row`) | Overview | mapped | `Board.lots[].check` | "pass" or "fail" and `ago(now − check.at)`; "not run yet" for a string; "not exported yet" without it |
| Changes (`.hud-h`) | Overview | derived | `Board.lots[].stat`, `Board.lots[].files` | "N files, +a −d" from `stat`, else summed from `files` (numstat, base to tip); "not exported yet" without either |
| `.hud-files` | Overview | mapped | `Board.lots[].dirty`, `Board.lots[].files` | the files of the lot, six at most: the uncommitted ones first, each with "not committed" (new, lot 33), then the committed ones from `files` |
| `.hud-commit` | Overview | mapped | `Board.lots[].tip` | the tip commit sha (new, lot 33) |
| `.hud-cr` | Overview | mapped | `Board.lots[].changes` | the last change requests of the lot (new, lot 37) |
| `.hud-more`, `.fun` | Overview | derived | the page | a toggle that opens the rest of the column |

## Review (`#view-review`)

| selector | view | kind | source | rule/reason |
|---|---|---|---|---|
| `#view-review`, `.zen-top`, `.zen-t`, `.eyebrow` | Review | derived | the page | the heading |
| `#z-pos`, `#z-prog`, `.zprog` | Review | derived | `Need` | "i of N" over `needsYou(board, now)`; the dots show the cards done in this visit |
| `.zcard` | Review | mapped | `Need` | one card per need; for a waiting session whose question has no buttons, the link `session.link` (Remote Control, "répondre") goes on the card |
| `.zkind`, `.zq` | Review | mapped | `Need` | kind, lot and wait on the first line; the question (`ask.question` or `text`) |
| `.k-decision` | Review | mapped | `Board.sessions[].ask` | a card for a waiting session with options; `recommend` marks the `.rec` option |
| `.k-approval` | Review | mapped | `Need` | a card for Need `gate` (workflow) or `plan` (lot 53) |
| `.k-info` | Review | mapped | `Need` | a card for `reinstall`, `departs` and `incomplete`, with no wait |
| `.zacts`, `.rec` | Review | mapped | `POST /answer` | the options of `ask.options`, one button each; `.rec` is the `recommend.option`; a click sends the option label |
| `.zreply` | Review | mapped | `POST /answer` | the free text, sent with Enter |
| `.wf-sum`, `#zwf-28` | Review | mapped | `Board.workflows` | the summary and the steps of the workflow that waits; the steps use the `.wstep` rows of the Overview |
| `.zctx`, `.zctx-h`, `#z-file` | Review | mapped | `Board.decisions` | context of a card: the last decisions of the lot and its files (`dirty`); `#z-file` is the file index (keys `,` and `.`) |
| `.st-alert` | Review | mapped | `Board.lots[].gaps` | the gap the judge found, with the agent that found it |
| `.diff`, `.dh`, `.dl`, `.hunk`, `.ln`, `.sg`, `.add`, `.del`, `.a`, `.r`, `.fs` | Review | mapped | `GET /diff/<slug>?lot=N&file=P` | the rows of the diff: kind, line number, text (lot 39); `.fs` = the `+` and `-` counts of `dirty` |
| `.tag` | Review | derived | `Board.lots[].dirty` | "not committed" when the file is in `dirty` |
| `.cmd` | Review | mapped | `Need` | the `text` of a `reinstall` need: the command to copy (key `y`) |
| `.zplan`, `#zplan` | Review | mapped | `Board.proposed` | the lots of a proposed plan, one line each (new, lot 53) |
| `.zend`, `#z-end`, `.d-why` | Review | derived | `Board.pace` | "Nothing needs you"; the next probable time = the earliest ETA of a running lot (`lotStartedAt + pace`) |
| `#z-back` | Review | derived | the page | back to the view you came from (key `Esc`) |
| `#z-again` | Overview + Review | dropped | - | test control: starts the test again |
| `.dock`, `#z-dock` | Review | derived | the KEYS table | the key hints of the open card, from its `data-key` buttons |
| `.mono` | Overview + Review | derived | the page | the monospace style |
| `#view-board`, `#st-calm`, `#st-needs`, `#z-again`, Full density | Overview + Review | dropped | - | test controls of the mockup: they switch sample data |
| duplicate branch | Overview | dropped | - | no source: nothing in the board says that two branches are the same |
| per-step ETA | Overview | dropped | - | Victor, 2026-10-21: the ETA is per lot only |

## Lot 26 features (v1)

| selector | view | kind | source | rule/reason |
|---|---|---|---|---|
| v1 · Decision cards: `.k-decision`, `.ck-need` | Overview + Review | mapped | `Board.sessions[].ask` | Review shows the full card with its options; Overview lists it in "Needs you" |
| v1 · Answers | Review | mapped | `POST /answer` | a click on an option sends its label, Enter sends the typed text; the same route as lot 26 |
| v1 · At risk | Overview | mapped | `Board.atRisk` | in the rail notes: what closing every session now would lose |
| v1 · Decisions: `.rail-notes`, `.zctx` | Overview + Review | mapped | `Board.decisions` | the last decision in the rail; the lot's decisions in the Review context |
| v1 · Remote Control link: `.zcard` | Review | mapped | `session.link` | a link to claude.ai on the card when the question has no buttons |

## Phone: install and notifications (lot 69)

The web push is a server job: the server sees every board and holds the keys, so `server.mjs` (`scan`, one `pusher` from `push.mjs`) pushes a need once, on every tick. The push routes above are state, not requests: they answer the Origin, type and size checks of the other POSTs, but write `~/.claude/overseer/push.json` (0600, temp file then rename) and never a request file. The keys are in `push-keys.json` (0600), beside it.

| element / rule | where | source | rule |
|---|---|---|---|
| `#notify-btn` "Notify me" | `#pj-menu`, under `#pj-list` | 69 | asks for permission, subscribes with the key of `GET /push/key`, posts the subscription; the state shows in `#notify-state` |
| `#quiet-from`, `#quiet-to` | `#pj-menu` | 69 | `<input type="time">`; a change posts `POST /push/schedule` (both set: the hours; either empty: always) |
| `#need=<kind:id>&slug=<slug>` | the page's hash | 69 | a push's link (`sw.js`): the page opens that need's card once the board is here; a message from an open page does the same |
| the push | `push.mjs` `pushText` | 69 | `OVERSEER · <project>` (the header, in the payload; iOS shows the manifest's `short_name` instead), the need as the title, what Victor must do as the body, and a last line "Quiet hours from …" or "until …" when hours are set |
| a need's rule | `push.mjs` `pushNeeds` | 69 | the same keys as `needprompt.ts` (`kind:id`, `stale` silent, `error:<source>`); a parity test in `needprompt.test.ts` keeps them equal |
| urgent | `push.mjs` | 69 | `blocked` and `gate` push at any hour (`Urgency: high`); the others push only inside the hours, else they are marked and wait in Needs |
| Snooze (Android, desktop) | `sw.js` | 69 | the notification's action posts `POST /push/snooze` for one hour. iOS shows no actions: a snooze there waits for task 67's swipe |
| the theme colours | `index.html` `<meta name="theme-color">` (two, `media` light and dark) | 69 | filled from `--ground` in `board.css` at each request |

## KEYS

| key | view | action | endpoint |
|---|---|---|---|
| `j` / `↓`, `k` / `↑` | Overview | select the next or previous lot | none |
| `w` / `c` / `t` | Overview | stage tab: workflow, changes, tests | none |
| `Enter` | Overview | open the lot's need in Review | none |
| `[` | Overview | fold the list | none |
| `g` | Overview | open the git tree | none |
| `p` | Overview | projects menu | `GET /boards` |
| `r` | Overview | request a change | `POST /change` |
| `z` then `m` | Overview | open Review | none |
| `Esc` | Review | back to the view you came from | none |
| `j` / `→`, `k` / `←` | Review | next card, previous card (`j` and `k` mean the same in both views: next, previous) | none |
| `,` / `.` | Review | change the file | none |
| `Enter` | Review | reply with a text | `POST /answer` (text) |
| `⌘Enter` | Review | send the recommended answer | `POST /answer` |
| `1` / `2` | Review | choose an option | `POST /answer` (label) |
| `a` / `c` / `r` | Review | approve, change, reject | `POST /gate` or `POST /plan` |
| `e` | Review | done | `POST /lot` |
| `y` | Review | copy the command | none |

| click | view | endpoint |
|---|---|---|
| `#ck-live` the live pill | Overview | `POST /run` |
| `#ck-pass` next pass | Overview | `POST /pass` |

## Failure states

| state | source | place on the page |
|---|---|---|
| Disconnected | EventSource `error` event | the live pill says "disconnected" |
| Silent | `isStale(Board.at)` | the pill says "silent Xm" and the stale need is in "Needs you" |
| Overseer error | `Board.error` (lot 36) | a red pill and the `.ck-banner` line in the lot pane |
| Judge gave no verdict | Need `judge` (lot 34) | a need card, and a quiet line in the lot pane |
| Budget reduce and stop | `budget.level` | the `.meter` and the budget need card |
| Plan incomplete | Need `incomplete` (lot 31) | a need card, and a lot badge on the lot row |

## Rules

- ETA per lot = `session.lotStartedAt + Board.pace`. Running lots only. Hidden when `pace` is absent.
- Points per lot = `lot.tokens × budget.spent / Σ tokens of the lots in the window`.
- Dropped: "duplicate branch" (no source), the per-step ETA (Victor, 2026-10-21), the test controls, the sample `#pj-menu` and `.ck-log` rows.
