// Recorded on 2026-10-22 from the grill run wf_27f3d994-fb9 of 2026-10-21 (read only), trimmed to the fields steps.ts reads:
// agentHead: the `api-request` and `api-request-blob` records of one agent (model claude-sonnet-5-5, effort high, set by agent()
// with no model: the real model is in api-request.params), with the time of its first record; agentTail: its last record time;
// doneRun: the run's wf_*.json without its script and report; journal: the first lines of its journal.jsonl (4 reviewers of the
// phase Grill started together, one returned).
// SYNTHETIC: the `user` record's Goal/How/Out lines (the real prompts of 2026-10-21 had none; the plan format that asks for them is
// new), the labels `test-1` .. `test-2` and `fix-1` of `loop`, and the gate file `gate` (a real active/<sid>.json holds only the
// hook path and version; the `pending` status and the agents come from the lot's description).
export default {
  agentHead: [
    '{"type":"user","timestamp":"2026-10-21T19:24:03.573Z","message":{"role":"user","content":"[Workflow harness — computed task]\\n    Goal: find the controls with no endpoint\\n    How: read board-v3.html and CONTRACT.md\\n    Out: a list of findings, one line each"}}',
    '{"type":"api-request-blob","message":{"role":"system","output_config":{"effort":"high"}}}',
    '{"type":"api-request","timestamp":"2026-10-21T19:24:03.633Z","params":{"model":"claude-sonnet-5-5","output_config":{"effort":"high"}}}',
  ].join('\n'),
  agentTail: '{"type":"assistant","timestamp":"2026-10-21T19:29:13.871Z"}',
  doneRun: { runId: 'wf_27f3d994-fb9', timestamp: '2026-10-21T19:43:44.961Z', result: "{'counts': {'total': 48, 'kept': 47}, 'report': '# Plan review: lots 29 to 44 of the overseer board v3, 47 findings kept, grouped by lens', 'agentCount': '9'}", durationMs: 1183312, status: 'completed', startTime: 1792610641635, defaultModel: 'claude-opus-5-5' },
  journal: [
    '{"type":"launched"}',
    '{"type":"started","agentId":"aaabca984dabd50a4","label":"grill:enablers","phase":"Grill"}',
    '{"type":"started","agentId":"a26854fefbe48cbb2","label":"grill:controls","phase":"Grill"}',
    '{"type":"started","agentId":"ad89904863f28e902","label":"grill:daily","phase":"Grill"}',
    '{"type":"result","agentId":"aaabca984dabd50a4","result":{"ok":true}}',
  ].join('\n'),
  loop: [
    '{"type":"started","agentId":"b1","label":"build-1","phase":"Loop"}',
    '{"type":"result","agentId":"b1","result":{}}',
    '{"type":"started","agentId":"t1","label":"test-1","phase":"Loop"}',
    '{"type":"result","agentId":"t1","result":{}}',
    '{"type":"started","agentId":"f1","label":"fix-1","phase":"Loop"}',
    '{"type":"result","agentId":"f1","result":{}}',
    '{"type":"started","agentId":"t2","label":"test-2","phase":"Loop"}',
  ].join('\n'),
  gate: { status: 'pending', name: 'grill-board-v3-plan', hook: '/p/hooks/workflow-plan-gate.mjs', version: '2.0.0', agents: [{ label: 'think', model: 'opus' }, { label: 'build', model: 'sonnet' }, { label: 'test', model: 'haiku' }] },
}
