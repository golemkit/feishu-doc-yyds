# Example: a chart Feishu can't draw natively (here a 2-D matrix), rendered from HTML
# to PNG with headless Chrome, then inserted into the doc with ![](/abs/path.png).
#   python3 matrix-png-example.py
#   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --hide-scrollbars \
#     --window-size=1400,900 --force-device-scale-factor=2 \
#     --screenshot=/tmp/feishu-skill/matrix.png file:///tmp/feishu-skill/matrix.html
import os
# (name, x = status level 1-4, y = number of capabilities used)
W = [
 ('图片生成', 1, 2), ('知识库问答', 2, 3), ('语音转写', 2, 1),
 ('文案生成', 3, 2), ('模型网关', 3, 1),
 ('指标看板', 4, 2), ('流程自动化', 4, 3), ('周报助手', 4, 1),
]
COL = {1: '#e6a700', 2: '#e8590c', 3: '#1c7ed6', 4: '#2b8a3e'}
XL = {1: '🟡 验证中', 2: '🟠 原型', 3: '🔵 内测', 4: '🟢 已上线'}
cells = {}
for n, x, y in W: cells.setdefault((x, y), []).append(n)
rows = []
for y in range(3, 0, -1):
    tds = []
    for x in range(1, 5):
        pills = ''.join(f'<span class="pill" style="--c:{COL[x]}">{n}</span>' for n in cells.get((x, y), []))
        zone = ('tr' if x >= 3 and y >= 2 else 'tl' if y >= 2 else 'br' if x >= 3 else 'bl')
        tds.append(f'<td class="{zone}">{pills}</td>')
    rows.append(f'<tr><th class="yl">{y}</th>{"".join(tds)}</tr>')
html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
body {{ margin:0; background:#fff; font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; color:#1f2329; }}
.wrap {{ width:1400px; padding:36px 40px 30px 40px; box-sizing:border-box; }}
h1 {{ font-size:26px; margin:0 0 6px; }}
.sub {{ color:#646a73; font-size:15px; margin-bottom:22px; }}
.box {{ display:flex; }}
.yaxis {{ writing-mode:vertical-rl; transform:rotate(180deg); font-size:15px; color:#646a73; text-align:center; padding-right:10px; }}
table {{ border-collapse:separate; border-spacing:6px; flex:1; }}
td {{ height:110px; width:25%; border-radius:12px; vertical-align:middle; text-align:center; padding:6px; }}
td.tr {{ background:#ebf7ee; }} td.tl {{ background:#fff7e6; }} td.br {{ background:#e8f3ff; }} td.bl {{ background:#f5f6f7; }}
th.yl {{ font-size:15px; color:#8f959e; font-weight:500; width:24px; }}
.pill {{ display:inline-block; margin:4px; padding:7px 14px; border-radius:999px; background:#fff; border:2px solid var(--c); font-size:15px; font-weight:600; }}
.xl {{ display:flex; margin-left:64px; }} .xl div {{ flex:1; text-align:center; font-size:16px; font-weight:600; padding-top:8px; }}
.xt {{ text-align:center; color:#646a73; font-size:15px; margin:6px 0 0 64px; }}
</style></head><body><div class="wrap">
<h1>工作成熟度 × 能力组合度（示例）</h1>
<div class="sub">纵轴：用到的能力数量 · 横轴：推进状态</div>
<div class="box"><div class="yaxis">用到的能力数 →</div><table>{''.join(rows)}</table></div>
<div class="xl">{''.join(f'<div style="color:{COL[x]}">{XL[x]}</div>' for x in range(1,5))}</div>
<div class="xt">推进状态 →</div>
</div></body></html>'''
os.makedirs('/tmp/feishu-skill', exist_ok=True)
open('/tmp/feishu-skill/matrix.html', 'w', encoding='utf8').write(html)
print('wrote /tmp/feishu-skill/matrix.html')
