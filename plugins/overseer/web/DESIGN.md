# Overseer board: design system

Use this file for each new feature of the overseer board. Use the tokens and components below. Do not add a new color, size, radius or component if one here does the job.

## 1. Provenance

- Source: the artifact "Overseer Board v3" (https://claude.ai/artifact/7H2vsQ7wDFSgCjTzw6gRb3), version 35, 2026-10-22. The repo copy is `overseer/web/mockups/board-v3.html` (version 34, plus the lot 30 edits).
- Owner: Victor.
- Method: dembrandt, extract mode. We read the CSS of the page (48 KB), counted each value, and computed the WCAG contrast of each token pair.
- Source tag: all rows are `dom` (read from the page CSS), except the rows tagged `inferred`.
- Confidence: `verified` means the value is a token or is used 5 times or more. `observed` means the value is used 1 to 4 times. `inferred` means a rule that we derived from the source but that the source does not state.

**Design read.** The page is a dense desktop tool for one founder who supervises AI coding sessions. The style is "Swiss Industrial": a neutral ground with a violet tint, one warm action color, mono text for figures and codes, flat surfaces with hairlines, and almost no shadow. The page has two views only: Overview and Review. The density is Lean only.

## 2. Tokens

All colors are OKLCH. The neutrals have hue 285 and a small chroma, so the grays have a cool violet tint. Each token has a light value and a dark value. Use the tokens only. Never write a literal color in a component rule.

### Color: surfaces and ink

| Role | Token | Light | Dark | Use | Confidence |
|---|---|---|---|---|---|
| Page ground | `--ground` | `oklch(0.985 0.004 285)` | `oklch(0.17 0.01 285)` | Page, cards, buttons at rest | verified |
| Raised surface | `--raised` | `oklch(0.965 0.006 285)` | `oklch(0.21 0.012 285)` | Hover, selected row, segmented control track, top bar groups | verified |
| Hairline | `--line` | `oklch(0.90 0.008 285)` | `oklch(0.29 0.012 285)` | All borders and dividers; empty meter track | verified |
| Text | `--ink` | `oklch(0.24 0.02 285)` | `oklch(0.94 0.008 285)` | Titles, values, selected text | verified |
| Text, second level | `--ink-2` | `oklch(0.46 0.018 285)` | `oklch(0.74 0.012 285)` | Body text, labels, captions that must be read | verified |
| Text, third level | `--ink-3` | `oklch(0.60 0.014 285)` | `oklch(0.60 0.012 285)` | Metadata, eyebrows, counts. See the contrast note. | verified |
| Not started | `--todo` | `oklch(0.86 0.01 285)` | `oklch(0.34 0.012 285)` | Empty progress beads, steps that did not start | verified |

### Color: status (one color, one meaning)

| Meaning | Token | Light | Dark | Soft fill | Use |
|---|---|---|---|---|---|
| Brand, live work | `--accent` | `oklch(0.52 0.12 290)` | `oklch(0.78 0.09 290)` | — | Focus ring, running lot (rail, status icon), progress ring arc |
| Victor must act | `--act` | `oklch(0.58 0.15 32)` | `oklch(0.74 0.13 32)` | `--act-soft` `0.95 0.03 32` / `0.26 0.04 32` | The one primary button ("Review what needs you"), alerts, failed steps |
| Waits, gaps | `--watch` | `oklch(0.66 0.12 78)` | `oklch(0.80 0.11 82)` | `--watch-soft` `0.96 0.03 85` / `0.25 0.03 82` | A lot that waits for an answer, a criterion with a gap, live off, files not committed |
| Ready, met | `--done` | `oklch(0.58 0.10 155)` | `oklch(0.76 0.10 155)` | — | Ready lot, met criterion, live dot |
| Finished, quiet | `--done-quiet` | `oklch(0.56 0.05 155)` | `oklch(0.74 0.05 155)` | — | A delivered lot. It is calm, so finished work does not pull the eye. |

### Color: git tree lanes

Each lot gets its own hue: `oklch(var(--gt-l) var(--gt-c) H)`, with `H = round(lot × 137.5) mod 360` (the golden angle, so lots next to each other get far hues).

| Token | Light | Dark |
|---|---|---|
| `--gt-l` | 0.60 | 0.76 |
| `--gt-c` | 0.14 | 0.12 |

### Shadows

The page is flat. Use a shadow only for these 4 cases:

| Role | Value | Use | Confidence |
|---|---|---|---|
| Pressed segment | `0 1px 2px oklch(0 0 0 / .12)` | The selected button in `.seg` | observed |
| Card that floats | `0 1px 2px oklch(0 0 0 / .05), 0 10px 30px oklch(0 0 0 / .07)` | The Review card (`.zcard`) | observed |
| Menu | `0 14px 40px oklch(0 0 0 / .18)` | The project menu | observed |
| Dialog | `0 20px 60px oklch(0 0 0 / .25)` | A modal | observed |

To show selection, use a ring and not a shadow: `inset 0 0 0 1px var(--line)` for a selected row, `inset 0 0 0 1px var(--ink-2)` for a pressed stage button, `0 0 0 1.5px var(--ground), 0 0 0 3px var(--ink)` for the current rail segment.

### Motion

| Role | Value | Confidence |
|---|---|---|
| Live dot | `pulse 2.4s ease-in-out infinite`, only under `prefers-reduced-motion: no-preference` | verified |
| Review card leaves | `transform .22s ease, opacity .22s ease` (`.zcard.peel`: up 16px, scale .98, fade) | observed |
| Reduced motion | `prefers-reduced-motion: reduce` turns off the transition and the pulse | verified |

## 3. Type ramp

Two families from Google Fonts: **Geist** (400, 500, 600) for text, and **Geist Mono** (400, 500) for figures, codes, branch names, model names and keys. The page body is `15px/1.55 var(--sans)`.

The source uses 13 sizes from 10.5px to 28px, many of them half steps. For new work, use only the 8 steps below. Each step is the size that the source uses most for that role.

| Role | Size / line height | Weight | Family | Tracking | Example in the source | Confidence |
|---|---|---|---|---|---|---|
| Display | 28px / 1.25 | 500 | sans | -.02em | Review card title | observed |
| Project name | 22px / 1.15 | 650 | sans | -.02em | `.pj-name` | observed |
| Lot title | 22px / 1.25 | 600 | sans | -.015em | `.ck-mh h2`, with `text-wrap: balance` | observed |
| Section title | 16px / 1.3 | 600 | sans | -.005em | `.risk .eyebrow` | observed |
| Body | 14px / 1.45 | 400–500 | sans | 0 | Step names, need titles, the primary button | verified |
| Small | 13px / 1.4 | 400–500 | sans | 0 | List rows, chips, segmented control | verified |
| Caption | 12px / 1.4 | 400 | sans or mono | 0 | Row metadata, HUD captions | verified |
| Eyebrow | 11.5px / 1 | 500 | mono | .06em, uppercase | `.eyebrow`, `.zkind b`, `.ck-need .kind` | verified |

Figures that change (timers, counts, points) use `font-variant-numeric: tabular-nums`, so the line does not move.

## 4. Spacing, radius and layout

### Spacing

The base unit is 2px. Use these steps for `gap` and `padding`: **2, 4, 6, 8, 10, 12, 14, 16, 18, 24, 28**. The source uses 8px and 6px most (gap ×21 and ×18). Put space between items with `gap` in flex or grid, not with margins.

### Radius

| Family | Radius | Use | Confidence |
|---|---|---|---|
| Pill | 999px | Segmented control, chips | verified |
| Circle | 50% | Dots, status glyph ground, step beads | verified |
| Card | 16px | Review card | observed |
| Group | 12px | Top bar groups (`.ck-run`), list rows, the primary button, `.stat` | verified |
| Control | 10px | Pager buttons, project button | verified |
| Small control | 8px | `.ck-go`, `.ck-more`, HUD rows, `.ck-fold` | verified |
| Tag | 6px, 5px for `kbd` | Chips in text, keys, focus ring | observed |
| Bar | 3–4px | Rail segments, meters, HUD bars | verified |

The source also has 7, 9, 11 and 14px once each. Do not use them in new work.

### Layout

- `.ck` is a fixed full-screen grid. Lean: `280px | minmax(0,1fr) | 260px` (list, main, HUD). Rows: top bar, rail, then the content, which fills the rest.
- The list, the main column and the HUD each scroll on their own (`overflow-y: auto; min-height: 0; overscroll-behavior: contain`). The page itself does not scroll.
- The main column content stops at `max-width: 900px`.
- Breakpoints: 1600, 1281 (min), 1100, 700, 620 and 600px. Captions show only below 1280px.
- Dividers are `1px solid var(--line)`, never a shadow.

## 5. Components

Every interactive element has these states. Add all of them to a new component.

| State | Rule |
|---|---|
| Rest | `--ground` fill, `1px solid var(--line)` border, `--ink-2` text |
| Hover | `--raised` fill, or the border goes to `--ink-3` and the text to `--ink` |
| Pressed / selected | `aria-pressed="true"` or `aria-current="true"`: a ring in `--ink-2`, or `--raised` fill with an inset `--line` ring |
| Focus | `outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 6px` on `button`, `summary` and `a` (`:focus-visible`) |
| Disabled | `opacity: .4; cursor: default` |

### Primary button: `.ck-review`

One per page. `--act` fill, `--ground` text, 14px weight 600, radius 12px, height 44px, a count `.badge` (24px circle, `--ground` fill, `--act` text, mono 13px) and its keys in `kbd`. When nothing needs Victor, use `.ck-review.none`: `--raised` fill, `--ink-2` text, a `--line` border.

### Secondary button: `.ck-go`

`--ground` fill, `--line` border, radius 8px, padding `5px 10px`, an icon with gap 6px. Use it for each action in a need line or a HUD row ("Review it", "Request a change").

### Segmented control: `.seg`

A pill track in `--raised` with a `--line` border and 3px padding. Each button is a pill with padding `6px 14px` and a height of 36px (34px in the top bar). The selected button has `--ground` fill, `--ink` text and the pressed-segment shadow. Use it for Overview / Review.

### Stat: `.stat`

A figure with a caption: a `b` value at 13.5px weight 600 over a `small` caption at 11px in `--ink-3`. In the top bar, stats sit in one `.ck-run` group (radius 12px, `--raised`, dividers between stats, height 44px). The live stat has a pulsing `.dot`. When live is off, the stat gets `--watch-soft` fill.

### Meter: `.meter` and `.ring`

- `.meter`: 56 × 8px, radius 4px, `--line` track, `--ink-2` fill. `.meter.half` draws a mark at 50% (the budget step-down point).
- `.ring`: a 22px SVG circle, stroke 3, `--line` track, `--accent` arc. Use it for "next pass in".

### Status icon: `.sico`

A 20px line icon (16px in rows), stroke 2, round caps and joins. The color gives the status:

| Class | Color | Symbol |
|---|---|---|
| `.run` | `--accent` | `i-st-run` (half disc) |
| `.wait` | `--watch` | `i-st-wait` |
| `.ready` | `--done` | `i-st-ready` |
| `.done` | `--done-quiet` | `i-st-done` (check) |
| `.act` | `--act` | `i-st-alert` |
| `.todo` | `--ink-3` | `i-st-todo` (dashed circle) |

Workflow symbols: `i-think`, `i-build`, `i-test`, `i-verify`, `i-gate`, `i-fix`, `i-commit`, `i-loop`, `i-par`, `i-alert`, `i-check`. Draw a new icon in the same style: a 24px grid, stroke 2, no fill.

### List row: `.ck-row`

A grid `26px | 1fr | auto`, radius 12px. A 26px round glyph ground for the status icon, a title in `b` and a caption in `small`. Hover: `--raised`. Current: `--raised` with an inset `--line` ring. `.ck-row.small` is for folded and done lots: 13px weight 400 in `--ink-2`.

### Section header: `.ck-sec`

12.5px weight 600 in `--ink`, with a mono count at the right in `--ink-3`. `.ck-fold` makes it a button that folds the section.

### Rail: `.ck-rail` and `.rl`

One bar per lot, 8px high, radius 3px. Fill by status: done = `--ink-3` 55% mixed into `--line`, run = `--accent`, ready = `--done`, act = `--act`, wait = `--watch-soft` with an inset `--watch` ring, todo = a dashed `--ink-3` border. The open lots grow (`flex-grow: 6`). A mono caption sits under each bar (11.5px, `--ink-2`, ellipsis).

### Stage buttons: `.fun`

A grid of equal buttons (Workflow, Changes, Tests), radius 12px, `--line` border, padding 10px. Each button has a status icon, a name at 13px weight 600 and its key in `kbd`. Pressed: an `--ink-2` ring.

### Workflow step: `.wstep`

A `details` element. The `summary` is a grid `32px | 1fr | auto | auto`: a bead, the step name (14px weight 500) with its goal under it (12.5px `--ink-3`, one line), a model badge, and a time. The bead is a 32px circle with a 1.5px border: done = `--done`, run = `--watch` on `--watch-soft`, fail = `--act`. A gate step has a square bead (radius 9px, scale .8).

### Need line: `.ck-ask`

One quiet line: a 16px `--act` icon, the need in 13.5px `--ink-2`, and a `.ck-go` button at the right. Use it in place of a card when the page must stay calm.

### Need card: `.ck-need`

A bordered button, radius 12px. A kind eyebrow (mono 10.5px, uppercase), a title in `b` (14px weight 500), a next step in `small` (12px `--ink-3`, prefix "→ "), and a mono reference. A done need gets `opacity: .5` and a "✓ " prefix.

### Chip: `.chip`

A pill with a `--line` border, padding `6px 12px`, 13px. `.chip .kind` is a mono uppercase label. Selected: an `--ink-2` border. Done: `opacity: .55` and "✓ ".

### Key: `kbd`

Mono 11.5px weight 500, a `currentColor` border, radius 5px, padding `1px 6px`, a minimum width of 22px, `opacity: .75`. Show the key on each button that has a keyboard shortcut.

### Review card: `.zcard`

The one floating card of the Review view: radius 16px, padding 28px (18px on a phone), the card shadow. Progress above it is a row of `.zprog` beads (36 × 6px): `--todo`, current `--ink-2`, done `--done`.

### HUD: `.ck-hud`

The right column, gap 18px. Sections (`.hud-sec`) have a header at 13px weight 600 with a mono count. `.hud-kv` shows large figures (mono 18px weight 600). `.hud-bar` shows criteria as 6px segments: met `--done`, gap `--watch`, open `--line`. `.hud-row` and `.hud-files` are buttons that open the detail.

### Git tree: `.gtree`

An SVG in a box that scrolls on the x axis. Edges have stroke 2 in the lane hue. A commit is a circle with a 2px `--ground` stroke, so it cuts the edge.

### Empty and missing data

- `.ck-empty`: padding 48px 0, 15px, `--ink-2`, one sentence that says what to do next.
- `.nx`: "Not exported yet", italic, in `--ink-3`. Use it for each field that the board does not export yet. Never show sample data in its place.

## 6. Imagery

The page has no photographs and no illustrations. Data is the image: the rail, the git tree, meters, beads and status icons. All icons are line icons drawn in the page (`<symbol>`), with no icon library.

## 7. Gaps and defects

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | blocker | In light mode, `--ground` text on `--act` gives 4.40:1. The primary button text is 14px weight 600, so it needs 4.5:1. | Set light `--act` to `oklch(0.56 0.15 32)`: 4.78:1 (measured). |
| 2 | fix | Light `--ink-3` on `--ground` gives 3.79:1, and the source uses it for 11–12px captions (WCAG needs 4.5:1). Dark gives 4.84:1. | Set light `--ink-3` to `oklch(0.54 0.014 285)`: 4.86:1 on `--ground` and 4.58:1 on `--raised` (measured). Or use `--ink-2` for captions that must be read. |
| 3 | fix | Light `--watch` (3.02:1) and `--done` (3.91:1) are text colors in some places (`.hud-files em`, `.rl small .a`). They are good for icons and bars (3:1), but not for small text. | Use them for icons, bars and borders only. Put the text in `--ink-2`, next to a colored icon. |
| 4 | fix | "Running" has two colors: `--accent` in the rail and the status icons, but `--watch` in a workflow step bead. This breaks "one color, one meaning". | Make the running bead `--accent` (with an `--accent` soft fill), and keep `--watch` for "waits". |
| 5 | fix | 13 font sizes and 17 radii. | Use the ramp in section 3 and the radii in section 4 for new work. Merge the old values when a lot touches that component. |
| 6 | nit | `--line` borders give 1.29:1. This is correct for dividers. A control that has only a border to show its edge needs 3:1. | Every control here also has a label and a hover fill, so no change is necessary now. Do not make a control whose border is its only sign. |
| 7 | gap, inferred | The body text is 13–14px, but dembrandt asks for 16px or more. This is a dense desktop tool, so the smaller size is a deliberate choice. Keep it. | Do not go below 12px for text that must be read. |
| 8 | gap | The source shows no input field, no toast and no error banner. | When a lot needs one, use the `.ck-go` shape (radius 8px, `--line` border, `--ground` fill) for inputs, and the `.ck-ask` line for errors (an `--act` icon, the text and the recovery action). |
| 9 | defect, lot 30 | `#empty` on `lot/30-v3-contract` throws at the rail scroll (`.rl.open` is missing), so `.ck-empty` never shows. | The lot 30 retry fixes it. |

## 8. Hand-off for new features

For a new feature:

1. Use the tokens in section 2. If you need a new status, first check if it is one of the 5 meanings. If it is a new meaning, ask Victor before you add a color.
2. Use the type ramp in section 3 and the spacing and radius steps in section 4.
3. Build from the components in section 5, with all 5 states.
4. Show "Not exported yet" (`.nx`) for each field that the board does not export.
5. Test the feature in both themes, at 1440px and at 400px, and with the keyboard only.
