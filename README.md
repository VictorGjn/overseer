# Overseer

Overseer runs your project's `PLAN.md` through the Claude Code sessions you pick. It gives each session a task, judges the finished work against the plan, keeps a weekly-limit budget, answers what the sessions wait on and nudges the stalled ones. It never starts a session. A web board and a terminal pane show what needs you; `workflow-gate` makes you approve a `Workflow` plan before it runs, from the same board.

Two plugins, one marketplace: `overseer` and `workflow-gate`.

## Install

```
/plugin marketplace add VictorGjn/overseer
/plugin install overseer@overseer
/plugin install workflow-gate@overseer
```

Node 20+ must be on your `PATH` (the gate's hooks run `node`). [TypeSafe](https://typesafe.ai) is optional: without `TYPESAFE_API_KEY`, the features that use it are off and nothing fails.

## First run

Open Claude Code in a repository that has a `PLAN.md` (try `examples/sample-repo`), and in each session you want driven:

```
/oversee watch self     # pick the sessions the overseer drives (ids from /oversee)
/oversee plan <goal>    # have Claude write PLAN.md for a goal
/oversee run 15         # run the plan through them, with a budget of 15 weekly-limit points
/oversee show           # open the board
```

A `PLAN.md` is one `## [ ] N. Title` section per task, with a `done when:` line and optional `check:`, `depends:`, `model:` and `owner:` lines. When a session holds a workflow at the gate, approve it from the board or from the terminal.

## Full README

The full README (every command, the board, the budget, the gate) is in [docs/README-full.md](docs/README-full.md) (to come).

## Development

`./check.sh` validates and tests both plugins, scans for secrets and private data (`OVERSEER_DENYLIST=<file> ./check.sh` also scans for the names in that file) and installs both in an empty config folder.

## License

[MIT](LICENSE), copyright 2026 Victor Grosjean.
