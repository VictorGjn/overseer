// The run's orchestrator: Opus reads what the haiku fallacy check surfaced, with the plan and the
// agent's own words, and decides per flagged agent: let it be, steer it (a note the agent reads
// after its next tool result), ask the human, or propose stopping the run.
// Prompt and parser here; the plumbing (queue, budget, delivery) in register.tsx.

import type { Decision, Flag } from '../types'

export type Action = Decision['action']

export const OPUS_SYSTEM = `You orchestrate a multi-agent workflow run while it executes. A cheap checker flagged possible reasoning faults in some agents. You see the plan, each flagged agent's mission, its latest words, and the flags.
Some flagged agents are still running; others already finished, and their output may now feed agents that are running.
Decide per flagged agent ("about"), and act only when it matters for the run's outcome. "agent" is who you act on: the flagged agent itself if it is still running, or a RUNNING agent that builds on its output.
- "ignore": the flag is noise, minor, or the agent already handles it.
- "steer": the agent is about to build on something wrong or unverified. Write the short note it will read after its next tool result: what to check or correct, concretely. Never restate its whole mission.
- "ask_human": a decision only the human can take (scope, trade-off, irreversible effect). Write the question, and give up to 2 "options" (1-5 words each) besides "Let it run" and "Stop run", which are always offered.
- "stop_run": the run is heading somewhere useless or harmful and continuing wastes money. Say why.
Prefer "ignore". A flag is a hint, not a fact: read the agent's words before believing it.
Answer ONLY JSON: {"decisions":[{"about":"<flagged agent id>","agent":"<agent id to act on>","action":"ignore|steer|ask_human|stop_run","message":"<note to the agent, or question to the human; max 400 chars>","options":["<only for ask_human>"],"why":"<max 140 chars>"}]}`

export type Case = { agentId: string; label: string; mission: string; excerpt: string; flags: Flag[]; isRunning: boolean }

export function opusPrompt(run: { name: string; cards: { label: string; model: string; state: string }[]; decided: Decision[]; running: { id: string; label: string }[] }, cases: Case[]): string {
  return [
    `RUN: ${run.name}`,
    `PLAN (call sites, model, state):\n${run.cards.map(c => `- ${c.label} · ${c.model} · ${c.state}`).join('\n')}`,
    `RUNNING AGENTS YOU CAN STEER:\n${run.running.map(a => `- ${a.id} (${a.label})`).join('\n') || '- none: only ask_human, stop_run or ignore apply'}`,
    run.decided.length ? `ALREADY DECIDED THIS RUN (do not repeat a steer the agent already got):\n${run.decided.slice(-8).map(d => `- ${d.agent}: ${d.action} — ${d.message ?? d.why}`).join('\n')}` : '',
    ...cases.map(c => [
      `AGENT ${c.agentId} (${c.label}) · ${c.isRunning ? 'still running' : 'finished: its output is final'}`,
      `MISSION: ${c.mission.slice(0, 1500)}`,
      `LATEST WORDS: ${c.excerpt.slice(-2000)}`,
      `FLAGS:\n${c.flags.map(f => `- ${f.kind}${f.quote ? ` “${f.quote}”` : ''}: ${f.why}`).join('\n')}`,
    ].join('\n')),
  ].filter(Boolean).join('\n\n')
}

const ACTIONS: readonly Action[] = ['ignore', 'steer', 'ask_human', 'stop_run']

// Opus's reply, read defensively: the first JSON object, decisions with a known action, about an
// agent it was shown, acting on that agent or on one that is running (else back on the flagged one).
export function parseDecisions(text: string, aboutIds: readonly string[], runningIds: readonly string[] = []): { about: string; agentId: string; action: Action; message?: string; options?: string[]; why: string }[] {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return []
  try {
    const list = JSON.parse(m[0]).decisions
    return Array.isArray(list)
      ? list.map(d => (d && d.about === undefined ? { ...d, about: d.agent } : d))
        .filter(d => d && aboutIds.includes(d.about) && ACTIONS.includes(d.action))
        .map(d => ({
          about: String(d.about),
          agentId: [d.about, ...runningIds].includes(d.agent) ? String(d.agent) : String(d.about),
          action: d.action as Action,
          message: typeof d.message === 'string' ? d.message.slice(0, 500) : undefined,
          ...(d.action === 'ask_human' && Array.isArray(d.options) ? { options: d.options.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.slice(0, 40)).filter((x: string) => !/^(let it run|stop run)$/i.test(x)).slice(0, 2) } : {}),
          why: String(d.why ?? '').slice(0, 160),
        }))
      : []
  } catch {
    return []
  }
}

// What the steered agent reads after its next tool result.
export const steerNote = (message: string) =>
  `[Orchestrator (Opus), reviewing your reasoning mid-run] ${message}\nAddress this before you go on; if you already did, continue.`
