#!/usr/bin/env bash
# An empty config folder, this repo as the marketplace: marketplace add, install both plugins, `claude plugin list` shows exactly these 2.
# Everything runs with TYPESAFE_API_KEY unset (env -u): both plugins load and work without TypeSafe. The temp folder is removed at the end.
# CLAUDE_CONFIG_DIR is the throwaway folder, so the real ~/.claude is never touched.
set -uo pipefail
repo=$(cd "$(dirname "$0")" && pwd)
cfg=$(mktemp -d "${TMPDIR:-/tmp}/overseer-install.XXXXXX"); trap 'rm -rf "$cfg"' EXIT
bad=0
no() { echo "install ✘ $1"; bad=1; }
cc() { env -u TYPESAFE_API_KEY CLAUDE_CONFIG_DIR="$cfg" claude "$@"; }

[ -z "$(ls -A "$cfg")" ] || no 'the config folder is not empty at the start'
out=$(cc plugin marketplace add "$repo" 2>&1) || no "marketplace add failed: $out"
out=$(cc plugin install overseer@overseer 2>&1) || no "install overseer@overseer failed: $out"
out=$(cc plugin install workflow-gate@overseer 2>&1) || no "install workflow-gate@overseer failed: $out"
list=$(cc plugin list 2>&1)
[ "$(grep -c '^  ❯ ' <<<"$list")" = 2 ] || no "plugin list does not show exactly 2 plugins: $list"
grep -q '^  ❯ overseer@overseer' <<<"$list" || no 'overseer@overseer is not listed'
grep -q '^  ❯ workflow-gate@overseer' <<<"$list" || no 'workflow-gate@overseer is not listed'
[ "$(grep -c 'Status: ✔ enabled' <<<"$list")" = 2 ] || no 'the two plugins are not both enabled'

# Both plugins load with TYPESAFE_API_KEY unset: the manifests validate, the overseer's tests run, and the gate's hooks answer.
for m in plugins/overseer plugins/workflow-gate; do cc plugin validate "$repo/$m" >/dev/null 2>&1 || no "$m does not validate with TYPESAFE_API_KEY unset"; done
out=$(cc plugin test "$repo/plugins/overseer" 2>&1) || no "the overseer's tests fail with TYPESAFE_API_KEY unset: $(grep -E '^\(fail\)' <<<"$out" | head -3)"
hooks="$repo/plugins/workflow-gate/hooks/workflow-plan-gate.mjs"
home="$cfg/home"; mkdir -p "$home"
banner=$(echo '{"session_id":"s1","cwd":"'"$home"'","hook_event_name":"SessionStart"}' | env -u TYPESAFE_API_KEY HOME="$home" node "$hooks" session-start 2>&1)
grep -q 'workflow-gate is active' <<<"$banner" || no "the gate's SessionStart banner is missing without TYPESAFE_API_KEY: $banner"
deny=$(echo '{"session_id":"s1","cwd":"'"$home"'","hook_event_name":"PreToolUse","tool_name":"Workflow","tool_input":{"script":"export const meta={name:\"x\"}; await agent(\"hi\")"}}' | env -u TYPESAFE_API_KEY WORKFLOW_GATE_NO_UI=1 HOME="$home" node "$hooks" pre-tool 2>&1)
grep -q '"permissionDecision":"deny"' <<<"$deny" || no "the gate does not block an unapproved Workflow without TYPESAFE_API_KEY: $deny"

[ $bad -eq 0 ] && echo 'install ✔ clean config: marketplace add, 2 plugins installed and listed, both load with TYPESAFE_API_KEY unset'
exit $bad
