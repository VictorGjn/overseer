// Shaped after real transcript records, trimmed to the fields tokens.ts reads:
// session: 5 consecutive assistant records of a main transcript (the first and last API calls
// are each split over 2 records sharing one message.id); subagent: 6 consecutive assistant records of a subagent transcript
// (<session>/subagents/agent-*.jsonl) (3 calls, split 3+2+1); wf: the wf_*.json of a workflow of that session.
// No text, tool input, path, session id or name is kept, and message ids are made up. The data starts on the line after `export default` (plain JSON, for jq).
export default
{
"session": [
{"type":"assistant","timestamp":"2026-10-07T07:16:39.505Z","message":{"id":"msg_000000000000000000000001","usage":{"input_tokens":2,"cache_creation_input_tokens":57228,"cache_read_input_tokens":32064,"output_tokens":214}}},
{"type":"assistant","timestamp":"2026-10-07T07:16:40.337Z","message":{"id":"msg_000000000000000000000001","usage":{"input_tokens":2,"cache_creation_input_tokens":57228,"cache_read_input_tokens":32064,"output_tokens":214}}},
{"type":"assistant","timestamp":"2026-10-07T07:16:43.661Z","message":{"id":"msg_000000000000000000000002","usage":{"input_tokens":2,"cache_creation_input_tokens":1339,"cache_read_input_tokens":89292,"output_tokens":221}}},
{"type":"assistant","timestamp":"2026-10-07T07:16:46.763Z","message":{"id":"msg_000000000000000000000003","usage":{"input_tokens":2,"cache_creation_input_tokens":1394,"cache_read_input_tokens":90631,"output_tokens":283}}},
{"type":"assistant","timestamp":"2026-10-07T07:16:48.245Z","message":{"id":"msg_000000000000000000000003","usage":{"input_tokens":2,"cache_creation_input_tokens":1394,"cache_read_input_tokens":90631,"output_tokens":283}}}
],
"subagent": [
{"type":"assistant","timestamp":"2026-10-19T20:29:26.488Z","message":{"id":"msg_000000000000000000000004","usage":{"input_tokens":10,"cache_creation_input_tokens":60407,"cache_read_input_tokens":0,"output_tokens":3}}},
{"type":"assistant","timestamp":"2026-10-19T20:29:26.736Z","message":{"id":"msg_000000000000000000000004","usage":{"input_tokens":10,"cache_creation_input_tokens":60407,"cache_read_input_tokens":0,"output_tokens":3}}},
{"type":"assistant","timestamp":"2026-10-19T20:29:27.456Z","message":{"id":"msg_000000000000000000000004","usage":{"input_tokens":10,"cache_creation_input_tokens":60407,"cache_read_input_tokens":0,"output_tokens":3}}},
{"type":"assistant","timestamp":"2026-10-19T20:29:46.233Z","message":{"id":"msg_000000000000000000000005","usage":{"input_tokens":8,"cache_creation_input_tokens":7047,"cache_read_input_tokens":60407,"output_tokens":1}}},
{"type":"assistant","timestamp":"2026-10-19T20:29:46.991Z","message":{"id":"msg_000000000000000000000005","usage":{"input_tokens":8,"cache_creation_input_tokens":7047,"cache_read_input_tokens":60407,"output_tokens":1}}},
{"type":"assistant","timestamp":"2026-10-19T20:29:52.506Z","message":{"id":"msg_000000000000000000000006","usage":{"input_tokens":8,"cache_creation_input_tokens":11036,"cache_read_input_tokens":67454,"output_tokens":1}}}
],
"wf":
{"startTime":1791388946015,"timestamp":"2026-10-07T20:08:16.552Z","totalTokens":480145,"status":"completed"}
}
