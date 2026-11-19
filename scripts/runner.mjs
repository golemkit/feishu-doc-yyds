// Runs a Feishu task file inside ego-browser. Invoked by run.sh, which passes the
// ego globals in `ctx` (taskSpace etc. are only defined in the top-level script).
import * as L from './lib.mjs';

const STATE = '/tmp/feishu-skill/state.json';

async function openSpace(ctx, T, fs) {
  let state = {};
  try { state = JSON.parse(await fs.readFile(STATE, 'utf8')); } catch {}
  const key = T.url.split('?')[0];
  const want = T.space ?? state[key];
  const list = await ctx.listTaskSpaces();
  const entry = want != null && list.find(s => s.id === want);
  let task;
  if (entry) {
    task = entry.ownership === 'user' ? await ctx.claimTaskSpace(want)
      : entry.ownership === 'agentDelegatedToUser' ? await ctx.takeOverTaskSpace(want)
      : await ctx.taskSpace(want);
  } else {
    task = await ctx.taskSpace('feishu-doc ' + new Date().toISOString().slice(0, 19));
  }
  const page = (await task.pages())[0] ?? await task.adopt((await task.tabs())[0].page);
  if (!(await page.url()).startsWith(key)) {
    await page.goto(T.url, { timeout: 45000 });
    await page.waitForTimeout(6000);
  }
  try { await page.click('text=隐藏', { label: 'hide template panel' }); } catch {}
  state[key] = task.spaceId;
  await fs.mkdir('/tmp/feishu-skill', { recursive: true });
  await fs.writeFile(STATE, JSON.stringify(state, null, 1));
  return { task, page, key, state };
}

export async function run(ctx) {
  const fs = await import('node:fs/promises');
  const T = JSON.parse(await fs.readFile(ctx.taskFile, 'utf8'));
  if (!T.url || !Array.isArray(T.ops)) throw new Error('task needs "url" and "ops"');
  const base = ctx.taskFile.replace(/\.json$/, '');
  const md = async (op) => op.markdownFile ? fs.readFile(op.markdownFile, 'utf8') : op.markdown;
  let page, label, finishDoc, done = async () => {};
  if (ctx.openDoc) { // Chrome engine (or any other engine that supplies openDoc)
    const d = await ctx.openDoc(T);
    ({ page, label } = d); finishDoc = d.finish; done = d.done || done;
  } else {           // ego engine
    const { task, page: pg, key, state } = await openSpace(ctx, T, fs);
    page = pg; label = 'ego space ' + task.spaceId;
    finishDoc = async () => { await task.finish({ keep: [] }); delete state[key]; await fs.writeFile(STATE, JSON.stringify(state, null, 1)); };
  }
  console.log(label, 'url', await page.url());

  const OPS = {
    // read
    outline: async () => { const o = await L.fullTop(page); await fs.writeFile(base + '.outline.json', JSON.stringify(o, null, 1)); return { blocks: o.length, file: base + '.outline.json' }; },
    read: async () => { const t = await L.tree(page); await fs.writeFile(base + '.tree.json', JSON.stringify(t, null, 1)); await fs.writeFile(base + '.tree.txt', L.treeToText(t)); return { file: base + '.tree.txt' }; },
    shots: async (op) => ({ files: await L.shots(page, op.dir || base + '-shots') }),
    screenshot: async (op) => {
      if (op.match) { const id = await L.find(page, op.match); if (!id) throw new Error('not found'); await page.evaluate((id) => document.querySelector(`[data-record-id="${id}"]`).scrollIntoView({ block: 'start' }), id); }
      await page.waitForTimeout(op.waitMs ?? 3000);
      return { file: await page.screenshot({ path: op.file || base + '.png' }) };
    },
    // write
    write: async (op) => {
      if (!op.force && !(await L.isEmptyDoc(page))) throw new Error('doc is not empty; use "insert", or set force:true after the user agreed to overwrite nothing (write only appends into the first empty paragraph)');
      if (op.title) await L.setTitle(page, op.title);
      await L.firstParagraph(page);
      return L.pasteRich(page, await md(op));
    },
    insert: async (op) => {
      if (op.after === 'end' || !op.after) await L.paragraphAtEnd(page); else await L.paragraphAfter(page, op.after);
      return L.pasteRich(page, await md(op));
    },
    setTitle: async (op) => ({ title: await L.setTitle(page, op.text) }),
    edit: async (op) => L.editText(page, op.match, op.text),
    addAfter: async (op) => L.addAfter(page, op.match, op.text),
    replace: async (op) => L.replaceText(page, op.match, op.find, op.with ?? ''),
    // Remove a leading emoji (and the space after it) from a heading or paragraph.
    stripEmoji: async (op) => {
      const id = await L.find(page, op.match);
      if (!id) throw new Error('block not found: ' + JSON.stringify(op.match));
      const { text } = await L.blockMeta(page, id);
      const g = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)].map(x => x.segment);
      if (!g.length || !/\p{Extended_Pictographic}/u.test(g[0])) return { id, skipped: 'no leading emoji' };
      let k = 1; while (k < g.length && /^\s$/.test(g[k])) k++;
      return L.replaceText(page, { id }, g.slice(0, k).join(''), '');
    },
    delete: async (op) => L.deleteBlock(page, op.match),
    wait: async (op) => { await page.waitForTimeout(op.ms || 1000); return {}; },
    // Create a blank doc next to the current one (same wiki). Steps verified by hand 2026-11-18.
    create: async () => {
      const plus = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button.ud__button--icon')].map(e => e.getBoundingClientRect()).filter(r => r.y < 60 && r.width > 0 && r.x > innerWidth * 0.6).sort((a, b) => b.x - a.x)[0];
        return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      if (!plus) throw new Error('create (+) button not found');
      await page.mouse.click(plus.x, plus.y, { label: 'open create menu' });
      await page.waitForTimeout(1500);
      await page.click('text="文档"', { label: 'choose 文档' });
      await page.waitForTimeout(2500);
      const popup = page.waitForEvent('popup', { timeout: 15000 });
      await page.click('text="新建空白文档"', { label: 'blank doc' });
      const np = await popup;
      await np.waitForTimeout(5000);
      try { await np.click('text=我知道了', { label: 'dismiss notice' }); } catch {}
      const url = (await np.url()).split('?')[0];
      await np.close();
      return { url };
    },
    // Only for a doc this session created itself (scratch/test content): select-all + delete in the body.
    clearBody: async (op) => {
      if (op.confirm !== 'created-by-me') throw new Error('clearBody needs confirm:"created-by-me" (never on a user doc)');
      const top = await L.fullTop(page);
      const first = top.find(b => b.type !== 'back_ref_list');
      await L.clickEnd(page, first.id).catch(async () => { await L.find(page, { id: first.id }); });
      for (let k = 0; k < 3; k++) await page.keyboard.press('ControlOrMeta+A');
      await page.waitForTimeout(300);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(1500);
      const left = (await L.fullTop(page)).filter(b => b.type !== 'back_ref_list');
      return { left: left.map(b => b.type) };
    },
  };

  const results = [];
  for (const [i, op] of T.ops.entries()) {
    const fn = OPS[op.op];
    try {
      if (!fn) throw new Error('unknown op ' + op.op);
      const r = await fn(op);
      results.push({ i, op: op.op, ok: true, r });
      console.log(`[${i}] ${op.op} ok ${JSON.stringify(r ?? {}).slice(0, 300)}`);
    } catch (e) {
      results.push({ i, op: op.op, ok: false, error: e.message });
      console.log(`[${i}] ${op.op} FAILED: ${e.message}`);
      if (!T.continueOnError) break; // stop at the first failure; later ops may depend on it
    }
  }
  if (T.finish && results.every(r => r.ok)) {
    await finishDoc();
    console.log('finished');
  }
  await fs.writeFile(base + '.result.json', JSON.stringify({ engine: label, results }, null, 1));
  await done();
}
