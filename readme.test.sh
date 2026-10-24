#!/usr/bin/env bash
# The README holds what the task asks: its sections in order, a 3-line install, PLAN.md up top, the MIT license, images that exist and stay small, and every /oversee command of register.tsx (both ways); the sample repo's PLAN.md matches its test fixture.
set -uo pipefail
cd "$(dirname "$0")"
bad=0
no() { echo "readme ✘ $1"; bad=1; }
want='Features|Install|First run|How it works|The Mac board|Zen review|The workflow gate|The phone|Commands|Troubleshooting|Development|License'
[ "$(grep '^## ' README.md | sed 's/^## //' | paste -sd'|' -)" = "$want" ] || no "the sections are not, in order: ${want//|/, }"
head -3 README.md | grep -qi 'PLAN.md' || no 'the first lines do not say what it does'
install=$(awk '/^## Install/{f=1;next} /^## /{f=0} f&&/^```/{c++;next} f&&c==1' README.md | grep -v '^$')
[ "$(wc -l <<<"$install" | tr -d ' ')" = 3 ] || no "the install block is not 3 lines"
for l in '/plugin marketplace add VictorGjn/overseer' '/plugin install overseer@overseer' '/plugin install workflow-gate@overseer'; do grep -qxF "$l" <<<"$install" || no "install line missing: $l"; done
[ -f LICENSE ] && head -1 LICENSE | grep -q '^MIT License' && grep -q 'Copyright (c) 2026 Victor Grosjean' LICENSE || no 'LICENSE is missing or is not MIT, 2026 Victor Grosjean'
grep -qi 'mit' README.md || no 'the README does not name the license'
ver=$(node -p 'require("./plugins/overseer/.claude-plugin/plugin.json").version')
grep -q "badge/version-$ver-" README.md || no "the version badge is not $ver (plugin.json)"
grep -q 'sample-repo' README.md || no 'the README does not name examples/sample-repo'
grep -q '^```mermaid' README.md || no 'no mermaid block'
# images: every docs/img path the README links exists, PNG <= 300 KB, GIF <= 3 MB, at most 12 PNG and 3 GIF
imgs=$(grep -o 'docs/img/[A-Za-z0-9_.-]*' README.md | sort -u)
png=$(grep -c '\.png$' <<<"$imgs"); gif=$(grep -c '\.gif$' <<<"$imgs")
[ "$png" -le 12 ] || no "$png PNG linked (max 12)"
[ "$gif" -le 3 ] || no "$gif GIF linked (max 3)"
if [ -d docs/img ]; then
  for f in $imgs; do
    [ -f "$f" ] || { no "image missing: $f"; continue; }
    sz=$(wc -c <"$f"); case $f in *.png) max=307200;; *.gif) max=3145728;; *) max=0;; esac
    [ "$sz" -le "$max" ] || no "$f is $sz bytes (max $max)"
  done
else echo 'readme ! docs/img does not exist yet: image checks skipped'; fi
# the /oversee subcommands: those the README names in backticks equal those register.tsx handles
code=$(grep -o "verb === '[a-z]*'" plugins/overseer/hooks/register.tsx | grep -o "'[a-z]*'" | tr -d "'" | sort -u)
doc=$(grep -o '`/oversee [a-z]\+' README.md | awk '{print $2}' | sort -u)
[ -n "$code" ] || no 'no subcommand found in register.tsx'
[ "$code" = "$doc" ] || no "the subcommands differ. only in register.tsx: $(comm -23 <(echo "$code") <(echo "$doc") | tr '\n' ' ')| only in README: $(comm -13 <(echo "$code") <(echo "$doc") | tr '\n' ' ')"
node -e '
const fs = require("fs"); const src = fs.readFileSync("plugins/overseer/hooks/fixtures/sample-repo.ts", "utf8")
const got = JSON.parse(src.slice(src.indexOf("export default ") + 15))
process.exit(got === fs.readFileSync("examples/sample-repo/PLAN.md", "utf8") ? 0 : 1)' || no 'fixtures/sample-repo.ts differs from examples/sample-repo/PLAN.md'
[ $bad -eq 0 ] && echo "readme ✔ sections, 3-line install, images, $(wc -l <<<"$code" | tr -d ' ') subcommands match register.tsx, MIT license, sample fixture"
exit $bad
