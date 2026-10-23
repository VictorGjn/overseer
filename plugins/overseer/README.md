# overseer

Project lead for the Claude Code sessions you pick. It never starts or stops one.

| Command | What it does |
|---|---|
| `/oversee` | lists the sessions active in the last hour |
| `/oversee watch <id>` / `drop <id>` | picks the sessions it drives (`self` is this one) |
| `/oversee plan <goal>` | has Claude write `PLAN.md`: tasks with "done when", model, dependencies |
| `/oversee run [budget pts]` | gives each free session the next task. Opus judges a task when its session ends with `[lot N done]`. The weekly-limit budget steps models down at half and stops new tasks at the end |
| `/oversee status` | prints the tasks and the budget as a table |
| `/oversee show` | opens the live board: the tasks as a dependency graph with a lane per session, and the budget curve (a compact list under 60 columns on the terminal) |
| `/oversee focus` | says the one next action |
| `/oversee merge [go]` | trial-merges the branches |
| `/oversee log`, `/oversee off` | the log; stop |

The same board runs in a browser tab: `node plugins/overseer/web/server.mjs`, then http://127.0.0.1:4318 (localhost only, live over SSE from `~/.claude/overseer/boards/`, one board per repository, with a picker when there are several). `/oversee show` opens it with the board token; every page and request asks for it (only `/version` does not). With it the board can approve, change or reject a watched session's workflow; the lead checks each request before it acts. Approving needs the `workflow-gate` plugin of this marketplace.

`/oversee phone` puts the board on your phone through Tailscale (`tailscale serve`, your tailnet only, never a public tunnel) and draws a QR code of the login link in a pane; `/oversee phone off` stops it. The Mac must stay awake for the phone to reach it: keep `caffeinate -s` running in a terminal, or in System Settings → Energy (Battery on a laptop) turn on "Prevent automatic sleeping when the display is off" while on power.

TypeSafe (Jev) is optional: without `TYPESAFE_API_KEY` the features that use it are off and nothing fails.
