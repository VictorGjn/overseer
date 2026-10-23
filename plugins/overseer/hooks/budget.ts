// The run's budget in points of the weekly limit (task 71). The limit resets by itself: its usage then falls below what the run saw last, and
// `weeklyNow - weeklyAt` would be negative (-86 of 24 on 2026-10-23), which hid the step-down. The points spent before a reset are kept (`carried`),
// and counting goes on from the new usage.
export type RunBudget = { weeklyAt: number; weeklyNow: number; carried?: number }
export const spentOf = (r: RunBudget) => (r.carried ?? 0) + Math.max(0, r.weeklyNow - r.weeklyAt)
// The run's budget fields after reading the weekly usage `w`: a reset (usage below the last reading) restarts the count from `w`.
export const rebase = (r: RunBudget, w: number): RunBudget => (w < r.weeklyNow ? { weeklyAt: w, weeklyNow: w, carried: spentOf(r) } : { weeklyAt: r.weeklyAt, weeklyNow: w, ...(r.carried !== undefined ? { carried: r.carried } : {}) })
