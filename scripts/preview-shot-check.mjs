// 无头 Chrome + CDP 交互验证脚本：截图模版编辑器预览的多个状态。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import WebSocket from 'ws';

const OUT = '/Users/sunguannan/CapCutHelper/tmp-preview-shots';
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const URL_TARGET = process.env.SHOT_URL || 'http://127.0.0.1:5198/__template_preview?preset=sentence-image';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/capcut-preview-chrome', '--window-size=1680,1000', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(item => item.type === 'page');
      if (page) return page;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools 未就绪');
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params.exceptionDetails?.exception?.description || JSON.stringify(message.params));
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map(arg => arg.value || arg.description || '').join(' '));
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL_TARGET });
await sleep(6000);

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log('shot', name);
};
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const rectOf = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`);
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(250);
};
const clickSelector = async (selector) => {
  const rect = await rectOf(selector);
  if (!rect) throw new Error(`缺少元素 ${selector}`);
  await click(rect.x + rect.width / 2, rect.y + rect.height / 2);
};
const key = async (name, code, windowsVirtualKeyCode) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode });
};
const pressRight = async (times) => { for (let i = 0; i < times; i++) await key('ArrowRight', 'ArrowRight', 39); };

await shot('01-initial');
console.log('initial stage rect:', JSON.stringify(await rectOf('.template-preview-stage')),
  'zoom:', await evaluate(`document.querySelector('.template-preview-zoom')?.textContent`));
const stage = await rectOf('.template-preview-stage');
console.log('stage', JSON.stringify(stage));
if (!stage) {
  console.log('console errors:', consoleErrors.slice(0, 10));
  console.log('body:', await evaluate('document.body.innerText.slice(0, 400)'));
  console.log('root html:', await evaluate('document.getElementById("root")?.innerHTML.slice(0, 300)'));
  ws.close();
  chrome.kill();
  process.exit(1);
}
// 选中画布中心元素（图片），验证选中框与点击选择。
await click(stage.x + stage.width / 2, stage.y + stage.height / 2);
await shot('02-selected');
// 逐帧推进到 2.5s。
await pressRight(25);
await shot('03-t25');
// 播放 1.2s 后暂停。
await key(' ', 'Space', 32);
await sleep(1200);
await shot('04-playing');
await key(' ', 'Space', 32);
const timeLabel = await evaluate(`document.querySelector('.template-transport-time')?.textContent`);
console.log('time after play:', timeLabel);
// 推进到第二组（约 7.5s）。
await pressRight(40);
await shot('05-scene2');
// 缩放与适应窗口。
await clickSelector('.template-preview-tools button[aria-label="放大"]');
await clickSelector('.template-preview-tools button[aria-label="放大"]');
await shot('06-zoom');
await clickSelector('.template-preview-tools button[aria-label="适应窗口"]');
await shot('07-fit');
// 进入子分镜：双击时间轴上的组合片段较复杂，改用图层树双击进入。
const entered = await evaluate(`(() => {
  const layers = [...document.querySelectorAll('.template-edit-layers .template-layer')];
  const target = layers.find(node => node.textContent.includes('第 2 组'));
  if (!target) return false;
  target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  return true;
})()`);
console.log('entered scene2 via layer dblclick:', entered);
await sleep(800);
await shot('08-inside-scene');
// 代码 toggle：预览常驻，toggle 只控制代码栏。
await clickSelector('.template-preview-heading button[aria-label="隐藏代码"]');
await shot('09-code-hidden');
console.log('code-hidden stage rect:', JSON.stringify(await rectOf('.template-preview-stage')),
  'zoom:', await evaluate(`document.querySelector('.template-preview-zoom')?.textContent`),
  'meta:', await evaluate(`document.querySelector('.template-preview-meta')?.textContent`));
console.log('preview visible with code hidden:', await evaluate(`Boolean(document.querySelector('.template-preview-stage'))`),
  'code gone:', await evaluate(`!document.querySelector('.template-edit-code')`));
await clickSelector('.template-preview-heading button[aria-label="显示代码"]');
await sleep(500);
await shot('10-code-restored');
// 画布上直接拖拽图片，验证回写 clip.transform；同时采样整页禁用控件数验证无闪烁。
await evaluate(`window.__disabledSamples = []; window.__disabledPoll = setInterval(() => { window.__disabledSamples.push(document.querySelectorAll('.template-edit-page button:disabled, .template-edit-page input:disabled').length); }, 16); true`);
await evaluate(`window.__ev = []; ['mousedown','mousemove','mouseup'].forEach(t => document.addEventListener(t, e => window.__ev.push([t, Math.round(e.clientX), Math.round(e.clientY)]), true)); true`);
const stage2 = await rectOf('.template-preview-stage');
const sx = stage2.x + stage2.width / 2;
const sy = stage2.y + stage2.height / 2 + 40;
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
for (let i = 1; i <= 10; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx + i * 6, y: sy - i * 4, button: 'left', buttons: 1 });
  await sleep(30);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx + 60, y: sy - 40, button: 'left' });
await sleep(1200);
await shot('11-drag-move');
const samples = await evaluate(`clearInterval(window.__disabledPoll); window.__disabledSamples`);
console.log('pointer events delivered:', await evaluate(`window.__ev.length`), await evaluate(`JSON.stringify(window.__ev.slice(0, 3))`), await evaluate(`JSON.stringify(window.__ev.slice(-2))`));
console.log('disabled-control samples during drag+commit min/max:', Math.min(...samples), Math.max(...samples), 'count', samples.length);
console.log('properties after drag:', await evaluate(`[...document.querySelectorAll('.template-properties input')].slice(0, 4).map(input => input.value).join(',')`));
console.log('console errors:', consoleErrors.length ? consoleErrors.slice(0, 12) : 'none');
ws.close();
chrome.kill();
process.exit(0);
