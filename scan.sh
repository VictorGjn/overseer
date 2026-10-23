#!/usr/bin/env bash
# scan.sh: secrets and private data in the tracked and not-ignored files. Exit 1 on any hit.
# $OVERSEER_DENYLIST (optional): a file outside the repo, one name per line; a name found anywhere is a hit (only file:line is printed, never the name).
# SCAN_ROOT changes the directory scanned (scan.test.sh uses it).
set -uo pipefail
cd "${SCAN_ROOT:-$(dirname "$0")}" || exit 2
skip=(':!scan.sh' ':!scan.test.sh') # the two files that spell out the patterns
hits=0
scan() { # label, extended regex, optional allow regex (a matching line is not a hit)
  local out
  out=$(git grep -I -n -i -E --untracked -e "$2" -- . "${skip[@]}" 2>/dev/null)
  [ -n "${3:-}" ] && out=$(grep -v -i -E -e "$3" <<<"$out")
  if [ -n "$(tr -d '[:space:]' <<<"$out")" ]; then echo "scan ✘ $1:"; cut -c1-200 <<<"$out" | sed 's/^/    /'; hits=$((hits + 1)); fi
}
scan 'private path'        '/Users/|[A-Z]:[\\/]+Users[\\/]|/home/[a-z0-9_-]+' '/home/(user|alice|runner|u)([^a-z0-9_-]|$)'
scan 'organisation names'  'syroco|syrocolab'
scan 'session id'          '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' '(^|[^0-9a-f])(00000000|0000aa[0-9a-f]{2}|0123abcd|9876fedc|11111111|22222222)-'
scan 'transcript line'     'msg_01[A-Za-z0-9]{12,}|toolu_01[A-Za-z0-9]{12,}|"parentUuid"|req_01[A-Za-z0-9]{12,}'
scan 'secret'              'sk-ant-|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}\.eyJ|(api[_-]?key|token|secret|password)["'"'"']?[ ]*[:=][ ]*["'"'"'][A-Za-z0-9_-]{24,}["'"'"']' 'push\.test\.mjs:[0-9]+:\s+ecdhSecret' # RFC 8291 appendix A test vector, public
scan 'internal url'        'https?://[a-z0-9.-]*\.(internal|corp|local)([^a-z]|$)|linear\.app/[a-z0-9-]+/|slack\.com/archives|notion\.so/[A-Za-z0-9-]{20,}|hooks\.slack\.com'
if [ -n "${OVERSEER_DENYLIST:-}" ]; then
  if [ -r "$OVERSEER_DENYLIST" ]; then
    list=$(mktemp); grep -v '^[[:space:]]*$' "$OVERSEER_DENYLIST" > "$list"
    if [ -s "$list" ]; then
      out=$({ git grep -I -n -i -F -f "$list" --untracked -- . "${skip[@]}" | cut -d: -f1,2; git ls-files -co --exclude-standard | grep -i -F -f "$list"; } 2>/dev/null)
      [ -n "$out" ] && { echo "scan ✘ denylist (names hidden):"; sed 's/^/    /' <<<"$out"; hits=$((hits + 1)); }
    fi
    rm -f "$list"
  else echo "scan ✘ OVERSEER_DENYLIST=$OVERSEER_DENYLIST is not readable"; hits=$((hits + 1)); fi
fi
[ $hits -eq 0 ] && echo "scan ✔ no secret, no private data ($(git ls-files -co --exclude-standard | wc -l | tr -d ' ') files${OVERSEER_DENYLIST:+, denylist read})"
[ $hits -eq 0 ]
