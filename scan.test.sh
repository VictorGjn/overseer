#!/usr/bin/env bash
# scan.sh passes a clean tree and fails on each class of seeded hit (and on a denylisted name, without printing it).
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d "${TMPDIR:-/tmp}/overseer-scan.XXXXXX"); trap 'rm -rf "$root"' EXIT
git -C "$root" init -q
echo 'hello, a clean file' > "$root/clean.txt"
bad=0
run() { SCAN_ROOT="$root" OVERSEER_DENYLIST="${DENY:-}" "$here/scan.sh" 2>&1; }
expect_hit() { # name, line to seed
  printf '%s\n' "$2" > "$root/seed.txt"
  out=$(run) && { echo "scan.test ✘ '$1' was not caught"; bad=1; } || { grep -q "scan ✘" <<<"$out" || { echo "scan.test ✘ '$1': failed without a report"; bad=1; }; }
  rm -f "$root/seed.txt"
}
out=$(run) || { echo "scan.test ✘ a clean tree fails: $out"; bad=1; }
u=Users; expect_hit 'private path' "cd /$u/someone/Repos/x"
expect_hit 'org name' "see github.com/$(printf 'syro')colab/repo"
expect_hit 'session id' 'session 3f2a9c1e-7b4d-4e8a-9c3b-1a2b3c4d5e6f'
expect_hit 'transcript line' '{"message":{"id":"msg_01AbCdEfGhIjKlMnOpQr"}}'
expect_hit 'anthropic key' "key = sk-ant-$(printf 'api03')-abcdefghijklmnop"
expect_hit 'github token' "token gh$(printf 'p_')abcdefghijklmnopqrstuvwxyz0123456789"
expect_hit 'assigned secret' "api_key = \"abcdefghijklmnopqrstuvwxyz012345\""
expect_hit 'internal url' 'https://build.acme.internal/job/1'
DENY=$(mktemp "${TMPDIR:-/tmp}/deny.XXXXXX"); echo 'Zorblax Shipping' > "$DENY"
echo 'a note about Zorblax Shipping and its vessels' > "$root/seed.txt"
out=$(run) && { echo "scan.test ✘ a denylisted name was not caught"; bad=1; }
grep -q 'Zorblax' <<<"$out" && { echo "scan.test ✘ the report prints the denylisted name"; bad=1; }
rm -f "$root/seed.txt"; out=$(run) || { echo "scan.test ✘ the denylist fails a tree without the name: $out"; bad=1; }
rm -f "$DENY"
[ $bad -eq 0 ] && echo 'scan.test ✔ clean passes; path, org, session id, transcript, secrets, internal url and a denylisted name are caught'
exit $bad
