// 无头 Chrome 验证属性面板：画布点选、工具同款样式、无关键帧圆点/删除按钮。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import WebSocket from 'ws';

const OUT = '/Users/sunguannan/CapCutHelper/tmp-preview-shots';
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const URL_TARGET = 'http://127.0.0.1:5198/__template_preview?preset=sentence-image';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/capcut-properties-chrome', '--window-size=1680,1000', '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank',
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
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.exception?.description || 'exception');
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map(arg => arg.value || arg.description || '').join(' '));
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
const clickSelector = async (selector) => {
  const rect = await rectOf(selector);
  if (!rect) throw new Error(`缺少元素 ${selector}`);
  await click(rect.x + rect.width / 2, rect.y + rect.height / 2);
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(400);
};

// 根时间轴（未进入分镜）下直接点击画布中的图片。
const stage = await rectOf('.template-preview-stage');
await click(stage.x + stage.width / 2, stage.y + stage.height / 2 + 40);
console.log('panel heading after canvas click:', await evaluate(`document.querySelector('.template-properties-heading strong')?.textContent`));
console.log('dot buttons:', await evaluate(`document.querySelectorAll('.template-properties [aria-label$="添加当前关键帧"], .template-properties [aria-label$="删除当前关键帧"]').length`));
console.log('trash buttons:', await evaluate(`document.querySelectorAll('.template-properties [aria-label$="删除全部关键帧"]').length`));
console.log('panel rows:', await evaluate(`[...document.querySelectorAll('.template-properties .chat-panel__text-settings-label')].slice(0, 10).map(node => node.textContent).join('|')`));
await shot('20-properties-image');
// 数值输入 live 写入：X Position 216（=0.3×720），期间采样整页禁用控件数验证无闪烁。
await evaluate(`window.__disabledSamples = []; window.__disabledPoll = setInterval(() => { window.__disabledSamples.push(document.querySelectorAll('.template-edit-page button:disabled, .template-edit-page input:disabled').length); }, 16); true`);
const inputRect = await rectOf('.template-properties [aria-label="X Position"]');
await click(inputRect.x + inputRect.width / 2, inputRect.y + inputRect.height / 2);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4 });
for (const char of '216') {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: char, text: char });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
}
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(900);
console.log('x position committed:', await evaluate(`document.querySelector('.template-properties [aria-label="X Position"]')?.value`));
const samples = await evaluate(`clearInterval(window.__disabledPoll); window.__disabledSamples`);
console.log('disabled-control samples during property edit min/max:', Math.min(...samples), Math.max(...samples), 'count', samples.length);
await shot('21-properties-live-edit');
// 非等比：关掉等比缩放 → 出现缩放宽度/高度两行，且不应有红色报错。
await clickSelector('.template-properties [role="switch"][aria-label="等比缩放"]');
await sleep(400);
await evaluate(`(() => {
  const input = document.querySelector('.template-properties [aria-label="Y Scale"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '120');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.blur();
  return true;
})()`);
await sleep(900);
console.log('uniform checked after mismatch:', await evaluate(`document.querySelector('.template-properties [role="switch"][aria-label="等比缩放"]')?.getAttribute('aria-checked')`));
console.log('panel alerts:', await evaluate(`[...document.querySelectorAll('.template-properties [role="alert"]')].map(node => node.textContent).join('|') || 'none'`));
await shot('23-non-uniform');
// 点击画布文字 → 文字设置面板。
await click(stage.x + stage.width / 2, stage.y + stage.height / 2);
console.log('panel heading after text click:', await evaluate(`document.querySelector('.template-properties-heading strong')?.textContent`));
console.log('text form present:', await evaluate(`Boolean(document.querySelector('.template-properties .chat-panel__text-settings-form'))`));
await shot('22-properties-text');
console.log('console errors:', consoleErrors.length ? consoleErrors.slice(0, 8) : 'none');
ws.close();
chrome.kill();
process.exit(0);
