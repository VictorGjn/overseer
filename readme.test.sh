#!/usr/bin/env bash
# The README holds what the task asks: its sections, a 3-line install, the link to docs/README-full.md and the MIT license; the sample repo's PLAN.md matches its test fixture.
set -uo pipefail
cd "$(dirname "$0")"
bad=0
no() { echo "readme ✘ $1"; bad=1; }
for h in 'Install' 'First run' 'Full README' 'License'; do grep -q "^## $h\$" README.md || no "section '## $h' is missing"; done
head -3 README.md | grep -qi 'PLAN.md' || no 'the first lines do not say what it does'
install=$(awk '/^## Install/{f=1;next} /^## /{f=0} f&&/^```/{c++;next} f&&c==1' README.md | grep -v '^$')
[ "$(wc -l <<<"$install" | tr -d ' ')" = 3 ] || no "the install block is not 3 lines"
for l in '/plugin marketplace add VictorGjn/overseer' '/plugin install overseer@overseer' '/plugin install workflow-gate@overseer'; do grep -qxF "$l" <<<"$install" || no "install line missing: $l"; done
grep -q '](docs/README-full.md)' README.md || no 'no link to docs/README-full.md'
[ -f LICENSE ] && head -1 LICENSE | grep -q '^MIT License' && grep -q 'Copyright (c) 2026 Victor Grosjean' LICENSE || no 'LICENSE is missing or is not MIT, 2026 Victor Grosjean'
grep -qi 'mit' README.md || no 'the README does not name the license'
[ "$(wc -l < README.md)" -le 60 ] || no 'the README is not short (over 60 lines)'
node -e '
const fs = require("fs"); const src = fs.readFileSync("plugins/overseer/hooks/fixtures/sample-repo.ts", "utf8")
const got = JSON.parse(src.slice(src.indexOf("export default ") + 15))
process.exit(got === fs.readFileSync("examples/sample-repo/PLAN.md", "utf8") ? 0 : 1)' || no 'fixtures/sample-repo.ts differs from examples/sample-repo/PLAN.md'
[ $bad -eq 0 ] && echo 'readme ✔ sections, 3-line install, docs/README-full.md link, MIT license, sample fixture'
exit $bad
