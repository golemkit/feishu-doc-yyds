#!/bin/bash
# Usage: wait.sh /abs/path/<name>.json — blocks until run.sh finishes, then prints the log.
T="$1"; OUT="${T%.json}.out"
sleep 3
until [ -f "$OUT" ] && grep -q '^EXIT' "$OUT" && ! pgrep -f "ego-browser nodejs|run-chrome.mjs" >/dev/null; do sleep 2; done
cat "$OUT"
