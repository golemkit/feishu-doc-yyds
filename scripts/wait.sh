#!/bin/bash
# Usage: wait.sh /abs/path/<name>.json — blocks until run.sh finishes, then prints the log.
T="$1"; OUT="${T%.json}.out"
sleep 3
until [ -f "$OUT" ] && grep -q '^EXIT' "$OUT"; do sleep 2; done
cat "$OUT"
exit "$(awk '/^EXIT [0-9]+$/ {code=$2} END {print code+0}' "$OUT")"
