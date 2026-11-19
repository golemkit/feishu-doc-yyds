#!/bin/bash
# Usage: run.sh /abs/path/<name>.json [--chrome|--ego]
# Output: <name>.out (log, ends with "EXIT n") and <name>.result.json
#
# Engine: ego lite if installed (uses the user's ego login), otherwise Chrome via
# Playwright (separate Chrome window with its own profile; log in to Feishu once).
# Force one with --chrome / --ego or FEISHU_ENGINE=chrome|ego.
T="$1"
case "$T" in /*.json) ;; *) echo "need an absolute path to a .json task"; exit 2;; esac
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="${FEISHU_ENGINE:-auto}"
case "$2" in --chrome) ENGINE=chrome;; --ego) ENGINE=ego;; esac
EGO="$HOME/.local/bin/ego-browser"
if [ "$ENGINE" = auto ]; then
  if [ -x "$EGO" ]; then ENGINE=ego; else ENGINE=chrome; fi
fi
OUT="${T%.json}.out"
rm -f "$OUT"
mkdir -p /tmp/feishu-skill
if [ "$ENGINE" = chrome ]; then
  if [ ! -d "$SKILL/node_modules/playwright-core" ]; then
    (cd "$SKILL" && npm install --no-audit --no-fund >/dev/null 2>&1) || { echo "npm install failed in $SKILL" > "$OUT"; echo "EXIT 3" >> "$OUT"; echo "done $OUT"; exit 3; }
  fi
  node "$SKILL/scripts/run-chrome.mjs" "$T" > "$OUT" 2>&1
  echo "EXIT $?" >> "$OUT"
else
  J="$(mktemp /tmp/feishu-skill/job-XXXXXX).mjs"
  cat > "$J" <<JS
const R = await import("$SKILL/scripts/runner.mjs");
await R.run({ taskFile: "$T", taskSpace, listTaskSpaces, claimTaskSpace, takeOverTaskSpace });
JS
  "$EGO" nodejs < "$J" > "$OUT" 2>&1
  echo "EXIT $?" >> "$OUT"
  rm -f "$J" "${J%.mjs}"
fi
echo "done $OUT ($ENGINE)"
