// 全新配置复验：确认内置种子配方数量（排除上一轮 localStorage 残留）
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import WebSocket from 'ws';

const ROOT = '/Users/sunguannan/CapCutHelper/color-grading-studio';
const OUT = '/Users/sunguannan/CapCutHelper/color-grading-studio-shots';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9391, HTTP = 5211;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0]));
  const f = join(ROOT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(HTTP, '127.0.0.1', r));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/colordesk-fresh-' + Date.now(), '--window-size=1680,1020', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
let target;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64e6 });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
let seq = 0; const pending = new Map(); const errs = [];
ws.on('message', (raw) => { const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description); });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const shot = async (n) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(data, 'base64')); };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html` });
await sleep(5000);
const seeds = await ev(`window.__colorDesk.recipes().map(r=>r.name)`);
console.log('全新配置种子配方:', JSON.stringify(seeds), seeds.length === 4 ? 'PASS' : 'FAIL');
await shot('00-fresh-initial');
// 演示态：电影青橙 + 色轮 + 商品保真
await ev(`[...document.querySelectorAll('.cat')].find(b=>b.textContent==='质感').click()`);
await sleep(900);
await ev(`window.__colorDesk.selectFilter('tealorange');
  window.__colorDesk.setParam('intensity',72);
  window.__colorDesk.setParam('exposure',10);
  window.__colorDesk.setParam('contrast',14);
  window.__colorDesk.setParam('shadows',16);
  window.__colorDesk.setParam('clarity',22);
  window.__colorDesk.setParam('sharpen',16);
  window.__colorDesk.setParam('grain',7);
  window.__colorDesk.setParam('vignette',20);
  const s=window.__colorDesk.state; s.liftX=-0.30; s.liftY=0.16; s.gainX=0.26; s.gainY=-0.12;
  document.getElementById('protectSwitch').click();`);
await sleep(1200);
await shot('00-demo-graded');
await ev(`document.getElementById('btnCompare').click()`);
await sleep(700);
await shot('00-demo-split');
console.log('页面错误:', errs.length ? errs.slice(0, 3) : '无');
ws.close(); chrome.kill(); server.close(); process.exit(0);