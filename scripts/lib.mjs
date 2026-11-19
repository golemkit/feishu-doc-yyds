// Feishu / Lark docx helpers for ego-browser pages. Every function takes an ego Page.
// Verified on a feishu.cn tenant, 2026-11-18.
import * as K from './lark.mjs';
const wait = (page, ms) => page.waitForTimeout(ms);
// macOS: End/Home do nothing in Feishu, so use Cmd+Arrow there. Elsewhere use End/Home.
const MAC = (globalThis.process?.platform ?? 'darwin') === 'darwin';
export const KEYS = {
  lineEnd: MAC ? 'Meta+ArrowRight' : 'End',
  selectToLineStart: MAC ? 'Shift+Meta+ArrowLeft' : 'Shift+Home',
  undo: MAC ? 'Meta+z' : 'Control+z',
};

// ---- block matching -------------------------------------------------------
// Match spec: "exact text" | { id, type, text, startsWith, includes, topLevel }
export function matchJs(m) {
  if (typeof m === 'string') m = { text: m };
  const zt = `(b.querySelector('.zone-container') || b).innerText.replace(/\\u200b/g, '').trim()`;
  const p = [];
  if (m.id) p.push(`b.getAttribute('data-record-id') === ${JSON.stringify(m.id)}`);
  if (m.type) p.push(`b.getAttribute('data-block-type') === ${JSON.stringify(m.type)}`);
  if (m.text !== undefined) p.push(`${zt} === ${JSON.stringify(m.text)}`);
  if (m.startsWith) p.push(`${zt}.startsWith(${JSON.stringify(m.startsWith)})`);
  if (m.includes) p.push(`${zt}.includes(${JSON.stringify(m.includes)})`);
  if (m.topLevel) p.push(`b.parentElement.closest('[data-block-type]') === document.querySelector('[data-block-type="page"]')`);
  if (!p.length) throw new Error('empty match spec');
  return p.join(' && ');
}

// The doc is virtualized: off-screen blocks are not in the DOM. Look in the
// current viewport first, then scan from the top. Returns the block id or null.
export async function find(page, m) {
  const t = matchJs(m);
  const look = () => page.evaluate((t) => {
    const e = [...document.querySelectorAll('[data-block-type]')].find(b => eval(t));
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    return e.getAttribute('data-record-id');
  }, t);
  let id = await look();
  for (let pass = 0; !id && pass < 80; pass++) {
    const r = await page.evaluate((pass) => {
      let c = document.querySelector('[data-block-type="page"]');
      while (c && !(c.scrollHeight > c.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
      if (!c) return { end: true };
      const y = pass * c.clientHeight * 0.7;
      c.scrollTop = y;
      return { end: y > c.scrollHeight };
    }, pass);
    await wait(page, 450);
    id = await look();
    if (r.end) break;
  }
  if (id) await wait(page, 700);
  return id;
}

export async function scrollBox(page, y) {
  return page.evaluate((y) => {
    let c = document.querySelector('[data-block-type="page"]');
    while (c && !(c.scrollHeight > c.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
    if (!c) return null;
    if (y !== undefined) c.scrollTop = y;
    return { top: c.scrollTop, sh: c.scrollHeight, ch: c.clientHeight };
  }, y);
}

export const blockMeta = (page, id) => page.evaluate((id) => {
  const e = document.querySelector(`[data-record-id="${id}"]`); if (!e) return null;
  const par = e.parentElement.closest('[data-block-type]');
  return { id, type: e.getAttribute('data-block-type'), parent: par && par.getAttribute('data-record-id'), parentType: par && par.getAttribute('data-block-type'),
    text: (e.querySelector('.zone-container') || e).innerText.replace(/\u200b/g, '').trim() };
}, id);

// ---- caret ----------------------------------------------------------------
export const caretInfo = (page) => page.evaluate(() => {
  const s = getSelection(); if (!s || !s.anchorNode) return null;
  const nd = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
  const b = nd && nd.closest('[data-block-type]'); if (!b) return null;
  const chain = []; let p = b; while (p) { chain.push(p.getAttribute('data-block-type')); p = p.parentElement && p.parentElement.closest('[data-block-type]'); }
  const par = b.parentElement.closest('[data-block-type]');
  return { id: b.getAttribute('data-record-id'), type: b.getAttribute('data-block-type'), parent: par && par.getAttribute('data-record-id'), chain,
    text: (b.querySelector('.zone-container') || b).innerText.replace(/\u200b/g, '').trim() };
});

// Put the caret at the end of block `id` and verify it landed there.
export async function clickEnd(page, id) {
  await page.evaluate((id) => document.querySelector(`[data-record-id="${id}"]`)?.scrollIntoView({ block: 'center' }), id);
  await wait(page, 600);
  const r = await page.evaluate((id) => {
    const e = document.querySelector(`[data-record-id="${id}"]`); if (!e) return null;
    const z = e.querySelector('.zone-container') || e;
    const w = document.createTreeWalker(z, NodeFilter.SHOW_TEXT); let last = null, n;
    while ((n = w.nextNode())) if (n.textContent.replace(/\u200b/g, '').length) last = n;
    if (!last) { const b = z.getBoundingClientRect(); return { x: b.x + 10, y: b.y + Math.min(b.height / 2, 14) }; }
    const rg = document.createRange(); rg.setStart(last, last.textContent.length); rg.collapse(true);
    const rc = rg.getClientRects()[0] || rg.getBoundingClientRect();
    return { x: rc.x - 1, y: rc.y + rc.height / 2 };
  }, id);
  if (!r) throw new Error('block not rendered: ' + id);
  await page.mouse.click(r.x, r.y, { label: 'place caret in block' });
  await wait(page, 300);
  const c = await caretInfo(page);
  if (!c || c.id !== id) throw new Error('caret landed in another block: ' + JSON.stringify(c));
  await page.keyboard.press(KEYS.lineEnd);
  return c;
}

export async function slash(page, word) {
  await page.keyboard.type('/');
  await wait(page, 500);
  await page.keyboard.type(word);
  await wait(page, 1100);
  await page.keyboard.press('Enter');
  await wait(page, 1100);
}

// ---- title ----------------------------------------------------------------
export async function setTitle(page, text) {
  const r = await page.evaluate(() => {
    const e = document.querySelector('.page-block-header [contenteditable="true"]'); if (!e) return null;
    e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + 40, y: b.y + b.height / 2 };
  });
  if (!r) throw new Error('title not found');
  await wait(page, 400);
  await page.mouse.click(r.x, r.y, { label: 'click doc title' });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
  await wait(page, 500);
  const now = await page.evaluate(() => document.querySelector('.page-block-header [contenteditable="true"]').innerText.replace(/\u200b/g, '').trim());
  if (now !== text) throw new Error('title is now ' + JSON.stringify(now));
  return now;
}

// ---- reading --------------------------------------------------------------
export async function fullTop(page) {
  const seen = new Set(), order = [];
  const { sh } = await scrollBox(page, 0);
  for (let y = 0; y <= sh + 1200; y += 450) {
    await scrollBox(page, y);
    await wait(page, 450);
    const items = await page.evaluate(() => {
      const root = document.querySelector('[data-block-type="page"]');
      let c = root; while (c && !(c.scrollHeight > c.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(c).overflowY))) c = c.parentElement;
      const base = c.getBoundingClientRect().top - c.scrollTop;
      return [...root.querySelectorAll('[data-block-type]')].filter(b => b.parentElement.closest('[data-block-type]') === root)
        .map(b => ({ id: b.getAttribute('data-record-id'), type: b.getAttribute('data-block-type'), text: (b.querySelector('.zone-container') || { innerText: '' }).innerText.replace(/\u200b/g, '').trim().slice(0, 80), y: b.getBoundingClientRect().top - base }));
    });
    for (const it of items) if (it.id && !seen.has(it.id)) { seen.add(it.id); order.push(it); }
  }
  order.sort((a, b) => a.y - b.y);
  return order.map(({ y, ...rest }) => rest);
}

// Whole document as a tree (text of every block, nesting preserved). Whiteboard content is canvas and not readable.
export async function tree(page) {
  const nodes = {}, top = [];
  const { sh } = await scrollBox(page, 0);
  for (let y = 0; y <= sh + 1200; y += 300) {
    await scrollBox(page, y);
    await wait(page, 800);
    const items = await page.evaluate(() => {
      const root = document.querySelector('[data-block-type="page"]');
      let sc = root; while (sc && !(sc.scrollHeight > sc.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      const base = sc.getBoundingClientRect().top - sc.scrollTop;
      return [...root.querySelectorAll('[data-block-type]')].map(b => {
        const par = b.parentElement.closest('[data-block-type]');
        const kids = [...b.querySelectorAll('[data-block-type]')].filter(k => k.parentElement.closest('[data-block-type]') === b).map(k => k.getAttribute('data-record-id'));
        return { id: b.getAttribute('data-record-id'), type: b.getAttribute('data-block-type'), text: (b.querySelector('.zone-container') || { innerText: '' }).innerText.replace(/\u200b/g, '').trim(), parent: par === root ? 'ROOT' : par?.getAttribute('data-record-id'), kids, y: b.getBoundingClientRect().top - base };
      });
    });
    for (const it of items) {
      if (!it.id) continue;
      if (!nodes[it.id]) { nodes[it.id] = it; if (it.parent === 'ROOT') top.push(it.id); }
      else {
        if (it.kids.length > nodes[it.id].kids.length) nodes[it.id].kids = it.kids;
        if (it.text.length > nodes[it.id].text.length) nodes[it.id].text = it.text; // cells render lazily
      }
    }
  }
  top.sort((a, b) => nodes[a].y - nodes[b].y);
  const title = await page.evaluate(() => document.querySelector('.page-block-header [contenteditable="true"]')?.innerText.replace(/\u200b/g, '').trim());
  await scrollBox(page, 0);
  const build = (id) => { const n = nodes[id]; if (!n) return { id, missing: true }; const o = { type: n.type, text: n.text, id }; if (n.kids.length && n.type !== 'table_cell') o.children = n.kids.map(build); return o; };
  return { title, blocks: top.map(build) };
}

export const treeToText = (t) => {
  const out = ['# ' + t.title];
  const walk = (b, d) => {
    if (b.type === 'table') { out.push('  '.repeat(d) + 'table: ' + (b.children || []).map(c => c.text).join(' | ')); return; }
    if (b.type === 'table_cell') return;
    out.push('  '.repeat(d) + `${b.type}: ${b.text}`);
    for (const c of b.children || []) walk(c, d + 1);
  };
  t.blocks.forEach(b => walk(b, 0));
  return out.join('\n');
};

// ---- markdown with rich slots ---------------------------------------------
// Plain Markdown pastes as native blocks. Fenced ```callout / ```mermaid / ```grid
// blocks, lone image lines ![](abs/path) and lines with colour markup ({red:..},
// {bg-green:..}, ==..==, {{green:label}}) become placeholders filled afterwards.
const stripColors = (l) => { let p; do { p = l; l = l.replace(new RegExp(`\\{(?:bg-)?(?:${Object.keys(K.CALLOUT).join('|')}):([^{}]*)\\}`, 'g'), '$1'); } while (l !== p); return l.replace(/==([^=]+)==/g, '$1'); };
export function prepare(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [], slots = [];
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^```(callout|mermaid|grid)\b(.*)$/);
    const img = lines[i].match(/^!\[[^\]]*\]\((\/[^)]+)\)\s*$/);
    if (f) {
      const body = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      const key = `@@FS${slots.length + 1}@@`;
      slots.push({ key, kind: f[1], opts: (f[2] || '').trim(), body: body.join('\n') });
      out.push(key);
    } else if (/^\s*>/.test(lines[i])) {
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i]);
      i--;
      const key = `@@FS${slots.length + 1}@@`;
      slots.push({ key, kind: 'line', body: body.join('\n') });
      out.push(key);
    } else if (/^\s*\|/.test(lines[i]) && K.hasStyle(lines[i])) {
      out.push(stripColors(lines[i])); // table cells: colour markup isn't supported, keep the text
    } else if (K.hasStyle(lines[i])) {
      const key = `@@FS${slots.length + 1}@@`;
      slots.push({ key, kind: 'line', body: lines[i].replace(/^\s+(?=[-*\d])/, '') });
      out.push(key);
    } else if (img) {
      const key = `@@FS${slots.length + 1}@@`;
      slots.push({ key, kind: 'image', body: img[1] });
      out.push(key);
    } else if (/^```/.test(lines[i])) {
      out.push(lines[i]);
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) out.push(lines[i]);
      if (i < lines.length) out.push(lines[i]);
    } else if (lines[i].trim() !== '') out.push(lines[i]); // blank lines would become empty paragraphs
  }
  return { main: out.join('\n'), slots };
}
const squeeze = (s) => s.split('\n').filter(l => l.trim()).join('\n');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Find a placeholder paragraph, verify the caret is in it, empty it.
async function focusSlot(page, key) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = await find(page, { type: 'text', text: key });
    if (!id) continue;
    try { await clickEnd(page, id); } catch (e) { continue; }
    // Feishu updates its selection asynchronously; a fast driver (Playwright) can press the
    // next key before the click landed. Wait, and only delete once exactly the slot is selected.
    let ok = false;
    for (let k = 0; k < 3 && !ok; k++) {
      await wait(page, 250);
      await page.keyboard.press(KEYS.lineEnd);
      await wait(page, 150);
      await page.keyboard.press(KEYS.selectToLineStart);
      await wait(page, 250);
      ok = await page.evaluate((key) => getSelection().toString().replace(/[\u200b\n]/g, '') === key, key);
    }
    if (!ok) continue;
    await page.keyboard.press('Backspace');
    await wait(page, 300);
    const c = await caretInfo(page);
    if (!c || c.id !== id || c.type !== 'text' || c.text !== '') throw new Error('slot not emptied cleanly: ' + JSON.stringify(c));
    return c;
  }
  throw new Error('could not focus ' + key);
}

async function fillSlot(page, s) {
  const c0 = await focusSlot(page, s.key);
  if (s.kind === 'mermaid') {
    await page.keyboard.paste({ text: s.body, html: `<pre><code class="language-mermaid">${esc(s.body)}</code></pre>` });
    await wait(page, 5000 + s.body.length * 4);
    await dropEmptyAfter(page, 'whiteboard');
  } else if (s.kind === 'callout' || s.kind === 'grid' || s.kind === 'line') {
    await pasteRecords(page, s);
  } else if (s.kind === 'image') {
    if (page.pasteFile) {          // Chrome engine: paste the file, like a screenshot
      await page.pasteFile(s.body);
    } else {                       // ego engine: /图片 opens a file chooser it can fill
      await page.keyboard.type('/');
      await wait(page, 500);
      await page.keyboard.type('图片');
      await wait(page, 1200);
      const chooser = page.waitForFileChooser({ timeout: 10000 });
      await page.keyboard.press('Enter');
      await (await chooser).setFiles(s.body);
    }
    await wait(page, 8000);
  }
  return { slot: s.key, kind: s.kind, in: c0.id };
}

// After a paste Feishu sometimes leaves the emptied placeholder paragraph behind the new
// block (when the next block isn't a heading). If the caret sits in an empty top-level
// paragraph right after a block of the expected type, delete it (verified by deleteBlock).
async function dropEmptyAfter(page, prevType) {
  const c = await caretInfo(page);
  if (!c || c.type !== 'text' || c.text !== '' || c.chain.length !== 2) return;
  const prev = await page.evaluate((id) => { let e = document.querySelector(`[data-record-id="${id}"]`)?.previousElementSibling; while (e && !e.hasAttribute('data-block-type')) e = e.previousElementSibling; return e?.getAttribute('data-block-type'); }, c.id);
  if (prev === prevType) await deleteBlock(page, { id: c.id }).catch(() => {});
}

// Callouts (any colour/icon), N-column grids and colour-styled lines are pasted as
// Feishu record data (see lark.mjs). Content the compiler can't express (tables, code,
// images) goes in as a placeholder that is then filled with a plain Markdown paste.
async function pasteRecords(page, s) {
  const fills = [];
  const bodyNodes = (md, key) => {
    const n = K.compileLines(md.split('\n'));
    if (n && n.length) return n;
    if (n && !n.length) return [{ type: 'text', text: '', props: {}, children: [] }];
    fills.push({ key, md });
    return [{ type: 'text', text: key, props: {}, children: [] }];
  };
  let nodes;
  if (s.kind === 'line') {
    nodes = K.compileLines(s.body.split('\n'));
    if (!nodes) throw new Error('cannot style this line: ' + s.body);
  } else if (s.kind === 'callout') {
    nodes = [K.callout(K.parseSpec(s.opts), bodyNodes(s.body, s.key.replace(/@@$/, 'b@@')))];
  } else {
    const parts = s.body.split(/^---col---\s*$/m);
    const specs = (s.opts || '').split('|').map(K.parseSpec);
    nodes = [K.grid(parts.map((p, j) => {
      const spec = { ...(specs[j] || specs[specs.length - 1] || {}) };
      const body = bodyNodes(p, s.key.replace(/@@$/, `c${j + 1}@@`));
      return { width: spec.width, nodes: spec.plain ? body : [K.callout(spec, body)] };
    }))];
  }
  const { html, text } = K.payload(nodes);
  await page.keyboard.paste({ text, html });
  await wait(page, 1500 + html.length / 200);
  // When the next block isn't a heading, Feishu leaves the (now empty) placeholder
  // paragraph after the pasted blocks. Remove it, verified like any other delete.
  await dropEmptyAfter(page, nodes[nodes.length - 1].type);
  for (const f of fills.reverse()) { // bottom-up
    await focusSlot(page, f.key);
    await page.keyboard.paste({ text: squeeze(f.md) });
    await wait(page, 1500);
  }
}

// Paste Markdown at the caret (which must sit in an empty top-level paragraph), then fill slots bottom-up.
export async function pasteRich(page, md) {
  const { main, slots } = prepare(md);
  const c = await caretInfo(page);
  if (!c || c.type !== 'text' || c.text !== '') throw new Error('caret must be in an empty paragraph: ' + JSON.stringify(c));
  await page.keyboard.paste({ text: main });
  await wait(page, 3000 + main.split('\n').length * 25);
  const done = [];
  for (const s of [...slots].reverse()) done.push(await fillSlot(page, s)); // bottom-up: layout above stays put
  return { lines: main.split('\n').length, slots: done.length };
}

// ---- positioning ------------------------------------------------------------
// New empty top-level paragraph right after a text/heading block (or reuse it if it is an empty paragraph).
export async function paragraphAfter(page, m) {
  const id = await find(page, m);
  if (!id) throw new Error('anchor not found: ' + JSON.stringify(m));
  const meta = await blockMeta(page, id);
  if (meta.type === 'text' && meta.text === '') { await clickEnd(page, id); return id; }
  if (!/^(text|heading\d)$/.test(meta.type)) throw new Error(`anchor is a ${meta.type}; anchor on a text or heading block`);
  await clickEnd(page, id);
  await page.keyboard.press('Enter');
  await wait(page, 500);
  const c = await caretInfo(page);
  if (!c || c.type !== 'text' || c.text !== '' || c.parent !== meta.parent || c.id === id) throw new Error('new paragraph not as expected: ' + JSON.stringify(c));
  return c.id;
}

export async function paragraphAtEnd(page) {
  const top = (await fullTop(page)).filter(b => b.type !== 'back_ref_list');
  const last = top[top.length - 1];
  if (!last) throw new Error('empty document');
  if ((last.type === 'text' && last.text === '') || /^(text|heading\d)$/.test(last.type)) return paragraphAfter(page, { id: last.id });
  throw new Error(`last block is a ${last.type}; use "after" with a text or heading block`);
}

// ---- editing ----------------------------------------------------------------
// Replace one block's text. Backspaces one key at a time and re-checks the caret (Cmd+A here can select the whole doc).
export async function editText(page, m, newText) {
  const id = await find(page, m);
  if (!id) throw new Error('block not found: ' + JSON.stringify(m));
  const before = await blockMeta(page, id);
  await clickEnd(page, id);
  for (let k = 0; k < [...before.text].length + 10; k++) {
    const c = await caretInfo(page);
    if (!c || c.id !== id) throw new Error('caret left block while deleting: ' + JSON.stringify(c));
    if (c.text === '') break;
    await page.keyboard.press('Backspace');
  }
  const c = await caretInfo(page);
  if (c.text !== '' || c.type !== before.type) throw new Error('block not emptied cleanly: ' + JSON.stringify(c));
  await page.keyboard.insertText(newText);
  await wait(page, 400);
  return { id, type: before.type, from: before.text, to: (await caretInfo(page)).text };
}

// Add a sibling (same type, same parent) after a block — e.g. another bullet or todo.
export async function addAfter(page, m, text) {
  const id = await find(page, m);
  if (!id) throw new Error('block not found: ' + JSON.stringify(m));
  const meta = await blockMeta(page, id);
  await clickEnd(page, id);
  await page.keyboard.press('Enter');
  await wait(page, 500);
  const c = await caretInfo(page);
  if (!c || c.type !== meta.type || c.parent !== meta.parent || c.text !== '' || c.id === id) throw new Error('new sibling not as expected: ' + JSON.stringify(c));
  await page.keyboard.insertText(text);
  await wait(page, 400);
  return { after: id, type: c.type, text };
}

// Delete one top-level block (image, whiteboard, paragraph...). Undoes if anything else changed.
export async function deleteBlock(page, m) {
  const id = await find(page, m);
  if (!id) throw new Error('block not found: ' + JSON.stringify(m));
  const before = await fullTop(page);
  await find(page, { id });
  await page.evaluate((id) => document.querySelector(`[data-record-id="${id}"]`).scrollIntoView({ block: 'center' }), id);
  await wait(page, 1200);
  const r = await page.evaluate((id) => { const b = document.querySelector(`[data-record-id="${id}"]`).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 300) }; }, id);
  await page.mouse.click(r.x, r.y, { label: 'select block' });
  await wait(page, 800);
  await page.keyboard.press('Backspace');
  await wait(page, 1500);
  const after = await fullTop(page);
  const a = new Set(after.map(x => x.id)), b = new Set(before.map(x => x.id));
  const removed = before.filter(x => !a.has(x.id)), added = after.filter(x => !b.has(x.id));
  if (removed.length !== 1 || removed[0].id !== id || added.length) {
    await page.keyboard.press('Escape');
    if (removed.length || added.length) { // only undo if something actually changed, or Cmd+Z would revert an earlier edit
      await page.keyboard.press(KEYS.undo);
      await wait(page, 1500);
      throw new Error('unexpected delete result, undone: ' + JSON.stringify({ removed, added }));
    }
    throw new Error('nothing was deleted (block may need a different selection method)');
  }
  return { deleted: id, type: removed[0].type };
}

// ---- screenshots --------------------------------------------------------------
export async function shots(page, dir) {
  const fs = await import('node:fs/promises');
  await fs.mkdir(dir, { recursive: true });
  const { sh, ch } = await scrollBox(page, 0);
  const files = [];
  for (let y = 0, i = 0; y < sh; y += Math.round(ch * 0.9), i++) {
    await scrollBox(page, y);
    await wait(page, 1500);
    const f = `${dir}/page_${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
  await scrollBox(page, 0);
  return files;
}

// Caret into the first body paragraph. A brand-new doc has no body block yet:
// pressing Enter at the end of the title creates one.
export async function firstParagraph(page) {
  const top = (await fullTop(page)).filter(b => b.type !== 'back_ref_list');
  const first = top[0];
  if (first && first.type === 'text' && first.text === '') { await clickEnd(page, first.id); return first.id; }
  if (first) throw new Error('doc body is not empty');
  const r = await page.evaluate(() => {
    const e = document.querySelector('.page-block-header [contenteditable="true"]'); if (!e) return null;
    e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.right - 4, y: b.y + b.height / 2 };
  });
  await page.mouse.click(r.x, r.y, { label: 'click end of title' });
  await page.keyboard.press(KEYS.lineEnd);
  await page.keyboard.press('Enter');
  await wait(page, 800);
  const c = await caretInfo(page);
  if (!c || c.type !== 'text' || c.text !== '' || c.chain.length !== 2) throw new Error('could not create first paragraph: ' + JSON.stringify(c));
  return c.id;
}

export async function isEmptyDoc(page) {
  const top = (await fullTop(page)).filter(b => b.type !== 'back_ref_list');
  return top.every(b => b.type === 'text' && b.text === '');
}

// Replace one occurrence of `findStr` inside a block, keeping the rest of the block
// (bold, links, emoji) untouched. Selects the substring with Shift+Arrow from a
// verified caret position, so nothing outside the block can be selected.
const graphemes = (s) => { try { return [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(s)].length; } catch { return [...s].length; } };
export async function replaceText(page, m, findStr, repl) {
  const id = await find(page, m);
  if (!id) throw new Error('block not found: ' + JSON.stringify(m));
  const locate = () => page.evaluate(([id, f]) => {
    const e = document.querySelector(`[data-record-id="${id}"]`); if (!e) return { err: 'not rendered' };
    e.scrollIntoView({ block: 'center' });
    const z = e.querySelector('.zone-container') || e;
    const w = document.createTreeWalker(z, NodeFilter.SHOW_TEXT); let s = '', map = [], n;
    while ((n = w.nextNode())) for (let i = 0; i < n.textContent.length; i++) { if (n.textContent[i] === '\u200b') continue; map.push([n, i]); s += n.textContent[i]; }
    const idx = s.indexOf(f);
    if (idx < 0) return { err: 'text not in block', s: s.slice(0, 120) };
    if (s.indexOf(f, idx + 1) >= 0) return { err: 'text occurs more than once in block' };
    const [node, off] = map[idx + f.length - 1];
    const rg = document.createRange(); rg.setStart(node, off + 1); rg.collapse(true);
    const rc = rg.getClientRects()[0] || rg.getBoundingClientRect();
    return { x: rc.x - 1, y: rc.y + rc.height / 2, target: idx + f.length, full: s };
  }, [id, findStr]);
  const caretOff = () => page.evaluate((id) => {
    const s = getSelection(); const e = document.querySelector(`[data-record-id="${id}"]`); const z = e.querySelector('.zone-container') || e;
    if (!s.anchorNode || !z.contains(s.anchorNode)) return null;
    const rg = document.createRange(); rg.setStart(z, 0); rg.setEnd(s.anchorNode, s.anchorOffset);
    return rg.toString().replace(/\u200b/g, '').length;
  }, id);
  let r = await locate();
  if (r.err) throw new Error(r.err + (r.s ? ': ' + r.s : ''));
  await wait(page, 500);
  r = await locate();
  await page.mouse.click(r.x, r.y, { label: 'place caret after text' });
  await wait(page, 300);
  for (let k = 0; k < 4; k++) {
    const off = await caretOff();
    if (off === null) throw new Error('caret not in target block');
    const d = r.target - off;
    if (d === 0) break;
    if (Math.abs(d) > 6) throw new Error(`caret off by ${d}`);
    for (let j = 0; j < Math.abs(d); j++) await page.keyboard.press(d > 0 ? 'ArrowRight' : 'ArrowLeft');
    await wait(page, 150);
  }
  if ((await caretOff()) !== r.target) throw new Error('could not place caret');
  for (let j = 0; j < graphemes(findStr); j++) await page.keyboard.press('Shift+ArrowLeft');
  await wait(page, 200);
  const sel = await page.evaluate(() => getSelection().toString().replace(/\u200b/g, ''));
  if (sel !== findStr) { await page.keyboard.press('ArrowRight'); throw new Error(`selection mismatch: ${JSON.stringify(sel)}`); }
  await page.keyboard.press('Backspace');
  await wait(page, 200);
  if (repl) await page.keyboard.insertText(repl);
  await wait(page, 400);
  const after = await page.evaluate((id) => { const e = document.querySelector(`[data-record-id="${id}"]`); return (e.querySelector('.zone-container') || e).innerText.replace(/\u200b/g, ''); }, id);
  const want = r.full.replace(findStr, repl || '');
  if (after.replace(/\s+/g, '') !== want.replace(/\s+/g, '')) throw new Error('result differs: ' + after.slice(0, 120));
  return { id, from: findStr, to: repl || '' };
}
