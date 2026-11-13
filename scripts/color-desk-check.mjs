// 调色台 Color Desk · 无头 Chrome + CDP 实测脚本
// 用法: node scripts/color-desk-check.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import WebSocket from 'ws';

const ROOT = '/Users/sunguannan/CapCutHelper/color-grading-studio';
const OUT = '/Users/sunguannan/CapCutHelper/color-grading-studio-shots';
mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9377, HTTP = 5199;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(req.url.split('?')[0]));
  const file = join(ROOT, p === '/' ? 'index.html' : p);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(HTTP, '127.0.0.1', r));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/colordesk-chrome', '--window-size=1680,1020', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-frame-rate-limit', 'about:blank',
], { stdio: 'ignore' });

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools 未就绪');
}
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
let seq = 0; const pending = new Map(); const errors = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || JSON.stringify(m.params.exceptionDetails));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description || '').join(' '));
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
};
const rect = (sel) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,width:r.width,height:r.height} : null; })()`);
const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
const click = async (x, y) => { await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(160); };
const clickSel = async (sel) => {
  await ev(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({block:'center',inline:'center'})`);
  await sleep(220);
  const r = await rect(sel);
  if (!r) throw new Error('缺少元素 ' + sel);
  await click(r.x + r.width / 2, r.y + r.height / 2);
};
const drag = async (x1, y1, x2, y2, steps = 8) => {
  await mouse('mousePressed', x1, y1);
  for (let i = 1; i <= steps; i++) await mouse('mouseMoved', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
  await mouse('mouseReleased', x2, y2); await sleep(180);
};
const key = async (k, code, vk, type) => send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });

const PIXELS = `(() => {
  const c = document.getElementById('preview');
  const t = document.createElement('canvas'); t.width = 72; t.height = 72;
  const x = t.getContext('2d'); x.drawImage(c, 0, 0, 72, 72);
  const d = x.getImageData(0, 0, 72, 72).data;
  let s = 0, s2 = 0, h = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const v = (d[i]+d[i+1]+d[i+2])/3; s += v; s2 += v*v; n++; }
  for (let i = 0; i < d.length; i += 37) h = (h * 31 + d[i]) >>> 0;
  const mean = s/n; return { mean: +mean.toFixed(2), sd: +Math.sqrt(s2/n - mean*mean).toFixed(2), hash: h, w: c.width, h2: c.height };
})()`;

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  PASS ' : '! FAIL ') + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); };

await send('Page.enable'); await send('Runtime.enable');
// 每轮从干净的 localStorage 起步，避免上一轮保存的配方影响种子数量断言
await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.removeItem('colordesk.recipes.v1');}catch(e){}` });
await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html` });
await sleep(4500);

console.log('\n=== 1. 启动与渲染 ===');
check('应用已挂载', await ev(`!!window.__colorDesk`));
check('渲染引擎为 WebGL2', await ev(`window.__colorDesk.isGL`), await ev(`window.__colorDesk.renderer.kind`));
const p0 = await ev(PIXELS);
check('预览画布已渲染出真实画面', p0.sd > 12 && p0.w > 100, p0);
check('内置 4 段素材', await ev(`document.querySelectorAll('.asset').length`) === 4);
await shot('01-initial');

console.log('\n=== 2. 滤镜库 ===');
const thumbStats = await ev(`(() => {
  const cs = [...document.querySelectorAll('.fcard canvas')];
  return cs.map(c => { const x = c.getContext('2d'); const d = x.getImageData(0,0,c.width,c.height).data;
    let s=0,s2=0,n=0; for(let i=0;i<d.length;i+=4){const v=(d[i]+d[i+1]+d[i+2])/3; s+=v; s2+=v*v; n++;}
    const m=s/n; return +Math.sqrt(s2/n-m*m).toFixed(1); });
})()`);
check('当前分类缩略图全部非空', thumbStats.length > 0 && thumbStats.every((v) => v > 8), thumbStats);
await ev(`[...document.querySelectorAll('.cat')].find(b=>b.textContent==='质感').click()`);
await sleep(900);
await ev(`[...document.querySelectorAll('.fcard')].find(c=>c.dataset.fid==='tealorange').click()`);
await sleep(600);
const p1 = await ev(PIXELS);
check('应用「电影青橙」后画面改变', p1.hash !== p0.hash, { before: p0.hash, after: p1.hash });
check('滤镜状态已同步', await ev(`window.__colorDesk.state.filter`) === 'tealorange');
check('强度胶囊显示滤镜名', (await ev(`document.getElementById('capFilter').textContent`)).includes('电影青橙'));
await shot('02-filter-tealorange');

console.log('\n=== 3. 滑杆实时响应 ===');
const setSlider = async (id, v) => {
  await ev(`(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${v}; s.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(220);
};
await setSlider('sl-exposure', 40);
const p2 = await ev(PIXELS);
check('曝光滑杆改变画面', p2.mean > p1.mean + 3, { before: p1.mean, after: p2.mean });
check('曝光数值框同步', await ev(`document.querySelector('.row[data-key="exposure"] .numbox').value`) === '40');
await setSlider('sl-contrast', 30);
await setSlider('sl-clarity', 45);
await setSlider('sl-grain', 30);
await setSlider('sl-vignette', 40);
const p3 = await ev(PIXELS);
check('质感/暗角叠加后画面继续变化', p3.hash !== p2.hash);
check('已调整计数更新', (await ev(`document.getElementById('touchedCount').textContent`)).match(/\d+/)[0] >= 5);
await shot('03-adjusted');

console.log('\n=== 4. 调色盘（色轮拖拽） ===');
const wr = await rect('.wheel[data-wheel="lift"]');
await drag(wr.x + wr.width / 2, wr.y + wr.height / 2, wr.x + wr.width * 0.22, wr.y + wr.height * 0.62);
const liftState = await ev(`[window.__colorDesk.state.liftX, window.__colorDesk.state.liftY]`);
check('阴影色轮拖拽写入状态', Math.abs(liftState[0]) > 0.2 && Math.abs(liftState[1]) > 0.1, liftState);
const p4 = await ev(PIXELS);
check('色轮改变画面', p4.hash !== p3.hash);
const gr = await rect('.wheel[data-wheel="gain"]');
await drag(gr.x + gr.width / 2, gr.y + gr.height / 2, gr.x + gr.width * 0.78, gr.y + gr.height * 0.36);
check('高光色轮拖拽写入状态', await ev(`Math.hypot(window.__colorDesk.state.gainX, window.__colorDesk.state.gainY) > 0.2`));
await ev(`document.querySelector('.wheel-lum[data-key="gammaL"]').value = 25; document.querySelector('.wheel-lum[data-key="gammaL"]').dispatchEvent(new Event('input',{bubbles:true}))`);
await sleep(250);
check('色轮亮度推子生效', await ev(`window.__colorDesk.state.gammaL`) === 0.25);
await shot('04-wheels');

console.log('\n=== 5. 商品保真 ===');
const beforeProtect = await ev(PIXELS);
await clickSel('#protectSwitch');
await sleep(400);
const afterProtect = await ev(PIXELS);
check('保真开关已开', await ev(`window.__colorDesk.state.protect`) === true);
check('保真改变画面（色度回混）', afterProtect.hash !== beforeProtect.hash);
check('保真度滑杆已启用', await ev(`!document.getElementById('sl-protectAmount').disabled`));
await shot('05-protect');
await clickSel('#protectSwitch'); await sleep(250);

console.log('\n=== 6. 对比 / 分割 / 缩放 ===');
await clickSel('#btnCompare'); await sleep(400);
check('分割对比手柄可见', await ev(`!document.getElementById('splitHandle').hidden`));
const hr = await rect('#splitHandle'); const hold = await rect('#canvasHolder');
await drag(hr.x + 1, hr.y + hr.height / 2, hold.x + hold.width * 0.28, hr.y + hr.height / 2);
const sp = await ev(`document.getElementById('splitHandle').style.left`);
check('分割手柄可拖动', parseFloat(sp) < 40 && parseFloat(sp) > 10, sp);
await shot('06-split');
const half = await ev(`(() => {
  const c = document.getElementById('preview');
  const t = document.createElement('canvas'); t.width = c.width; t.height = 8;
  const x = t.getContext('2d'); x.drawImage(c, 0, c.height/2, c.width, 8, 0, 0, c.width, 8);
  const d = x.getImageData(0,0,c.width,8).data;
  const at = (fx) => { const i = (Math.floor(c.width*fx))*4; return [d[i],d[i+1],d[i+2]]; };
  return { left: at(0.1), right: at(0.7) };
})()`);
check('分割线两侧像素确实不同', JSON.stringify(half.left) !== JSON.stringify(half.right), half);
await ev(`[...document.querySelectorAll('#viewSeg button')].find(b=>b.dataset.view==='original').click()`);
await sleep(350);
check('原片视图徽标', await ev(`document.getElementById('stageBadge').textContent`) === '原片');
await ev(`[...document.querySelectorAll('#viewSeg button')].find(b=>b.dataset.view==='graded').click()`);
await sleep(250);
await ev(`[...document.querySelectorAll('#zoomSeg button')].find(b=>b.dataset.zoom==='1').click()`);
await sleep(400);
const zoomTxt = await ev(`document.getElementById('capZoom').textContent`);
check('1:1 缩放生效', zoomTxt === '100%', zoomTxt);
await shot('07-zoom-100');
await ev(`[...document.querySelectorAll('#zoomSeg button')].find(b=>b.dataset.zoom==='fit').click()`);
await sleep(350);

console.log('\n=== 7. 示波器 ===');
const scopeStats = await ev(`(() => {
  const g = (id) => { const c = document.getElementById(id); const x = c.getContext('2d');
    const d = x.getImageData(0,0,c.width,c.height).data; let nz=0;
    for (let i=0;i<d.length;i+=4) if (d[i]>28||d[i+1]>28||d[i+2]>28) nz++;
    return { w:c.width, h:c.height, nonEmpty: nz }; };
  return { hist: g('histogram'), vec: g('vectorscope') };
})()`);
check('直方图已绘制', scopeStats.hist.nonEmpty > 300, scopeStats.hist);
check('矢量示波器已绘制', scopeStats.vec.nonEmpty > 200, scopeStats.vec);
check('直方图读数有内容', (await ev(`document.getElementById('histRead').textContent`)).includes('均值'));

console.log('\n=== 8. 配方 CRUD + 撤销 ===');
const n0 = await ev(`window.__colorDesk.recipes().length`);
check('内置种子配方存在', n0 === 4, n0);
await ev(`document.getElementById('recipeName').value = '实测配方A'`);
await clickSel('#btnSaveRecipe'); await sleep(300);
check('保存配方', await ev(`window.__colorDesk.recipes().length`) === n0 + 1);
check('配方名正确', await ev(`window.__colorDesk.recipes()[0].name`) === '实测配方A');
await ev(`window.__colorDesk.resetAll(true)`); await sleep(300);
check('重置后参数归零', await ev(`window.__colorDesk.state.contrast`) === 0);
await ev(`document.querySelectorAll('.recipe .rname')[0].click()`); await sleep(400);
check('应用配方恢复参数', await ev(`window.__colorDesk.state.filter`) === 'tealorange');
await ev(`document.querySelectorAll('.recipe .del')[0].click()`); await sleep(300);
check('删除配方', await ev(`window.__colorDesk.recipes().length`) === n0);
const undoBtn = await ev(`!!([...document.querySelectorAll('.toast .btn')].find(b=>b.textContent==='撤销'))`);
check('删除后出现撤销', undoBtn);
await ev(`[...document.querySelectorAll('.toast .btn')].find(b=>b.textContent==='撤销').click()`); await sleep(300);
check('撤销恢复配方', await ev(`window.__colorDesk.recipes().length`) === n0 + 1);
await shot('08-recipes');

console.log('\n=== 9. 导出 ===');
const cube = await ev(`window.__colorDesk.buildCube()`);
const cubeLines = cube.trim().split('\n');
const dataLines = cubeLines.filter((l) => /^\d?\.\d+ \d?\.\d+ \d?\.\d+$/.test(l.trim()));
check('.cube 头部正确', cube.includes('LUT_3D_SIZE 33') && cube.includes('DOMAIN_MAX 1.0 1.0 1.0'));
check('.cube 数据行数 = 33³', dataLines.length === 35937, dataLines.length);
const neutralCube = await ev(`(() => { window.__colorDesk.resetAll(true); return window.__colorDesk.buildCube(); })()`);
const neutralFirst = neutralCube.trim().split('\n').filter((l) => /^\d?\.\d+/.test(l.trim()))[0];
check('全零参数的 LUT 为恒等映射', neutralFirst.startsWith('0.000000 0.000000 0.000000'), neutralFirst);
await ev(`window.__colorDesk.selectFilter('warmfood'); window.__colorDesk.setParam('contrast', 20); window.__colorDesk.setParam('sharpen', 30); window.__colorDesk.setParam('grain', 12); window.__colorDesk.setParam('vignette', 25);`);
await sleep(400);
const ff = await ev(`window.__colorDesk.ffmpegCommand()`);
check('FFmpeg 含 lut3d', ff.cmd.includes("lut3d=file='grade.cube'"));
check('FFmpeg 含空间滤镜', ff.cmd.includes('unsharp') && ff.cmd.includes('noise') && ff.cmd.includes('vignette'), ff.notes);
await clickSel('#btnFfmpeg'); await sleep(350);
check('FFmpeg 弹窗打开', await ev(`document.getElementById('modalScrim').classList.contains('open')`));
check('弹窗内有复制按钮', await ev(`[...document.querySelectorAll('#modalFoot .btn')].some(b=>b.textContent==='复制命令')`));
await shot('09-ffmpeg-modal');
await clickSel('#modalClose'); await sleep(250);
check('弹窗可关闭', !(await ev(`document.getElementById('modalScrim').classList.contains('open')`)));
const pngOk = await ev(`(() => { const u = window.__colorDesk.renderer.toDataURL(); return u.startsWith('data:image/png;base64,') && u.length > 20000; })()`);
check('PNG 导出产物流有效', pngOk);

console.log('\n=== 10. 素材切换 / 随机 / 键盘 / 重复交互稳定性 ===');
await ev(`document.querySelectorAll('.asset')[3].click()`); await sleep(1400);
check('切换到夜景素材', await ev(`document.getElementById('clipName').textContent`) === '夜景霓虹');
const pNight = await ev(PIXELS);
check('夜景素材已渲染', pNight.sd > 10, pNight);
await shot('10-night-asset');
await clickSel('#btnRandom'); await sleep(900);
check('随机后选择了滤镜', await ev(`window.__colorDesk.state.filter`) !== 'none');
await shot('11-random');
await key(' ', 'Space', 32, 'keyDown'); await sleep(320);
check('按住空格显示原片', await ev(`document.getElementById('stageBadge').textContent`) === '原片');
await key(' ', 'Space', 32, 'keyUp'); await sleep(320);
check('松开空格回到调色', await ev(`document.getElementById('stageBadge').textContent`) !== '原片');
const before = await ev(PIXELS);
for (let i = 0; i < 16; i++) {
  await ev(`window.__colorDesk.selectFilter(['none','moody','cyber','clear','kodakgold'][${i} % 5])`);
  await ev(`window.__colorDesk.setParam('exposure', ${(i % 7) * 6 - 18})`);
}
await sleep(700);
const after = await ev(PIXELS);
check('16 轮反复切换后仍在渲染', after.sd > 10 && after.w > 100, after);
check('反复交互未产生页面错误', errors.length === 0, errors.slice(0, 4));
void before;
await clickSel('#btnReset'); await sleep(400);
check('重置回原片滤镜', await ev(`window.__colorDesk.state.filter`) === 'none');

console.log('\n=== 11. 响应式 ===');
for (const [w, h, tag] of [[1440, 900, '12-laptop'], [1024, 820, '13-tablet'], [390, 844, '14-mobile']]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
  await sleep(900);
  const m = await ev(`(() => {
    const de = document.documentElement;
    const overflowX = de.scrollWidth - de.clientWidth;
    const cv = document.getElementById('preview').getBoundingClientRect();
    const panel = document.getElementById('adjustScroll').getBoundingClientRect();
    const sliders = [...document.querySelectorAll('input[type=range]')];
    const visible = sliders.filter(s => { const r = s.getBoundingClientRect(); return r.width > 20 && r.height > 4; }).length;
    const wheels = [...document.querySelectorAll('.wheel')].filter(x => x.getBoundingClientRect().width > 30).length;
    return { overflowX, canvas: { w: Math.round(cv.width), h: Math.round(cv.height) }, panelW: Math.round(panel.width), sliders: sliders.length, visible, wheels };
  })()`);
  check(`${tag} 无横向溢出`, m.overflowX <= 1, m.overflowX);
  check(`${tag} 画布尺寸正常`, m.canvas.w > 100 && m.canvas.h > 80, m.canvas);
  check(`${tag} 全部滑杆可达`, m.visible === m.sliders, `${m.visible}/${m.sliders}`);
  check(`${tag} 三个色轮可达`, m.wheels === 3, m.wheels);
  await shot(tag);
}
await send('Emulation.clearDeviceMetricsOverride');
await sleep(700);

console.log('\n=== 12. 兜底管线（禁用 WebGL2） ===');
await ev(`(() => { const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(t, o){ if (t === 'webgl2') return null; return orig.call(this, t, o); };
})()`);
await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html?fallback=1` });
await sleep(4000);
// 重新注入需要在文档创建前，改用 addScriptOnNewDocument 方式
await send('Page.addScriptToEvaluateOnNewDocument', { source: `const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(t,o){ if (t==='webgl2') return null; return orig.call(this,t,o); };` });
await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html?fallback=2` });
await sleep(6000);
const fbKind = await ev(`window.__colorDesk && window.__colorDesk.renderer.kind`);
check('已降级到 Canvas2D', fbKind === 'canvas2d', fbKind);
if (fbKind === 'canvas2d') {
  check('兜底提示条可见', await ev(`document.getElementById('fallbackBanner').classList.contains('show')`));
  const fp0 = await ev(PIXELS);
  check('兜底管线仍渲染出画面', fp0.sd > 10, fp0);
  await ev(`window.__colorDesk.selectFilter('warmfood')`); await sleep(1200);
  const fp1 = await ev(PIXELS);
  check('兜底管线滤镜生效', fp1.hash !== fp0.hash, { a: fp0.hash, b: fp1.hash });
  const fbThumb = await ev(`(() => { const c = document.querySelector('.fcard canvas'); const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let s=0,s2=0,n=0; for(let i=0;i<d.length;i+=4){const v=(d[i]+d[i+1]+d[i+2])/3;s+=v;s2+=v*v;n++;} const m=s/n; return +Math.sqrt(s2/n-m*m).toFixed(1); })()`);
  check('兜底管线缩略图非空', fbThumb > 8, fbThumb);
  await shot('15-fallback');
}

console.log('\n=== 汇总 ===');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (errors.length) { console.log('页面错误：'); errors.slice(0, 10).forEach((e) => console.log('  ' + e)); }
if (failed.length) { console.log('失败项：'); failed.forEach((f) => console.log('  ' + f.name + ' → ' + JSON.stringify(f.detail))); }
writeFileSync(`${OUT}/report.json`, JSON.stringify({ results, errors }, null, 2));

ws.close(); chrome.kill(); server.close();
process.exit(failed.length ? 1 : 0);