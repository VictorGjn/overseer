#!/usr/bin/env bash
# check-watch.sh <label> <command...>: run a command (one test file, or one mod's tests) with no time limit for work that goes on,
# but a diagnostic when one thing takes long (Victor, 2026-10-22): after CHECK_WARN_SECS (300) it prints the file, its CPU and its child
# processes, and writes the same text where the overseer reads it (CHECK_STUCK_DIR, default ~/.claude/overseer/check-stuck/<id>.txt: the
# overseer shows the session that runs this as stuck, with the text as a need). After CHECK_KILL_SECS (1200) it stops the command and
# fails with exit code 124; the caller goes on to the next file. A command that ends first leaves nothing behind.
# The diagnostic goes to fd 3 when the caller opened it (check.sh keeps its terminal there), else to stderr.
set -uo pipefail
label=$1; shift
warn=${CHECK_WARN_SECS:-300}; limit=${CHECK_KILL_SECS:-1200}
dir=${CHECK_STUCK_DIR:-$HOME/.claude/overseer/check-stuck}
here=$(pwd); file="$dir/$(printf '%s' "$here" | shasum | cut -c1-12).txt"
out() { if { true >&3; } 2>/dev/null; then cat >&3; else cat >&2; fi; }

# the process tree under $1, one line each: pid cpu% cputime command
tree() {
  LC_ALL=C ps -A -o pid=,ppid=,pcpu=,time=,command= | awk -v root="$1" '
    { pid[NR]=$1; ppid[NR]=$2; line[NR]=$0 }
    END { want[root]=1; do { n=0; for (i=1;i<=NR;i++) if (!(pid[i] in want) && (ppid[i] in want)) { want[pid[i]]=1; n++ } } while (n>0)
          for (i=1;i<=NR;i++) if (pid[i] in want) { split(line[i], f, " "); cmd=line[i]; sub(/^ *[0-9]+ +[0-9]+ +[0-9.]+ +[0-9:.]+ +/, "", cmd); print f[1], f[3]"%", f[4], substr(cmd, 1, 110) } }'
}
elapsed() { local s=$1; printf '%dm%02d' $((s / 60)) $((s % 60)); }
diagnose() { # $1 pid  $2 seconds
  local procs; procs=$(tree "$1")
  echo "check.sh: $label has run $(elapsed "$2") with no end."
  echo "CPU of its $(wc -l <<<"$procs" | tr -d ' ') processes (pid, cpu now, cpu used, command):"
  sed 's/^/  /' <<<"$procs"
  if [ -f "$label" ] && grep -q 'test/cdp.mjs' "$label" 2>/dev/null && ! grep -Eiq 'chrom|headless' <<<"$procs"; then
    echo "no browser child: is the sandbox blocking the launch?"
  fi
}

"$@" &
pid=$!
timers=()
( trap 'kill $s 2>/dev/null; exit 0' TERM; sleep "$warn" & s=$!; wait $s
  text=$({ echo "cwd: $here"; echo "file: $label"; diagnose "$pid" "$warn"; })
  mkdir -p "$dir"; printf '%s\n' "$text" > "$file"
  sed 1,2d <<<"$text" | out ) &
timers+=($!)
( trap 'kill $s 2>/dev/null; exit 0' TERM; sleep "$limit" & s=$!; wait $s
  { echo "check.sh: $label stopped after $(elapsed "$limit"): it did not end."; } | out
  mkdir -p "$dir"; : > "$file.stopped" # before the kill: the wait below must find it
  descend=$(tree "$pid" | awk '{print $1}')
  kill -TERM $descend 2>/dev/null; sleep 2; kill -KILL $descend 2>/dev/null ) &
timers+=($!)

{ wait "$pid"; } 2>/dev/null; code=$?
for t in "${timers[@]}"; do kill "$t" 2>/dev/null; wait "$t" 2>/dev/null; done
rm -f "$file"
if [ -e "$file.stopped" ]; then rm -f "$file.stopped"; exit 124; fi
exit $code
