#!/usr/bin/env bash
# Validate and test both plugins, then type-check overseer against the types Claude Code generates. Exit 0 = everything holds.
#   UPDATE_GOLDEN=1 ./check.sh        rewrite the reference screens a test found changed
#   OVERSEER_DENYLIST=<file> ./check.sh   also scan for the names in that file (keep the file outside the repo)
set -uo pipefail
cd "$(dirname "$0")"
fail=0
unset TYPESAFE_API_KEY # TypeSafe (Jev) is optional: nothing here may need it, or call it
# check-watch.sh runs each test file: after 5 min on one it prints a diagnostic (to fd 3, our terminal), after 20 min it stops that one and the next runs.
# CHECK_WARN_SECS and CHECK_KILL_SECS change the two limits.
exec 3>&2

# Types first (they come from the real config folder), then every claude command runs in a throwaway one: this script never writes to ~/.claude.
real_cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
tmp=$(mktemp -d "${TMPDIR:-/tmp}/overseer-check.XXXXXX"); trap 'rm -rf "$tmp"' EXIT
export CLAUDE_CONFIG_DIR="$tmp/cfg" CHECK_STUCK_DIR="$tmp/stuck"; mkdir -p "$CLAUDE_CONFIG_DIR"
command -v claude >/dev/null || { echo 'claude ✘ the claude command is not on PATH'; exit 1; }

# The shared files (band.tsx, kit/*) are frozen: overseer's copies must match the committed list, byte for byte, and nothing else may sit in kit/.
set_=$(cd plugins/overseer/hooks && { echo band.tsx; find kit -type f ! -name .DS_Store; } | sort)
[ "$set_" = "$(awk '{print $2}' kit.sha256 | sort)" ] || { echo "shared ✘ plugins/overseer/hooks: the file set differs from kit.sha256"; fail=1; }
if (cd plugins/overseer/hooks && shasum -a 256 -c ../../../kit.sha256 >/dev/null 2>&1); then [ $fail -eq 0 ] && echo "shared ✔ band.tsx and kit/* match kit.sha256 ($(wc -l < kit.sha256 | tr -d ' ') files)"
else echo "shared ✘ band.tsx or kit/* differ from kit.sha256 (they are frozen: restore them)"; fail=1; fi

# Both plugins and the marketplace validate.
for m in . plugins/overseer plugins/workflow-gate; do
  if claude plugin validate "$m" >/dev/null 2>&1; then echo "validate ✔ $m"; else echo "validate ✘ $m"; fail=1; fi
done

# overseer: its hooks module tests (claude plugin test). A test that finds a reference screen changed prints the new copy between GOLDEN-BEGIN/END markers (a test has no fs).
m=plugins/overseer
out=$(./check-watch.sh "$m" claude plugin test "$m" 2>&1); code=$?
if grep -q 'GOLDEN-BEGIN ' <<<"$out"; then
  if [ "${UPDATE_GOLDEN:-}" = 1 ]; then
    awk -v dir="$m/hooks/golden" '/^ *GOLDEN-BEGIN /{f=dir"/"$2".ts"; printf "" > f; on=1; next} /^ *GOLDEN-END /{on=0; close(f); next} on{sub(/^  /,""); print > f}' <<<"$out"
    echo "golden ↻ $m/hooks/golden updated: review it with git diff, then commit"
    out=$(claude plugin test "$m" 2>&1); code=$?
  else
    echo "golden ✘ $m: reference screens changed: $(grep -Eo 'GOLDEN-BEGIN [a-z0-9-]+' <<<"$out" | cut -d' ' -f2 | tr '\n' ' ')"
    echo "         if on purpose, update the copies with: UPDATE_GOLDEN=1 ./check.sh   (then review git diff $m/hooks/golden)"
  fi
fi
t=$(grep -Eo '[0-9]+ pass' <<<"$out" | tail -1)
[ $code -eq 0 ] || { fail=1; t="${t:-0 pass} ✘ $(grep -Eo '[0-9]+ fail' <<<"$out" | tail -1)"; grep -E '^\(fail\)' <<<"$out" | head -10; }
printf '%-24s %s\n' "$m" "plugin test  ${t:-no tests}"

# workflow-gate: plain Node tests (hooks/test/*-test.mjs, no engine). They need acorn, installed once beside them (gitignored).
wg=plugins/workflow-gate/hooks/test
if [ ! -d "$wg/node_modules/acorn" ]; then npm i --no-save --no-package-lock --silent acorn@8.14.0 --prefix "$wg" >/dev/null 2>&1 || echo "workflow-gate ✘ npm could not install acorn@8.14.0 into $wg"; fi
for t in "$wg"/*-test.mjs; do
  s=$SECONDS; o=$(./check-watch.sh "$t" node "$t" 2>&1); code=$?
  if [ $code -eq 0 ] && ! grep -q '^FAIL' <<<"$o"; then echo "gate ✔ $t ($(grep -c '^PASS' <<<"$o") pass, $((SECONDS - s))s)"; else echo "gate ✘ $t"; grep -E '^FAIL|Error' <<<"$o" | head -5; fail=1; fi
done

# The web board's stylesheet is the mockup's with the fixes of web/DESIGN.md section 7: a change to it is on purpose, so its fingerprint is checked.
css=plugins/overseer/web/board.css
if [ "$(shasum -a 256 < "$css" | cut -d' ' -f1)" = "$(cat "$css.sha256" 2>/dev/null)" ]; then echo "css ✔ $css"; else echo "css ✘ $css changed: if on purpose, write its fingerprint with: shasum -a 256 < $css | cut -d' ' -f1 > $css.sha256"; fail=1; fi

# The board's web side (plain Node, outside the engine) has its own tests. The browser ones need Chrome (CHROME=<path>), or OVERSEER_NO_BROWSER=1 to skip them.
for t in plugins/overseer/web/*.test.mjs; do
  s=$SECONDS
  ./check-watch.sh "$t" node --test --test-timeout=180000 "$t" >/dev/null 2>&1; code=$?
  if [ $code -eq 0 ]; then echo "web ✔ $t ($((SECONDS - s))s)"; elif [ $code -eq 124 ]; then echo "web ✘ $t (stopped after $((SECONDS - s))s: it did not end, see the diagnostic above)"; fail=1; else echo "web ✘ $t ($((SECONDS - s))s)"; fail=1; fi
done

# check-watch.sh itself: a hung file gives the diagnostic then a fail, a slow file that works does not fail.
if node --test check-watch.test.mjs >/dev/null 2>&1; then echo "watch ✔ check-watch.test.mjs"; else echo "watch ✘ check-watch.test.mjs"; fail=1; fi

# The scan, the scan's own test, the README test and the clean-config install (item 2: marketplace add, install both, exactly 2 listed, TYPESAFE_API_KEY unset).
for s in scan.sh scan.test.sh readme.test.sh install.test.sh; do
  if o=$(./$s 2>&1); then echo "$s ✔ $(tail -1 <<<"$o")"; else echo "$s ✘"; sed 's/^/    /' <<<"$o" | tail -25; fail=1; fi
done

# Claude Code writes the 'claude-code' types next to a mod it loads (<mod>/.claude-plugin/types, or its plugin cache). Use the newest copy in the repo, then in the config folder.
# CLAUDE_CODE_TYPES=<a .claude-plugin/types folder> names one by hand.
if [ -n "${CLAUDE_CODE_TYPES:-}" ]; then types="$CLAUDE_CODE_TYPES/claude-code/index.d.ts"
else
  types=''
  while IFS= read -r f; do if [ -z "$types" ] || [ "$f" -nt "$types" ]; then types=$f; fi; done < <(find plugins "$real_cfg/plugins/cache" "$real_cfg/dev-mods" -path '*/.claude-plugin/types/claude-code/index.d.ts' 2>/dev/null)
fi
if [ -z "$types" ] || [ ! -f "$types" ]; then
  echo "tsc ✘ no generated claude-code types found (looked in plugins/ and $real_cfg/plugins/cache). Load overseer once in a Claude Code session, or set CLAUDE_CODE_TYPES=<a .claude-plugin/types folder>."
  exit 1
fi
ln -sfn "$(dirname "$(dirname "$types")")" .types
out=$(npx -y -p typescript@5.9 tsc -p tsconfig.check.json 2>&1); code=$?
echo "tsc $(grep -c 'error TS' <<<"$out") errors (exit $code)"
[ $code -eq 0 ] || { fail=1; tail -20 <<<"$out"; }
[ $fail -eq 0 ] && echo "check ✔ all green" || echo "check ✘ failed"
exit $fail
