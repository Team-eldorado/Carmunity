// 녹화 자동화 공용 도구: Chrome DevTools Protocol(스튜디오 한 창 + 폰 iframe 두 개), 서버 API, Virtual Console, adb
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const REC = dirname(fileURLToPath(import.meta.url));
export const API = 'http://localhost:8080';
export const VC = 'http://127.0.0.1:8088';
export const CDP_PORT = 9333;
export const CDP = `http://127.0.0.1:${CDP_PORT}`;
export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const ADB = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
export const STUDIO_URL = `${API}/#/studio`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${j.message}`);
  return j;
}
// Virtual Console은 브라우저 페이지의 하트비트가 있어야 값을 받는다
export function startHeartbeat() {
  const hb = () => fetch(VC + '/browser/session?client=evn-rec', { method: 'POST' }).catch(() => {});
  hb();
  return setInterval(hb, 1500);
}
export const vc = (path) => fetch(VC + path, { method: 'PUT' }).then((r) => r.text());
export const snap = () => api('GET', '/api/admin/snapshot');
export async function waitFor(fn, timeout = 30000, step = 250) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timeout');
    await sleep(step);
  }
}

// ---------------- Chrome DevTools Protocol ----------------
export class Conn {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ready.catch(() => {});
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) {
        const { res, rej } = this.pending.get(d.id);
        this.pending.delete(d.id);
        d.error ? rej(new Error(d.error.message)) : res(d.result);
      }
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  async close() { try { await this.ready; this.ws.close(); } catch { /* */ } }
}

export class Studio {
  constructor(target) { this.target = target; this.c = new Conn(target.webSocketDebuggerUrl); }
  async eval(expression) {
    const r = await this.c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
  call(fn, ...args) { return this.eval(`window.studio.${fn}(${args.map((a) => JSON.stringify(a)).join(',')})`); }
  phone(n) { return new Phone(this, n); }
}

// 스튜디오 안의 폰 iframe (같은 출처라 contentWindow.eval로 조작)
export class Phone {
  constructor(studio, n) { this.s = studio; this.n = n; }
  eval(expr) {
    return this.s.eval(`window.studio.frame(${this.n}).eval(${JSON.stringify(expr)})`);
  }
  hash(h) { return this.eval(`location.hash = ${JSON.stringify(h)}; true`); }
  reload() { return this.eval('location.reload(); true'); }
  // 버튼 글자로 찾아 누르기 (누른 자리에 터치 표시)
  clickText(text, sel = 'button,a', timeout = 8000) {
    return waitFor(() => this.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent !== null && x.textContent.replace(/\\s+/g,' ').includes(${JSON.stringify(text)}) && !x.disabled); if (!b) return false; b.scrollIntoView({block:'center', behavior:'instant'}); const r = b.getBoundingClientRect(); window.recTap && recTap(r.left + r.width/2, r.top + r.height/2); setTimeout(() => b.click(), 150); return true; })()`), timeout);
  }
  async type(selector, value) {
    await waitFor(() => this.eval(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); if (!i) return false; i.scrollIntoView({block:'center'}); const r = i.getBoundingClientRect(); window.recTap && recTap(r.left + r.width/2, r.top + r.height/2); i.focus(); i.value = ''; return true; })()`));
    for (let k = 1; k <= value.length; k++) {
      await this.eval(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.value = ${JSON.stringify(value.slice(0, k))}; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
      await sleep(140);
    }
  }
  check(labelText) {
    return waitFor(() => this.eval(`(() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.includes(${JSON.stringify(labelText)})); if (!l) return false; const i = l.querySelector('input'); l.scrollIntoView({block:'center'}); const r = i.getBoundingClientRect(); window.recTap && recTap(r.left + r.width/2, r.top + r.height/2); if (!i.checked) i.click(); return true; })()`));
  }
  holdDown() { return this.eval(`(() => { const b = document.querySelector('.hold'); if (!b) return false; b.scrollIntoView({block:'center'}); const r = b.getBoundingClientRect(); window.recPress && recPress(true, r.left + r.width/2, r.top + r.height/2); b.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); return true; })()`); }
  holdUp() { return this.eval(`(() => { window.recPress && recPress(false); const b = document.querySelector('.hold'); if (b) b.dispatchEvent(new PointerEvent('pointerup', {bubbles:true})); return true; })()`); }
  scroll(y) { return this.eval(`window.scrollTo({top:${y}, behavior:'smooth'}); true`); }
}

export async function targets() { return (await fetch(`${CDP}/json/list`)).json(); }
export async function browser() {
  const v = await (await fetch(`${CDP}/json/version`)).json();
  return new Conn(v.webSocketDebuggerUrl);
}
export function launchChrome(url) {
  const p = spawn(CHROME, [
    `--user-data-dir=${join(REC, 'chrome-rec')}`, `--remote-debugging-port=${CDP_PORT}`, '--no-first-run',
    '--no-default-browser-check', '--disable-features=Translate,TranslateUI', '--disable-session-crashed-bubble',
    '--force-device-scale-factor=1', `--app=${url}`,
  ], { detached: true, stdio: 'ignore' });
  p.unref();
}
export async function studioPage() {
  const t = (await targets()).find((x) => x.type === 'page' && x.url.includes('#/studio'));
  if (!t) throw new Error('스튜디오 창이 없어요 (node setup.mjs)');
  return new Studio(t);
}

export function adb(...args) { return execFileSync(ADB, args, { encoding: 'utf8' }); }

/** 에뮬레이터 화면에서 글자로 버튼 찾아 누르기 (uiautomator) */
export function tapText(text) {
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/ui.xml');
  const re = /<node [^>]*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const n = m[0];
    const t = (n.match(/ text="([^"]*)"/) || [])[1];
    if (t !== text) continue;
    const b = n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!b) continue;
    adb('shell', 'input', 'tap', String(Math.round((+b[1] + +b[3]) / 2)), String(Math.round((+b[2] + +b[4]) / 2)));
    return true;
  }
  return false;
}

/** 차량 앱이 로그로 남긴 버튼 위치(TapTarget)로 누른다. 반복 애니메이션이 있는 카드는 UI 덤프가 안 돼서 이 방법을 쓴다 */
export function tapTarget(text) {
  const log = adb('logcat', '-d', '-s', 'TapTarget:D');
  const lines = log.split(/\r?\n/).filter((l) => l.includes(`TapTarget: ${text}|`));
  const last = lines.at(-1);
  if (!last) return false;
  const [, x, y] = last.split('TapTarget: ')[1].split('|');
  adb('shell', 'input', 'tap', x.trim(), y.trim());
  return true;
}

/** Pleos 시스템 경고창(예: 트렁크 열림)이 앞에 떠 있으면 '확인'을 눌러 닫는다 */
export async function dismissSystemDialogs() {
  for (let i = 0; i < 4; i++) {
    const focus = (adb('shell', 'dumpsys', 'window').match(/mCurrentFocus=.*$/m) || [''])[0];
    if (!/systemdialogdispatcher/.test(focus)) return i;
    adb('shell', 'input', 'tap', '1705', '772');
    await sleep(1200);
  }
  return -1;
}
