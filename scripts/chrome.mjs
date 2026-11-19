// Chrome engine for feishu-doc: drives a normal Google Chrome (or Edge / Chromium)
// through Playwright, and exposes the same small Page API the ego engine provides,
// so lib.mjs and runner.mjs work unchanged.
//
// Chrome runs as a separate, long-lived window with its own profile
// (~/.feishu-doc-chrome) and a local DevTools port, so the Feishu login and the
// loaded doc survive between jobs. Log in to Feishu in that window once.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.FEISHU_CHROME_PORT || 9333);
const PROFILE = process.env.FEISHU_CHROME_PROFILE || path.join(os.homedir(), '.feishu-doc-chrome');
const LOGIN_WAIT_S = Number(process.env.FEISHU_LOGIN_WAIT || 600);
const MAC = process.platform === 'darwin';

function findChrome() {
  if (process.env.FEISHU_CHROME_PATH) return process.env.FEISHU_CHROME_PATH;
  const home = os.homedir();
  const c = MAC ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : process.platform === 'win32' ? [
    `${process.env['PROGRAMFILES']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const hit = c.find(p => p && fs.existsSync(p));
  if (!hit) throw new Error('Chrome not found; set FEISHU_CHROME_PATH');
  return hit;
}

async function alive() {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); return r.ok; } catch { return false; }
}

// On macOS, closing the last window leaves Chrome running with the port open but no
// window, and Playwright then refuses to attach ("Browser context management is not
// supported"). Open a tab through the DevTools HTTP endpoint first.
async function ensureWindow() {
  const pages = async () => { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); return (await r.json()).filter(t => t.type === 'page'); } catch { return []; } };
  if ((await pages()).length) return;
  await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).catch(() => {});
  for (let i = 0; i < 20 && !(await pages()).length; i++) await new Promise(r => setTimeout(r, 300));
}

export async function ensureChrome() {
  if (await alive()) { await ensureWindow(); return { started: false }; }
  fs.mkdirSync(PROFILE, { recursive: true });
  const exe = findChrome();
  const child = spawn(exe, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1500,1000', 'about:blank',
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) { if (await alive()) return { started: true, exe }; await new Promise(r => setTimeout(r, 500)); }
  throw new Error('Chrome did not open its DevTools port ' + PORT);
}

// ---- paste --------------------------------------------------------------------------
// Feishu converts pasted Markdown (text/plain) and Mermaid (text/html <pre><code>) into
// native blocks in its paste handler. First try a synthetic paste event carrying the
// data (no clipboard involved). If the editor ignores it, fall back to the real
// clipboard + a native paste command.
async function paste(p, arg) {
  const { text = '', html } = typeof arg === 'string' ? { text: arg } : (arg || {});
  const handled = await p.evaluate(({ text, html }) => {
    const s = getSelection();
    const n = s && s.anchorNode ? (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement) : document.activeElement;
    if (!n) return false;
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    if (html) dt.setData('text/html', html);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
    n.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, { text, html });
  if (handled) return { via: 'event' };
  if (process.env.FEISHU_DEBUG) console.log('paste: synthetic event ignored, using the clipboard');
  // fallback: real clipboard, then the editor's native paste
  const ctx = p.context();
  try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(p.url()).origin }); } catch {}
  await p.evaluate(async ({ text, html }) => {
    const items = { 'text/plain': new Blob([text], { type: 'text/plain' }) };
    if (html) items['text/html'] = new Blob([html], { type: 'text/html' });
    await navigator.clipboard.write([new ClipboardItem(items)]);
  }, { text, html });
  if (MAC) {
    const cdp = await ctx.newCDPSession(p);
    const base = { modifiers: 4, key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, commands: ['paste'] };
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base, commands: undefined });
    await cdp.detach();
  } else {
    await p.keyboard.press('Control+V');
  }
  return { via: 'clipboard' };
}

// Images: paste the file itself (like pasting a screenshot). Feishu's /图片 upload in
// Chrome doesn't raise a file chooser Playwright can intercept, but a pasted File works.
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
async function pasteFile(p, file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const b64 = fs.readFileSync(file).toString('base64');
  const ok = await p.evaluate(({ b64, name, type }) => {
    const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bin], name, { type }));
    const s = getSelection();
    const n = s && s.anchorNode ? (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement) : null;
    if (!n) return false;
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
    n.dispatchEvent(ev); return ev.defaultPrevented;
  }, { b64, name: path.basename(file), type: MIME[ext] || 'application/octet-stream' });
  if (!ok) throw new Error('image paste was not accepted by the editor');
  return { via: 'file-paste' };
}

// ---- ego-compatible Page wrapper ------------------------------------------------------
const noLabel = (o) => { if (!o || typeof o !== 'object') return o; const { label, ...rest } = o; return rest; };
let shotN = 0;
export function wrap(p) {
  return {
    raw: p,
    evaluate: (fn, arg) => p.evaluate(fn, arg),
    waitForTimeout: (ms) => p.waitForTimeout(ms),
    url: async () => p.url(),
    title: () => p.title(),
    goto: (u, o = {}) => p.goto(u, { waitUntil: 'domcontentloaded', ...o }),
    screenshot: async (o = {}) => { const file = o.path || path.join(os.tmpdir(), `feishu-shot-${process.pid}-${shotN++}.png`); await p.screenshot({ path: file }); return file; },
    click: (sel, o) => p.click(sel, { timeout: 8000, ...noLabel(o) }),
    close: () => p.close(),
    pasteFile: (file) => pasteFile(p, file), // Chrome-only; lib.mjs uses it for images when present
    waitForEvent: async (name, o) => {
      const ev = await p.waitForEvent(name, noLabel(o));
      return name === 'popup' ? wrap(ev) : ev;
    },
    waitForFileChooser: async (o) => {
      const fc = await p.waitForEvent('filechooser', noLabel(o));
      return { setFiles: (files) => fc.setFiles(files) };
    },
    mouse: {
      click: (x, y, o) => p.mouse.click(x, y, noLabel(o)),
      move: (x, y, o) => p.mouse.move(x, y, noLabel(o)),
      down: (o) => p.mouse.down(noLabel(o)),
      up: (o) => p.mouse.up(noLabel(o)),
      wheel: (dx, dy) => p.mouse.wheel(dx, dy),
    },
    keyboard: {
      press: (k) => p.keyboard.press(k),
      type: (t) => p.keyboard.type(t),
      insertText: (t) => p.keyboard.insertText(t),
      paste: (arg) => paste(p, arg),
    },
  };
}

// ---- open a doc (same contract as the ego engine's openSpace) --------------------------
async function editorReady(p) {
  return p.evaluate(() => !!document.querySelector('[data-block-type="page"]')).catch(() => false);
}

export async function openDoc(T) {
  const s = await ensureChrome();
  if (s.started) console.log('chrome started', s.exe, 'profile', PROFILE);
  let browser;
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); }
  catch (e) { await ensureWindow(); await new Promise(r => setTimeout(r, 1000)); browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); }
  const ctx = browser.contexts()[0];
  const key = T.url.split('?')[0];
  let p = ctx.pages().find(x => x.url().split('?')[0] === key);
  if (!p) {
    p = ctx.pages().find(x => x.url() === 'about:blank') || await ctx.newPage();
    await p.goto(T.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await p.bringToFront();
  await p.setViewportSize({ width: 1500, height: 920 }).catch(() => {});
  for (let i = 0; i < 20 && !(await editorReady(p)); i++) await p.waitForTimeout(500);
  if (!(await editorReady(p))) {
    console.log(`LOGIN NEEDED: log in to Feishu in the Chrome window that just opened (profile ${PROFILE}). Waiting up to ${LOGIN_WAIT_S}s...`);
    const until = Date.now() + LOGIN_WAIT_S * 1000;
    while (Date.now() < until) {
      await p.waitForTimeout(3000);
      if (!p.url().split('?')[0].startsWith(key) && /feishu\.cn|larksuite\.com/.test(p.url()) && !/login|passport|accounts|suite\/login/i.test(p.url())) {
        await p.goto(T.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      }
      if (await editorReady(p)) break;
    }
    if (!(await editorReady(p))) throw new Error('Feishu editor not reachable (not logged in?) at ' + p.url());
    console.log('logged in');
  }
  await p.waitForTimeout(2500);
  const page = wrap(p);
  return {
    page,
    label: 'chrome:' + PORT,
    // keep the window and login; just leave the tab open unless asked to close it
    finish: async () => { if (ctx.pages().length > 1) await p.close(); else await p.goto('about:blank'); },
    // don't call browser.close(): on a CDP connection it can close the user's Chrome window
    done: async () => {},
  };
}
