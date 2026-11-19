// Compile a small Markdown subset into Feishu "lark record" clipboard data.
//
// Pasting text/html that carries <span data-lark-record-data=...> makes Feishu rebuild
// the exact blocks it describes, the way a copy between two Feishu docs does. That is
// the only route that keeps callout colours and icons, N-column grids, text colour,
// highlights and coloured labels; plain Markdown paste drops all of them.
// Formats were read from Feishu's own clipboard data (2026-11-19).

// ---- palette (values taken from Feishu's official templates) -------------------------
export const CALLOUT = {
  blue: ['rgb(240,244,255)', 'rgb(186,206,253)'],
  green: ['rgb(240,251,239)', 'rgb(183,237,177)'],
  orange: ['rgb(255,245,235)', 'rgb(254,212,164)'],
  red: ['rgb(254,241,241)', 'rgb(251,191,188)'],
  yellow: ['rgb(254,255,240)', 'rgb(255,246,122)'],
  purple: ['rgb(246,241,254)', 'rgb(205,178,250)'],
  grey: ['rgb(242,243,245)', 'rgb(222,224,227)'],
};
export const TEXT = { // textHighlight = font colour
  grey: 'rgb(143,149,158)', red: 'rgb(216,57,49)', orange: 'rgb(222,120,2)', yellow: 'rgb(220,155,4)',
  green: 'rgb(46,161,33)', blue: 'rgb(36,91,219)', purple: 'rgb(100,37,208)',
};
export const HIGHLIGHT = { // textHighlightBackground
  red: 'rgba(251,191,188,1)', orange: 'rgba(254,212,164,0.8)', yellow: 'rgba(255,246,122,0.8)',
  green: 'rgba(183,237,177,0.8)', blue: 'rgba(186,206,253,0.7)', purple: 'rgba(205,178,250,0.7)', grey: 'rgba(222,224,227,0.8)',
};
export const LABEL = { // block background of a centred label line
  orange: 'rgb(254,234,210)', green: 'rgb(217,245,214)', blue: 'rgb(225,234,255)', purple: 'rgb(236,226,254)',
  red: 'rgb(253,226,226)', yellow: 'rgb(255,251,214)', grey: 'rgb(239,240,241)',
};
const COLORS = Object.keys(CALLOUT).join('|');

// Callout icons: Feishu uses gemoji short names; an unknown name shows as 💡.
export const EMOJI = {
  '💡': 'bulb', '📌': 'pushpin', '📍': 'round_pushpin', '🎯': 'dart', '🚀': 'rocket', '⚠️': 'warning', '⚠': 'warning',
  '📝': 'memo', '📈': 'chart_with_upwards_trend', '📉': 'chart_with_downwards_trend', '📊': 'bar_chart',
  '👍': '+1', '🌱': 'seedling', '🏆': 'trophy', '❌': 'x', '⭐': 'star', '🌟': 'star2', '✅': 'white_check_mark',
  '🚨': 'rotating_light', '📆': 'calendar', '📅': 'date', '⏰': 'alarm_clock', '📚': 'books', '🔥': 'fire',
  '💎': 'gem', '✨': 'sparkles', '🎉': 'tada', '🔍': 'mag', '🔑': 'key', '⚙️': 'gear', '🔗': 'link', '📣': 'mega',
  '🔔': 'bell', '👀': 'eyes', '🤝': 'handshake', '👤': 'bust_in_silhouette', '👥': 'busts_in_silhouette',
  '❓': 'question', '❗': 'exclamation', '⛳': 'golf', '🧠': 'brain', '🏁': 'checkered_flag',
  '🚩': 'triangular_flag_on_post', '💬': 'speech_balloon', '🧭': 'compass', '🎨': 'art', '💻': 'computer',
  '🤖': 'robot', '⏳': 'hourglass_flowing_sand', '🔒': 'lock', '📦': 'package', '🧪': 'test_tube', '🧩': 'jigsaw',
  '🗻': 'mount_fuji', '⛰️': 'mountain', '🌀': 'cyclone', '🔸': 'small_orange_diamond', '🔹': 'small_blue_diamond',
  '🎣': 'fishing_pole_and_fish', '🌈': 'rainbow', '☀️': 'sunny', '🌙': 'crescent_moon', '💰': 'moneybag', '🏠': 'house',
  '🚗': 'car', '📱': 'iphone', '🖥️': 'desktop_computer', '🗣️': 'speaking_head', '✍️': 'writing_hand', '👏': 'clap',
  '💪': 'muscle', '🙋': 'raising_hand', '🧑‍💻': 'technologist', '📢': 'loudspeaker', '🛡️': 'shield', '🧱': 'bricks',
  '🛠️': 'hammer_and_wrench', '🏗️': 'building_construction', '📋': 'clipboard', '🗺️': 'world_map', '🎁': 'gift',
};
export const emojiId = (s) => (s && (EMOJI[s] || EMOJI[s.replace(/\uFE0F/g, '')] || (/^[a-z0-9_+-]+$/.test(s) ? s : null))) || 'bulb';

// ---- inline: **bold**, {red:..}, {bg-green:..}, ==..==, [text](url) -----------------
const INLINE_RE = new RegExp(`\\*\\*|==|\\{(?:bg-)?(?:${COLORS}):|\\[[^\\]]+\\]\\([^)\\s]+\\)`);
export const hasStyle = (s) => new RegExp(`\\{(?:bg-)?(?:${COLORS}):|==[^=\\s]|^\\s*\\{\\{(?:${COLORS}):`).test(s);

function closeBrace(s, i) { // index of the '}' matching the '{' at i
  for (let d = 0, k = i; k < s.length; k++) { if (s[k] === '{') d++; else if (s[k] === '}' && --d === 0) return k; }
  return -1;
}
export function parseInline(s, attrs = {}, out = []) {
  while (s.length) {
    const m = s.match(INLINE_RE);
    if (!m) { out.push({ text: s, attrs }); break; }
    if (m.index) out.push({ text: s.slice(0, m.index), attrs });
    s = s.slice(m.index);
    let inner, rest, add;
    if (s.startsWith('**')) { const j = s.indexOf('**', 2); if (j < 0) { out.push({ text: s, attrs }); break; } inner = s.slice(2, j); rest = s.slice(j + 2); add = { bold: 'true' }; }
    else if (s.startsWith('==')) { const j = s.indexOf('==', 2); if (j < 0) { out.push({ text: s, attrs }); break; } inner = s.slice(2, j); rest = s.slice(j + 2); add = { textHighlightBackground: HIGHLIGHT.yellow }; }
    else if (s.startsWith('{')) {
      const j = closeBrace(s, 0); if (j < 0) { out.push({ text: s, attrs }); break; }
      const [, bg, col] = s.match(new RegExp(`^\\{(bg-)?(${COLORS}):`));
      inner = s.slice(s.indexOf(':') + 1, j); rest = s.slice(j + 1);
      add = bg ? { textHighlightBackground: HIGHLIGHT[col] } : { textHighlight: TEXT[col] };
    } else { const l = s.match(/^\[([^\]]+)\]\(([^)\s]+)\)/); inner = l[1]; rest = s.slice(l[0].length); add = { link: encodeURIComponent(l[2]) }; }
    parseInline(inner, { ...attrs, ...add }, out);
    s = rest;
  }
  return out.filter(x => x.text.length);
}
export const plainInline = (s) => parseInline(s).map(x => x.text).join('');

function textField(s) {
  const segs = parseInline(s);
  const numToAttrib = {}, attribToNum = {}; let n = 0, attribs = '';
  for (const g of segs) {
    let pre = '';
    for (const [k, v] of Object.entries(g.attrs).sort()) {
      const key = `${k},${v}`;
      if (!(key in attribToNum)) { attribToNum[key] = n; numToAttrib[n] = [k, v]; n++; }
      pre += '*' + attribToNum[key].toString(36);
    }
    attribs += pre + '+' + g.text.length.toString(36);
  }
  return { apool: { numToAttrib, nextNum: n, attribToNum }, initialAttributedTexts: { attribs: { 0: attribs }, text: { 0: segs.map(g => g.text).join('') } } };
}

// ---- blocks ---------------------------------------------------------------------------
// node: { type, props?, text?, children? }
const node = (type, text, props = {}, children = []) => ({ type, text, props, children });

// Compile Markdown lines into nodes. Returns null when a line needs the Markdown paste
// (tables, code, mermaid, images, dividers), so the caller can fall back.
export function compileLines(lines) {
  const roots = [], stack = []; // stack of {level, node} for list nesting
  let lastQuote = false;
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (/^\s*\|/.test(raw) || /^\s*```/.test(raw) || /^\s*!\[/.test(raw) || /^\s*(---|\*\*\*)\s*$/.test(raw)) return null;
    const lab = raw.match(new RegExp(`^\\s*\\{\\{(${COLORS}):(.*)\\}\\}\\s*$`));
    const h = raw.match(/^(#{1,9})\s+(.*)$/);
    const td = raw.match(/^(\s*)[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const ul = raw.match(/^(\s*)[-*]\s+(.*)$/);
    const ol = raw.match(/^(\s*)\d+[.)]\s+(.*)$/);
    const q = raw.match(/^\s*>\s?(.*)$/);
    const lvl = (sp) => Math.floor(sp.replace(/\t/g, '    ').length / 4);
    let n, level = 0;
    if (q) {
      if (lastQuote) { roots[roots.length - 1].children.push(node('text', q[1])); continue; }
      n = node('quote_container', null, {}, [node('text', q[1])]);
    }
    else if (lab) n = node('text', `**${lab[2].trim()}**`, { align: 'center', background_color: LABEL[lab[1]] });
    else if (h) n = node('heading' + h[1].length, h[2]);
    else if (td) { level = lvl(td[1]); n = node('todo', td[3], { done: td[2] !== ' ' }); }
    else if (ul) { level = lvl(ul[1]); n = node('bullet', ul[2]); }
    else if (ol) { level = lvl(ol[1]); n = node('ordered', ol[2], { seq: '1' }); }
    else n = node('text', raw.trim());
    lastQuote = !!q;
    const isList = ['bullet', 'ordered', 'todo'].includes(n.type);
    let siblings = roots;
    if (isList && level > 0) {
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      if (stack.length) siblings = stack[stack.length - 1].node.children;
    } else if (isList) stack.length = 0;
    else stack.length = 0;
    const prev = siblings[siblings.length - 1];
    if (n.type === 'ordered' && prev && prev.type === 'ordered') n.props.seq = 'auto';
    siblings.push(n);
    if (isList) stack.push({ level: siblings === roots ? 0 : level, node: n });
  }
  return roots;
}

// ---- payload --------------------------------------------------------------------------
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const newId = () => { let s = 'F'; for (let i = 0; i < 26; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]; return s; };
const BASE = { comments: [], revisions: [], locked: false, hidden: false };

export function callout(spec, body) { // body: nodes
  const [bg, bd] = CALLOUT[spec.color] || CALLOUT.blue;
  return node('callout', null, { background_color: bg, border_color: spec.flat ? '' : bd, text_color: '', align: 'left', emoji_id: spec.icon === 'none' ? '' : emojiId(spec.icon) }, body);
}
export function grid(cols) { // cols: [{ width?, nodes }]
  const total = cols.reduce((a, c) => a + (c.width || 1 / cols.length), 0);
  return node('grid', null, {}, cols.map(c => node('grid_column', null, { width_ratio: (c.width || 1 / cols.length) / total }, c.nodes)));
}

// Parse "green 🌱 flat 40%" → { color, icon, flat, width, plain }
export function parseSpec(s = '') {
  const spec = {};
  for (const t of s.trim().split(/\s+/).filter(Boolean)) {
    if (CALLOUT[t]) spec.color = t;
    else if (t === 'flat') spec.flat = true;
    else if (t === 'plain') spec.plain = true;
    else if (/^\d+%$/.test(t)) spec.width = parseInt(t) / 100;
    else spec.icon = t;
  }
  return spec;
}

export function payload(nodes) {
  const rootId = newId(), rm = {}, top = [];
  const emit = (n, parent) => {
    const id = newId();
    const snap = { type: n.type, parent_id: parent, ...BASE, children: [], ...n.props };
    if (n.text != null) { snap.text = textField(n.text); if (!('align' in n.props)) snap.align = ''; snap.folded = false; }
    rm[id] = { id, snapshot: snap };
    snap.children = n.children.map(c => emit(c, id));
    return id;
  };
  for (const n of nodes) top.push(emit(n, rootId));
  rm[rootId] = { id: rootId, snapshot: { type: 'page', parent_id: '', ...BASE, children: top, text: textField(''), align: '' } };
  const data = {
    isCut: false, rootId, parentId: rootId, blockIds: top.map((_, i) => i + 2), recordIds: top, recordMap: rm, payloadMap: {},
    extra: { channel: 'saas', pasteRandomId: crypto.randomUUID(), mention_page_title: {}, external_mention_url: {}, isEqualBlockSelection: true },
    isKeepQuoteContainer: false, selection: top.map((r, i) => ({ id: i + 2, type: 'block', recordId: r })), pasteFlag: crypto.randomUUID(),
  };
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const plain = []; const walk = (n) => { if (n.text != null) plain.push(plainInline(n.text)); n.children.forEach(walk); }; nodes.forEach(walk);
  const html = `<meta charset="utf-8"><div data-page-id="${rootId}" data-lark-html-role="root" data-docx-has-block-data="true">${plain.map(t => `<div class="ace-line">${esc(t)}</div>`).join('')}</div>`
    + `<span data-lark-record-data="${esc(JSON.stringify(data))}" data-lark-record-format="docx/record" class="lark-record-clipboard"></span>`;
  return { html, text: plain.join('\n') };
}
