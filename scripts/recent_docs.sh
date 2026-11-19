#!/bin/bash
# Lists Feishu docs recently opened in ego lite and/or the feishu-doc Chrome profile
# (to find the URL of a doc the user just created or opened). Usage: recent_docs.sh [limit]
N="${1:-15}"
for H in "$HOME/Library/Application Support/Citro Labs/ego lite/Profile 1/History" \
         "${FEISHU_CHROME_PROFILE:-$HOME/.feishu-doc-chrome}/Default/History"; do
  [ -f "$H" ] || continue
  TMP=$(mktemp /tmp/feishu-hist-XXXXXX)
  cp "$H" "$TMP" || continue
  sqlite3 "$TMP" "select last_visit_time, datetime(last_visit_time/1000000-11644473600,'unixepoch','localtime'), url, title from urls where (url like '%feishu.cn/%' or url like '%larksuite.com/%') and (url like '%/wiki/%' or url like '%/docx/%') order by last_visit_time desc limit $N;"
  rm -f "$TMP"
done | sort -t'|' -k1,1nr | python3 -c "
import sys,re
seen=set(); n=0
for line in sys.stdin:
    _,t,u,ti=(line.rstrip('\n').split('|',3)+['','',''])[:4]
    u=u.split('?')[0]
    if u in seen: continue
    seen.add(u); n+=1
    if n>$N: break
    ti=re.sub(r'[​-‏⁠-⁤﻿‪-‮]','',ti)
    print(t,u,ti,sep='  ')"
