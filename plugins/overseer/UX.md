# Overseer UX

What the overseer shows, where, and when. The goal is less brain fry, not more data: the person should know in two seconds whether anything needs them, and act without reading a session's output. Colours, glyphs and motion come from `../DESIGN.md`; this file says what goes on screen. Ideas not yet chosen (v2 screens, prioritising the plan, signals from ccorbit) live in `EXPLORE.md` until they are prioritised.

The eight questions the board answers (from a LinkedIn post, 2026-10-19):

| # | Question | Answered by |
|---|---|---|
| Q1 | Which task is this agent on, and is it the one that matters most? | session row, lot order |
| Q2 | What is the task's outcome, without reading the session? | verdict line |
| Q3 | Is it stuck, or is the task unclear? | stage glyph, decision card |
| Q4 | What waits on me, what does each one block, what does the agent recommend? | decision card |
| Q5 | What did a task cost? | deferred |
| Q6 | What was decided and why; can a fresh session pick it up? | `DECISIONS.md` |
| Q7 | When is it done, and who checks? | done-when line |
| Q8 | If I closed every session now, what would be lost? | at-risk line |

## Rules

1. **One ladder, three rungs.** Each rung answers less, faster:
   - The **band** is for a glance: one line, either the next action or "nothing needs you".
   - The **pane** is for acting: the focus block, with everything else folded.
   - The **web board** is for inspecting: the full detail, still folded by default.
2. **Calm is empty.** When nothing needs the person, the band is one muted line, and the pane shows the focus block plus folded sections.
3. **One home per fact, per surface.** A waiting question appears once: in the decision card. It is not repeated in a tile, a list and a session card.
4. **Coral means you act.** `alert` only colours a row that names the action the person takes. `warn` is for watch, no action. `muted` is for everything else, and `ok` is for done. A heuristic is `warn` until it has lasted long enough to be worth an action. `stuck` is already past that point since lot 9: it needs a call of at least 5 min and 8× its usual time, or a loop, so it is `alert`.
5. **Verdicts, not logs.** Raw session text (`lastText`) is never shown by default. It lives one click down, on the web board only.
6. **Five items per zone, one line each.** Truncate at the end, and put the rest one level down ("+3 more").
7. **Interrupt only for a new need.** A toast fires once per item for:
   - a session that `waits`;
   - a lot `blocked`;
   - budget `stop`;
   - an overseer error or a refused message.

   Assign, done, retry and judge go to the log only. `note()` enforces it (`register.tsx:62`); a repeat within 10 min shows once with a count (`×3`).
8. **A stable layout.** Sections never reorder. A new item gets one `halo` (`slow`, 420 ms) and then settles. Nothing loops in a calm state; comets stay inside the lots graph.
9. **Concrete words.** Write "waited 6m00" and "blocks lots 4, 7", not "pending" or "some dependencies".

## Token rules

The overseer must stay cheap to run.

- **The board makes no model call.** Every line on any surface is computed by code from text that already exists:
  - the judge's `note`;
  - the session's own `[lot N done/blocked: …]` line;
  - its `[ask: …]` line;
  - git;
  - the plan.
- **The judge stays the only model call**: `$.model.complete`, `leadModel`, `maxTokens: 800`, once per finished lot and once per retry.
- **A rule added to the sessions costs once per session.** `SESSION_RULES` only goes out with a session's first lot (`lotMessage(…, first)`). Each addition is one line.
- **Decisions do not go in `PLAN.md`.** The judge reads `PLAN.md` on every verdict (`projectContext`, 12000 chars). They go in `DECISIONS.md`, which no prompt reads.
- **Possible saving (not done):** `projectContext` sends the whole `PLAN.md` to each verdict. Sending only the lot and the lots it depends on would cut most of the judge's input.
- **No more redraws than now.** The board is rebuilt once per pass, every 3 min. The web page moves its relative times on its own, every 30 s.

## Band above the prompt

| Element | Shows when | Form | Change from today |
|---|---|---|---|
| Closed line, needs | ≥ 1 need | `▶ <next action> · +N more` in `alert`, then nothing else | Drop lots, working/free, workflows and points from this state: one thing to read |
| Closed line, calm | no need | `✓ 3/9 lots · 2 working · next pass 14:32`, muted | Points only when the level is not `normal`. Workflows and free count move to the pane |
| Closed line, error | overseer error or refused message | `✗ <what failed> · <what to do>` in `alert` | Same as today, but it replaces the line instead of being appended |
| Open detail | band opened | At most 5 lines: up to 3 needs, then one progress line (`▰▱ 3/9 · 1 blocked`), then one line for the working sessions (`◑ worker-8f lot 2 · worker-a1 lot 3`) | Drop one row per session and the 2 feed lines: the pane holds them |
| Actions | always | `Board (b)`, `Pass now` | Same |

## Board pane (terminal and desktop)

The pane runs top to bottom in a fixed order. Folded means behind `More (f)`.

| Element | Q | Shows when | Form | Change from today |
|---|---|---|---|---|
| Header | — | always | chip, goal, `Pass now` `Log` `More`. Meta: next pass, or `silent 12 min · is the overseer on?` in `warn` | Same |
| Focus | Q3 Q4 | always | `▶ NEXT` (the first need, as a decision card when it is a question), `● NOW` (state, ETA), `✓ DONE` (≤ 3 wins), `THEN` (≤ 3) | Becomes the only home of the needs: the separate `need` block (`register.tsx:760`) goes |
| Decision card | Q4 | `NEXT` is a waiting question | Up to 4 lines (layout below) | New |
| Progress | — | a run exists | one line: `▰▱` gauge, `3/9 lots`, counts per status | Budget joins it only when its level is not `normal`, or in More |
| Sessions | Q1 Q3 | always, 1 line each | `◑ worker-8f · lot 2 Escort route · 12m`. Free sessions go together on one line: `○ free: worker-a1, worker-c3`. A waiting or stuck session shows its glyph and `→ NEXT`, not the question again | Drop `lastText` and notes from rows, except the reason a session gets no lot |
| Lots | Q1 Q2 Q7 | a plan exists | Open lots first: `◐ 2 Escort route · done when: tests pass on escort.spec` (running), `! 7 …: <note>` (blocked), the next 3 todo. Done lots on one line: `✓ 5 done` | Done-when on running lots; verdict on done lots in More |
| Lots graph | — | More, or zoom `wide` | Raster or Svg as today | Folded by default |
| Workflows | — | ≥ 1 active | one line each: name, `▰▱ 4/7`, phase | Finished runs hidden |
| Branches | Q8 | always, 1 line | `3 branches ahead · 1 conflict (a.ts) · 2 worktrees with 5 uncommitted files`, conflict in `warn` | The graph and the worktree tree fold behind More |
| At risk | Q8 | something at risk | one line (definition below) | New |
| Log | Q6 | `Log (l)` | ≤ 12 rows | Same; it also receives what no longer toasts |

Decision card layout:

```
▶ NEXT  Answer worker-8f (lot 2): “Keep the legacy route?”
        recommends: keep it, behind a flag — the mobile app still calls it
        blocks: lots 4, 7 · waited 6m00
```

- Line 2 comes from the session's `[ask: … | recommend: …]` line. When the session wrote none, line 2 is left out; it is never invented.
- Line 3 is computed: the lots that depend on this lot, directly or not, through `depends`.

## Web board (`web/index.html`)

The web board is for inspecting and for the morning review. It is read-only: answering happens in the session. Use native `<details>` for every fold, and remember which ones are open in `localStorage` (inside try/catch). In a calm state it fits one screen above the fold.

| Element | Q | Shows when | Form | Change from today |
|---|---|---|---|---|
| Status line | — | always | `3/9 lots · 2 working · 1 free · next pass 14:32` and the live / silent / disconnected pill | Replaces the 7 tiles: they repeated the band and the focus |
| Focus | Q3 Q4 | always | the pane's focus block, decision cards included, full width | Replaces the separate Needs panel and the `.ask` boxes on the cards |
| Lots table | Q1 Q2 Q7 | a plan exists | one row per lot: glyph, title, owner, done when (1 line), verdict (1 line), age. Open lots first, done lots in a `<details>` | Replaces the plain list. Clicking a row opens the judge's full note, the lot body and the check output tail |
| Lots graph | — | folded | `<details>Graph</details>` around the shadow-root SVG | Folded by default |
| Sessions | Q1 Q3 | always | compact rows like the pane's, `lastText` in a `<details>` per row | Cards become rows; the session text is one click down |
| At risk | Q8 | something at risk | one panel, `warn`, its lines (definition below) | New |
| Branches | Q8 | always | one summary line; the SVG in a `<details>`, open by default only when there is a conflict | Folded by default |
| Workflows | — | ≥ 1 active | active runs with a bar; finished ones in a `<details>` | Finished runs hidden |
| Decisions | Q6 | `DECISIONS.md` exists | the last 5, the rest in a `<details>` | New |
| Feed | Q6 | always | `<details>` whose summary shows the last 2 entries | Folded by default |
| Wins | — | — | in the focus `DONE` row | The separate "Done in the last 12 h" panel goes |

## Elements to build

| Element | Q | Data, and where it comes from | Tokens | Surfaces |
|---|---|---|---|---|
| Verdict line | Q2 | `v.note` from the judge (`register.tsx:215`), kept on the lot as `verdict`, `verdictAt` and exported in `Board.lots` | 0 (already produced) | pane (More), web |
| Done-when line | Q7 | `doneWhen` and `check` from `PLAN.md`, added to the `Board.lots` pick | 0 | pane, web |
| Decision card | Q4 | `question` (peers.ts), `recommend` from the session's `[ask: <question> \| recommend: <option> — <why>]`, `blocks` from `depends` | one line in `SESSION_RULES`, once per session | band (NEXT only), pane, web |
| Decisions record | Q6 | when a session that waited gets a user message (peers.ts already sees it, line 63): append `date · lot · question · answer (200 chars)` to `DECISIONS.md` | 0 | web, pane Log |
| At risk | Q8 | uncommitted files per worktree (`dirty`), active workflows and their running agents, sessions in `work` with no commit since their lot started. Local commits are not at risk: closing a session keeps its branch | 0 | pane, web |
| Why this lot | Q1 | plan order and the count of lots it unblocks: `next in plan · unblocks 2` | 0 | pane, web (lot row) |
| Toast policy (done) | — | `note()` toasts only the kinds in rule 7, once per item | 0 | all |
| Cost per lot | Q5 | deferred. The weekly limit is account-wide and cannot be split between parallel sessions; `$.session.usage()` gives no tokens per session as used today | — | — |

Order to build, the biggest relief for the smallest diff first:

1. toast policy and the band's two states;
2. one home per fact (pane: the needs into the focus; web: tiles and panels out, `<details>` in);
3. verdict line and done-when line;
4. decision card;
5. at risk;
6. decisions record.
