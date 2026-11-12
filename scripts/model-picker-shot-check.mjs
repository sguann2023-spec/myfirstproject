// 无头 Chrome + CDP 交互验证：模型下拉不再显示后端「识图」标签，其余标签/倍率/悬浮卡正常。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import WebSocket from 'ws';

const OUT = '/Users/sunguannan/CapCutHelper/tmp-model-picker-shots';
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const URL_TARGET = process.env.SHOT_URL || 'http://127.0.0.1:5199/__model_picker';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/capcut-model-picker-chrome', '--window-size=1440,900', '--hide-scrollbars',
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

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const waitFor = async (expression, timeoutMs = 120000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(expression)) return true;
    await sleep(500);
  }
  return false;
};
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log('shot', name);
};
const rectOf = (selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`);
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(300);
};
const clickSelector = async (selector) => {
  const rect = await rectOf(selector);
  if (!rect) throw new Error(`缺少元素 ${selector}`);
  await click(rect.x + rect.width / 2, rect.y + rect.height / 2);
};
const move = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(400);
};

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// 等待真实 Composer 挂载（Vite 冷启动预构建可能较慢）。
const mounted = await waitFor(`!!document.querySelector('.chat-panel__model-picker')`);
if (!mounted) {
  console.log('console errors:', consoleErrors.slice(0, 10));
  console.log('body:', await evaluate('document.body.innerText.slice(0, 400)'));
  ws.close();
  chrome.kill();
  process.exit(1);
}
await sleep(1500);
await shot('00-composer');

// 打开模型下拉。
await clickSelector('.chat-panel__model-picker');
const dropdownReady = await waitFor(`!!document.querySelector('.ant-select-dropdown .chat-panel__model-option')`, 15000);
check('下拉打开并渲染模型项', dropdownReady);
await sleep(500);
await shot('01-dropdown');

const dropdownState = await evaluate(`(() => {
  const dropdown = document.querySelector('.ant-select-dropdown');
  const text = dropdown ? dropdown.innerText : '';
  const promoNode = dropdown ? dropdown.querySelector('.chat-panel__model-option-tag--promo') : null;
  const promoStyle = promoNode ? getComputedStyle(promoNode) : null;
  return {
    text,
    tagCount: dropdown ? dropdown.querySelectorAll('.chat-panel__model-option-tag').length : -1,
    promoTags: dropdown ? [...dropdown.querySelectorAll('.chat-panel__model-option-tag--promo')].map(node => node.textContent) : [],
    promoBg: promoStyle ? promoStyle.backgroundColor : '',
    promoColor: promoStyle ? promoStyle.color : '',
  };
})()`);
check('下拉不再显示「识图」', !dropdownState.text.includes('识图'));
check('限时优惠促销标签保留', dropdownState.promoTags.includes('限时优惠'), JSON.stringify(dropdownState.promoTags));
check('标签仅剩促销标签（无识图占位）', dropdownState.tagCount === dropdownState.promoTags.length, `tags=${dropdownState.tagCount}`);
check('倍率正常显示', dropdownState.text.includes('0.75x') && dropdownState.text.includes('10.00x') && dropdownState.text.includes('4.75x'));
check('模型名称正常显示', ['Qwen3.8-Max', 'GLM-5.3', 'Kimi-K3', 'GPT-6.1-Terra', 'GPT-6.1-Sol'].every(name => dropdownState.text.includes(name)));
check('自定义模型入口保留', dropdownState.text.includes('自定义模型'));

// 热度徽章 → 红色 Flame 图标：1 热度 = 1 个红色实心 flame。
const heatState = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.ant-select-dropdown .chat-panel__model-option-trigger')];
  const pick = (name) => {
    const row = rows.find(item => item.textContent.includes(name));
    if (!row) return null;
    const heat = row.querySelector('.chat-panel__model-option-heat');
    const icons = heat ? [...heat.querySelectorAll('svg')] : [];
    return {
      count: icons.length,
      color: heat ? getComputedStyle(heat).color : '',
      filled: icons.length > 0 && icons.every(svg => svg.getAttribute('fill') === 'currentColor'),
      title: heat ? heat.getAttribute('title') : '',
    };
  };
  return {
    terra: pick('GPT-6.1-Terra'),
    sol: pick('GPT-6.1-Sol'),
    fable: pick('Claude-Fable-5.2'),
    kimi: pick('Kimi-K3'),
    text: document.querySelector('.ant-select-dropdown')?.innerText || '',
  };
})()`);
check('热度1 → 1 个 flame', heatState.terra?.count === 1, JSON.stringify(heatState.terra));
check('热度2 → 2 个 flame', heatState.sol?.count === 2, JSON.stringify(heatState.sol));
check('热度3 → 3 个 flame', heatState.fable?.count === 3, JSON.stringify(heatState.fable));
check('无热度模型不渲染 flame', heatState.kimi?.count === 0, JSON.stringify(heatState.kimi));
check('flame 为红色', [heatState.terra, heatState.sol, heatState.fable].every(item => item?.color === 'rgb(245, 34, 45)'), heatState.terra?.color);
check('flame 实心填充', [heatState.terra, heatState.sol, heatState.fable].every(item => item?.filled));
check('热度文本徽章不再出现', !heatState.text.includes('热度'));
check('官价折扣促销标签保留', heatState.text.includes('官价3.2折') && heatState.text.includes('官价5.8折'));
check('促销标签新配色（底 eaf4f1 / 字 009273）', dropdownState.promoBg === 'rgb(234, 244, 241)' && dropdownState.promoColor === 'rgb(0, 146, 115)', JSON.stringify({ bg: dropdownState.promoBg, color: dropdownState.promoColor }));

// 悬浮 GPT-6.1-Terra：悬浮卡（描述/消耗速度/思考强度）不受影响。
const terraRect = await evaluate(`(() => {
  const node = [...document.querySelectorAll('.ant-select-dropdown .chat-panel__model-option-trigger')].find(item => item.textContent.includes('GPT-6.1-Terra'));
  const r = node?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
})()`);
if (terraRect) {
  await move(terraRect.x + terraRect.width / 2, terraRect.y + terraRect.height / 2);
  const hoverReady = await waitFor(`!!document.querySelector('.chat-panel__model-option-popover')`, 8000);
  check('悬浮卡正常出现', hoverReady);
  if (hoverReady) {
    const hoverText = await evaluate(`document.querySelector('.chat-panel__model-option-popover').innerText`);
    check('悬浮卡含描述与消耗速度', hoverText.includes('介于Luna和Sol之间') && hoverText.includes('消耗速度') && hoverText.includes('0.75'));
    check('悬浮卡含思考强度滑杆', hoverText.includes('思考强度'));
    check('悬浮卡不含「识图」', !hoverText.includes('识图'));
    const alignState = await evaluate(`(() => {
      const row = document.querySelector('.chat-panel__model-option-popover-multiplier');
      if (!row || row.children.length < 2) return null;
      const ra = row.children[0].getBoundingClientRect();
      const rb = row.children[1].getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      return { labelCenter: ra.top + ra.height / 2, valueCenter: rb.top + rb.height / 2, rowCenter: rr.top + rr.height / 2, labelH: ra.height, valueH: rb.height };
    })()`);
    console.log('multiplier alignment:', JSON.stringify(alignState));
    check('消耗速度行光学补偿居中（数值下移2px）', !!alignState && Math.abs((alignState.valueCenter - alignState.labelCenter) - 2) < 0.75 && Math.abs(alignState.labelCenter - alignState.rowCenter) < 1.5, JSON.stringify(alignState));
    const hoverMeta = await evaluate(`(() => {
      const card = document.querySelector('.chat-panel__model-option-popover');
      const heatRow = card.querySelector('.chat-panel__model-option-popover-heat');
      const heat = heatRow ? heatRow.querySelector('.chat-panel__model-option-heat') : null;
      const icons = heat ? [...heat.querySelectorAll('svg')] : [];
      const tagsRow = card.querySelector('.chat-panel__model-option-popover-tags');
      const heading = card.querySelector('.chat-panel__thinking-heading');
      const ha = heading?.children[0]?.getBoundingClientRect();
      const hb = heading?.children[1]?.getBoundingClientRect();
      const rowRect = heatRow?.getBoundingClientRect();
      const labelRect = heatRow?.children[0]?.getBoundingClientRect();
      return {
        flameCount: icons.length,
        flameColor: heat ? getComputedStyle(heat).color : '',
        heatRowLabel: heatRow ? heatRow.children[0].textContent : '',
        heatRowCenter: rowRect ? rowRect.top + rowRect.height / 2 : null,
        heatLabelCenter: labelRect ? labelRect.top + labelRect.height / 2 : null,
        flameInTagsRow: !!tagsRow?.querySelector('.chat-panel__model-option-heat'),
        promo: [...card.querySelectorAll('.chat-panel__model-option-tag--promo')].map(node => node.textContent),
        headingLabelCenter: ha ? ha.top + ha.height / 2 : null,
        headingValueCenter: hb ? hb.top + hb.height / 2 : null,
        headingFontSizes: heading ? [getComputedStyle(heading.children[0]).fontSize, getComputedStyle(heading.children[1]).fontSize] : [],
      };
    })()`);
    check('悬浮卡热度独立成块（标签+flame）', hoverMeta.heatRowLabel === '热度' && hoverMeta.flameCount === 1 && hoverMeta.flameColor === 'rgb(245, 34, 45)', JSON.stringify({ label: hoverMeta.heatRowLabel, flameCount: hoverMeta.flameCount }));
    check('热度块文字垂直居中', Math.abs(hoverMeta.heatRowCenter - hoverMeta.heatLabelCenter) < 1.5, JSON.stringify({ row: hoverMeta.heatRowCenter, label: hoverMeta.heatLabelCenter }));
    check('徽章行不再混排 flame', hoverMeta.flameInTagsRow === false);
    check('悬浮卡显示折扣徽章', hoverMeta.promo.includes('官价3.2折'), JSON.stringify(hoverMeta.promo));
    check('思考强度行垂直居中且字号一致', Math.abs(hoverMeta.headingLabelCenter - hoverMeta.headingValueCenter) < 1 && hoverMeta.headingFontSizes[0] === hoverMeta.headingFontSizes[1], JSON.stringify(hoverMeta));
  }
  await shot('02-hover-card');
} else {
  check('找到 GPT-6.1-Terra 选项', false);
}

// 选择 Kimi-K3，验证选中态与促销标签在收起后的触发器上不残留识图。
const kimiRect = await evaluate(`(() => {
  const node = [...document.querySelectorAll('.ant-select-dropdown .chat-panel__model-option-trigger')].find(item => item.textContent.includes('Kimi-K3'));
  const r = node?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
})()`);
if (kimiRect) {
  await click(kimiRect.x + kimiRect.width / 2, kimiRect.y + kimiRect.height / 2);
  await sleep(600);
  const selectedText = await evaluate(`document.querySelector('.chat-panel__model-picker')?.innerText || ''`);
  check('选中 Kimi-K3 生效', selectedText.includes('Kimi-K3'), selectedText);
  await shot('03-selected');
} else {
  check('找到 Kimi-K3 选项', false);
}

console.log('console errors:', consoleErrors.length ? consoleErrors.slice(0, 12) : 'none');
ws.close();
chrome.kill();
process.exit(failures.length ? 1 : 0);